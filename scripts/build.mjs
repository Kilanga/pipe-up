// Builds the Chrome extension (dist/extension) and the hosted demo (dist/demo).
// Firebase settings come from config/firebase.local.json (not committed).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { trimPhonemizerData } from './phonemizer-data.mjs';

const root = new URL('..', import.meta.url).pathname;
const p = (s) => root + s;
const configPath = p('config/firebase.local.json');
// Order: env var (CI), local file, placeholder example.
const config = process.env.PIPE_UP_FIREBASE_CONFIG
  ? JSON.parse(process.env.PIPE_UP_FIREBASE_CONFIG)
  : existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : JSON.parse(readFileSync(p('config/firebase.example.json'), 'utf8'));
if (!process.env.PIPE_UP_FIREBASE_CONFIG && !existsSync(configPath)) {
  // A release build with placeholder settings would not work: fail in CI.
  if (process.env.CI) throw new Error('PIPE_UP_FIREBASE_CONFIG is not set');
  console.warn('! No Firebase settings: building with placeholders');
}

const define = {
  __FIREBASE_CONFIG__: JSON.stringify(config.firebaseConfig),
  __RECAPTCHA_SITE_KEY__: JSON.stringify(config.recaptchaSiteKey || ''),
};
const common = { bundle: true, minify: true, sourcemap: false, target: ['chrome139'], define, legalComments: 'none', logLevel: 'warning' };
const worker = p('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');

// The phonemizer's data file holds every language of espeak-ng (18 MB). This
// plugin rewrites the phonemizer's loader while it is bundled, so that it
// reads a much smaller file with only what an English voice needs (see
// scripts/phonemizer-data.mjs). The small file is written below.
let phonemizer = null;
const trimPhonemizer = {
  name: 'trim-phonemizer-data',
  setup(b) {
    b.onLoad({ filter: /[\\/](piper-tts-web[\\/]dist|piper-wasm[\\/]build)[\\/][^\\/]+\.js$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes('loadPackage(')) return null; // not the loader
      const data = readFileSync(p('node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data'));
      phonemizer = trimPhonemizerData(source, data);
      return { contents: phonemizer.loader, loader: 'js' };
    });
  },
};

rmSync(p('dist'), { recursive: true, force: true });

// Extension
const ext = p('dist/extension/');
mkdirSync(ext, { recursive: true });
await build({ ...common, entryPoints: [p('extension/src/content.js')], outfile: ext + 'content.js', format: 'iife' });
await build({ ...common, entryPoints: [p('extension/src/background.js')], outfile: ext + 'background.js', format: 'esm' });
// fs/path: Node-only branches of the Emscripten phonemizer, never run in Chrome.
await build({ ...common, entryPoints: [p('extension/src/sidepanel.js')], outfile: ext + 'sidepanel.js', format: 'esm', external: ['fs', 'path'], plugins: [trimPhonemizer] });
await build({ ...common, entryPoints: [p('extension/src/voice-main.js')], outfile: ext + 'voice-main.js', format: 'iife' });
await build({ ...common, entryPoints: [p('extension/src/voice-flag.js')], outfile: ext + 'voice-flag.js', format: 'iife' });
// Optional local voice module (Piper + ONNX Runtime + phonemizer), with licenses.
const voice = ext + 'voice/';
mkdirSync(voice, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cpSync(p('node_modules/onnxruntime-web/dist/' + f), voice + f);
cpSync(p('node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm'), voice + 'piper_phonemize.wasm');
// The bundled loader and the data file must describe the same bytes: a
// mismatch would only show up as a silent voice, so it stops the build here.
const builtSize = Number(readFileSync(ext + 'sidepanel.js', 'utf8').match(/remote_package_size"?:\s*(\d+)/)?.[1]);
if (!phonemizer || builtSize !== phonemizer.data.length) {
  throw new Error(
    'The voice was not built: the phonemizer loader with its file table was not found while bundling ' +
      '(expected in @mintplex-labs/piper-tts-web/dist or @diffusionstudio/piper-wasm/build). See scripts/phonemizer-data.mjs.'
  );
}
writeFileSync(voice + 'piper_phonemize.data', phonemizer.data);
cpSync(p('third_party'), voice + 'licenses', { recursive: true });
cpSync(p('extension/manifest.json'), ext + 'manifest.json');
cpSync(p('extension/icons'), ext + 'icons', { recursive: true });
cpSync(p('extension/src/sidepanel.html'), ext + 'sidepanel.html');
cpSync(p('shared/panel.css'), ext + 'panel.css');
cpSync(worker, ext + 'pdf.worker.min.mjs');
cpSync(p('LICENSE'), ext + 'LICENSE');
cpSync(p('THIRD_PARTY_NOTICES.md'), ext + 'THIRD_PARTY_NOTICES.md');

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
