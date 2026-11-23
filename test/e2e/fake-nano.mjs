// A stand-in for Chrome's Prompt API (Gemini Nano), installed in the page
// before its scripts run. Headless Chrome has no on-device model, so this is
// how the end-to-end checks exercise the on-device path through the real
// Firebase AI Logic SDK: sessions, streaming and cancellation.
// Everything it sees is recorded in window.__nano for the checks to read.
export function fakeNano() {
  const nano = (window.__nano = { delay: 300, creates: 0, availability: 0, prompts: [] });
  const abortError = () => new DOMException('The request was cancelled', 'AbortError');
  const wait = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(abortError());
      });
    });
  const textOf = (contents) =>
    typeof contents === 'string'
      ? contents
      : contents.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.value).join(''))).join('\n');
  const lastLine = (prompt) => (prompt.match(/: <<<([^>]*)>>>\s*\n\s*\nSuggest/) || [])[1] || '';

  function answer(system, prompt) {
    if (/"items"/.test(system)) {
      // Preparation: two answers taken from Sam's briefing and one with an
      // invented number, which Pipe Up must leave out.
      return JSON.stringify({
        items: [
          { question: 'Is the March deadline still realistic?', answer: 'Yes, if QA can start on February 10.' },
          { question: 'Should we bring in a second vendor?', answer: 'I am against it: it would double the onboarding work.' },
          { question: 'What is the budget?', answer: 'The budget is 95000 euros.' },
        ],
      });
    }
    const prepared = (prompt.match(/My prepared answer to "[^"]*": ([^>]*)>>>/) || [])[1];
    const first = prepared ? { text: prepared, source: 'briefing' } : { text: 'Nano heard: ' + lastLine(prompt).slice(0, 40), source: 'general' };
    return JSON.stringify({ replies: [first, { text: 'Could you say more about that?', source: 'general' }, { text: 'Let me check and get back to you.', source: 'general' }] });
  }

  function start(system, contents, options) {
    const rec = { at: Math.round(performance.now()), system, text: textOf(contents), hasSignal: Boolean(options?.signal), hasConstraint: Boolean(options?.responseConstraint), aborted: false, done: false };
    nano.prompts.push(rec);
    return wait(nano.delay, options?.signal).then(
      () => {
        rec.done = true;
        return answer(system, rec.text);
      },
      (e) => {
        rec.aborted = true;
        throw e;
      }
    );
  }

  window.LanguageModel = {
    availability: async () => {
      nano.availability++;
      return 'available';
    },
    create: async (options) => {
      nano.creates++;
      const system = options?.initialPrompts?.[0]?.content || '';
      return {
        destroy() {},
        prompt: (contents, o) => start(system, contents, o),
        promptStreaming: (contents, o) =>
          new ReadableStream({
            start(controller) {
              return start(system, contents, o).then(
                (text) => {
                  const half = Math.ceil(text.length / 2);
                  controller.enqueue(text.slice(0, half));
                  controller.enqueue(text.slice(half));
                  controller.close();
                },
                (e) => controller.error(e)
              );
            },
          }),
      };
    },
  };
}

/**
 * Answers the Gemini API calls of the page with `reply(body)` instead of the
 * network, and records them. Returns the list of request bodies.
 */
export async function fakeCloud(target, reply) {
  const calls = [];
  await target.route(/:(stream)?[gG]enerateContent/, async (route) => {
    const req = route.request();
    const body = req.postData() || '';
    calls.push({ url: req.url(), body, appCheck: Boolean(req.headers()['x-firebase-appcheck']) });
    const text = reply(body);
    if (text == null) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { message: 'App Check token is invalid.' } }) });
    const payload = JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });
    if (req.url().includes('streamGenerateContent')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${payload}\r\n\r\n` });
    return route.fulfill({ status: 200, contentType: 'application/json', body: payload });
  });
  return calls;
}

// What the fake cloud answers to a preparation request: four answers taken
// from the sample briefing and one with an invented number, which Pipe Up
// must leave out.
export const CLOUD_QA = JSON.stringify({
  items: [
    { question: 'What is the status of the vendor contract?', answer: 'It is signed except the penalty clause; legal reviews it on Friday.' },
    { question: 'Is the March deadline still realistic?', answer: 'Yes, if QA can start on February 10.' },
    { question: 'Should we bring in a second vendor?', answer: 'I am against it: it would double the onboarding work.' },
    { question: 'What is the main risk for the timeline?', answer: 'The API migration.' },
    { question: 'What is the budget?', answer: 'The budget is 95000 euros.' },
  ],
});
export const prepReply = (body) => (/likely questions/.test(body) ? CLOUD_QA : null);
