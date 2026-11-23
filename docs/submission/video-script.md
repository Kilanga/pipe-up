# Demo video — script and recording checklist

Target length: **2:50** (hard limit 3:00; only the first 3 minutes may be evaluated). Narration: 344 words, about 2 words per second, in English. Subtitles: [`video-subtitles.srt`](video-subtitles.srt), cue for cue the narration below.

What the hackathon FAQ asks for (https://firebasehybridaihackathon.devpost.com/details/faqs):

- The first 30 seconds show the idea: who it is for, the problem it solves, and how Firebase AI Logic makes it work.
- Judges may evaluate from the video alone, so the hybrid features must be seen working early.
- Up to 3 minutes, public on YouTube, in English or with English subtitles, showing the project working on its platform.
- Avoid third-party logos, trademarks, or content you do not have rights to.

Rows 1 to 3 are that opening. The *On device* badge is on screen from 0:19.

## Timed plan

"Meet" = the real extension in a real Google Meet call between two accounts that both belong to the author. "Demo" = https://pipe-up-demo.web.app.

| # | Time | On screen | Narration (exact) | On-screen caption |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:08 | Title on a plain dark background, then cut to the in-call panel. | Pipe Up is a backup channel for people who stutter, in Google Meet. | **Pipe Up** — a backup channel for people who stutter |
| 2 | 0:08–0:19 | Meet. Sam's tile, captions on. A colleague's caption line scrolls; Sam's tile stays still. | In a video call, a block can look like a frozen connection. People talk over you, and the moment is gone. | For people who stutter · work video calls |
| 3 | 0:19–0:34 | Close-up of the panel: three short replies, badge **On device**, the quick phrases, "4 — I answered myself". | Pipe Up gives you one key to hold the floor, and short replies from your own notes. Firebase AI Logic runs them on Gemini Nano, on your device. The cloud is used only if you agree. | Firebase AI Logic · Gemini Nano on device · cloud only with consent |
| 4 | 0:34–0:52 | Meet. The colleague (second account, on a phone) says: **"Sam, are you frozen?"** The caption appears. Sam presses **Alt+1**: "I'm still speaking, one moment." shows in the Meet chat. Sam speaks, then presses **4**: "Got it. Pipe Up stays in the background." | This scene is staged. Sam is in a block. *(colleague: "Sam, are you frozen?")* Sam presses Alt+1. Everyone sees his message in the chat. He finishes his sentence himself, then presses 4: I answered myself. | **STAGED DEMO** — both accounts belong to the author *(keep this caption for the whole scene)* |
| 5 | 0:52–1:12 | Demo, **Briefing** tab: *My positions*, notes, a document. Click **2. Prepare the answers**, then **Prepare with the cloud**: the confirmation that states what is sent, *confirm*, the list of likely questions, one answer being edited. Cut to the **Live** tab: the preparation line in the routing log. | Before the call, Sam writes his positions and notes, or adds a document. Prepare for the call turns them into likely questions, with short answers he can edit. The cloud does this once, after he confirms. During the call, the device does the rest. | Cloud before the call, device during the call |
| 6 | 1:12–1:38 | Demo. Caption: "Do we still think the March deadline is realistic?" Three replies appear; one is tagged *From your briefing*; badge **On device**. Press **1**, **Enter**: the reply lands in the chat. Then the **Live** tab: the routing log line (*On device · … ms · Gemini Nano on this computer · used your briefing*). | A question about the deadline. After the pause, three short replies appear. This one comes from Sam's briefing. The badge says On device. Nothing is sent until Sam presses 1, then Enter. The log shows where each reply was generated, and why. It reads inferenceSource from Firebase AI Logic. | `inferenceSource` → badge and routing log |
| 7 | 1:38–2:00 | Demo, **Live** tab. Tick *Demo: simulate a computer without Gemini Nano*. Tick *Allow the cloud when on-device AI is not available*. Show the second box (*Also send relevant briefing excerpts…*) unticked. **Next line**: badge **Cloud**; the log line ends with "cloud, last 2 caption lines sent". | On a computer without Gemini Nano, Pipe Up asks first. If Sam agrees, only the last two caption lines go to Gemini in the cloud, protected by App Check. His briefing needs a second opt-in. His past replies never leave the device. Now the badge says Cloud. | Consent first · 2 caption lines · App Check |
| 8 | 2:00–2:20 | Meet, two windows side by side: Sam's, and the colleague's (what others hear). Show the voice choice for two seconds (three voices). Output set to *Chat + synthetic voice*. Sam presses **2**, **Enter**: the synthetic voice is heard on the colleague's side and the text is in the chat. Then **Alt+D**: Sam's own line appears in the chat. | Sam can also have a reply read aloud in the call. The voice is made on his computer. It is clearly synthetic, and it is not a copy of his voice. *(synthetic voice reads the reply)* With Alt+D, he tells colleagues in his own words. | Synthetic voice, generated locally · not a voice clone |
| 9 | 2:20–2:31 | Demo, **Settings → Display and reading**: tick *Easy reading*, *One suggestion at a time*, *High contrast*, one after the other; the panel changes at once. | Reading under pressure is hard. So there is easy reading, one suggestion at a time, high contrast and reduced motion. | Display and reading options |
| 10 | 2:31–2:45 | The panel, then plain text on a dark background. | Pipe Up has no stealth mode. What it sends is visible or audible to everyone, as coming from Sam. It has not yet been tested with people who stutter. That comes next. | No stealth mode · Not yet tested with people who stutter |
| 11 | 2:45–2:50 | Plain text card: the two URLs, typed as text (no logos). | Pipe Up. Your voice first, and a backup when you need it. | pipe-up-demo.web.app · github.com/Kilanga/pipe-up · Apache-2.0 |

### Rules for the footage

- Do not speed up or cut a wait for a suggestion without saying so. If a cloud wait is shortened in the edit, add the caption "wait shortened".
- Scene 4 is staged and says so, in the narration and on screen.
- Every reply shown must be one the product really generated during the recording. Do not retype replies in the edit.
- In scene 8, write the words the voice really says into cue 32 of the `.srt` file (it holds a placeholder).

## STILL TO CONFIRM

Resolved from the merged code: "Prepare for the call" exists as narrated in row 5 (one cloud request after a confirmation; prepared answers used on the device during the call); the three voices are trained on public-domain recordings, so the voice may be heard in the video. The narration and the subtitles did not change.

| # | Item | If confirmed | If not confirmed by recording day |
| --- | --- | --- | --- |
| 1 | The hosted demo is redeployed with 0.4.0 (step "2. Prepare the answers") | Record row 5 as written. | Record row 5 from a local build of the demo (`npm run build`, served from `dist/demo`), cropped to the page. Do not submit before the hosted demo is updated. |
| 2 | The voice is verified in a live Meet call, heard by a second participant | Record row 8 as written. | Record row 8 on the hosted demo, with the caption "Hosted demo: the browser's own voice. In Meet, the extension mixes a local voice into the microphone." Remove "in the call" from cue 29. |
| 3 | Raise hand with Alt+1 (optional setting) | Not in the script. Add it to row 4 only after it worked in a live call. | Leave it out. |
| 4 | Latency | Say no number in the video. The early start has not been measured on a real Gemini Nano. | — |
| 5 | Feedback from adults who stutter | Replace the last two sentences of row 10 (cues 39–40) with the wording in `feedback-outreach.md`. | Keep row 10 as written. |
| 6 | Final length | After the edit, retime the `.srt` on the real cut and check the video is under 3:00. | — |

## Recording checklist (solo, Windows or macOS)

### Tools (all free)

- **Screen and sound:** OBS Studio on Windows or macOS. One scene with a *Window Capture* of Chrome (on macOS 13 or later: *macOS Screen Capture* set to one window, which can also record the window's sound). Canvas and output 1920×1080, 30 fps. Record the narration separately, after the edit, so the timing is easy to fix.
- **Built-in alternatives:** Windows 11 Snipping Tool (Win+Shift+R); macOS Shift+Cmd+5. Check first that they capture the sound you need in scene 8.
- **Editing:** Clipchamp (Windows 11), iMovie (macOS) or DaVinci Resolve (both). Use the editor's own text tool and a system font for captions.
- **Narration:** a headset microphone in a quiet room. Read the table's narration column as written; the `.srt` matches it word for word.

### Chrome and window

- A **new Chrome profile** used only for the recording, signed in to a test Google account whose display name is fictional ("Sam Taylor"), with no profile photo.
- Only Pipe Up in the toolbar. No other extension icon. Bookmarks bar hidden (Ctrl+Shift+B or Cmd+Shift+B). One tab per window. Open every tab before recording so no address-bar suggestion appears on camera.
- Chrome window about 1600×900 inside the 1920×1080 canvas, page zoom 110–125% so the panel is readable in a small embedded player. Crop the recording to the page area: no tab strip, no address bar, no profile avatar.
- Chrome 157 or later with Gemini Nano ready (the *Live* tab says "Gemini Nano is ready on this computer"). Run one question before recording so the model is warm.
- Reset the demo between takes: a fresh profile, or clear the site data of `pipe-up-demo.web.app`, so the *Memory* tab holds nothing from earlier tests.

### The Meet call (scenes 2, 4, 8)

- Two accounts that are both yours, both with fictional names and no photo: "Sam Taylor" (computer, with the extension) and a colleague, for example "Maya" (your phone, or a second Chrome profile on the same computer). Nobody else in the call. Cameras off, or only your own face if you choose to show it.
- Captions on (CC) in Sam's window, in English.
- Scene 4: stay silent as Sam. Say "Sam, are you frozen?" from the colleague's device, with Sam's microphone muted for that second so the same voice is not picked up twice. Unmute before pressing Alt+1 if the output includes the voice.
- Scene 8: Sam does not hear the synthetic voice himself; it goes into the microphone stream. To record what the others hear, join as the colleague from a second Chrome profile on the same computer, wear headphones, and record that window's sound (OBS desktop audio). Show both windows side by side.
- Fill Sam's *Alt+D* line before recording, in *Settings*, for example: "I stutter. Sometimes I answer in the chat, or a computer voice reads my reply."
- Use only the fictional briefing (*Load Sam's sample briefing*). No real work document, no real names.

### What must not appear

- **Third-party logos and trademarks:** no taskbar or dock, no desktop, no other tabs or favicons, no new-tab page, no other websites (no GitHub, Hugging Face or YouTube pages: show the repository URL as plain text). Keep the Meet pre-join and end-of-call screens out of the video. The Chrome and Meet interface cannot be avoided when showing a Meet extension; keep them incidental and never zoom on a logo. If in doubt, ask in `#hackathon-help` on the Devpost Discord before uploading.
- **Personal data:** no real name, email address, profile photo, meeting code or link, calendar, chat history or file path. Check the top right corner of every frame.
- **Other people:** no face, name or voice of anyone but yourself.
- **Notifications:** turn on Do Not Disturb (Windows: notification centre → Do not disturb; macOS: Control Centre → Focus → Do Not Disturb). Quit mail and chat apps. Put the phone in silent mode.
- **Secrets:** never open the Firebase console, the reCAPTCHA console, DevTools or a terminal on camera. Do not type or paste the App Check debug token during the recording. The extension needs no token for the on-device scenes; record the cloud scene on the hosted demo, which needs none.
- **Music and fonts:** no music. System fonts only.

### Screenshots to capture in the same session (for the README and the Devpost gallery)

Real captures from the real Chrome, PNG, about 1600 px wide, no personal data:

1. `docs/img/overlay.png` — the in-call panel with three replies, one tagged *From your briefing*, badge *On device*.
2. `docs/img/routing-log.png` — the *Live* tab with an *On device* line and a *Cloud* line in the log.
3. `docs/img/briefing.png` — the *Briefing* tab with Sam's sample briefing.

For the Devpost gallery, make annotated copies (two or three short labels with arrows: "Hold the floor: Alt+1", "Where it was generated", "From your briefing"). Keep the README copies clean. Then uncomment the screenshot block at the top of `README.md`.

### Subtitles

1. Finish the edit, then open `video-subtitles.srt` and move each cue to the real timing. Keep the text identical to what is said.
2. Replace the placeholder in cue 32 with the words the synthetic voice says.
3. In YouTube Studio: *Subtitles* → *Add language* → English → *Add* → *Upload file* → *With timing*. Do not rely on automatic captions.

### YouTube

- Title: "Pipe Up — a backup channel for people who stutter in Google Meet (#BuildHybridAI 2026)".
- Description: one sentence, then the demo and repository URLs.
- **Visibility: Public.** Not *Unlisted*, not *Private*: the rules ask for a video "publicly visible on YouTube". Audience: not made for kids. Leave embedding allowed.
- Upload at least a day before the deadline. Then open the link in a private window, signed out: the video plays, the length shows under 3:00, the English subtitles are available.
- Paste the URL in the Devpost form and in `devpost.md`.
