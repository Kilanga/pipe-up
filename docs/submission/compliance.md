# Compliance check — Pipe Up, #BuildHybridAI 2026

Checked on **November 24, 2026** against the official rules (https://firebasehybridaihackathon.devpost.com/rules), the overview and the FAQ (https://firebasehybridaihackathon.devpost.com/details/faqs), on the code of version 0.4.0 (branch `agent/final`: security fixes merged, version bumped). Deadline: **November 30, 2026, 2:00 PM Pacific** (23:00 in Paris); the FAQ states that it is fixed. This file is a working checklist for the entrant: none of it is pasted into the form. What is left to do is gathered in the last section, **For Arnaud only — do not paste**.

Status: **OK** = verified now. **To do** = an action is still needed. **Risk** = could cost the Stage One pass/fail or a rights problem; read the action.

Owners: **Arnaud** = only the entrant can do it. **Release pass** = whoever bumps the version, publishes the release and deploys the demo.

## Full table

### Entrant and form

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 1 | Entrant is eligible: above the age of majority, not a resident of an excluded country, not a Contest Entity, not a government employee; an individual entry does not conflict with an employer's policies | To do (confirm) | Rules §3. France is not in the list of excluded places. Nothing in the repository can prove the rest. | **Arnaud:** confirm you enter as an individual and that nothing in your employment terms conflicts with it. |
| 2 | Select at least one platform | To do | Rules §6, "Submission Requirements". | **Arnaud:** select **Web/Chrome** on the form. |
| 3 | Each submission by the same entrant is unique and substantially different | OK | Rules §6, "Multiple Submissions". The entrant also entered a separate project (a finance app). The two share no code, repository, audience or demo; `devpost.md` says so under "What was built during the submission period". | **Arnaud:** keep that sentence on the form, and the matching one on the other entry. |

### What to create

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 4 | Built with Firebase AI Logic, imported and actually called at runtime, not just named in the README | OK | `core/engine.js`: line 2 `import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai'`; line 99 `getAI(...)` in `initFirebase()`; line 178 `getGenerativeModel(firebase.ai, params)`; lines 219–221 `ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `ONLY_IN_CLOUD` in `#buildModels()`; lines 243, 246 and 248 `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD` and `ONLY_ON_DEVICE` in `#buildPrepModels()`; line 338 `generateContentStream(...)` in `#run()`; line 400 `generateContent(...)` in `prepare()`; lines 355 and 402 `inferenceSource`. `firebase` 13.3.0 (docs ask for 12.5.0 or later). | None. The README and `devpost.md` name functions, not lines. |
| 5 | Uses hybrid inference: on-device and cloud | OK | All four modes are used. During the call: on device by default, cloud only as a consent-gated fallback. Before the call: *Prepare with the cloud* is one request after an inline confirmation (`PREFER_IN_CLOUD` up to about 1,600 words, `ONLY_IN_CLOUD` above); *Prepare on this computer* runs on Gemini Nano. Covered by `test/prepare.test.js` and `test/engine.test.js`. FAQ: "Firebase wants to see both on-device and cloud inference". | **Arnaud:** the video must show both (script rows 5 to 7). |
| 6 | All AI inference goes through Firebase AI Logic; no other model API is called directly (FAQ) | OK, low risk | `git grep` finds no other model API. `LanguageModel.availability()` in `deviceStatus()` only reads the status. The voice is a local speech synthesizer (Piper, ONNX Runtime, WebAssembly): no API call, not generative. | None. The README and the Devpost text say it in one sentence, so a judge does not have to guess. |
| 7 | Web (Chrome) with Gemini Nano via Firebase AI Logic; the FAQ names "Gemini Nano 4" and a Chrome flag | To do | Sources fetched: Firebase docs (Chrome desktop 139+, flag `#prompt-api-for-gemini-nano-multimodal-input`), Chrome docs (hardware: GPU with more than 4 GB VRAM **or** CPU with 16 GB RAM and 4 cores, 22 GB free), FAQ ("search for 'Gemma 4 for Built-in AI' and enable it"). The README and the testing instructions now give all three. I could not run a Chrome with Gemini Nano here. | **Arnaud:** on the Chrome 157 machine, open `chrome://flags` and `chrome://on-device-internals`; note which of the two flags exist and are on, and the model name shown. Correct the setup steps if they differ. |
| 8 | Uses supported Firebase products (App Check, Remote Config, Firestore, Authentication) | OK | App Check and Remote Config in `core/engine.js`; Firebase Hosting in `firebase.json`. Firestore and Authentication are not used. FAQ: App Check is required, the others are "encouraged but optional". | None. |
| 9 | App Check is required; debug tokens are accepted; never commit them | OK | Code: `initializeAppCheck` (lines 23 and 26), `useLimitedUseAppCheckTokens: true`, `ReCaptchaEnterpriseProvider` in `demo-web/demo.js`. **Enforcement verified:** a direct request to the Firebase AI Logic endpoint of the demo project without an App Check token returned `HTTP 401 "Firebase App Check token is invalid."` No token in the tree or the history (row 21). | **Arnaud:** revoke the debug token in the Firebase console after judging ends. |
| 10 | Remote Config is really used | To do (confirm) | Code: `fetchAndActivate` with bundled defaults (`core/config.js`); `remoteconfig.template.json` now has eight parameters (`speculate_ms` is new). The deployed template cannot be read from here. | **Release pass:** `firebase deploy --only remoteconfig`. **Arnaud:** the console shows the eight parameters and `cloud_enabled` = true. |

### It installs and runs as shown

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 11 | The project installs and runs consistently on its platform | OK for automated checks; **To do** for a live Meet call | Run on November 24 on the 0.4.0 code: `npm test` → 131 pass, 0 fail. `npm run build` → OK, zip of about 5.5 MB. Eight end-to-end scripts, 283 checks, all OK, each script exits with an error if one check fails: `demo.mjs` 81, `extension.mjs` (test Meet page) 44, `interface.mjs` 54, `network.mjs` 35, `security.mjs` 20, `voice-mixer.mjs` 10, `autoplay.mjs` 2, `voice.mjs` (real synthesis) 37. Live demo: HTTP 200 but still version 0.3.1 (row 19). | **Arnaud:** one live Meet call with a second account: captions read, Alt+1 in the chat, a reply sent, the voice heard on the other side, raise hand. |
| 12 | It functions as depicted in the video and the description | To do | The video does not exist yet. The description now matches the merged code. | **Arnaud:** show only what works on the day of recording (see the last section of `video-script.md`). |

### New project

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 13 | New, or significantly updated during the submission period (from Nov 11, 1:30 PM PT) | OK | `git log --format='%ad %s' --date=iso \| tail -1` → `2026-11-12 22:16:32 +0100 Pipe Up MVP…` (Nov 12, 1:16 PM PT, after the start). `gh api repos/Kilanga/pipe-up` → `created_at 2026-11-12T21:36:10Z`. 13 commits, one author. | None. |
| 14 | Summary of what was built during the period; disclosure of pre-existing code and of AI coding tools | OK | `devpost.md`, "What was built during the submission period"; README, "Built during #BuildHybridAI 2026". No pre-existing code. AI coding assistant disclosed. | None. |

### Third-party components

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 15 | Third-party SDKs, APIs and data are used under their licences | OK | `THIRD_PARTY_NOTICES.md` (rewritten in the merge): Firebase JS SDK 13.3.0 and pdf.js 6.5.438, Apache-2.0; ONNX Runtime Web 1.31.1 and piper-phonemize, MIT. `package.json` no longer depends on `@mintplex-labs/piper-tts-web`. | None. |
| 16 | Open-source components are used in compliance with their licences (GPL-3.0 phonemizer in the zip) | OK, low risk | The notices give the exact npm package, its SHA-256, its build description and the upstream sources, say that the data file is modified by Pipe Up's build (dictionaries removed only), and carry a written offer for the source. They also say that the package does not record which upstream commits were used and holds no source, so the build makes no source archive. Pipe Up's own code stays Apache-2.0. | **Arnaud:** attach the phonemizer's source to the release by hand (see the last section). |
| 17 | **Voice model licence** — no content "you don't have rights to"; the rules give the Sponsor a licence to use the submission, including video clips, for promotion (§12) | **OK (resolved)** | `extension/src/voices.js` lists three voices only: `en_US-ljspeech-medium` (default), `en_US-kristin-medium`, `en_US-john-medium`, each with its size and SHA-256, fetched from `rhasspy/piper-voices` at revision `375a0fe6…`. `THIRD_PARTY_NOTICES.md` records their recordings as public domain (LJ Speech; LibriVox) from each model card at that revision, and states that `en_US-hfc_female-medium` (CC BY-NC-SA 4.0) is no longer offered and is removed from storage. I read the ljspeech card myself in the first pass (public domain); I did not re-fetch the kristin and john cards. | **Arnaud:** none for the licence. Users of 0.3.1 set up a voice again. |
| 18 | No third-party names in demo content | Low risk | The sample briefing names a vendor "Zorvex Freight" and says in the same sentence that the name is invented (`demo-web/demo.js`). | None. |

### Access for judges

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 19 | A working link, free and unrestricted, until the Judging Period ends (December 16, 2026) | **To do** | Demo: HTTP 200, no account. But it still serves 0.3.1: the page has no "2. Prepare the answers" button, which the README and the testing instructions now use. | **Release pass:** deploy the demo and Remote Config with 0.4.0, then check from a signed-out browser. **Arnaud:** keep the Firebase project, the reCAPTCHA key and the release in place until at least December 21. Keep `cloud_enabled` true. Watch the Gemini API quota during judging (December 10–16). After the deadline, do not redeploy a different version. |
| 20 | If testing needs a login, credentials are in the testing instructions | OK | No login anywhere. The testing instructions need no token. The extension's cloud route (debug token) is replaced by the hosted demo for testing. | None. |

### Secrets and personal data

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 21 | No production API keys, live cloud secrets, confidential data or personal data in the repository, the form or the testing instructions | OK | Tree: `git grep -I -E "AIza…\|BEGIN … PRIVATE KEY\|ghp_\|github_pat_\|private_key\|<uuid>"` → no match outside `package-lock.json`. History: the same patterns on `git log --all -p` → 0 matches (one false positive: an integrity hash in `package-lock.json`). Files ever committed: none named `*.local.*`, `.env`, key or token. `config/firebase.local.json` is git-ignored and was never committed; only `firebase.example.json` with placeholders is tracked. Email addresses in tracked files: none. Commit author: a GitHub no-reply address. The release zip holds no debug token. | **Arnaud:** the Firebase web configuration is public in the deployed bundle by design (it identifies the project; App Check is what protects the API, row 9). In the Google Cloud console, check that this API key is limited to the APIs the app uses. Never paste the debug token in the form, the video or an issue. |
| 22 | No personal data in the submission documents | OK | `docs/submission/*` hold a first name and a country, nothing else. Feedback notes stay out of the repository (`feedback-outreach.md`). | None. |

### Language and description

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 23 | The app supports English; all submission materials are in English | OK | Interface, README, release notes and `docs/submission/` are in English. | **Arnaud:** narrate the video in English and upload the `.srt`. |
| 24 | Text description: how Firebase AI Logic is used, features and functionality, value proposition | OK as a draft; To do on the form | `devpost.md`. | **Arnaud:** paste it. Its last section lists what only you can add. |

### Repository

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 25 | Public GitHub or GitLab repository with all source code, assets and instructions | OK | `gh api repos/Kilanga/pipe-up` → `visibility: public`. README: "Try it", "Gemini Nano setup", "Build it yourself". The build needs only `config/firebase.local.json`, described in the README. | None. |
| 26 | Open-source licence file, detectable and visible in the About section (Apache preferred) | OK | `gh api repos/Kilanga/pipe-up/license` → `apache-2.0`, path `LICENSE`. | None. Do not add a second licence file at the root: it could change what GitHub detects. |
| 27 | The About section presents the project correctly | To do | Description still says "people with speech differences"; `homepage` is null; `topics` is empty. | **Arnaud:** apply `github-about.md` (one `gh repo edit` command, or the gear icon). |
| 28 | The README details the value proposition | OK | README: "For judges", "Why", "What it does", "Prior art and how Pipe Up differs". | **Arnaud:** capture the three screenshots and add them to the README (see `video-script.md`). |
| 29 | The evaluated code is the code pushed before the deadline | To do | FAQ: commits pushed after the deadline are not evaluated. `package.json`, `package-lock.json` and `extension/manifest.json` say 0.4.0; `docs/releases/0.4.0.md` is final. | **Arnaud:** merge, push, let the workflow publish the release, deploy, tag the submitted commit, by November 29. |

### Video

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 30 | Demo video: 3 minutes at most, public on YouTube, link on the form, shows the project working on its platform, in English or with English subtitles | To do | Script (2:50), subtitles and checklist: `video-script.md`, `video-subtitles.srt`. | **Arnaud:** record, edit, upload as **Public**, check signed out, paste the URL. |
| 31 | The first 30 seconds show who it is for, the problem and how Firebase AI Logic makes it work (FAQ) | OK in the script | Rows 1 to 3; the *On device* badge is on screen from 0:19. | **Arnaud:** keep this order in the edit. |

### Content restrictions

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 32 | No third-party advertising, slogan, logo or trademark | Risk until recorded as planned | The hosted demo shows no third-party logo. A Meet extension cannot be shown without the Meet and Chrome interface. | **Arnaud:** follow "What must not appear" in `video-script.md`. Record most scenes on the hosted demo; crop to the page; no GitHub, Hugging Face or YouTube pages on screen. If in doubt, ask in `#hackathon-help`. |
| 33 | Nothing that violates someone's publicity, privacy or intellectual property rights | Risk until recorded as planned | — | **Arnaud:** only your own accounts in the call, fictional names, no other person's face, name or voice; fictional briefing only. |
| 34 | Music, fonts, images | To do | — | **Arnaud:** no music; system fonts; only your own screenshots in the gallery. |
| 35 | Not offensive, unlawful or outside the spirit of the contest; no health claims | OK | README: "Pipe Up is a communication aid. It does not diagnose, treat or claim to change how anyone speaks." The system prompt bans medical vocabulary (`core/prompt.js`). | None. |

### Ownership

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 36 | Original work of the entrant; AI coding assistants allowed | OK | One author in `git log`. AI assistance disclosed in the README and in `devpost.md`. | None. |
| 37 | Solely owned by the entrant; not funded or licensed by the Sponsor or the Administrator | To do (confirm) | Nothing in the repository says otherwise. | **Arnaud:** confirm when you sign the form. |

## Judging criteria — where the entry stands

| Criterion | What supports it today | Gap to close |
| --- | --- | --- |
| Technological Implementation, including effective use of hybrid inference | Four inference modes, each with a reason; streaming; real cancellation; one JSON schema per task on both routes; App Check enforced with limited-use tokens; Remote Config kill switch; 131 unit tests and 8 end-to-end scripts (283 checks); the demo and the extension share one engine. | The early start has not been measured on a real Gemini Nano. |
| Design: a complete, coherent product experience | One panel, keyboard first; consent screens; routing log; memory screen with delete; five display and reading options; hosted demo that works without Gemini Nano. | Real screenshots in the README; a live Meet verification. |
| Potential Impact: a credible, specific case for a real audience | A defined audience and moment; two sources read and cited correctly; a clear statement of what is not proven. | No feedback yet from people who stutter (`feedback-outreach.md`). |
| Quality of the Idea: creative, non-obvious use; understanding of the problem | Hybrid inference used as a privacy boundary (what data each route may see), not only as availability; hold-the-floor key from co-design research; no stealth mode. | It is true in the merged code; it must also be true on the hosted demo (row 19). |

## For Arnaud only — do not paste

Rows marked **To do** or **Risk** above, in the order to do them.

| # | Row | To do |
| --- | --- | --- |
| 1 | 29 | Merge `agent/final` into `main` and push: the workflow publishes release v0.4.0 with the zip and `docs/releases/0.4.0.md`. Check that `releases/latest` points to it. |
| 2 | 16 | Attach the source of the GPL-3.0 phonemizer to the release as `espeak-ng-source.tar.gz`: a snapshot of https://github.com/rhasspy/espeak-ng, of https://github.com/wide-video/piper-phonemize and of the build steps in https://github.com/wide-video/piper-wasm (`gh release upload v0.4.0 espeak-ng-source.tar.gz`). The npm package does not say which commits it was built from (June 2024): say in the release which snapshot you attached. |
| 3 | 19, 10 | `npm run deploy` (hosting and Remote Config), then check from a signed-out browser: the demo shows "2. Prepare the answers" and "3. Start the call"; the console shows eight Remote Config parameters and `cloud_enabled` = true. Check that no content-security-policy error appears when "Try with the cloud" loads the real reCAPTCHA. Keep the project, the reCAPTCHA key and the release in place until at least December 21. |
| 4 | 9 | Re-run the App Check probe (a request without a token must get 401). Revoke the debug token after judging. |
| 5 | 11, 12 | One live Meet call with a second account: captions, chat, voice heard by the other participant, raise hand, and "voice only" with the side panel closed. |
| 6 | — | With NVDA (browse mode, Enter on a suggestion) or VoiceOver (VO+Space): check that a suggestion can be activated. The panel ignores clicks made by scripts; a click made by the browser for a screen reader is expected to pass, and this is not confirmed. |
| 7 | 7 | On a Chrome with Gemini Nano: note which flags were on and what `chrome://on-device-internals` reports; run the hosted demo once on device. No latency figure for the early start unless measured. |
| 8 | 30–34 | Record the video as in `video-script.md`, upload it as Public, paste the URL in the form. |
| 9 | 27, 28 | Apply `github-about.md`; capture the three screenshots. |
| 10 | 24, 2, 1, 37 | Fill the form from `devpost.md`, select Web/Chrome, confirm eligibility and ownership. |
| 11 | — | Feedback from adults who stutter: only with the wording of `feedback-outreach.md`. |
| 12 | 21 | Re-run the secret scan on the final history before the last push. |

## How the checks were run

```
git log --format='%ad %s' --date=iso | tail -5
npm test
npm run build
for t in demo extension security interface network voice-mixer autoplay voice; do node test/e2e/$t.mjs || echo "FAILED: $t"; done
gh api repos/Kilanga/pipe-up            # visibility, description, homepage, topics, license, created_at
gh api repos/Kilanga/pipe-up/license    # apache-2.0, LICENSE
gh api repos/Kilanga/pipe-up/releases   # v0.1.0 … v0.3.1 and their assets
curl -sI https://pipe-up-demo.web.app/  # 200
git grep -n -I -E '<secret patterns>' -- . ':!package-lock.json'
git log --all -p | grep -E '^\+.*<secret patterns>'
git log --all --name-only --format='' | sort -u | grep -i -E 'local|\.env|secret|key|token|credential'
# App Check probe: one POST to the Firebase AI Logic endpoint of the demo project, with the public web key and no App Check token → 401
```
