import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';

import { REMOTE_DEFAULTS, FALLBACK_REPLIES } from './config.js';
import { buildPrompt, parseReplies, partialReplies, systemRules, RESPONSE_JSON_SCHEMA } from './prompt.js';
import { retrieveBriefing } from './briefing.js';
import { similarExamples, ignoredSuggestions } from './memory.js';

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

  /** Must be called from a click: may download Gemini Nano. */
  async prepareDevice(onProgress) {
    await this.deviceModel.initializeDeviceModel(onProgress);
  }

  /**
   * Chrome's status for Gemini Nano. Asked once per request before; now the
   * answer "available" is kept until a device call fails.
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
    const done = (replies, route, reason, usedBriefing, error) => ({
      replies,
      route,
      reason,
      ms: Math.round(performance.now() - t0),
      hasBriefing: Boolean(usedBriefing),
      error,
    });
    // A cancelled request is a normal outcome, not an error: nothing is
    // shown and nothing falls back to the cloud because of it.
    const cancelled = () => ({ ...done([], 'cancelled', 'Replaced by a newer question', false), cancelled: true });

    const events = settings.dontLearn ? [] : await this.memory.all();
    const briefing = retrieveBriefing(this.getBriefing(), utterance, { maxChunks: Number(this.remote.briefing_chunks) || 2 });
    const hasBriefing = Boolean(briefing.chunks.length || briefing.positions.length);

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
          if (r.replies) return done(r.replies, r.route, 'Gemini Nano on this computer', hasBriefing);
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
      return done(FALLBACK_REPLIES, status === 'available' ? 'fallback' : 'blocked', `${deviceProblem}; ${why}: basic replies`, false);
    }

    // Cloud path: personal history is never sent; briefing excerpts only if
    // the user turned on the separate option.
    const share = Boolean(settings.shareBriefingWithCloud);
    const cloudPrompt = buildPrompt({ lines: lines.slice(-2), briefing: share ? briefing : { chunks: [], positions: [] } });
    // Nano present but failed: force the cloud. Otherwise let the SDK's
    // PREFER_ON_DEVICE mode decide (it picks the cloud when Nano is missing).
    const forced = status === 'available' || this.forceCloud;
    const model = forced ? this.cloudModel : this.hybridModel;
    const sent = share && hasBriefing ? 'last 2 caption lines and briefing excerpts sent' : 'last 2 caption lines sent';
    try {
      const r = await this.#run(model, cloudPrompt, { hasBriefing: share && hasBriefing, onPartial, signal, mayUseDevice: !forced });
      if (r.replies) {
        const where = r.route === 'in_cloud' ? `cloud, ${sent}` : 'on this computer';
        return done(r.replies, r.route, `${deviceProblem}; ${where}`, share && hasBriefing);
      }
      return done(FALLBACK_REPLIES, 'fallback', `${deviceProblem}; cloud answer unreadable: basic replies`, false);
    } catch (e) {
      if (isAbort(e, signal)) return cancelled();
      return done(FALLBACK_REPLIES, 'fallback', `${deviceProblem}; cloud error: basic replies`, false, String(e?.message || e));
    }
  }
}
