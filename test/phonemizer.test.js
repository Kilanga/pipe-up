// The build ships a small phonemizer data file (scripts/phonemizer-data.mjs).
// These tests run the real phonemizer in Node, once with the full data and
// once with the small one, and check that the phonemes are the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { trimPhonemizerData, ENGLISH_VOICE_DICTIONARIES } from '../scripts/phonemizer-data.mjs';

const pkg = fileURLToPath(new URL('../node_modules/@diffusionstudio/piper-wasm/build/', import.meta.url));
const loader = readFileSync(pkg + 'piper_phonemize.js', 'utf8');
const data = readFileSync(pkg + 'piper_phonemize.data');
const small = trimPhonemizerData(loader, data);

// Both loaders are written to a temporary folder and run as they are.
const dir = mkdtempSync(tmpdir() + '/pipe-up-phonemizer-');
const require = createRequire(import.meta.url);
function phonemizer(name, source, bytes) {
  writeFileSync(`${dir}/${name}.cjs`, source);
  writeFileSync(`${dir}/${name}.data`, bytes);
  const create = require(`${dir}/${name}.cjs`);
  return (text, voice = 'en-us') =>
    new Promise((resolve, reject) => {
      let ids = null;
      create({
        print: (line) => (ids = JSON.parse(line).phoneme_ids),
        printErr: () => {},
        locateFile: (f) => (f.endsWith('.wasm') ? pkg + 'piper_phonemize.wasm' : `${dir}/${name}.data`),
      }).then((m) => {
        m.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
        ids ? resolve(ids) : reject(new Error('no phonemes for: ' + text));
      }, reject);
    });
}
const full = phonemizer('full', loader, data);
const trimmed = phonemizer('small', small.loader, small.data);

const SENTENCES = [
  "It's signed, except for the penalty clause.",
  "I'm still speaking, one moment.",
  'I stutter. Sometimes I answer in the chat, or a computer voice reads my reply.',
  // digits, dates, money, symbols
  'The budget is 40,000 euros, approved on March 3rd, 2026 at 10:30.',
  'Call 555-0199 or pay $12.50, that is 15% of 83.',
  '€20, £5, ¥300, 3 × 4 = 12, 50 °C, ½ cup.',
  "Dr. Smith's e-mail is sam@example.com; the URL is https://example.com/a?b=1.",
  // accents
  "My résumé is at the café, naïve as Zoë's jalapeño piñata.",
  'Señor Müller ate crème brûlée in São Paulo, façade and all.',
  'Zażółć gęślą jaźń. Příliš žluťoučký kůň. Ærø, Ångström, İstanbul, Dvořák.',
  'Tiếng Việt: xin chào, tôi tên là Sam.',
  // other scripts, alone and inside an English sentence
  'Say Привет and 你好 to the team, then déjà vu.',
  'Say 안녕하세요 to the team, then we start.',
  'Mr. नमस्ते will join at 5.',
  'Привет, меня зовут Сэм.',
  '你好，我叫山姆。',
  'こんにちは、サムです。',
  'مرحبا، اسمي سام.',
  'שלום, קוראים לי סם.',
  'สวัสดีครับ ผมชื่อแซม',
  'Γειά σου, με λένε Σαμ.',
  'Բարև, իմ անունը Սեմ է։',
  'नमस्ते, मेरा नाम सैम है।',
  'নমস্কার, আমার নাম স্যাম।',
  'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੇਰਾ ਨਾਮ ਸੈਮ ਹੈ।',
  'નમસ્તે, મારું નામ સેમ છે.',
  'வணக்கம், என் பெயர் சாம்.',
  'నమస్కారం, నా పేరు సామ్.',
  'ನಮಸ್ಕಾರ, ನನ್ನ ಹೆಸರು ಸ್ಯಾಮ್.',
  'നമസ്കാരം, എന്റെ പേര് സാം.',
  'ආයුබෝවන්, මගේ නම සෑම්.',
  'გამარჯობა, მე მქვია სემი.',
  '안녕하세요, 저는 샘입니다.',
  'Thanks 👍 see you at 5 pm — okay?',
];

test('the small data file keeps the shared files and far fewer dictionaries', () => {
  assert.ok(small.data.length < data.length / 5, `${small.data.length} bytes`);
  assert.ok(small.removed > 90, `${small.removed} dictionaries removed`);
  const names = [...small.loader.matchAll(/"filename":"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(names.length, small.kept);
  assert.deepEqual(
    names.filter((n) => n.endsWith('_dict')).sort(),
    ENGLISH_VOICE_DICTIONARIES.map((l) => `/espeak-ng-data/${l}_dict`).sort()
  );
  for (const shared of ['phondata', 'phonindex', 'phontab', 'intonations', 'lang/gmw/en-US']) assert.ok(names.includes('/espeak-ng-data/' + shared), shared);
});

test('phonemes are identical with the full and the small data', async () => {
  let ids = 0;
  // 'en' is the espeak-ng voice of the Piper voices Pipe Up offers.
  for (const voice of ['en', 'en-us', 'en-gb-x-rp']) {
    for (const text of SENTENCES) {
      const expected = await full(text, voice);
      assert.ok(expected.length > 3, text);
      assert.deepEqual(await trimmed(text, voice), expected, `${voice}: ${text}`);
      ids += expected.length;
    }
  }
  assert.ok(ids > 15000);
});

test('English alone would change words written in other scripts', async () => {
  // Why the build keeps more than the English dictionary.
  const onlyEnglish = trimPhonemizerData(loader, data, ['en']);
  const en = phonemizer('en', onlyEnglish.loader, onlyEnglish.data);
  const text = 'Say 안녕하세요 to the team, then we start.';
  assert.notDeepEqual(await en(text), await full(text));
  assert.deepEqual(await en(SENTENCES[0]), await full(SENTENCES[0]));
});

test('a changed loader or data file stops the build with a clear message', () => {
  assert.throws(() => trimPhonemizerData(loader.replace('loadPackage(', 'loadPkg('), data), /Cannot trim the phonemizer data: expected one file table/);
  assert.throws(() => trimPhonemizerData(loader, data.subarray(0, data.length - 1)), /the loader expects \d+ bytes of data but the file has \d+/);
  assert.throws(() => trimPhonemizerData(loader, data, ['en', 'xx']), /no dictionary found for: xx/);
});
