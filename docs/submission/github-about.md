# GitHub "About" settings for Kilanga/pipe-up

Checked on November 23, 2026 with `gh api repos/Kilanga/pipe-up`:

| Field | Current value | Status |
| --- | --- | --- |
| Description | "Reply suggestions in video calls for people with speech differences — on-device AI first with Firebase AI Logic hybrid inference" | outdated wording |
| Website | empty | to set |
| Topics | none | to set |
| License | Apache-2.0, detected from `LICENSE` | OK |

## Description (316 characters, limit 350)

```
Pipe Up: a backup channel for people who stutter in Google Meet. One key holds the floor; short replies come from what you prepared and are sent only on your keypress. Gemini Nano on device first, cloud only with consent, through Firebase AI Logic hybrid inference. Chrome extension and hosted demo. No stealth mode.
```

## Website

```
https://pipe-up-demo.web.app
```

## Topics (10)

```
firebase-ai-logic
firebase
gemini-nano
hybrid-inference
on-device-ai
chrome-extension
google-meet
accessibility
stuttering
assistive-technology
```

## How to set them

In the browser: repository page → gear icon next to **About** → paste the description and the website, add the topics, keep **Releases** ticked, save.

Or with the GitHub CLI, from an account that owns the repository:

```
gh repo edit Kilanga/pipe-up \
  --description "Pipe Up: a backup channel for people who stutter in Google Meet. One key holds the floor; short replies come from what you prepared and are sent only on your keypress. Gemini Nano on device first, cloud only with consent, through Firebase AI Logic hybrid inference. Chrome extension and hosted demo. No stealth mode." \
  --homepage "https://pipe-up-demo.web.app" \
  --add-topic firebase-ai-logic,firebase,gemini-nano,hybrid-inference,on-device-ai,chrome-extension,google-meet,accessibility,stuttering,assistive-technology
```

## After setting them, check

```
gh api repos/Kilanga/pipe-up --jq '{description, homepage, topics, license: .license.spdx_id}'
```

The contest rule to satisfy: the open-source licence must be "detectable and visible at the top of the repository page (in the About section)". The API already reports `Apache-2.0`; the About box shows it as "Apache-2.0 license".

## Also outdated, outside this document's scope

`package.json` → `"description"` still says "people with speech differences". It is not shown on GitHub, but it should match (merge pass).
