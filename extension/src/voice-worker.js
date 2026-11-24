// The Pipe Up voice: Piper voices running in WebAssembly (ONNX Runtime), in a
// worker so that the side panel stays responsive while a reply is prepared.
// Nothing is sent anywhere: the text is turned into sound on this computer.
//
// Licensing: ONNX Runtime is MIT; the phonemizer (piper-phonemize with
// espeak-ng data) is GPL-3.0 and ships as separate files in the extension's
// voice/ folder, with its license. The default voice model is in
// voice/models/; the others are downloaded on request: see voices.js and
// THIRD_PARTY_NOTICES.md.
import * as ort from 'onnxruntime-web/wasm';
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import { polish, splitText, toPcm16Base64 } from './voice-audio.js';

// This file sits next to the voice/ folder in the extension.
const file = (name) => new URL('voice/' + name, self.location.href).href;

// ONNX Runtime loads its own program from the extension, never from a CDN.
ort.env.wasm.wasmPaths = file('');
// One thread: more would need a cross-origin isolated side panel.
ort.env.wasm.numThreads = 1;

let voice = null; // { id, config, session }: the voice in use

// Replies are spoken one at a time. A voice is loaded (and downloaded) next
// to that, so the voice in use keeps speaking during a long download.
let speaking = Promise.resolve();
let loading = Promise.resolve();

// ---------- Voice files (included, or downloaded once and kept in this extension's storage) ----------
const folder = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('piper', { create: true });

async function read(dir, name) {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer();
  } catch {
    return null; // not downloaded
  }
}

async function write(dir, name, bytes) {
  const out = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await out.write(bytes);
  await out.close();
}

async function remove(dir, name) {
  try {
    await dir.removeEntry(name);
  } catch {
    // nothing stored
  }
}

const BAD_FILE = 'The voice file is damaged or is not the expected one. Try again.';

async function download(url, expectedBytes, onProgress) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('The voice could not be downloaded. Check your internet connection.');
  }
  if (!res.ok) throw new Error(`The voice could not be downloaded (error ${res.status} from the server).`);
  if (!expectedBytes) return res.arrayBuffer();
  // The size is known in advance: fill one buffer and report progress.
  const bytes = new Uint8Array(expectedBytes);
  const reader = res.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > expectedBytes) throw new Error(BAD_FILE);
    bytes.set(value, loaded);
    loaded += value.length;
    onProgress(loaded / expectedBytes);
  }
  if (loaded !== expectedBytes) throw new Error('The voice download stopped before the end. Try again.');
  return bytes.buffer;
}

async function sha256(buffer) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const right = async (v, model, config) => (await sha256(model)) === v.sha256 && (await sha256(config)) === v.configSha256;

// The included voice is read from the extension's own files, where it stays:
// no copy is made. It is checked like a download, so a damaged or replaced
// file is never used.
async function included(v, names) {
  const get = (name) =>
    fetch(file('models/' + name)).then(
      (res) => (res.ok ? res.arrayBuffer() : null),
      () => null // not in the extension
    );
  const model = await get(names.model);
  const config = await get(names.config);
  if (!model || !config || !(await right(v, model, config))) {
    throw new Error('The included voice is missing or damaged. Install Pipe Up again, or choose another voice.');
  }
  // Version 0.4.0 downloaded this voice: that copy is no longer needed.
  try {
    const dir = await folder();
    await remove(dir, names.model);
    await remove(dir, names.config);
  } catch {
    // storage not available: nothing was stored
  }
  return { model, config };
}

async function downloaded(v, names, onProgress) {
  const dir = await folder();
  let model = await read(dir, names.model);
  let config = await read(dir, names.config);
  const stored = Boolean(model && config);
  if (!stored) {
    config = await download(v.url + '.json');
    model = await download(v.url, v.bytes, onProgress);
  }
  if (!(await right(v, model, config))) {
    // Remove what was stored, so that "Try again" downloads fresh files.
    await remove(dir, names.model);
    await remove(dir, names.config);
    throw new Error(BAD_FILE);
  }
  if (!stored) {
    await write(dir, names.config, config);
    await write(dir, names.model, model);
  }
  return { model, config };
}

