// The voice that is included in the extension. Its two files are too large
// for git (64 MB), so the build gets them from the pinned revision listed in
// extension/src/voices.js, checks them, and keeps them in a folder that is
// not committed: later builds need no network.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`no answer (${e.cause?.code || e.cause?.message || e.message}). The first build needs the network`);
  }
  if (!res.ok) throw new Error(`error ${res.status} from the server`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Returns the model and the settings of voice `v` as [{ name, bytes }], from
 * `cacheDir` or else from `url` (and `url` + ".json"). Throws, and keeps
 * nothing, if a file cannot be had or is not exactly the expected one.
 */
export async function voiceFiles(v, url, cacheDir, get = download) {
  const wanted = [
    { name: v.id + '.onnx', from: url, hash: v.sha256 },
    { name: v.id + '.onnx.json', from: url + '.json', hash: v.configSha256 },
  ];
  const files = [];
  for (const { name, from, hash } of wanted) {
    const kept = cacheDir + name;
    let bytes = existsSync(kept) ? readFileSync(kept) : null;
    if (!bytes || sha256(bytes) !== hash) {
      const why = (problem) => new Error(`The included voice was not built: ${name} from ${from}: ${problem}.`);
      console.log(`Getting ${name} (once; kept in ${cacheDir})`);
      bytes = await get(from).catch((e) => {
        throw why(e.message);
      });
      if (sha256(bytes) !== hash) throw why(`SHA-256 is ${sha256(bytes)}, expected ${hash}`);
      mkdirSync(cacheDir, { recursive: true });
      // Written under another name first: a build stopped half-way leaves no
      // file that looks complete.
      writeFileSync(kept + '.part', bytes);
      renameSync(kept + '.part', kept);
    }
    files.push({ name, bytes });
  }
  return files;
}
