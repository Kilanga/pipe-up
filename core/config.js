// Defaults bundled with the app. Remote Config can override every value
// (prompt version, timing, cloud model and a cloud kill switch) without a
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
  dontLearn: false,
  cloudConsent: false,
  fillers: ['One moment, please.', 'Could you repeat that?', "I'll answer in the chat."],
  textScale: 1,
};

export const FALLBACK_REPLIES = [
  { text: 'Let me think about that for a second.', source: 'general' },
  { text: 'Could you say a bit more about that?', source: 'general' },
  { text: "Let me check and get back to you.", source: 'general' },
];
