// Fakes for the tests: a Firebase AI Logic model that behaves like the SDK
// (streaming, inferenceSource, cancellation), with no network and no Gemini Nano.
import { InferenceMode, InferenceSource } from 'firebase/ai';
import { REMOTE_DEFAULTS, DEFAULT_SETTINGS } from '../core/config.js';
import { MemoryStore } from '../core/memory.js';
import { SuggestionEngine } from '../core/engine.js';

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export const repliesJson = (...texts) => JSON.stringify({ replies: texts.map((t) => (typeof t === 'string' ? { text: t, source: 'general' } : t)) });

const abortError = () => new DOMException('aborted', 'AbortError');

/** Waits `ms`, or rejects as soon as the signal aborts (like a real request). */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(abortError());
    });
  });
}

/**
 * A model factory to pass as `createModel`. `world` describes the computer:
 *   nano: true when Gemini Nano is there; cloudFails: the cloud request fails;
 *   answer(call): the text to return; delay: ms before the answer.
 * Every call is recorded in world.calls with the route it really took and
 * where its cancel signal was found.
 */
export function fakeModels(world) {
  world.calls = [];
  world.running = 0;
  world.maxRunning = 0;
  return (params) => {
    const call = async (kind, prompt, requestOptions) => {
      const device = params.onDeviceParams;
      const cloudFirst = params.mode === InferenceMode.ONLY_IN_CLOUD || params.mode === InferenceMode.PREFER_IN_CLOUD;
      let source;
      if (params.mode === InferenceMode.ONLY_IN_CLOUD) source = InferenceSource.IN_CLOUD;
      else if (params.mode === InferenceMode.ONLY_ON_DEVICE) source = InferenceSource.ON_DEVICE;
      else if (params.mode === InferenceMode.PREFER_ON_DEVICE) source = world.nano ? InferenceSource.ON_DEVICE : InferenceSource.IN_CLOUD;
      else source = world.cloudFails && world.nano ? InferenceSource.ON_DEVICE : InferenceSource.IN_CLOUD; // PREFER_IN_CLOUD
      const onDevice = source === InferenceSource.ON_DEVICE;
      if (onDevice && !world.nano) throw new Error('on-device model is not available');
      if (!onDevice && world.cloudFails) throw new Error('cloud request failed');
      // Like the SDK: the device listens to promptOptions.signal, read when
      // the prompt starts; the cloud listens to the request options.
      const signal = onDevice ? device.promptOptions?.signal : requestOptions?.signal;
      const rec = {
        kind,
        mode: params.mode,
        source,
        prompt,
        system: onDevice ? device.createOptions.initialPrompts?.[0]?.content : params.inCloudParams.systemInstruction,
        schema: onDevice ? device.promptOptions?.responseConstraint : params.inCloudParams.generationConfig?.responseJsonSchema,
        model: params.inCloudParams?.model,
        signalIn: onDevice ? (device.promptOptions?.signal ? 'promptOptions' : null) : requestOptions?.signal ? 'requestOptions' : null,
        aborted: false,
        cloudFirst,
      };
      world.calls.push(rec);
      world.running++;
      world.maxRunning = Math.max(world.maxRunning, world.running);
      try {
        if (world.fail?.(rec)) throw new Error('model error');
        await wait(world.delay ?? 5, signal);
      } catch (e) {
        rec.aborted = e.name === 'AbortError';
        throw e;
      } finally {
        world.running--;
      }
      return { text: world.answer(rec), source };
    };
    return {
      params,
      async generateContent(prompt, requestOptions) {
        const { text, source } = await call('generate', prompt, requestOptions);
        return { response: { text: () => text, inferenceSource: source } };
      },
      async generateContentStream(prompt, requestOptions) {
        const { text, source } = await call('stream', prompt, requestOptions);
        const half = Math.ceil(text.length / 2);
        return {
          stream: (async function* () {
            yield { text: () => text.slice(0, half) };
            yield { text: () => text.slice(half) };
          })(),
          response: Promise.resolve({ inferenceSource: source }),
        };
      },
      async initializeDeviceModel() {},
    };
  };
}

/** An engine on a fake computer. Returns the engine and the world to inspect. */
export function fakeEngine({ world = {}, settings = {}, remote = {}, briefing = null, events = [] } = {}) {
  world.nano ??= true;
  world.answer ??= () => repliesJson('Yes.', 'Could you say more?', 'Let me check.');
  world.statusCalls = 0;
  const state = { settings: { ...DEFAULT_SETTINGS, ...settings }, briefing };
  const engine = new SuggestionEngine({
    firebase: { ai: {}, remote: { ...REMOTE_DEFAULTS, ...remote } },
    memory: new MemoryStore(events),
    getBriefing: () => state.briefing,
    getSettings: () => state.settings,
    createModel: fakeModels(world),
    getDeviceStatus: async () => {
      world.statusCalls++;
      return world.nano ? 'available' : 'unavailable';
    },
  });
  return { engine, world, state };
}
