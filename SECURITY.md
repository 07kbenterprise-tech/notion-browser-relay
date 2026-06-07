# Security Policy

Notion Browser Relay is designed as a safe local experimentation tool.

## Non-goals

This project does not support:
- cookie extraction
- credential collection
- arbitrary remote code execution
- arbitrary Python execution
- arbitrary JavaScript execution
- network scanning
- JWT forging
- packet capture
- MITM interception
- automation against third-party services without permission
- bypassing access controls or rate limits

## Secret handling

Never commit real Notion API tokens, page IDs, session cookies, or private credentials.

Use `.env.example` as a template and keep real secrets in local environment variables or local Tampermonkey storage.

If you accidentally commit or share a token, rotate it immediately.

## Allowed domains

The browser userscript should only run on explicitly configured local or demo domains.

Wildcard matching such as `*://*/*` is not used in the public version and is not recommended.

## Command validation

Commands are validated against a strict allowlist.

Forbidden command families include:
- `SCRIPT::`
- `EXEC`
- `COOKIE`
- `GMREQ::`
- `PYEXEC::`
- `PYREQ::`
- `PYJWT::`
- `PYSCAN::`
- `PYSCAPY::`
- `PYMITM::`
- `PYWS::`

## Reporting issues

If you find a security issue, please open a private advisory or contact the maintainer.
