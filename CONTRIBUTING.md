# Contributing

Thanks for helping! Botless is small on purpose, so please read this before opening a pull request.

## Before you start

- **Check `docs/ROADMAP.md`.** Several obvious ideas were already tried and rejected, with the reasons.
  For anything bigger than a fix, open an issue first so we can agree on the approach.
- **Read `CLAUDE.md`.** Despite the name, it's the contributor guide for humans and AI assistants alike:
  commands, commit rules, and the invariants (privacy, popup limits, pure logic in `src/shared`) that CI
  enforces.

## Setup

```bash
npm install          # also enables the commit-msg hook in .githooks/
npm run verify       # typecheck + tests + build + dist/ check
```

Load `dist/` with **Load unpacked** in `chrome://extensions`. `docs/TESTING.md` has the manual test plan,
and `npm run smoke` runs the automated one in Chrome for Testing (setup in `CLAUDE.md`).

## Pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The hook
  and CI check them; the allowed types and scopes are in `CLAUDE.md` → Commits.
- One logical change per PR, with a body that explains *why*.
- PRs are squash-merged, so the **PR title** becomes the commit message and must follow the same format.
- If you touch a YouTube selector or data path, verify it on live YouTube and update `docs/YOUTUBE-DOM.md`.
- CI must pass: typecheck, tests, build, the Chrome smoke test, and the commit check.

By contributing, you agree that your contributions are licensed under the project's license (GPL-3.0).
