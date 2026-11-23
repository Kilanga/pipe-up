# Third-party notices

Pipe Up's own source code is licensed under the Apache License 2.0 (see `LICENSE`).

The built extension also contains these separately licensed components. They are
not part of Pipe Up's source code; they are copied from npm packages at build time.
License headers of bundled libraries are kept in the `*.LEGAL.txt` files next to
each script.

## Optional local voice (`voice-worker.js` and `voice/` in the built extension)

Used only when the user sets up "voice into the call". It runs entirely on the
user's computer.

| Component | In the extension | Version | License | Source |
| --- | --- | --- | --- | --- |
| ONNX Runtime Web | bundled in `voice-worker.js`; `voice/ort-wasm-simd-threaded.mjs` and `.wasm` | npm `onnxruntime-web` 1.31.1 | MIT (`voice/licenses/MIT-onnxruntime.txt`) | https://github.com/microsoft/onnxruntime |
| piper-phonemize, compiled to WebAssembly | `voice/piper_phonemize.wasm`; its JavaScript loader is bundled in `voice-worker.js` | npm `@diffusionstudio/piper-wasm` 1.0.0 | MIT (`voice/licenses/MIT-piper-phonemize.txt`) | https://github.com/wide-video/piper-phonemize, a fork of https://github.com/rhasspy/piper-phonemize |
| espeak-ng: program code, compiled into `piper_phonemize.wasm` | `voice/piper_phonemize.wasm` | from npm `@diffusionstudio/piper-wasm` 1.0.0 | **GPL-3.0-or-later** (`voice/licenses/GPL-3.0-espeak-ng.txt`) | https://github.com/rhasspy/espeak-ng, a fork of https://github.com/espeak-ng/espeak-ng |
| espeak-ng: pronunciation data | `voice/piper_phonemize.data` (a part of the original file, see below) | from npm `@diffusionstudio/piper-wasm` 1.0.0 | **GPL-3.0-or-later** | same as above |

### Source code of the GPL-3.0 phonemizer

`voice/piper_phonemize.wasm` is the unchanged file `build/piper_phonemize.wasm` of
the npm package `@diffusionstudio/piper-wasm`, version 1.0.0
(https://registry.npmjs.org/@diffusionstudio/piper-wasm/-/piper-wasm-1.0.0.tgz,
SHA-256 `b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6`).
Pipe Up does not compile it. According to that package's README, copied to
`voice/licenses/piper-wasm-BUILD.md`, it was built in June 2024 with Emscripten
3.1.47 from:

- espeak-ng: https://github.com/rhasspy/espeak-ng (GPL-3.0-or-later)
- piper-phonemize: https://github.com/wide-video/piper-phonemize (MIT)
- build steps: https://github.com/wide-video/piper-wasm, repeated in that README;
  the package itself: https://github.com/diffusion-studio/piper-wasm

The package does not record which commits of these repositories were used.

`voice/piper_phonemize.data` is made by Pipe Up's build from
`build/piper_phonemize.data` of the same package (SHA-256
`29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c`), which holds
the compiled espeak-ng data of every language. The build keeps the files shared
by all languages and 14 pronunciation dictionaries (English, and the ones an
English voice uses for words in Greek, Armenian, Devanagari, Bengali, Gurmukhi,
Gujarati, Tamil, Telugu, Kannada, Malayalam, Sinhala, Georgian and Korean
script), removes the other 99 dictionaries, and changes nothing inside the files
it keeps. The script that does this is `scripts/phonemizer-data.mjs` in Pipe
Up's source code: https://github.com/Kilanga/pipe-up.

The phonemizer is a separate program: the extension starts it with a text and
reads the phonemes it prints.

## Voices (downloaded on request, not part of the extension)

A voice is downloaded only when the user clicks "Set up the voice" or "Download
this voice". Every file comes from the Hugging Face repository
https://huggingface.co/rhasspy/piper-voices (repository license: MIT), at the
fixed revision `375a0fe641dea077c2a47b4e9a056d6da521eed3` (tag `v1.0.0`), and
is accepted only if its SHA-256 is the one listed in `extension/src/voices.js`.

Download address of a file:
`https://huggingface.co/rhasspy/piper-voices/resolve/375a0fe641dea077c2a47b4e9a056d6da521eed3/<path>`

| Voice in the side panel | Files (`<path>`, plus the same with `.json`) | Recordings and their license, from the voice's `MODEL_CARD` at that revision | SHA-256 of the `.onnx` file |
| --- | --- | --- | --- |
| Female voice (default) | `en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx` | LJ Speech (https://keithito.com/LJ-Speech-Dataset/), **public domain**; trained from scratch | `6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22` |
| Female voice, lower | `en/en_US/kristin/medium/en_US-kristin-medium.onnx` | LibriVox recordings (https://librivox.org), **public domain**; trained from scratch | `5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4` |
| Male voice | `en/en_US/john/medium/en_US-john-medium.onnx` | LibriVox recordings (https://librivox.org), **public domain**; fine-tuned from the kristin voice above | `789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988` |

Versions 0.2.0 to 0.3.1 downloaded another voice, `en_US-hfc_female-medium`,
from the Hugging Face repository `diffusionstudio/piper-voices` (the same file
as in `rhasspy/piper-voices` at tag `v1.0.0`). Its model card gives the
Hi-Fi-CAPTAIN recordings with the license CC BY-NC-SA 4.0, which does not allow
commercial use. Pipe Up no longer offers it, and removes it from the
extension's storage when the side panel opens.

## Other bundled libraries

| Component | Version | License |
| --- | --- | --- |
| Firebase JS SDK | 13.3.0 | Apache-2.0 |
| pdf.js (`pdf.worker.min.mjs`) | 6.5.438 | Apache-2.0 |
