import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuggestionRunner } from '../core/runner.js';
import { createPauseTimer } from '../core/pause.js';
import { fakeEngine, tick } from './fakes.js';
import { FALLBACK_REPLIES } from '../core/config.js';

const Q1 = [{ speaker: 'Maya', text: 'Is the March deadline realistic?' }];
const Q2 = [{ speaker: 'Jordan', text: 'Should we add a second vendor?' }];
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));

/** A runner on a fake computer, recording what would reach the screen. */
async function setup({ ready = true, timeoutMs = 20000, ...opts } = {}) {
  const f = fakeEngine(opts);
  if (ready) await f.engine.warmUp(); // as at start-up: the device status is then known
  f.world.calls.length = 0;
  const shown = { results: [], partials: [], log: [] };
  const runner = new SuggestionRunner({
    getEngine: async () => f.engine,
    peekEngine: () => f.engine,
    onPartial: (job, replies) => shown.partials.push({ id: job.id, n: replies.length }),
    onResult: (job, res) => shown.results.push({ id: job.id, ...res }),
    onLog: (res) => shown.log.push(res),
    timeoutMs,
  });
  return { ...f, runner, shown };
}

test('one question: answered and logged once', async () => {
  const { runner, shown } = await setup();
  runner.request({ id: 1, lines: Q1 });
  assert.equal(runner.busy, true);
  await tick(40);
  assert.equal(runner.busy, false);
  assert.deepEqual(shown.results.map((r) => [r.id, r.route]), [[1, 'on_device']]);
  assert.equal(shown.log.length, 1);
});

test('newest wins: the running request is cancelled, only the last one is shown', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 80 } });
  runner.request({ id: 1, lines: Q1 });
  await tick(20);
  runner.request({ id: 2, lines: Q2 });
  await tick(20);
  runner.request({ id: 3, lines: Q1 });
  await tick(200);
  assert.deepEqual(shown.results.map((r) => r.id), [3]);
  assert.equal(shown.log.length, 1);
  assert.equal(world.calls[0].aborted, true, 'request 1 was really aborted');
  assert.equal(world.maxRunning, 1, 'never two requests on the device at once');
  assert.ok(shown.partials.every((p) => p.id === 3));
});

test('early start: generated during the silence, shown at the pause, head start reported', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 30 } });
  assert.equal(runner.speculate(Q1), true);
  await tick(80); // finished before the pause
  assert.deepEqual(shown.results, [], 'nothing is shown before the question is asked for');
  assert.deepEqual(shown.partials, []);
  assert.equal(shown.log.length, 0);
  runner.request({ id: 7, lines: Q1 });
  assert.equal(shown.results.length, 1);
  assert.equal(shown.results[0].id, 7);
  assert.equal(shown.results[0].route, 'on_device');
  assert.ok(shown.results[0].headStartMs >= 70);
  assert.equal(world.calls.length, 1, 'the model ran once');
  assert.equal(shown.log.length, 1);
});

test('early start still running at the pause: taken over, not restarted', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 80 } });
  runner.speculate(Q1);
  await tick(30);
  runner.request({ id: 1, lines: Q1 });
  assert.equal(runner.busy, true);
  await tick(120);
  assert.equal(world.calls.length, 1);
  assert.deepEqual(shown.results.map((r) => r.id), [1]);
  assert.ok(shown.partials.length >= 1);
});

test('captions changed: the early start is cancelled and never shown', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 80 } });
  runner.speculate(Q1);
  await tick(20);
  runner.cancelEarly();
  await tick(120);
  assert.equal(world.calls[0].aborted, true);
  assert.deepEqual(shown.results, []);
  assert.equal(shown.log.length, 0);
  // a finished early start for other captions is not used either
  runner.speculate(Q1);
  await tick(120);
  runner.request({ id: 2, lines: Q2 });
  await tick(120);
  assert.deepEqual(shown.results.map((r) => r.id), [2]);
  assert.equal(shown.results[0].headStartMs, undefined);
  assert.match(world.calls.at(-1).prompt, /second vendor/);
});

test('no early start on the cloud route, whatever the consent', async () => {
  const { runner, world, engine } = await setup({ world: { nano: false }, settings: { cloudConsent: true, shareBriefingWithCloud: true } });
  assert.equal(runner.speculate(Q1), false);
  engine.forceCloud = true;
  assert.equal(runner.speculate(Q1), false);
  await tick(30);
  assert.equal(world.calls.length, 0);
});

test('no early start before the device status is known', async () => {
  const { runner, world } = await setup({ ready: false });
  assert.equal(runner.speculate(Q1), false);
  assert.equal(world.calls.length, 0);
});

test('an early start does not take the device from a question being answered', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 60 } });
  runner.request({ id: 1, lines: Q1 });
  await tick(10);
  assert.equal(runner.speculate(Q2), false);
  await tick(100);
  assert.deepEqual(shown.results.map((r) => r.id), [1]);
  assert.equal(world.calls.length, 1);
});

