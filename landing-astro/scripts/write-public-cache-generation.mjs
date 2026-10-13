import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Identify the actual static shell, including its content-hashed asset names.
// This public marker contains no owner data or runtime configuration.
const output = resolve('dist');
const hash = createHash('sha256');
for (const file of ['index.html', 'index.md']) {
  hash.update(await readFile(resolve(output, file)));
}
await writeFile(resolve(output, 'public-cache-generation.txt'), `${hash.digest('hex')}\n`);
