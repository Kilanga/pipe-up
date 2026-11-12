import { createOverlay } from '../../shared/overlay.js';
import { watchCaptions } from './meet-captions.js';
import { sendToMeetChat } from './meet-chat.js';
import { DEFAULT_SETTINGS } from '../../core/config.js';

let settings = { ...DEFAULT_SETTINGS };
let context = '';
let requestId = 0;

const overlay = createOverlay({
  onSend: async ({ text, action, choice, shown }) => {
    await deliver(text);
    log({ action, reply: text, choice, shown });
  },
  onSpoke: (shown) => log({ action: 'spoke', reply: '', shown }),
  onDismiss: (shown) => log({ action: 'dismissed', reply: '', shown }),
  onSettings: (patch) => saveSettings(patch),
  onOpenPanel: () => chrome.runtime.sendMessage({ type: 'pu:open-panel' }),
});

chrome.storage.local.get('settings').then(({ settings: s }) => applySettings(s));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) applySettings(changes.settings.newValue);
});

function applySettings(s) {
  settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  overlay.setSettings(settings);
}

async function saveSettings(patch) {
  const { settings: s } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...(s || {}), ...patch } });
}

function log(event) {
  chrome.runtime.sendMessage({ type: 'pu:event', event: { context, ...event } }).catch(() => {});
}

async function deliver(text) {
  const mode = settings.outputMode;
  if (mode === 'chat' || mode === 'chat+voice' || mode === 'voice') {
    // Voice into the call needs the local speech engine (see README);
    // until it is ready, every mode also posts to the chat.
    const r = await sendToMeetChat(text);
    if (!r.ok) overlay.notice(r.copied ? 'Could not post in the chat: copied to your clipboard.' : 'Could not post in the chat.');
    if (mode !== 'chat') overlay.notice('Voice into the call is not available yet: sent to the chat.');
  }
}

const watcher = watchCaptions({
  pauseMs: 1200,
  onLine: (speaker, text) => overlay.setLine(speaker, text),
  onSelfSpeaking: () => {},
  onMissing: () => overlay.notice('Turn on captions in Meet (CC button) so Pipe Up can follow the conversation.'),
  onPause: async (lines) => {
    const id = ++requestId;
    context = lines.at(-1)?.text || '';
    overlay.setThinking();
    try {
      const res = await chrome.runtime.sendMessage({ type: 'pu:suggest', lines });
      if (id !== requestId) return; // a newer line arrived meanwhile
      if (!res) throw new Error('no engine');
      overlay.setSuggestions(res.replies, res.route);
      if (res.route === 'blocked') overlay.notice('On-device AI is not ready. Open the side panel to set it up or allow the cloud.');
      if (res.pauseMs) watcher.setPause(res.pauseMs);
    } catch {
      if (id !== requestId) return;
      overlay.setSuggestions([], 'idle');
      overlay.notice('Open the Pipe Up side panel (⚙) to start suggestions.');
    }
  },
});
