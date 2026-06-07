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
PING
GET_PAGE_TITLE
GET_SELECTED_TEXT
GET_DEMO_DOM
SET_DEMO_TEXT::<base64 text>
CLICK_DEMO_BUTTON::<base64 selector>
HIGHLIGHT_SELECTOR::<base64 selector>

Results are written back to Notion as:
RESULT::<base64 json>
ERROR::<base64 json>

Base64 is used only to avoid formatting issues in Notion text fields. It is not encryption.

## Repository structure
notion-browser-relay/
README.md
SECURITY.md
.env.example
.gitignore
package.json
userscript/
notion-browser-relay.user.js
relay/
notion_relay.py
examples/
demo-page.html
commands.md

## Setup

### 1. Create a Notion integration

Create a Notion integration and copy the integration token.
Never commit real tokens to GitHub.

### 2. Create a Notion channel page

Create a private Notion page and share it with your integration.
Copy the page ID.

### 3. Configure the userscript

Install `userscript/notion-browser-relay.user.js` in Tampermonkey.
Open a supported local/demo page.
Use the Tampermonkey menu commands:
- Set Notion token
- Set Notion page ID
- Set allowed hosts

### 4. Run a demo page

Open:
examples/demo-page.html

in a local server, for example:
python -m http.server 3000

Then open:
http://localhost:3000/examples/demo-page.html

### 5. Send a command

You can write a command directly into the Notion page title:
PING

The userscript will respond with:
RESULT::<base64 json>

## CLI usage

Install dependencies:
pip install requests

Set environment variables:
export NOTION_TOKEN="your_notion_token_here"
export NOTION_PAGE_ID="your_notion_page_id_here"

On Windows PowerShell:
$env:NOTION_TOKEN="your_notion_token_here"
$env:NOTION_PAGE_ID="your_notion_page_id_here"

Send a ping command and wait for result:
python relay/notion_relay.py ping --wait

Ask for page title:
python relay/notion_relay.py title --wait

Set demo text:
python relay/notion_relay.py set-text "Hello from Notion Browser Relay" --wait

Click a demo button:
python relay/notion_relay.py click "#demo-button" --wait

Highlight a demo element:
python relay/notion_relay.py highlight "#demo-box" --wait

Reset channel:
python relay/notion_relay.py reset

## Status

Early proof of concept.
