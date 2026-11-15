import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The DOM and service-worker files are not imported by any unit test, so a
 * syntax slip in them would only show up in a browser. Parse them all here.
 */
const root = new URL('..', import.meta.url).pathname;
const files = [
  'sw.js',
  ...readdirSync(join(root, 'src'), { recursive: true })
    .filter((name) => name.endsWith('.js'))
    .map((name) => join('src', name)),
];

for (const file of files) {
  test(`${file} parses`, () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' }));
  });
}
