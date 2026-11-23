import { FALLBACK_REPLIES } from './config.js';

const keyOf = (lines) => lines.map((l) => `${l.speaker || ''}|${l.text}`).join('\n');

/**
 * Runs the suggestion requests of one conversation.
 *
 * - One request at a time and the newest question wins: the request it
 *   replaces is really cancelled (AbortController), not left to finish.
 * - Early start: after a short silence a request may start quietly, on the
 *   device only. Its result is shown when the same question is asked for at
 *   the normal pause, and thrown away if the captions changed first.
 * - A request that gets no answer in `timeoutMs` is cancelled and replaced
 *   by basic replies, so a stalled model never blocks the call.
 *
 * Used by the extension side panel and the hosted demo.
 */
export class SuggestionRunner {
  #run = null; // the request in flight, or a finished early start waiting for its question

  /**
   * @param {object} o
   * @param {() => Promise<object>} o.getEngine resolves with the SuggestionEngine
   * @param {() => object|null} o.peekEngine the engine if it is ready, without waiting
   * @param {(job:object, replies:object[]) => void} [o.onPartial]
   * @param {(job:object, res:object) => void} o.onResult
   * @param {(res:object) => void} [o.onLog] called once for every result that is shown
   * @param {number} [o.timeoutMs]
   */
  constructor({ getEngine, peekEngine, onPartial, onResult, onLog, timeoutMs = 20000 }) {
    Object.assign(this, { getEngine, peekEngine, onPartial, onResult, onLog, timeoutMs });
  }

  /** True while a question that was asked for is waiting for its answer. */
  get busy() {
    return Boolean(this.#run && !this.#run.early && !this.#run.res);
  }

  /**
   * A short silence: start generating without showing anything.
   * Returns false when nothing was started.
   */
  speculate(lines) {
    // Never on the cloud route (cost, and data would leave for a question
    // that may not be asked): only when Gemini Nano is known to be ready.
    if (!this.peekEngine()?.deviceReady) return false;
    // A question someone is waiting on keeps the device.
    if (this.busy) return false;
    this.#stop();
    this.#start(lines, null);
    return true;
  }

  /** The captions changed: an early start no longer matches them. */
  cancelEarly() {
    if (this.#run?.early) this.#stop();
  }

  /** The normal pause (or Alt+S): `job.lines` is the question to answer. */
  request(job) {
    const r = this.#run;
    if (r?.early && r.key === keyOf(job.lines)) {
      // The early start was for this very question: take it over.
      r.early = false;
      r.job = job;
      r.headStartMs = Math.round(performance.now() - r.startedAt);
      if (r.partial) this.onPartial?.(job, r.partial);
      if (r.res) this.#deliver(r);
      return;
    }
    this.#stop();
    this.#start(job.lines, job);
  }

  /** Cancels whatever is running (the call tab went away). */
  abort() {
    this.#stop();
  }

  #stop() {
    const r = this.#run;
    if (!r) return;
    this.#run = null;
    clearTimeout(r.timer);
    r.ctl.abort();
  }

  #start(lines, job) {
    const r = { key: keyOf(lines), early: !job, job, ctl: new AbortController(), startedAt: performance.now(), partial: null, res: null };
    this.#run = r;
    r.timer = setTimeout(() => this.#timeout(r), this.timeoutMs);
    this.#generate(r, lines, !job);
  }

  async #generate(r, lines, deviceOnly) {
    let res;
    try {
      const engine = await this.getEngine();
      if (this.#run !== r) return;
      res = await engine.suggest(lines, {
        signal: r.ctl.signal,
        deviceOnly,
        onPartial: (replies) => {
          r.partial = replies;
          if (this.#run === r && !r.early) this.onPartial?.(r.job, replies);
        },
      });
    } catch (e) {
      console.warn('[Pipe Up] suggestion failed', e);
      res = { replies: FALLBACK_REPLIES, route: 'fallback', reason: String(e?.message || e), error: String(e?.message || e) };
    }
    if (this.#run !== r || res.cancelled) return; // replaced, cancelled or timed out meanwhile
    clearTimeout(r.timer);
    if (res.unavailable) {
      // The device could not answer the early start. If the question has
      // been asked for meanwhile, it now takes the normal route.
      this.#run = null;
      if (!r.early) this.#start(lines, r.job);
      return;
    }
    r.res = res;
    if (!r.early) this.#deliver(r);
  }

  #deliver(r) {
    this.#run = null;
    const res = r.headStartMs != null ? { ...r.res, headStartMs: r.headStartMs } : r.res;
    this.onLog?.(res);
    this.onResult(r.job, res);
  }

  #timeout(r) {
    if (this.#run !== r) return;
    this.#run = null;
    r.ctl.abort();
    if (r.early) return;
    const reason = `No answer after ${this.timeoutMs / 1000} s`;
    const res = { replies: FALLBACK_REPLIES, route: 'fallback', reason, error: reason };
    this.onLog?.(res);
    this.onResult(r.job, res);
  }
}
