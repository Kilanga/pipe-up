import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InferenceMode } from 'firebase/ai';
import { fakeEngine, repliesJson, tick } from './fakes.js';
import { FALLBACK_REPLIES } from '../core/config.js';

const LINES = [{ speaker: 'Maya', text: 'Is the March deadline realistic?' }];
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));

test('on device by default: ONLY_ON_DEVICE, rules as system prompt, JSON schema', async () => {
  const { engine, world } = fakeEngine();
  const res = await engine.suggest(LINES);
  assert.equal(res.route, 'on_device');
  assert.equal(res.replies.length, 3);
  const [call] = world.calls;
  assert.equal(call.mode, InferenceMode.ONLY_ON_DEVICE);
  assert.match(call.system, /exactly 3 short replies/);
  assert.equal(call.schema.required[0], 'replies');
});

test('no Gemini Nano and no consent: nothing is sent, basic replies', async () => {
  const { engine, world } = fakeEngine({ world: { nano: false } });
  const res = await engine.suggest(LINES);
  assert.equal(res.route, 'blocked');
  assert.deepEqual(res.replies, FALLBACK_REPLIES);
  assert.equal(world.calls.length, 0);
});

test('no Gemini Nano, consent given: PREFER_ON_DEVICE reaches the cloud with 2 lines and no history', async () => {
  const events = [{ id: '1', ts: Date.now(), context: 'Is the March deadline realistic?', action: 'typed', reply: 'SECRET-HISTORY', shown: [] }];
  const { engine, world } = fakeEngine({ world: { nano: false }, settings: { cloudConsent: true }, events });
  const lines = [{ speaker: 'A', text: 'first line' }, { speaker: 'B', text: 'second line' }, ...LINES];
  const res = await engine.suggest(lines);
  assert.equal(res.route, 'in_cloud');
  const [call] = world.calls;
  assert.equal(call.mode, InferenceMode.PREFER_ON_DEVICE);
  assert.doesNotMatch(call.prompt, /first line/);
  assert.match(call.prompt, /second line/);
  assert.doesNotMatch(call.prompt, /SECRET-HISTORY/);
});

test('Gemini Nano fails, consent given: ONLY_IN_CLOUD; the kill switch blocks it', async () => {
  const fail = (rec) => rec.mode === InferenceMode.ONLY_ON_DEVICE;
  const a = fakeEngine({ world: { fail }, settings: { cloudConsent: true } });
  const res = await a.engine.suggest(LINES);
  assert.equal(res.route, 'in_cloud');
  assert.equal(a.world.calls.at(-1).mode, InferenceMode.ONLY_IN_CLOUD);

  const b = fakeEngine({ world: { fail }, settings: { cloudConsent: true }, remote: { cloud_enabled: false } });
  const blocked = await b.engine.suggest(LINES);
  assert.equal(blocked.route, 'fallback');
  assert.match(blocked.reason, /cloud switched off/);
  assert.ok(b.world.calls.every((c) => c.mode === InferenceMode.ONLY_ON_DEVICE));
});

test('cancel on device: the signal travels in promptOptions and stops the request', async () => {
  const { engine, world } = fakeEngine({ world: { delay: 200 } });
  const ctl = new AbortController();
  const p = engine.suggest(LINES, { signal: ctl.signal });
  await tick(20);
  assert.equal(world.calls[0].signalIn, 'promptOptions');
  ctl.abort();
  const res = await p;
  assert.equal(res.cancelled, true);
  assert.equal(res.route, 'cancelled');
  assert.equal(world.calls[0].aborted, true);
  assert.equal(world.calls.length, 1, 'a cancelled request is not retried and never goes to the cloud');
});

