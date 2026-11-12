import { wordCount } from './text.js';

export const PROMPT_VERSION = '1';

// JSON schema shared by the on-device model (responseConstraint) and the
// cloud model (responseSchema), so both paths return the same shape.
export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    replies: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          source: { type: 'string', enum: ['briefing', 'general'] },
        },
        required: ['text', 'source'],
      },
    },
  },
  required: ['replies'],
};

/**
 * Builds the single-turn prompt. Gemini Nano only accepts one request at a
 * time in hybrid mode, so everything the model needs is in this one text.
 */
export function buildPrompt({
  lines = [],
  briefing = { chunks: [], positions: [] },
  examples = [],
  avoid = [],
  maxWords = 12,
}) {
  const transcript = lines
    .slice(-3)
    .map((l) => `${l.speaker || 'Other person'}: ${l.text}`)
    .join('\n');
  const parts = [
    `You help a person with a speech difference take part in a live video call.`,
    `Suggest exactly 3 short replies that THEY could say next, in the first person.`,
    ``,
    `Rules:`,
    `- At most ${maxWords} words per reply. Plain, natural, spoken language.`,
    `- Reply in the same language as the other person's last line.`,
    `- Make the 3 replies different: one that answers, one that asks a short follow-up or clarification, one that is neutral or buys time.`,
    `- Never invent facts, numbers, dates, names, opinions or commitments. Only use what is in MY POSITIONS or BRIEFING.`,
    `- If MY POSITIONS and BRIEFING do not cover the question, stay neutral (for example "Let me check and get back to you").`,
    `- Mark a reply with source "briefing" only if it uses MY POSITIONS or BRIEFING; otherwise "general".`,
    `- No medical or therapy vocabulary.`,
  ];
  if (briefing.positions?.length) {
    parts.push('', 'MY POSITIONS (highest priority):', ...briefing.positions.map((p) => `- ${p}`));
  }
  if (briefing.chunks?.length) {
    parts.push('', 'BRIEFING (excerpts the person prepared):', ...briefing.chunks.map((c) => `- ${c.text}`));
  }
  if (examples.length) {
    parts.push(
      '',
      'PAST REPLIES (match this person\'s style and wording):',
      ...examples.map((e) => `- When told "${e.context}", they replied "${e.reply}"`)
    );
  }
  if (avoid.length) {
    parts.push('', 'Do not suggest these again (the person ignored them):', ...avoid.slice(0, 5).map((a) => `- ${a}`));
  }
  parts.push('', 'CONVERSATION (most recent last):', transcript || '(nothing yet)', '', 'Answer with JSON only.');
  return parts.join('\n');
}

/**
 * Parses and validates the model output. Accepts JSON (preferred) or, as a
 * fallback, three plain lines. Returns null when the output is unusable.
 */
export function parseReplies(raw, { maxWords = 12, hasBriefing = false } = {}) {
  if (!raw) return null;
  let items = null;
  const text = String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const data = JSON.parse(text);
    items = Array.isArray(data) ? data : data.replies;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        items = JSON.parse(match[0]).replies;
      } catch {
        /* fall through */
      }
    }
    if (!items) {
      items = text
        .split('\n')
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^"|"$/g, '').trim())
        .filter(Boolean)
        .map((t) => ({ text: t, source: 'general' }));
    }
  }
  if (!Array.isArray(items)) return null;
  const seen = new Set();
  const replies = [];
  for (const it of items) {
    const t = String(typeof it === 'string' ? it : it?.text || '')
      .replace(/\s+/g, ' ')
      .replace(/^["“]|["”]$/g, '')
      .trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    const words = t.split(' ');
    const clipped = words.length > maxWords + 4 ? words.slice(0, maxWords).join(' ') + '…' : t;
    seen.add(t.toLowerCase());
    replies.push({
      text: clipped,
      source: hasBriefing && it?.source === 'briefing' ? 'briefing' : 'general',
    });
    if (replies.length === 3) break;
  }
  return replies.length >= 2 ? replies : null;
}

export function isShort(text, maxWords) {
  return wordCount(text) <= maxWords;
}
