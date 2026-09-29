// Runs during `npm version <patch|minor|major>` (the "version" script): copies the new package.json version
// into the extension manifest, so both are bumped in the same release commit.
import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = 'src/static/manifest.json';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  // Chrome only accepts 1-4 dot-separated integers: no "-beta.1" suffixes.
  console.error(`Chrome can't use version "${version}": use plain MAJOR.MINOR.PATCH.`);
  process.exit(1);
}
const text = readFileSync(MANIFEST, 'utf8');
const next = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
if (next === text && JSON.parse(text).version !== version) throw new Error(`no "version" field in ${MANIFEST}`);
writeFileSync(MANIFEST, next);
console.log(`${MANIFEST} -> ${version}`);
