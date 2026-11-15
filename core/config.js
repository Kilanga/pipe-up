// Defaults bundled with the app. Remote Config can override every value
// (prompt variant, timing, cloud model and a cloud kill switch) without a
// new release.
export const REMOTE_DEFAULTS = {
  prompt_version: '1',
  pause_ms: 1200,
  max_words: 12,
  examples_k: 3,
  briefing_chunks: 2,
  cloud_model: 'gemini-3.5-flash-lite',
  cloud_enabled: true,
};

export const DEFAULT_SETTINGS = {
  outputMode: 'chat', // 'chat' | 'chat+voice' | 'voice'
  suggestMode: 'auto', // 'auto': after each pause | 'onDemand': only when asked (Alt+S)
  dontLearn: false,
  cloudConsent: false,
  shareBriefingWithCloud: false,
  myName: '', // how Meet labels the user's own captions, if not "You"
  // Quick phrases. The first one holds the floor during a block, as asked
  // for by people who stutter in co-design research (Wu et al., DIS 2024).
  fillers: ["I'm still speaking, one moment.", 'Could you repeat that, please?', "I'll answer in the chat."],
  // Optional, empty by default: a one-click way to tell others, in your words.
  disclosure: '',
  textScale: 1,
};

export const FALLBACK_REPLIES = [
  { text: 'Let me think about that for a second.', source: 'general' },
  { text: 'Could you say a bit more about that?', source: 'general' },
  { text: 'Let me check and get back to you.', source: 'general' },
];

// Settings saved by an older version get the new defaults where they changed.
export const SETTINGS_VERSION = 2;
export function migrateSettings(saved = {}) {
  const s = { ...DEFAULT_SETTINGS, ...saved };
  if ((saved.settingsVersion || 1) < 2) s.fillers = DEFAULT_SETTINGS.fillers;
  s.settingsVersion = SETTINGS_VERSION;
  return s;
}
