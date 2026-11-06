// Bundles the test version into a single HTML page (dist/vowly-test.html).
// It reuses the platform's own templates, renderer, editor panels and styles.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = path.resolve(here, '../platform');
const read = (p) => fs.readFileSync(path.join(platform, p), 'utf8');

const plugin = {
  name: 'vowly-test',
  setup(b) {
    // Shared panels import "./api.js": answer them from the in-browser backend instead.
    b.onResolve({ filter: /^\.\/api\.js$/ }, (a) => (a.importer.includes(`${path.sep}public${path.sep}js${path.sep}`) ? { path: path.join(here, 'src/local-api.js') } : undefined));
    b.onResolve({ filter: /^\/shared\// }, (a) => ({ path: path.join(platform, a.path) }));
    b.onResolve({ filter: /^raw:/ }, (a) => ({ path: a.path.slice(4), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => {
      if (a.path === 'site') {
        // Runs inside an iframe written with srcdoc: post to any parent and accept an injected invitation code.
        const js = read('public/site.js').replace(/location\.origin/g, "'*'").replace("var code = params.get('invite');", "var code = window.__invite || params.get('invite');");
        return { contents: js, loader: 'text' };
      }
      return { contents: read(`public/demo/${a.path}.svg`), loader: 'text' };
    });
    // Photos live in the browser as data URLs rather than at /media/… addresses.
    b.onLoad({ filter: /editor-controls\.js$/ }, (a) => ({
      contents: fs.readFileSync(a.path, 'utf8').replace(/const mediaUrl = \(m, size = 400\) => [^\n]+\n/, 'const mediaUrl = (m) => m.src;\n'),
      loader: 'js'
    }));
  }
};

const out = await build({ entryPoints: [path.join(here, 'src/main.js')], bundle: true, format: 'iife', write: false, minify: true, target: 'es2020', plugins: [plugin], logLevel: 'warning' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const art1 = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(read('public/demo/art-1.svg'))}`;
const css = `${read('public/css/app.css').replace("url('/demo/art-1.svg')", () => `url("${art1}")`)}
/* test-version adjustments */
.topbar { top: env(safe-area-inset-top, 0px); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 50; background: var(--paper); }
.editor-body { height: 100dvh; }
.device iframe, .template-thumb iframe { background: #fff; }
.canvas-stage iframe { min-height: 60vh; }
@media (max-width: 860px) { .hide-sm { display: none !important; } }
@media (max-width: 600px) { .wizard-foot .save-status { display: none; } }
`;
const html = `<title>Vowly Test Version</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style>
<div id="app"><div class="loading"><span class="spinner" aria-hidden="true"></span> Loading…</div></div>
<script>${js}</script>
`;
fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
fs.writeFileSync(path.join(here, 'dist/vowly-test.html'), html);
console.log(`dist/vowly-test.html ${(html.length / 1024).toFixed(0)} KB`);
