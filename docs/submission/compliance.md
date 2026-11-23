# Compliance check — Pipe Up, #BuildHybridAI 2026

Checked on **November 23, 2026** against the official rules (https://firebasehybridaihackathon.devpost.com/rules), the overview and the FAQ (https://firebasehybridaihackathon.devpost.com/details/faqs), on branch `agent/submission` (base: `main` at 0.3.1). Deadline: **November 30, 2026, 2:00 PM Pacific** (23:00 in Paris). The FAQ states that the deadline is fixed, that the submission is locked afterwards, and that commits pushed after the deadline are not evaluated.

Status: **OK** = verified now. **To do** = an action is still needed. **Risk** = could cost the Stage One pass/fail or a rights problem; read the action.

Owners: **Arnaud** = only the entrant can do it. **Merge pass** = to finalize once the two feature branches ("Prepare for the call" and the voice package) are merged.

## Summary of what is not OK

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 17 | Voice model licence is non-commercial (CC BY-NC-SA 4.0) | **Risk** | Merge pass, then Arnaud |
| 30 | Demo video not recorded, not on YouTube | **To do** | Arnaud |
| 32–34 | Video content: logos, other people, personal data | **Risk** until recorded as planned | Arnaud |
| 11 | Extension and voice not yet verified in a live Meet call | **To do** | Arnaud |
| 27 | GitHub About: old description, no website, no topics | **To do** | Arnaud |
| 7 | "Gemini Nano 4" and the Chrome flag: setup written from the docs, not re-checked on a machine | **To do** | Arnaud |
| 10 | Remote Config template: deployed state not verifiable from here | **To do** | Arnaud |
| 24, 2 | Devpost form not filled; platform not selected | **To do** | Arnaud |
| 29 | Final merge, release and deploy before the deadline | **To do** | Merge pass, Arnaud |
| 1, 37 | Eligibility and ownership statements | **To do** (confirm) | Arnaud |
| 5 | Cloud inference is only a fallback today | OK, **weak point** for scoring | Merge pass |

## Full table

### Entrant and form

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 1 | Entrant is eligible: above the age of majority, not a resident of an excluded country, not a Contest Entity, not a government employee; an individual entry does not conflict with an employer's policies | To do (confirm) | Rules §3. France is not in the list of excluded places. Nothing in the repository can prove the rest. | **Arnaud:** confirm you enter as an individual and that nothing in your employment terms conflicts with it. |
| 2 | Select at least one platform | To do | Rules §6, "Submission Requirements". | **Arnaud:** select **Web/Chrome** on the form. |
| 3 | Each submission by the same entrant is unique and substantially different | OK for this project | Rules §6, "Multiple Submissions". | **Arnaud:** only relevant if you enter another project in the same contest. |

### What to create

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 4 | Built with Firebase AI Logic, imported and actually called at runtime, not just named in the README | OK | `core/engine.js`: line 2 `import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai'`; line 47 `getAI(...)`; lines 121–123 three `getGenerativeModel(...)`; line 151 `generateContentStream(...)`; line 165 `inferenceSource`. The demo (`demo-web/demo.js`) and the extension (`extension/src/sidepanel.js`) both call `initFirebase()` and `SuggestionEngine`. `firebase` 13.3.0 installed (docs ask for 12.5.0 or later). | Merge pass: line numbers will move; the README names functions, not lines. |
| 5 | Uses hybrid inference: on-device and cloud | OK, weak point | Three modes: `ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `ONLY_IN_CLOUD`. FAQ: "Firebase wants to see both on-device and cloud inference, and judges score how effectively you use hybrid inference." Today the cloud is only a consent-gated fallback. | **Merge pass:** "Prepare for the call" (`PREFER_IN_CLOUD` before the call) makes the cloud a designed step. Until merged, describe it only as planned. The video must show both routes (script rows 6 and 7). |
| 6 | All AI inference goes through Firebase AI Logic; no other model API is called directly (FAQ) | OK, low risk | `git grep` finds no other model API. `LanguageModel.availability()` in `deviceStatus()` only reads the status. The voice is a local speech synthesizer (Piper, ONNX Runtime, WebAssembly): no API call, not generative. | None. The README and the Devpost text say it in one sentence, so a judge does not have to guess. |
| 7 | Web (Chrome) with Gemini Nano via Firebase AI Logic; the FAQ names "Gemini Nano 4" and a Chrome flag | To do | Sources fetched: Firebase docs (Chrome desktop 139+, flag `#prompt-api-for-gemini-nano-multimodal-input`), Chrome docs (hardware: GPU with more than 4 GB VRAM **or** CPU with 16 GB RAM and 4 cores, 22 GB free), FAQ ("search for 'Gemma 4 for Built-in AI' and enable it"). The README and the testing instructions now give all three. I could not run a Chrome with Gemini Nano here. | **Arnaud:** on the Chrome 157 machine, open `chrome://flags` and `chrome://on-device-internals`; note which of the two flags exist and are on, and the model name shown. Correct the setup steps if they differ. |
| 8 | Uses supported Firebase products (App Check, Remote Config, Firestore, Authentication) | OK | App Check and Remote Config in `core/engine.js`; Firebase Hosting in `firebase.json`. Firestore and Authentication are not used. FAQ: App Check is required, the others are "encouraged but optional". | None. |
| 9 | App Check is required; debug tokens are accepted; never commit them | OK | Code: `initializeAppCheck` (lines 23 and 26), `useLimitedUseAppCheckTokens: true`, `ReCaptchaEnterpriseProvider` in `demo-web/demo.js`. **Enforcement verified:** a direct request to the Firebase AI Logic endpoint of the demo project without an App Check token returned `HTTP 401 "Firebase App Check token is invalid."` No token in the tree or the history (row 21). | **Arnaud:** revoke the debug token in the Firebase console after judging ends. |
| 10 | Remote Config is really used | To do (confirm) | Code: `fetchAndActivate` with bundled defaults (`core/config.js`); template in `remoteconfig.template.json`; `firebase.json` deploys it. The deployed template cannot be read from here. | **Arnaud:** `firebase remoteconfig:get` (or the console) shows the seven parameters and `cloud_enabled` = true. |

### It installs and runs as shown

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 11 | The project installs and runs consistently on its platform | OK for the hosted demo and automated checks; **To do** for a live Meet call | Run today: `npm test` → 20 pass, 0 fail. `npm run build` → OK, zip 13,685,409 bytes. `node test/e2e/demo.mjs` → 22 checks OK. `node test/e2e/extension.mjs` (extension on a test Meet page) → 11 checks OK. `node test/e2e/autoplay.mjs` and `voice-mixer.mjs` → no error. Live: `https://pipe-up-demo.web.app` → HTTP 200, `index.html` identical to the repository, `demo.js` same size as the local build (602,949 bytes). Release `v0.3.1` zip downloads (HTTP 200) and contains `manifest.json` 0.3.1, `LICENSE`, `THIRD_PARTY_NOTICES.md` and `voice/licenses/`. | **Arnaud:** one live Meet call with a second account: captions read, Alt+1 in the chat, a reply sent, the voice heard on the other side. **Merge pass:** re-run all of the above after the merge, publish the release, redeploy the demo. |
| 12 | It functions as depicted in the video and the description | To do | The video does not exist yet. The description marks unmerged features as [PLANNED]. | **Merge pass:** show and describe only what is merged and tested. Remove every [PLANNED] marker or the sentence it marks. |

### New project

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 13 | New, or significantly updated during the submission period (from Nov 11, 1:30 PM PT) | OK | `git log --format='%ad %s' --date=iso \| tail -1` → `2026-11-12 22:16:32 +0100 Pipe Up MVP…` (Nov 12, 1:16 PM PT, after the start). `gh api repos/Kilanga/pipe-up` → `created_at 2026-11-12T21:36:10Z`. 13 commits, one author. | None. |
| 14 | Summary of what was built during the period; disclosure of pre-existing code and of AI coding tools | OK | `devpost.md`, "What was built during the submission period"; README, "Built during #BuildHybridAI 2026". No pre-existing code. AI coding assistant disclosed. | **Merge pass:** add the final release to the list. |

### Third-party components

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 15 | Third-party SDKs, APIs and data are used under their licences | OK | `THIRD_PARTY_NOTICES.md`; licence texts in `third_party/`, copied into the zip (`voice/licenses/`). Firebase JS SDK and pdf.js: Apache-2.0. piper-tts-web, ONNX Runtime Web, piper-phonemize: MIT. | Notices owner: update after the voice package merge. |
| 16 | Open-source components are used in compliance with their licences (GPL-3.0 phonemizer in the zip) | OK, low risk | espeak-ng (GPL-3.0) ships as a separate optional module with its licence text and a link to the upstream source. Pipe Up's own code stays Apache-2.0. | Notices owner: keep the exact package version and source link next to the binary. |
| 17 | **Voice model licence** — no content "you don't have rights to"; the rules give the Sponsor a licence to use the submission, including video clips, for promotion (§12) | **Risk** | Model card fetched today: `en_US-hfc_female-medium` is trained on a dataset under **CC BY-NC-SA 4.0** (non-commercial). It is not bundled; the user downloads it. But it is the only voice, and it would be heard in the demo video of a contest with cash prizes. | **Merge pass (voice package):** make the default voice, and the voice heard in the video, one whose model card allows this use. Model cards read today on https://huggingface.co/rhasspy/piper-voices : `en_US-ljspeech-medium` (public domain), `en_US-libritts_r-medium` (CC BY 4.0), `en_GB-cori-medium` (CC BY 4.0), `en_US-joe-medium` (CC0). Avoid for this purpose: `hfc_male` and `ryan` (CC BY-NC-SA 4.0), `lessac` (its own licence), `amy` (licence not stated on the card). Re-read each card before shipping. **Arnaud:** if this is not merged in time, keep the voice out of the video's audio (script, TO CONFIRM row 4). |
| 18 | No third-party names in demo content | Low risk | The sample briefing names a vendor "Northwind Logistics" (`demo-web/demo.js`). It is meant as fiction, but the name may exist. | Merge pass (code owner): use an obviously invented name. |

### Access for judges

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 19 | A working link, free and unrestricted, until the Judging Period ends (December 16, 2026) | OK today | Demo: HTTP 200. Release zip: public. No paywall, no account. | **Arnaud:** keep the Firebase project, the reCAPTCHA key and the release in place until at least December 21. Keep `cloud_enabled` true. Watch the Gemini API quota during judging (December 10–16): if it runs out, judges without Gemini Nano only get the basic replies. After the deadline, do not redeploy a different version of the demo. |
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
| 24 | Text description: how Firebase AI Logic is used, features and functionality, value proposition | OK as a draft; To do on the form | `devpost.md`. | **Arnaud:** paste it. **Merge pass:** finalize the TO CONFIRM list first. |

### Repository

| # | Requirement | Status | Evidence | Action and owner |
| --- | --- | --- | --- | --- |
| 25 | Public GitHub or GitLab repository with all source code, assets and instructions | OK | `gh api repos/Kilanga/pipe-up` → `visibility: public`. README: "Try it", "Gemini Nano setup", "Build it yourself". The build needs only `config/firebase.local.json`, described in the README. | None. |
| 26 | Open-source licence file, detectable and visible in the About section (Apache preferred) | OK | `gh api repos/Kilanga/pipe-up/license` → `apache-2.0`, path `LICENSE`. | None. Do not add a second licence file at the root: it could change what GitHub detects. |
| 27 | The About section presents the project correctly | To do | Description still says "people with speech differences"; `homepage` is null; `topics` is empty. | **Arnaud:** apply `github-about.md` (one `gh repo edit` command, or the gear icon). |
| 28 | The README details the value proposition | OK | README: "For judges", "Why", "What it does", "Prior art and how Pipe Up differs". | **Arnaud:** capture the three screenshots and uncomment the block at the top of the README. |
| 29 | The evaluated code is the code pushed before the deadline | To do | FAQ: commits pushed after the deadline are not evaluated. | **Merge pass, Arnaud:** merge, test, release and push by November 29. Tag the submitted commit. |

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
| Technological Implementation, including effective use of hybrid inference | Three inference modes with a reason for each route; streaming on both; one JSON schema; App Check enforced with limited-use tokens; Remote Config kill switch; 20 unit tests and 4 end-to-end checks; the demo and the extension share one engine. | The cloud is only a fallback until "Prepare for the call" is merged. |
| Design: a complete, coherent product experience | One panel, keyboard first; consent screens; routing log; memory screen with delete; five display and reading options; hosted demo that works without Gemini Nano. | Real screenshots in the README; a live Meet verification. |
| Potential Impact: a credible, specific case for a real audience | A defined audience and moment; two sources read and cited correctly; a clear statement of what is not proven. | No feedback yet from people who stutter (`feedback-outreach.md`). |
| Quality of the Idea: creative, non-obvious use; understanding of the problem | Hybrid inference used as a privacy boundary (what data each route may see), not only as availability; hold-the-floor key from co-design research; no stealth mode. | Say "Cloud before the call, device during the call" only once it is true. |

## TO CONFIRM AFTER MERGE

1. "Prepare for the call" is merged, tested in the hosted demo and in the extension; `PREFER_IN_CLOUD` appears in `core/engine.js` → update rows 4 and 5, the README comment block, `devpost.md` and the video row 5.
2. Speculative on-device start and real cancellation are merged → update the README ("a running Gemini Nano request cannot be cancelled") and `devpost.md`. Re-measure before changing any latency figure; otherwise keep "about 1.2 s" and "about 4 to 7 s".
3. Voice package: the real zip size from the release asset (today 13,685,409 bytes; planned about 5 MB, not measured), quick phrases spoken at once, 2–3 voices → update row 11, row 17, the README and `devpost.md`.
4. Voice licences in `THIRD_PARTY_NOTICES.md` match the voices actually offered → close row 17.
5. Live Meet call verified (captions, chat, voice heard by a second participant) → close row 11 and remove the README limit.
6. Feedback from adults who stutter → use only the wording in `feedback-outreach.md`.
7. Re-run: `npm test`, `npm run build`, the four `test/e2e` checks, the secret scan of row 21 on the merged history, and the App Check probe of row 9.
8. New release published by the workflow; `releases/latest` points to it; demo redeployed; both checked from a signed-out browser.
9. GitHub About set (row 27); screenshots captured and uncommented (row 28); YouTube URL in the form (row 30).
10. `package.json` description updated ("speech differences" → current wording).

## How the checks were run

```
git log --format='%ad %s' --date=iso | tail -5
npm test
npm run build
node test/e2e/demo.mjs && node test/e2e/extension.mjs && node test/e2e/autoplay.mjs && node test/e2e/voice-mixer.mjs
gh api repos/Kilanga/pipe-up            # visibility, description, homepage, topics, license, created_at
gh api repos/Kilanga/pipe-up/license    # apache-2.0, LICENSE
gh api repos/Kilanga/pipe-up/releases   # v0.1.0 … v0.3.1 and their assets
curl -sI https://pipe-up-demo.web.app/  # 200
git grep -n -I -E '<secret patterns>' -- . ':!package-lock.json'
git log --all -p | grep -E '^\+.*<secret patterns>'
git log --all --name-only --format='' | sort -u | grep -i -E 'local|\.env|secret|key|token|credential'
# App Check probe: one POST to the Firebase AI Logic endpoint of the demo project, with the public web key and no App Check token → 401
```
