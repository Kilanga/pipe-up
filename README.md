# Pipe Up

**A backup channel for people who stutter in video calls — reply suggestions and turn-holding phrases in Google Meet, generated on your device with Firebase AI Logic hybrid inference.**

Most people who stutter speak for themselves, and should. But video calls make it harder: there is time pressure, no visual cue that the other person has finished, and a block can look like a frozen connection. In a UK survey of people who stammer, 65% said video calls increase their anxiety and 63% said they make communication harder than face to face ([summary](https://www.nbt.nhs.uk/sites/default/files/document/Stammer_Executive_Summary.pdf)). In co-design research, people who stutter asked for ways to *hold the floor* during a block and to normalize stuttering — not for a tool that speaks for them ([Wu et al., DIS 2024](https://news.cornell.edu/stories/2024/07/redesigning-videoconferencing-and-people-who-stutter)).

Pipe Up follows that brief. It reads the captions Google Meet already shows and, when a block comes at a busy moment, offers a backup: a one-key *"I'm still speaking, one moment."*, and three short replies grounded in what you prepared, to post in the chat or have read aloud. Your own speech comes first: press **4** whenever you answered yourself, and nothing is ever sent without you.

> Pipe Up is a communication aid. It does not diagnose, treat or claim to change how anyone speaks.

**Try it:** https://pipe-up-demo.web.app (simulated call, no Meet meeting needed) · **Extension:** [latest release](https://github.com/Kilanga/pipe-up/releases/latest)

## What it does

- **Hold the floor:** **Alt+1** posts "I'm still speaking, one moment." Your quick phrases are editable; an optional, empty-by-default line lets you tell others about your stutter in your own words (**Alt+D**).
- **Three short replies** (12 words max) after a pause in the captions, or only when you ask (**Alt+S**, "on-demand" mode). Keys **1 / 2 / 3** to pick, **Enter** to send, **Tab** to edit before sending, **Esc** to cancel.
- **Key 4 — "I answered myself":** Pipe Up steps aside and keeps following the conversation.
- **Briefing:** before the call, list *My positions*, write notes and/or upload a document (.txt, .md, .pdf, read locally with pdf.js). Suggestions grounded in it are labelled *From your briefing*; the model is told never to invent facts, numbers or commitments.
- **Learns your phrasing, on your device:** the replies you pick, edit or write become style examples (IndexedDB, 90 days, 500 max). *Don't learn* switch, *What Pipe Up has learned* screen, delete one or everything. Nothing you say out loud is recorded.
- **Display and reading options** (Settings, all off by default): *Easy reading* (more letter and line spacing, larger text, replies of 8 words at most, for dyslexia or reading under pressure), *One suggestion at a time*, *Hear the suggestions* (read aloud in your own headphones only, never into the call), *High contrast* (black and white with a yellow highlight; nothing relies on color alone), *Reduce motion* (the system setting is always followed).
- **Output:** Meet chat, a local voice in the call, or both. The voice is generated on your computer and mixed into your microphone only while it speaks; muting in Meet mutes it too.

## How Firebase AI Logic is used

All generation goes through the Firebase AI Logic Web SDK (`firebase/ai`) — see [`core/engine.js`](core/engine.js):

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

const { stream, response } = await deviceModel.generateContentStream(prompt); // replies appear as they complete
(await response).inferenceSource; // ON_DEVICE | IN_CLOUD → badge and routing log
```

- **Hybrid inference, privacy first:** on-device by default; the cloud is used only when the device cannot run Gemini Nano (or Nano fails) *and* the user allowed it. The badge and the *Where suggestions were generated* log read `inferenceSource` for every request, with the reason for the route.
- **What may reach the cloud:**

  | Data | On device | Cloud (after consent) |
  | --- | --- | --- |
  | Last caption lines | 3 | 2 |
  | *My positions* and briefing excerpts | yes | only with a second, separate opt-in |
  | Your past replies (style examples) | yes | never |
  | Audio | never | never |

- **Streaming** on both paths with the same JSON schema; one request at a time, the newest question wins (Gemini Nano cannot cancel a running request).
- **Prompt safety:** captions and documents are fenced as data, with length limits, so text in a shared document or a caption cannot steer the model.
- **App Check:** reCAPTCHA Enterprise (Fraud Defense) on the hosted demo, limited-use tokens on every cloud request; a debug token kept only in the extension's own storage (MV3 extensions cannot load reCAPTCHA). On-device suggestions need no network.
- **Remote Config:** prompt variant (`prompt_version`: `1` plain, `2` warm, `3` professional), pause length, max words, examples, briefing excerpts, cloud model, and a cloud kill switch ([`remoteconfig.template.json`](remoteconfig.template.json)).

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
core/        engine (Firebase AI Logic), prompt, briefing, memory, text ranking
shared/      in-call overlay, settings/briefing/memory screens, document reader
extension/   Manifest V3 extension (content scripts, side panel, voice)
demo-web/    hosted demo: a simulated call using the same core and overlay
test/        unit tests (node --test)
```

## Try it

- **Hosted demo:** https://pipe-up-demo.web.app — click *Load Sam's sample briefing*, then *Start the call* (or *Auto-play*). On a computer without Gemini Nano, click *Try with the cloud*. The demo's voice is the browser's speech synthesis; the extension uses the local Piper voice.
- **Extension:** download `pipe-up-extension.zip` from the [latest release](https://github.com/Kilanga/pipe-up/releases/latest), unzip, open `chrome://extensions`, enable Developer mode, *Load unpacked*. Join a Meet call, turn on captions (CC), click the Pipe Up icon to open the side panel, then *Set up on-device AI*. For the voice, click *Set up the voice* in the Live tab (about 60 MB, once).

Without Gemini Nano, the extension offers basic replies only (its cloud path needs an App Check debug token): use the hosted demo to try the cloud path.

**Measured** on a desktop with an RTX 4070 Ti, Chrome 157: first on-device suggestion about 1.2 s after the pause; cloud calls about 4 to 7 s.

**On-device requirements:** Chrome desktop 139+, about 22 GB free disk space, a GPU with more than 4 GB of VRAM. If needed, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart Chrome.

## Build it yourself

1. Create a Firebase project, add a Web app, enable **Firebase AI Logic** (Gemini Developer API).
2. App Check: register a reCAPTCHA Enterprise (Fraud Defense) site key for your hosting domain; for the extension, create a debug token and paste it in *Settings → Cloud access*.
3. Copy `config/firebase.example.json` to `config/firebase.local.json` and fill it in (git-ignored).
4. `npm install && npm test && npm run build` → `dist/extension`, `dist/demo`, `dist/pipe-up-extension.zip`.
5. `firebase deploy --only hosting,remoteconfig`.

## For colleagues in the call

They see short messages in the Meet chat, posted by the person who uses Pipe Up, or hear a synthetic voice through that person's microphone. Nothing changes on their side, and nothing they say is recorded. Users can explain it in their own words with the optional disclosure line (Alt+D).

## Privacy

Pipe Up reads the captions Meet already shows; it never records audio or keeps a transcript beyond the last few lines in memory. To speak for you, it mixes its local voice into your microphone stream only while it plays. No analytics. Permissions: `meet.google.com`, storage, side panel, clipboard (fallback when the chat cannot be reached).

## Known limits

- Meet's page changes often; captions and chat are found through accessible labels in the main UI languages. If your own captions are not labelled "You", set your display name in *Settings*.
- Gemini Nano's on-device prompts support English best; Pipe Up declares English.
- The voice is English and there is one voice for now (Piper `en_US-hfc_female-medium`). Choosing a voice, and a French voice, are next.

## Prior art and credits

Pipe Up builds on AAC research and products (SpeakEasy, Lingraphica, Valencia et al. CHI 2023 on AI replies in AAC, Weinberg et al. CHI 2026) and on Wu et al.'s co-design work with people who stutter. Its focus is the middle ground: people who speak for themselves and want a backup when speech doesn't come on time, in work video calls.

Built during #BuildHybridAI 2026, starting November 12, 2026. Code written with the help of an AI coding assistant (Claude). No pre-existing project code was reused.

## License

Pipe Up's code: [Apache-2.0](LICENSE). The built extension also bundles separately licensed components, including the optional voice module's phonemizer (espeak-ng, GPL-3.0): see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
