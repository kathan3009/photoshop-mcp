# 1.2.1 — source installation and release reliability (unreleased)

- Make the GitHub/source installation the recommended path; document requirements, first-use steps, data handling, troubleshooting and removal.
- Install source dependencies from the lockfile; validate Node/npm and missing client arguments. Separate successful configuration from live Photoshop readiness checks.
- Preserve other client configuration and refuse invalid JSON object shapes.
- Replace disabled desktop signing with a fail-closed Developer ID/notarization pipeline. Explicit local builds use complete ad-hoc signatures and `-unnotarized` filenames.
- Verify the app inside each final DMG and regenerate checksums only after verification. Smoke-test the bundled MCP runtime on the host architecture.
- Include server dependencies explicitly in the desktop bundle; the old resource mapping omitted node_modules and only worked when repository dependencies were available nearby.
- Make the integration test runner report an unavailable Photoshop connection without crashing.
- Declare the Photoshop Automation usage description and signing entitlements.
- Prevent registering temporary DMG runtime paths; recover the Connect UI after errors; handle image filenames containing quotes, # or ?.
- Preserve the existing desktop shutdown/window-lifetime fix.
- Notarized public binaries and clean-machine download testing remain pending signing credentials and release verification.

# Changelog

## 1.2.0 — fixes from a real 40-document editing session + install for everyone (2026-10-11)

Fixes (each one was hit while grading real raw photos through the server; all probed against Photoshop 27.11):
- **New layers landed inside a selected group.** Photoshop creates new layers inside a selected group; after `ps_layer_op group` that meant the next adjustment silently nested into a (hidden) group and an export came out unchanged. New layers now always go above the selected layer unless `inside` is passed; a note says so when a lift happened.
- **Exports embedded the document profile** (Display P3 from Camera Raw). png/jpg exports and all `ps_render` previews are now converted to sRGB; `profile: "document"` keeps the working profile. Results report the profile.
- **Text size and paragraph box were wrong on non-72-ppi documents** (100 "px" rendered 417 px on a 300 ppi file). Size and box are now true pixels at any ppi; leading and position were already pixels.
- **`ps_analyze` misreported its region** because ExtendScript mis-parses unparenthesized nested ternaries. Rewritten; `region` now reports `{bounds, source}`.
- **`ps_mask add` failed on cover-fitted images** (cover adds a clipping mask). `place_image` says so in a note, `ps_mask add replace: true` swaps a mask, and deleting/replacing a mask keeps the active selection (Photoshop drops it).
- **Select Subject ignored `mode`**; add/subtract/intersect now combine with the previous selection.
- **`psctl run file.jsx` ignored `docId`.**

New:
- **Desktop app** (`app/`, Electron): bundles the server so nobody installs Node, one-click Connect for Claude Code / Claude Desktop / Cursor / Codex (the app binary runs the server with `ELECTRON_RUN_AS_NODE`), live activity feed, gallery of renders and exports, checkpoints browser, doctor, Pause (kill switch honoured by the server via a flag file), Undo and Revert buttons, menu-bar tray, open at login. DMGs for arm64 and x64 on GitHub Releases.
- `hueSaturation` per-color ranges: `reds|yellows|greens|cyans|blues|magentas: {hue, saturation, lightness}`.
- `ps_set_layers {layer, ...props}` shorthand next to `updates: [...]`.
- Files exported earlier in the same session may be re-exported without `overwrite: true`; the user's own files still need it.
- Feather/expand/contract up to 1000 px.
- `photoshop-mcp setup | doctor | uninstall`: registers the server with Claude Code, Claude Desktop, Cursor and Codex (absolute node path so GUI apps find it), links the agent skill and `psctl`; `scripts/install.sh` is now a thin wrapper. MIT license, npm/GitHub installable.

Internals: one `__flatCopy` for previews and exports, shared `__makeLayer/__makeGroup/__resolveIds/__keepSelection/__soloLayer` helpers, shared doctor, server version from package.json, zod issue formatting in one place. 165 e2e checks.

## 1.1.0 — production hardening (2026-10-08)
- **Document pinning**: each MCP session stays on one document even if the user switches files; the user's view is restored after every call. `docId` on every document-scoped tool.
- **Safety checkpoints**: history snapshot + layered disk copy of unsaved work before the first edit of each document, and before every `ps_exec`. `ps_history snapshot|revert`, `psctl checkpoint`.
- **Close guard**: closing a document with unsaved changes requires `discard: true`.
- **Busy detection**: per-tool timeouts; a timeout pings Photoshop to tell "dialog open / hung" from "still working".
- **Clear errors**: locked/hidden layer, wrong layer type and color-mode preconditions checked up front; Photoshop's raw errors get likely causes appended.
- **Logging**: every call to `~/Library/Logs/photoshop-mcp/*.jsonl` (14 days).
- **Color modes**: analyze/curves/levels behave correctly in CMYK, Lab and Grayscale.
- **Ops**: `ps_exec` off by default; `psctl doctor`; `scripts/install.sh`; daily launchd watcher that flags Photoshop updates since the last green test run (`test/last-green.json`).
- **Agent-trial fixes**: `layer` accepted as shorthand for `layers`; image placement now measures and self-corrects until cover/contain/stretch fits are pixel-exact; clearer fit-mode descriptions.
- Tests: 141 e2e checks incl. pinning, checkpoints, CMYK/Grayscale, 300-layer document, busy path, logging, exec gating; `test/agent-trial.mjs` runs real headless-Claude tasks.

## 1.0.0 (2026-10-08)
- 21 tools (see README), psctl CLI, agent skill, server instructions; analysis runs on a temporary duplicate so reads never touch history.
- Probe-verified workarounds for Photoshop 27.11 quirks (Light adjustment, COLORBLEND, align, history index, targeted mask channel, background id change, per-layer Select Subject, hidden-layer fill).

## 0.1.0
- 7-tool prototype over osascript.
