// Sends a message in the Google Meet chat. Falls back to the clipboard
// (with a notice) when Meet's layout cannot be driven.

const CHAT_BUTTON = [
  'button[aria-label*="Chat with everyone" i]',
  'button[aria-label*="chat" i][aria-pressed]',
  'button[aria-label*="Discuter avec tous" i]',
  'button[aria-label*="Chat" i]',
];
const TEXTAREA = [
  'textarea[aria-label*="Send a message" i]',
  'textarea[aria-label*="Envoyer un message" i]',
  'textarea[jsname]',
  'textarea',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const first = (sels) => sels.map((s) => document.querySelector(s)).find(Boolean) || null;

async function findTextarea() {
  let ta = first(TEXTAREA);
  if (ta) return ta;
  const btn = first(CHAT_BUTTON);
  if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
  for (let i = 0; i < 15 && !ta; i++) {
    await sleep(100);
    ta = first(TEXTAREA);
  }
  return ta;
}

export async function sendToMeetChat(text) {
  try {
    const ta = await findTextarea();
    if (!ta) throw new Error('chat box not found');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    ta.focus();
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(50);
    const sendBtn =
      ta.closest('form, [role="region"], aside, div')?.querySelector('button[aria-label*="Send" i], button[aria-label*="Envoyer" i]') ||
      document.querySelector('button[aria-label*="Send a message" i], button[aria-label*="Envoyer un message" i]');
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
    else ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(150);
    ta.blur();
    if (ta.value.trim() === text.trim()) throw new Error('message not sent');
    return { ok: true };
  } catch (e) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: false, copied: true, error: String(e.message || e) };
    } catch {
      return { ok: false, copied: false, error: String(e.message || e) };
    }
  }
}
