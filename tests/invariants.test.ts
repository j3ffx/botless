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

interface Parsed {
  file: string;
  program: Node;
  source: string;
}

const parsed = new Map<string, Parsed>();
/** Parses a file from disk, or `source` when given (used by the self-tests below). */
function parse(file: string, source?: string): Parsed {
  if (source !== undefined || !parsed.has(file)) {
    const text = source ?? read(file);
    const { program, errors } = parseSync(file, text);
    if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
    const p = { file, program: program as unknown as Node, source: text };
    if (source !== undefined) return p;
    parsed.set(file, p);
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

const lineOf = (p: Parsed, n: Node) => p.source.slice(0, n.start).split('\n').length;
/** The value of a string literal or of a template literal without `${}`, else undefined. */
const stringValue = (n: Node | undefined): string | undefined =>
  n?.type === 'Literal' && typeof n.value === 'string' ? n.value
  : n?.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked
  : undefined;
/** `x.name` or `x['name']`: the property name, if it is statically known. */
const memberName = (n: Node): string | undefined =>
  n.type !== 'MemberExpression' ? undefined : n.computed ? stringValue(n.property) : n.property.name;
const KEY_PARENTS = /^(Property|PropertyDefinition|MethodDefinition|TSPropertySignature|TSMethodSignature)$/;

/** Free identifiers the file refers to (`chrome`, `fetch`, `document`…), ignoring property names like `x.fetch`. */
function globalsUsed(p: Parsed): Set<string> {
  const used = new Set<string>();
  walk(p.program, (n, parent, key) => {
    if (n.type !== 'Identifier' || !parent) return;
    if (key === 'property' && parent.type === 'MemberExpression' && !parent.computed) return;
    if (key === 'key' && !parent.computed && KEY_PARENTS.test(parent.type)) return;
    used.add(n.name);
  });
  return used;
}

/** `chrome`, whether used bare or as `window.chrome` / `globalThis['chrome']`. */
const usesChrome = (p: Parsed): boolean => {
  let found = globalsUsed(p).has('chrome');
  walk(p.program, (n) => (found ||= memberName(n) === 'chrome'));
  return found;
};

// ---- Network access ----

/** APIs that send a request, whatever object they're reached through. */
const NETWORK_APIS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'WebTransport', 'RTCPeerConnection']);
/** Elements that load a URL as soon as they get one. */
const LOADING_TAGS = new Set(['script', 'img', 'image', 'iframe', 'frame', 'link', 'audio', 'video', 'source', 'track', 'object', 'embed', 'use']);
/** Attributes / properties that make an element load a URL (or ping one). */
const LOADING_ATTRS = new Set(['src', 'srcset', 'ping', 'action', 'formaction', 'poster', 'data', 'background']);

/**
 * Every way the code could start a request, as "what@line". The one allowed use is the free `fetch` global in
 * src/content/checker.ts; anything else fails the test, including indirect forms like `globalThis.fetch`,
 * `window['fetch']`, `const { fetch: f } = self`, `new Image().src = …`, `import(url)` or `innerHTML`.
 */
function networkUses(p: Parsed): string[] {
  const out: string[] = [];
  const add = (what: string, n: Node) => out.push(`${what}@${lineOf(p, n)}`);
  walk(p.program, (n, parent, key) => {
    switch (n.type) {
      case 'Identifier':
        if (!NETWORK_APIS.has(n.name) || !parent) return;
        if (key === 'property' && parent.type === 'MemberExpression') return; // reported as a member below
        if (key === 'key' && !parent.computed && KEY_PARENTS.test(parent.type)) return; // { fetch: 1 } is harmless
        return add(n.name, n);
      case 'MemberExpression': {
        const name = memberName(n);
        if (name && NETWORK_APIS.has(name)) add(`.${name}`, n);
        return;
      }
      case 'ObjectPattern': // const { fetch: f } = globalThis
        for (const prop of n.properties as Node[]) {
          const name = prop.type === 'Property' ? (prop.computed ? stringValue(prop.key) : prop.key.name) : undefined;
          if (name && NETWORK_APIS.has(name)) add(`{ ${name} }`, prop);
        }
        return;
      case 'ImportExpression':
        return add('import()', n);
      case 'NewExpression':
        if (n.callee.type === 'Identifier' && (n.callee.name === 'Image' || n.callee.name === 'Audio')) add(`new ${n.callee.name}`, n);
        return;
      case 'AssignmentExpression': {
        const name = memberName(n.left)?.toLowerCase();
        if (name && (LOADING_ATTRS.has(name) || name === 'innerhtml' || name === 'outerhtml')) add(`.${name} =`, n);
        return;
      }
      case 'CallExpression': {
        const fn = memberName(n.callee);
        const arg = stringValue(n.arguments[0])?.toLowerCase();
        if ((fn === 'setAttribute' || fn === 'setAttributeNS') && arg !== undefined && LOADING_ATTRS.has(arg)) add(`setAttribute('${arg}')`, n);
        const tag = fn === 'createElementNS' ? stringValue(n.arguments[1])?.toLowerCase() : arg;
        if ((fn === 'createElement' || fn === 'createElementNS') && tag && LOADING_TAGS.has(tag)) add(`createElement('${tag}')`, n);
        if (fn === 'insertAdjacentHTML' || fn === 'write' || fn === 'writeln') add(`${fn}()`, n);
        return;
      }
    }
  });
  return out;
}

/** Calls to fetch, however it's reached: `fetch(…)`, `self.fetch(…)`, `window['fetch'](…)`. */
function fetchCalls(p: Parsed): Node[] {
  const calls: Node[] = [];
  walk(p.program, (n) => {
    if (n.type !== 'CallExpression') return;
    if ((n.callee.type === 'Identifier' && n.callee.name === 'fetch') || memberName(n.callee) === 'fetch') calls.push(n);
  });
  return calls;
}

