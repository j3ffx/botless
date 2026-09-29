# Security

Botless runs on every YouTube page you open, so security reports matter even for a small extension.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. You'll get an answer within a week.

Useful things to include:

- what an attacker could do, and under which conditions (for example, a malicious page, or another extension);
- steps to reproduce, with the Botless version (`chrome://extensions`) and Chrome version;
- whether Active mode was on.

## Scope

Particularly relevant, because they break promises made in the README:

- any request Botless makes while Active mode is off, or any request to a host other than `www.youtube.com`;
- any request sent with cookies, or anything that acts on the user's YouTube account;
- a web page able to read or change Botless's stored data, or to inject script through it.

Only the latest release is supported.
