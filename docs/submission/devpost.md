# Devpost entry — Pipe Up

Ready to paste into https://firebasehybridaihackathon.devpost.com (deadline: November 30, 2026, 2:00 PM Pacific = 23:00 in Paris). Each block below is one field of the form. Field names on the form may differ slightly; the content maps one to one.

The feature branches are merged; this text describes the merged code (version 0.4.0). What is still open is listed at the end under **STILL TO CONFIRM**.

---

## Project name

Pipe Up

## Tagline / elevator pitch (176 characters, limit 200)

A backup channel for people who stutter in Google Meet: one key holds the floor, three short replies come from what you prepared. On device first, cloud only with your consent.

## Platform

Web (Chrome) — a Chrome extension (Manifest V3) for Google Meet, and a hosted web demo.

## Links

- Hosted demo (no account, no install): https://pipe-up-demo.web.app
- Code repository (public, Apache-2.0): https://github.com/Kilanga/pipe-up
- Extension zip: https://github.com/Kilanga/pipe-up/releases/latest
- Demo video (YouTube, public): `<PASTE THE YOUTUBE URL>`

## Built with (tags)

firebase-ai-logic, firebase, gemini-nano, gemini, firebase-app-check, firebase-remote-config, firebase-hosting, chrome-extension, manifest-v3, prompt-api, javascript, indexeddb, web-audio-api, pdf.js, webassembly, esbuild

---

## About the project (paste as the project story)

### Inspiration

People who stutter speak for themselves. Video calls make that harder.

In a UK survey of adults who stammer, most respondents said video calls increase anxiety (65%) and make communication more difficult (63%) than face to face. They named time pressure and people talking over each other as hard moments, and said the chat helps when speaking is difficult. Source: https://www.nbt.nhs.uk/sites/default/files/document/Stammer_Executive_Summary.pdf

In a co-design study with eight people who stutter (Li, Wu and Leshed, DIS 2024), the summary notes that during a block, others may assume the connection is frozen and talk over the person. Participants liked two ideas: an "I'm still speaking" button, and a way to tell others that they stutter. Sources: https://doi.org/10.1145/3643834.3661533 and https://news.cornell.edu/stories/2024/07/redesigning-videoconferencing-and-people-who-stutter

Pipe Up starts from those two ideas, in Google Meet.

I have to say one thing plainly: **Pipe Up has not yet been tested with people who stutter.** Its design follows published research, not user testing. Getting that feedback is the first next step.

### What it does

Pipe Up is a backup channel for the moment when speech does not come on time in a work call.

- **Hold the floor.** Alt+1 posts "I'm still speaking, one moment." in the Meet chat. The quick phrases are editable.
- **Three short replies.** After a pause in the captions, Pipe Up shows three replies of 12 words at most. Keys 1, 2, 3 pick one. Enter sends it. Tab edits it first. Esc cancels.
- **Your own speech first.** Key 4 means "I answered myself". Pipe Up steps aside.
- **Grounded in what you prepared.** Before the call, you write your positions and notes, or add a document (.txt, .md, .pdf, read on your computer). Replies that use them are labelled "From your briefing". When your notes do not cover a question, the replies stay neutral. The model is instructed not to invent facts, numbers or commitments.
- **Prepare for the call.** One click turns your briefing into up to 6 likely questions, each with a short answer you can edit. The cloud does this once, after you confirm what is sent, or Gemini Nano does it on your computer. During the call, a matching prepared answer is offered on the device. Cloud before the call, device during the call.
- **Chat, voice, or both.** A reply can be posted in the chat, or read aloud in the call by a synthetic voice generated on your computer. There are three English voices. The quick phrases are synthesized in advance, so they are spoken without waiting.
- **Tell colleagues, if you want to.** Alt+D sends a line you wrote yourself. It is empty by default.
- **Reading under pressure.** Easy reading, one suggestion at a time, hear the suggestions in your own headphones, high contrast, reduced motion.
- **Learns your phrasing on your device.** The replies you pick or edit become style examples, stored only in your browser. You can see them, delete them, or switch learning off.

**No stealth mode.** What Pipe Up sends is visible or audible to everyone in the call, as coming from the user. The voice is clearly synthetic and is not a copy of the user's voice. Nothing is sent without a keypress.

Pipe Up is a communication aid. It does not diagnose, treat or claim to change how anyone speaks.

### How I built it

**Firebase AI Logic hybrid inference** is the engine. All text generation goes through the Firebase AI Logic Web SDK (`firebase/ai`) in `core/engine.js`.

