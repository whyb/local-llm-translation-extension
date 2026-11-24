# Local LLM Translator Pro

Privacy-first browser translation extension powered by local LLMs — your text never leaves your device.

## What it does

- Translate page text and selected attributes
- Translate a selected range, copy the result, or replace the selection
- OpenAI-compatible, llama.cpp, Ollama, vLLM, SGLang, Anthropic and Gemini adapters
- Primary, fallback, selection and prefetch provider roles
- Translation memory and page snapshots in IndexedDB
- Early cache painting at `document_start`
- One-time all-sites access with per-site translation policies
- SPA, bfcache, iframe and MutationObserver support
- Optional hover/next-navigation prefetch with budget and URL guards
- Diagnostics, redacted bug reports, provider probing, settings/TM import export and hard reset

## Privacy model

No page text is read until the user grants all-sites access from the toolbar popup. The default behavior is “Ask me”, and speculative prefetch is off by default. Model requests and API keys live in the background context. Translation memory stays in the extension’s IndexedDB. Bug reports redact credential-shaped fields and strings. This is still a local-data product: translation memory contains source text and translations, and API keys are stored unencrypted in extension storage. Use a local endpoint if you want page text to remain on the machine.

The extension never uses `eval`, `new Function`, dynamic imports, remote scripts or `innerHTML` for page/model output.

## Development

Requirements: Node.js 20 or newer, Firefox 140+ on desktop, Firefox for Android 142+, or a current Chrome/Edge.

```powershell
npm run check
npm test
npm run build
```

`npm run build` produces:

- `dist/chrome/` — load unpacked in Chrome or Edge
- `dist/firefox/` — load temporarily in Firefox via `about:debugging#/runtime/this-firefox`

To load the root directly in Chrome/Edge, use the root `manifest.json`. For Firefox, use the built `dist/firefox/manifest.json` because it contains Firefox-specific metadata.

## Browser debugging

<details>
<summary><strong>Chrome: load, reload and inspect</strong></summary>

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `dist/chrome/` (or the repository root when using the root manifest).
4. Open the target page and the extension popup once.

Development behavior:

- After changing content scripts, reload the target page.
- After changing the background service worker or manifest, click the reload button on the extension card.
- Open the extension card's **Errors** button for manifest, service-worker and permission errors.
- Use **Inspect views → service worker** for background logs.
- Popup logs belong to the popup DevTools window.
- Content-script logs belong to the target page DevTools console.
- Permission changes require reloading the extension, not only refreshing the page.

Chrome stable intentionally blocks arbitrary off-store `.crx` installation. For local development, use **Load unpacked**.
</details>

<details>
<summary><strong>Edge: load, reload and inspect</strong></summary>

1. Open `edge://extensions/`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `dist/edge/`.
4. Pin the extension from the toolbar extensions menu.

Development behavior is the same as Chrome:

- Reload the page for content-script changes.
- Reload the extension card for manifest/background changes.
- Use the extension card's error panel and service-worker inspector.
- If developer mode is managed or disabled by policy, a local administrator must allow sideloading.

Edge can load the same unpacked package as Chrome; `dist/edge` is produced as a separate artifact for release packaging.
</details>

<details>
<summary><strong>Firefox: temporary load, reload and inspect</strong></summary>

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist/firefox/manifest.json` or the packaged `.xpi`.
4. Use the extension card's **Reload** button after source changes.
5. Use **Inspect** for background logs; content-script logs appear in the page's Browser Console/DevTools.

Notes:

- Temporary add-ons disappear when Firefox restarts.
- Unsigned `.xpi` files normally install only in Firefox Developer Edition, Nightly or builds where signature enforcement is disabled.
- Stable Firefox requires a Mozilla-signed add-on for permanent installation. The CI archive is unsigned.
</details>

## Release packaging

Push a tag matching `v*.*.*`, for example `v2.0.1`. The GitHub Actions workflow validates that the tag version matches `package.json`, runs all checks, builds Chrome, Edge and Firefox packages, and creates a GitHub **pre-release**.

Release assets include:

- `local-llm-translator-pro-chrome-vX.Y.Z.zip`
- `local-llm-translator-pro-edge-vX.Y.Z.zip`
- `local-llm-translator-pro-firefox-vX.Y.Z.zip`
- `local-llm-translator-pro-chrome-vX.Y.Z.crx`
- `local-llm-translator-pro-edge-vX.Y.Z.crx`
- `local-llm-translator-pro-firefox-vX.Y.Z.xpi`

The CI does not sign artifacts or use private keys. The `.crx` and `.xpi` files are direct ZIP-container copies for release convenience; they are not signed installers. Chrome/Edge stable may reject off-store CRX files, and unsigned XPI files are not accepted by stable Firefox.

## Project layout

```text
src/shared/       settings, URL normalization, text units, messages, browser facade
src/background/   service worker/background page, providers, cache, prefetch
src/content/      classic content-script bundles: common, early, main, frame
src/ui/popup/     vanilla HTML/CSS/JS popup
src/ui/options/   vanilla HTML/CSS/JS settings dashboard and diagnostics
src/assets/       standard PNG icons generated from the project logo
```

Content scripts are classic scripts because browser content-script registration does not support ES modules. `content/common.js` exposes a small shared runtime namespace to `early.js`, `main.js` and `frame.js`. The background and extension pages use ES modules.

## Permissions

- `storage` for settings and API keys
- `tabs` for active tab resolution and tab messages
- `scripting` for dynamic content-script registration
- optional `<all_urls>` for one-time all-sites access

There is no `externally_connectable`, no static content-script injection, no cookies API and no webRequest API.

## Security notes

- API keys are plain text in extension storage.
- Gemini-compatible endpoints use a query-string key by provider convention.
- Page translation sends source text to the configured endpoint.
- Prefetch uses same-site GET with `credentials: "include"` and is off by default.
- The translation memory stores source text/translations and can be purged by domain or entirely.
- Provider endpoint is user-controlled; use HTTPS for non-local endpoints.
