import { rank, tokenize } from './text.js';

// Local learning: every reply the user picks or types is stored on the
// device and the closest ones become examples in the prompt.
// Nothing here ever leaves the device.
//
// What was said in the call is not stored: of the line being answered, only
// a few key words are kept (lower case, common words removed), which is all
// the lookup needs. The line can be a colleague's or, in on-demand mode, the
// user's own.

export const ACTIONS = {
  PICKED: 'picked', // chose suggestion 1, 2 or 3
  EDITED: 'edited', // chose a suggestion, then changed it before sending
  TYPED: 'typed', // wrote their own reply
  SPOKE: 'spoke', // key 4: answered by voice themselves
  FILLER: 'filler', // used a filler phrase ("One moment, please")
  DISMISSED: 'dismissed', // Esc on all suggestions
};

export const LIMITS = { maxEvents: 500, retentionDays: 90, contextChars: 300, keyWords: 20, keyWordChars: 24 };

// A key word is a word: bounded, and not a number. A token that is mostly
// digits (a phone or account number, an amount) is not kept.
const isKeyWord = (w) => typeof w === 'string' && w.length > 0 && (w.match(/\d/g) || []).length * 2 <= w.length;
const cleanKeys = (words) => [...new Set(words.filter(isKeyWord).map((w) => w.slice(0, LIMITS.keyWordChars)))].slice(0, LIMITS.keyWords);

/** The key words kept from the line being answered: no sentence, no order of speech beyond these words. */
export function keyWords(context) {
  return cleanKeys(tokenize(String(context || '').slice(0, LIMITS.contextChars)));
}

export function makeEvent({ context, action, reply = '', shown = [], choice = null, now = Date.now() }) {
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    keys: keyWords(context),
    action,
    reply: String(reply || '').slice(0, 300),
    shown: shown.slice(0, 3).map((s) => String(s).slice(0, 200)),
    choice,
  };
}

/**
 * Entries saved by versions up to 0.3.1 held the sentence being answered.
 * It is replaced by its key words. Key words stored before 0.4.0 are brought
 * to today's rules (bounded, no numbers). Returns true when the entry changed.
 */
export function migrateEvent(e) {
  const keys = Array.isArray(e.keys) ? cleanKeys(e.keys) : keyWords(e.context);
  if (Array.isArray(e.keys) && !('context' in e) && keys.length === e.keys.length && keys.every((k, i) => k === e.keys[i])) return false;
  e.keys = keys;
  delete e.context;
  return true;
}

/** In-memory store, used by tests and as the base for persistent stores. */
export class MemoryStore {
  constructor(events = []) {
    this.events = events;
    this.events.forEach(migrateEvent);
    this.prune(); // the limits also apply to what is loaded, not only on write
  }
  async all() {
    return [...this.events];
  }
  async add(event) {
    this.events.push(event);
    this.prune();
  }
  async remove(id) {
    this.events = this.events.filter((e) => e.id !== id);
  }
  async clear() {
    this.events = [];
  }
  prune(now = Date.now()) {
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
    // One connection for the life of the page, instead of one per transaction.
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('events', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
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
  // On load: old entries lose their sentence, and entries past the limits
  // (90 days, 500) are deleted from the disk too, not only hidden.
  async #load() {
    const stored = (await this.#tx('readonly', (s) => s.getAll())) || [];
    this.events = stored.sort((a, b) => a.ts - b.ts);
    const changed = this.events.filter(migrateEvent);
    this.prune();
    const kept = new Set(this.events.map((e) => e.id));
    const gone = stored.filter((e) => !kept.has(e.id));
    if (!changed.length && !gone.length) return;
    await this.#tx('readwrite', (s) => {
      for (const e of changed) if (kept.has(e.id)) s.put(e);
      for (const e of gone) s.delete(e.id);
    });
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

const ANSWERS = new Set([ACTIONS.PICKED, ACTIONS.EDITED, ACTIONS.TYPED, ACTIONS.SPOKE]);

/** The k past replies whose key words are closest to what was just said. */
export function similarExamples(events, utterance, k = 3, minScore = 0.1) {
  const usable = events.filter((e) => ANSWERS.has(e.action) && e.reply);
  const byId = new Map(usable.map((e) => [e.id, e]));
  return rank(
    utterance,
    usable.map((e) => ({ id: e.id, tokens: e.keys || [] }))
  )
    .filter((r) => r.score >= minScore)
    .slice(0, k)
    .map((r) => ({ keys: byId.get(r.id).keys, reply: byId.get(r.id).reply }));
}

/** Suggestions the user already ignored in a very similar context. */
export function ignoredSuggestions(events, utterance, threshold = 0.6) {
  const out = new Set();
  for (const e of events) {
    if (!e.shown?.length || (rank(utterance, [{ id: 0, tokens: e.keys || [] }])[0]?.score || 0) < threshold) continue;
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
