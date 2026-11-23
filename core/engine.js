import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';

import { REMOTE_DEFAULTS, FALLBACK_REPLIES } from './config.js';
import { buildPrompt, parseReplies, partialReplies, systemRules, RESPONSE_JSON_SCHEMA } from './prompt.js';
import { retrieveBriefing } from './briefing.js';
import { similarExamples, ignoredSuggestions } from './memory.js';
import { PREP_JSON_SCHEMA, prepRules, planPreparation, buildPrepPrompt, parsePrepared, mergePrepared } from './prepare.js';
import { similarity } from './text.js';

const LANG = [{ type: 'text', languages: ['en'] }];

/**
 * Initializes Firebase, App Check and Remote Config.
 * appCheck: { provider } — an App Check provider built by the caller (the
 *           hosted demo passes reCAPTCHA Enterprise; keeping that import out
 *           of this file keeps remote scripts out of the extension bundle), or
 *           { debugToken } — the extension's locally entered debug token.
 */
export async function initFirebase({ firebaseConfig, appCheck = {} }) {
  const app = initializeApp(firebaseConfig);
  if (appCheck.provider) {
    initializeAppCheck(app, { provider: appCheck.provider, isTokenAutoRefreshEnabled: true });
  } else if (appCheck.debugToken) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheck.debugToken;
    initializeAppCheck(app, {
      provider: new CustomProvider({ getToken: () => Promise.reject(new Error('Debug token only')) }),
      isTokenAutoRefreshEnabled: true,
    });
  }
  const remote = { ...REMOTE_DEFAULTS };
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
    rc.defaultConfig = REMOTE_DEFAULTS;
    await Promise.race([fetchAndActivate(rc), new Promise((r) => setTimeout(r, 2500))]);
    for (const key of Object.keys(REMOTE_DEFAULTS)) {
      const v = getValue(rc, key);
      const def = REMOTE_DEFAULTS[key];
      // A number may be 0 (speculate_ms: 0 turns the early start off); an
      // empty or non-numeric value falls back to the bundled default.
      const num = v.asString().trim() === '' ? NaN : Number(v.asString());
      remote[key] = typeof def === 'number' ? (Number.isFinite(num) ? num : def) : typeof def === 'boolean' ? v.asBoolean() : v.asString() || def;
    }
  } catch (e) {
    console.warn('[Pipe Up] Remote Config unavailable, using bundled defaults', e);
  }
  // Limited-use App Check tokens: each cloud request carries a fresh,
  // single-use token, which protects the Gemini API against replay.
  const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
  return { app, ai, remote };
}

/** Chrome's on-device model status, without triggering a download. */
export async function deviceStatus() {
  const LM = globalThis.LanguageModel;
  if (!LM?.availability) return 'unsupported';
  try {
    return await LM.availability({ expectedInputs: LANG, expectedOutputs: LANG });
  } catch {
    return 'unavailable';
  }
}

const STATUS_WORDS = {
  unsupported: 'not supported by this browser',
  unavailable: 'not available on this computer',
  downloadable: 'not downloaded yet',
  downloading: 'still downloading',
};

const abortError = () => new DOMException('The request was cancelled', 'AbortError');
const isAbort = (e, signal) => Boolean(signal?.aborted) || e?.name === 'AbortError';

export class SuggestionEngine {
  #deviceReady = false; // Gemini Nano answered "available": not asked again until an error
  #tails = {}; // last on-device call per model family, see #onDevice

