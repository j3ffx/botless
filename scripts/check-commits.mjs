// Enforces Conventional Commits (CLAUDE.md → Commits). Zero dependencies.
//   node scripts/check-commits.mjs --file .git/COMMIT_EDITMSG   one message (the commit-msg hook)
//   node scripts/check-commits.mjs <from>..<to>                 every non-merge commit in a range (CI)
//   node scripts/check-commits.mjs                              commits on this branch not yet on origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Single source of truth for types and scopes; CLAUDE.md points here.
export const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore', 'style', 'revert'];
export const SCOPES = [
  'popup', 'options', 'content', 'bridge', 'sw', 'checker', 'scoring', 'shared', 'manifest', 'docs',
  'deps', 'deps-dev', 'release', // used by Dependabot and `npm version`
];
const MAX_HEADER = 72;
// Commits up to and including this one predate the rule and are never checked.
const RULE_START = 'ce9d981';
// Dependabot's messages are generated ("build(deps-dev): Bump x from 1 to 2") and always capitalise "Bump".
// Their type and scope come from .github/dependabot.yml. Checking them would only block its PRs.
const BOTS = ['49699333+dependabot[bot]@users.noreply.github.com'];

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\s]+)\))?(?<bang>!)?: (?<desc>.+)$/;

/** Returns the problems with one commit message (empty when it's valid). */
export function lint(message, { allowFixup = false } = {}) {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const header = lines[0] ?? '';
  if (allowFixup && /^(fixup|squash|amend)! /.test(header)) return [];
  const problems = [];
  const m = HEADER.exec(header);
  if (!m) return [`header must look like "type(scope): description", got "${header}"`];
  const { type, scope, desc } = m.groups;
  if (!TYPES.includes(type)) problems.push(`unknown type "${type}" (allowed: ${TYPES.join(', ')})`);
  if (scope !== undefined && !SCOPES.includes(scope)) problems.push(`unknown scope "${scope}" (allowed: ${SCOPES.join(', ')})`);
  if (/^[A-Z][a-z]/.test(desc)) problems.push('description must start lowercase');
  if (desc.endsWith('.')) problems.push('description must not end with a period');
  if (desc !== desc.trim()) problems.push('description has leading/trailing spaces');
  if ([...header].length > MAX_HEADER) problems.push(`header is ${[...header].length} characters (max ${MAX_HEADER})`);
  if (lines.length > 1 && lines[1] !== '') problems.push('leave a blank line between the header and the body');
  for (const l of lines.slice(1))
    if (/^BREAKING[ -]CHANGE/i.test(l) && !/^BREAKING[ -]CHANGE: \S/.test(l)) problems.push(`malformed footer "${l}" (use "BREAKING CHANGE: …")`);
  return problems;
}

/** What `git commit` would store: comments and the --verbose diff (below the scissors) stripped. */
function cleanup(raw) {
  const scissors = raw.search(/^# -+ >8 -+$/m);
  const kept = scissors === -1 ? raw : raw.slice(0, scissors);
  return kept.split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n').trim();
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const exists = (rev) => {
  try {
    git('cat-file', '-e', `${rev}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

function commitsIn(range) {
  let [from, to] = range.includes('..') ? range.split('..') : [null, range];
  to ||= 'HEAD';
  // New branch (all-zero "before"), or a force-push that dropped the old tip: check the newest commit only.
  if (from && (/^0+$/.test(from) || !exists(from))) from = `${to}~1`;
  if (from && !exists(from)) from = null; // `to` is a root commit
  const args = ['log', '--no-merges', '--format=%H%x00%ae%x00%B%x1e', from ? `${from}..${to}` : `${to}`];
  if (exists(RULE_START)) args.push(`^${RULE_START}`);
  return git(...args)
    .split('\x1e')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [sha, author, body] = s.split('\x00');
      return { sha: sha.slice(0, 7), author, message: body.trim() };
    })
    .filter((c) => !BOTS.includes(c.author));
}

function main(argv) {
  if (argv[0] === '--file') {
    const message = cleanup(readFileSync(argv[1], 'utf8'));
    if (!message) return 0; // empty message: git aborts the commit on its own
    const problems = lint(message, { allowFixup: true });
    if (!problems.length) return 0;
    console.error(`✖ Commit message rejected (see CLAUDE.md → Commits):\n  ${problems.join('\n  ')}\n\n  ${message.split('\n')[0]}`);
    return 1;
  }
  const commits = commitsIn(argv[0] ?? 'origin/main..HEAD');
  let bad = 0;
  for (const c of commits) {
    const problems = lint(c.message);
    if (!problems.length) continue;
    bad++;
    console.error(`✖ ${c.sha} ${c.message.split('\n')[0]}\n    ${problems.join('\n    ')}`);
  }
  console.log(`${commits.length - bad}/${commits.length} commit message(s) OK`);
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