- `getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true })` in `initFirebase()`.
- All four inference modes are used, each for a reason. During the call (`#buildModels()`):
  - `InferenceMode.ONLY_ON_DEVICE` — the default. Gemini Nano runs in Chrome. Nothing leaves the computer. The rules are given as a system prompt (`initialPrompts`) and the output is constrained to a JSON schema (`responseConstraint`).
  - `InferenceMode.PREFER_ON_DEVICE` — used only after the user allowed the cloud. The SDK picks the cloud when the device cannot run Gemini Nano.
  - `InferenceMode.ONLY_IN_CLOUD` — used only after consent, when Gemini Nano is present but failed.
- Before the call (`#buildPrepModels()`, `prepare()`, `core/prepare.js`):
  - `InferenceMode.PREFER_IN_CLOUD` — *Prepare with the cloud*. A cloud model reads the whole briefing (up to 4,000 words) in one request, after an inline confirmation that states what is sent. It does not turn on the cloud for the call.
  - `InferenceMode.ONLY_ON_DEVICE` — *Prepare on this computer*. Gemini Nano does the same job in up to 8 parts of 400 words, with progress and a Stop button.
  - Up to 6 questions with short answers come back as JSON, are checked (an answer with a number that is not in the briefing is discarded) and are stored with the briefing, locally. Every preparation appears in the routing log with the route really taken.
- `generateContentStream()` on both routes, with the same JSON schema (`core/prompt.js`), so the first reply shows before the model has finished.
- `inferenceSource` is read on every response. It drives the badge on the in-call panel ("On device" or "Cloud", `shared/overlay.js`) and the routing log in the Live tab (`shared/controls.js`), with the reason for each route.

**The hybrid design is a privacy design.** The route decides what data is used:

| Data | On device | Cloud (after consent) |
| --- | --- | --- |
| Last caption lines | 3 | 2 |
| Positions and briefing excerpts | yes | only with a second, separate opt-in |
| The user's past replies | yes | never |
| Audio | never | never |

**App Check.** The hosted demo uses reCAPTCHA Enterprise (`demo-web/demo.js`). Every cloud request carries a limited-use token. A Manifest V3 extension cannot load reCAPTCHA's remote script, so the extension accepts an App Check debug token, entered by the developer and kept only in the extension page's own storage (`extension/src/sidepanel.js`). It is never in the repository. On-device suggestions need no token. Enforcement is on: a direct request to the cloud endpoint without a token is rejected (HTTP 401).

**Remote Config** (`core/config.js`, `remoteconfig.template.json`) tunes the product without a new release: prompt variant, pause length before suggesting, early start (`speculate_ms`), maximum words, number of style examples and briefing excerpts, cloud model, and a kill switch for the cloud route. Bundled defaults apply if the fetch fails.

**Firebase Hosting** serves the demo. There is no account and no server-side user data, so Authentication and Firestore are not used. The briefing and the learned phrases stay in the browser.

**The rest of the stack.**
- `extension/` — Manifest V3. A content script reads the captions Meet already shows (`meet-captions.js`), draws the panel and posts to the chat (`meet-chat.js`). The side panel hosts the engine.
- `core/briefing.js` and `core/text.js` — the briefing is cut into short excerpts and ranked with a small lexical ranker, with no embeddings, so retrieval is instant and local.
- `core/memory.js` — style examples in IndexedDB, 90 days, 500 at most.
- `core/runner.js` and `core/pause.js` — one request at a time; a replaced request is really cancelled (`AbortSignal`); on device only, generation starts after a shorter silence and is shown at the normal pause if the captions did not change.
- `extension/src/voice.js`, `voice-worker.js`, `voices.js` and `voice-main.js` — Piper voices on ONNX Runtime in a worker, mixed into the microphone stream only while they speak. Each voice is downloaded on request from a fixed revision and checked with SHA-256. This is a speech synthesizer, not a generative model, and no other model API is called.
- `demo-web/` — the hosted demo runs the same `core/` and the same panel on a simulated call.
- `test/` — 97 unit tests and 5 end-to-end checks (demo, extension on a test Meet page, voice mixer, auto-play, real voice synthesis).

The code was written with the help of an AI coding assistant (Claude).

### Challenges I ran into

