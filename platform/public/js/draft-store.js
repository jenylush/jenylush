// Client-side model of a wedding draft with autosave, undo and conflict handling.
// The wizard and the editor both use it, so they behave identically.
import { api, ApiError, upgradePrompt, toast } from './api.js';

const SAVE_DELAY = 900;
const MAX_UNDO = 60;

const clone = (v) => JSON.parse(JSON.stringify(v));

export class DraftStore {
  constructor(weddingId) {
    this.weddingId = weddingId;
    this.state = null;          // { wedding, design, sections, media, rsvp, version }
    this.saved = null;          // last state the server accepted
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.status = 'saved';
    this.timer = null;
    this.saving = null;
    this.pendingExtra = {};
    window.addEventListener('beforeunload', (e) => {
      if (this.status === 'dirty' || this.status === 'saving' || this.status === 'error') { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async load() {
    this.state = await api('GET', `/api/weddings/${this.weddingId}/draft`);
    this.saved = clone(this.state);
    this.emit();
    return this.state;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onStatus(fn) { this.statusListeners.add(fn); fn(this.status); return () => this.statusListeners.delete(fn); }
  emit(meta = {}) { for (const fn of this.listeners) fn(this.state, meta); }
  setStatus(s, detail) { this.status = s; for (const fn of this.statusListeners) fn(s, detail); }

  // Apply a change. `group` merges rapid edits of the same field into one undo step.
  update(mutator, { group = null, extra = null, immediate = false } = {}) {
    const before = clone(this.state);
    mutator(this.state);
    if (JSON.stringify(before) === JSON.stringify(this.state)) return;
    const last = this.undoStack[this.undoStack.length - 1];
    if (!(group && last && last.group === group && Date.now() - last.at < 1500)) {
      this.undoStack.push({ state: before, group, at: Date.now() });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    } else last.at = Date.now();
    this.redoStack = [];
    if (extra) Object.assign(this.pendingExtra, extra);
    this.emit({ source: 'update' });
    this.schedule(immediate);
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ state: clone(this.state), at: Date.now() });
    this.restore(entry.state);
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ state: clone(this.state), at: Date.now() });
    this.restore(entry.state);
  }

  restore(snapshot) {
    // Media is managed by separate endpoints, so keep the live list.
    const media = this.state.media;
    this.state = { ...clone(snapshot), media, version: this.state.version };
    this.emit({ source: 'undo' });
    this.schedule();
  }

  schedule(immediate = false) {
    this.setStatus('dirty');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), immediate ? 0 : SAVE_DELAY);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.status === 'dirty' || this.status === 'error') await this.save();
    else if (this.saving) await this.saving;
  }

  async save() {
    if (this.saving) { await this.saving; if (this.status !== 'dirty') return; }
    const payload = {
      version: this.state.version,
      wedding: this.state.wedding,
      design: this.state.design,
      sections: this.state.sections.map(({ id, type, status, content, settings }) => ({ id, type, status, content, settings })),
      ...this.pendingExtra
    };
    this.pendingExtra = {};
    this.setStatus('saving');
    const run = (async () => {
      try {
        const r = await api('PUT', `/api/weddings/${this.weddingId}/draft`, payload);
        this.state.version = r.version;
        this.saved = clone(this.state);
        this.setStatus(this.timer && this.status === 'dirty' ? 'dirty' : 'saved', r.saved_at);
      } catch (err) {
        if (err instanceof ApiError && err.data?.code === 'plan_limit') {
          // Roll back to the last saved design rather than keeping a change that cannot be saved.
          const media = this.state.media;
          this.state = { ...clone(this.saved), media };
          this.undoStack.pop();
          this.emit({ source: 'revert' });
          this.setStatus('saved');
          upgradePrompt(err.data);
        } else if (err instanceof ApiError && err.status === 409) {
          this.setStatus('error', 'Changed elsewhere — reload to continue');
          toast(err.message, 'error', 10000);
        } else if (err instanceof ApiError && err.status === 400) {
          this.setStatus('error', err.message);
          toast(err.message, 'error', 7000);
        } else {
          this.setStatus('error', 'Not saved — retrying…');
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.save(), 5000);
        }
      } finally {
        this.saving = null;
      }
    })();
    this.saving = run;
    await run;
  }

  // Helpers for common edits
  section(id) { return this.state.sections.find((s) => s.id === id); }
  sectionByType(type) { return this.state.sections.find((s) => s.type === type); }
}

export function statusText(status, detail) {
  if (status === 'saving') return 'Saving…';
  if (status === 'dirty') return 'Unsaved changes';
  if (status === 'error') return detail || 'Not saved';
  return 'All changes saved';
}
