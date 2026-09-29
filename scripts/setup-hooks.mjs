// Runs on `npm install` (the "prepare" script): points git at .githooks/ so the commit-msg hook checks
// Conventional Commits locally. Leaves a hooksPath you set yourself alone, and does nothing outside a git checkout.
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

try {
  git('rev-parse', '--git-dir');
} catch {
  process.exit(0); // not a git checkout (e.g. an unpacked tarball)
}
let current = '';
try {
  current = git('config', '--get', 'core.hooksPath');
} catch {
  /* unset */
}
if (current && current !== '.githooks') {
  console.log(`core.hooksPath is already "${current}"; not changing it. Add .githooks/commit-msg to it yourself.`);
} else if (!current) {
  git('config', 'core.hooksPath', '.githooks');
  console.log('git hooks enabled (.githooks/commit-msg checks Conventional Commits)');
}
