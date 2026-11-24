// The side panel's access to the local voice. The voice itself runs in a
// worker (voice-worker.js). This file
// starts it, keeps the phrases the user is most likely to say ready in
// advance, and puts a reply the user is waiting for ahead of that
// preparation.
import { VOICES, voiceUrl } from './voices.js';

// ---------- The worker ----------
let worker = null;
let loaded = null; // id of the voice the worker has loaded
let lastId = 0;
const waiting = new Map(); // request id -> { resolve, reject, onProgress }

function ask(message, onProgress) {
  if (!worker) {
    worker = new Worker(chrome.runtime.getURL('voice-worker.js'), { type: 'module' });
    worker.onmessage = ({ data: m }) => {
      const w = waiting.get(m.id);
      if (!w) return;
      if ('progress' in m) return w.onProgress?.(m.progress);
      waiting.delete(m.id);
      if ('error' in m) w.reject(new Error(m.error));
      else w.resolve(m.result);
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      stopWorker('The voice stopped working.');
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++lastId;
    waiting.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, ...message });
  });
}

// Ends a worker that failed or is stuck. Nothing it was doing will be
// answered; the next request starts a new worker and loads the voice again.
function stopWorker(why) {
  worker?.terminate();
  worker = null;
  loaded = null;
  for (const w of waiting.values()) w.reject(new Error(why));
  waiting.clear();
}

async function load(id, onProgress) {
  const v = VOICES.find((x) => x.id === id);
  if (!v) throw new Error('Unknown voice: ' + id);
  await ask({ op: 'load', voice: { ...v, url: voiceUrl(id) } }, onProgress);
  loaded = id;
}

// ---------- Choosing a voice ----------
let current = null; // id of the voice in use

export const currentVoice = () => current;

const storage = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('piper', { create: true });
const filesOf = (id) => [id + '.onnx', id + '.onnx.json'];

/** Ids of the voices on this computer: the included one and those already downloaded. */
export async function availableVoices() {
  const names = [];
  try {
    for await (const name of (await storage()).keys()) names.push(name);
  } catch {
    // storage not available: nothing downloaded
  }
  return VOICES.filter((v) => v.included || filesOf(v.id).every((f) => names.includes(f))).map((v) => v.id);
}

/** Frees the space taken by voices that an older version offered. */
export async function removeOldVoices() {
  try {
    const dir = await storage();
    const keep = VOICES.flatMap((v) => filesOf(v.id));
    for await (const name of dir.keys()) if (!keep.includes(name)) await dir.removeEntry(name, { recursive: true });
  } catch {
    // storage not available
  }
}

/**
 * Makes a voice the one in use; downloads it first if it is not on this
 * computer (about 64 MB, `onProgress` gets 0…1). If this fails, the voice in
 * use before stays.
 */
export async function useVoice(id, onProgress) {
  await load(id, onProgress);
  if (current !== id) forgetAll(); // prepared with another voice
  current = id;
  refill();
}

// ---------- Speaking ----------
// A reply the user wants now goes first; phrases prepared in advance wait.
const urgent = [];
const idle = [];
let busy = false;

async function work() {
  if (busy) return;
  busy = true;
  for (let job; (job = urgent.shift() || idle.shift()); ) {
    try {
      if (loaded !== current) await load(current); // after the worker was restarted
      job.resolve(await ask({ op: 'speak', text: job.text }));
    } catch (e) {
      job.reject(e);
    }
  }
  busy = false;
}

// Recent results by text, so the same phrase is never generated twice. Small:
// one second of speech is about 60 kB here.
const MAX_READY = 16;
const MAX_TEXT = 300; // longer texts are not kept
const ready = new Map(); // text -> Promise<{pcm16, rate}>
let always = []; // phrases to keep ready whatever else is said

function get(text, list) {
  let sound = ready.get(text);
  if (!sound) {
    sound = new Promise((resolve, reject) => list.push({ text, resolve, reject }));
    sound.catch(() => ready.get(text) === sound && ready.delete(text)); // a failure is not kept
  } else if (list === urgent) {
    // Being prepared in the background but wanted now: move it to the front.
    const at = idle.findIndex((j) => j.text === text);
    if (at >= 0) urgent.push(...idle.splice(at, 1));
  }
  if (text.length <= MAX_TEXT) remember(text, sound);
  work();
  return sound;
}

function remember(text, sound) {
  ready.delete(text);
  ready.set(text, sound); // most recent last
  for (const old of ready.keys()) {
    if (ready.size <= MAX_READY) break;
    if (!always.includes(old)) ready.delete(old);
  }
}

function forgetAll() {
  ready.clear();
  for (const job of idle.splice(0)) job.reject(new Error('Not needed any more.'));
}

const refill = () => current && always.forEach((text) => get(text, idle).catch(() => {}));

// A reply must never wait for ever: after this long the voice is restarted
// and the caller is told, so that the reply can go to the chat instead.
export const MAX_WAIT_MS = 15000;

/**
 * Turns `text` into sound with the voice in use. Resolves with 16-bit PCM as
 * base64 plus the sample rate, small enough for extension messaging.
 * Rejects if the voice fails or takes more than 15 seconds.
 */
export function synthesize(text) {
  if (!current) return Promise.reject(new Error('The voice is not ready.'));
  const sound = get(text.trim(), urgent);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The voice took too long.'));
      stopWorker('The voice took too long.');
    }, MAX_WAIT_MS);
    sound.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Phrases to keep ready at all times (quick phrases): spoken without waiting. */
export function keepReady(texts) {
  always = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_READY / 2);
  refill();
}

/** Prepares one more phrase in the background, when nothing else is waiting. */
export function prepare(text) {
  if (current && text.trim()) get(text.trim(), idle).catch(() => {});
}

/** Gives up preparing `text` if that has not started yet. */
export function unprepare(text) {
  const at = idle.findIndex((j) => j.text === text.trim());
  if (at < 0 || always.includes(text.trim())) return;
  ready.delete(text.trim());
  idle.splice(at, 1)[0].reject(new Error('Not needed any more.'));
}
