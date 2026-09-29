// Zips dist/ into botless-<version>.zip, the file you upload to the Chrome Web Store or attach to a release.
// No dependencies: a minimal ZIP writer (deflate + CRC-32 from node:zlib). Entries are sorted and carry a
// fixed timestamp, so the same dist/ always gives the same zip.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const DIST = 'dist';
const { version } = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const out = process.argv[2] ?? `botless-${version}.zip`;

const all = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]));
const files = all(DIST)
  .map((f) => ({ path: relative(DIST, f).replaceAll('\\', '/'), data: readFileSync(f) }))
  .sort((a, b) => (a.path < b.path ? -1 : 1));

// DOS date/time for 1980-01-01 00:00 (the ZIP epoch): fixed so builds are reproducible.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;
for (const { path, data } of files) {
  const name = Buffer.from(path);
  const deflated = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, deflated);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + deflated.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(out, zip);
console.log(`${out}: ${files.length} files, ${(zip.length / 1024).toFixed(1)} KB`);
