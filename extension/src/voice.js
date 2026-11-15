// Local text-to-speech for the side panel: Piper voices running in
// WebAssembly (ONNX Runtime). Nothing is sent anywhere: the voice model is
// downloaded once from Hugging Face, then kept in this extension's storage.
//
// Licensing: Piper voices and piper-tts-web are MIT; the phonemizer
// (piper-phonemize with espeak-ng data) is GPL-3.0. They ship as a separate,
// optional module in the extension's voice/ folder, with their licenses.
import { TtsSession, stored } from '@mintplex-labs/piper-tts-web';

export const VOICE_ID = 'en_US-hfc_female-medium';

const url = (p) => chrome.runtime.getURL('voice/' + p);
const wasmPaths = {
  onnxWasm: url(''),
  piperData: url('piper_phonemize.data'),
  piperWasm: url('piper_phonemize.wasm'),
};

let session = null;

export async function isVoiceDownloaded() {
  try {
    return (await stored()).includes(VOICE_ID);
  } catch {
    return false;
  }
}

/**
 * Downloads the voice once (about 60 MB), from a click. The library's own
 * download() does not wait for its storage write, so the session is created
 * directly: it downloads, stores and loads in one awaited step.
 */
export function setupVoice(onProgress) {
  return startVoice((p) => p.total && p.url?.endsWith('.onnx') && onProgress?.(p.loaded / p.total));
}

let starting = null;
export function startVoice(progress) {
  starting ??= TtsSession.create({ voiceId: VOICE_ID, wasmPaths, progress }).then((s) => (session = s));
  starting.catch(() => (starting = null));
  return starting;
}

/**
 * Synthesizes `text` and returns 16-bit PCM as base64 plus the sample rate,
 * small enough to pass through extension messaging.
 */
export async function synthesize(text) {
  const s = await startVoice();
  const wav = await s.predict(text);
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const audio = await ctx.decodeAudioData(await wav.arrayBuffer());
  const f32 = audio.getChannelData(0);
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
  let bin = '';
  const bytes = new Uint8Array(i16.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { pcm16: btoa(bin), rate: audio.sampleRate };
}
