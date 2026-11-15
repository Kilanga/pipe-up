// The side panel hosts the AI engine: Chrome's Prompt API (Gemini Nano) is
// available in extension pages, and Firebase AI Logic runs here. It serves
// exactly one Meet tab, the active one in its window, through a named port,
// so two windows never answer the same question twice.
import { initFirebase, SuggestionEngine } from '../../core/engine.js';
import { IdbMemoryStore, makeEvent } from '../../core/memory.js';
import { DEFAULT_SETTINGS, FALLBACK_REPLIES, migrateSettings } from '../../core/config.js';
import { mountControls } from '../../shared/controls.js';
import { setPdfWorker } from '../../shared/extract.js';
import { isVoiceDownloaded, setupVoice, startVoice, synthesize } from './voice.js';

/* global __FIREBASE_CONFIG__ */
const firebaseConfig = __FIREBASE_CONFIG__;
const MEET = /^https:\/\/meet\.google\.com\//;

setPdfWorker(chrome.runtime.getURL('pdf.worker.min.mjs'));

const memory = new IdbMemoryStore('pipe-up');
let settings = { ...DEFAULT_SETTINGS };
let briefingIndex = null;
let engine = null;
let enginePromise = null;

// The App Check debug token lives only in this extension page's own storage:
// content scripts on meet.google.com cannot read it.
const TOKEN_KEY = 'pu-appcheck-debug-token';
const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  },
  set: (v) => {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked: token kept for this session only */
    }
  },
};

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
  voice: {
    status: async () => (voiceReady ? 'ready' : voiceFailed ? 'failed' : (await isVoiceDownloaded()) ? 'loading' : 'missing'),
    setup: async (onProgress) => {
      voiceFailed = false;
      try {
        await setupVoice(onProgress);
        setVoiceReady(true);
      } catch (e) {
        voiceFailed = true;
        throw e;
      }
    },
    test: async () => {
      const { pcm16, rate } = await synthesize('Hi, this is my Pipe Up voice.');
      playLocally(pcm16, rate);
    },
  },
  debugToken: {
    get: tokenStore.get,
    set: (v) => {
      tokenStore.set(v);
      location.reload(); // App Check cannot be re-initialized in a running Firebase app
    },
  },
});

function startEngine() {
  enginePromise ??= (async () => {
    const debugToken = tokenStore.get();
    const firebase = await initFirebase({ firebaseConfig, appCheck: debugToken ? { debugToken } : {} });
    engine = new SuggestionEngine({ firebase, memory, getBriefing: () => briefingIndex, getSettings: () => settings });
    engine.warmUp();
    return engine;
  })();
  return enginePromise;
}

async function loadSettings() {
  const { settings: saved } = await chrome.storage.local.get('settings');
  const s = migrateSettings(saved || {});
  // Older versions kept the debug token with the settings: move it.
  if (s.appCheckDebugToken) {
    if (!tokenStore.get()) tokenStore.set(s.appCheckDebugToken);
    delete s.appCheckDebugToken;
  }
  await chrome.storage.local.set({ settings: s });
  settings = s;
}
loadSettings().then(startEngine);
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  controls.applySettings(settings);
});

// ---------- Local voice ----------
let voiceReady = false;
let voiceFailed = false;
function setVoiceReady(on) {
  voiceReady = on;
  // Tells Meet tabs opened from now on to mix the voice into the microphone.
  chrome.storage.local.set({ voiceInstalled: on });
  if (port) safePost(port, { type: 'voice', ready: on });
  controls.refreshVoice();
}
isVoiceDownloaded().then(async (has) => {
  if (!has) return;
  try {
    await startVoice();
    setVoiceReady(true);
  } catch (e) {
    console.warn('[Pipe Up] voice could not start', e);
    voiceFailed = true;
    chrome.storage.local.set({ voiceInstalled: false });
    controls.refreshVoice();
  }
});
function playLocally(pcm16, rate) {
  const bin = atob(pcm16);
  const ctx = new AudioContext();
  const n = bin.length / 2;
  const buf = ctx.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16) >> 16) / 0x7fff;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

// ---------- Connection to the Meet tab ----------
let port = null;
let portTabId = null;
let pending = null; // latest request waiting while Gemini Nano is busy
let busy = false;

async function connectActiveTab() {
  const win = await chrome.windows.getCurrent();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab || !MEET.test(tab.url || '')) {
    // Keep serving the Meet tab we are connected to, if any.
    controls.setConnection(!!port);
    return;
  }
  if (port && portTabId === tab.id) return controls.setConnection(true);
  port?.disconnect();
  const p = chrome.tabs.connect(tab.id, { name: 'pipe-up' });
  port = p;
  portTabId = tab.id;
  p.onMessage.addListener((msg) => onTabMessage(p, msg));
  p.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // the content script may not be loaded yet
    if (port !== p) return;
    port = null;
    portTabId = null;
    controls.setConnection(false);
    setTimeout(connectActiveTab, 1500);
  });
  p.postMessage({ type: 'voice', ready: voiceReady });
  controls.setConnection(true);
}

async function onTabMessage(p, msg) {
  if (msg?.type === 'suggest') {
    pending = { id: msg.id, lines: msg.lines, port: p };
    if (!busy) drain();
  } else if (msg?.type === 'speak') {
    try {
      safePost(p, { type: 'audio', ...(await synthesize(msg.text)) });
    } catch (e) {
      console.warn('[Pipe Up] voice failed', e);
      safePost(p, { type: 'speak-failed' });
    }
  } else if (msg?.type === 'event') {
    // "Don't learn" means the moment is not recorded at all.
    if (!settings.dontLearn) memory.add(makeEvent(msg.event)).then(() => controls.renderMemory());
  }
}

// Gemini Nano handles one request at a time and an on-device request cannot
// be cancelled, so: one in flight, and only the most recent one waiting.
async function drain() {
  busy = true;
  try {
    while (pending) {
      const job = pending;
      pending = null;
      let res;
      try {
        const eng = await startEngine();
        // A stalled model must not block the rest of the call.
        res = await withTimeout(
          eng.suggest(job.lines, {
            onPartial: (replies) => !pending && safePost(job.port, { type: 'partial', id: job.id, replies }),
          }),
          TIMEOUT_MS
        );
        res.pauseMs = Number(eng.remote.pause_ms) || 1200;
      } catch (e) {
        console.warn('[Pipe Up] suggestion failed', e);
        res = { replies: fallbackReplies(), route: 'fallback', reason: String(e?.message || e), error: true };
      }
      controls.reportRun(res);
      if (!pending) safePost(job.port, { type: 'result', id: job.id, ...res });
    }
  } finally {
    busy = false;
  }
}

const TIMEOUT_MS = 20000;
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error('No answer after ' + ms / 1000 + ' s')), ms))]);
}
const fallbackReplies = () => FALLBACK_REPLIES;

function safePost(p, msg) {
  try {
    p.postMessage(msg);
  } catch {
    /* the tab went away */
  }
}

chrome.tabs.onActivated.addListener(() => connectActiveTab());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' || info.url) connectActiveTab();
});
connectActiveTab();