  /**
   * @param {object} o
   * @param {{ai:any, remote:object}} o.firebase
   * @param {import('./memory.js').MemoryStore} o.memory
   * @param {() => any} o.getBriefing returns the current briefing index
   * @param {() => {cloudConsent:boolean, dontLearn:boolean, shareBriefingWithCloud?:boolean}} o.getSettings
   * @param {(params:object) => any} [o.createModel] tests pass a fake model factory, so the
   *        routing logic runs without Firebase or Gemini Nano
   * @param {() => Promise<string>} [o.getDeviceStatus] same, for Chrome's model status
   */
  constructor({ firebase, memory, getBriefing, getSettings, createModel, getDeviceStatus = deviceStatus }) {
    this.firebase = firebase;
    this.memory = memory;
    this.getBriefing = getBriefing;
    this.getSettings = getSettings;
    this.createModel = createModel || ((params) => getGenerativeModel(firebase.ai, params));
    this.getDeviceStatus = getDeviceStatus;
    this.remote = firebase.remote;
    this.forceCloud = false; // demo switch: simulates a computer without Gemini Nano
    this.maxWords = this.#wantedMaxWords();
    this.#buildModels();
  }

  // Easy reading asks for shorter replies (8 words at most).
  #wantedMaxWords() {
    const base = Number(this.remote.max_words) || 12;
    return this.getSettings?.()?.easyReading ? Math.min(base, 8) : base;
  }

  #buildModels() {
    const rules = systemRules({ maxWords: this.maxWords, variant: String(this.remote.prompt_version || '1') });
    const onDeviceParams = {
      createOptions: {
        expectedInputs: LANG,
        expectedOutputs: LANG,
        // Gemini Nano gets the fixed rules as a system prompt.
        initialPrompts: [{ role: 'system', content: rules }],
      },
      promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA },
    };
    const inCloudParams = {
      model: this.remote.cloud_model,
      systemInstruction: rules,
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        temperature: 0.7,
        maxOutputTokens: 256,
      },
    };
    this.onDeviceParams = onDeviceParams;
    // Three Firebase AI Logic hybrid modes for the live call:
    // - ONLY_ON_DEVICE: the default, nothing leaves the computer;
    // - PREFER_ON_DEVICE: after consent, the SDK picks the cloud when the
    //   device cannot run Gemini Nano;
    // - ONLY_IN_CLOUD: after consent, when Nano is present but failed.
    this.deviceModel = this.createModel({ mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams, inCloudParams });
    this.hybridModel = this.createModel({ mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams });
    this.cloudModel = this.createModel({ mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams });
  }

  // Models for "Prepare for the call", built on first use.
  #buildPrepModels() {
    if (this.prepCloudModel) return;
    const rules = prepRules();
    const onDeviceParams = {
      createOptions: { expectedInputs: LANG, expectedOutputs: LANG, initialPrompts: [{ role: 'system', content: rules }] },
      promptOptions: { responseConstraint: PREP_JSON_SCHEMA },
    };
    const inCloudParams = {
      model: this.remote.cloud_model,
      systemInstruction: rules,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: PREP_JSON_SCHEMA, temperature: 0.2, maxOutputTokens: 2048 },
    };
    this.prepDeviceParams = onDeviceParams;
    // The fourth hybrid mode, for the work done before the call:
    // - PREFER_IN_CLOUD: after an explicit click, a cloud model reads the
    //   whole briefing in one request. If the cloud cannot be reached and
    //   Gemini Nano is there, the SDK does it on the device instead; the
    //   log shows the route that was really taken (inferenceSource).
    this.prepCloudModel = this.createModel({ mode: InferenceMode.PREFER_IN_CLOUD, onDeviceParams, inCloudParams });
    // - ONLY_ON_DEVICE: the same work on Gemini Nano, part by part.
    this.prepDeviceModel = this.createModel({ mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams, inCloudParams });
  }

  /** Must be called from a click: may download Gemini Nano. */
  async prepareDevice(onProgress) {
    await this.deviceModel.initializeDeviceModel(onProgress);
  }

  /**
   * Chrome's status for Gemini Nano. Once it is "available" the answer is
   * kept, to save one availability() call per request, until a device call
   * fails. (The SDK still makes its own check before each on-device call.)
   */
  async #status() {
    if (this.forceCloud) return 'unavailable';
    if (this.#deviceReady) return 'available';
    const status = await this.getDeviceStatus();
    this.#deviceReady = status === 'available';
    return status;
  }

  /** True when the next request is known to run on Gemini Nano. */
  get deviceReady() {
    return this.#deviceReady && !this.forceCloud;
  }

  /**
   * Runs one call that may use Gemini Nano, with a way to cancel it.
   * The SDK hands `promptOptions` to Gemini Nano and keeps the params object
   * we gave it, so the signal placed there is the one the prompt listens to.
   * It reads it late (after creating a session), so calls of one family run
   * strictly one after the other: a cancelled call ends before the next one
   * places its own signal.
   */
  async #onDevice(family, params, signal, call) {
    const before = this.#tails[family];
    let release;
    this.#tails[family] = new Promise((r) => (release = r));
    try {
      await before;
      if (signal?.aborted) throw abortError();
      params.promptOptions = { ...params.promptOptions, signal };
      return await call();
    } finally {
      release();
    }
  }

  /**
   * Loads Gemini Nano into memory before the first real question, so the
   * first suggestion takes seconds instead of ~20 s. Never uses the cloud.
   */
  async warmUp() {
    if (this.warmed || (await this.#status()) !== 'available') return;
    this.warmed = true;
    const prompt = buildPrompt({ lines: [{ speaker: 'Other person', text: 'Hello, can you hear me?' }] });
    try {
      await this.#onDevice('suggest', this.onDeviceParams, undefined, () => this.deviceModel.generateContent(prompt));
    } catch {
      this.warmed = false;
      this.#deviceReady = false;
    }
  }

  cloudAllowed() {
    return Boolean(this.getSettings().cloudConsent && this.remote.cloud_enabled);
  }

  /** Streams one request and returns the parsed replies and the real route. */
  async #run(model, prompt, { hasBriefing, onPartial, signal, mayUseDevice }) {
    const stream = async () => {
      // Cloud requests are cancelled through the request options.
      const { stream, response } = await model.generateContentStream(prompt, signal ? { signal } : undefined);
      // A cancelled stream also rejects `response`: the loop below reports it.
      response.catch(() => {});
      let buf = '';
      let shown = 0;
      for await (const chunk of stream) {
        buf += chunk.text();
        const partial = partialReplies(buf);
        if (onPartial && partial.length > shown) {
          shown = partial.length;
          onPartial(partial);
        }
      }
      if (signal?.aborted) throw abortError();
      const final = await response;
      return {
        replies: parseReplies(buf, { maxWords: this.maxWords, hasBriefing }),
        route: final.inferenceSource === InferenceSource.IN_CLOUD ? 'in_cloud' : 'on_device',
      };
    };
    return mayUseDevice ? this.#onDevice('suggest', this.onDeviceParams, signal, stream) : stream();
  }

  /**
   * "Prepare for the call": turns the briefing into likely questions with a
   * short answer each.
   * - target 'cloud': one request in PREFER_IN_CLOUD mode. The caller asks
   *   for an explicit confirmation first; the standing cloud settings are
   *   neither needed nor changed. The Remote Config kill switch applies.
   * - target 'device': Gemini Nano, one request per part of the briefing.
   * @param {object} briefing the saved briefing (positions, notes, documentText)
   * @param {object} o
   * @param {'cloud'|'device'} o.target
   * @param {(done:number, total:number) => void} [o.onProgress]
   * @param {AbortSignal} [o.signal]
   * @returns {Promise<{items:Array<{question:string,answer:string}>, route:string, ms:number, words:number, total:number, shortened:boolean, parts:number, dropped:number}>}
   * @throws {Error} with `code`: 'empty' | 'cloud-off' | 'no-device' | 'cancelled' | 'failed'
   */
  async prepare(briefing, { target, onProgress, signal } = {}) {
    const t0 = performance.now();
    const fail = (code, message) => Object.assign(new Error(message), { code });
    const plan = planPreparation(briefing, target);
    if (!plan.parts.length) throw fail('empty', 'The briefing is empty');
    if (target === 'cloud' && !this.remote.cloud_enabled) throw fail('cloud-off', 'The cloud is switched off');
    if (target === 'device' && (await this.#status()) !== 'available') throw fail('no-device', 'Gemini Nano is not available');
    this.#buildPrepModels();
    const model = target === 'cloud' ? this.prepCloudModel : this.prepDeviceModel;
    const lists = [];
    let dropped = 0;
    let route = null;
    let lastError = null;
    for (const [i, text] of plan.parts.entries()) {
      const part = plan.parts.length > 1 ? { index: i + 1, count: plan.parts.length } : null;
      const prompt = buildPrepPrompt(text, { maxItems: plan.perPart, part });
      try {
        // Both models may run on Gemini Nano (PREFER_IN_CLOUD falls back to
        // it), so the signal is given both ways.
        const { response } = await this.#onDevice('prepare', this.prepDeviceParams, signal, () => model.generateContent(prompt, signal ? { signal } : undefined));
        route = response.inferenceSource === InferenceSource.IN_CLOUD ? 'in_cloud' : 'on_device';
        const parsed = parsePrepared(response.text(), { maxItems: plan.perPart, briefing: text });
        if (parsed) {
          lists.push(parsed.items);
          dropped += parsed.dropped;
        } else {
          lastError = new Error('unreadable answer');
        }
      } catch (e) {
        if (isAbort(e, signal)) throw fail('cancelled', 'Preparation stopped');
        if (target === 'device') this.#deviceReady = false;
        lastError = e;
      }
      onProgress?.(i + 1, plan.parts.length);
    }
    if (!lists.length) throw Object.assign(fail('failed', String(lastError?.message || lastError)), { cause: lastError });
    return {
      items: mergePrepared(lists),
      route,
      ms: Math.round(performance.now() - t0),
      words: plan.words,
      total: plan.total,
      shortened: plan.shortened,
      parts: plan.parts.length,
      dropped,
    };
  }

  /**
   * @param {Array<{speaker?:string,text:string}>} lines recent captions, last = what was just said
   * @param {object} [opts]
   * @param {(replies:Array<{text:string,source:string}>) => void} [opts.onPartial]
   * @param {AbortSignal} [opts.signal] cancels the request, on device and in the cloud
   * @param {boolean} [opts.deviceOnly] early start: Gemini Nano or nothing, never the cloud
   * @returns {Promise<{replies:Array<{text:string,source:string}>, route:string, reason:string, ms:number, hasBriefing:boolean, error?:string, cancelled?:boolean, unavailable?:boolean}>}
   */
  async suggest(lines, { onPartial, signal, deviceOnly = false } = {}) {
    const t0 = performance.now();
    const utterance = lines.at(-1)?.text || '';
    const settings = this.getSettings();
    const wanted = this.#wantedMaxWords();
    if (wanted !== this.maxWords) {
      this.maxWords = wanted;
      this.#buildModels();
    }
    const events = settings.dontLearn ? [] : await this.memory.all();
    const briefing = retrieveBriefing(this.getBriefing(), utterance, { maxChunks: Number(this.remote.briefing_chunks) || 2 });
    const hasBriefing = Boolean(briefing.chunks.length || briefing.positions.length || briefing.prepared.length);
    // The answer the user prepared for this question, if one matches. It
    // never leaves the computer unless briefing sharing is on.
    const prepared = briefing.prepared[0] || null;
    const fromPrepared = (r) => similarity(r.text, prepared.answer) >= 0.5;
    // A reply that says the prepared answer is from the briefing, whatever
    // label the model gave it.
    const tagged = (replies) => (prepared ? replies.map((r) => (fromPrepared(r) ? { ...r, source: 'briefing' } : r)) : replies);
    // No model may read the briefing here: the prepared answer is offered as
    // it is, ahead of the other replies. This is a lookup on this computer.
    const preparedFirst = (replies) =>
      prepared ? [{ text: prepared.answer, source: 'briefing' }, ...replies.filter((r) => !fromPrepared(r))].slice(0, 3) : replies;
    const basic = () => (prepared ? preparedFirst(FALLBACK_REPLIES.slice(1)) : FALLBACK_REPLIES);
    const basicWords = prepared ? 'your prepared answer and basic replies' : 'basic replies';

    const done = (replies, route, reason, usedBriefing, error) => ({
      replies,
      route,
      reason,
      ms: Math.round(performance.now() - t0),
      hasBriefing: Boolean(usedBriefing),
      // True when a reply says what the user prepared for this question.
      usedPrepared: Boolean(prepared && replies.some((r) => r.source === 'briefing' && fromPrepared(r))),
      error,
    });
    // A cancelled request is a normal outcome, not an error: nothing is
    // shown and nothing falls back to the cloud because of it.
    const cancelled = () => ({ ...done([], 'cancelled', 'Replaced by a newer question', false), cancelled: true });

    const status = await this.#status();
    if (signal?.aborted) return cancelled();
    let deviceProblem = `Gemini Nano ${STATUS_WORDS[status] || status}`;
    if (status === 'available') {
      const prompt = buildPrompt({
        lines,
        briefing,
        examples: similarExamples(events, utterance, Number(this.remote.examples_k) || 3),
        avoid: ignoredSuggestions(events, utterance),
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await this.#run(this.deviceModel, prompt, { hasBriefing, onPartial, signal, mayUseDevice: true });
          if (r.replies) return done(tagged(r.replies), r.route, 'Gemini Nano on this computer', hasBriefing);
          deviceProblem = 'Gemini Nano gave an unreadable answer';
        } catch (e) {
          if (isAbort(e, signal)) return cancelled();
          this.#deviceReady = false; // ask Chrome again before the next request
          deviceProblem = 'Gemini Nano error: ' + (e?.message || e);
          break;
        }
      }
    }
    if (deviceOnly) return { ...done([], 'none', deviceProblem, false), unavailable: true };
    if (!this.cloudAllowed()) {
      const why = this.remote.cloud_enabled ? 'cloud not allowed' : 'cloud switched off';
      return done(basic(), status === 'available' ? 'fallback' : 'blocked', `${deviceProblem}; ${why}: ${basicWords}`, Boolean(prepared));
    }

    // Cloud path: personal history is never sent; briefing excerpts (and a
    // matching prepared answer) only if the user turned on the separate option.
    const share = Boolean(settings.shareBriefingWithCloud);
    const cloudPrompt = buildPrompt({ lines: lines.slice(-2), briefing: share ? briefing : { chunks: [], positions: [], prepared: [] } });
    // Without sharing, the prepared answer is added here, after the cloud
    // answered: shown first from the start so the cards do not move.
    const local = !share && prepared ? preparedFirst : (replies) => replies;
    const cloudPartial = onPartial && ((replies) => onPartial(local(replies)));
    if (!share && prepared) onPartial?.(local([]));
    // Nano present but failed: force the cloud. Otherwise let the SDK's
    // PREFER_ON_DEVICE mode decide (it picks the cloud when Nano is missing).
    const forced = status === 'available' || this.forceCloud;
    const model = forced ? this.cloudModel : this.hybridModel;
    const sent = share && hasBriefing ? 'last 2 caption lines and briefing excerpts sent' : 'last 2 caption lines sent';
    try {
      const r = await this.#run(model, cloudPrompt, { hasBriefing: share && hasBriefing, onPartial: cloudPartial, signal, mayUseDevice: !forced });
      if (r.replies) {
        const where = r.route === 'in_cloud' ? `cloud, ${sent}` : 'on this computer';
        const added = !share && prepared ? '; your prepared answer was added on this computer' : '';
        return done(share ? tagged(r.replies) : local(r.replies), r.route, `${deviceProblem}; ${where}${added}`, (share && hasBriefing) || Boolean(prepared));
      }
      return done(basic(), 'fallback', `${deviceProblem}; cloud answer unreadable: ${basicWords}`, Boolean(prepared));
    } catch (e) {
      if (isAbort(e, signal)) return cancelled();
      return done(basic(), 'fallback', `${deviceProblem}; cloud error: ${basicWords}`, Boolean(prepared), String(e?.message || e));
    }
  }
}
