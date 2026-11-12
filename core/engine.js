import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider } from 'firebase/app-check';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';

import { REMOTE_DEFAULTS, FALLBACK_REPLIES } from './config.js';
import { buildPrompt, parseReplies, RESPONSE_JSON_SCHEMA } from './prompt.js';
import { retrieveBriefing } from './briefing.js';
import { similarExamples, ignoredSuggestions } from './memory.js';

const LANG = [{ type: 'text', languages: ['en'] }];

/**
 * Initializes Firebase, App Check and Remote Config.
 * appCheck: { kind: 'recaptcha', siteKey } on the hosted web demo,
 *           { kind: 'debug', token } in the extension (MV3 cannot load the
 *           reCAPTCHA script; the token is entered locally, never committed).
 */
export async function initFirebase({ firebaseConfig, appCheck }) {
  const app = initializeApp(firebaseConfig);
  if (appCheck?.kind === 'recaptcha' && appCheck.siteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheck.siteKey), isTokenAutoRefreshEnabled: true });
  } else if (appCheck?.kind === 'debug' && appCheck.token) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheck.token;
    initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: () => Promise.reject(new Error('Debug token only')),
      }),
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
  return { app, ai: getAI(app, { backend: new GoogleAIBackend() }), remote };
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
    this.#buildModels();
  }

  #buildModels() {
    const { ai } = this.firebase;
    const onDeviceParams = {
      createOptions: { expectedInputs: LANG, expectedOutputs: LANG },
      promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA },
    };
    const inCloudParams = {
      model: this.remote.cloud_model,
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        temperature: 0.7,
        maxOutputTokens: 256,
      },
    };
    // Firebase AI Logic hybrid inference. On-device by default; the cloud
    // model is only reachable through the explicit, consented path below.
    this.deviceModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams, inCloudParams });
    this.hybridModel = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams });
    this.cloudModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams });
  }

  /** Must be called from a click: may download Gemini Nano. */
  async prepareDevice(onProgress) {
    await this.deviceModel.initializeDeviceModel(onProgress);
  }

  cloudAllowed() {
    return Boolean(this.getSettings().cloudConsent && this.remote.cloud_enabled);
  }

  /**
   * @param {Array<{speaker?:string,text:string}>} lines recent captions, last = what was just said
   * @returns {Promise<{replies:Array<{text:string,source:string}>, route:'on_device'|'in_cloud'|'fallback'|'blocked', ms:number, error?:string}>}
   */
  async suggest(lines) {
    const t0 = performance.now();
    const utterance = lines.at(-1)?.text || '';
    const settings = this.getSettings();
    const maxWords = Number(this.remote.max_words) || 12;
    const events = settings.dontLearn ? [] : await this.memory.all();
    const briefing = retrieveBriefing(this.getBriefing(), utterance, { maxChunks: Number(this.remote.briefing_chunks) || 2 });
    const hasBriefing = Boolean(briefing.chunks.length || briefing.positions.length);
    const local = {
      lines,
      briefing,
      examples: similarExamples(events, utterance, Number(this.remote.examples_k) || 3),
      avoid: ignoredSuggestions(events, utterance),
      maxWords,
    };
    const done = (replies, route, error) => ({ replies, route, ms: Math.round(performance.now() - t0), error, hasBriefing });

    const status = this.forceCloud ? 'unavailable' : await deviceStatus();
    if (status === 'available') {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await this.deviceModel.generateContent(buildPrompt(local));
          const replies = parseReplies(result.response.text(), { maxWords, hasBriefing });
          if (replies) return done(replies, sourceOf(result));
        } catch (e) {
          if (!this.cloudAllowed()) return done(FALLBACK_REPLIES, 'fallback', String(e?.message || e));
          break;
        }
      }
    }
    if (!this.cloudAllowed()) return done(FALLBACK_REPLIES, 'blocked', `on-device model: ${status}`);

    // Cloud path: personal history is never sent; briefing only if the
    // user turned on the separate option.
    const cloudPrompt = buildPrompt({
      lines: lines.slice(-2),
      briefing: settings.shareBriefingWithCloud ? briefing : { chunks: [], positions: [] },
      examples: [],
      avoid: [],
      maxWords,
    });
    try {
      const model = this.forceCloud ? this.cloudModel : this.hybridModel;
      const result = await model.generateContent(cloudPrompt);
      const replies = parseReplies(result.response.text(), {
        maxWords,
        hasBriefing: hasBriefing && settings.shareBriefingWithCloud,
      });
      return done(replies || FALLBACK_REPLIES, replies ? sourceOf(result) : 'fallback');
    } catch (e) {
      return done(FALLBACK_REPLIES, 'fallback', String(e?.message || e));
    }
  }
}

function sourceOf(result) {
  return result.response.inferenceSource === InferenceSource.IN_CLOUD ? 'in_cloud' : 'on_device';
}
