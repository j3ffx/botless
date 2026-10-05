// Chrome Web Store upload, run by .github/workflows/store.yml (Actions → Chrome Web Store → Run workflow).
//
//   node scripts/store.mjs status            # what's published and what's in review
//   node scripts/store.mjs publish 0.1.6     # upload that GitHub release's zip and submit it for review
//
// It uploads the zip attached to the GitHub release, never a fresh build: that's the file `npm run live-test --
// --release X.Y.Z` tested. No stored key: GitHub's OIDC token is exchanged for a short-lived Google token of the
// service account linked to the publisher (one-time setup: docs/STORE.md → Automated uploads).
// Zero dependencies, like the other release tooling.
import { appendFileSync } from 'node:fs';

const REPO = 'j3ffx/botless';
const ITEM_ID = 'dcjchknlcighdakohbpgnmmhfpibnjne';
const API = 'https://chromewebstore.googleapis.com';

const { CWS_PUBLISHER_ID, GCP_WORKLOAD_PROVIDER, GCP_SERVICE_ACCOUNT } = process.env;
for (const [k, v] of Object.entries({ CWS_PUBLISHER_ID, GCP_WORKLOAD_PROVIDER, GCP_SERVICE_ACCOUNT })) {
  if (!v) fail(`${k} is not set (repository variable, see docs/STORE.md → Automated uploads).`);
}
const ITEM = `publishers/${CWS_PUBLISHER_ID}/items/${ITEM_ID}`;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

async function json(res, what) {
  const text = await res.text();
  if (!res.ok) fail(`${what}: HTTP ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

/** GitHub OIDC token → Google STS federated token → service-account token scoped to the Chrome Web Store. */
async function accessToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer } = process.env;
  if (!url || !bearer) fail('No GitHub OIDC token: run this from the workflow (it needs "id-token: write").');
  const audience = `//iam.googleapis.com/${GCP_WORKLOAD_PROVIDER}`;
  const oidc = await json(await fetch(`${url}&audience=${encodeURIComponent(`https:${audience}`)}`, {
    headers: { authorization: `bearer ${bearer}` },
  }), 'GitHub OIDC token');
  const sts = await json(await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audience,
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: oidc.value,
    }),
  }), 'Google STS token exchange');
  const sa = await json(await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${GCP_SERVICE_ACCOUNT}:generateAccessToken`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sts.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/chromewebstore'], lifetime: '900s' }),
    }), 'service account token');
  return sa.accessToken;
}

const token = await accessToken();
const auth = { authorization: `Bearer ${token}` };

async function status() {
  return json(await fetch(`${API}/v2/${ITEM}:fetchStatus`, { headers: auth }), 'fetchStatus');
}

function describe(s) {
  const rev = (r) => r ? `${r.state} ${(r.distributionChannels ?? []).map((c) => `${c.crxVersion} (${c.deployPercentage ?? 100}%)`).join(', ')}` : 'none';
  return [
    `published: ${rev(s.publishedItemRevisionStatus)}`,
    `submitted: ${rev(s.submittedItemRevisionStatus)}`,
    `last upload: ${s.lastAsyncUploadState ?? 'none'}`,
    ...(s.takenDown ? ['TAKEN DOWN for a policy violation'] : []),
    ...(s.warned ? ['WARNED for a policy violation'] : []),
  ].join('\n');
}

function summary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

const [command, wanted] = process.argv.slice(2);
const before = await status();

if (command === 'status') {
  summary(`\`\`\`\n${describe(before)}\n\`\`\``);
} else if (command === 'publish') {
  const version = wanted?.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('usage: publish X.Y.Z');
  console.log(describe(before));
  const versions = (r) => (r?.distributionChannels ?? []).map((c) => c.crxVersion);
  if (versions(before.publishedItemRevisionStatus).includes(version)) {
    summary(`${version} is already published. Nothing to do.`);
    process.exit(0);
  }
  // Never replace a submission silently: cancelling one restarts Google's review from scratch.
  const pending = before.submittedItemRevisionStatus;
  if (pending && ['PENDING_REVIEW', 'STAGED'].includes(pending.state)) {
    fail(`${versions(pending).join(', ')} is ${pending.state}. Wait for it, or cancel it in the dashboard first.`);
  }

  const zipUrl = `https://github.com/${REPO}/releases/download/v${version}/botless-${version}.zip`;
  const zip = await fetch(zipUrl);
  if (!zip.ok) fail(`${zipUrl}: HTTP ${zip.status}. Is v${version} released?`);
  const body = Buffer.from(await zip.arrayBuffer());
  console.log(`uploading botless-${version}.zip (${body.length} bytes)`);

  let up = await json(await fetch(`${API}/upload/v2/${ITEM}:upload?uploadType=media`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/zip' },
    body,
  }), 'upload');
  for (let i = 0; up.uploadState === 'IN_PROGRESS' && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    up = { ...up, uploadState: (await status()).lastAsyncUploadState };
  }
  if (up.uploadState !== 'SUCCEEDED') fail(`upload ended as ${up.uploadState}`);
  if (up.crxVersion && up.crxVersion !== version) fail(`the store read version ${up.crxVersion}, expected ${version}`);

  const pub = await json(await fetch(`${API}/v2/${ITEM}:publish`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  }), 'publish');
  const warnings = (pub.warningInfo?.warnings ?? []).map((w) => `- ${w.reason}: ${w.description}`);
  summary([`Submitted ${version}: **${pub.state}**`, ...warnings].join('\n'));
} else {
  fail('usage: node scripts/store.mjs status | publish X.Y.Z');
}