/**
 * Makes `v` the voice in use, downloading it first if needed. If anything
 * fails, the voice that was in use stays in use.
 *
 * Only the exact files whose license was checked are accepted: their
 * SHA-256 is verified after the download, before anything is stored, and
 * again each time the files are loaded, from the extension or from storage.
 */
async function load(v, onProgress) {
  if (voice?.id === v.id) return;
  const names = { model: v.id + '.onnx', config: v.id + '.onnx.json' };
  const { model, config } = v.included ? await included(v, names) : await downloaded(v, names, onProgress);
  const next = {
    id: v.id,
    config: JSON.parse(new TextDecoder().decode(config)),
    session: await ort.InferenceSession.create(model, { executionProviders: ['wasm'] }),
  };
  // Swap between two replies, never in the middle of one.
  await (speaking = speaking.then(async () => {
    const previous = voice;
    voice = next;
    await previous?.session.release().catch(() => {});
  }));
}

// ---------- Text to phonemes (espeak-ng) ----------
// The phonemizer is a small command-line program: it runs once per text, in
// a fresh copy. Its code is compiled once and its data fetched once, so a
// fresh copy costs a few milliseconds.
let phonemizerFiles = null;
function loadPhonemizer() {
  const bytes = async (name) => {
    const res = await fetch(file(name));
    if (!res.ok) throw new Error('Missing voice file: ' + name);
    return res.arrayBuffer();
  };
  phonemizerFiles ??= Promise.all([bytes('piper_phonemize.wasm').then((b) => WebAssembly.compile(b)), bytes('piper_phonemize.data')]).catch((e) => {
    phonemizerFiles = null;
    throw e;
  });
  return phonemizerFiles;
}

async function phonemize(text) {
  const [program, data] = await loadPhonemizer();
  let ids = null;
  const problems = [];
  const run = await createPiperPhonemize({
    print: (line) => {
      try {
        ids = JSON.parse(line).phoneme_ids;
      } catch {
        problems.push(line);
      }
    },
    printErr: (line) => problems.push(line),
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(program, imports).then((instance) => done(instance, program));
      return {};
    },
    getPreloadedPackage: () => data.slice(0),
  });
  run.callMain(['-l', voice.config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  if (!ids?.length) throw new Error('The voice could not read this text. ' + problems.join(' '));
  return ids;
}

// ---------- Phonemes to sound (Piper) ----------
async function infer(ids) {
  const { config, session } = voice;
  const { noise_scale, length_scale, noise_w } = config.inference;
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([noise_scale, length_scale, noise_w]), [3]),
  };
  // Voices with several speakers need one to be named: the first.
  if (Object.keys(config.speaker_id_map || {}).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const { output } = await session.run(feeds);
  return output.data;
}

/** Returns 16-bit PCM as base64 plus the sample rate. */
async function speak(text) {
  if (!voice) throw new Error('The voice is not ready.');
  const parts = splitText(text);
  if (!parts.length) throw new Error('Nothing to say.');
  const sounds = [];
  for (const part of parts) sounds.push(await infer(await phonemize(part)));
  let all = sounds[0];
  if (sounds.length > 1) {
    all = new Float32Array(sounds.reduce((n, s) => n + s.length, 0));
    let at = 0;
    for (const s of sounds) {
      all.set(s, at);
      at += s.length;
    }
  }
  const rate = voice.config.audio.sample_rate;
  return { pcm16: toPcm16Base64(polish(all, rate)), rate };
}

// ---------- Requests from the side panel ----------
const after = (line, job) => line.then(job, job);

self.onmessage = ({ data: m }) => {
  const answer = (job) =>
    job().then(
      (result) => self.postMessage({ id: m.id, result }),
      (e) => self.postMessage({ id: m.id, error: String(e?.message || e) })
    );
  if (m.op === 'load') loading = after(loading, () => answer(() => load(m.voice, (progress) => self.postMessage({ id: m.id, progress }))));
  else speaking = after(speaking, () => answer(() => speak(m.text)));
};
