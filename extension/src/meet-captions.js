// Reads the live captions Google Meet already shows on screen.
// Meet's class names are obfuscated and change often, so this relies on
// accessible landmarks and text structure, all kept in this one file.

const REGION_LABELS = ['captions', 'sous-titres', 'subtítulos', 'untertitel', 'sottotitoli', 'legendas'];
const SELF_NAMES = new Set(['you', 'vous', 'tú', 'tu', 'du', 'tu (você)', 'você', 'io']);

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
    blocks.push({ speaker, text, self: SELF_NAMES.has(speaker.toLowerCase()) });
  }
  return blocks;
}

/**
 * Watches the captions and calls onPause(lines) once nobody has added text
 * for `pauseMs`, with the last other-person line at the end. Calls
 * onSelfSpeaking() while the user's own captions are moving.
 */
export function watchCaptions({ pauseMs = 1200, onPause, onSelfSpeaking, onLine, onMissing }) {
  let region = null;
  let observer = null;
  let timer = null;
  let lastKey = '';
  let history = [];

  const flush = () => {
    const blocks = readBlocks(region);
    if (!blocks.length) return;
    const last = blocks.at(-1);
    if (last.self) return; // the user is talking: no suggestions
    const key = last.speaker + '|' + last.text;
    if (key === lastKey) return;
    lastKey = key;
    history = blocks.filter((b) => !b.self || b.text).slice(-3).map(({ speaker, text, self }) => ({ speaker: self ? 'Me' : speaker, text }));
    onPause(history);
  };

  const onMutate = () => {
    const blocks = readBlocks(region);
    const last = blocks.at(-1);
    if (last) {
      if (last.self) onSelfSpeaking?.();
      else onLine?.(last.speaker, last.text);
    }
    clearTimeout(timer);
    timer = setTimeout(flush, pauseMs);
  };

  const attach = () => {
    const found = findCaptionsRegion();
    if (found === region) return;
    observer?.disconnect();
    region = found;
    if (!region) return onMissing?.();
    observer = new MutationObserver(onMutate);
    observer.observe(region, { childList: true, subtree: true, characterData: true });
  };

  attach();
  const poll = setInterval(attach, 2000);
  return {
    setPause(ms) {
      pauseMs = ms;
    },
    stop() {
      clearInterval(poll);
      clearTimeout(timer);
      observer?.disconnect();
    },
  };
}
