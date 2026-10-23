# photoshop-mcp

Let Claude (or Cursor, Codex, any MCP client) drive the **Photoshop running on your Mac**: open files, build layers, grade colour with adjustment layers, Select Subject, masks, text, smart objects, export. No Photoshop plugin to install.

```
Claude Code / Claude Desktop / Cursor / Codex ──MCP──▶ photoshop-mcp ──AppleScript──▶ Photoshop
shell / scripts ──────────────────────────────psctl──▶ (same core)
```

Every edit is **one undo step** that **rolls back automatically** if it fails. The agent gets a safety checkpoint before its first edit, requires `overwrite: true` to replace an existing file, and sees the picture (sRGB renders + histogram numbers) before and after each change.

## Install

### Recommended: run from source

**macOS only.** You need an installed/licensed copy of Photoshop, Git, Node.js 18+ with npm (prefer a supported Node LTS), and an MCP client. Tested with **Photoshop 27.11.0**; other versions are unverified. The server is free and MIT-licensed; Photoshop and your model provider may charge separately.

```bash
git clone https://github.com/kathan3009/photoshop-mcp.git
cd photoshop-mcp
./scripts/install.sh --client claude-code
```

Use `claude-desktop`, `cursor`, or `codex` instead of `claude-code` for your client. Omit `--client` to configure all detected clients. The installer installs locked dependencies, backs up existing client config files, adds the Photoshop MCP entry, and links the Claude skill and CLI tools. No sudo or desktop app is needed. Keep this clone in place: clients use its absolute path.

Restart your client, open Photoshop, and ask it to **run `ps_status`**. Allow the macOS Automation request to control Photoshop. For diagnostics, run `node bin/photoshop-mcp.mjs doctor`. If `psctl` is not found, use `node cli.mjs` or add `~/.local/bin` to PATH.

Try a disposable photo first: ask the agent to render it, add a named exposure adjustment layer, render again, then undo that step. The source server exposes the editing, history and checkpoint tools; the optional desktop app adds the menu-bar UI.

