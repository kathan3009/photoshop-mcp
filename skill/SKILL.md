---
name: photoshop
description: Edit the user's open Adobe Photoshop documents on this Mac — layers, text, shapes, placed images, color grading with adjustment layers (incl. per-color Hue/Saturation), masks, Select Subject, filters, sRGB export. Use when the user asks to change, grade, retouch, lay out, inspect or export something in Photoshop or a PSD.
---

# Photoshop

Two equivalent interfaces drive the running Photoshop (macOS, Photoshop 2026 tested):

- **MCP tools** `ps_*` — use these when the `photoshop` MCP server is connected.
- **CLI** `psctl <tool> …` — same tools from the shell (installed by `photoshop-mcp setup`; otherwise `node <photoshop-mcp>/cli.mjs`). Use it when the MCP isn't connected, or to drive long scripted jobs (batch files, loops over many PSDs).

```bash
psctl status                                     # docs, history, EXIF
psctl snapshot depth=2                           # layer tree with ids
psctl render out=/tmp/look.jpg maxSize=1200      # then Read /tmp/look.jpg to SEE it
psctl analyze points='[[1200,800]]'              # histogram, clipping, color cast, samples
psctl adjustment type=curves params='{"rgb":[[0,12],[128,140],[255,245]]}' name="Curves - lift"
psctl set_layers layer=12 opacity=60             # one layer, flat args
psctl batch @grade.json                          # many edits, one undo step, all-or-nothing
psctl history action=undo
psctl help adjustment                            # exact args for any tool
```

Args: `key=value` (values parsed as JSON), one JSON object, `@file.json`, or `-` for stdin.

## Workflow

1. **Look**: `status` → `snapshot` → `render` (actually view the image: what is it, subject, light, mood). For color work, `analyze` too: luminosity stats, % clipped, per-channel means, cast; sample skin / sky / something that should be neutral. `render crop=[l,t,r,b]` zooms into details at full resolution; `render layer=<id>` shows one layer alone. Renders are sRGB, so what you see is what a browser shows.
2. **Plan** in a sentence or two.
3. **Edit non-destructively**: `adjustment` layers for tone/color, `filter` (smart filters by default), `mask` instead of erasing. Put a look's layers in a group (`layer_op action=group`) so it can be toggled.
4. **Local edits**: selection first (`selection action=subject` — Photoshop's AI, honors `mode=add|subtract|intersect`; or rect/ellipse + `feather`), then create the adjustment: **an active selection becomes the new adjustment's mask**.
5. **Verify** after each meaningful change with `render` (+ `analyze`). Worse? `history action=undo` (every tool call = exactly one undo step) and try other values.
6. **Batch** multi-step builds with `batch` — each op is `{op, args}` using the same args as the tool (`create_layer, add_text, edit_text, place_image, set_layers, layer_op, adjustment, filter, selection, mask`).

## Rules

- Address layers by **id** from `snapshot` (names may repeat; `"Group/Layer"` paths also work).
- New layers go **above the selected layer** — also when a group is selected (pass `inside=<group>` to put one in a group). After `layer_op action=group` the new group is selected, so the next layer lands above it.
- Never overwrite the user's file unless asked: `document action=save` without `path` needs `overwrite=true`. Export with a new `path` (psd/tiff keep layers; png/jpg export the composite **converted to sRGB** — `profile=document` keeps the working profile). Files you exported in this session may be re-exported without the flag.
- Never close a document with unsaved user work (`close` refuses unless `discard=true`, which needs the user's OK).
- The CLI is stateless: pass `docId=<id>` (from `status`) on every call when more than one document is open. The MCP server pins its session to one document automatically.
- A safety checkpoint is taken before the first edit of each document (history snapshot + disk copy of unsaved work); `history action=revert` returns to it. `checkpoint` takes one manually.
- `doctor` checks the setup; call logs are in `~/Library/Logs/photoshop-mcp/`.
- Fonts need exact PostScript names — find them with `fonts query=…`. A missing font is an error, not a silent fallback. Text `size` and paragraph `box` are true pixels at any document ppi.
- Adjustment/filter params are validated strictly; an unknown key is an error listing the allowed keys. `hueSaturation` takes per-color ranges: `reds|yellows|greens|cyans|blues|magentas: {hue, saturation, lightness}`.
- `place_image fit=cover` adds a layer mask that clips to the box; `mask action=add replace=true` swaps a mask. Deleting or replacing a mask keeps the active selection.
- `exec` / `run file.jsx` is the escape hatch (ExtendScript ES3: no let/const/arrows/JSON; nested ternaries need parentheses). Prefer the typed tools; they encode Photoshop quirks the escape hatch doesn't.

## Photoshop quirks the tools already handle

- PS 27 replaced Brightness/Contrast internals with a "Light" adjustment — use `type=light` (exposure −5..5, contrast/highlights/shadows/whites/blacks −100..100) or `type=brightnessContrast`.
- The "Color" blend mode is `color` here (ExtendScript calls it COLORBLEND).
- Select Subject on a single layer that doesn't fill the canvas fails → run `subject` without a layer, then `selection action=layer layer=<id> mode=intersect`.
- Hidden layers can't be filled; converting the Background layer gives it a new id (tools re-read it).
- Photoshop's text DOM reads px sizes as points at document resolution and puts new layers inside a selected group; both are corrected.

## Not possible from here (say so instead of faking it)

Camera Raw local masks and Texture/Clarity, generative fill, brush strokes, 3D. Camera Raw develop settings can be driven by writing an `.xmp` sidecar next to the raw before `document action=open`.
