// Audio helpers of the local voice: loudness, silence, packing, long texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polish, splitText, toPcm16Base64, TARGET_PEAK } from '../extension/src/voice-audio.js';

const RATE = 22050;
const dB = (v) => 20 * Math.log10(v);
// 0.3 s of silence, 1 s of a 200 Hz tone, 0.5 s of silence.
function recording(peak) {
  const x = new Float32Array(RATE * 1.8);
  for (let i = RATE * 0.3; i < RATE * 1.3; i++) x[i] = peak * Math.sin((2 * Math.PI * 200 * i) / RATE);
  return x;
}
const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('polish sets the peak to -3 dBFS, for quiet and for loud recordings', () => {
  for (const peak of [0.08, 0.25, 0.9]) {
    const out = polish(recording(peak), RATE);
    assert.ok(Math.abs(dB(peakOf(out)) - -3) < 0.05, `${peak} -> ${dB(peakOf(out)).toFixed(2)} dBFS`);
  }
  assert.ok(Math.abs(dB(TARGET_PEAK) - -3) < 1e-9);
});

test('polish cuts the silence around the words but keeps a short margin', () => {
  const out = polish(recording(0.25), RATE);
  const ms = (1000 * out.length) / RATE;
  assert.ok(ms > 1040 && ms < 1070, `${ms.toFixed(0)} ms kept of 1800`); // 1 s + 15 ms before + 40 ms after
  const first = out.findIndex((v) => Math.abs(v) > 0.01);
  assert.ok((1000 * first) / RATE < 25, 'starts within 25 ms');
  assert.equal(out[0], 0); // fades from and to zero: no click
  assert.equal(out.at(-1), 0);
});

test('polish leaves silence alone and never raises noise by more than 20 dB', () => {
  const silent = new Float32Array(1000);
  assert.equal(polish(silent, RATE), silent);
  const faint = polish(recording(0.001), RATE);
  assert.ok(Math.abs(dB(peakOf(faint)) - (dB(0.001) + 20)) < 0.1);
});

test('polish does not change its input', () => {
  const x = recording(0.25);
  const copy = x.slice();
  polish(x, RATE);
  assert.deepEqual(x, copy);
});

test('PCM is packed as 16-bit little-endian base64', () => {
  const bytes = Buffer.from(toPcm16Base64(Float32Array.from([0, 1, -1, 0.5, 2])), 'base64');
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => bytes.readInt16LE(2 * i)), [0, 32767, -32767, 16383, 32767]);
});

test('short replies stay whole, long texts are cut at sentence ends', () => {
  assert.deepEqual(splitText('  Let me check and get back to you.  '), ['Let me check and get back to you.']);
  assert.deepEqual(splitText(''), []);
  const long = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i}.`).join(' ');
  const parts = splitText(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 400 && /\.$/.test(p)));
  assert.equal(parts.join(' '), long);
  assert.ok(splitText('word '.repeat(300)).every((p) => p.length <= 400));
});