[Installation, troubleshooting, privacy, and uninstall](docs/INSTALLATION.md) · [Report an issue](https://github.com/kathan3009/photoshop-mcp/issues)

### Optional desktop app

The existing **1.2.0 DMGs are unnotarized** and can trigger macOS's “damaged” warning. Use the source installation above for now. The repo now separates notarized public builds from explicitly named `-unnotarized` local test builds; a new notarized download is not yet being advertised. See [release procedure](docs/RELEASING.md).

The app bundles its own runtime, shows activity/previews/checkpoints, and provides Pause, Undo and Revert controls. If using it, copy it to Applications and launch it there **before** connecting clients.

Any other MCP client: `photoshop-mcp setup` prints the JSON snippet, which is just

```json
{ "mcpServers": { "photoshop": { "command": "/absolute/path/to/node", "args": ["/absolute/path/to/photoshop-mcp/server.mjs"] } } }
```

## What the agent can do

| Area | Tools |
|---|---|
| **See** | `ps_status` (docs, history, EXIF) · `ps_snapshot` (layer tree with stable ids, filterable) · `ps_inspect` (exact adjustment settings, text styling, smart filters) · `ps_render` (sRGB composite, crop at full res, or one layer solo → image) · `ps_analyze` (histogram stats, clipping, colour cast, point samples) · `ps_fonts` |
| **Documents** | `ps_document` open / create / activate / duplicate / save (psd, tiff, png, jpg — exports converted to sRGB) / close / resizeImage / resizeCanvas / crop / trim / flatten |
| **Layers** | `ps_create_layer` (pixel, group, solid & gradient fills, rectangle, ellipse) · `ps_add_text` / `ps_edit_text` (point & paragraph text, fonts, tracking, leading — true pixels at any ppi) · `ps_place_image` (smart object; contain / cover / stretch into a box) · `ps_set_layers` (visibility, opacity, blend, move, resize, rotate, align; one layer or many) · `ps_layer_op` (delete, duplicate, group, ungroup, merge, rasterize, smart object, clip, move) |
| **Grade & retouch** | `ps_adjustment` — curves, levels, brightnessContrast, light, hueSaturation (with per-colour ranges), colorBalance, vibrance, photoFilter, exposure, blackAndWhite, gradientMap, invert, posterize, threshold (create, update, clip to a layer, mask from selection) · `ps_filter` — gaussianBlur, unsharpMask, addNoise, highPass, motionBlur, median (smart filters by default) · `ps_selection` (rect, ellipse, **AI Select Subject** with add/subtract/intersect, layer pixels, feather, expand, fill…) · `ps_mask` (add / replace / delete / apply / invert / enable / disable) |
| **Control** | `ps_history` (list, undo, redo, goto, snapshot, revert) · `ps_batch` (many ops = one atomic undo step) · `ps_actions` (play your recorded Photoshop Actions) · `ps_exec` (ExtendScript escape hatch, opt-in) |

The server ships **instructions** that teach any connecting agent the house rules: look first (render + analyze), edit non-destructively, verify after each change, undo bad steps, never overwrite the user's file.

Not covered: Camera Raw local masks / Texture / Clarity, generative fill, brushes, 3D. Raw develop settings can still be driven by writing an `.xmp` sidecar next to the raw before opening it.

## Safeguards

| Risk | Safeguard |
|---|---|
| Agent edits the wrong file when you switch documents | Each session is **pinned to one document** (first worked on, or last opened/created/activated). Your view is restored after every call. `docId` targets another one explicitly. |
| Photoshop crashes mid-session and unsaved work is lost | **Checkpoint before the first edit**: a history snapshot (`ps_history revert`) plus a layered copy of unsaved work in `~/Library/Application Support/photoshop-mcp/checkpoints` (newest 20 / 7 days kept). Re-taken before every `ps_exec`. `PS_MCP_CHECKPOINT=full\|history\|off`. |
| Agent overwrites or discards your work | Saving in place needs `overwrite: true`; closing a dirty document needs `discard: true`; existing files are never replaced without `overwrite` — except files the same session exported itself. |
| Arbitrary code | `ps_exec` is **off by default** (`PS_MCP_ALLOW_EXEC=1`, or `setup --exec`). |
| A dialog is open / Photoshop hangs | Per-tool timeouts; on timeout the bridge pings Photoshop and reports "a dialog is probably open" vs "still working". |
| Opaque Photoshop errors | Locked/hidden layers, wrong layer type, wrong colour mode, targeted mask… are checked up front with actionable messages; raw "not currently available" errors get likely causes appended. |
| Silent no-ops | Adjustment/filter params are strictly validated; tools return what Photoshop actually stored. |
| Debugging | Every call is logged to `~/Library/Logs/photoshop-mcp/YYYY-MM-DD.jsonl` (14 days; `PS_MCP_LOG=off`). |
| Photoshop updates | `test/last-green.json` records the version the suite passed on; `ps_status` and `doctor` flag untested versions. Optional daily launchd watcher: `scripts/watcher.sh install`. |

## CLI

```bash
psctl status
psctl snapshot depth=2
psctl render out=/tmp/look.jpg maxSize=1200
psctl adjustment type=hueSaturation params='{"reds":{"saturation":25}}'
psctl set_layers layer=12 opacity=60
psctl batch @grade.json
psctl run script.jsx docId=5        # ExtendScript file as one undo step
psctl help ps_set_layers            # JSON schema for any tool
psctl doctor
```

Args are `key=value` (values parsed as JSON), one JSON object, `@file.json`, or `-` for stdin. The CLI is stateless: pass `docId` when more than one document is open.

## Data handling

Execution is local, but requested previews and tool results are returned to your MCP client and may be sent to its model provider. Local execution is not a promise that images never leave your Mac. Logs and checkpoints can contain sensitive data. Overwrite/discard flags are programmatic guards, not independent human approval dialogs. See [details](docs/INSTALLATION.md#privacy-costs-and-permissions).

## Testing

```bash
npm run test:smoke   # MCP startup and tool discovery, without Photoshop
npm run test:release # release policy and isolated client-configuration regression checks
npm test          # end-to-end over real MCP against the running Photoshop
```

The suite covers every tool, RGB/CMYK/Grayscale and 300 ppi documents, a 300-layer document, document pinning, checkpoints, the close guard, locked layers, busy detection, logging and exec gating. It works only in scratch `e2e-*` documents, verifies your own document is untouched, and **refuses to run while any document has unsaved changes** (a malformed Photoshop command can crash Photoshop and take every open document with it). On a full pass it writes `test/last-green.json`.

`node test/agent-trial.mjs <dir with shikara.jpg & horses.jpg> [model]` runs real headless-Claude tasks and reports tool use, errors and cost.

## Photoshop quirks this handles (verified live on 27.11)

| Finding | Handling |
|---|---|
| New layers are created **inside** a selected group | lifted above the group unless `inside` is asked for (a note says so) |
| Text `size` / paragraph box in "px" are read as points at document ppi (100 px → 417 px on a 300 ppi file) | scaled by 72/ppi; leading and position are true px |
| Exports/renders carry the document profile (Display P3 from Camera Raw) | converted to sRGB unless `profile: "document"` |
| ExtendScript mis-parses unparenthesized nested ternaries | none left in the codebase |
| Deleting a mask drops the active selection; cover-fit placement adds a mask | selection kept; `replace: true`; notes |
| Select Subject ignores the selection mode | previous selection kept in a channel and combined |
| Brightness/Contrast `brightness` is silently ignored (PS 27 "Light" adjustment) | `brightnessMode` set; params strict-validated |
| `BlendMode.COLOR` doesn't exist (`COLORBLEND`) | friendly names mapped |
| AM history index / align / per-layer Select Subject / hidden-layer fill / Background id change / mask channel left targeted | each worked around, see `jsx/` comments |
| Colour samplers and selections dirty the document | analysis runs on a temporary duplicate |

The raw probe scripts are in `probes/` (`node probes/run.mjs --scratch probes/p6.jsx` runs one in a throwaway document; they refuse to run next to unsaved work).

## Layout

```
app/                    Electron desktop app (bundles the server; `npm run dist` builds the DMGs)
marketing/brag-output/   the launch film (/brag workflow: plan, brief, HyperFrames composition with music + Kokoro voice, share copy)
marketing/launch-video/ the earlier 56-second silent cut (HyperFrames composition)
bin/photoshop-mcp.mjs   setup | doctor | uninstall | serve
server.mjs              MCP server (stdio) + agent instructions + per-connection session
cli.mjs                 psctl CLI
src/tools.mjs           tool registry: zod schemas, strict per-type params, batch validation, sessions, checkpoints
src/bridge.mjs          osascript bridge: document targeting, serialized queue, timeouts, busy detection, error hints, logging
src/setup.mjs           client registration (Claude Code, Claude Desktop, Cursor, Codex), skill + bin links
src/doctor.mjs          environment and registration checks
jsx/prelude.jsx         ExtendScript helpers: JSON, layer lookup, AM reads, transactions, descriptor dump
jsx/ops.jsx             every operation (mutations are one-step transactions; batch chains them)
skill/SKILL.md          agent skill
test/e2e.mjs            end-to-end suite · test/agent-trial.mjs headless-Claude trial
scripts/                install.sh, watcher.sh + version-watch.mjs (optional launchd)
probes/                 live probes that produced the findings above
```

## Limits

- macOS only (AppleScript transport). A UXP plugin + local daemon would enable Windows.
- One call at a time (Photoshop runs scripts serially); a modal dialog blocks calls until dismissed (they time out after `PS_MCP_TIMEOUT_S`, default 120s).
- No generative fill, painting/brush strokes, or 3D.

MIT © Kathan
