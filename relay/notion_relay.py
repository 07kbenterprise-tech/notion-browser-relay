#!/usr/bin/env python3
"""Notion Browser Relay CLI - Safe Edition

This CLI talks only to the Notion API and helps send safe demo commands to a
private Notion page used as a command/result channel.

It intentionally does NOT support:
- arbitrary Python execution
- arbitrary HTTP requests
- JWT forging
- network scanning
- packet capture
- MITM/proxy control
- cookie extraction
- credential collection
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from typing import Any, Dict, Optional

import requests

NOTION_API = os.getenv("NOTION_API", "https://api.notion.com/v1")
NOTION_TOKEN = os.getenv("NOTION_TOKEN", "")
NOTION_PAGE_ID = os.getenv("NOTION_PAGE_ID", "")
NOTION_TITLE_PROPERTY = os.getenv("NOTION_TITLE_PROPERTY", "title")
POLL_SEC = float(os.getenv("POLL_SEC", "1.5"))
MAX_TITLE_LENGTH = 1800
MAX_RESULT_PRINT = 4000
MAX_PAYLOAD_LENGTH = 3000

FORBIDDEN_COMMAND_PREFIXES = [
    "SCRIPT::",
    "EXEC",
    "COOKIE",
    "GMREQ::",
    "PYEXEC::",
    "PYREQ::",
    "PYJWT::",
    "PYSCAN::",
    "PYSCAPY::",
    "PYMITM::",
    "PYWS::",
]

FORBIDDEN_TEXT_PATTERNS = [
    r"document\.cookie",
    r"\bcookie\b",
    r"set-cookie",
    r"localStorage",
    r"sessionStorage",
    r"indexedDB",
    r"GM_cookie",
    r"eval\s*\(",
    r"new\s+Function",
    r"Function\s*\(",
    r"fetch\s*\(",
    r"XMLHttpRequest",
    r"WebSocket",
    r"password",
    r"passwd",
    r"secret",
    r"token",
    r"authorization",
    r"bearer\s+",
    r"api[-]?key",
    r"private[-]?key",
    r"ssh-rsa",
    r"BEGIN\s+(RSA|OPENSSH|PRIVATE)",
]

ALLOWED_SELECTOR_PREFIXES = [
    "#demo-",
    ".demo-",
    "[data-demo-",
]

SAFE_COMMANDS = {
    "PING",
    "GET_PAGE_TITLE",
    "GET_SELECTED_TEXT",
    "GET_DEMO_DOM",
}


class RelayError(Exception):
    pass


def require_config() -> None:
    if not NOTION_TOKEN:
        raise RelayError("Missing NOTION_TOKEN environment variable")
    if not NOTION_PAGE_ID:
        raise RelayError("Missing NOTION_PAGE_ID environment variable")


def notion_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }


def b64e(text: str) -> str:
    raw = str(text).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def b64d(text: str) -> str:
    value = str(text).strip()
    missing = (-len(value)) % 4
    if missing:
        value += "=" * missing
    return base64.b64decode(value).decode("utf-8", errors="replace")


def contains_forbidden_text(text: str) -> bool:
    value = str(text or "")
    return any(re.search(pattern, value, re.IGNORECASE) for pattern in FORBIDDEN_TEXT_PATTERNS)


def is_forbidden_command(command: str) -> bool:
    value = str(command or "").strip()
    return any(value.startswith(prefix) for prefix in FORBIDDEN_COMMAND_PREFIXES)


def redact_sensitive_text(text: str) -> str:
    value = str(text or "")

    replacements = [
        (r"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]"),
        (r"ntn_[A-Za-z0-9]+", "ntn_[REDACTED]"),
        (r"sk-[A-Za-z0-9]+", "sk-[REDACTED]"),
        (r"api[_-]?key\s*[:=]\s*[\"']?[^\"'\s]+", "api_key=[REDACTED]"),
        (r"token\s*[:=]\s*[\"']?[^\"'\s]+", "token=[REDACTED]"),
        (r"password\s*[:=]\s*[\"']?[^\"'\s]+", "password=[REDACTED]"),
        (r"secret\s*[:=]\s*[\"']?[^\"'\s]+", "secret=[REDACTED]"),
    ]

    for pattern, repl in replacements:
        value = re.sub(pattern, repl, value, flags=re.IGNORECASE)

    return value


def clamp(text: str, limit: int) -> str:
    value = str(text or "")
    if len(value) <= limit:
        return value
    return value[:limit] + "...[truncated]"


def validate_selector(selector: str) -> None:
    s = str(selector or "").strip()
    if not s:
        raise RelayError("Selector cannot be empty")
    if len(s) > 120:
        raise RelayError("Selector is too long")
    if contains_forbidden_text(s):
        raise RelayError("Selector contains forbidden sensitive patterns")
    if not any(s.startswith(prefix) for prefix in ALLOWED_SELECTOR_PREFIXES):
        raise RelayError("Selector is not allowed. Use prefixes like #demo-, .demo-, or [data-demo-")


def validate_command(command: str) -> None:
    value = str(command or "").strip()
    if not value:
        raise RelayError("Command cannot be empty")
    if len(value) > MAX_TITLE_LENGTH:
        raise RelayError("Command is too long for Notion title transport")
    if is_forbidden_command(value):
        raise RelayError("Forbidden command prefix")
    if contains_forbidden_text(value):
        raise RelayError("Command contains forbidden sensitive patterns")

    if value in SAFE_COMMANDS:
        return

    if value.startswith("SET_DEMO_TEXT::"):
        payload = value[len("SET_DEMO_TEXT::"):].strip()
        decoded = b64d(payload)
        if len(decoded) > MAX_PAYLOAD_LENGTH:
            raise RelayError("Decoded text payload is too large")
        if contains_forbidden_text(decoded):
            raise RelayError("Decoded text payload contains forbidden sensitive patterns")
        return

    if value.startswith("CLICK_DEMO_BUTTON::"):
        payload = value[len("CLICK_DEMO_BUTTON::"):].strip()
        selector = b64d(payload)
        validate_selector(selector)
        return

    if value.startswith("HIGHLIGHT_SELECTOR::"):
        payload = value[len("HIGHLIGHT_SELECTOR::"):].strip()
        selector = b64d(payload)
        validate_selector(selector)
        return

    if value in {"CZEKAM", "WAITING", "RUNNING..."}:
        return

    raise RelayError("Unsupported command")


def notion_request(method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    require_config()
    url = NOTION_API + path

    try:
        response = requests.request(
            method=method,
            url=url,
            headers=notion_headers(),
            json=payload,
            timeout=15,
        )
    except requests.RequestException as exc:
        raise RelayError(f"Notion request failed: {exc}") from exc

    if response.status_code >= 400:
        raise RelayError(f"Notion API error HTTP {response.status_code}: {response.text[:400]}")

    if not response.text.strip():
        return {}

    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise RelayError(f"Failed to parse Notion response: {exc}") from exc


def get_title() -> str:
    page = notion_request("GET", f"/pages/{NOTION_PAGE_ID}")
    try:
        title_arr = page["properties"][NOTION_TITLE_PROPERTY]["title"]
        if not title_arr:
            return ""
        return title_arr[0].get("plain_text", "")
    except Exception as exc:
        raise RelayError(f"Cannot read title property '{NOTION_TITLE_PROPERTY}'. "
                         f"Check NOTION_TITLE_PROPERTY and page permissions.") from exc


def set_title(text: str) -> None:
    value = clamp(str(text), MAX_TITLE_LENGTH)
    payload = {
        "properties": {
            NOTION_TITLE_PROPERTY: {
                "title": [
                    {
                        "type": "text",
                        "text": {
                            "content": value,
                        },
                    }
                ]
            }
        }
    }
    notion_request("PATCH", f"/pages/{NOTION_PAGE_ID}", payload)


def decode_result_title(title: str) -> Dict[str, Any]:
    if title.startswith("RESULT::"):
        raw = title[len("RESULT::"):].strip()
        decoded = b64d(raw)
        return {"type": "RESULT", "decoded": decoded}
    if title.startswith("ERROR::"):
        raw = title[len("ERROR::"):].strip()
        decoded = b64d(raw)
        return {"type": "ERROR", "decoded": decoded}
    return {"type": "OTHER", "decoded": title}


def print_result(title: str) -> None:
    parsed = decode_result_title(title)
    decoded = redact_sensitive_text(parsed["decoded"])

    print("=" * 70)
    print(parsed["type"])
    print("=" * 70)

    try:
        obj = json.loads(decoded)
        print(json.dumps(obj, indent=2, ensure_ascii=False)[:MAX_RESULT_PRINT])
    except Exception:
        print(decoded[:MAX_RESULT_PRINT])


def send_command(command: str, wait: bool = False, timeout: float = 30.0) -> None:
    validate_command(command)
    print(f"[send] {command[:120]}")
    set_title(command)

    if wait:
        wait_for_result(timeout)


def wait_for_result(timeout: float = 30.0) -> None:
    print(f"[wait] Waiting up to {timeout:.1f}s for RESULT:: or ERROR::")
    deadline = time.time() + timeout
    last_seen = None

    while time.time() < deadline:
        title = get_title()
        if title != last_seen:
            print(f"[title] {title[:120]}")
            last_seen = title

        if title.startswith("RESULT::") or title.startswith("ERROR::"):
            print_result(title)
            return

        time.sleep(POLL_SEC)

    raise RelayError("Timed out waiting for result")


def command_ping(args: argparse.Namespace) -> None:
    send_command("PING", wait=args.wait, timeout=args.timeout)


def command_title(args: argparse.Namespace) -> None:
    send_command("GET_PAGE_TITLE", wait=args.wait, timeout=args.timeout)


def command_selection(args: argparse.Namespace) -> None:
    send_command("GET_SELECTED_TEXT", wait=args.wait, timeout=args.timeout)


def command_dom(args: argparse.Namespace) -> None:
    send_command("GET_DEMO_DOM", wait=args.wait, timeout=args.timeout)


def command_set_text(args: argparse.Namespace) -> None:
    text = args.text
    if len(text) > MAX_PAYLOAD_LENGTH:
        raise RelayError("Text payload is too large")
    if contains_forbidden_text(text):
        raise RelayError("Text contains forbidden sensitive patterns")

    send_command("SET_DEMO_TEXT::" + b64e(text), wait=args.wait, timeout=args.timeout)


def command_click(args: argparse.Namespace) -> None:
    validate_selector(args.selector)
    send_command("CLICK_DEMO_BUTTON::" + b64e(args.selector), wait=args.wait, timeout=args.timeout)


def command_highlight(args: argparse.Namespace) -> None:
    validate_selector(args.selector)
    send_command("HIGHLIGHT_SELECTOR::" + b64e(args.selector), wait=args.wait, timeout=args.timeout)


def command_get(args: argparse.Namespace) -> None:
    title = get_title()
    print(title)


def command_wait(args: argparse.Namespace) -> None:
    wait_for_result(args.timeout)


def command_reset(args: argparse.Namespace) -> None:
    set_title(args.value)
    print(f"[reset] title set to {args.value!r}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Safe CLI for Notion Browser Relay")
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Timeout for commands that wait for results",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    def add_wait_flags(p: argparse.ArgumentParser) -> None:
        p.add_argument(
            "--wait",
            action="store_true",
            help="Wait for RESULT:: or ERROR:: after sending the command",
        )

    p = sub.add_parser("ping", help="Send PING")
    add_wait_flags(p)
    p.set_defaults(func=command_ping)

    p = sub.add_parser("title", help="Ask browser for document.title")
    add_wait_flags(p)
    p.set_defaults(func=command_title)

    p = sub.add_parser("selection", help="Ask browser for selected text")
    add_wait_flags(p)
    p.set_defaults(func=command_selection)

    p = sub.add_parser("dom", help="Ask browser for demo DOM summary")
    add_wait_flags(p)
    p.set_defaults(func=command_dom)

    p = sub.add_parser("set-text", help="Set text in demo output element")
    p.add_argument("text", help="Text to set")
    add_wait_flags(p)
    p.set_defaults(func=command_set_text)

    p = sub.add_parser("click", help="Click an allowed demo button selector")
    p.add_argument("selector", help="Allowed selector, e.g. #demo-button")
    add_wait_flags(p)
    p.set_defaults(func=command_click)

    p = sub.add_parser("highlight", help="Highlight an allowed demo selector")
    p.add_argument("selector", help="Allowed selector, e.g. #demo-box")
    add_wait_flags(p)
    p.set_defaults(func=command_highlight)

    p = sub.add_parser("get", help="Print current Notion page title")
    p.set_defaults(func=command_get)

    p = sub.add_parser("wait", help="Wait for RESULT:: or ERROR::")
    p.set_defaults(func=command_wait)

    p = sub.add_parser("reset", help="Reset Notion title to idle value")
    p.add_argument("--value", default="CZEKAM", help="Idle title value")
    p.set_defaults(func=command_reset)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        args.func(args)
        return 0
    except RelayError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
