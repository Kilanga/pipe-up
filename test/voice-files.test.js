// The voice that is included in the extension: how the build gets and checks
// its files (scripts/voice-files.mjs). No network: the download is a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { voiceFiles } from '../scripts/voice-files.mjs';
import { VOICES, DEFAULT_VOICE } from '../extension/src/voices.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const model = Buffer.from('a model');
const config = Buffer.from('{"its":"settings"}');
const voice = { id: 'en_US-test-medium', sha256: sha256(model), configSha256: sha256(config) };
const URL_ = 'https://example.test/en_US-test-medium.onnx';
const server = (files, asked = []) => Object.assign(async (url) => (asked.push(url), files[url]), { asked });
const quietly = async (job) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await job();
  } finally {
    console.log = log;
  }
};

test('included voice: downloaded once, checked, then read from the folder without the network', async () => {
  const dir = mkdtempSync(tmpdir() + '/pipe-up-cache-') + '/voices/';
  const get = server({ [URL_]: model, [URL_ + '.json']: config });
  const files = await quietly(() => voiceFiles(voice, URL_, dir, get));
  assert.deepEqual(files.map((f) => [f.name, String(f.bytes)]), [[voice.id + '.onnx', 'a model'], [voice.id + '.onnx.json', '{"its":"settings"}']]);
  assert.deepEqual(get.asked, [URL_, URL_ + '.json']);
  const offline = async () => assert.fail('no download expected');
  assert.deepEqual((await voiceFiles(voice, URL_, dir, offline)).map((f) => f.name), files.map((f) => f.name));
  // A kept file that changed is downloaded again, not used.
  writeFileSync(dir + voice.id + '.onnx', 'something else');
  const again = server({ [URL_]: model });
  await quietly(() => voiceFiles(voice, URL_, dir, again));
  assert.deepEqual(again.asked, [URL_]);
  assert.equal(String(readFileSync(dir + voice.id + '.onnx')), 'a model');
});

test('included voice: a wrong file or a failed download stops the build and nothing is kept', async () => {
  const dir = mkdtempSync(tmpdir() + '/pipe-up-cache-') + '/voices/';
  const wrong = server({ [URL_]: Buffer.from('not the model') });
  await assert.rejects(quietly(() => voiceFiles(voice, URL_, dir, wrong)), /The included voice was not built: en_US-test-medium\.onnx from https:\/\/example\.test\/.*SHA-256 is [0-9a-f]{64}, expected [0-9a-f]{64}/);
  const down = async () => {
    throw new Error('error 503 from the server');
  };
  await assert.rejects(quietly(() => voiceFiles(voice, URL_, dir, down)), /The included voice was not built: .*error 503 from the server/);
  assert.ok(!existsSync(dir) || readdirSync(dir).length === 0);
});

test('one voice is included: the default one', () => {
  assert.deepEqual(VOICES.filter((v) => v.included).map((v) => v.id), [DEFAULT_VOICE]);
});

// Checks the last build, if there is one (`npm run build` makes dist/).
const built = new URL('../dist/extension/voice/', import.meta.url);
test('the built extension holds the included voice, exactly as listed, with its model card', { skip: !existsSync(built) && 'not built' }, () => {
  const v = VOICES.find((x) => x.included);
  const model = readFileSync(new URL(`models/${v.id}.onnx`, built));
  assert.equal(model.length, v.bytes);
  assert.equal(sha256(model), v.sha256);
  assert.equal(sha256(readFileSync(new URL(`models/${v.id}.onnx.json`, built))), v.configSha256);
  assert.match(readFileSync(new URL(`licenses/MODEL_CARD-${v.id}.md`, built), 'utf8'), /License: public domain/);
});
