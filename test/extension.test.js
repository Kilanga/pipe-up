import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSelf, setMyName, recentLines } from '../extension/src/meet-captions.js';
import { readFileSync } from 'node:fs';
import { migrateSettings, voiceOutputWithoutVoice, DEFAULT_SETTINGS, CLOUD_PROBLEM_TEXT } from '../core/config.js';
import { findHandButton, raiseHand } from '../extension/src/meet-hand.js';

// A minimal stand-in for Meet's toolbar: buttons with attributes and a click counter.
function fakeDoc(buttons) {
  const nodes = buttons.map((attrs) => ({
    attrs: { ...attrs },
    clicks: 0,
    disabled: Boolean(attrs.disabled),
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    click() {
      this.clicks++;
    },
  }));
  return {
    nodes,
    // the only selector meet-hand.js uses: toggle buttons that have a label
    querySelectorAll: (sel) => (sel === 'button[aria-pressed][aria-label]' ? nodes.filter((n) => 'aria-pressed' in n.attrs && 'aria-label' in n.attrs) : []),
  };
}

test('own captions are recognised in several Meet languages', () => {
  for (const n of ['You', 'Vous', 'Jij', 'あなた', 'Ty']) assert.ok(isSelf(n), n);
  assert.ok(!isSelf('Maya'));
});

test('a custom display name marks the user as speaker', () => {
  setMyName('Sam Taylor');
  assert.ok(isSelf('sam taylor'));
  setMyName('');
  assert.ok(!isSelf('Sam Taylor'));
});

test('recent lines label the user as Me and keep the last three', () => {
  const lines = recentLines([
    { speaker: 'A', text: '1', self: false },
    { speaker: 'You', text: '2', self: true },
    { speaker: 'B', text: '3', self: false },
    { speaker: 'C', text: '4', self: false },
  ]);
  assert.deepEqual(lines.map((l) => l.speaker), ['Me', 'B', 'C']);
});

test('old settings get the new quick phrases, other choices are kept', () => {
  const s = migrateSettings({ fillers: ['One moment, please.'], outputMode: 'chat', dontLearn: true });
  assert.deepEqual(s.fillers, DEFAULT_SETTINGS.fillers);
  assert.equal(s.dontLearn, true);
  const again = migrateSettings({ ...s, fillers: ['Mine'] });
  assert.deepEqual(again.fillers, ['Mine']);
});

test('raise hand: found by its label in several Meet languages', () => {
  for (const l of ['Raise hand (ctrl + alt + h)', 'Lever la main (ctrl + alt + h)', 'Levantar la mano', 'Hand heben', 'Alza la mano', 'Levantar a mão', 'Hand opsteken', 'Podnieś rękę']) {
    const doc = fakeDoc([{ 'aria-pressed': 'false', 'aria-label': 'Chat with everyone' }, { 'aria-pressed': 'false', 'aria-label': l }]);
    const found = findHandButton(doc);
    assert.equal(found?.button, doc.nodes[1], l);
    assert.equal(found.raised, false, l);
  }
});

test('raise hand: clicks once when the hand is down, never when it is up', () => {
  const down = fakeDoc([{ 'aria-pressed': 'false', 'aria-label': 'Raise hand (ctrl + alt + h)' }]);
  assert.equal(raiseHand(down), 'raised');
  assert.equal(down.nodes[0].clicks, 1);
  const pressed = fakeDoc([{ 'aria-pressed': 'true', 'aria-label': 'Raise hand (ctrl + alt + h)' }]);
  assert.equal(raiseHand(pressed), 'already');
  assert.equal(pressed.nodes[0].clicks, 0);
  const lower = fakeDoc([{ 'aria-pressed': 'true', 'aria-label': 'Lower hand (ctrl + alt + h)' }]);
  assert.equal(raiseHand(lower), 'already');
  const baisser = fakeDoc([{ 'aria-pressed': 'false', 'aria-label': 'Baisser la main' }]);
  assert.equal(raiseHand(baisser), 'already', 'a "lower hand" label means the hand is up, whatever aria-pressed says');
  assert.equal(baisser.nodes[0].clicks, 0);
});

test('raise hand: fails silently and never clicks another button', () => {
  const none = fakeDoc([
    { 'aria-pressed': 'false', 'aria-label': 'Chat with everyone' },
    { 'aria-label': 'Raise hand' }, // not a toggle: could be a menu entry or a tooltip
    { 'aria-pressed': 'false', 'aria-label': 'Problem melden' }, // "report a problem" in German
    { 'aria-pressed': 'false', 'aria-label': 'Turn on captions' },
  ]);
  assert.equal(findHandButton(none), null);
  assert.equal(raiseHand(none), 'unavailable');
  assert.ok(none.nodes.every((n) => n.clicks === 0));
  const disabled = fakeDoc([{ 'aria-pressed': 'false', 'aria-label': 'Raise hand', disabled: true }]);
  assert.equal(raiseHand(disabled), 'unavailable');
  assert.equal(disabled.nodes[0].clicks, 0);
  assert.equal(raiseHand({ querySelectorAll() { throw new Error('page changed'); } }), 'unavailable');
});

test('raise hand is off by default', () => {
  assert.equal(DEFAULT_SETTINGS.raiseHandOnHold, false);
  assert.equal(migrateSettings({ outputMode: 'chat' }).raiseHandOnHold, false);
});

test('update from 0.3.1: a voice output without any voice on the computer goes back to chat', () => {
  assert.equal(voiceOutputWithoutVoice({ outputMode: 'chat+voice' }, []), true);
  assert.equal(voiceOutputWithoutVoice({ outputMode: 'voice' }, []), true);
  assert.equal(voiceOutputWithoutVoice({ outputMode: 'chat' }, []), false);
  assert.equal(voiceOutputWithoutVoice({}, []), false);
  assert.equal(voiceOutputWithoutVoice({ outputMode: 'voice' }, ['en_US-john-medium']), false, 'a downloaded voice: the choice is kept');
});

test('manifest: version of the package, description within the store limit', () => {
  const read = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
  const manifest = read('extension/manifest.json');
  const lock = read('package-lock.json');
  assert.equal(manifest.version, read('package.json').version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.ok(manifest.description.length <= 132, String(manifest.description.length));
  assert.match(manifest.description, /on your device by default\.$/);
});

test('cloud problems are told in calm words, the same shape for each kind', () => {
  for (const text of Object.values(CLOUD_PROBLEM_TEXT)) {
    assert.match(text, /^The cloud .+\. These are basic replies\. You can still write your own\.$/);
    assert.doesNotMatch(text, /safety|check failed|error/i);
  }
});

test('release notes of this version exist and hold nothing provisional', () => {
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const notes = readFileSync(new URL(`../docs/releases/${version}.md`, import.meta.url), 'utf8');
  assert.doesNotMatch(notes, /TO CONFIRM|TODO|TBD|PLANNED|XXX|\?\?\?/);
});
