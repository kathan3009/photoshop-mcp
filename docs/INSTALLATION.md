# Install and troubleshoot

## Recommended: run the server from source

Requirements: macOS, an installed/licensed copy of Adobe Photoshop, Git, Node.js 18+ with npm (prefer a currently supported Node LTS), and an MCP client. The tested Photoshop version is **27.11.0**; other versions are not yet verified. Windows and Linux are unsupported.

```bash
git clone https://github.com/kathan3009/photoshop-mcp.git
cd photoshop-mcp
./scripts/install.sh --client claude-code
```

Replace `claude-code` with `claude-desktop`, `cursor`, or `codex`. A comma-separated list is supported. Omitting `--client` configures all detected clients. The installer uses `npm ci` and the committed lockfile. It adds a `photoshop` MCP entry, backs up existing JSON/TOML configs as `.bak`, links the Claude skill, and links `psctl` and `photoshop-mcp` into `~/.local/bin`. Use `--no-skill --no-bin` to skip those links. It does not require sudo.

Keep the clone in a permanent location: clients refer to it by absolute path. If you move it, run setup again. Source installation does not install or launch the Electron app, so the desktop DMG's Gatekeeper/signing problem does not apply. Normal Photoshop Automation permission is still required.

Restart the selected MCP client, launch Photoshop, then ask it to **run `ps_status`**. Approve macOS's request for that client/runtime to control Photoshop. No document is needed for this check. To diagnose:

```bash
node bin/photoshop-mcp.mjs doctor
```

If `photoshop-mcp` or `psctl` is not found, add `~/.local/bin` to your shell's PATH, or use `node bin/photoshop-mcp.mjs` / `node cli.mjs` from the clone. Setup finishing successfully means configuration was written; Doctor and `ps_status` verify the live connection separately.

For a first edit, open a disposable copy of a photo. Ask the agent to render it, create a named exposure adjustment layer, render the result, then undo that step. Check the layer stack yourself. Export to a new filename. The menu-bar gallery and buttons require the optional desktop app; the source server still exposes history/checkpoint tools.

## Common issues

| Symptom | Action |
|---|---|
| MCP server missing | Restart the client. Re-run setup for that specific client. Keep the clone and Node executable at their registered paths. |
| Photoshop not running | Open the installed Adobe Photoshop app, then retry `ps_status`. |
| Not authorized / Apple event permission error | Check System Settings → Privacy & Security → Automation for the app launching the server. Enable its Photoshop permission, then restart that client. |
| Photoshop busy / timeout | Dismiss any modal Photoshop dialog before retrying. |
| `ps_exec` unavailable | Disabled by default. Regular tools do not need it; enable with `setup --exec` only if you intend arbitrary ExtendScript execution. |
| Edits paused | Resume using the desktop app. A persistent pause flag can remain after quitting it; see the reset below. |
| Config is invalid | Setup leaves invalid JSON untouched. Repair it or restore your backup, then retry. |
| Source install fails while downloading dependencies | Check Node/npm versions, registry access and the npm error. Installation needs internet access. |

To deliberately clear a pause left by a removed desktop app, remove only this flag, then retry:

```bash
rm -f "$HOME/Library/Application Support/photoshop-mcp/paused"
```

## Desktop app: optional, not the recommended HN installation

The old **1.2.0 DMGs are not notarized** and may produce “damaged and can't be opened.” Re-downloading does not repair an invalid bundle signature. Prefer the source install above. New local builds have `-unnotarized` in their filenames and are test artifacts, not notarized releases.

For any future notarized release: choose `arm64` for Apple silicon or `x64` for Intel, copy the app to Applications, eject the DMG, launch the installed app, then Connect. Never connect directly from the mounted disk image. If upgrading from 1.2.0, reconnect each client and restart it to replace old runtime paths.

Compare a downloaded artifact to the `SHA256SUMS.txt` shipped in the **same release**:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Download all listed DMGs for that command, or compare `shasum -a 256 <your-file.dmg>` with the corresponding line. A checksum mismatch means stop and obtain matching artifacts; removing quarantine is not an integrity repair. Never disable Gatekeeper globally.

## Privacy, costs, and permissions

The server runs locally and has no product account requirement. It returns tool results and requested image previews to your chosen MCP client; that client may send them to its model provider. Local execution does **not** mean image data never leaves your Mac. Photoshop and the model provider may require paid subscriptions or usage charges.

Tool logs, previews, and checkpoints can contain sensitive names, paths, and image data. Logs are under `~/Library/Logs/photoshop-mcp`; previews/checkpoints are under `~/Library/Application Support/photoshop-mcp`. Review these before sharing diagnostics. An `overwrite: true` or `discard: true` parameter is a programmatic guard, not a separate human approval dialog. The agent must still obtain your permission.

## Update or remove

For updates, review the release changes, pull the code, run `npm ci`, then run setup again if the runtime or folder changed. Restart your client.

```bash
node bin/photoshop-mcp.mjs uninstall
```

Uninstall removes the Photoshop MCP registrations and links managed by this installer. It leaves logs/checkpoints and the clone in place. Disconnect desktop clients before deleting the desktop app. Keep any recovery files you need.

For bug reports, include macOS version, Intel/Apple silicon, Photoshop version, MCP client, project version (`node bin/photoshop-mcp.mjs --version`), and the exact error. Share sanitized Doctor output; do not attach original photos or complete logs by default.
