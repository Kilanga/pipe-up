// Builds the Chrome extension (dist/extension) and the hosted demo (dist/demo).
// Firebase settings come from config/firebase.local.json (not committed).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { trimPhonemizerData } from './phonemizer-data.mjs';
import { voiceFiles } from './voice-files.mjs';
import { VOICES, voiceUrl } from '../extension/src/voices.js';

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
const common = { bundle: true, minify: true, sourcemap: false, target: ['chrome139'], define, legalComments: 'external', logLevel: 'warning' };
const worker = p('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');

// The phonemizer's data file holds every language of espeak-ng (18 MB). This
// plugin rewrites the phonemizer's loader while it is bundled, so that it
// reads a much smaller file with only what an English voice needs (see
// scripts/phonemizer-data.mjs). The small file is written below.
let phonemizer = null;
const trimPhonemizer = {
  name: 'trim-phonemizer-data',
  setup(b) {
    b.onLoad({ filter: /[\\/]piper-wasm[\\/]build[\\/][^\\/]+\.js$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes('loadPackage(')) return null; // not the loader
      const data = readFileSync(p('node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data'));
      phonemizer = trimPhonemizerData(source, data);
      return { contents: phonemizer.loader, loader: 'js' };
    });
  },
};

// The included voice: downloaded once and checked (scripts/voice-files.mjs).
// Done first, so that a build without it stops before anything is replaced.
const includedVoices = [];
for (const v of VOICES.filter((v) => v.included)) includedVoices.push(...(await voiceFiles(v, voiceUrl(v.id), p('.cache/voices/'))));

rmSync(p('dist'), { recursive: true, force: true });

// Extension
const ext = p('dist/extension/');
mkdirSync(ext, { recursive: true });
await build({ ...common, entryPoints: [p('extension/src/content.js')], outfile: ext + 'content.js', format: 'iife' });
await build({ ...common, entryPoints: [p('extension/src/background.js')], outfile: ext + 'background.js', format: 'esm' });
await build({ ...common, entryPoints: [p('extension/src/sidepanel.js')], outfile: ext + 'sidepanel.js', format: 'esm' });
// The local voice runs in its own worker (Piper on ONNX Runtime, with the
// espeak-ng phonemizer). fs, path, crypto: Node-only branches of the
// phonemizer's loader, never run in Chrome.
await build({ ...common, entryPoints: [p('extension/src/voice-worker.js')], outfile: ext + 'voice-worker.js', format: 'esm', external: ['fs', 'path', 'crypto'], plugins: [trimPhonemizer] });
await build({ ...common, entryPoints: [p('extension/src/voice-main.js')], outfile: ext + 'voice-main.js', format: 'iife' });
await build({ ...common, entryPoints: [p('extension/src/voice-flag.js')], outfile: ext + 'voice-flag.js', format: 'iife' });
// Files the voice worker loads at run time, with their licenses.
const voice = ext + 'voice/';
mkdirSync(voice, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cpSync(p('node_modules/onnxruntime-web/dist/' + f), voice + f);
cpSync(p('node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm'), voice + 'piper_phonemize.wasm');
// The bundled loader and the data file must describe the same bytes: a
// mismatch would only show up as a silent voice, so it stops the build here.
const builtSize = Number(readFileSync(ext + 'voice-worker.js', 'utf8').match(/remote_package_size"?:\s*(\d+)/)?.[1]);
if (!phonemizer || builtSize !== phonemizer.data.length) {
  throw new Error(
    'The voice was not built: the phonemizer loader with its file table was not found while bundling ' +
      '(expected in @diffusionstudio/piper-wasm/build/piper_phonemize.js). See scripts/phonemizer-data.mjs.'
  );
}
writeFileSync(voice + 'piper_phonemize.data', phonemizer.data);
mkdirSync(voice + 'models');
for (const f of includedVoices) writeFileSync(voice + 'models/' + f.name, f.bytes);
cpSync(p('third_party'), voice + 'licenses', { recursive: true });
// How the GPL-3.0 phonemizer was built, as told by the package it comes from.
cpSync(p('node_modules/@diffusionstudio/piper-wasm/README.md'), voice + 'licenses/piper-wasm-BUILD.md');
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

// GPL-3.0 phonemizer: if the npm package ever ships the source it was built
// from, it goes into the release as its own archive. Today the package holds
// compiled files only, so nothing is made here and THIRD_PARTY_NOTICES.md
// says where the source is.
const phonemizerSource = ['src', 'source', 'espeak-ng'].map((d) => 'node_modules/@diffusionstudio/piper-wasm/' + d).find((d) => existsSync(p(d)));
if (phonemizerSource) {
  execSync(`tar -czf ${JSON.stringify(p('dist/espeak-ng-source.tar.gz'))} -C ${JSON.stringify(p(phonemizerSource))} .`);
  console.log('Built dist/espeak-ng-source.tar.gz from ' + phonemizerSource);
}

try {
  execSync('zip -qr ../pipe-up-extension.zip .', { cwd: ext });
  console.log('Built dist/extension, dist/demo and dist/pipe-up-extension.zip');
} catch {
  console.log('Built dist/extension and dist/demo (zip not available)');
}
