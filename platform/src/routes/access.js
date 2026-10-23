// Server-side authorisation for wedding resources. Every /api/weddings/:weddingId/*
// route goes through `member()`, which looks up the caller's membership; anyone who
// is not a member gets a 404, so wedding IDs cannot even be probed.

const PERMS = {
  view: () => true,
  edit: (m) => m.role === 'owner' || !!m.can_edit,
  guests: (m) => m.role === 'owner' || !!m.can_manage_guests,
  publish: (m) => m.role === 'owner' || !!m.can_publish,
  owner: (m) => m.role === 'owner'
};

export function member(db, perm = 'view') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to continue.', code: 'auth_required' });
    const id = req.params.weddingId;
    const m = typeof id === 'string' ? db.get('SELECT * FROM wedding_members WHERE wedding_id = ? AND user_id = ?', id, req.user.id) : null;
    if (!m) return res.status(404).json({ error: 'Wedding not found.' });
    if (!PERMS[perm](m)) return res.status(403).json({ error: 'You do not have permission to do that. Ask the website owner to update your access.' });
    req.membership = m;
    req.weddingId = id;
    next();
  };
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
