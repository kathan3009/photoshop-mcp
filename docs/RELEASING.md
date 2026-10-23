# Release procedure

## Source-first release

HN should link to the repository and the source quickstart. A runnable public repository qualifies for Show HN; a packaged desktop app is optional. See https://news.ycombinator.com/showhn.html.

1. Keep root/app `package.json` and both lockfiles on the same version.
2. Run `npm ci`, `npm run test:release`, and `npm run test:smoke`. Review the diff and preserve unrelated local edits.
3. Run `npm test` with Photoshop open and all personal work saved. It uses scratch documents and refuses unsaved user documents. Do not override that refusal. Record actual results; historical `test/last-green.json` is not proof of a new run.
4. Test the README quickstart from a fresh clone/account, including one chosen MCP client, Automation permission, `ps_status`, one scratch edit, undo, and export.
5. Commit and tag only the reviewed revision. Push/publish as a separate deliberate step. Do not advertise an unpublished tag or a locally built artifact as available.

## Desktop public release

Prerequisites: macOS build host, root and app dependencies (`npm ci` in each), a **Developer ID Application certificate with its private key**, and notarization access. An ad-hoc signature is not equivalent to Developer ID signing.

Check certificate availability with `security find-identity -v -p codesigning`. Store notarization credentials interactively with `xcrun notarytool store-credentials photoshop-mcp`; never commit certificates, passwords, API keys or `.env` files. Alternatively use the standard electron-builder notarization environment variables through your secret manager.

```bash
cd app
npm ci
APPLE_KEYCHAIN_PROFILE=photoshop-mcp npm run dist
```

`CSC_NAME` can select a particular Developer ID identity when more than one is installed. `CSC_LINK` and `CSC_KEY_PASSWORD` can supply a signing certificate in CI. Signing/notarization must be configured before this command; it intentionally fails instead of silently producing unsigned public binaries.

The command packages both architectures, signs with hardened runtime and JIT/Apple Events entitlements, notarizes and staples the app through electron-builder, verifies each DMG's integrity, mounts it read-only, and verifies the **app inside the DMG**. Public builds additionally require a valid stapled ticket and Gatekeeper acceptance. It tests the bundled MCP handshake on the build host's architecture without calling Photoshop or changing client configuration.

Only after all checks pass are artifacts promoted into `app/dist/release-<version>-arm64-x64/`, with fresh `SHA256SUMS.txt` and `verification.json`. Failed builds stay in `.building-*` and must not be distributed. An existing destination is never overwritten. Never edit a signed bundle or reuse checksums from another build.

Server dependencies have a dedicated `extraResources` mapping: electron-builder excludes a mapping root's `node_modules` directory. Keep the mounted-DMG smoke check to catch missing dependencies that a build run inside the repo can accidentally resolve from its parent folders.

The other architecture still needs a native-machine runtime/Photoshop test. A signature check alone is not an Intel compatibility test. A fresh-user browser download and Finder launch are required to exercise quarantine, permissions and first-run behavior. No current claim of clean-machine notarized testing is implied by this script.

## Local packaging tests

```bash
cd app
npm run dist:local
# Or build one architecture:
npm run dist:local -- --arch=arm64
```

Local builds use a complete ad-hoc signature, disable hardened runtime only for this local channel, skip notarization, and use `-unnotarized.dmg` filenames under `dist/local-<version>-<arches>/`. They repair the incomplete Electron bundle signature found in 1.2.0 but **do not remove Gatekeeper requirements** for downloads. Do not present these as the public install fix.

## HN delivery notes

- Lead with the real use case: an MCP client edits the user's running Photoshop while preserving editable layers and offering undo/checkpoints.
- State macOS-only support, Node requirements for source, Photoshop licensing, the tested version, and model-provider costs/data handling up front.
- Show an actual source-server workflow: before/after image, named layers, and undo. If showing the desktop UI, label it optional so the source quickstart is not misleading.
- Explain limits: no generative fill, brushes/painting, 3D, or Camera Raw local masks; modal dialogs block scripting. Older Photoshop versions are unverified.
- Keep the source installation and issue tracker obvious. Remove old DMG recommendations from the website before directing HN there.
- Discuss technical details you can substantiate: stable layer IDs, transactional batches, profile conversion, text units, and validation of Photoshop's stored results. Avoid unsupported comparisons or claims of complete safety.
- Write the HN submission and discussion replies yourself. HN's guidelines prohibit generated text in posts: https://news.ycombinator.com/newsguidelines.html.
- Be available to answer questions; don't solicit upvotes/comments or delete and repost for visibility.

Publishing checklist: repository changes pushed, public quickstart verified, website links aligned, actual test results recorded, and no public DMG claim until signing/notarization plus fresh-download testing pass.
