// The floating in-page panel. Shared by the Meet content script and the
// hosted demo page so judges see exactly the same interface.

const CSS = `
:host { all: initial; }
.pu { position: fixed; right: 16px; bottom: 96px; width: 340px; z-index: 2147483000;
  font: calc(14px * var(--scale, 1))/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #f4f4f5; background: #18181b; border: 1px solid #3f3f46; border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35); overflow: hidden; }
.pu.min .body { display: none; }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #27272a; cursor: move; user-select: none; }
.logo { font-weight: 700; letter-spacing: .2px; }
.badge { font-size: .78em; padding: 2px 8px; border-radius: 999px; background: #3f3f46; color: #e4e4e7; white-space: nowrap; }
.badge.on_device { background: #14532d; color: #bbf7d0; }
.badge.in_cloud { background: #1e3a8a; color: #bfdbfe; }
.badge.blocked, .badge.fallback { background: #713f12; color: #fde68a; }
.sp { flex: 1; }
.icon { background: none; border: 0; color: #d4d4d8; cursor: pointer; font-size: 1em; padding: 2px 6px; border-radius: 6px; }
.icon:hover, .icon:focus-visible { background: #3f3f46; outline: none; }
.body { padding: 10px; display: grid; gap: 8px; }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
select, input[type=text] { font: inherit; color: inherit; background: #09090b; border: 1px solid #3f3f46; border-radius: 8px; padding: 6px 8px; }
select:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
input[type=text] { width: 100%; box-sizing: border-box; }
label.toggle { display: inline-flex; gap: 6px; align-items: center; font-size: .86em; color: #d4d4d8; }
.line { font-size: .9em; color: #a1a1aa; min-height: 1.4em; }
.line b { color: #e4e4e7; font-weight: 600; }
.cards { display: grid; gap: 6px; }
.card { display: grid; grid-template-columns: 26px 1fr; gap: 8px; align-items: start; text-align: left; width: 100%;
  font: inherit; color: inherit; background: #27272a; border: 1px solid #3f3f46; border-radius: 10px; padding: 8px; cursor: pointer; }
.card:hover { border-color: #a78bfa; }
.card.sel { border-color: #a78bfa; background: #2e1065; }
.num { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: #3f3f46; font-weight: 700; font-size: .85em; }
.tag { display: block; font-size: .72em; color: #a1a1aa; margin-top: 2px; }
.tag.briefing { color: #c4b5fd; }
.preview { background: #2e1065; border: 1px solid #7c3aed; border-radius: 10px; padding: 8px; }
.preview .hint { font-size: .78em; color: #c4b5fd; margin-top: 4px; }
.fillers { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font: inherit; font-size: .82em; color: #e4e4e7; background: #27272a; border: 1px solid #3f3f46; border-radius: 999px; padding: 4px 10px; cursor: pointer; }
.chip:hover { border-color: #a78bfa; }
.self { font: inherit; width: 100%; color: #e4e4e7; background: #1f2937; border: 1px dashed #52525b; border-radius: 10px; padding: 7px; cursor: pointer; }
.notice { font-size: .82em; color: #fde68a; }
.muted { color: #a1a1aa; font-size: .82em; }
.sr { position: absolute; left: -9999px; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: no-preference) { .card, .chip { transition: border-color .12s; } }
`;

const ROUTE_LABEL = {
  on_device: 'On device',
  in_cloud: 'Cloud',
  blocked: 'On-device AI unavailable',
  fallback: 'Basic replies',
  idle: 'Ready',
};

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
}

/**
 * @param {object} cb callbacks
 * @param {(msg:{text:string, action:string, choice?:number, shown:string[]}) => void} cb.onSend
 * @param {(note:string) => void} cb.onSpoke key 4
 * @param {(shown:string[]) => void} cb.onDismiss
 * @param {(patch:object) => void} cb.onSettings
 * @param {() => void} [cb.onOpenPanel]
 */
