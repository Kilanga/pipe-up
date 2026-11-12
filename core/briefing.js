import { rank } from './text.js';

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

/**
 * @param {{notes?:string, documentText?:string, documentName?:string, positions?:string}} b
 */
export function buildBriefingIndex(b = {}) {
  const chunks = [
    ...chunkText(b.notes, 'notes'),
    ...chunkText(b.documentText, b.documentName ? `doc:${b.documentName}` : 'doc'),
  ];
  return { chunks, positions: splitPositions(b.positions) };
}

/**
 * Picks the briefing material relevant to what was just said.
 * Positions that match are always included first.
 */
export function retrieveBriefing(index, utterance, { maxChunks = 2, maxPositions = 3, minScore = 0.08 } = {}) {
  if (!index) return { chunks: [], positions: [] };
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
  return { chunks, positions };
}
