// Makes the phonemizer's data file small for an English-only extension.
//
// piper_phonemize.data is one big file holding espeak-ng's data for every
// language (about 18 MB, of which 17 MB are pronunciation dictionaries). The
// phonemizer's JavaScript loader has a table with the name and the byte
// offsets of each file inside it. Pipe Up only speaks English, so the build
// keeps the dictionaries an English voice can reach and every shared file,
// and rewrites the table to match. Nothing in node_modules is changed.

// English, plus the dictionaries espeak-ng switches to by itself when an
// English text contains words in these scripts: Greek, Armenian, Devanagari,
// Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Sinhala,
// Georgian and Korean. With this list the phonemes are the same as with the
// full data for every text (see test/phonemizer.test.js). English alone
// would save another 1.2 MB (0.3 MB in the zip), but words in those scripts
// would be skipped.
export const ENGLISH_VOICE_DICTIONARIES = ['en', 'el', 'hy', 'hi', 'bn', 'pa', 'gu', 'ta', 'te', 'kn', 'ml', 'si', 'ka', 'ko'];

// The table as written in the loader: loadPackage({"files":[...],"remote_package_size":N})
const TABLE = /loadPackage\((\{\s*"files"\s*:\s*\[[^\]]*\]\s*,\s*"remote_package_size"\s*:\s*\d+\s*\})\)/g;
const DICTIONARY = /^\/espeak-ng-data\/([a-z]+)_dict$/;

const fail = (why) => {
  throw new Error(
    `Cannot trim the phonemizer data: ${why}. ` +
      'The phonemizer in @diffusionstudio/piper-wasm (build/piper_phonemize.js and .data) has probably changed version: ' +
      'update scripts/phonemizer-data.mjs before building.'
  );
};

/**
 * @param {string} loader  source of the phonemizer's JavaScript loader
 * @param {Uint8Array} data  the full piper_phonemize.data
 * @param {string[]} languages  dictionaries to keep
 * @returns {{loader: string, data: Uint8Array, kept: number, removed: number}}
 */
export function trimPhonemizerData(loader, data, languages = ENGLISH_VOICE_DICTIONARIES) {
  const tables = [...loader.matchAll(TABLE)];
  if (tables.length !== 1) fail(`expected one file table (loadPackage({"files": …})) in the loader, found ${tables.length}`);
  let table;
  try {
    table = JSON.parse(tables[0][1]);
  } catch (e) {
    fail('the file table is not valid JSON (' + e.message + ')');
  }
  // The table must describe exactly this data file: same size, no gaps.
  if (table.remote_package_size !== data.length) fail(`the loader expects ${table.remote_package_size} bytes of data but the file has ${data.length}`);
  let at = 0;
  for (const f of table.files) {
    if (f.start !== at || f.end < f.start) fail(`unexpected offsets for ${f.filename}`);
    at = f.end;
  }
  if (at !== data.length) fail('the file table does not cover the whole data file');

  const keep = new Set(languages);
  const files = [];
  const parts = [];
  let size = 0;
  for (const f of table.files) {
    const dict = f.filename.match(DICTIONARY);
    if (dict && !keep.has(dict[1])) continue;
    if (dict) keep.delete(dict[1]);
    const bytes = data.subarray(f.start, f.end);
    files.push({ filename: f.filename, start: size, end: size + bytes.length });
    parts.push(bytes);
    size += bytes.length;
  }
  if (keep.size) fail(`no dictionary found for: ${[...keep].join(', ')}`);

  const out = new Uint8Array(size);
  for (let i = 0, o = 0; i < parts.length; o += parts[i++].length) out.set(parts[i], o);
  const newTable = JSON.stringify({ ...table, files, remote_package_size: size });
  return {
    loader: loader.replace(tables[0][1], () => newTable),
    data: out,
    kept: files.length,
    removed: table.files.length - files.length,
  };
}
