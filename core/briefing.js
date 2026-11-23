import { rank, overlap } from './text.js';

// A briefing is what the user prepared before the call: typed notes,
// an uploaded document, or both, plus a short list of "my positions".

const CHUNK_WORDS = 120; // small chunks keep the on-device prompt short

/**
 * Splits text into chunks of roughly CHUNK_WORDS words, on paragraph or
 * sentence boundaries when possible.
 */
export function chunkText(text, source, maxWords = CHUNK_WORDS) {
  const paragraphs = String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z0-9À-Ý])/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const chunks = [];
  let current = [];
  let count = 0;
  for (const p of paragraphs) {
    const words = p.split(' ').length;
    if (count + words > maxWords && current.length) {
      chunks.push(current.join(' '));
      current = [];
      count = 0;
    }
    if (words > maxWords) {
      const ws = p.split(' ');
      for (let i = 0; i < ws.length; i += maxWords) chunks.push(ws.slice(i, i + maxWords).join(' '));
      continue;
    }
    current.push(p);
    count += words;
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks.map((text, i) => ({ id: `${source}-${i}`, source, text }));
}

export function splitPositions(text) {
  return String(text || '')
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

// Prepared answers ("Prepare for the call"): up to 6 come from a model, the
// user can edit them and add their own.
export const PREPARED_LIMITS = { max: 12, questionChars: 200, answerChars: 300 };

/** The prepared answers that can be used: both fields filled, bounded. */
export function cleanPrepared(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((q) => ({
      question: String(q?.question || '').replace(/\s+/g, ' ').trim().slice(0, PREPARED_LIMITS.questionChars),
      answer: String(q?.answer || '').replace(/\s+/g, ' ').trim().slice(0, PREPARED_LIMITS.answerChars),
    }))
    .filter((q) => q.question && q.answer)
    .slice(0, PREPARED_LIMITS.max);
}

/**
 * @param {{notes?:string, documentText?:string, documentName?:string, positions?:string, prepared?:Array<{question:string,answer:string}>}} b
 */
export function buildBriefingIndex(b = {}) {
  const chunks = [
    ...chunkText(b.notes, 'notes'),
    ...chunkText(b.documentText, b.documentName ? `doc:${b.documentName}` : 'doc'),
  ];
  return { chunks, positions: splitPositions(b.positions), prepared: cleanPrepared(b.prepared) };
}

/**
 * The prepared answer whose question is close to what was just said, if any.
 * Same lexical ranking as the rest of the briefing, with a higher bar: a
 * prepared answer is offered almost as it is, so the match must be clear.
 */
export function matchPrepared(prepared, utterance, minScore = 0.3) {
  if (!prepared?.length) return null;
  const docs = prepared.map((q, id) => ({ id, text: q.question }));
  // A caption block can hold a whole turn ("Morning everyone. Sam, can you
  // …?"): the question is one of its last sentences, so each is tried too.
  const sentences = String(utterance || '').split(/(?<=[.!?…])\s+/).filter(Boolean).slice(-3);
  let best = null;
  for (const text of new Set([utterance, ...sentences])) {
    const top = rank(text, docs)[0];
    if (top && (!best || top.score > best.score)) best = top;
  }
  return best && best.score >= minScore ? prepared[best.id] : null;
}

/**
 * Picks the briefing material relevant to what was just said.
 * Positions that match are always included first. A matching prepared
 * answer takes the place of one excerpt, so the prompt does not grow.
 */
export function retrieveBriefing(index, utterance, { maxChunks = 2, maxPositions = 3, minScore = 0.08 } = {}) {
  if (!index) return { chunks: [], positions: [], prepared: [] };
  const match = matchPrepared(index.prepared, utterance);
  const prepared = match ? [match] : [];
  maxChunks = Math.max(0, maxChunks - prepared.length);
  const posDocs = index.positions.map((text, i) => ({ id: i, text }));
  const positions = rank(utterance, posDocs)
    .filter((r) => r.score >= minScore)
    .slice(0, maxPositions)
    .map((r) => index.positions[r.id]);
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const chunks = rank(utterance, index.chunks)
    .filter((r) => r.score >= minScore)
    .slice(0, maxChunks)
    .map((r) => byId.get(r.id));
  return { chunks, positions, prepared };
}

/** The texts of a retrieved briefing, as they are given to a model. */
export function briefingTexts(b) {
  return [...(b?.positions || []), ...(b?.prepared || []).map((q) => q.answer), ...(b?.chunks || []).map((c) => c.text)];
}

/**
 * True when a reply really draws on one of these briefing texts: at least
 * two key words in common, and at least half of the reply's key words.
 * A model's own "this comes from the briefing" is not taken on trust.
 */
export function restsOnBriefing(reply, texts) {
  return texts.some((t) => {
    const { shared, ratio } = overlap(reply, t);
    return shared >= 2 && ratio >= 0.5;
  });
}
