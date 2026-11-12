import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank, tokenize } from '../core/text.js';
import { buildBriefingIndex, retrieveBriefing, chunkText } from '../core/briefing.js';
import { MemoryStore, makeEvent, similarExamples, ignoredSuggestions, adoptionRate, LIMITS } from '../core/memory.js';
import { buildPrompt, parseReplies } from '../core/prompt.js';

test('tokenize drops stopwords and stems plurals', () => {
  assert.deepEqual(tokenize('The contracts are signed!'), ['contract', 'signed']);
});

test('rank finds the closest document', () => {
  const r = rank('vendor contract update', [
    { id: 'a', text: 'Lunch plans for Friday' },
    { id: 'b', text: 'The vendor contract is signed except one clause' },
  ]);
  assert.equal(r[0].id, 'b');
  assert.equal(r.length, 1);
});

test('briefing: positions first, relevant chunks only', () => {
  const idx = buildBriefingIndex({
    positions: '- I want to keep the March deadline.\n- I am against a second vendor.',
    notes: 'Vendor contract signed except the penalty clause.\n\nTeam lunch is on Thursday.',
  });
  const r = retrieveBriefing(idx, 'Is the March deadline still realistic?');
  assert.deepEqual(r.positions, ['I want to keep the March deadline.']);
  const r2 = retrieveBriefing(idx, 'Any news on the vendor contract?');
  assert.ok(r2.chunks[0].text.includes('penalty clause'));
});

test('chunkText splits long text into bounded chunks', () => {
  const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkText(long, 'doc', 120);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.text.split(' ').length <= 120));
});

test('memory: similar examples come from answers only', async () => {
  const m = new MemoryStore();
  await m.add(makeEvent({ context: 'Can you share the vendor contract status?', action: 'picked', reply: 'Signed, except the penalty clause.', shown: ['a', 'b', 'c'], choice: 1 }));
  await m.add(makeEvent({ context: 'Vendor contract?', action: 'dismissed', shown: ['x', 'y', 'z'] }));
  await m.add(makeEvent({ context: 'How was your weekend?', action: 'spoke', reply: 'Great, thanks!' }));
  const ex = similarExamples(await m.all(), 'What is the status of the vendor contract?');
  assert.equal(ex.length, 1);
  assert.equal(ex[0].reply, 'Signed, except the penalty clause.');
});

test('memory: ignored suggestions in a similar context are avoided', async () => {
  const events = [makeEvent({ context: 'Is the March deadline realistic?', action: 'picked', reply: 'Yes', shown: ['Yes', 'Maybe later', 'No idea'], choice: 1 })];
  const avoid = ignoredSuggestions(events, 'Is the March deadline realistic?');
  assert.deepEqual(avoid.sort(), ['Maybe later', 'No idea']);
});

test('memory: retention and cap', async () => {
  const m = new MemoryStore();
  const old = makeEvent({ context: 'old', action: 'typed', reply: 'x', now: Date.now() - (LIMITS.retentionDays + 1) * 86400000 });
  await m.add(old);
  assert.equal((await m.all()).length, 0);
  for (let i = 0; i < LIMITS.maxEvents + 5; i++) await m.add(makeEvent({ context: 'c' + i, action: 'typed', reply: 'r' }));
  assert.equal((await m.all()).length, LIMITS.maxEvents);
});

test('adoption rate counts picked suggestions', () => {
  const ev = [
    makeEvent({ context: 'a', action: 'picked', reply: 'x', shown: ['x', 'y', 'z'], choice: 1 }),
    makeEvent({ context: 'b', action: 'spoke', shown: ['x', 'y', 'z'] }),
  ];
  assert.equal(adoptionRate(ev), 0.5);
});

test('prompt contains rules, briefing and conversation', () => {
  const p = buildPrompt({
    lines: [{ speaker: 'Maya', text: 'Update on the contract?' }],
    briefing: { positions: ['Signed except one clause.'], chunks: [] },
    examples: [{ context: 'Status?', reply: 'On track.' }],
    maxWords: 12,
  });
  assert.match(p, /At most 12 words/);
  assert.match(p, /MY POSITIONS/);
  assert.match(p, /Maya: Update on the contract\?/);
  assert.match(p, /Never invent facts/);
});

test('parseReplies reads JSON, dedupes and labels sources', () => {
  const raw = JSON.stringify({
    replies: [
      { text: 'It is signed, except the penalty clause.', source: 'briefing' },
      { text: 'Could you clarify which contract?', source: 'general' },
      { text: 'Could you clarify which contract?', source: 'general' },
      { text: 'Let me check and get back to you.', source: 'general' },
    ],
  });
  const r = parseReplies(raw, { hasBriefing: true });
  assert.equal(r.length, 3);
  assert.equal(r[0].source, 'briefing');
});

test('parseReplies: no briefing means no briefing label', () => {
  const r = parseReplies('{"replies":[{"text":"Yes","source":"briefing"},{"text":"No","source":"general"}]}', { hasBriefing: false });
  assert.equal(r[0].source, 'general');
});

test('parseReplies falls back to plain lines', () => {
  const r = parseReplies('1. Sounds good.\n2. Can you repeat?\n3. Let me check.');
  assert.deepEqual(r.map((x) => x.text), ['Sounds good.', 'Can you repeat?', 'Let me check.']);
});

test('parseReplies rejects unusable output', () => {
  assert.equal(parseReplies(''), null);
  assert.equal(parseReplies('{"replies":[]}'), null);
});
