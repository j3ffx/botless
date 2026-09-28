import type { ChannelSummary, SwRequest, TabResponse } from '../shared/messages';
import { VERDICT_LABEL } from '../shared/scoring';
import { getSettings, getTodayCount, KEY } from '../shared/storage';
import type { PageInfo } from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const sw = <T>(msg: SwRequest) => chrome.runtime.sendMessage(msg) as Promise<T>;

let page: PageInfo | null = null;

async function activePage(): Promise<PageInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.youtube.com/')) return null;
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: 'getPageInfo' })) as TabResponse;
    return res?.page ?? null;
  } catch {
    return null; // content script not injected yet (tab opened before install) — user can reload
  }
}

function renderChannel(s: ChannelSummary): void {
  $('channel').hidden = false;
  $('empty').hidden = true;
  $('ch-name').textContent = s.override?.name || s.record?.name || page?.channelName || s.channelId;
  $('ch-name').title = s.channelId;

  const v = s.result.verdict;
  const pill = $('ch-verdict');
  pill.className = `pill ${v ?? 'none'}`;
  pill.textContent = v ? VERDICT_LABEL[v] : 'No verdict yet';

  const list = $('ch-reasons');
  list.replaceChildren();
  const reasons = s.result.reasons.length
    ? s.result.reasons
    : [{ signal: 'disclosure', text: 'No signals yet — watch a few of its videos.', weight: 0 }];
  for (const r of reasons) {
    const li = document.createElement('li');
    li.className = r.weight > 0 ? 'ai' : r.weight < 0 ? 'human' : 'off';
    li.textContent = r.text;
    list.append(li);
  }
  if (page?.disclosure === 'auto-dubbed') {
    const li = document.createElement('li');
    li.className = 'off';
    li.textContent = 'This video is auto-dubbed by YouTube — not counted as AI.';
    list.append(li);
  }

  const mark = s.override?.verdict;
  $('mark-ai').classList.toggle('is-active', mark === 'ai');
  $('mark-human').classList.toggle('is-active', mark === 'human');
  $('mark-ai').setAttribute('aria-pressed', String(mark === 'ai'));
  $('mark-human').setAttribute('aria-pressed', String(mark === 'human'));
  $('mark-clear').hidden = !mark;
}

async function setMark(verdict: 'ai' | 'human' | null): Promise<void> {
  if (!page?.channelId) return;
  const s = await sw<ChannelSummary>({ type: 'setOverride', channelId: page.channelId, name: page.channelName, verdict });
  renderChannel(s);
}

async function refreshCount(): Promise<void> {
  const n = await getTodayCount();
  $('today').textContent = String(n);
  $('today-label').textContent = `likely-AI video${n === 1 ? '' : 's'} flagged today`;
}

async function init(): Promise<void> {
  const settings = await getSettings();
  const toggle = $<HTMLInputElement>('enabled');
  toggle.checked = settings.enabled;
  document.body.classList.toggle('off', !settings.enabled);
  toggle.addEventListener('change', async () => {
    const s = await getSettings();
    await chrome.storage.local.set({ [KEY.settings]: { ...s, enabled: toggle.checked } });
    document.body.classList.toggle('off', !toggle.checked);
  });

  $('mark-ai').addEventListener('click', () => void setMark($('mark-ai').classList.contains('is-active') ? null : 'ai'));
  $('mark-human').addEventListener('click', () => void setMark($('mark-human').classList.contains('is-active') ? null : 'human'));
  $('mark-clear').addEventListener('click', () => void setMark(null));
  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[KEY.stats]) void refreshCount();
  });
  await refreshCount();

  page = await activePage();
  if (!page) {
    $('empty-msg').textContent = 'Open a YouTube video, Short or channel to see its verdict.';
    return;
  }
  if (!page.channelId) {
    $('empty-msg').textContent =
      page.pageType === 'other' ? 'Open a video, Short or channel page to see its verdict.' : 'Reading this page…';
    return;
  }
  renderChannel(await sw<ChannelSummary>({ type: 'getChannel', channelId: page.channelId }));
}

void init();
