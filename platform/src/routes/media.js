import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { now, uuid } from '../db.js';
import { member, asyncHandler } from './access.js';
import { processImage, writeVariants, deleteAssetFiles, variantPath, ACCEPTED_TYPES } from '../media.js';
import { weddingPlan, storageUsed, PlanLimitError } from '../entitlements.js';
import { HttpError, latestPublished } from '../services.js';
import { siteAccess, isMember } from '../siteAccess.js';
import { track } from '../analytics.js';

const HARD_MAX_MB = 30;

export function mediaRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: HARD_MAX_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!ACCEPTED_TYPES.includes(file.mimetype)) return cb(new HttpError(400, 'Please upload a JPEG, PNG, WebP or HEIC photo.'));
      cb(null, true);
    }
  });
  const single = (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `That photo is larger than ${HARD_MAX_MB} MB.`));
    next(err);
  });

  function checkLimits(weddingId, file, replacing = null) {
    const ent = weddingPlan(db, weddingId).entitlements;
    if (!file) throw new HttpError(400, 'Choose a photo to upload.');
    if (file.size > ent.max_upload_mb * 1024 * 1024) throw new PlanLimitError('storage', `Photos on your plan can be up to ${ent.max_upload_mb} MB each. Try a smaller version of this photo.`);
    const used = storageUsed(db, weddingId);
    if (!replacing && used.count >= ent.max_photos) throw new PlanLimitError('photos', `Your plan includes up to ${ent.max_photos} photos. Remove a photo or upgrade for more space — nothing you have uploaded will be deleted.`);
    return { ent, used };
  }

  function ensureStorage(ent, used, newBytes, oldBytes = 0) {
    if (used.bytes - oldBytes + newBytes > ent.storage_mb * 1024 * 1024) {
      throw new PlanLimitError('storage', `This photo would take you over your ${ent.storage_mb} MB storage limit. Remove some photos or upgrade — your existing photos are safe.`);
    }
  }

  r.post('/:weddingId/media', member(db, 'edit'), single, asyncHandler(async (req, res) => {
    const { ent, used } = checkLimits(req.weddingId, req.file);
    const processed = await processImage(req.file.buffer);
    ensureStorage(ent, used, processed.bytes);
    const id = uuid();
    const kind = req.body.kind === 'library' ? 'library' : 'gallery';
    writeVariants(config.dataDir, req.weddingId, id, processed.outputs);
    const ts = now();
    const pos = db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM media_assets WHERE wedding_id = ?', req.weddingId).p;
    const hasCover = !!db.get('SELECT 1 FROM media_assets WHERE wedding_id = ? AND is_cover = 1', req.weddingId);
    const makeCover = req.body.is_cover === 'true' || (!hasCover && kind === 'gallery' && req.body.auto_cover !== 'false');
    db.tx(() => {
      if (makeCover) db.run('UPDATE media_assets SET is_cover = 0 WHERE wedding_id = ?', req.weddingId);
      db.run('INSERT INTO media_assets (id, wedding_id, kind, original_name, bytes, width, height, caption, position, is_cover, uploaded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, req.weddingId, kind, String(req.file.originalname || '').slice(0, 200), processed.bytes, processed.width, processed.height, String(req.body.caption || '').slice(0, 300), pos, makeCover ? 1 : 0, req.user.id, ts, ts);
    });
    track(db, 'gallery_image_uploaded', { userId: req.user.id, weddingId: req.weddingId, props: { kind } });
    res.status(201).json({ asset: db.get('SELECT id, kind, caption, position, is_cover, width, height, bytes, original_name, updated_at FROM media_assets WHERE id = ?', id) });
  }));

  r.post('/:weddingId/media/:assetId/replace', member(db, 'edit'), single, asyncHandler(async (req, res) => {
    const asset = db.get('SELECT * FROM media_assets WHERE id = ? AND wedding_id = ?', req.params.assetId, req.weddingId);
    if (!asset) throw new HttpError(404, 'Photo not found.');
    const { ent, used } = checkLimits(req.weddingId, req.file, asset);
    const processed = await processImage(req.file.buffer);
    ensureStorage(ent, used, processed.bytes, asset.bytes);
    writeVariants(config.dataDir, req.weddingId, asset.id, processed.outputs);
    db.run('UPDATE media_assets SET bytes = ?, width = ?, height = ?, original_name = ?, updated_at = ? WHERE id = ?', processed.bytes, processed.width, processed.height, String(req.file.originalname || '').slice(0, 200), now(), asset.id);
    res.json({ asset: db.get('SELECT id, kind, caption, position, is_cover, width, height, bytes, original_name, updated_at FROM media_assets WHERE id = ?', asset.id) });
  }));

  r.patch('/:weddingId/media/:assetId', member(db, 'edit'), (req, res) => {
    const asset = db.get('SELECT * FROM media_assets WHERE id = ? AND wedding_id = ?', req.params.assetId, req.weddingId);
    if (!asset) throw new HttpError(404, 'Photo not found.');
    db.tx(() => {
      if (req.body.caption !== undefined) db.run('UPDATE media_assets SET caption = ?, updated_at = ? WHERE id = ?', String(req.body.caption).slice(0, 300), now(), asset.id);
      if (req.body.kind === 'gallery' || req.body.kind === 'library') db.run('UPDATE media_assets SET kind = ? WHERE id = ?', req.body.kind, asset.id);
      if (req.body.is_cover === true) {
        db.run('UPDATE media_assets SET is_cover = 0 WHERE wedding_id = ?', req.weddingId);
        db.run('UPDATE media_assets SET is_cover = 1 WHERE id = ?', asset.id);
      } else if (req.body.is_cover === false) db.run('UPDATE media_assets SET is_cover = 0 WHERE id = ?', asset.id);
      db.run('UPDATE weddings SET updated_at = ? WHERE id = ?', now(), req.weddingId);
    });
    res.json({ asset: db.get('SELECT id, kind, caption, position, is_cover, width, height, bytes, original_name, updated_at FROM media_assets WHERE id = ?', asset.id) });
  });

  r.put('/:weddingId/media-order', member(db, 'edit'), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    db.tx(() => {
      ids.forEach((id, i) => db.run('UPDATE media_assets SET position = ? WHERE id = ? AND wedding_id = ?', i, String(id), req.weddingId));
      db.run('UPDATE weddings SET updated_at = ? WHERE id = ?', now(), req.weddingId);
    });
    res.json({ ok: true });
  });

  r.delete('/:weddingId/media/:assetId', member(db, 'edit'), (req, res) => {
    const asset = db.get('SELECT * FROM media_assets WHERE id = ? AND wedding_id = ?', req.params.assetId, req.weddingId);
    if (!asset) throw new HttpError(404, 'Photo not found.');
    db.run('DELETE FROM media_assets WHERE id = ?', asset.id);
    db.run('UPDATE weddings SET updated_at = ? WHERE id = ?', now(), req.weddingId);
    deleteAssetFiles(config.dataDir, req.weddingId, asset.id);
    res.json({ ok: true });
  });

  return r;
}

// GET /media/:assetId/:size — private by default. A file is served when the requester
// is a member of the wedding, or when the asset is part of the published website and
// the visitor is allowed to see that website.
export function mediaServeRoute(ctx) {
  const { db, config } = ctx;
  return (req, res) => {
    const asset = db.get('SELECT * FROM media_assets WHERE id = ?', req.params.assetId);
    if (!asset) return res.status(404).end();
    const w = db.get('SELECT id, status, visibility FROM weddings WHERE id = ?', asset.wedding_id);
    const access = siteAccess(ctx, req, w);
    const member = isMember(db, req, w.id);
    // Non-members only see photos that are part of the published website.
    const published = !member && access === 'ok' && latestPublished(db, w.id)?.snapshot?.media?.some((m) => m.id === asset.id);
    const allowed = member || published;
    const isPublic = published && w.visibility === 'public';
    if (!allowed) return res.status(404).end();
    const file = variantPath(config.dataDir, asset.wedding_id, asset.id, req.params.size);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', isPublic ? 'public, max-age=86400' : 'private, max-age=3600');
    res.set('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file).pipe(res);
  };
}