- **App Check in a Manifest V3 extension.** Extensions cannot load remote scripts, so reCAPTCHA is not an option. The extension keeps a debug token in extension-page storage, out of reach of web pages, and works fully on device without it.
- **A fallback that did not fall back.** With `PREFER_ON_DEVICE`, a request stayed on device when Gemini Nano was present but failing. I added a separate `ONLY_IN_CLOUD` instance for that case, behind the same consent.
- **One request at a time.** Captions keep coming while Gemini Nano is busy. At first a running request could not be stopped. Now the newest question wins and the request it replaces is really cancelled, on device and in the cloud. A stalled request times out so it cannot block the call.
- **Giving the cloud a real job.** A fallback is not a design. Reading a long briefing is the one task where a cloud model clearly helps, and it can happen before the call, once, with an explicit confirmation. That became "Prepare for the call".
- **The same output on two routes.** Gemini Nano takes `responseConstraint`; the cloud takes `responseJsonSchema`. Both share one schema, and a small parser reads complete replies out of a partial JSON stream.
- **A small on-device prompt.** Captions, positions, excerpts and examples have length limits. Captions and documents are fenced as data, so a sentence in a shared document is not treated as an instruction.
- **Living inside Meet's page.** Meet's class names change. Captions and chat are found through accessible labels. Keys use the physical key code, so 1 to 4 work on AZERTY keyboards and on a Mac. Enter, Tab and Esc are left to Meet when focus is on one of its controls.
- **A voice in the call.** The page script hands Meet a microphone track that mixes the real microphone with the synthetic voice, with a limiter; muting in Meet silences the voice at once. The phonemizer is GPL-3.0, so it ships as a separate program with its licence.
- **Licences and size.** The first voice I used turned out to be trained on recordings limited to non-commercial use. I removed it and offer only voices trained on public-domain recordings. The extension zip also went from 13.7 MB to 5.5 MB; part of that is keeping only the pronunciation data that English voices need.

### Accomplishments

- The hosted demo and the extension share one engine and one panel. What a judge tries in the demo is the code that runs in Meet.
- Every reply shows where it was generated, and the log says why.
- The cloud route is real and guarded: App Check, limited-use tokens, consent, a second opt-in for the briefing, a remote kill switch. I verified it in a real Chrome on Windows and on macOS.
- Measured with version 0.3.1 on a desktop with an RTX 4070 Ti and Chrome 157: the first on-device suggestion appears about 1.2 s after the pause. A cloud call takes about 4 to 7 s. The early start added since has not been measured on a real Gemini Nano yet.
- Accessibility is part of the product: keyboard first, screen-reader labels, five display and reading options.

### What I learned

- Hybrid inference is more than a fallback. Each route needs its own data rules, and the user must see which route answered.
- The research points first to holding the floor and to telling others. Generated replies are my addition, and the part that most needs feedback from users.
- On-device models change the conversation about privacy at work: a meeting does not have to leave the computer to get help.
- Reading papers is not enough. I need to hear from people who stutter.

### What's next

- Ask adults who stutter what is useful, what is wrong, and what is missing. Change the product accordingly.
- Verify the voice and the raise-hand option in live Meet calls with several participants.
- Measure the early start on real hardware.
- French, then other languages.

---

## What was built during the submission period

Everything. Pipe Up is a new project.

- First commit: November 12, 2026, after the start of the submission period (November 11, 1:30 PM PT).
- No pre-existing code was reused.
- Releases during the period: 0.1.0 (Nov 13), 0.2.0 and 0.2.1 (Nov 15), 0.3.0 and 0.3.1 (Nov 20), 0.4.0 (`<DATE OF THE 0.4.0 RELEASE>`). Release notes: https://github.com/Kilanga/pipe-up/tree/main/docs/releases
- Tools and third-party components: an AI coding assistant (Claude); the Firebase JS SDK and pdf.js (Apache-2.0); ONNX Runtime Web (MIT); piper-phonemize (MIT) with espeak-ng (GPL-3.0-or-later, shipped as a separate program); Piper voices trained on public-domain recordings, downloaded by the user on request. Details: https://github.com/Kilanga/pipe-up/blob/main/THIRD_PARTY_NOTICES.md

---

## Testing instructions for judges

No login. No token. No secret is needed or provided.

### A. Hosted demo — 60 seconds, nothing to install

1. Open https://pipe-up-demo.web.app in Chrome on a desktop.
2. Click **1. Load Sam's sample briefing** (the page reloads).
3. Click **2. Prepare the answers**, then **Prepare with the cloud**. Read the confirmation (it states what is sent) and confirm. Likely questions appear with short answers you can edit. The **Live** tab logs this request with its route. With Gemini Nano, **Prepare on this computer** does the same and sends nothing.
4. Click **Start the call**. A colleague asks Sam a question in the captions.

