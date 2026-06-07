# Example Commands

These commands can be written to the Notion channel page title.

## Basic

```
PING
```

```
GET_PAGE_TITLE
```

```
GET_SELECTED_TEXT
```
GET_DEMO_DOM

## Set demo text

Encode text as base64 first.

Example text:
Hello from Notion Browser Relay

Command shape:
SET_DEMO_TEXT::<base64 text>

## Click demo button

Selector:
#demo-button

Command shape:
CLICK_DEMO_BUTTON::<base64 selector>

## Highlight demo box

Selector:
#demo-box

Command shape:
HIGHLIGHT_SELECTOR::<base64 selector>

## Using the Python CLI
python relay/notion_relay.py ping --wait
python relay/notion_relay.py title --wait
python relay/notion_relay.py dom --wait
python relay/notion_relay.py set-text "Hello from relay" --wait
python relay/notion_relay.py click "#demo-button" --wait
python relay/notion_relay.py highlight "#demo-box" --wait
