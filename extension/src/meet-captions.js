// Reads the live captions Google Meet already shows on screen.
// Meet's class names are obfuscated and change often, so this relies on
// accessible landmarks and text structure, all kept in this one file.
import { createPauseTimer } from '../../core/pause.js';

// Label of the captions region in Meet's main UI languages.
const REGION_LABELS = [
  'captions', 'subtitles', 'sous-titres', 'subtítulos', 'untertitel', 'sottotitoli', 'legendas',
  'ondertiteling', 'napisy', 'titulky', 'altyazı', 'субтитры', '字幕', '자막', 'phụ đề', 'tekstitys', 'undertekster', 'undertexter',
];
// How Meet names the user's own captions in those languages.
const SELF_NAMES = new Set([
  'you', 'vous', 'tú', 'tu', 'du', 'sie', 'você', 'voce', 'io', 'jij', 'u', 'ty', 'vy', 'siz', 'sen', 'вы', 'ты',
  'あなた', '你', '您', '당신', '나', 'bạn', 'sinä', 'jeg', 'jag',
]);

let myName = '';
/** The user's display name in Meet, for languages not in the list above. */
export function setMyName(name) {
  myName = String(name || '').trim().toLowerCase();
}

export function isSelf(speaker) {
  const s = String(speaker || '').trim().toLowerCase();
  return SELF_NAMES.has(s) || (myName && s === myName);
}

export function findCaptionsRegion(doc = document) {
  const regions = doc.querySelectorAll('[role="region"][aria-label]');
  for (const r of regions) {
    const label = r.getAttribute('aria-label').toLowerCase();
    if (REGION_LABELS.some((l) => label.includes(l))) return r;
  }
  // Fallback seen in some Meet builds.
  return doc.querySelector('div[jsname="dsyhDe"], .a4cQT') || null;
}

/**
 * Each caption block reads "Name\ncaption text". Returns the blocks in
 * order as {speaker, text, self}.
 */
export function readBlocks(region) {
  if (!region) return [];
  const blocks = [];
  for (const child of region.children) {
    const raw = (child.innerText || '').trim();
    if (!raw) continue;
    const parts = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const speaker = parts[0];
    const text = parts.slice(1).join(' ');
    blocks.push({ speaker, text, self: isSelf(speaker) });
  }
  return blocks;
}

/** The last three lines, with the user's own lines labelled "Me". */
export function recentLines(blocks) {
  return blocks.slice(-3).map(({ speaker, text, self }) => ({ speaker: self ? 'Me' : speaker, text }));
}

/**
 * Watches the captions and calls onPause(lines) once nobody has added text
 * for `pauseMs`, when the last line is someone else's. Calls
 * onSelfSpeaking() while the user's own captions are moving.
 * With `earlyMs`, onEarly(lines) is called after that shorter silence, so
 * an on-device request can start before the pause; onChange() tells that
 * the captions moved again.
 */
export function watchCaptions({ pauseMs = 1200, earlyMs = 0, onPause, onEarly, onChange, onSelfSpeaking, onLine, onMissing, onFound }) {
  let region = null;
  let observer = null;
  let lastKey = '';
  let missingReported = false;

  // The blocks to answer: someone else spoke last and it was not answered yet.
  const fresh = () => {
    const blocks = readBlocks(region);
    const last = blocks.at(-1);
    if (!last || last.self) return null; // the user is talking: no suggestions
    const key = last.speaker + '|' + last.text;
    return key === lastKey ? null : { blocks, key };
  };

  const timer = createPauseTimer({
    pauseMs,
    earlyMs,
    onChange,
    onEarly: () => {
      const f = fresh();
      if (f) onEarly?.(recentLines(f.blocks));
    },
    onPause: () => {
      const f = fresh();
      if (!f) return;
      lastKey = f.key;
      onPause(recentLines(f.blocks));
    },
  });

  const onMutate = () => {
    const last = readBlocks(region).at(-1);
    if (last) {
      if (last.self) onSelfSpeaking?.();
      else onLine?.(last.speaker, last.text);
    }
    timer.touch();
  };

  const attach = () => {
    const found = findCaptionsRegion();
    if (found === region) return;
    observer?.disconnect();
    region = found;
    if (!region) {
      if (!missingReported) onMissing?.(); // once, not every poll
      missingReported = true;
      return;
    }
    missingReported = false;
    onFound?.();
    observer = new MutationObserver(onMutate);
    observer.observe(region, { childList: true, subtree: true, characterData: true });
  };

  attach();
  const poll = setInterval(attach, 2000);
  return {
    /** Timing from Remote Config, sent by the side panel. */
    setTiming: (t) => timer.set(t),
    /** For on-demand mode: the conversation as it stands now. */
    current() {
      return recentLines(readBlocks(region));
    },
    stop() {
      clearInterval(poll);
      timer.stop();
      observer?.disconnect();
    },
  };
}
