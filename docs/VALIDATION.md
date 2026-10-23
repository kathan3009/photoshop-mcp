# 1.2.1 validation — 2026-10-23

Validated locally on Apple silicon with Node 22.22.2 and Photoshop 27.11.0.

| Check | Result |
|---|---|
| Clean source install, no existing node_modules, isolated test home | Passed: 94 locked npm packages installed; Codex registration written only to test profile |
| Source MCP handshake / tool discovery | Passed: version 1.2.1, 20 default tools |
| Release policy / isolated client configuration regression checks | 5/5 passed |
| Real Photoshop integration suite | 167/167 passed; scratch documents cleaned up; see test/last-green.json |
| Rebuilt arm64 DMG integrity | Passed |
| Strict signature verification of app inside mounted DMG | Passed, ad-hoc signature |
| Bundled MCP startup from mounted DMG | Passed: 20 default tools; no parent-repository dependencies needed |
| Fresh SHA-256 manifest verification | Passed |
| App UI launch and installed-location warning | Observed in rebuilt app |
| Public release with no signing identity | Refused as intended |

The integration suite's Select Subject fixtures were corrected: an opaque filter-test layer no longer hides the subject, and the intersection test starts with an explicit region rather than the complement left by a subtraction test. The tool implementation was not changed to accommodate those tests.

Not yet validated: Developer ID signing/notarization (no usable identity configured), Intel native runtime, fresh-user browser download/Gatekeeper acceptance, Windows/Linux (unsupported), or Photoshop versions other than 27.11.0. The local DMG is a packaging test artifact, not a notarized public release. CI configuration was added; local results do not imply a hosted CI run passed.

HN delivery should use the source quickstart. Merge the source/docs changes before sharing the default-branch repository link; do not direct users to the old 1.2.0 DMGs as the recommended installation.
