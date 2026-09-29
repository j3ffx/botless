/// <reference types="node" />
// Guards the invariants listed in CLAUDE.md, so that breaking one fails CI instead of relying on review.
// It parses the sources (oxc-parser, standard ESTree output), so comments and strings never cause false matches.
// If a test here fails on purpose, discuss the change first (CLAUDE.md), then update the test.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

const SRC = 'src';
const read = (p: string) => readFileSync(p, 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name).replaceAll('\\', '/');
    if (e.isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/** A loosely typed ESTree node: the checks below only read a few well-known fields. */
type Node = { type: string; start: number; [key: string]: any };
const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && typeof (v as Node).type === 'string';

const parsed = new Map<string, { program: Node; source: string }>();
function parse(file: string): { program: Node; source: string } {
  if (!parsed.has(file)) {
    const source = read(file);
    const { program, errors } = parseSync(file, source);
    if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
    parsed.set(file, { program: program as unknown as Node, source });
  }
  return parsed.get(file)!;
}

/** Visits every node with its parent and the key it hangs from. */
function walk(node: Node, visit: (n: Node, parent: Node | null, key: string) => void, parent: Node | null = null, key = ''): void {
  visit(node, parent, key);
  for (const [k, v] of Object.entries(node)) {
    if (Array.isArray(v)) for (const c of v) isNode(c) && walk(c, visit, node, k);
    else if (isNode(v)) walk(v, visit, node, k);
  }
}

const lineOf = (file: string, n: Node) => parse(file).source.slice(0, n.start).split('\n').length;

/** Free identifiers the file refers to (`chrome`, `fetch`, `document`…), ignoring property names like `x.fetch`. */
function globalsUsed(file: string): Set<string> {
  const used = new Set<string>();
  walk(parse(file).program, (n, parent, key) => {
    if (n.type !== 'Identifier' || !parent) return;
    if (key === 'property' && parent.type === 'MemberExpression' && !parent.computed) return;
    if (key === 'key' && !parent.computed && /^(Property|PropertyDefinition|MethodDefinition|TSPropertySignature|TSMethodSignature)$/.test(parent.type)) return;
    used.add(n.name);
  });
  return used;
}

/** Property names accessed anywhere in the file (`navigator.sendBeacon` -> `sendBeacon`). */
function propertiesUsed(file: string): Set<string> {
  const used = new Set<string>();
  walk(parse(file).program, (n) => {
    if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') used.add(n.property.name);
  });
  return used;
}

const files = sourceFiles(SRC);
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
const STORAGE_GLOBALS = ['localStorage', 'sessionStorage', 'indexedDB'];
const CHECKER = 'src/content/checker.ts';

describe('privacy: network access', () => {
  it('only src/content/checker.ts may make requests', () => {
    const offenders = files.filter((f) => {
      if (f === CHECKER) return false;
      const g = globalsUsed(f);
      return NETWORK_GLOBALS.some((x) => g.has(x)) || propertiesUsed(f).has('sendBeacon');
    });
    expect(offenders).toEqual([]);
  });

  it('every fetch goes to https://www.youtube.com/ without cookies', () => {
    const calls: Node[] = [];
    walk(parse(CHECKER).program, (n) => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'fetch') calls.push(n);
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const [url, init] = call.arguments as Node[];
      const urlText =
        url?.type === 'Literal' && typeof url.value === 'string' ? url.value
        : url?.type === 'TemplateLiteral' ? url.quasis[0].value.cooked
        : '';
      const where = `${CHECKER}:${lineOf(CHECKER, call)}`;
      expect(urlText, `fetch URL at ${where}`).toMatch(/^https:\/\/www\.youtube\.com\//);
      const credentials =
        init?.type === 'ObjectExpression'
          ? (init.properties as Node[]).find((p) => p.type === 'Property' && !p.computed && p.key.name === 'credentials')
          : undefined;
      expect(credentials?.value.value, `credentials at ${where}`).toBe('omit');
    }
  });
});

describe('MAIN-world bridge', () => {
  it('has no chrome.*, no storage and no network', () => {
    const g = globalsUsed('src/bridge/bridge.ts');
    expect([...g].filter((x) => ['chrome', ...STORAGE_GLOBALS, ...NETWORK_GLOBALS].includes(x))).toEqual([]);
  });
});

describe('src/shared stays pure', () => {
  // These two are the thin chrome.* wrappers; everything else in src/shared must run in plain Node.
  const WRAPPERS = ['src/shared/messages.ts', 'src/shared/storage.ts'];
  const pure = files.filter((f) => f.startsWith('src/shared/') && !WRAPPERS.includes(f));
  it.each(pure)('%s uses no DOM, chrome.* or network', (f) => {
    const g = globalsUsed(f);
    expect([...g].filter((x) => ['chrome', 'document', 'window', ...STORAGE_GLOBALS, ...NETWORK_GLOBALS].includes(x))).toEqual([]);
  });
});

describe('channel IDs', () => {
  it('every /UC…/ regex is anchored (a free-floating one matches tracking params)', () => {
    const loose: string[] = [];
    for (const f of files)
      walk(parse(f).program, (n) => {
        const pattern: string | undefined = n.type === 'Literal' ? n.regex?.pattern : undefined;
        if (pattern && /UC[.[\\]/.test(pattern) && !/^\^.*\$$/.test(pattern)) loose.push(`${f}:${lineOf(f, n)} /${pattern}/`);
      });
    expect(loose).toEqual([]);
  });
});

describe('manifest', () => {
  const manifest = JSON.parse(read('src/static/manifest.json'));
  const pkg = JSON.parse(read('package.json'));

  it('asks for no more than storage + youtube.com', () => {
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.host_permissions).toEqual(['https://www.youtube.com/*']);
    expect(manifest.optional_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.content_security_policy).toBeUndefined();
    for (const cs of manifest.content_scripts) expect(cs.matches).toEqual(['https://www.youtube.com/*']);
  });

  it('has the same version as package.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });
});

describe('popup', () => {
  it('has at most two switches', () => {
    const switches = read('src/popup/popup.html').match(/<input[^>]*type="checkbox"/g) ?? [];
    expect(switches.length).toBeLessThanOrEqual(2);
  });
});
