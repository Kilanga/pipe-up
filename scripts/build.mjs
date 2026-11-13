// Builds the Chrome extension (dist/extension) and the hosted demo (dist/demo).
// Firebase settings come from config/firebase.local.json (not committed).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const p = (s) => root + s;
const configPath = p('config/firebase.local.json');
// Order: env var (CI), local file, placeholder example.
const config = process.env.PIPE_UP_FIREBASE_CONFIG
  ? JSON.parse(process.env.PIPE_UP_FIREBASE_CONFIG)
  : existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : JSON.parse(readFileSync(p('config/firebase.example.json'), 'utf8'));
if (!process.env.PIPE_UP_FIREBASE_CONFIG && !existsSync(configPath)) console.warn('! No Firebase settings: building with placeholders');

const define = {
  __FIREBASE_CONFIG__: JSON.stringify(config.firebaseConfig),
  __RECAPTCHA_SITE_KEY__: JSON.stringify(config.recaptchaSiteKey || ''),
};
const common = { bundle: true, minify: true, sourcemap: false, target: ['chrome139'], define, legalComments: 'none', logLevel: 'warning' };
const worker = p('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');

rmSync(p('dist'), { recursive: true, force: true });

// Extension
const ext = p('dist/extension/');
mkdirSync(ext, { recursive: true });
await build({ ...common, entryPoints: [p('extension/src/content.js')], outfile: ext + 'content.js', format: 'iife' });
await build({ ...common, entryPoints: [p('extension/src/background.js')], outfile: ext + 'background.js', format: 'esm' });
await build({ ...common, entryPoints: [p('extension/src/sidepanel.js')], outfile: ext + 'sidepanel.js', format: 'esm' });
cpSync(p('extension/manifest.json'), ext + 'manifest.json');
cpSync(p('extension/icons'), ext + 'icons', { recursive: true });
cpSync(p('extension/src/sidepanel.html'), ext + 'sidepanel.html');
cpSync(p('shared/panel.css'), ext + 'panel.css');
cpSync(worker, ext + 'pdf.worker.min.mjs');
cpSync(p('LICENSE'), ext + 'LICENSE');

// Hosted demo
const demo = p('dist/demo/');
mkdirSync(demo, { recursive: true });
await build({ ...common, entryPoints: [p('demo-web/demo.js')], outfile: demo + 'demo.js', format: 'esm' });
for (const f of ['index.html', 'demo.css']) cpSync(p('demo-web/' + f), demo + f);
cpSync(p('shared/panel.css'), demo + 'panel.css');
cpSync(p('extension/icons/icon.svg'), demo + 'icon.svg');
cpSync(worker, demo + 'pdf.worker.min.mjs');

try {
  execSync('zip -qr ../pipe-up-extension.zip .', { cwd: ext });
  console.log('Built dist/extension, dist/demo and dist/pipe-up-extension.zip');
} catch {
  console.log('Built dist/extension and dist/demo (zip not available)');
}
