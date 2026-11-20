// Reads text aloud on this computer only (the user's speakers or headphones),
// with the browser's speech synthesis. Only voices that run locally are used,
// so the text never leaves the computer; with none, nothing is read.
export function speakPrivately(text) {
  if (!('speechSynthesis' in globalThis) || !text) return false;
  const voices = speechSynthesis.getVoices().filter((v) => v.localService && /^en/i.test(v.lang));
  if (!voices.length) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voices.find((v) => v.default) || voices[0];
  u.lang = u.voice.lang;
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return true;
}
// Voices load asynchronously in Chrome.
if ('speechSynthesis' in globalThis) speechSynthesis.getVoices();