test('early start fails on the device: the question then takes the normal route (cloud after consent)', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 20 }, settings: { cloudConsent: true } });
  world.fail = () => true; // Gemini Nano breaks
  runner.speculate(Q1);
  await tick(60);
  assert.deepEqual(shown.results, []);
  assert.ok(world.calls.every((c) => !c.cloudFirst), 'the early start never called the cloud');
  world.fail = null;
  runner.request({ id: 4, lines: Q1 });
  await tick(80);
  assert.deepEqual(shown.results.map((r) => [r.id, r.route]), [[4, 'on_device']]);
});

test('timeout: the request is aborted and basic replies are shown', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 500 }, timeoutMs: 50 });
  runner.request({ id: 1, lines: Q1 });
  await tick(120);
  assert.equal(world.calls[0].aborted, true);
  assert.deepEqual(shown.results[0].replies, FALLBACK_REPLIES);
  assert.equal(shown.results[0].route, 'fallback');
  assert.match(shown.results[0].reason, /No answer after/);
  assert.equal(runner.busy, false);
  // and the next question works
  world.delay = 5;
  runner.request({ id: 2, lines: Q2 });
  await tick(60);
  assert.equal(shown.results.at(-1).route, 'on_device');
});

test('a stuck Gemini Nano call blocks one question only: the next one is answered', async () => {
  const { runner, shown, world } = await setup({ timeoutMs: 60 });
  world.hang = () => true;
  runner.request({ id: 1, lines: Q1 });
  await tick(120); // timed out: basic replies
  assert.deepEqual(shown.results.map((r) => [r.id, r.route]), [[1, 'fallback']]);
  world.hang = null; // the model works again, the first call never ended
  runner.request({ id: 2, lines: Q2 });
  await tick(50);
  assert.deepEqual(shown.results.map((r) => [r.id, r.route]), [[1, 'fallback'], [2, 'on_device']]);
});

test('abort(): nothing is shown after the call tab went away', async () => {
  const { runner, shown, world } = await setup({ world: { delay: 60 } });
  runner.request({ id: 1, lines: Q1 });
  await tick(10);
  runner.abort();
  await tick(100);
  assert.deepEqual(shown.results, []);
  assert.equal(world.calls[0].aborted, true);
});

test('an engine that cannot start gives basic replies, not a crash', async () => {
  const shown = [];
  const runner = new SuggestionRunner({
    getEngine: () => Promise.reject(new Error('Firebase could not start')),
    peekEngine: () => null,
    onResult: (job, res) => shown.push(res),
  });
  const warn = console.warn;
  console.warn = () => {};
  runner.request({ id: 1, lines: Q1 });
  await tick(10);
  console.warn = warn;
  assert.equal(shown[0].route, 'fallback');
  assert.match(shown[0].error, /Firebase could not start/);
  assert.doesNotMatch(shown[0].reason, /Firebase/, 'the raw error is not in the text shown');
});

test('pause timer: early at the short silence, pause at the long one, restart on change', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const seen = [];
  const timer = createPauseTimer({ pauseMs: 1200, earlyMs: 500, onEarly: () => seen.push('early'), onPause: () => seen.push('pause'), onChange: () => seen.push('change') });
  timer.touch();
  t.mock.timers.tick(499);
  assert.deepEqual(seen, ['change']);
  t.mock.timers.tick(1);
  assert.deepEqual(seen, ['change', 'early']);
  t.mock.timers.tick(300);
  timer.touch(); // someone went on speaking
  t.mock.timers.tick(1199);
  assert.deepEqual(seen, ['change', 'early', 'change', 'early']);
  t.mock.timers.tick(1);
  assert.deepEqual(seen, ['change', 'early', 'change', 'early', 'pause']);
});

test('pause timer: early start off at 0 or when too close to the pause; timing can change', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const seen = [];
  const timer = createPauseTimer({ pauseMs: 1200, earlyMs: 0, onEarly: () => seen.push('early'), onPause: () => seen.push('pause') });
  timer.touch();
  t.mock.timers.tick(1200);
  assert.deepEqual(seen, ['pause']);
  timer.set({ earlyMs: 1100 }); // only 100 ms before the pause: not worth it
  timer.touch();
  t.mock.timers.tick(1200);
  assert.deepEqual(seen, ['pause', 'pause']);
  timer.set({ pauseMs: 800, earlyMs: 300 });
  timer.touch();
  t.mock.timers.tick(300);
  assert.equal(seen.at(-1), 'early');
  t.mock.timers.tick(500);
  assert.equal(seen.at(-1), 'pause');
  timer.touch();
  timer.stop();
  t.mock.timers.tick(5000);
  assert.equal(seen.length, 4);
});

test('no unhandled rejections', async () => {
  await tick(30);
  assert.deepEqual(unhandled, []);
});
