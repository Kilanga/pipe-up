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
      remote[key] = typeof def === 'number' ? v.asNumber() || def : typeof def === 'boolean' ? v.asBoolean() : v.asString() || def;
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

export class SuggestionEngine {
  /**
   * @param {object} o
   * @param {{ai:any, remote:object}} o.firebase
   * @param {import('./memory.js').MemoryStore} o.memory
   * @param {() => any} o.getBriefing returns the current briefing index
   * @param {() => {cloudConsent:boolean, dontLearn:boolean, shareBriefingWithCloud?:boolean}} o.getSettings
   */
  constructor({ firebase, memory, getBriefing, getSettings }) {
    this.firebase = firebase;
    this.memory = memory;
    this.getBriefing = getBriefing;
    this.getSettings = getSettings;
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
    const { ai } = this.firebase;
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
    // Three Firebase AI Logic hybrid modes:
    // - ONLY_ON_DEVICE: the default, nothing leaves the computer;
    // - PREFER_ON_DEVICE: after consent, the SDK picks the cloud when the
    //   device cannot run Gemini Nano;
    // - ONLY_IN_CLOUD: after consent, when Nano is present but failed.
    this.deviceModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams, inCloudParams });
    this.hybridModel = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams });
    this.cloudModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams });
  }

  /** Must be called from a click: may download Gemini Nano. */
  async prepareDevice(onProgress) {
    await this.deviceModel.initializeDeviceModel(onProgress);
  }

  /**
   * Loads Gemini Nano into memory before the first real question, so the
   * first suggestion takes seconds instead of ~20 s. Never uses the cloud.
   */
  async warmUp() {
    if (this.warmed || (await deviceStatus()) !== 'available') return;
    this.warmed = true;
    try {
      await this.deviceModel.generateContent(buildPrompt({ lines: [{ speaker: 'Other person', text: 'Hello, can you hear me?' }] }));
    } catch {
      this.warmed = false;
    }
  }

  cloudAllowed() {
    return Boolean(this.getSettings().cloudConsent && this.remote.cloud_enabled);
  }

  /** Streams one request and returns the parsed replies and the real route. */
  async #run(model, prompt, { hasBriefing, onPartial }) {
    const { stream, response } = await model.generateContentStream(prompt);
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
    const final = await response;
    return {
      replies: parseReplies(buf, { maxWords: this.maxWords, hasBriefing }),
      route: final.inferenceSource === InferenceSource.IN_CLOUD ? 'in_cloud' : 'on_device',
    };
  }

  /**
   * @param {Array<{speaker?:string,text:string}>} lines recent captions, last = what was just said
   * @param {{onPartial?: (replies:Array<{text:string,source:string}>) => void}} [opts]
   * @returns {Promise<{replies:Array<{text:string,source:string}>, route:string, reason:string, ms:number, hasBriefing:boolean, error?:string}>}
   */
  async suggest(lines, { onPartial } = {}) {
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
    const hasBriefing = Boolean(briefing.chunks.length || briefing.positions.length);
    const done = (replies, route, reason, usedBriefing, error) => ({
      replies,
      route,
      reason,
      ms: Math.round(performance.now() - t0),
      hasBriefing: Boolean(usedBriefing),
      error,
    });

    const status = this.forceCloud ? 'unavailable' : await deviceStatus();
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
          const r = await this.#run(this.deviceModel, prompt, { hasBriefing, onPartial });
          if (r.replies) return done(r.replies, r.route, 'Gemini Nano on this computer', hasBriefing);
          deviceProblem = 'Gemini Nano gave an unreadable answer';
        } catch (e) {
          deviceProblem = 'Gemini Nano error: ' + (e?.message || e);
          break;
        }
      }
    }
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
    const model = status === 'available' || this.forceCloud ? this.cloudModel : this.hybridModel;
    const sent = share && hasBriefing ? 'last 2 caption lines and briefing excerpts sent' : 'last 2 caption lines sent';
    try {
      const r = await this.#run(model, cloudPrompt, { hasBriefing: share && hasBriefing, onPartial });
      if (r.replies) {
        const where = r.route === 'in_cloud' ? `cloud, ${sent}` : 'on this computer';
        return done(r.replies, r.route, `${deviceProblem}; ${where}`, share && hasBriefing);
      }
      return done(FALLBACK_REPLIES, 'fallback', `${deviceProblem}; cloud answer unreadable: basic replies`, false);
    } catch (e) {
      return done(FALLBACK_REPLIES, 'fallback', `${deviceProblem}; cloud error: basic replies`, false, String(e?.message || e));
    }
  }
}
