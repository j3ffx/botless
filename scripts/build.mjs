// Bundles each entry point with esbuild and copies static files into dist/.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const out = 'dist';

const options = {
  entryPoints: {
    bridge: 'src/bridge/bridge.ts',
    content: 'src/content/index.ts',
    sw: 'src/background/sw.ts',
    popup: 'src/popup/popup.ts',
    options: 'src/options/options.ts',
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

function copyStatic() {
  mkdirSync(out, { recursive: true });
  cpSync('src/static', out, { recursive: true });
  cpSync('LICENSE', `${out}/LICENSE`); // GPL-3.0: the distributed package carries its license
  for (const f of ['src/popup/popup.html', 'src/popup/popup.css', 'src/options/options.html', 'src/options/options.css', 'src/content/content.css'])
    cpSync(f, `${out}/${f.split('/').pop()}`);
}

rmSync(out, { recursive: true, force: true });
copyStatic();
if (watch) {
  const ctx = await context({ ...options, plugins: [{ name: 'static', setup: (b) => b.onEnd(copyStatic) }] });
  await ctx.watch();
} else {
  await build(options);
}
