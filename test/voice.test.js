// The local voice in the side panel: the list of voices, and the queue that
// keeps quick phrases ready and never lets a reply wait for ever. The worker
// is replaced by a stand-in that answers when the test says so.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, DEFAULT_VOICE, VOICE_REVISION, voiceUrl } from '../extension/src/voices.js';

const RATE = 22050;

test('every offered voice is pinned to a revision and has checksums', () => {
  assert.match(VOICE_REVISION, /^[0-9a-f]{40}$/);
  assert.equal(DEFAULT_VOICE, 'en_US-ljspeech-medium');
  for (const v of VOICES) {
    assert.match(v.sha256, /^[0-9a-f]{64}$/);
    assert.match(v.configSha256, /^[0-9a-f]{64}$/);
    assert.ok(v.bytes > 1e7 && v.label);
    assert.ok(voiceUrl(v.id).startsWith(`https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REVISION}/en/en_US/`));
    assert.ok(voiceUrl(v.id).endsWith(`/medium/${v.id}.onnx`));
  }
});

// A stand-in worker: it loads at once and speaks when the test calls finish().
let workers = [];
class FakeWorker {
  constructor() {
    this.spoken = []; // texts asked, in order
    this.open = []; // speak requests not answered yet
    this.loads = 0;
    workers.push(this);
  }
  postMessage(m) {
    if (m.op === 'load') {
      this.loads++;
      queueMicrotask(() => this.onmessage({ data: { id: m.id, result: undefined } }));
    } else {
      this.spoken.push(m.text);
      this.open.push(m);
    }
  }
  finish() {
    const m = this.open.shift();
    this.onmessage({ data: { id: m.id, result: { pcm16: 'sound of ' + m.text, rate: RATE } } });
  }
  terminate() {
    this.ended = true;
  }
}
globalThis.chrome = { runtime: { getURL: (f) => f } };
globalThis.Worker = FakeWorker;
const tick = () => new Promise((r) => setImmediate(r));
let copies = 0;
// A fresh copy of the module (it keeps its state in module variables).
async function freshVoice() {
  workers = [];
  const voice = await import(`../extension/src/voice.js?copy=${++copies}`);
  return voice;
}

test('without a voice, nothing is spoken and no worker is started', async () => {
  const voice = await freshVoice();
  await assert.rejects(voice.synthesize('Hello.'), /not ready/);
  voice.keepReady(['One moment.']);
  voice.prepare('Hello.');
  assert.equal(workers.length, 0);
});

test('quick phrases are prepared in advance and then spoken without waiting', async () => {
  const voice = await freshVoice();
  voice.keepReady(["I'm still speaking, one moment.", 'Could you repeat that, please?']);
  await voice.useVoice(DEFAULT_VOICE);
  const [w] = workers;
  await tick();
  assert.deepEqual(w.spoken, ["I'm still speaking, one moment."]); // one at a time
  w.finish();
  await tick();
  w.finish();
  await tick();
  assert.equal(w.spoken.length, 2);
  const sound = await voice.synthesize(' Could you repeat that, please? ');
  assert.equal(sound.pcm16, 'sound of Could you repeat that, please?');
  assert.equal(w.spoken.length, 2, 'no new request to the worker');
});

test('a reply the user is waiting for goes before phrases being prepared', async () => {
  const voice = await freshVoice();
  voice.keepReady(['A.', 'B.', 'C.']);
  await voice.useVoice(DEFAULT_VOICE);
  const [w] = workers;
  await tick(); // A. is being prepared
  const reply = voice.synthesize('The contract is signed.');
  const c = voice.synthesize('C.'); // prepared later, but wanted now
  for (let i = 0; i < 4; i++) {
    w.finish();
    await tick();
  }
  assert.deepEqual(w.spoken, ['A.', 'The contract is signed.', 'C.', 'B.']);
  assert.equal((await reply).pcm16, 'sound of The contract is signed.');
  assert.equal((await c).pcm16, 'sound of C.');
});

test('a phrase not started yet can be dropped; quick phrases cannot', async () => {
  const voice = await freshVoice();
  voice.keepReady(['A.']);
  await voice.useVoice(DEFAULT_VOICE);
  const [w] = workers;
  await tick();
  voice.prepare('First suggestion.');
  voice.unprepare('First suggestion.');
  voice.unprepare('A.');
  w.finish();
  await tick();
  assert.deepEqual(w.spoken, ['A.']);
  assert.equal(w.open.length, 0);
});

test('only the most recent phrases are kept, and quick phrases always', async () => {
  const voice = await freshVoice();
  voice.keepReady(['Quick.']);
  await voice.useVoice(DEFAULT_VOICE);
  const [w] = workers;
  await tick();
  w.finish();
  for (let i = 0; i < 20; i++) {
    const s = voice.synthesize(`Reply ${i}.`);
    await tick();
    w.finish();
    await s;
  }
  assert.equal(w.spoken.length, 21);
  await voice.synthesize('Quick.'); // still ready
  await voice.synthesize('Reply 19.'); // recent: still ready
  assert.equal(w.spoken.length, 21);
  const old = voice.synthesize('Reply 0.'); // forgotten: generated again
  await tick();
  assert.equal(w.spoken.at(-1), 'Reply 0.');
  w.finish();
  await old;
});

test('another voice forgets what was prepared and prepares the quick phrases again', async () => {
  const voice = await freshVoice();
  voice.keepReady(['Quick.']);
  await voice.useVoice(VOICES[0].id);
  const [w] = workers;
  await tick();
  w.finish();
  await tick();
  await voice.useVoice(VOICES[1].id);
  assert.equal(voice.currentVoice(), VOICES[1].id);
  await tick();
  assert.deepEqual(w.spoken, ['Quick.', 'Quick.']);
  await assert.rejects(voice.useVoice('en_US-unknown-medium'), /Unknown voice/);
  assert.equal(voice.currentVoice(), VOICES[1].id);
});

test('a reply that takes more than 15 seconds fails, and the voice starts again', async () => {
  const voice = await freshVoice();
  await voice.useVoice(DEFAULT_VOICE);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const stuck = voice.synthesize('This one never comes back.');
    const failed = assert.rejects(stuck, /took too long/);
    await tick();
    mock.timers.tick(voice.MAX_WAIT_MS - 1);
    assert.equal(workers[0].ended, undefined);
    mock.timers.tick(1);
    await failed;
    assert.equal(workers[0].ended, true);
    // The next reply starts a new worker, loads the voice again, and works.
    const next = voice.synthesize('Next reply.');
    await tick();
    await tick();
    assert.equal(workers.length, 2);
    assert.equal(workers[1].loads, 1);
    workers[1].finish();
    assert.equal((await next).pcm16, 'sound of Next reply.');
  } finally {
    mock.timers.reset();
  }
});

test('a failed reply is not kept: asking again tries again', async () => {
  const voice = await freshVoice();
  await voice.useVoice(DEFAULT_VOICE);
  const [w] = workers;
  const first = voice.synthesize('Hello.');
  await tick();
  const m = w.open.shift();
  w.onmessage({ data: { id: m.id, error: 'The voice could not read this text.' } });
  await assert.rejects(first, /could not read/);
  const second = voice.synthesize('Hello.');
  await tick();
  w.finish();
  assert.equal((await second).pcm16, 'sound of Hello.');
});
