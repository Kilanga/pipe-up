# Third-party notices

Pipe Up's own source code is licensed under the Apache License 2.0 (see `LICENSE`).

The built extension also contains these separately licensed components. They are
not part of Pipe Up's source code; they are copied from npm packages at build time.

## Optional local voice module (`voice/` in the built extension)

Used only when the user turns on "voice into the call". It runs entirely on the
user's computer.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| espeak-ng (data and code compiled into `piper_phonemize.wasm` / `.data`) | via @diffusionstudio/piper-wasm 1.0.0 | **GPL-3.0** (`voice/licenses/GPL-3.0-espeak-ng.txt`) | https://github.com/espeak-ng/espeak-ng |
| piper-phonemize | via @diffusionstudio/piper-wasm 1.0.0 | MIT (`voice/licenses/MIT-piper-phonemize.txt`) | https://github.com/rhasspy/piper-phonemize |
| @mintplex-labs/piper-tts-web (fork of @diffusionstudio/vits-web) | 1.0.5 | MIT | https://github.com/Mintplex-Labs/piper-tts-web |
| ONNX Runtime Web | 1.31.1 | MIT (`voice/licenses/MIT-onnxruntime.txt`) | https://github.com/microsoft/onnxruntime |
| Piper voice `en_US-hfc_female-medium` (downloaded at first use, not bundled) | — | trained on the hfc_female dataset, CC BY-NC-SA 4.0 per its model card: non-commercial use | https://huggingface.co/rhasspy/piper-voices |

The GPL-3.0 phonemizer is distributed as a separate program file loaded at run time.
Its complete corresponding source is available from the projects linked above.

## Other bundled libraries

| Component | License |
| --- | --- |
| Firebase JS SDK | Apache-2.0 |
| pdf.js (`pdf.worker.min.mjs`) | Apache-2.0 |
