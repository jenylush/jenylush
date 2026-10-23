// Parent side of the live preview iframe (/app/editor-frame). The frame renders the
// draft with the same renderer the server uses for published websites.

export class PreviewFrame {
  constructor(iframe, { onSelect } = {}) {
    this.iframe = iframe;
    this.ready = false;
    this.pending = null;
    this.timer = null;
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== iframe.contentWindow) return;
      if (e.data?.type === 'frame-ready') { this.ready = true; if (this.pending) this.post(this.pending); }
      if (e.data?.type === 'select-section') onSelect?.(e.data.id);
    });
    if (!iframe.src || iframe.src === 'about:blank') iframe.src = '/app/editor-frame';
  }

  post(msg) {
    if (!this.ready || !this.iframe.isConnected) { this.pending = msg; return; }
    this.iframe.contentWindow?.postMessage(msg, location.origin);
  }

  render(state, { selected = null, showBranding = true, platformName = '' } = {}) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.post({ type: 'render', state: { wedding: state.wedding, design: state.design, sections: state.sections, media: state.media, rsvp: state.rsvp }, selected, showBranding, platformName });
    }, 80);
  }

  scrollTo(sectionId) { this.post({ type: 'scroll-to', id: sectionId }); }
  select(sectionId) { this.post({ type: 'select', id: sectionId }); }
}
