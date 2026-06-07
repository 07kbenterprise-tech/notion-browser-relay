// ==UserScript==
// @name         Notion Browser Relay Safe
// @namespace    https://github.com/07kbenterprise-tech/notion-browser-relay
// @version      0.1.0
// @description  Safe Notion-powered browser relay for AI-assisted UI testing and local automation experiments.
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @match        https://example.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.notion.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /**
   * Notion Browser Relay Safe
   *
   * This userscript uses a private Notion page as a command/result channel.
   *
   * Safety design:
   * - No arbitrary JavaScript execution
   * - No eval / new Function
   * - No cookie access
   * - No credential extraction
   * - No wildcard domain access
   * - No arbitrary HTTP requests
   * - No MITM/proxy behavior
   * - No network scanning
   * - Commands only run on explicitly allowed local/demo hosts
   */

  const DEFAULTS = {
    notionToken: "",
    notionPageId: "",
    notionApi: "https://api.notion.com/v1",
    notionTitleProperty: "title",
    pollMs: 2000,
    maxTitleLength: 1800,
    maxResultLength: 1500,
    maxDecodedPayloadLength: 3000,
    allowedHosts: "localhost,127.0.0.1,example.com",
    allowedSelectorPrefixes: "#demo-,.demo-,[data-demo-"
  };

  const CONFIG = {
    notionToken: GM_getValue("NOTION_TOKEN", DEFAULTS.notionToken),
    notionPageId: GM_getValue("NOTION_PAGE_ID", DEFAULTS.notionPageId),
    notionApi: GM_getValue("NOTION_API", DEFAULTS.notionApi),
    notionTitleProperty: GM_getValue("NOTION_TITLE_PROPERTY", DEFAULTS.notionTitleProperty),
    pollMs: Number(GM_getValue("POLL_MS", DEFAULTS.pollMs)) || DEFAULTS.pollMs,
    maxTitleLength: DEFAULTS.maxTitleLength,
    maxResultLength: DEFAULTS.maxResultLength,
    maxDecodedPayloadLength: DEFAULTS.maxDecodedPayloadLength,
    allowedHosts: parseCsv(GM_getValue("ALLOWED_HOSTS", DEFAULTS.allowedHosts)),
    allowedSelectorPrefixes: parseCsv(GM_getValue("ALLOWED_SELECTOR_PREFIXES", DEFAULTS.allowedSelectorPrefixes))
  };

  const FORBIDDEN_COMMAND_PREFIXES = [
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
    "PYWS::"
  ];

  const FORBIDDEN_TEXT_PATTERNS = [
    /document\.cookie/i,
    /\bcookie\b/i,
    /set-cookie/i,
    /localStorage/i,
    /sessionStorage/i,
    /indexedDB/i,
    /GM_cookie/i,
    /eval\s*\(/i,
    /new\s+Function/i,
    /Function\s*\(/i,
    /fetch\s*\(/i,
    /XMLHttpRequest/i,
    /WebSocket/i,
    /password/i,
    /passwd/i,
    /secret/i,
    /token/i,
    /authorization/i,
    /bearer\s+/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /ssh-rsa/i,
    /BEGIN\s+(RSA|OPENSSH|PRIVATE)/i
  ];

  const SAFE_COMMANDS = [
    "PING",
    "GET_PAGE_TITLE",
    "GET_SELECTED_TEXT",
    "GET_DEMO_DOM"
  ];

  function parseCsv(value) {
    return String(value || "")
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
  }

  function clampString(value, maxLength) {
    const text = String(value ?? "");
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...[truncated]";
  }

  function redactSensitiveText(value) {
    let text = String(value ?? "");

    text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
    text = text.replace(/ntn_[A-Za-z0-9]+/g, "ntn_[REDACTED]");
    text = text.replace(/sk-[A-Za-z0-9]+/g, "sk-[REDACTED]");
    text = text.replace(/api[_-]?key\s*[:=]\s*["']?[^"'\s]+/gi, "api_key=[REDACTED]");
    text = text.replace(/token\s*[:=]\s*["']?[^"'\s]+/gi, "token=[REDACTED]");
    text = text.replace(/password\s*[:=]\s*["']?[^"'\s]+/gi, "password=[REDACTED]");
    text = text.replace(/secret\s*[:=]\s*["']?[^"'\s]+/gi, "secret=[REDACTED]");

    return text;
  }

  function containsForbiddenText(text) {
    const value = String(text || "");
    return FORBIDDEN_TEXT_PATTERNS.some(pattern => pattern.test(value));
  }

  function isForbiddenCommand(command) {
    const trimmed = String(command || "").trim();
    return FORBIDDEN_COMMAND_PREFIXES.some(prefix => trimmed.startsWith(prefix));
  }

  function isHostAllowed() {
    return CONFIG.allowedHosts.includes(location.hostname);
  }

  function isSelectorAllowed(selector) {
    const s = String(selector || "").trim();

    if (!s) return false;
    if (s.length > 120) return false;
    if (containsForbiddenText(s)) return false;

    return CONFIG.allowedSelectorPrefixes.some(prefix => s.startsWith(prefix));
  }

  function b64enc(str) {
    return btoa(unescape(encodeURIComponent(String(str))));
  }

  function b64dec(str) {
    const input = String(str || "").trim();

    if (!input) return "";

    if (input.length > CONFIG.maxDecodedPayloadLength * 2) {
      throw new Error("Base64 payload too large");
    }

    return decodeURIComponent(escape(atob(input)));
  }

  function safeJsonPayload(ok, data) {
    const raw = JSON.stringify({
      ok,
      timestamp: new Date().toISOString(),
      host: location.hostname,
      path: location.pathname,
      data: data ?? {}
    });

    return clampString(redactSensitiveText(raw), CONFIG.maxResultLength);
  }

  function makeResult(data) {
    return "RESULT::" + b64enc(safeJsonPayload(true, data));
  }

  function makeError(message, details) {
    return "ERROR::" + b64enc(safeJsonPayload(false, {
      message: String(message || "Unknown error"),
      details: details || null
    }));
  }

  function installPanel() {
    if (document.getElementById("_nbr_panel")) return;

    const panel = document.createElement("div");
    panel.id = "_nbr_panel";
    panel.style.cssText = [
      "position:fixed",
      "bottom:16px",
      "right:16px",
      "background:#0f172a",
      "color:#93c5fd",
      "font:12px monospace",
      "padding:8px 12px",
      "border-radius:8px",
      "z-index:2147483647",
      "border:1px solid #2563eb",
      "max-width:460px",
      "white-space:pre-wrap",
      "box-shadow:0 8px 30px rgba(0,0,0,.25)"
    ].join(";");

    panel.textContent = "Notion Browser Relay: starting...";
    document.body.appendChild(panel);
  }

  function setStatus(text) {
    const el = document.getElementById("_nbr_panel");
    if (el) el.textContent = String(text);
  }

  function registerConfigMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;

    GM_registerMenuCommand("Set Notion token", () => {
      const value = prompt("Paste your Notion integration token. It is stored locally in Tampermonkey.");
      if (value) {
        GM_setValue("NOTION_TOKEN", value.trim());
        alert("Saved. Reload the page.");
      }
    });

    GM_registerMenuCommand("Set Notion page ID", () => {
      const value = prompt("Paste your Notion page ID.");
      if (value) {
        GM_setValue("NOTION_PAGE_ID", value.trim());
        alert("Saved. Reload the page.");
      }
    });

    GM_registerMenuCommand("Set allowed hosts", () => {
      const current = GM_getValue("ALLOWED_HOSTS", DEFAULTS.allowedHosts);
      const value = prompt("Comma-separated allowed hosts:", current);
      if (value) {
        GM_setValue("ALLOWED_HOSTS", value.trim());
        alert("Saved. Reload the page.");
      }
    });

    GM_registerMenuCommand("Show relay config", () => {
      alert(JSON.stringify({
        hasToken: Boolean(CONFIG.notionToken),
        pageId: CONFIG.notionPageId || "(not set)",
        allowedHosts: CONFIG.allowedHosts,
        pollMs: CONFIG.pollMs
      }, null, 2));
    });
  }

  const notionHeaders = () => ({
    "Authorization": "Bearer " + CONFIG.notionToken,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  });

  function notionRequest(method, path, data) {
    return new Promise((resolve, reject) => {
      if (!CONFIG.notionToken) {
        reject(new Error("Missing NOTION_TOKEN"));
        return;
      }

      if (!CONFIG.notionPageId) {
        reject(new Error("Missing NOTION_PAGE_ID"));
        return;
      }

      GM_xmlhttpRequest({
        method,
        url: CONFIG.notionApi + path,
        headers: notionHeaders(),
        data: data ? JSON.stringify(data) : undefined,
        timeout: 15000,
        onload: response => {
          try {
            const parsed = JSON.parse(response.responseText || "{}");
            if (response.status >= 400) {
              reject(new Error("Notion API error " + response.status + ": " + JSON.stringify(parsed).slice(0, 300)));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(new Error("Failed to parse Notion response: " + String(error.message || error)));
          }
        },
        onerror: error => reject(error),
        ontimeout: () => reject(new Error("Notion API timeout"))
      });
    });
  }

  async function getNotionTitle() {
    const page = await notionRequest("GET", "/pages/" + encodeURIComponent(CONFIG.notionPageId));
    const prop = page?.properties?.[CONFIG.notionTitleProperty];

    if (!prop || !Array.isArray(prop.title)) {
      throw new Error("Cannot read Notion title property: " + CONFIG.notionTitleProperty);
    }

    return prop.title[0]?.plain_text || "";
  }

  async function setNotionTitle(text) {
    const safeText = clampString(String(text ?? ""), CONFIG.maxTitleLength);

    return notionRequest("PATCH", "/pages/" + encodeURIComponent(CONFIG.notionPageId), {
      properties: {
        [CONFIG.notionTitleProperty]: {
          title: [
            {
              type: "text",
              text: {
                content: safeText
              }
            }
          ]
        }
      }
    });
  }

  function getDemoElements() {
    const nodes = Array.from(document.querySelectorAll("[id^='demo-'], [class*='demo-'], [data-demo]"));
    return nodes.slice(0, 50).map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: typeof el.className === "string" ? el.className : null,
      text: clampString(redactSensitiveText(el.textContent || ""), 120)
    }));
  }

  function setDemoText(text) {
    if (containsForbiddenText(text)) {
      throw new Error("Payload contains forbidden sensitive patterns");
    }

    const target =
      document.querySelector("#demo-output") ||
      document.querySelector("[data-demo-output]") ||
      document.querySelector(".demo-output");

    if (!target) {
      throw new Error("No demo output element found. Expected #demo-output, .demo-output, or [data-demo-output].");
    }

    target.textContent = clampString(text, 1000);

    return {
      updated: true,
      selector: target.id ? "#" + target.id : target.className || "[data-demo-output]"
    };
  }

  function clickDemoButton(selector) {
    if (!isSelectorAllowed(selector)) {
      throw new Error("Selector is not allowed");
    }

    const target = document.querySelector(selector);

    if (!target) {
      throw new Error("Element not found: " + selector);
    }

    const tag = target.tagName.toLowerCase();
    const isButtonLike =
      tag === "button" ||
      target.getAttribute("role") === "button" ||
      target.hasAttribute("data-demo-click");

    if (!isButtonLike) {
      throw new Error("Element is not approved for demo click actions");
    }

    target.click();

    return {
      clicked: true,
      selector
    };
  }

  function highlightSelector(selector) {
    if (!isSelectorAllowed(selector)) {
      throw new Error("Selector is not allowed");
    }

    const target = document.querySelector(selector);

    if (!target) {
      throw new Error("Element not found: " + selector);
    }

    target.style.outline = "3px solid #22c55e";
    target.style.outlineOffset = "3px";

    return {
      highlighted: true,
      selector
    };
  }

  async function handleCommand(command) {
    const title = String(command || "").trim();

    if (!title) return null;

    if (title === "CZEKAM" || title === "WAITING" || title === "RUNNING...") {
      return null;
    }

    if (title.startsWith("RESULT::") || title.startsWith("ERROR::")) {
      return null;
    }

    if (isForbiddenCommand(title)) {
      return makeError("Forbidden command prefix", { command: title.slice(0, 40) });
    }

    if (containsForbiddenText(title)) {
      return makeError("Command contains forbidden sensitive patterns");
    }

    if (SAFE_COMMANDS.includes(title)) {
      if (title === "PING") {
        return makeResult({
          pong: true,
          title: document.title,
          location: location.href
        });
      }

      if (title === "GET_PAGE_TITLE") {
        return makeResult({
          title: document.title
        });
      }

      if (title === "GET_SELECTED_TEXT") {
        const selection = window.getSelection ? String(window.getSelection()) : "";
        return makeResult({
          selectedText: clampString(redactSensitiveText(selection), 1000)
        });
      }

      if (title === "GET_DEMO_DOM") {
        return makeResult({
          title: document.title,
          demoElements: getDemoElements()
        });
      }
    }

    if (title.startsWith("SET_DEMO_TEXT::")) {
      const payload = title.slice("SET_DEMO_TEXT::".length).trim();
      const text = b64dec(payload);
      return makeResult(setDemoText(text));
    }

    if (title.startsWith("CLICK_DEMO_BUTTON::")) {
      const payload = title.slice("CLICK_DEMO_BUTTON::".length).trim();
      const selector = b64dec(payload);
      return makeResult(clickDemoButton(selector));
    }

    if (title.startsWith("HIGHLIGHT_SELECTOR::")) {
      const payload = title.slice("HIGHLIGHT_SELECTOR::".length).trim();
      const selector = b64dec(payload);
      return makeResult(highlightSelector(selector));
    }

    return makeError("Unknown or unsupported command", {
      supported: [
        "PING",
        "GET_PAGE_TITLE",
        "GET_SELECTED_TEXT",
        "GET_DEMO_DOM",
        "SET_DEMO_TEXT::<base64>",
        "CLICK_DEMO_BUTTON::<base64 selector>",
        "HIGHLIGHT_SELECTOR::<base64 selector>"
      ]
    });
  }

  let running = false;
  let lastSeenTitle = null;

  async function poll() {
    if (running) {
      setTimeout(poll, CONFIG.pollMs);
      return;
    }

    running = true;

    try {
      if (!CONFIG.notionToken || !CONFIG.notionPageId) {
        setStatus("⚠️ Configure NOTION_TOKEN and NOTION_PAGE_ID from Tampermonkey menu.");
        running = false;
        setTimeout(poll, CONFIG.pollMs);
        return;
      }

      if (!isHostAllowed()) {
        setStatus("⛔ Host not allowed: " + location.hostname);
        running = false;
        setTimeout(poll, CONFIG.pollMs);
        return;
      }

      const title = await getNotionTitle();

      if (title !== lastSeenTitle) {
        console.log("[Notion Browser Relay] title:", title);
        lastSeenTitle = title;
      }

      const result = await handleCommand(title);

      if (result) {
        await setNotionTitle("RUNNING...");
        await setNotionTitle(result);
        setStatus("✅ Command handled on " + location.hostname);
      } else {
        setStatus("✅ Waiting | " + location.hostname);
      }
    } catch (error) {
      const message = error?.message || String(error);
      setStatus("⚠️ Error: " + message);
      console.error("[Notion Browser Relay] error:", error);

      try {
        await setNotionTitle(makeError(message));
      } catch (_) {
        // Avoid error loops if Notion write fails.
      }
    }

    running = false;
    setTimeout(poll, CONFIG.pollMs);
  }

  installPanel();
  registerConfigMenus();

  setStatus("🚀 Notion Browser Relay Safe starting...");
  setTimeout(poll, 1000);
})();