export function createOverlay(cb, { mount = document.documentElement, position = null } = {}) {
  const host = el('div', { id: 'pipe-up-overlay' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', {}, CSS));
  mount.append(host);

  const state = { replies: [], selected: null, settings: {}, route: 'idle', line: null };

  const badge = el('span', { class: 'badge', title: 'Where the last suggestions were generated' }, ROUTE_LABEL.idle);
  const output = el(
    'select',
    { 'aria-label': 'Output', onchange: (e) => cb.onSettings({ outputMode: e.target.value }) },
    el('option', { value: 'chat' }, 'Chat only'),
    el('option', { value: 'chat+voice' }, 'Chat + voice'),
    el('option', { value: 'voice' }, 'Voice only')
  );
  const dontLearn = el('input', { type: 'checkbox', onchange: (e) => cb.onSettings({ dontLearn: e.target.checked }) });
  const line = el('div', { class: 'line', 'aria-label': 'Last thing said' }, 'Listening to the captions…');
  const cards = el('div', { class: 'cards', role: 'list' });
  const live = el('div', { class: 'sr', 'aria-live': 'polite' });
  const preview = el('div', { class: 'preview', hidden: true });
  const notice = el('div', { class: 'notice', hidden: true });
  const typed = el('input', {
    type: 'text',
    placeholder: 'Type your own reply, Enter to send',
    'aria-label': 'Type your own reply',
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && typed.value.trim()) {
        send({ text: typed.value.trim(), action: 'typed' });
        typed.value = '';
      }
      if (e.key === 'Escape') typed.blur();
    },
  });
  const fillers = el('div', { class: 'fillers', 'aria-label': 'Quick phrases' });
  const selfBtn = el('button', { class: 'self', onclick: () => spoke() }, '4 — I answered myself');
  const panel = el('section', { class: 'pu', role: 'dialog', 'aria-label': 'Pipe Up suggested replies' });
  const minBtn = el('button', { class: 'icon', title: 'Minimize', 'aria-label': 'Minimize', onclick: () => panel.classList.toggle('min') }, '–');
  const head = el(
    'div',
    { class: 'head' },
    el('span', { class: 'logo' }, 'Pipe Up'),
    badge,
    el('span', { class: 'sp' }),
    cb.onOpenPanel ? el('button', { class: 'icon', title: 'Settings, briefing and memory', 'aria-label': 'Open settings', onclick: cb.onOpenPanel }, '⚙') : null,
    minBtn
  );
  panel.append(
    head,
    el(
      'div',
      { class: 'body' },
      el('div', { class: 'row' }, output, el('label', { class: 'toggle' }, dontLearn, "Don't learn")),
      line,
      el('div', { class: 'muted' }, 'Suggested replies · 1 / 2 / 3 to pick, Enter to send, Esc to cancel'),
      cards,
      preview,
      notice,
      typed,
      fillers,
      selfBtn,
      live
    )
  );
  root.append(panel);
  if (position) Object.assign(panel.style, position);
  makeDraggable(panel, head);

  function renderCards() {
    cards.replaceChildren(
      ...state.replies.map((r, i) =>
        el(
          'button',
          { class: 'card' + (state.selected === i ? ' sel' : ''), role: 'listitem', onclick: () => select(i) },
          el('span', { class: 'num' }, String(i + 1)),
          el('span', {}, r.text, el('span', { class: 'tag ' + r.source }, r.source === 'briefing' ? 'From your briefing' : 'General reply'))
        )
      )
    );
    if (state.selected == null) {
      preview.hidden = true;
    } else {
      preview.hidden = false;
      preview.replaceChildren(
        el('div', {}, state.replies[state.selected].text),
        el('div', { class: 'hint' }, 'Enter to send · Esc to cancel')
      );
    }
  }

  function select(i) {
    if (!state.replies[i]) return;
    state.selected = i;
    renderCards();
  }

  function send({ text, action, choice }) {
    cb.onSend({ text, action, choice, shown: state.replies.map((r) => r.text) });
    clear();
  }

  function spoke() {
    cb.onSpoke(state.replies.map((r) => r.text));
    clear('Tracking continues.');
  }

  function clear(msg) {
    state.replies = [];
    state.selected = null;
    renderCards();
    if (msg) flash(msg);
  }

  function flash(msg) {
    notice.hidden = false;
    notice.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => (notice.hidden = true), 3500);
  }

  function isTyping(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (path.includes(typed)) return true;
    const t = path[0];
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  }

  function onKey(e) {
    if (e.altKey && /^[123]$/.test(e.key) && !isTyping(e)) {
      const f = state.settings.fillers?.[Number(e.key) - 1];
      if (f) {
        e.preventDefault();
        e.stopPropagation();
        send({ text: f, action: 'filler' });
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const hasReplies = state.replies.length > 0;
    if (/^[123]$/.test(e.key) && hasReplies) {
      e.preventDefault();
      e.stopPropagation();
      select(Number(e.key) - 1);
    } else if (e.key === '4' && hasReplies) {
      e.preventDefault();
      e.stopPropagation();
      spoke();
    } else if (e.key === 'Enter' && state.selected != null) {
      e.preventDefault();
      e.stopPropagation();
      send({ text: state.replies[state.selected].text, action: 'picked', choice: state.selected + 1 });
    } else if (e.key === 'Escape' && hasReplies) {
      e.preventDefault();
      e.stopPropagation();
      if (state.selected != null) {
        state.selected = null;
        renderCards();
      } else {
        cb.onDismiss?.(state.replies.map((r) => r.text));
        clear();
      }
    }
  }
  window.addEventListener('keydown', onKey, true);

  return {
    setLine(speaker, text) {
      state.line = { speaker, text };
      line.replaceChildren(el('b', {}, (speaker || 'Someone') + ': '), text);
    },
    setThinking() {
      cards.replaceChildren(el('div', { class: 'muted' }, 'Preparing suggestions…'));
    },
    setSuggestions(replies, route) {
      state.replies = replies || [];
      state.selected = null;
      this.setRoute(route);
      renderCards();
      live.textContent = state.replies.map((r, i) => `${i + 1}: ${r.text}`).join('. ');
    },
    setRoute(route) {
      state.route = route || 'idle';
      badge.className = 'badge ' + state.route;
      badge.textContent = ROUTE_LABEL[state.route] || state.route;
    },
    setSettings(s) {
      state.settings = s;
      output.value = s.outputMode || 'chat';
      dontLearn.checked = Boolean(s.dontLearn);
      panel.style.setProperty('--scale', s.textScale || 1);
      fillers.replaceChildren(
        ...(s.fillers || []).map((f, i) =>
          el('button', { class: 'chip', title: `Alt+${i + 1}`, onclick: () => send({ text: f, action: 'filler' }) }, f)
        )
      );
    },
    notice: flash,
    hasSuggestions: () => state.replies.length > 0,
    destroy() {
      window.removeEventListener('keydown', onKey, true);
      host.remove();
    },
  };
}

function makeDraggable(panel, handle) {
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    panel.style.left = Math.max(0, start.left + e.clientX - start.x) + 'px';
    panel.style.top = Math.max(0, start.top + e.clientY - start.y) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  handle.addEventListener('pointerup', () => (start = null));
}
