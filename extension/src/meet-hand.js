// Raises the user's hand in Google Meet. Optional (off by default): used
// when the "I'm still speaking" phrase is sent, so the others also see that
// the user wants to keep the floor.
// Same approach as meet-chat.js: Meet's class names change often, so the
// button is found by its accessible label, here in Meet's main UI languages.
// TO VERIFY IN A REAL CALL: the labels below, per language.

// The label starts with these words, e.g. "Raise hand (ctrl + alt + h)".
const RAISE = ['raise hand', 'lever la main', 'levantar la mano', 'levantar a mão', 'hand heben', 'melden', 'alza la mano', 'hand opsteken', 'podnieś rękę'];
// The same button once the hand is up.
const LOWER = ['lower hand', 'baisser la main', 'bajar la mano', 'baixar a mão', 'abaixar a mão', 'hand senken', 'meldung zurückziehen', 'abbassa la mano', 'hand laten zakken', 'opuść rękę'];

const label = (n) => (n.getAttribute('aria-label') || '').trim().toLowerCase();
const starts = (text, words) => words.some((w) => text.startsWith(w));

/**
 * Finds Meet's raise-hand toggle. Only a toggle button (aria-pressed) whose
 * label starts with a known phrase counts, so another button that merely
 * mentions a hand, or "Problem melden", is never taken for it.
 * @returns {{button: Element, raised: boolean} | null}
 */
export function findHandButton(doc = document) {
  for (const button of doc.querySelectorAll('button[aria-pressed][aria-label]')) {
    const text = label(button);
    if (starts(text, LOWER)) return { button, raised: true };
    if (starts(text, RAISE)) return { button, raised: button.getAttribute('aria-pressed') === 'true' };
  }
  return null;
}

/**
 * Raises the hand unless it is already up. Never lowers it and never
 * throws: when Meet's button cannot be found, nothing happens.
 * @returns {'raised'|'already'|'unavailable'}
 */
export function raiseHand(doc = document) {
  try {
    const found = findHandButton(doc);
    if (!found) return 'unavailable';
    if (found.raised) return 'already';
    if (found.button.disabled || found.button.getAttribute('aria-disabled') === 'true') return 'unavailable';
    found.button.click();
    return 'raised';
  } catch {
    return 'unavailable';
  }
}
