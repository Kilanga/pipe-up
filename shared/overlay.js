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
.icon:hover { background: #3f3f46; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 2px; }
.body { padding: 10px; display: grid; gap: 8px; }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
select, input[type=text] { font: inherit; color: inherit; background: #09090b; border: 1px solid #52525b; border-radius: 8px; padding: 6px 8px; }
input[type=text] { width: 100%; box-sizing: border-box; }
label.toggle { display: inline-flex; gap: 6px; align-items: center; font-size: .86em; color: #d4d4d8; }
.line { font-size: .9em; color: #a1a1aa; min-height: 1.4em; }
.line b { color: #e4e4e7; font-weight: 600; }
.cards { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.card { display: grid; grid-template-columns: 26px 1fr; gap: 8px; align-items: start; text-align: left; width: 100%;
  font: inherit; color: inherit; background: #27272a; border: 1px solid #52525b; border-radius: 10px; padding: 8px; cursor: pointer; }
.card:hover { border-color: #a78bfa; }
.card.sel { border-color: #a78bfa; background: #2e1065; }
.num { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: #3f3f46; font-weight: 700; font-size: .85em; }
.tag { display: block; font-size: .72em; color: #a1a1aa; margin-top: 2px; }
.tag.briefing { color: #c4b5fd; }
.preview { background: #2e1065; border: 1px solid #7c3aed; border-radius: 10px; padding: 8px; }
.preview .hint { font-size: .78em; color: #ddd6fe; margin-top: 4px; }
.fillers { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font: inherit; font-size: .82em; color: #e4e4e7; background: #27272a; border: 1px solid #52525b; border-radius: 999px; padding: 4px 10px; cursor: pointer; }
.chip:hover { border-color: #a78bfa; }
.chip.hold { border-color: #a78bfa; }
.ask { font: inherit; width: 100%; color: #18181b; background: #c4b5fd; border: 0; border-radius: 10px; padding: 7px; cursor: pointer; font-weight: 600; }
.self { font: inherit; width: 100%; color: #e4e4e7; background: #1f2937; border: 1px dashed #71717a; border-radius: 10px; padding: 7px; cursor: pointer; }
.notice { font-size: .82em; color: #fde68a; }
.muted { color: #a1a1aa; font-size: .82em; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: no-preference) { .card, .chip { transition: border-color .12s; } }
`;

const ROUTE_LABEL = {
  on_device: 'On device',
  in_cloud: 'Cloud',
  blocked: 'On-device AI unavailable',
  fallback: 'Basic replies',
  idle: 'Ready',
  thinking: 'Thinking…',
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
 * @param {(msg:{text:string, action:string, choice?:number, shown:string[], context:string}) => void} cb.onSend
 * @param {(info:{shown:string[], context:string}) => void} cb.onSpoke key 4
 * @param {(info:{shown:string[], context:string}) => void} [cb.onDismiss]
 * @param {(patch:object) => void} cb.onSettings
 * @param {() => void} [cb.onRequest] "Suggest replies now" (on-demand mode)
 * @param {() => void} [cb.onOpenPanel]
 */
export function createOverlay(cb, { mount = document.documentElement, position = null } = {}) {
  const host = el('div', { id: 'pipe-up-overlay' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', {}, CSS));
  mount.append(host);

  const state = { replies: [], selected: null, context: '', settings: {}, route: 'idle', editingFrom: null, voice: false };

  const badge = el('span', { class: 'badge', title: 'Where the last suggestions were generated' }, ROUTE_LABEL.idle);
  const output = el('select', { 'aria-label': 'Where your reply goes', onchange: (e) => cb.onSettings({ outputMode: e.target.value }) });
  const dontLearn = el('input', { type: 'checkbox', onchange: (e) => cb.onSettings({ dontLearn: e.target.checked }) });
  const line = el('div', { class: 'line' }, 'Following the captions…');
  const status = el('div', { class: 'muted', role: 'status', 'aria-live': 'polite' }, '');
  const cards = el('ul', { class: 'cards', 'aria-label': 'Suggested replies' });
  const preview = el('div', { class: 'preview', hidden: true });
  const notice = el('div', { class: 'notice', role: 'status', 'aria-live': 'polite', hidden: true });
  const typed = el('input', {
    type: 'text',
    placeholder: 'Write your own reply, Enter to send',
    'aria-label': 'Write your own reply',
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return; // IME composition in progress
      if (e.key === 'Enter' && typed.value.trim()) {
        e.preventDefault();
        const text = typed.value.trim();
        const from = state.editingFrom;
        const original = from != null ? state.replies[from]?.text : null;
        if (from != null && text === original) send({ text, action: 'picked', choice: from + 1 });
        else if (from != null) send({ text, action: 'edited', choice: from + 1 });
        else send({ text, action: 'typed' });
        typed.value = '';
      } else if (e.key === 'Escape') {
        typed.value = '';
        state.editingFrom = null;
        typed.blur();
      }
    },
  });
  const ask = el('button', { class: 'ask', hidden: true, onclick: () => cb.onRequest?.() }, 'Suggest replies (Alt+S)');
  const fillers = el('div', { class: 'fillers', role: 'group', 'aria-label': 'Quick phrases' });
  const selfBtn = el('button', { class: 'self', onclick: () => spoke() }, '4 — I answered myself');
  const panel = el('section', { class: 'pu', role: 'region', 'aria-label': 'Pipe Up' });
  const minBtn = el(
    'button',
    { class: 'icon', title: 'Minimize', 'aria-label': 'Minimize Pipe Up', 'aria-expanded': 'true', onclick: () => {
      const min = panel.classList.toggle('min');
      minBtn.setAttribute('aria-expanded', String(!min));
    } },
    '–'
  );
  const head = el(
    'div',
    { class: 'head' },
    el('span', { class: 'logo' }, 'Pipe Up'),
    badge,
    el('span', { class: 'sp' }),
    cb.onOpenPanel ? el('button', { class: 'icon', title: 'Settings, briefing and memory', 'aria-label': 'Open Pipe Up settings', onclick: cb.onOpenPanel }, '⚙') : null,
    minBtn
  );
  panel.append(
    head,
    el(
      'div',
      { class: 'body' },
      el('div', { class: 'row' }, output, el('label', { class: 'toggle' }, dontLearn, "Don't learn from this call")),
      line,
      el('div', { class: 'muted' }, '1 / 2 / 3 to pick · Enter to send · Tab to edit · Esc to cancel'),
      status,
      ask,
      cards,
      preview,
      notice,
      typed,
      fillers,
      selfBtn
    )
  );
  root.append(panel);
  if (position) Object.assign(panel.style, position);
  makeDraggable(panel, head);
  renderOutput();

  function renderOutput() {
    const opts = [['chat', 'Chat only']];
    if (state.voice) opts.push(['chat+voice', 'Chat + synthetic voice'], ['voice', 'Synthetic voice only']);
    output.replaceChildren(...opts.map(([v, l]) => el('option', { value: v }, l)));
    const wanted = state.settings.outputMode || 'chat';
    output.value = opts.some(([v]) => v === wanted) ? wanted : 'chat';
  }

  function renderCards() {
    cards.replaceChildren(
      ...state.replies.map((r, i) =>
        el(
          'li',
          {},
          el(
            'button',
            { class: 'card' + (state.selected === i ? ' sel' : ''), 'aria-pressed': String(state.selected === i), onclick: () => select(i) },
            el('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)),
            el('span', {}, r.text, el('span', { class: 'tag ' + r.source }, r.source === 'briefing' ? 'From your briefing' : 'General reply'))
          )
        )
      )
    );
    if (state.selected == null) {
      preview.hidden = true;
    } else {
      preview.hidden = false;
      preview.replaceChildren(
        el('div', {}, state.replies[state.selected].text),
        el('div', { class: 'hint' }, 'Enter to send · Tab to edit · Esc to cancel')
      );
    }
  }

  function select(i, { focus = false } = {}) {
    if (!state.replies[i]) return;
    state.selected = i;
    renderCards();
    // Chosen from the keyboard: focus moves to the card, so Enter, Tab and
    // Escape now act on Pipe Up and not on whatever Meet button had focus.
    if (focus) root.querySelectorAll('.card')[i]?.focus({ preventScroll: true });
  }

  function editSelected() {
    if (state.selected == null) return;
    state.editingFrom = state.selected;
    typed.value = state.replies[state.selected].text;
    typed.focus();
    typed.setSelectionRange(typed.value.length, typed.value.length); // cursor at the end, ready to adjust
  }

  function info() {
    return { shown: state.replies.map((r) => r.text), context: state.context };
  }

  function send({ text, action, choice }) {
    cb.onSend({ text, action, choice, ...info() });
    clear();
  }

  // A quick phrase holds the floor: the suggestions stay on screen and are not
  // counted as ignored.
  function sendFiller(text) {
    cb.onSend({ text, action: 'filler', shown: [], context: state.context });
    flash('Sent: ' + text);
  }

  function spoke() {
    cb.onSpoke(info());
    clear('Got it. Pipe Up stays in the background.');
  }

  function clear(msg) {
    state.replies = [];
    state.selected = null;
    state.editingFrom = null;
    status.textContent = '';
    renderCards();
    if (msg) flash(msg);
  }

  function flash(msg) {
    notice.hidden = false;
    notice.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => (notice.hidden = true), 4500);
  }

  // Keys are only taken when the focus is not in a field and not on one of
  // Meet's own controls, so Meet's shortcuts and screen readers keep working.
  function focusIsNeutral() {
    const ae = document.activeElement;
    return !ae || ae === document.body || ae === document.documentElement || ae === host;
  }
  function isTyping(e) {
    const t = (e.composedPath ? e.composedPath() : [e.target])[0];
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  }

  // Physical key first: on AZERTY "1" is Shift+&, and on a Mac Option+1 is "¡".
  function digitOf(e) {
    const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code || '');
    if (m) return Number(m[1]);
    return /^[1-4]$/.test(e.key) ? Number(e.key) : null;
  }

  function onKey(e) {
    if (e.repeat || e.isComposing || e.keyCode === 229) return;
    // Alt shortcuts work everywhere, even while typing (AltGr = Ctrl+Alt is left alone).
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const d = digitOf(e);
      let text = null;
      if (d && d <= 3) text = state.settings.fillers?.[d - 1];
      if (k === 'd' || e.code === 'KeyD') text = state.settings.disclosure || null;
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        sendFiller(text);
      } else if ((k === 's' || e.code === 'KeyS') && cb.onRequest) {
        e.preventDefault();
        e.stopPropagation();
        cb.onRequest();
      }
      return;
    }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const hasReplies = state.replies.length > 0;
    const d = digitOf(e);
    // Digits do nothing on a focused button, so they work wherever focus is.
    if (d && d <= 3 && state.replies[d - 1]) {
      e.preventDefault();
      e.stopPropagation();
      select(d - 1, { focus: true });
      return;
    }
    // Enter, Tab and Escape could act on a focused Meet control: only when focus is neutral or ours.
    if (!focusIsNeutral()) return;
    if (d === 4 && hasReplies) {
      e.preventDefault();
      e.stopPropagation();
      spoke();
    } else if (e.key === 'Enter' && state.selected != null) {
      e.preventDefault();
      e.stopPropagation();
      send({ text: state.replies[state.selected].text, action: 'picked', choice: state.selected + 1 });
    } else if (e.key === 'Tab' && !e.shiftKey && state.selected != null) {
      e.preventDefault();
      editSelected();
    } else if (e.key === 'Escape' && hasReplies) {
      // Not stopped: Meet still sees Escape.
      if (state.selected != null) {
        state.selected = null;
        renderCards();
      } else {
        cb.onDismiss?.(info());
        clear();
      }
    }
  }
  window.addEventListener('keydown', onKey, true);

  return {
    setLine(speaker, text) {
      line.replaceChildren(el('b', {}, (speaker || 'Someone') + ': '), text);
    },
    /** A new question: old suggestions are withdrawn at once. */
    setThinking(context) {
      // A suggestion opened for editing but not changed belongs to the old
      // question: withdraw it. Text the user changed is theirs: keep it.
      if (state.editingFrom != null && typed.value.trim() === state.replies[state.editingFrom]?.text) {
        typed.value = '';
        typed.blur();
      }
      state.replies = [];
      state.selected = null;
      state.editingFrom = null;
      state.context = context || '';
      renderCards();
      status.textContent = 'Preparing suggestions…';
      this.setRoute('thinking');
    },
    /** Streaming: show the replies that are already complete. */
    setPartial(replies) {
      if (state.selected != null) return; // never move what the user is looking at
      state.replies = replies || [];
      renderCards();
    },
    setSuggestions(replies, route, context) {
      const keep = state.selected != null && replies?.[state.selected]?.text === state.replies[state.selected]?.text;
      state.replies = replies || [];
      if (!keep) {
        state.selected = null;
        state.editingFrom = null;
      }
      if (context != null) state.context = context;
      this.setRoute(route);
      renderCards();
      status.textContent = state.replies.length ? `${state.replies.length} suggestions ready.` : '';
    },
    setRoute(route) {
      state.route = route || 'idle';
      badge.className = 'badge ' + state.route;
      badge.textContent = ROUTE_LABEL[state.route] || state.route;
    },
    setVoiceAvailable(on) {
      state.voice = Boolean(on);
      renderOutput();
    },
    setSettings(s) {
      state.settings = s;
      renderOutput();
      dontLearn.checked = Boolean(s.dontLearn);
      ask.hidden = s.suggestMode !== 'onDemand' || !cb.onRequest;
      panel.style.setProperty('--scale', s.textScale || 1);
      const chips = (s.fillers || []).map((f, i) =>
        el('button', { class: 'chip' + (i === 0 ? ' hold' : ''), title: `Alt+${i + 1}`, onclick: () => sendFiller(f) }, f)
      );
      if (s.disclosure) chips.push(el('button', { class: 'chip', title: 'Alt+D', onclick: () => sendFiller(s.disclosure) }, s.disclosure));
      fillers.replaceChildren(...chips);
    },
    clear: () => clear(),
    notice: flash,
    hasSuggestions: () => state.replies.length > 0,
    isThinking: () => state.route === 'thinking',
    /** True while the user is choosing or editing a reply. */
    isEngaged: () => state.selected != null || state.editingFrom != null || root.activeElement === typed,
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
