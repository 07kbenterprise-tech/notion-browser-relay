# Notion Browser Relay

Notion Browser Relay is an experimental open-source tool that uses a private Notion page as a safe command/result channel between an AI assistant and a browser userscript.

The goal is to explore safe, human-approved browser automation workflows without requiring a local server, public webhook, or ngrok tunnel.

## What it does

A user can connect their own Notion workspace, create a private Notion page, and use that page as a lightweight command queue.

A local browser userscript polls the page, validates incoming commands against a strict allowlist, executes only approved browser-side actions on allowed demo/local domains, and writes the result back to Notion.

## Use cases

- AI-assisted UI testing
- local browser automation demos
- Notion-based command queues
- safe workflow prototyping
- human-approved browser-side experiments
- local developer tooling research

## Safety model

This project is designed for controlled environments only.

It does not support:
- arbitrary JavaScript execution
- arbitrary Python execution
- cookie extraction
- credential collection
- network scanning
- JWT forging
- MITM/proxy functionality
- hidden automation
- wildcard domain access
- arbitrary HTTP requests

The browser userscript only runs on explicitly configured local/demo hosts.

## Supported commands

The safe userscript supports these commands:

- `PING`
- `GET_PAGE_TITLE`
- `GET_SELECTED_TEXT`
- `GET_DEMO_DOM`
- `SET_DEMO_TEXT::<base64 text>`
- `CLICK_DEMO_BUTTON::<base64 selector>`
- `HIGHLIGHT_SELECTOR::<base64 selector>`

Results are written back to Notion as:

- `RESULT::<base64 json>`
- `ERROR::<base64 json>`

Base64 is used only to avoid formatting issues in Notion text fields. It is not encryption.

## Repository structure