**If your Chrome has Gemini Nano** (see "Gemini Nano setup" below):

5. After the pause, three replies appear. The badge reads **On device**.
6. Press **1**, then **Enter**. The reply appears in *Call chat*.
7. Click **Next line**. Press **Alt+1**: "I'm still speaking, one moment." is posted. Press **4**: "I answered myself".
8. See both routes during the call: in the **Live** tab, tick *Demo: simulate a computer without Gemini Nano*, then tick *Allow the cloud when on-device AI is not available* and *Also send relevant briefing excerpts to the cloud*. Click **Next line**. The badge reads **Cloud**. The log under *Where suggestions were generated* shows both routes and the reason.

**If your Chrome does not have Gemini Nano:**

5. An amber banner explains it. Click **Try with the cloud**.
6. Click **Next line**. Three replies appear. The badge reads **Cloud**.
7. Press **1**, then **Enter**. Then **Alt+1**, then **4** on the next line.
8. Open the **Live** tab to read the routing log.

Without the cloud and without Gemini Nano, Pipe Up still works: quick phrases, your own typed reply and three basic replies.

Also worth 20 seconds: **Settings → Display and reading** (Easy reading, High contrast), and the **Memory** tab (what was learned, with delete buttons).

### B. The extension in Google Meet

1. Download `pipe-up-extension.zip` from https://github.com/Kilanga/pipe-up/releases/latest and unzip it into a new folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Start or join a Google Meet call (you use your own Google account; Pipe Up has no account). Turn on captions (**CC**).
4. Click the Pipe Up icon. The side panel opens. Click **Set up on-device AI** if it is offered.
5. Ask a second participant to say something, for example from a phone. Your own captions never trigger suggestions. After the pause, three replies appear in the panel on the Meet page.
6. Optional voice: in the side panel, **Live**, pick a voice and click **Set up the voice** (one download of about 64 MB). Then choose *Chat + synthetic voice* in the panel.

What works in the extension without any token: everything on device (suggestions and *Prepare on this computer*), the quick phrases, the briefing, the memory, the display options and the voice. The extension's cloud requests (the fallback and *Prepare with the cloud*) need an App Check debug token, which is not published. Use the hosted demo to test them.

### Gemini Nano setup

1. Chrome on desktop, up to date (measured on Chrome 157; Firebase AI Logic needs 139 or later: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started).
2. Hardware, from https://developer.chrome.com/docs/ai/prompt-api : Windows 10 or 11, macOS 13+, Linux or a Chromebook Plus; 22 GB of free disk space; a GPU with more than 4 GB of VRAM, or a CPU with 16 GB of RAM and 4 cores.
3. If the model is not offered: enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`. The hackathon FAQ also says to search `chrome://flags` for "Gemma 4 for Built-in AI" and enable it. Restart Chrome.
4. In the demo, the **Live** tab shows the status and a **Set up on-device AI** button (one download, several minutes).

---

## STILL TO CONFIRM

Resolved from the merged code on November 23: "Prepare for the call" (four inference modes), early start and real cancellation, the voice package (zip 5,518,705 bytes, three public-domain voices), test counts.

| # | Item | Where to edit in this file | What to write |
| --- | --- | --- | --- |
| 1 | The hosted demo is redeployed with 0.4.0 (today it still serves 0.3.1, without step "2. Prepare the answers") | *Testing instructions* A | Nothing to change once deployed. Do not submit before it is. |
| 2 | Release 0.4.0 is published | *What was built during the submission period* | The release date. |
| 3 | The voice and raise hand work in a live Meet call | *What's next* (remove the bullet) | "Verified in a live Google Meet call with a second participant." |
| 4 | Feedback from adults who stutter | *Inspiration* (the bold sentence) and *What I learned* | Use only the exact sentences in `feedback-outreach.md`. |
| 5 | Video URL | *Links* | The public YouTube URL. |
| 6 | Latency of the early start on a real Gemini Nano | *Accomplishments* | Add a figure only with its test conditions. Otherwise leave the text as it is. |
| 7 | Gemini Nano setup | *Gemini Nano setup* | Confirm on the measuring machine which flags were on and what `chrome://on-device-internals` reports. |
| 8 | Security fixes of 0.4.0 | privacy sentences | Edited by the security pass only. |
