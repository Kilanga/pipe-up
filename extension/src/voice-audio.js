// Small audio helpers for the local voice. No browser API: they also run in
// the unit tests.

const dB = (v) => 10 ** (v / 20);

// Loudest sample after polishing: -3 dBFS leaves headroom for the limiter in
// the call (voice-main.js) and is much louder than Piper's raw output, whose
// peaks sit around -11 dBFS.
export const TARGET_PEAK = dB(-3);
// A quiet recording is raised by 20 dB at most, so that an almost silent
// result does not become loud noise.
const MAX_GAIN = dB(20);
// Samples more than 45 dB below the peak count as silence when trimming.
const SILENCE = dB(-45);
// Kept around the words so soft first and last sounds ("h", "s", "f") stay whole.
const KEEP_BEFORE_S = 0.015;
const KEEP_AFTER_S = 0.04;
const FADE_S = 0.004;

/**
 * Cuts the silence before and after the words and sets the loudest sample to
 * -3 dBFS. Returns a new array; an all-silent input is returned as it is.
 * @param {Float32Array} samples
 * @param {number} rate samples per second
 */
export function polish(samples, rate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (!(peak > 1e-4)) return samples;

  const floor = peak * SILENCE;
  let first = 0;
  let last = samples.length - 1;
  while (Math.abs(samples[first]) < floor) first++;
  while (Math.abs(samples[last]) < floor) last--;
  const from = Math.max(0, first - Math.round(KEEP_BEFORE_S * rate));
  const to = Math.min(samples.length, last + 1 + Math.round(KEEP_AFTER_S * rate));

  const out = samples.slice(from, to);
  const gain = Math.min(TARGET_PEAK / peak, MAX_GAIN);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  // Very short fades: a cut in the middle of a breath must not click.
  const fade = Math.min(Math.round(FADE_S * rate), out.length >> 1);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

/** 16-bit PCM as base64: small enough to pass through extension messaging. */
export function toPcm16Base64(samples) {
  const i16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) i16[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  const bytes = new Uint8Array(i16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Splits a long text at sentence ends, so each part is short enough for the
 * voice model. Replies are short: most texts come back as one part.
 */
export function splitText(text, max = 400) {
  const parts = [];
  let current = '';
  const push = () => {
    if (current.trim()) parts.push(current.trim());
    current = '';
  };
  for (const sentence of text.trim().match(/[^.!?…\n]+[.!?…]*\s*|[.!?…\n]+\s*/g) ?? []) {
    if ((current + sentence).length > max) push();
    if (sentence.length <= max) {
      current += sentence;
      continue;
    }
    // One very long sentence: cut between words.
    for (const word of sentence.split(/\s+/)) {
      if ((current + ' ' + word).length > max) push();
      current = current ? current + ' ' + word : word;
    }
  }
  push();
  return parts;
}
