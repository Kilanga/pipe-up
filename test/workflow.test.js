// The release workflow is part of the security review: this keeps it as reviewed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('release workflow: least privilege, no expression inside a shell script, actions pinned by commit', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const [build, release] = yml.split(/^  release:\n(?=    needs:)/m);
  assert.match(yml, /^permissions: \{\}$/m, 'nothing is granted by default');
  assert.match(build, /contents: read/);
  assert.doesNotMatch(build, /contents: write/);
  assert.match(build, /persist-credentials: false/);
  assert.match(release, /contents: write/);
  assert.doesNotMatch(release, /actions\/checkout|npm /, 'the job that can write runs no code from the repository');
  // Every `run:` script: no ${{ }} (values reach the shell through env).
  const scripts = [...yml.matchAll(/^( +)(?:- )?run: (\|\n(?:(?:\1 {2,}.*)?\n)+|.*\n)/gm)].map((m) => m[2]);
  assert.ok(scripts.length >= 5, String(scripts.length));
  for (const s of scripts) assert.doesNotMatch(s, /\$\{\{/, s);
  for (const [, ref] of yml.matchAll(/uses: \S+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/, ref);
});
