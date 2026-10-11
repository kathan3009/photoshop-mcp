# Hyperframes Composition Brief: Photoshop MCP

## Objective
Create a short, Apple-product-film-style launch video for Photoshop MCP with voiceover and music.

## Output
- Composition directory: `marketing/brag-output/composition/`
- Rendered video: `marketing/brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 24.6 seconds

## Source Material
- Project root: `~/Developer/photoshop-mcp`
- Primary files read: `app/renderer/index.html`, `app/renderer/style.css`, `README.md`, `app/package.json`, `src/tools.mjs`
- Product name: Photoshop MCP
- Tagline / strongest claim: "Let your AI agent work in Photoshop."
- Key UI or visual moment to recreate: the Overview tab (Connect cards); the Activity feed; a raw → graded frame produced through the server
- Copy that must appear verbatim:
  - Let your AI agent work in Photoshop. (hero, split as "Your agent can see. / Now it can edit." in the hook — the voice says the full idea)
  - Photoshop MCP
  - Built so you can leave it running.
  - Pause edits / Edits paused
  - kathandesai.com/photoshop-mcp

## Creative Direction
- Tone preset: polished
- Creative direction: Apple product film — quiet confidence, restraint, premium dark
- Interpretation: five scenes with settled holds; soft crossfades and slow pushes; copy short and literal; one amber accent; the voice is calm; two or three soft SFX plus one bell.
- Angle: see brag-plan.md "The angle".
- Hook: black → graded bridge frame fades up; "Your agent can see." / "Now it can edit."
- Outro / punchline: icon + "Download for Mac" + URL on the 22.93s cue with a bell; "Photoshop MCP. Free, for Mac."
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Gradient text, neon, equalizer graphics

## Visual Identity
- Background: #0e1016
- Text: #e8ebf4 (muted #8b93ad)
- Accent: #ffb547
- Display font: Archivo Black (embedded)
- Body font: IBM Plex Mono (embedded)
- Visual references from the project: `assets/img/overview.png`, `assets/img/activity.png`, `assets/img/bridge-before.jpg` → `bridge-after.jpg`, `assets/img/icon.png`

## Storyboard
Use the storyboard in `brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 4.4s — bridge frame fades up; two lines; amber rule
2. Reveal — 4.3s — icon lands on beat 4.39; "Photoshop MCP"; client line
3. The flow — 6.6s — raw→graded wipe starting on cue 8.74; five tool calls on the beat grid, last on 13.11
4. Built to leave running — 5.5s — three guards on 15.84/16.93/18.02; Pause flips on 17.47
5. Outro — 3.8s — lockup on 22.93 with bell; URL; fade by 24.4

## Audio
- Audio role: cinematic support under a voice
- Audio arc: bed fades in under the picture → sits low under the voice → brief lift after the last line → fade out
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: data-volume 0.16 while the voice speaks; lifts to 0.26 after 23.2s; fades to 0 across the final second
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (110 BPM). Strong-cue locks: 8.74, 13.11, 17.47, 22.93. Beat grid for the feed: 9.29, 9.83, 10.37, 10.93, 13.11; for the guards: 15.84, 16.93, 18.02.
- Voiceover: Kokoro af_heart, one WAV per scene in `assets/vo/`, each on its own track at volume 1; scene starts follow the plan, clip lengths measured after generation.
- Audio-reactive treatment: subtle; RMS → hero glow opacity and window shadow warmth (±15%), nothing on text.
- Audio-coupled moments:
  - Scene 2 icon landing — impactSoft_medium_001
  - Scene 3 wipe start — impactSoft_medium_004
  - Scene 3 feed items — beat grid (no SFX; the voice is talking)
  - Scene 4 pause flip — click_003
  - Scene 5 lockup — impactBell_heavy_000
- SFX selection guidance: low HF-risk picks only (sfx-analysis.md "Safest General Picks"); SFX at 0.55–0.7; never under a stressed word.
- Exact SFX choice: as above, timestamps set after the motion exists.
- Audio files: already copied into `composition/assets/`

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills. /brag is its own workflow. Requirements: show real UI (Overview window, Activity feed) and the real raw→graded frame; keep all text readable (hold ≥ 1.2s per sentence); stay within 24.6s; include music, SFX and the voice track; honor the cue locks within ±0.15s and beat grid within ±0.10s unless readability suffers; audio-reactive glow via `extract-audio-data.py` from hyperframes-creative; run `hyperframes check` before render; local only.
