// Guards the invariants listed in CLAUDE.md, so that breaking one fails CI instead of relying on review.
// It reads the sources with the TypeScript parser, so comments and strings never cause false matches.
// If a test here fails on purpose, discuss the change first (CLAUDE.md), then update the test.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
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

const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}

/** Free identifiers the file refers to (`chrome`, `fetch`, `document`…), ignoring property names like `x.fetch`. */
function globalsUsed(file: string): Set<string> {
  const used = new Set<string>();
  walk(parse(file), (n) => {
    if (!ts.isIdentifier(n)) return;
    const p = n.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === n) return;
    if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === n) return;
    used.add(n.text);
  });
  return used;
}

/** Property names accessed anywhere in the file (`navigator.sendBeacon` -> `sendBeacon`). */
function propertiesUsed(file: string): Set<string> {
  const used = new Set<string>();
  walk(parse(file), (n) => {
    if (ts.isPropertyAccessExpression(n)) used.add(n.name.text);
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
    const calls: ts.CallExpression[] = [];
    walk(parse(CHECKER), (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fetch') calls.push(n);
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const [url, init] = call.arguments;
      const urlText =
        url && (ts.isStringLiteral(url) || ts.isNoSubstitutionTemplateLiteral(url)) ? url.text
        : url && ts.isTemplateExpression(url) ? url.head.text
        : '';
      expect(urlText, `fetch URL at ${CHECKER}:${line(call)}`).toMatch(/^https:\/\/www\.youtube\.com\//);
      const credentials =
        init && ts.isObjectLiteralExpression(init)
          ? init.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'credentials')
          : undefined;
      expect(credentials?.initializer.getText(), `credentials at ${CHECKER}:${line(call)}`).toMatch(/^['"]omit['"]$/);
    }
  });
});

describe('MAIN-world bridge', () => {
  const g = globalsUsed('src/bridge/bridge.ts');
  it('has no chrome.*, no storage and no network', () => {
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
      walk(parse(f), (n) => {
        if (ts.isRegularExpressionLiteral(n) && /UC[.[\\]/.test(n.text) && !/^\/\^.*\$\/[a-z]*$/.test(n.text))
          loose.push(`${f}:${line(n)} ${n.text}`);
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

function line(n: ts.Node): number {
  const sf = n.getSourceFile();
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}
