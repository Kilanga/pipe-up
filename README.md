# Pipe Up

**Reply suggestions in video calls for people with speech differences — on-device AI first, with Firebase AI Logic hybrid inference.**

People who stutter, or who live with mild dysarthria or word-finding difficulties, often stay silent in video meetings: there is time pressure, no visual cue that the other person has finished, and talking over each other is common. Pipe Up is a Chrome extension that reads the live captions Google Meet already displays, suggests three short replies when the other person pauses, and lets the user answer by chat, by voice, or both — or answer out loud themselves and simply press **4**.

> Pipe Up is a communication aid. It does not diagnose, treat or claim to improve speech.

## What it does

- **Three short replies** (12 words max) after a pause in the captions. Keys **1 / 2 / 3** to pick, **Enter** to send, **Esc** to cancel. Nothing is sent without confirmation.
- **Mixed mode — key 4: "I answered myself".** Pipe Up assumes you can speak; it steps aside and keeps following the conversation.
- **Briefing.** Before the call, write notes, list *My positions*, and/or upload a document (.txt, .md, .pdf, read locally with pdf.js). Suggestions are grounded in what you prepared and labelled *From your briefing*; the prompt forbids inventing facts, numbers or commitments.
- **Learns your phrasing on your device.** Every reply you pick, type or say yourself is stored locally (IndexedDB) and the closest past replies become style examples in the prompt. *Don't learn* switch, *What Pipe Up has learned* screen, delete one or everything. 90-day retention, 500 events max.
- **Quick phrases** (Alt+1…3): "One moment, please.", "Could you repeat that?"…
- **Output:** chat only, chat + voice, voice only (see *Status* for voice).

## How Firebase AI Logic is used

All generation goes through the Firebase AI Logic Web SDK (`firebase/ai`) — see [`core/engine.js`](core/engine.js):

```js
const ai = getAI(app, { backend: new GoogleAIBackend() });

// On-device by default: Gemini Nano through Chrome's Prompt API
const deviceModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: {...}, promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA } },
});
// Cloud fallback, only after explicit consent
const hybridModel = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, inCloudParams: {...} });

const result = await deviceModel.generateContent(prompt);
result.response.inferenceSource; // "on_device" | "in_cloud" → drives the badge
```

- **Hybrid inference:** Gemini Nano on the device first (private and fast); cloud Gemini only when the device cannot run Nano *and* the user allowed it. The badge shows where each suggestion was really generated, from `inferenceSource`.
- **What goes to the cloud:** only the last two caption lines. The personal history is never sent; briefing excerpts only with a second, separate opt-in.
- **Structured output** on both paths with the same JSON schema.
- **App Check:** reCAPTCHA Enterprise (Fraud Defense) on the hosted demo; a locally entered debug token in the extension (MV3 cannot load the reCAPTCHA script). On-device suggestions need no network at all.
- **Remote Config:** prompt version, pause length, max words, number of examples, cloud model, and a cloud kill switch ([`remoteconfig.template.json`](remoteconfig.template.json)).

## Architecture

```
Google Meet captions ──▶ content script (overlay, keys 1–4, chat output)
                               │  chrome.runtime messages
                               ▼
                         side panel = engine (core/)
                   prompt · briefing retrieval · local memory
                               │
                     Firebase AI Logic (hybrid)
                ┌──────────────┴──────────────┐
         Gemini Nano (on device)      Gemini (cloud, consent only)
```

```
core/        engine (Firebase AI Logic), prompt, briefing, memory, text ranking
shared/      in-call overlay, settings/briefing/memory screens, document reader
extension/   Manifest V3 extension (content script, side panel, service worker)
demo-web/    hosted demo: a simulated call using the same core and overlay
test/        unit tests (node --test)
```

## Try it

- **Hosted demo:** https://pipe-up-demo.web.app — a simulated call, no Meet meeting needed. Click *Load Sam's sample briefing*, then *Start the call*.
- **Extension:** download `pipe-up-extension.zip` from the latest release, unzip, open `chrome://extensions`, enable Developer mode, *Load unpacked*. Join a Meet call, turn on captions (CC), click the Pipe Up icon to open the side panel, then *Set up on-device AI*.

**On-device requirements:** Chrome desktop 139+, about 22 GB free disk space, a GPU with more than 4 GB of VRAM. If needed, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart Chrome.

## Build it yourself

1. Create a Firebase project, add a Web app, enable **Firebase AI Logic** (Gemini Developer API).
2. App Check: register a reCAPTCHA Enterprise (Fraud Defense) site key for your hosting domain; for the extension, create a debug token and paste it in *Settings → Cloud access*.
3. Copy `config/firebase.example.json` to `config/firebase.local.json` and fill it in (this file is git-ignored).
4. `npm install && npm test && npm run build` → `dist/extension`, `dist/demo`, `dist/pipe-up-extension.zip`.
5. `firebase deploy --only hosting,remoteconfig`.

## Privacy

No audio is captured: Pipe Up only reads captions Meet already shows. No transcript is kept beyond the last few lines in memory. No analytics. Permissions are limited to `meet.google.com`, storage and the side panel.

## Status

Built for #BuildHybridAI 2026, starting November 12, 2026. Working: captions reading, suggestions (on-device and cloud), briefing (typed + document), local learning, chat output, quick phrases, key 4, demo page. **In progress:** voice into the call. The Web Speech API's audio cannot be captured, so voice output needs a local speech engine (WebAssembly) mixed into the microphone stream; until then, voice modes also post to the chat (the demo page plays the voice on your speakers).

## Prior art and credits

Pipe Up builds on ideas from AAC research and products (e.g. SpeakEasy, Lingraphica, Weinberg et al. CHI 2026 on personalized AAC) and from meeting reply assistants. Its focus is the middle ground: people who *can* speak but not always when and how they want, in work video calls.

Open-source dependencies: Firebase JS SDK, pdf.js (Apache-2.0), esbuild (MIT). Code written with the help of an AI coding assistant (Claude). No pre-existing project code was reused.

## License

[Apache-2.0](LICENSE)
