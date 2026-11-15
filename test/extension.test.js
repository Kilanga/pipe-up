import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSelf, setMyName, recentLines } from '../extension/src/meet-captions.js';
import { migrateSettings, DEFAULT_SETTINGS } from '../core/config.js';

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
