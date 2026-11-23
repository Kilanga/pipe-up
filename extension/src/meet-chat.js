// Sends a message in the Google Meet chat. Falls back to the clipboard
// (with a notice) when Meet's layout cannot be driven.

// "Send a message" / "Chat" in Meet's main UI languages.
const CHAT_LABELS = ['chat with everyone', 'discuter avec tous', 'chatear con todos', 'mit allen chatten', 'chatta con tutti', 'conversar com todos', 'chat', 'discussion'];
const BOX_LABELS = ['send a message', 'envoyer un message', 'enviar un mensaje', 'nachricht senden', 'invia un messaggio', 'enviar uma mensagem', 'bericht verzenden', 'wyślij wiadomość'];
const SEND_WORDS = ['send', 'envoyer', 'enviar', 'senden', 'invia', 'verzenden', 'wyślij', 'отправить', '送信', '发送', '전송', 'gửi'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const label = (n) => (n.getAttribute('aria-label') || '').toLowerCase();

const visible = (n) => n.offsetParent !== null;

// The chat panel, when Meet tells which one it is: the element the chat
// button controls, or a visible container labelled like the chat.
function findChatPanel() {
  const controlled = document.getElementById(findChatToggle()?.getAttribute('aria-controls') || '');
  if (controlled && visible(controlled)) return controlled;
  return [...document.querySelectorAll('[aria-label]:not(button):not(textarea)')].find((n) => visible(n) && CHAT_LABELS.some((l) => label(n).includes(l))) || null;
}

// Only the chat box is ever typed into. Another open panel (Q&A, polls,
// feedback) can also have a text field and a "send" button: a reply must
// never go there, so a field is accepted only if
function findChatBox() {
  const areas = [...document.querySelectorAll('textarea')].filter(visible);
  // 1. it is labelled like Meet's chat box, or
  const labelled = areas.find((t) => BOX_LABELS.some((l) => label(t).includes(l)));
  if (labelled) return labelled;
  // 2. it sits inside the chat panel.
  const panel = findChatPanel();
  return (panel && areas.find((t) => panel.contains(t))) || null;
}

function findSendButton(box) {
  let node = box.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const btn = [...node.querySelectorAll('button')].find((b) => SEND_WORDS.some((w) => label(b).includes(w)));
    if (btn) return btn;
  }
  return null;
}

function findChatToggle() {
  const buttons = [...document.querySelectorAll('button[aria-pressed]')];
  for (const l of CHAT_LABELS) {
    const b = buttons.find((x) => label(x).includes(l));
    if (b) return b;
  }
  return null;
}

// Opens the chat if needed, then looks for its box. With no chat box, the
// caller falls back to the clipboard and says so.
async function openChatBox() {
  let box = findChatBox();
  if (box) return box;
  const toggle = findChatToggle();
  if (toggle && toggle.getAttribute('aria-pressed') !== 'true') toggle.click();
  for (let i = 0; i < 20 && !box; i++) {
    await sleep(100);
    box = findChatBox();
  }
  return box;
}

async function sendNow(text) {
  try {
    const box = await openChatBox();
    if (!box) throw new Error('chat box not found');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const draft = box.value; // a message the user was typing: put it back afterwards
    const hadFocus = document.activeElement === box;
    box.focus();
    setter.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(60);
    const sendBtn = findSendButton(box);
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(200);
    if (box.value.trim() === text.trim()) {
      setter.call(box, draft);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      throw new Error('message not sent');
    }
    if (draft) {
      setter.call(box, draft);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (!hadFocus) box.blur();
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

// One message at a time: two quick presses never type into the box together.
let queue = Promise.resolve();
export function sendToMeetChat(text) {
  const next = queue.then(() => sendNow(text));
  queue = next.catch(() => {});
  return next;
}
