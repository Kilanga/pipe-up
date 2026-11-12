import { rank, similarity } from './text.js';

// Local learning: every reply the user picks, types or says themselves is
// stored on the device and the closest ones become examples in the prompt.
// Nothing here ever leaves the device.

export const ACTIONS = {
  PICKED: 'picked', // chose suggestion 1, 2 or 3
  TYPED: 'typed', // wrote their own reply
  SPOKE: 'spoke', // key 4: answered by voice themselves
  FILLER: 'filler', // used a filler phrase ("One moment, please")
  DISMISSED: 'dismissed', // Esc on all suggestions
};

export const LIMITS = { maxEvents: 500, retentionDays: 90, contextChars: 300 };

export function makeEvent({ context, action, reply = '', shown = [], choice = null, now = Date.now() }) {
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    context: String(context || '').slice(0, LIMITS.contextChars),
    action,
    reply: String(reply || '').slice(0, 300),
    shown: shown.slice(0, 3).map((s) => String(s).slice(0, 200)),
    choice,
  };
}

/** In-memory store, used by tests and as the base for persistent stores. */
export class MemoryStore {
  constructor(events = []) {
    this.events = events;
  }
  async all() {
    return [...this.events];
  }
  async add(event) {
    this.events.push(event);
    await this.prune();
  }
  async remove(id) {
    this.events = this.events.filter((e) => e.id !== id);
  }
  async clear() {
    this.events = [];
  }
  async prune(now = Date.now()) {
    const cutoff = now - LIMITS.retentionDays * 86400000;
    this.events = this.events.filter((e) => e.ts >= cutoff).slice(-LIMITS.maxEvents);
  }
}

/** IndexedDB-backed store for the extension and the demo page. */
export class IdbMemoryStore extends MemoryStore {
  constructor(dbName = 'pipe-up') {
    super([]);
    this.dbName = dbName;
    this.ready = this.#load();
  }
  #open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('events', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', mode);
      const out = fn(tx.objectStore('events'));
      tx.oncomplete = () => resolve(out?.result ?? out);
      tx.onerror = () => reject(tx.error);
    });
  }
  async #load() {
    const req = await this.#tx('readonly', (s) => s.getAll());
    this.events = (req || []).sort((a, b) => a.ts - b.ts);
  }
  async all() {
    await this.ready;
    return super.all();
  }
  async add(event) {
    await this.ready;
    const before = new Set(this.events.map((e) => e.id));
    await super.add(event);
    const after = new Set(this.events.map((e) => e.id));
    await this.#tx('readwrite', (s) => {
      s.put(event);
      for (const id of before) if (!after.has(id)) s.delete(id);
    });
  }
  async remove(id) {
    await this.ready;
    await super.remove(id);
    await this.#tx('readwrite', (s) => s.delete(id));
  }
  async clear() {
    await this.ready;
    await super.clear();
    await this.#tx('readwrite', (s) => s.clear());
  }
}

const ANSWERS = new Set([ACTIONS.PICKED, ACTIONS.TYPED, ACTIONS.SPOKE]);

/** The k past replies whose context is closest to what was just said. */
export function similarExamples(events, utterance, k = 3, minScore = 0.1) {
  const usable = events.filter((e) => ANSWERS.has(e.action) && e.reply);
  const byId = new Map(usable.map((e) => [e.id, e]));
  return rank(
    utterance,
    usable.map((e) => ({ id: e.id, text: e.context }))
  )
    .filter((r) => r.score >= minScore)
    .slice(0, k)
    .map((r) => ({ context: byId.get(r.id).context, reply: byId.get(r.id).reply }));
}

/** Suggestions the user already ignored in a very similar context. */
export function ignoredSuggestions(events, utterance, threshold = 0.6) {
  const out = new Set();
  for (const e of events) {
    if (!e.shown?.length || similarity(utterance, e.context) < threshold) continue;
    e.shown.forEach((s, i) => {
      if (e.choice !== i + 1 && s !== e.reply) out.add(s);
    });
  }
  return [...out];
}

export function adoptionRate(events) {
  const withSuggestions = events.filter((e) => e.shown?.length);
  if (!withSuggestions.length) return null;
  return withSuggestions.filter((e) => e.action === ACTIONS.PICKED).length / withSuggestions.length;
}
