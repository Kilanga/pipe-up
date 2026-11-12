// The side panel hosts the AI engine: Chrome's Prompt API (Gemini Nano) is
// available in extension pages, and Firebase AI Logic runs here.
import { initFirebase, SuggestionEngine } from '../../core/engine.js';
import { IdbMemoryStore, makeEvent } from '../../core/memory.js';
import { DEFAULT_SETTINGS } from '../../core/config.js';
import { mountControls } from '../../shared/controls.js';
import { setPdfWorker } from '../../shared/extract.js';

/* global __FIREBASE_CONFIG__ */
const firebaseConfig = __FIREBASE_CONFIG__;

setPdfWorker(chrome.runtime.getURL('pdf.worker.min.mjs'));

const memory = new IdbMemoryStore('pipe-up');
let settings = { ...DEFAULT_SETTINGS };
let briefingIndex = null;
let engine = null;
let engineToken = null;

const settingsStore = {
  async get() {
    const { settings: s } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  },
  async set(patch) {
    const s = await this.get();
    await chrome.storage.local.set({ settings: { ...s, ...patch } });
  },
};
const briefingStore = {
  async get() {
    return (await chrome.storage.local.get('briefing')).briefing || {};
  },
  async set(b) {
    await chrome.storage.local.set({ briefing: b });
  },
};

const controls = mountControls(document.getElementById('app'), {
  getEngine: () => engine,
  memory,
  settings: settingsStore,
  briefing: briefingStore,
  onBriefing: (idx) => (briefingIndex = idx),
  showDebugToken: true,
});

async function startEngine() {
  const token = settings.appCheckDebugToken || null;
  if (engine && token === engineToken) return;
  engineToken = token;
  const firebase = await initFirebase({ firebaseConfig, appCheck: token ? { kind: 'debug', token } : null });
  engine = new SuggestionEngine({
    firebase,
    memory,
    getBriefing: () => briefingIndex,
    getSettings: () => settings,
  });
  engine.warmUp();
}

settingsStore.get().then(async (s) => {
  settings = s;
  await startEngine();
});
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  controls.applySettings(settings);
  if ((settings.appCheckDebugToken || null) !== engineToken) {
    engine = null; // Firebase apps cannot be re-initialized with a new App Check: reload the panel
    location.reload();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'pu:suggest') {
    (async () => {
      if (!engine) await startEngine();
      const res = await engine.suggest(msg.lines);
      controls.reportRun(res);
      sendResponse({ ...res, pauseMs: Number(engine.remote.pause_ms) || 1200 });
    })().catch((e) => sendResponse({ replies: [], route: 'fallback', error: String(e) }));
    return true; // async response
  }
  if (msg?.type === 'pu:event') {
    // "Don't learn" means the moment is not recorded at all.
    if (!settings.dontLearn) memory.add(makeEvent(msg.event)).then(() => controls.renderMemory());
  }
  return false;
});
