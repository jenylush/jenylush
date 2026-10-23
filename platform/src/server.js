import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { seed, getSetting } from './seed.js';
import { sessionMiddleware, csrfGuard, rateLimit } from './auth.js';
import { createEmailProvider } from './email/provider.js';
import { startWorker } from './notifications.js';
import { authRoutes } from './routes/auth.js';
import { weddingRoutes, inviteAcceptRoutes } from './routes/weddings.js';
import { mediaRoutes, mediaServeRoute } from './routes/media.js';
import { guestRoutes } from './routes/guests.js';
import { emailRoutes } from './routes/emails.js';
import { accountRoutes, eventRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { webhookRoutes } from './routes/webhooks.js';
import { siteRoutes, previewRoute, demoRoute, unsubscribeRoutes, simplePage } from './routes/site.js';
import { publicApiRoutes } from './routes/public.js';
import { PlanLimitError, FEATURE_LABELS } from './entitlements.js';
import { RESERVED_SLUGS } from './services.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const PAGES = {
  '/': 'index.html', '/login': 'login.html', '/signup': 'signup.html', '/forgot': 'forgot.html', '/reset': 'reset.html',
  '/verify': 'verify.html', '/templates': 'templates.html', '/terms': 'terms.html', '/privacy': 'privacy.html'
};
const APP_PAGES = {
  '/app': 'dashboard.html', '/app/wizard': 'wizard.html', '/app/editor': 'editor.html', '/app/guests': 'guests.html',
  '/app/emails': 'emails.html', '/app/settings': 'settings.html', '/app/upgrade': 'upgrade.html', '/app/admin': 'admin.html',
  '/app/accept-invite': 'accept-invite.html', '/app/editor-frame': 'editor-frame.html'
};

function securityHeaders(config) {
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "frame-src 'self'",
    "frame-ancestors 'self'", "form-action 'self'", "base-uri 'self'", "object-src 'none'"
  ].join('; ');
  return (req, res, next) => {
    res.set('Content-Security-Policy', csp);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  rateLimit.scale = config.rateLimitScale;
  const db = openDatabase(config.dataDir);
  seed(db);
  const provider = overrides.emailProvider || createEmailProvider(config);
  const secret = config.secret || getSetting(db, 'app_secret');
  const deps = { db, config, provider };
  const ctx = { db, config, provider, secret, deps };

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders(config));
  app.use(sessionMiddleware(db));

  // ----- Wedding websites served on their own host (subdomain or custom domain) -----
  const hostWedding = (req) => {
    const host = String(req.hostname || '').toLowerCase();
    if (config.siteBaseDomain && host.endsWith(`.${config.siteBaseDomain}`)) {
      const sub = host.slice(0, -(config.siteBaseDomain.length + 1));
      if (!sub.includes('.') && !RESERVED_SLUGS.has(sub)) return db.get('SELECT * FROM weddings WHERE slug = ?', sub) || false;
    }
    const custom = db.get('SELECT * FROM weddings WHERE custom_domain = ? AND custom_domain_verified_at IS NOT NULL', host);
    return custom || null; // null = platform host
  };
  const hostSite = siteRoutes(ctx, (req) => req.hostWedding);
  app.use((req, res, next) => {
    const w = hostWedding(req);
    if (w === null) return next();
    // Shared assets still come from the normal routes below.
    if (/^\/(media|site\.js|css|demo|shared|u)(\/|$)/.test(req.path)) { req.isSiteHost = true; return next(); }
    if (!w) return res.status(404).type('html').send(simplePage(ctx, { status: 404, title: 'Not found', body: '<h1>We could not find that wedding website</h1>' }).html);
    req.hostWedding = w;
    hostSite(req, res, next);
  });

  app.use('/webhooks', webhookRoutes(ctx));

  // ----- JSON API -----
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(csrfGuard);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use('/auth', authRoutes(ctx));
  api.use('/account', accountRoutes(ctx));
  api.use('/events', eventRoutes(ctx));
  api.use('/invites', inviteAcceptRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));
  api.use('/', publicApiRoutes(ctx));
  api.use('/weddings', weddingRoutes(ctx));
  api.use('/weddings', mediaRoutes(ctx));
  api.use('/weddings', guestRoutes(ctx));
  api.use('/weddings', emailRoutes(ctx));
  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  // ----- Public wedding pages on the platform host -----
  app.use('/w/:slug', siteRoutes(ctx, (req) => db.get('SELECT * FROM weddings WHERE slug = ?', String(req.params.slug).toLowerCase())));
  app.get('/preview/:weddingId', previewRoute(ctx));
  app.get('/templates/:templateId/demo', demoRoute(ctx));
  app.get('/media/:assetId/:size', mediaServeRoute(ctx));
  app.use('/u', unsubscribeRoutes(ctx));

  // ----- Static files and pages -----
  app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: config.production ? '1h' : 0 }));
  app.use(express.static(PUBLIC, { index: false, redirect: false, maxAge: config.production ? '1h' : 0 }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
  const sendPage = (file) => (req, res) => res.sendFile(path.join(PUBLIC, 'pages', file));
  for (const [route, file] of Object.entries(PAGES)) app.get(route, sendPage(file));
  for (const [route, file] of Object.entries(APP_PAGES)) {
    app.get(route, (req, res, next) => {
      if (!req.user) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
      if (route === '/app/admin' && req.user.role !== 'admin') return res.redirect(302, '/app');
      next();
    }, sendPage(file));
  }

  app.use((req, res) => res.status(404).type('html').send(simplePage(ctx, { status: 404, title: 'Page not found', body: '<h1>Page not found</h1><p>The page you were looking for does not exist.</p><p><a class="btn btn-primary" href="/">Go to the homepage</a></p>' }).html));

  // ----- Errors -----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const body = { error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message };
    if (err.code && typeof err.code === 'string') body.code = err.code;
    if (err.fields) body.fields = err.fields;
    if (err.missing) body.missing = err.missing;
    if (err.version) body.version = err.version;
    if (err instanceof PlanLimitError) { body.feature = err.feature; body.feature_label = FEATURE_LABELS[err.feature]; body.upgrade_url = '/app/upgrade'; }
    if (err.type === 'entity.parse.failed') { body.error = 'The request was not valid JSON.'; return res.status(400).json(body); }
    if (req.path.startsWith('/api') || req.accepts(['json', 'html']) === 'json' || req.path.endsWith('/rsvp') || req.path.endsWith('/rsvp/lookup')) return res.status(status).json(body);
    res.status(status).type('html').send(simplePage(ctx, { status, title: 'Error', body: `<h1>Something went wrong</h1><p>${body.error.replace(/[<>&]/g, '')}</p>` }).html);
  });

  let stopWorker = () => {};
  if (config.schedulerEnabled && overrides.startWorker !== false) stopWorker = startWorker(deps);
  return { app, ctx, close: () => { stopWorker(); db.close(); } };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { app, ctx } = createApp();
  const { config } = ctx;
  fs.mkdirSync(config.dataDir, { recursive: true });
  app.listen(config.port, () => {
    console.log(`${config.platformName} running at ${config.baseUrl}`);
    console.log(`Email provider: ${ctx.provider.configured ? ctx.provider.name : 'none (emails are logged as not sent)'}; payments: ${config.paymentsEnabled ? 'enabled' : 'off (freemium)'}`);
    if (config.siteBaseDomain) console.log(`Wedding sites: https://<slug>.${config.siteBaseDomain}`);
  });
}
