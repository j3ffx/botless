// Prints Markdown release notes for a tag, grouped by Conventional Commit type, from the previous tag.
//   node scripts/release-notes.mjs [tag]    (default: HEAD, i.e. what the next release would contain)
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const to = process.argv[2] ?? 'HEAD';
let from = '';
try {
  from = git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${to}^`);
} catch {
  /* first release: everything up to `to` */
}

const log = git('log', '--no-merges', '--format=%h%x00%s%x00%b%x1e', from ? `${from}..${to}` : to);
const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
];
const groups = new Map(SECTIONS.map(([t]) => [t, []]));
const breaking = [];
const other = [];

for (const entry of log.split('\x1e').map((s) => s.trim()).filter(Boolean)) {
  const [sha, subject, body = ''] = entry.split('\x00');
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(subject);
  if (!m) {
    other.push(`- ${subject} (${sha})`); // commits from before the Conventional Commits rule
    continue;
  }
  const [, type, scope, bang, desc] = m;
  if (type === 'chore' && scope === 'release') continue;
  const line = `- ${scope ? `**${scope}:** ` : ''}${desc} (${sha})`;
  const note = /^BREAKING[ -]CHANGE: (.+)$/m.exec(body)?.[1];
  if (bang || note) breaking.push(`- ${scope ? `**${scope}:** ` : ''}${note ?? desc} (${sha})`);
  if (groups.has(type)) groups.get(type).push(line);
  else other.push(`- ${type}${scope ? `(${scope})` : ''}: ${desc} (${sha})`);
}

const out = [];
if (breaking.length) out.push('### ⚠ Breaking changes', '', ...breaking, '');
for (const [type, title] of SECTIONS) if (groups.get(type).length) out.push(`### ${title}`, '', ...groups.get(type), '');
if (other.length) out.push('<details><summary>Other changes</summary>', '', ...other, '', '</details>', '');
if (from) out.push(`Changes since ${from}.`);
console.log(out.join('\n').trim() || 'No changes.');