/** Why a fetch call breaks the privacy rules, or null if it's fine. */
function fetchProblem(call: Node): string | null {
  const [url, init] = call.arguments as Node[];
  const urlText = url?.type === 'TemplateLiteral' ? url.quasis[0].value.cooked : stringValue(url) ?? '';
  if (!/^https:\/\/www\.youtube\.com\//.test(urlText)) return `URL must be a literal starting with https://www.youtube.com/`;
  const opt = (name: string) =>
    init?.type === 'ObjectExpression'
      ? stringValue((init.properties as Node[]).find((q) => q.type === 'Property' && !q.computed && q.key.name === name)?.value)
      : undefined;
  if (opt('credentials') !== 'omit') return `needs credentials: 'omit' (no cookies)`;
  if (opt('redirect') !== 'error') return `needs redirect: 'error' (never follow YouTube to another host)`;
  return null;
}

const files = sourceFiles(SRC);
const STORAGE_GLOBALS = ['localStorage', 'sessionStorage', 'indexedDB'];
const CHECKER = 'src/content/checker.ts';
const BRIDGE = 'src/bridge/bridge.ts';

describe('privacy: network access', () => {
  it('only src/content/checker.ts may make requests, and only through fetch', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const uses = networkUses(parse(f));
      const bad = f === CHECKER ? uses.filter((u) => !u.startsWith('fetch@')) : uses;
      offenders.push(...bad.map((u) => `${f} ${u}`));
    }
    expect(offenders).toEqual([]);
  });

  it('every fetch goes to https://www.youtube.com/ without cookies and without following redirects', () => {
    const calls = files.flatMap((f) => fetchCalls(parse(f)).map((c) => ({ f, c })));
    expect(calls.length).toBeGreaterThan(0);
    const problems = calls.flatMap(({ f, c }) => {
      const why = fetchProblem(c);
      return why ? [`${f}:${lineOf(parse(f), c)} ${why}`] : [];
    });
    expect(problems).toEqual([]);
  });

  // Self-test: the detector must catch these (all found in review, 2026-09-30) and must not flag harmless code.
  const caught = [
    "self.fetch('https://x')",
    "globalThis.fetch('https://x')",
    "window['fetch']('https://x')",
    'const { fetch: f } = globalThis; f(u)',
    "new Image().src = 'https://x'",
    "void import('https://x/m.js')",
    'navigator.sendBeacon(u)',
    "const n = navigator; n['sendBeacon'](u)",
    'new WebSocket(u)',
    'const X = XMLHttpRequest',
    "document.createElement('script')",
    "el.setAttribute('src', u)",
    "el.innerHTML = '<img src=x>'",
  ];
  it.each(caught)('detects %s', (code) => {
    expect(networkUses(parse('probe.ts', code))).not.toEqual([]);
  });

  const harmless = ['a.href = u', 'const o = { fetch: 1 }', "// fetch('https://x')", "const s = 'fetch'", "document.createElement('a')"];
  it.each(harmless)('allows %s', (code) => {
    expect(networkUses(parse('probe.ts', code))).toEqual([]);
  });

  it("flags a fetch that sends cookies or follows redirects, even via window['fetch']", () => {
    const [call] = fetchCalls(parse('probe.ts', "window['fetch']('https://www.youtube.com/x', { credentials: 'include' })"));
    expect(fetchProblem(call!)).toMatch(/credentials/);
    const [call2] = fetchCalls(parse('probe.ts', "fetch('https://www.youtube.com/x', { credentials: 'omit' })"));
    expect(fetchProblem(call2!)).toMatch(/redirect/);
  });
});

describe('MAIN-world bridge', () => {
  const p = parse(BRIDGE);
  it('has no chrome.*, no storage and no network', () => {
    expect(usesChrome(p)).toBe(false);
    expect([...globalsUsed(p)].filter((x) => STORAGE_GLOBALS.includes(x))).toEqual([]);
    expect(networkUses(p)).toEqual([]);
  });

  it('only imports pure modules (the chrome.* wrappers would pull chrome.* into the page)', () => {
    const imports = (p.program.body as Node[]).filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value as string);
    expect(imports.filter((s) => !['../shared/disclosure', '../shared/extract', '../shared/types'].includes(s))).toEqual([]);
  });
});

describe('src/shared stays pure', () => {
  // These two are the thin chrome.* wrappers; everything else in src/shared must run in plain Node.
  const WRAPPERS = ['src/shared/messages.ts', 'src/shared/storage.ts'];
  const pure = files.filter((f) => f.startsWith('src/shared/') && !WRAPPERS.includes(f));
  it.each(pure)('%s uses no DOM, chrome.* or network', (f) => {
    const p = parse(f);
    expect(usesChrome(p)).toBe(false);
    expect([...globalsUsed(p)].filter((x) => ['document', 'window', ...STORAGE_GLOBALS].includes(x))).toEqual([]);
    expect(networkUses(p)).toEqual([]);
  });
});

describe('channel IDs', () => {
  it('every /UC…/ regex is anchored (a free-floating one matches tracking params)', () => {
    const loose: string[] = [];
    for (const f of files) {
      const p = parse(f);
      walk(p.program, (n) => {
        const pattern: string | undefined = n.type === 'Literal' ? n.regex?.pattern : undefined;
        if (pattern && /UC[.[\\]/.test(pattern) && !/^\^.*\$$/.test(pattern)) loose.push(`${f}:${lineOf(p, n)} /${pattern}/`);
      });
    }
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
    expect(manifest.web_accessible_resources).toBeUndefined();
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