test('cancel in the cloud: the signal travels in the request options', async () => {
  const { engine, world } = fakeEngine({ world: { nano: false, delay: 200 }, settings: { cloudConsent: true } });
  engine.forceCloud = true; // ONLY_IN_CLOUD
  const ctl = new AbortController();
  const p = engine.suggest(LINES, { signal: ctl.signal });
  await tick(20);
  assert.equal(world.calls[0].signalIn, 'requestOptions');
  ctl.abort();
  assert.equal((await p).cancelled, true);
  assert.equal(world.calls[0].aborted, true);
});

test('a cancelled on-device request never falls back to the cloud', async () => {
  const { engine, world } = fakeEngine({ world: { delay: 100 }, settings: { cloudConsent: true } });
  const ctl = new AbortController();
  const p = engine.suggest(LINES, { signal: ctl.signal });
  await tick(10);
  ctl.abort();
  await p;
  await tick(20);
  assert.equal(world.calls.length, 1);
  assert.equal(world.calls[0].mode, InferenceMode.ONLY_ON_DEVICE);
});

test('device calls run one after the other, each with its own signal', async () => {
  const { engine, world } = fakeEngine({ world: { delay: 60 } });
  const first = new AbortController();
  const a = engine.suggest(LINES, { signal: first.signal });
  await tick(10);
  first.abort(); // replaced by a newer question
  const b = engine.suggest([{ speaker: 'Jordan', text: 'Second vendor?' }]);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.cancelled, true);
  assert.equal(rb.route, 'on_device');
  assert.equal(world.maxRunning, 1);
  assert.equal(world.calls[1].aborted, false);
});

test('the device status is asked once while Gemini Nano works, and again after an error', async () => {
  const { engine, world } = fakeEngine();
  assert.equal(engine.deviceReady, false);
  await engine.suggest(LINES);
  await engine.suggest(LINES);
  await engine.suggest(LINES);
  assert.equal(world.statusCalls, 1);
  assert.equal(engine.deviceReady, true);
  world.fail = () => true;
  const res = await engine.suggest(LINES);
  assert.equal(res.route, 'fallback');
  assert.equal(engine.deviceReady, false);
  world.fail = null;
  await engine.suggest(LINES);
  assert.equal(world.statusCalls, 2);
});

test('simulating a computer without Gemini Nano is never "device ready"', async () => {
  const { engine } = fakeEngine();
  await engine.suggest(LINES);
  engine.forceCloud = true;
  assert.equal(engine.deviceReady, false);
});

test('deviceOnly (early start): Gemini Nano or nothing, even with cloud consent', async () => {
  const a = fakeEngine({ world: { nano: false }, settings: { cloudConsent: true } });
  const res = await a.engine.suggest(LINES, { deviceOnly: true });
  assert.equal(res.unavailable, true);
  assert.equal(a.world.calls.length, 0);

  const b = fakeEngine({ world: { fail: () => true }, settings: { cloudConsent: true } });
  const res2 = await b.engine.suggest(LINES, { deviceOnly: true });
  assert.equal(res2.unavailable, true);
  assert.ok(b.world.calls.every((c) => c.mode === InferenceMode.ONLY_ON_DEVICE));
});

test('streaming: complete replies are reported before the end', async () => {
  const { engine } = fakeEngine({ world: { answer: () => repliesJson('One.', 'Two.', 'Three.') } });
  const partials = [];
  await engine.suggest(LINES, { onPartial: (r) => partials.push(r.length) });
  assert.ok(partials.length >= 1);
});

test('warm-up uses the device only and does not leave a stale cancel signal', async () => {
  const { engine, world } = fakeEngine({ world: { delay: 30 } });
  const ctl = new AbortController();
  const p = engine.suggest(LINES, { signal: ctl.signal });
  await tick(5);
  ctl.abort();
  await p;
  await engine.warmUp();
  assert.equal(engine.warmed, true);
  assert.equal(world.calls.at(-1).aborted, false);
  assert.equal(world.calls.at(-1).mode, InferenceMode.ONLY_ON_DEVICE);
});

test('no unhandled rejections from cancelled requests', async () => {
  await tick(20);
  assert.deepEqual(unhandled, []);
});
