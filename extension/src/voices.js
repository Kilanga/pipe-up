// The voices offered in the side panel. They are Piper voices from
// https://huggingface.co/rhasspy/piper-voices. The default one is part of the
// extension (the build copies it into voice/models/, see
// scripts/voice-files.mjs), so the voice works right after install. The
// others are downloaded on request and kept in this extension's storage.
//
// Only voices whose recordings are in the public domain are listed. The
// license of each one was read in its MODEL_CARD at the revision below and is
// recorded in THIRD_PARTY_NOTICES.md. Read the model card before adding a
// voice, and do not add one that is limited to non-commercial use. A voice
// that is included must also be one we may redistribute.

// Tag v1.0.0 of rhasspy/piper-voices, as a commit: the files can never
// change under us. Each file is also checked against its SHA-256, at build
// time, after a download, and every time it is loaded.
export const VOICE_REVISION = '375a0fe641dea077c2a47b4e9a056d6da521eed3';

export const VOICES = [
  {
    id: 'en_US-ljspeech-medium',
    label: 'Female voice',
    included: true,
    bytes: 63531379,
    sha256: '6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22',
    configSha256: '141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860',
  },
  {
    id: 'en_US-kristin-medium',
    label: 'Female voice, lower',
    bytes: 63531379,
    sha256: '5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4',
    configSha256: '5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c',
  },
  {
    id: 'en_US-john-medium',
    label: 'Male voice',
    bytes: 63531379,
    sha256: '789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988',
    configSha256: 'af60f177b6b550f3d7a302720c0fb89e7f94a82b5dca464775ef63b1c69ba09a',
  },
];

export const DEFAULT_VOICE = VOICES[0].id;

/** Where the model file of a voice is; its settings are in the same place, with ".json" added. */
export function voiceUrl(id) {
  const [locale, name, quality] = id.split('-');
  return `https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REVISION}/${locale.split('_')[0]}/${locale}/${name}/${quality}/${id}.onnx`;
}
