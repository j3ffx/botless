import { makeBackup, parseBackup } from '../shared/backup';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../shared/settings';
import { sendToSw } from '../shared/messages';
import { getOverrides, getSettings, isChannelKey, KEY } from '../shared/storage';
import type { ChannelRecord, Overrides } from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const local = chrome.storage.local;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

let settings: Settings;

// ---- Settings form: every control declares its settings path in data-path ----

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce((o, k) => (o[k] ??= {}) as Record<string, unknown>, obj);
  target[last] = value;
}

const controls = () => [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]')];

function fillForm(): void {
  for (const el of controls()) {
    const v = getPath(settings, el.dataset.path!);
    const scale = Number(el.dataset.scale ?? 1);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v;
    else el.value = typeof v === 'number' ? String(Math.round(v * scale * 1000) / 1000) : String(v);
  }
  // The YouTube sub-options only apply while the "Active mode" gate is on.
  const sub = document.getElementById('youtube-sub');
  sub?.classList.toggle('off', !settings.youtubeRequests);
  sub?.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = !settings.youtubeRequests));
}

let savedTimer: ReturnType<typeof setTimeout> | undefined;
async function save(): Promise<void> {
  const next = structuredClone(settings) as unknown as Record<string, unknown>;
  for (const el of controls()) {
    const scale = Number(el.dataset.scale ?? 1);
    let value: unknown;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
    else if (el instanceof HTMLInputElement && el.type === 'number') {
      if (el.value.trim() === '' || !Number.isFinite(el.valueAsNumber)) continue; // keep previous value
      value = el.valueAsNumber / scale;
    } else value = el.value;
    setPath(next, el.dataset.path!, value);
  }
  settings = normalizeSettings(next);
  await local.set({ [KEY.settings]: settings });
  fillForm(); // show clamped values
  $('saved').textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1500);
}

// ---- Overrides table ----

async function renderOverrides(): Promise<void> {
  const overrides = await getOverrides();
  const entries = Object.entries(overrides).sort((a, b) => b[1].at - a[1].at);
  $('ov-empty').hidden = entries.length > 0;
  $('ov-table').hidden = entries.length === 0;
  const body = $('ov-body');
  body.replaceChildren();
  for (const [id, o] of entries) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    const a = document.createElement('a');
    a.href = `https://www.youtube.com/channel/${id}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = o.name || id;
    const small = document.createElement('span');
    small.className = 'id';
    small.textContent = id;
    name.append(a, small);

    const mark = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `pill ${o.verdict}`;
    pill.textContent = o.verdict === 'ai' ? 'AI' : 'Human';
    mark.append(pill);

    const since = document.createElement('td');
    since.className = 'muted';
    since.textContent = new Date(o.at).toLocaleDateString();

    const act = document.createElement('td');
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove your mark on ${o.name || id}`);
    rm.addEventListener('click', () =>
      void sendToSw({ type: 'setOverride', channelId: id, verdict: null }),
    );
    act.append(rm);

    tr.append(name, mark, since, act);
    body.append(tr);
  }
}

// ---- Data ----

function status(text: string, error = false): void {
  const el = $('data-status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

async function allChannels(): Promise<Record<string, ChannelRecord>> {
  const all = await local.get(null);
  const out: Record<string, ChannelRecord> = {};
  for (const [k, v] of Object.entries(all)) if (isChannelKey(k)) out[k.slice(2)] = v as ChannelRecord;
  return out;
}

async function renderDataSize(): Promise<void> {
  const [bytes, channels] = await Promise.all([local.getBytesInUse(null), allChannels()]);
  $('data-size').textContent = `${plural(Object.keys(channels).length, 'channel')} observed · ${(bytes / 1024).toFixed(0)} KB.`;
}

async function exportJson(): Promise<void> {
  const backup = makeBackup(await getSettings(), await getOverrides(), await allChannels());
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `botless-backup-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Exported.');
}

async function importJson(file: File): Promise<void> {
  if (file.size > 20 * 1024 * 1024) return status('That file is too large to be a Botless export.', true);
  const parsed = parseBackup(await file.text());
  if (!parsed.ok) return status(parsed.error, true);
  const { backup, skipped } = parsed;
  const overrides: Overrides = { ...(await getOverrides()), ...backup.overrides };
  const writes: Record<string, unknown> = { [KEY.settings]: backup.settings, [KEY.overrides]: overrides };
  for (const [id, rec] of Object.entries(backup.channels)) writes[KEY.channel(id)] = rec;
  await local.set(writes);
  settings = backup.settings;
  fillForm();
  const n = Object.keys(backup.channels).length;
  status(
    `Imported settings, ${Object.keys(backup.overrides).length} marks and ${n} channels${skipped ? ` (${skipped} invalid entries skipped)` : ''}.`,
  );
}

async function clearObservations(): Promise<void> {
  if (!confirm('Forget everything Botless observed about channels? Your own marks and settings are kept.')) return;
  const keys = Object.keys(await allChannels()).map(KEY.channel);
  await local.remove([...keys, KEY.vmap, KEY.stats]);
  status(`Cleared ${keys.length} channels.`);
}

// ---- Boot ----

async function init(): Promise<void> {
  settings = await getSettings();
  fillForm();
  for (const el of controls()) el.addEventListener('change', () => void save());

  $('reset-settings').addEventListener('click', async () => {
    settings = structuredClone(DEFAULT_SETTINGS);
    await local.set({ [KEY.settings]: settings });
    fillForm();
  });
  $('export').addEventListener('click', () => void exportJson());
  $<HTMLInputElement>('import-file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void importJson(file).finally(() => (input.value = ''));
  });
  $('clear-obs').addEventListener('click', () => void clearObservations());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[KEY.overrides]) void renderOverrides();
    if (changes[KEY.settings]) {
      settings = normalizeSettings(changes[KEY.settings]?.newValue);
      fillForm();
    }
    void renderDataSize();
  });

  await Promise.all([renderOverrides(), renderDataSize()]);
}

void init();
