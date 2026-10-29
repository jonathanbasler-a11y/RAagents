// Reads the output of `litestream ltx -json -level all <url>` on stdin and prints the age, in whole seconds, of the newest
// file in the backup, or "none" when the backup holds no file. Used by scripts/hosted/start.sh to tell whether another
// copy is still writing the backup. Litestream may print log lines before the JSON array; they are skipped. Anything it
// cannot read exits 2, so the start script stops rather than guess.
import { readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`[hosted] backup-age: ${message}`);
  process.exit(2);
};

const lines = readFileSync(0, 'utf8').split('\n');
const start = lines.findIndex((line) => line.trimStart().startsWith('['));
if (start < 0) fail('no file list in the litestream output');
let files;
try {
  files = JSON.parse(lines.slice(start).join('\n'));
} catch {
  fail('could not read the file list');
}
if (!Array.isArray(files)) fail('the file list is not a list');
if (files.length === 0) {
  console.log('none');
} else {
  const times = files.map((file) => Date.parse(file?.timestamp));
  if (times.some((time) => !Number.isFinite(time))) fail('a file in the list has no readable time');
  // Negative for a file dated in the future: the start script treats that as "still being written".
  console.log(String(Math.floor((Date.now() - Math.max(...times)) / 1000)));
}
