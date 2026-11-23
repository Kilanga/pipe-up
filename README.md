# Pipe Up

**A backup channel for people who stutter in video calls. One key holds the floor; three short replies come from what you prepared. Generated on your device with Firebase AI Logic hybrid inference, in Google Meet.**

> **For judges (60 seconds)**
> - **What it is:** a Chrome extension for Google Meet, plus a hosted demo that runs the same engine and the same in-call panel on a simulated call.
> - **Try it:** open https://pipe-up-demo.web.app → click **1. Load Sam's sample briefing** → **2. Prepare the answers** → **Prepare with the cloud** and confirm → **Start the call** → press **1**, then **Enter**. Press **Alt+1** to hold the floor, **4** when you answered yourself.
> - **Cloud before the call, device during the call:** the cloud reads the briefing once, after an explicit confirmation, and prepares short answers. During the call, Gemini Nano uses them on the device.
> - **No Gemini Nano on your computer?** Click **Try with the cloud** in the amber banner. The badge on the panel then reads *Cloud* instead of *On device*, and the *Live* tab logs the route of every request.
> - **Where Firebase AI Logic is called:** [`core/engine.js`](core/engine.js) — `getAI()` in `initFirebase()`, `getGenerativeModel()` in all four modes (`ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `ONLY_IN_CLOUD` in `#buildModels()`; `PREFER_IN_CLOUD` in `#buildPrepModels()`), `generateContentStream()` in `#run()` and `generateContent()` in `prepare()`, which both read `inferenceSource`. App Check and Remote Config are set up in the same file.
> - **Status, plainly:** built solo during the hackathon. Not yet tested with people who stutter.

<!-- SCREENSHOTS: real captures from a real Chrome go here (do not generate them).
     Uncomment once the three files exist.
![The in-call panel: three short replies, the "On device" badge and the quick phrases](docs/img/overlay.png)
*The in-call panel in Google Meet: three short replies, where they were generated, and the hold-the-floor key.*

![The routing log in the Live tab](docs/img/routing-log.png)
*The routing log: for each request, on device or cloud, how long it took and why.*

![The Briefing tab](docs/img/briefing.png)
*The briefing: your positions, your notes and a document, read on your computer.*
-->

## Why

People who stutter speak for themselves. Video calls make that harder. In a UK survey of adults who stammer, run during the COVID-19 pandemic, most respondents said video calls increase anxiety (65%) and make communication more difficult (63%) than face to face. Respondents named time pressure and people talking over each other as hard moments, and said the chat helps when speaking is difficult ([Chesters et al., North Bristol NHS Trust with STAMMA and the RCSLT, executive summary](https://www.nbt.nhs.uk/sites/default/files/document/Stammer_Executive_Summary.pdf)).

A co-design study with eight people who stutter starts from the same place: during a block, others may assume the connection is frozen and talk over the person. Two ideas the participants liked: an *"I'm still speaking"* button, and a way to tell others that they stutter ([Li, Wu & Leshed, DIS 2024](https://doi.org/10.1145/3643834.3661533); [summary in the Cornell Chronicle](https://news.cornell.edu/stories/2024/07/redesigning-videoconferencing-and-people-who-stutter)).

Pipe Up starts from those two ideas. It reads the captions Google Meet already shows. When a block comes at a busy moment, it offers a backup: a one-key *"I'm still speaking, one moment."*, and three short replies grounded in what you prepared. Your own speech comes first, and nothing is sent without a keypress.

> Pipe Up is a communication aid. It does not diagnose, treat or claim to change how anyone speaks.

## What it does

- **Hold the floor:** **Alt+1** posts "I'm still speaking, one moment." The quick phrases are editable. **Alt+D** sends an optional line, empty by default, that tells others about your stutter in your own words.
- **Three short replies** (12 words at most) after a pause in the captions, or only when you ask (**Alt+S**, "on-demand" mode). Keys **1 / 2 / 3** to pick, **Enter** to send, **Tab** to edit before sending, **Esc** to cancel.
- **Key 4, "I answered myself":** Pipe Up steps aside and keeps following the conversation.
- **Briefing:** before the call, list *My positions*, write notes and/or upload a document (.txt, .md, .pdf, read locally with pdf.js). Replies that use it are labelled *From your briefing*. The model is instructed never to invent facts, numbers or commitments; check before you send.
- **Prepare for the call:** one click turns the briefing into up to 6 likely questions, each with a short answer you can edit, add to or delete. *Prepare with the cloud* shows what will be sent and asks you to confirm, then makes one request; it does not turn on the cloud for the call. *Prepare on this computer* does the same with Gemini Nano, part by part, with a *Stop* button. A prepared answer that contains a number absent from your briefing is discarded. During the call, a matching prepared answer is offered as a reply, labelled *From your briefing*.
- **Learns your phrasing, on your device:** the replies you pick, edit or write become style examples (IndexedDB, 90 days, 500 at most). You can switch learning off, see what was learned and delete it. Nothing you say out loud is recorded.
- **Display and reading options** (all off by default): *Easy reading* (more spacing, larger text, replies of 8 words at most), *One suggestion at a time*, *Hear the suggestions* (in your own headphones only, never into the call), *High contrast* (nothing relies on color alone), *Reduce motion* (the system setting is always followed).
- **Output:** Meet chat, a synthetic voice in the call, or both. The voice is generated on your computer and mixed into your microphone only while it speaks; muting in Meet silences it at once. Three English voices to choose from. The quick phrases and the Alt+D line are synthesized in advance, so they are spoken without waiting. A reply the voice cannot speak goes to the chat.
- **Optional, off by default:** also raise your hand in Meet when you send "I'm still speaking" (extension only).

## No stealth mode

Pipe Up has no stealth mode.

- What it sends is visible or audible to everyone in the call, as coming from you: a chat message you posted, or a voice on your microphone.
- The voice is clearly synthetic. It is a stock text-to-speech voice, not a copy of yours.
- Replies draw on what you prepared; when your notes do not cover a question, they stay neutral. Nothing is sent without a keypress, and key **4** keeps your own speech first.
- **Alt+D** lets you tell colleagues, in your own words, that you stutter and how you use Pipe Up.
- Nothing in the code hides the panel from screen sharing or from anyone.

For colleagues, nothing changes on their side and nothing they say is recorded.

## How Firebase AI Logic is used

All text generation goes through the Firebase AI Logic Web SDK (`firebase/ai`), in [`core/engine.js`](core/engine.js):

```js
const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });

// Default: Gemini Nano on the device, rules as a system prompt, JSON output
const deviceModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: { initialPrompts: [{ role: 'system', content: rules }] },
                    promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA } },
});
// After consent only: let the SDK fall back to the cloud when Nano is missing…
const hybridModel = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams });
// …or force the cloud when Nano is present but failed
const cloudModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams });
// Before the call, after an explicit click: a cloud model reads the briefing once
const prepCloudModel = getGenerativeModel(ai, { mode: InferenceMode.PREFER_IN_CLOUD, onDeviceParams, inCloudParams });

const { stream, response } = await deviceModel.generateContentStream(prompt); // replies appear as they complete
(await response).inferenceSource; // ON_DEVICE | IN_CLOUD → badge and routing log
```

- **Cloud before the call, device during the call:** *Prepare for the call* is the one job given to the cloud on purpose: reading a long briefing (up to 4,000 words) in one `PREFER_IN_CLOUD` request, after a confirmation that states what is sent. The answers are stored with the briefing on the computer. The same job can run on Gemini Nano instead (`ONLY_ON_DEVICE`, up to 8 parts of 400 words). Every preparation appears in the routing log with the route really taken.
- **Hybrid inference, privacy first:** during the call, on device by default. The cloud is used only when the device cannot run Gemini Nano (or Nano fails) *and* the user allowed it. The badge and the *Where suggestions were generated* log read `inferenceSource` for every request, with the reason for the route.
- **What may reach the cloud:**

  | Data | On device | Cloud (after consent) |
  | --- | --- | --- |
  | Last caption lines | 3 | 2 |
  | *My positions* and briefing excerpts | yes | only with a second, separate opt-in |
  | Your past replies (style examples) | yes | never |
  | Audio | never | never |

- **Streaming** on both paths with the same JSON schema. One request at a time, the newest question wins, and the request it replaces is really cancelled (`AbortSignal`, [`core/runner.js`](core/runner.js)).
- **Early start, on device only:** generation starts after a shorter silence (`speculate_ms`, 500 ms by default) and is shown at the normal pause if the captions did not change ([`core/pause.js`](core/pause.js)). It never runs on the cloud route.
- **Prompt safety:** captions and documents are fenced as data, with length limits, so text in a shared document or a caption is not treated as an instruction.
- **App Check:** reCAPTCHA Enterprise on the hosted demo, limited-use tokens on every cloud request. In the extension, a debug token entered by the developer and kept only in the extension's own storage (Manifest V3 extensions cannot load reCAPTCHA's remote script). On-device suggestions need no token and no network.
- **Remote Config:** prompt variant (`prompt_version`: `1` plain, `2` warm, `3` professional), pause length, early start (`speculate_ms`, 0 turns it off), maximum words, style examples, briefing excerpts, cloud model, and a cloud kill switch ([`remoteconfig.template.json`](remoteconfig.template.json)).
- **Not generative AI:** the optional voice is a local speech synthesizer (Piper voices on ONNX Runtime, in a worker). No other model API is called.

## Architecture

```
Google Meet captions ──▶ content script: overlay, keys, chat output ──▶ Meet chat
                               │  named port (one side panel serves one Meet tab)
                               ▼
                         side panel = engine (core/)
             prompt · briefing retrieval · local memory · local voice (Piper)
                               │                                 │
                     Firebase AI Logic (hybrid)          PCM audio ──▶ page script mixes it
                ┌──────────────┴──────────────┐                        into Meet's microphone
         Gemini Nano (on device)      Gemini (cloud, consent only)
```

```
core/        engine (Firebase AI Logic), preparation, request runner, prompt, briefing, memory
shared/      in-call overlay, settings/briefing/memory screens, document reader
extension/   Manifest V3 extension (content scripts, side panel, voice worker)
demo-web/    hosted demo: a simulated call using the same core and overlay
test/        97 unit tests (`npm test`) and end-to-end checks (`node test/e2e/<name>.mjs` after `npm run build`; they need Playwright and Chrome)
```

## Try it

- **Hosted demo:** https://pipe-up-demo.web.app — no account, no token. Its voice is the browser's speech synthesis; the extension uses the local Piper voice.
- **Extension:** download `pipe-up-extension.zip` from the [latest release](https://github.com/Kilanga/pipe-up/releases/latest) and unzip it into a new folder. Open `chrome://extensions`, enable *Developer mode*, click *Load unpacked* and pick that folder. Join a Meet call, turn on captions (CC), click the Pipe Up icon to open the side panel, then *Set up on-device AI*. For the voice, pick one in the Live tab and click *Set up the voice* (one download of about 64 MB per voice, from a fixed revision of `rhasspy/piper-voices` on Hugging Face, checked with SHA-256 before use). If you used the voice of version 0.3.1 or earlier, set one up again: that voice was removed.

Without Gemini Nano, the extension offers the quick phrases, your own typed replies and three basic replies. Its cloud path needs an App Check debug token, which is not published: use the hosted demo to try the cloud path.

### Gemini Nano setup (on-device path)

1. **Chrome on desktop, up to date.** Measured on Chrome 157. Firebase AI Logic's on-device inference needs Chrome 139 or later on desktop ([Firebase docs](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started)).
2. **Hardware** ([Chrome docs](https://developer.chrome.com/docs/ai/prompt-api)): Windows 10 or 11, macOS 13+, Linux, or ChromeOS on a Chromebook Plus; at least 22 GB free on the disk that holds your Chrome profile; a GPU with more than 4 GB of VRAM, **or** a CPU with 16 GB of RAM and 4 cores; an unmetered connection for the first download.
3. **Flags, if the model is not offered:** set `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` to *Enabled* (Firebase docs, same page). The [hackathon FAQ](https://firebasehybridaihackathon.devpost.com/details/faqs) adds: in `chrome://flags`, search for **"Gemma 4 for Built-in AI"** and enable it. Restart Chrome.
4. **Check:** in Pipe Up, the *Live* tab shows the status and a *Set up on-device AI* button (one download, several minutes). You can also open `chrome://on-device-internals`, or run `await LanguageModel.availability()` in the DevTools console: it should answer `available`.

**Measured** with version 0.3.1 on a desktop with an RTX 4070 Ti, Chrome 157: the first on-device suggestion appears about 1.2 s after the pause; a cloud call takes about 4 to 7 s. The early start added since then has not been measured on a real Gemini Nano yet.

## Build it yourself

1. Create a Firebase project, add a Web app, enable **Firebase AI Logic** (Gemini Developer API).
2. App Check: register a reCAPTCHA Enterprise site key for your hosting domain; for the extension, create a debug token and paste it in *Settings → Cloud access*. Never commit it.
3. Copy `config/firebase.example.json` to `config/firebase.local.json` and fill it in (git-ignored).
4. `npm install && npm test && npm run build` → `dist/extension`, `dist/demo`, `dist/pipe-up-extension.zip`.
5. `firebase deploy --only hosting,remoteconfig`.

## Privacy

Pipe Up reads the captions Meet already shows. It never records audio and keeps only the last few caption lines in memory. For the voice, it mixes a synthetic voice into your microphone stream only while it plays. No analytics. Network use: Firebase (Remote Config; the Gemini API only on the consent-based cloud path) and one download of the voice model from Hugging Face if you set up the voice. The hosted demo also loads reCAPTCHA Enterprise for App Check. Permissions: `meet.google.com`, storage, side panel, clipboard (fallback when the chat cannot be reached).

## Known limits

- **Pipe Up has not yet been tested with people who stutter.** Its design follows published research, not user testing. Getting that feedback is the first next step.
- **The voice and the raise-hand option have not yet been verified in a live Meet call with a second participant.** The voice is covered by automated checks: real synthesis (`test/e2e/voice.mjs`) and the microphone mixer on a test page (`test/e2e/voice-mixer.mjs`).
- Meet's page changes often; captions and chat are found through accessible labels in the main UI languages. If your own captions are not labelled "You", set your display name in *Settings*.
- English only for now: Pipe Up declares English to Gemini Nano, and the three voices are English.
- The extension and the on-device path need Chrome on desktop.

## Prior art and how Pipe Up differs

- **Videoconferencing designed with people who stutter:** [LibOrate](https://aimpower.org/), by AImpower.org, is a companion app for Zoom designed for, with and by people who stutter. AImpower.org's researchers led the co-design study above. It is the closest work in purpose.
- **AI-assisted AAC:** [SpeakFaster](https://research.google/blog/speakfaster-revolutionizing-communication-for-people-with-severe-motor-impairments/) (Google Research with Team Gleason) and [Gaze Link](https://android-developers.googleblog.com/2024/11/gaze-link-wins-best-android-app-gemini-api-developer-competition.html) (Gemini API Developer Competition) use language models to help people with ALS type with their eyes. AAC users want suggested phrases to reflect their own style ([Valencia et al., CHI 2023](https://doi.org/10.1145/3544548.3581560)); deep personalization raises questions of agency, identity and privacy ([Weinberg et al., CHI 2026](https://doi.org/10.1145/3772318.3790310)).
- **Type or whisper to speak:** [Apple Live Speech](https://support.apple.com/105018) speaks typed text in FaceTime and phone calls; [Whispp](https://techcrunch.com/2024/01/11/whispp-voice-app/) converts whispered speech into voiced speech during calls.
- **Hidden meeting assistants:** some products prompt their user through a window that others cannot see, and are marketed as "undetectable" ([TechCrunch on Cluely](https://techcrunch.com/2025/04/29/startups-launch-products-to-catch-people-using-ai-cheating-app-cluely/)).

Pipe Up differs on four points. It is a backup for people who speak for themselves, not a replacement for speech. It has no stealth mode. Replies draw on what the user prepared and are sent only on a keypress. Generation runs on the device by default, so a work conversation does not have to leave the computer.

## Built during #BuildHybridAI 2026

First commit: November 12, 2026. No pre-existing project code was reused. The code was written with the help of an AI coding assistant (Claude). Release notes for each version are in [`docs/releases`](docs/releases); the submission documents are in [`docs/submission`](docs/submission).

## License

Pipe Up's code: [Apache-2.0](LICENSE). The built extension also bundles separately licensed components, including the optional voice module's phonemizer (espeak-ng, GPL-3.0-or-later). The voices are downloaded on request and are trained on public-domain recordings: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<!-- STILL TO CONFIRM (details in docs/submission/compliance.md)
1. Live Meet call with a second participant: captions, chat, voice, raise hand. Then remove the matching "Known limits" line.
2. Feedback from adults who stutter: replace the first "Known limits" line only with the wording in docs/submission/feedback-outreach.md.
3. Screenshots: uncomment the block at the top once docs/img/overlay.png, routing-log.png and briefing.png exist.
4. Latency: re-measure on a real Gemini Nano before changing or adding any number.
5. Gemini Nano setup: confirm on the measuring machine which flags were enabled and what chrome://on-device-internals reports.
6. Hosted demo redeployed with this version (step "2. Prepare the answers" must be live before judges read the first block).
-->
