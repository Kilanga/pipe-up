// Turns "the captions just changed" into two moments: a short silence, when
// an on-device request may start early, and the normal pause, when
// suggestions are shown. Shared by the Meet captions watcher and the demo.

/**
 * @param {object} o
 * @param {number} [o.pauseMs] silence before suggesting
 * @param {number} [o.earlyMs] shorter silence before the early start; 0 = off
 * @param {() => void} o.onPause
 * @param {() => void} [o.onEarly]
 * @param {() => void} [o.onChange] called on every change, before the timers restart
 */
export function createPauseTimer({ pauseMs = 1200, earlyMs = 0, onPause, onEarly, onChange }) {
  let pauseTimer = null;
  let earlyTimer = null;
  const clear = () => {
    clearTimeout(pauseTimer);
    clearTimeout(earlyTimer);
  };
  return {
    /** Call on every caption change. */
    touch() {
      clear();
      onChange?.();
      pauseTimer = setTimeout(onPause, pauseMs);
      // An early start is only worth it with a real head start on the pause.
      if (onEarly && earlyMs > 0 && pauseMs - earlyMs >= MIN_HEAD_START_MS) earlyTimer = setTimeout(onEarly, earlyMs);
    },
    set({ pauseMs: p, earlyMs: e } = {}) {
      if (Number(p) > 0) pauseMs = Number(p);
      if (Number(e) >= 0) earlyMs = Number(e);
    },
    stop: clear,
  };
}

export const MIN_HEAD_START_MS = 200;
