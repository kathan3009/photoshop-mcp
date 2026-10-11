// Tool registry shared by the MCP server (server.mjs) and the CLI (cli.mjs).
// Each tool: zod input shape → prepare() → a Photoshop op in jsx/ops.jsx.
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { callOp, PsError } from './bridge.mjs';

export const APP_SUPPORT = join(homedir(), 'Library/Application Support/photoshop-mcp');
export const RENDER_DIR = process.env.PS_MCP_RENDER_DIR || join(tmpdir(), 'photoshop-mcp');
export const CHECKPOINT_DIR = process.env.PS_MCP_CHECKPOINT_DIR || join(APP_SUPPORT, 'checkpoints');
// The desktop app pauses all edits by creating this file (the kill switch in its toolbar).
export const PAUSE_FILE = join(APP_SUPPORT, 'paused');
mkdirSync(RENDER_DIR, { recursive: true });

function pruneDir(dir, pattern, keep, days) {
  try {
    const files = readdirSync(dir).filter((f) => pattern.test(f))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    const cutoff = Date.now() - days * 864e5;
    files.forEach((x, i) => { if (i >= keep || x.t < cutoff) unlinkSync(join(dir, x.f)); });
  } catch {}
}

// Photoshop versions the full e2e suite has passed on. Others work but are flagged.
export const TESTED_VERSIONS = ['27.11'];
export const versionTested = (v) => TESTED_VERSIONS.some((t) => String(v).startsWith(t));

// ---------------------------------------------------------------- shared schema pieces

const layerRef = z.union([z.number().int(), z.string().min(1)])
  .describe('Layer id from ps_snapshot (preferred), or an exact layer name / "Group/Layer" path');
const bounds = z.array(z.number()).length(4).describe('[left, top, right, bottom] in px');
const color = z.string().regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'hex color like #ff3366').describe('Hex color, e.g. #ff3366');
const path = z.string().min(1).describe('Absolute file path (~ is expanded)');
export const BLEND_MODES = ['normal', 'dissolve', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor', 'lighten', 'screen',
  'colorDodge', 'linearDodge', 'lighterColor', 'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
  'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity', 'passThrough'];
const blendMode = z.enum(BLEND_MODES);
const placement = {
  above: layerRef.optional().describe('Create/move directly above this layer'),
  below: layerRef.optional().describe('Move directly below this layer'),
  inside: layerRef.optional().describe('Move into this group (at its top)'),
  position: z.enum(['top', 'bottom']).optional().describe('Move to the top or bottom of the stack'),
};
const common = {
  name: z.string().optional().describe('Layer name'),
  opacity: z.number().min(0).max(100).optional(),
  blendMode: blendMode.optional(),
};

const expand = (p) => (p.startsWith('~/') ? join(process.env.HOME, p.slice(2)) : resolve(p));

// ---------------------------------------------------------------- per-type params (strict: unknown keys are errors)

const point = z.tuple([z.number().min(0).max(255), z.number().min(0).max(255)]);
const curve = z.array(point).min(2).describe('[[input, output], ...] in 0–255, sorted by input');
const levelsCh = { inputBlack: z.number().int().min(0).max(253).optional(), inputWhite: z.number().int().min(2).max(255).optional(), gamma: z.number().min(0.1).max(9.99).optional(), outputBlack: z.number().int().min(0).max(255).optional(), outputWhite: z.number().int().min(0).max(255).optional() };
const cmy = z.tuple([z.number().int().min(-100).max(100), z.number().int().min(-100).max(100), z.number().int().min(-100).max(100)]);
const stop = z.object({ color, location: z.number().min(0).max(100).optional(), opacity: z.number().min(0).max(100).optional() }).strict();
const hsl = { hue: z.number().int().min(-180).max(180).optional(), saturation: z.number().int().min(-100).max(100).optional(), lightness: z.number().int().min(-100).max(100).optional() };
const hslRange = z.object(hsl).strict().optional().describe('Per-color range {hue, saturation, lightness}');

export const ADJUSTMENT_PARAMS = {
  curves: z.object({ rgb: curve.optional(), red: curve.optional(), green: curve.optional(), blue: curve.optional() }).strict(),
  levels: z.object({ ...levelsCh, red: z.object(levelsCh).strict().optional(), green: z.object(levelsCh).strict().optional(), blue: z.object(levelsCh).strict().optional() }).strict(),
  brightnessContrast: z.object({ brightness: z.number().int().min(-150).max(150).optional(), contrast: z.number().int().min(-50).max(100).optional() }).strict(),
  light: z.object({ exposure: z.number().int().min(-5).max(5).optional(), contrast: z.number().int().min(-100).max(100).optional(), highlights: z.number().int().min(-100).max(100).optional(), shadows: z.number().int().min(-100).max(100).optional(), whites: z.number().int().min(-100).max(100).optional(), blacks: z.number().int().min(-100).max(100).optional() }).strict(),
  hueSaturation: z.object({ ...hsl, colorize: z.boolean().optional(), reds: hslRange, yellows: hslRange, greens: hslRange, cyans: hslRange, blues: hslRange, magentas: hslRange }).strict(),
  colorBalance: z.object({ shadows: cmy.optional(), midtones: cmy.optional(), highlights: cmy.optional(), preserveLuminosity: z.boolean().optional() }).strict(),
  vibrance: z.object({ vibrance: z.number().int().min(-100).max(100).optional(), saturation: z.number().int().min(-100).max(100).optional() }).strict(),
  photoFilter: z.object({ color: color.optional(), density: z.number().int().min(1).max(100).optional(), preserveLuminosity: z.boolean().optional() }).strict(),
  exposure: z.object({ exposure: z.number().min(-20).max(20).optional(), offset: z.number().min(-0.5).max(0.5).optional(), gamma: z.number().min(0.01).max(9.99).optional() }).strict(),
  blackAndWhite: z.object({ reds: z.number().int().min(-200).max(300).optional(), yellows: z.number().int().min(-200).max(300).optional(), greens: z.number().int().min(-200).max(300).optional(), cyans: z.number().int().min(-200).max(300).optional(), blues: z.number().int().min(-200).max(300).optional(), magentas: z.number().int().min(-200).max(300).optional(), tint: color.optional() }).strict(),
  gradientMap: z.object({ stops: z.array(stop).min(2).optional(), reverse: z.boolean().optional() }).strict(),
  invert: z.object({}).strict(),
  posterize: z.object({ levels: z.number().int().min(2).max(255).optional() }).strict(),
  threshold: z.object({ level: z.number().int().min(1).max(255).optional() }).strict(),
};

export const FILTER_PARAMS = {
  gaussianBlur: z.object({ radius: z.number().min(0.1).max(1000).optional() }).strict(),
  unsharpMask: z.object({ amount: z.number().min(1).max(500).optional(), radius: z.number().min(0.1).max(1000).optional(), threshold: z.number().int().min(0).max(255).optional() }).strict(),
  addNoise: z.object({ amount: z.number().min(0.1).max(400).optional(), monochromatic: z.boolean().optional(), uniform: z.boolean().optional() }).strict(),
  highPass: z.object({ radius: z.number().min(0.1).max(1000).optional() }).strict(),
  motionBlur: z.object({ angle: z.number().int().min(-360).max(360).optional(), distance: z.number().min(1).max(2000).optional() }).strict(),
  median: z.object({ radius: z.number().min(1).max(500).optional() }).strict(),
};

const issues = (err, fallback) => err.issues.map((i) => `${i.path.join('.') || fallback}: ${i.message}`).join('; ');

function strictParams(table, type, params, what) {
  const schema = table[type];
  const r = schema.safeParse(params ?? {});
  if (!r.success) {
    const allowed = Object.keys(schema.shape).join(', ') || '(none)';
    throw new PsError(`Invalid params for ${what} "${type}": ${issues(r.error, 'params')}. Allowed keys: ${allowed}.`);
  }
  return r.data;
}

// ps_set_layers accepts {updates: [...]} and/or one flat update {layer, ...props}.
const layerUpdate = {
  name: z.string().optional(), visible: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(), fillOpacity: z.number().min(0).max(100).optional(),
  blendMode: blendMode.optional(), locked: z.boolean().optional(),
  x: z.number().optional(), y: z.number().optional(), dx: z.number().optional(), dy: z.number().optional(),
  width: z.number().positive().optional(), height: z.number().positive().optional(),
  scale: z.number().positive().max(10000).optional().describe('Percent'),
  rotate: z.number().min(-360).max(360).optional(),
  align: z.object({
    h: z.enum(['left', 'center', 'right']).optional(), v: z.enum(['top', 'middle', 'bottom']).optional(),
    to: z.union([z.enum(['canvas', 'selection']), layerRef]).default('canvas'),
  }).optional(),
};
function withUpdates(a) {
  const { updates = [], layer, ...flat } = a;
  const props = Object.fromEntries(Object.entries(flat).filter(([k, v]) => k in layerUpdate && v !== undefined));
  const all = layer !== undefined ? [...updates, { layer, ...props }] : updates;
  if (!all.length) throw new PsError('ps_set_layers needs "updates" (array of {layer, ...}) or a single "layer" with properties.', 'invalid_arguments');
  if (layer === undefined && Object.keys(props).length) throw new PsError('ps_set_layers: top-level properties need a "layer"; otherwise put them inside "updates".', 'invalid_arguments');
  return { updates: all };
}

// Accept `layer` as shorthand for `layers: [layer]`.
function withLayers(a, tool) {
  const { layer, ...rest } = a;
  const layers = [...(rest.layers || []), ...(layer !== undefined ? [layer] : [])];
  if (!layers.length) throw new PsError(`${tool} needs "layers" (array of ids/names) or "layer".`, 'invalid_arguments');
  return { ...rest, layers };
}

const describeTable = (table) => Object.entries(table)
  .map(([k, v]) => `${k}{${Object.keys(v.shape).join(', ')}}`).join('; ');

// ---------------------------------------------------------------- tools

/** @type {Array<{name:string,title:string,description:string,shape:object,readOnly?:boolean,batchable?:boolean,op:string,prepare?:(a:any)=>any,gated?:boolean}>} */
export const TOOLS = [
  {
    name: 'ps_status', title: 'Status', op: 'status', readOnly: true, shape: {},
    description: 'Photoshop version, open documents (id, path, unsaved changes), and for the active document: size, mode, bit depth, color profile, selected layers, active selection, last 10 history states (* = current) and EXIF (camera, lens, exposure). Call first.',
  },
  {
    name: 'ps_snapshot', title: 'Layer tree', op: 'snapshot', readOnly: true,
    description: 'Layer tree of the active document, top to bottom: id, name, type (pixel/text/shape/smartObject/adjustment/solidFill/gradientFill/group), visibility, opacity, blend mode, bounds [l,t,r,b], mask/clipped/locked flags, text contents/font/size/color, adjustment kind. Use ids from here everywhere. Passing name/type/visibleOnly returns a flat filtered list with paths instead of a tree.',
    shape: {
      depth: z.number().int().min(0).max(30).default(3).describe('Group levels to expand (deeper levels are summarized as childCount)'),
      maxLayers: z.number().int().min(1).max(5000).default(200),
      root: layerRef.optional().describe('Only this group/layer and its contents'),
      name: z.string().optional().describe('Filter: name contains (case-insensitive)'),
      type: z.string().optional().describe('Filter: layer type or adjustment kind, e.g. "text", "smartObject", "curves"'),
      visibleOnly: z.boolean().optional().describe('Filter: only visible layers'),
    },
  },
  {
    name: 'ps_inspect', title: 'Inspect layers', op: 'inspect', readOnly: true,
    description: 'Full detail for specific layers: adjustment settings (exact curve points, levels, etc.), text styling (alignment, tracking, leading, paragraph box, position), smart filters on smart objects. raw: true adds the complete Action Manager descriptor.',
    shape: { layers: z.array(layerRef).min(1).max(50).optional(), layer: layerRef.optional().describe('Shorthand for one layer'), raw: z.boolean().default(false) },
    prepare: (a) => ({ ...withLayers(a, 'ps_inspect'), raw: a.raw }),
  },
  {
    name: 'ps_render', title: 'Render', op: 'render', readOnly: true,
    description: 'Look at the document: returns an image of the current composite (or one layer alone with `layer`), optionally cropped to a region at full resolution and downscaled to maxSize. Never modifies the document. Render before editing to understand the photo, and after each meaningful edit to verify it visually — layer data alone can say "success" when the pixels are wrong.',
    shape: {
      maxSize: z.number().int().min(64).max(4096).default(1024).describe('Longest side of the returned image, px'),
      crop: bounds.optional().describe('Render only this region (document px) — use to zoom into faces/details at full resolution'),
      layer: layerRef.optional().describe('Render this layer (or group) alone, everything else hidden'),
      format: z.enum(['jpg', 'png']).default('jpg').describe('png keeps transparency'),
      out: path.optional().describe('Also keep the image at this path'),
    },
    prepare: (a) => ({ ...a, path: a.out ? expand(a.out) : join(RENDER_DIR, `render-${Date.now()}.${a.format}`) }),
  },
  {
    name: 'ps_analyze', title: 'Analyze color', op: 'analyze', readOnly: true,
    description: 'Hard numbers to grade by instead of guessing from a JPEG: luminosity histogram stats (mean, median, percentiles, std dev, % clipped shadows/highlights, shadow/mid/highlight distribution, 16-bin histogram), per-channel means and clipping, an overall color-cast verdict, and exact colors at sample points (hex/RGB/HSB). Respects the active selection; `region` analyzes a rectangle instead.',
    shape: {
      region: bounds.optional().describe('Analyze only this rectangle (e.g. sky, a face)'),
      points: z.array(z.tuple([z.number(), z.number()])).max(20).optional().describe('[[x, y], ...] pixels to sample, e.g. skin, sky, a neutral gray'),
    },
  },
  {
    name: 'ps_fonts', title: 'Find fonts', op: 'fonts', readOnly: true,
    description: 'Search installed fonts. Text tools need the exact PostScript name returned here (e.g. "Helvetica-Bold").',
    shape: { query: z.string().default('').describe('Matches name, family or PostScript name'), limit: z.number().int().min(1).max(200).default(25) },
  },
  {
    name: 'ps_document', title: 'Document', op: 'document',
    description: 'Document-level operations. open {path} · create {width, height, name?, resolution?, fill?} · activate {docId} · duplicate {name?} · save {path?, format?, quality?, profile?, asCopy?, overwrite?} (psd/tiff keep layers; png/jpg export the composite converted to sRGB unless profile: "document"; files this session exported may be re-exported; without path saves in place and requires overwrite: true) · close {docId?, save?, overwrite?, discard?} (refuses to drop unsaved changes unless discard: true) · resizeImage {width and/or height, keeps aspect} · resizeCanvas {width?, height?, anchor?} · crop {bounds} · trim (transparent edges) · flatten. Acts on the active document unless docId is given.',
    shape: {
      action: z.enum(['open', 'create', 'activate', 'duplicate', 'save', 'close', 'resizeImage', 'resizeCanvas', 'crop', 'trim', 'flatten']),
      docId: z.number().int().optional().describe('Target document id from ps_status (default: active)'),
      path: path.optional(),
      width: z.number().int().min(1).max(300000).optional(),
      height: z.number().int().min(1).max(300000).optional(),
      name: z.string().optional(),
      resolution: z.number().min(1).max(10000).default(72),
      fill: z.string().optional().describe('create: white (default), transparent, black or a hex color'),
      format: z.enum(['psd', 'psb', 'tiff', 'png', 'jpg']).optional().describe('save: default from path extension'),
      quality: z.number().int().min(1).max(100).default(90).describe('save jpg quality'),
      profile: z.enum(['sRGB', 'document']).default('sRGB').describe('png/jpg export: convert to sRGB (default, what browsers and phones expect) or keep the document profile'),
      asCopy: z.boolean().default(true).describe('save psd/tiff as a copy (document stays bound to its original file)'),
      overwrite: z.boolean().default(false).describe('Allow replacing an existing file (or saving in place). Only when the user asked for it.'),
      save: z.boolean().default(false).describe('close: save changes first (needs overwrite: true)'),
      discard: z.boolean().default(false).describe('close: allow discarding unsaved changes — only when the user agreed'),
      bounds: bounds.optional(),
      anchor: z.enum(['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight']).optional(),
    },
    prepare: (a) => ({ ...a, path: a.path && expand(a.path) }),
  },
  {
    name: 'ps_create_layer', title: 'Create layer', op: 'create_layer', batchable: true,
    description: 'Create a layer: pixel (empty, or filled with color) · group (optionally wrapping `layers`) · solidFill (color) · gradientFill (stops, angle, gradientType) · rectangle / ellipse vector shapes (bounds, color, radius for rounded corners). New layers go above the selected layer unless above/below/inside/position say otherwise.',
    shape: {
      kind: z.enum(['pixel', 'group', 'solidFill', 'gradientFill', 'rectangle', 'ellipse']),
      color: color.optional(),
      bounds: bounds.optional().describe('rectangle/ellipse geometry'),
      radius: z.number().min(0).optional().describe('rectangle corner radius px'),
      stops: z.array(stop).min(2).optional().describe('gradientFill colors, location 0–100'),
      angle: z.number().min(-360).max(360).optional().describe('gradientFill angle in degrees (90 = bottom→top)'),
      gradientType: z.enum(['linear', 'radial', 'angle', 'reflected', 'diamond']).optional(),
      layers: z.array(layerRef).optional().describe('group: layers to put inside the new group'),
      ...common, ...placement,
    },
  },
  {
    name: 'ps_add_text', title: 'Add text', op: 'add_text', batchable: true,
    description: 'Add a text layer. Point text: (x, y) is the baseline start of the first line. Paragraph text: pass box {width, height} and (x, y) is the box top-left; text wraps inside it. Use \\n for line breaks. Fails loudly if the font is not installed (find names with ps_fonts).',
    shape: {
      text: z.string().min(1), x: z.number(), y: z.number(),
      size: z.number().positive().default(48).describe('px'),
      color: color.default('#000000'),
      font: z.string().optional().describe('PostScript name, e.g. "Helvetica-Bold"'),
      align: z.enum(['left', 'center', 'right', 'justify']).optional(),
      tracking: z.number().min(-1000).max(10000).optional().describe('Letter spacing in 1/1000 em'),
      leading: z.union([z.number().positive(), z.literal('auto')]).optional().describe('Line height px'),
      box: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
      ...common, ...placement,
    },
  },
  {
    name: 'ps_edit_text', title: 'Edit text', op: 'edit_text', batchable: true,
    description: 'Change an existing text layer: contents, size, font, color, alignment, tracking, leading, paragraph box, or reposition (x and y together).',
    shape: {
      layer: layerRef, text: z.string().optional(), size: z.number().positive().optional(), color: color.optional(),
      font: z.string().optional(), align: z.enum(['left', 'center', 'right', 'justify']).optional(),
      tracking: z.number().optional(), leading: z.union([z.number().positive(), z.literal('auto')]).optional(),
      box: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
      x: z.number().optional(), y: z.number().optional(),
    },
  },
  {
    name: 'ps_place_image', title: 'Place image', op: 'place_image', batchable: true,
    description: 'Place an image file (jpg/png/psd/tiff/…) as a smart object (non-destructive scaling). Optionally fit it into bounds: contain (whole image inside the box, aspect kept), cover (fills the box edge to edge with no gaps, aspect kept, overflow clipped by a layer mask — use this to fill an area) or stretch (exact box, DISTORTS the aspect ratio).',
    shape: {
      path, bounds: bounds.optional(), fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
      clipToBounds: z.boolean().default(true).describe('cover: add a layer mask that hides the overflow'),
      linked: z.boolean().default(false).describe('Link to the file instead of embedding'),
      ...common, ...placement,
    },
    prepare: (a) => ({ ...a, path: expand(a.path) }),
  },
  {
    name: 'ps_set_layers', title: 'Update layers', op: 'set_layers', batchable: true,
    description: 'Change one or many layers in one step: {updates: [{layer, ...props}]} or a single {layer, ...props}. Props: name, visible, opacity, fillOpacity, blendMode, locked, move (x/y = new top-left; dx/dy = relative), resize (width/height px, or scale %, from center; one dimension keeps aspect), rotate (degrees), align {h: left|center|right, v: top|middle|bottom, to: canvas|selection|<layer>}. Background layers are converted automatically when needed (reported in notes).',
    shape: {
      updates: z.array(z.object({ layer: layerRef, ...layerUpdate }).strict()).max(200).optional(),
      layer: layerRef.optional().describe('Shorthand: one layer, with its properties at the top level'),
      ...layerUpdate,
    },
    prepare: withUpdates,
  },
  {
    name: 'ps_layer_op', title: 'Layer structure', op: 'layer_op', batchable: true,
    description: 'Structural changes: select · delete · duplicate · group (wrap layers in a new group) · ungroup · merge (one layer = merge down) · rasterize · smartObject (convert layers to one smart object) · clip / unclip (clipping mask to the layer below) · move (with above/below/inside/position).',
    shape: {
      action: z.enum(['select', 'delete', 'duplicate', 'group', 'ungroup', 'merge', 'rasterize', 'smartObject', 'clip', 'unclip', 'move']),
      layers: z.array(layerRef).min(1).max(200).optional(),
      layer: layerRef.optional().describe('Shorthand for one layer'),
      name: z.string().optional().describe('Name for the resulting layer/group'),
      ...placement,
    },
    prepare: (a) => withLayers(a, 'ps_layer_op'),
  },
  {
    name: 'ps_adjustment', title: 'Adjustment layer', op: 'adjustment', batchable: true,
    description: `Non-destructive color/tone adjustment layers — the right tool for color grading. Without \`layer\`: creates one (above the selected layer, or above/clipTo a specific layer; an ACTIVE SELECTION BECOMES ITS MASK, e.g. ps_selection subject first to grade only the subject). With \`layer\`: replaces that adjustment's settings. Returns the settings Photoshop actually stored. Params by type: ${describeTable(ADJUSTMENT_PARAMS)}. Ranges: curves points 0–255; colorBalance triples are [cyan↔red, magenta↔green, yellow↔blue] −100..100; hueSaturation reds…magentas are per-color {hue, saturation, lightness}; light.exposure −5..5 (others −100..100); gradientMap stop location 0–100.`,
    shape: {
      type: z.enum(Object.keys(ADJUSTMENT_PARAMS)),
      params: z.record(z.string(), z.any()).default({}).describe('Settings for this type (see description)'),
      layer: layerRef.optional().describe('Existing adjustment layer to update'),
      clipTo: layerRef.optional().describe('Affect only this layer (creates a clipping mask)'),
      ...common, above: placement.above, inside: placement.inside, position: placement.position,
    },
    prepare: (a) => ({ ...a, params: strictParams(ADJUSTMENT_PARAMS, a.type, a.params, 'adjustment') }),
  },
  {
    name: 'ps_filter', title: 'Filter', op: 'filter', batchable: true,
    description: `Apply a filter to a pixel or smart-object layer. By default pixel layers are first converted to smart objects so the filter stays editable as a smart filter (smart: false = destructive). Params by type: ${describeTable(FILTER_PARAMS)}.`,
    shape: {
      layer: layerRef, type: z.enum(Object.keys(FILTER_PARAMS)),
      params: z.record(z.string(), z.any()).default({}),
      smart: z.boolean().default(true),
    },
    prepare: (a) => ({ ...a, params: strictParams(FILTER_PARAMS, a.type, a.params, 'filter') }),
  },
  {
    name: 'ps_selection', title: 'Selection', op: 'selection', batchable: true,
    description: 'Make or change the selection: all · none · invert · rect / ellipse {bounds, mode} · subject (Photoshop AI Select Subject — of `layer` if given, else all layers) · layer (select a layer\'s pixels — all of them, ignoring its mask, like Cmd-clicking the thumbnail) · feather / expand / contract {radius} · fill {layer, color, opacity} (pixel layers) · clear {layer} (delete pixels). mode: replace|add|subtract|intersect. Selections feed ps_mask and become masks of new adjustment layers. Returns selection bounds (null = nothing selected).',
    shape: {
      action: z.enum(['all', 'none', 'invert', 'rect', 'ellipse', 'subject', 'layer', 'feather', 'expand', 'contract', 'fill', 'clear']),
      bounds: bounds.optional(), mode: z.enum(['replace', 'add', 'subtract', 'intersect']).default('replace'),
      layer: layerRef.optional(), radius: z.number().min(0.1).max(1000).optional().describe('feather/expand/contract px'),
      color: color.optional(), opacity: z.number().min(0).max(100).optional(),
    },
  },
  {
    name: 'ps_mask', title: 'Layer mask', op: 'mask', batchable: true,
    description: 'Layer masks: add {from: selection (default when a selection exists) | revealAll | hideAll; replace: true to swap an existing mask} · delete · apply (bake into pixels) · invert · enable · disable. The active selection survives delete/replace.',
    shape: {
      layer: layerRef, action: z.enum(['add', 'delete', 'apply', 'invert', 'enable', 'disable']),
      from: z.enum(['selection', 'revealAll', 'hideAll']).optional(),
      replace: z.boolean().default(false).describe('add: replace an existing mask instead of failing'),
    },
  },
  {
    name: 'ps_history', title: 'History', op: 'history',
    description: 'list history states and snapshots · undo / redo {steps} · goto {index} · snapshot {name} (named restore point) · revert {name?} (back to a snapshot; default: the latest MCP checkpoint taken before the first edit). Every MCP edit (and every ps_batch) is exactly one history state, so undo 1 cleanly reverts the last tool call.',
    shape: {
      action: z.enum(['list', 'undo', 'redo', 'goto', 'snapshot', 'revert']),
      steps: z.number().int().min(1).max(500).default(1), index: z.number().int().min(0).optional(),
      name: z.string().optional().describe('snapshot / revert: snapshot name'),
    },
  },
  {
    name: 'ps_actions', title: 'Photoshop Actions', op: 'actions',
    description: 'List the user\'s recorded Photoshop Actions, or play one by set + name (runs as one undoable step). Great for reusing the user\'s own presets and macros.',
    shape: { action: z.enum(['list', 'play']), set: z.string().optional(), name: z.string().optional() },
  },
  {
    name: 'ps_batch', title: 'Batch', op: 'batch',
    description: 'Run several edits atomically as ONE history step: if any op fails, everything rolls back and the error names the failing op. Each op is {op, args} where op is one of: create_layer, add_text, edit_text, place_image, set_layers, layer_op, adjustment, filter, selection, mask — with exactly the args of the matching ps_* tool. Use for multi-step builds (a whole grade, a layout) to save round trips.',
    shape: {
      ops: z.array(z.object({ op: z.string(), args: z.record(z.string(), z.any()).default({}) })).min(1).max(100),
      label: z.string().default('MCP: batch').describe('History state name'),
    },
    prepare: (a) => ({ label: a.label, ops: a.ops.map((o, i) => prepareBatchOp(o, i)) }),
  },
  {
    name: 'ps_exec', title: 'Run ExtendScript', op: 'exec', gated: true,
    description: 'Escape hatch for anything the other tools cannot do: runs ExtendScript (ES3: no let/const/arrow functions/JSON/Array#indexOf) inside Photoshop as a function body; `return` a value to get it back as JSON. Helpers: __requireDoc(), __layer(ref) → DOM layer, __resolveId(ref), __layerInfoById(id), __flatLayers(), s()/c() for string/char IDs, __exec(event, desc), __dump(desc). Runs as one undo step with rollback on error.',
    shape: { code: z.string().min(1), label: z.string().default('MCP: script') },
    prepare: (a) => ({ ...a, tx: true }),
  },
];

// ---------------------------------------------------------------- per-tool runtime metadata

const DOC_EDITS = new Set(['resizeImage', 'resizeCanvas', 'crop', 'trim', 'flatten']);
const META = {
  ps_status: { timeoutS: 60 },
  ps_snapshot: { docScoped: true, timeoutS: 120 },
  ps_inspect: { docScoped: true, timeoutS: 120 },
  ps_render: { docScoped: true, timeoutS: 300 },
  ps_analyze: { docScoped: true, timeoutS: 300 },
  ps_fonts: { timeoutS: 60 },
  ps_document: { docScoped: 'self', mutates: (a) => DOC_EDITS.has(a.action), timeoutS: 900 },
  ps_create_layer: { docScoped: true, mutates: true, timeoutS: 120 },
  ps_add_text: { docScoped: true, mutates: true, timeoutS: 120 },
  ps_edit_text: { docScoped: true, mutates: true, timeoutS: 120 },
  ps_place_image: { docScoped: true, mutates: true, timeoutS: 300 },
  ps_set_layers: { docScoped: true, mutates: true, timeoutS: 180 },
  ps_layer_op: { docScoped: true, mutates: true, timeoutS: 180 },
  ps_adjustment: { docScoped: true, mutates: true, timeoutS: 120 },
  ps_filter: { docScoped: true, mutates: true, timeoutS: 600 },
  ps_selection: { docScoped: true, mutates: true, timeoutS: 180 },
  ps_mask: { docScoped: true, mutates: true, timeoutS: 120 },
  ps_history: { docScoped: true, timeoutS: 120 },
  ps_actions: { docScoped: (a) => a.action === 'play', mutates: (a) => a.action === 'play', timeoutS: 900 },
  ps_batch: { docScoped: true, mutates: true, timeoutS: 900 },
  ps_exec: { docScoped: true, mutates: true, timeoutS: 900 },
};

const docIdParam = z.number().int().optional().describe("Target document id (default: the session's document — the one first worked on, or last opened/created/activated)");
for (const t of TOOLS) {
  t.meta = META[t.name] || { timeoutS: 120 };
  if (t.meta.docScoped && t.meta.docScoped !== 'self') t.shape = { ...t.shape, docId: docIdParam };
}

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const BY_OP = Object.fromEntries(TOOLS.filter((t) => t.batchable).map((t) => [t.op, t]));

function prepareBatchOp(o, i) {
  const t = BY_OP[o.op] || BY_OP[String(o.op).replace(/^ps_/, '')];
  if (!t) throw new PsError(`ops[${i}]: unknown op "${o.op}". Batchable ops: ${Object.keys(BY_OP).join(', ')}.`);
  const r = z.object(t.shape).strict().safeParse(o.args ?? {});
  if (!r.success) throw new PsError(`ops[${i}] (${t.op}): ${issues(r.error, 'args')}`);
  const { docId, ...args } = r.data;   // a batch runs entirely on the batch's document
  return { op: t.op, args: t.prepare ? t.prepare(args) : args };
}

export function getTool(name) {
  return BY_NAME[name] || BY_NAME[`ps_${name}`];
}

// ---------------------------------------------------------------- sessions & checkpoints

/**
 * Per-client state. The MCP server keeps one per connection; the CLI persists `checkpointed` between runs.
 * checkpoint: 'full' (history snapshot + disk copy of unsaved work) | 'history' | 'off'
 */
export function newSession({ checkpoint = process.env.PS_MCP_CHECKPOINT || 'full', checkpointed = [], exports = [] } = {}) {
  return { docId: null, checkpoint, checkpointed: new Set(checkpointed), editsSinceDisk: new Map(), exports: new Set(exports) };
}

const pruneCheckpoints = () => pruneDir(CHECKPOINT_DIR, /\.ps[db]$/, 20, 7);
const pruneRenders = () => pruneDir(RENDER_DIR, /^render-\d+\.(jpg|png)$/, 300, 14);

async function ensureCheckpoint(session, tool, docId) {
  if (session.checkpoint === 'off') return null;
  const known = docId !== null && session.checkpointed.has(docId);
  const execNeedsDisk = tool.name === 'ps_exec' && session.checkpoint === 'full' && (docId === null || (session.editsSinceDisk.get(docId) ?? 1) > 0);
  if (known && !execNeedsDisk) return null;
  const { result } = await callOp('checkpoint', {
    dir: CHECKPOINT_DIR, history: !known, disk: session.checkpoint === 'full', skip: execNeedsDisk ? [] : [...session.checkpointed],
  }, { docId, timeoutS: 900, tool: 'checkpoint' });
  session.checkpointed.add(result.docId);
  session.editsSinceDisk.set(result.docId, 0);
  if (result.skipped) return { docId: result.docId };
  pruneCheckpoints();
  const parts = [];
  if (result.snapshot) parts.push(`history snapshot "${result.snapshot}" (ps_history revert restores it)`);
  if (result.file) parts.push(`copy of the unsaved document at ${result.file}`);
  else if (result.onDisk) parts.push(`the saved file ${result.onDisk} is unchanged on disk`);
  return { docId: result.docId, note: `Safety checkpoint before the first edit: ${parts.join('; ')}.` };
}

/**
 * Validate args, apply session document targeting and checkpoints, and run the tool.
 * @returns {Promise<{result:any, notes:string[], docId:number|null}>}
 */
export async function runTool(tool, rawArgs, { parsed = false, session = null } = {}) {
  let args = rawArgs ?? {};
  if (!parsed) {
    const r = z.object(tool.shape).strict().safeParse(args);
    if (!r.success) throw new PsError(`Invalid arguments for ${tool.name}: ${issues(r.error, 'args')}`, 'invalid_arguments');
    args = r.data;
  }
  const meta = tool.meta;
  const flag = (v) => (typeof v === 'function' ? v(args) : v);
  const scoped = flag(meta.docScoped);
  const mutates = !!flag(meta.mutates);
  const notes = [];

  // A file this session exported is ours to re-export (re-rendering after a tweak); the user's files still need overwrite.
  if (session && tool.name === 'ps_document' && args.action === 'save' && args.path && !args.overwrite && session.exports.has(expand(args.path))) {
    args = { ...args, overwrite: true };
    notes.push('Replaced the file this session exported earlier.');
  }

  let docId = null;
  if (scoped === 'self') docId = ['open', 'create'].includes(args.action) ? null : (args.docId ?? session?.docId ?? null);
  else if (scoped) docId = args.docId ?? session?.docId ?? null;

  if (mutates && existsSync(PAUSE_FILE)) throw new PsError('Edits are paused: the user pressed Pause in the Photoshop MCP app. Reads still work; ask the user to resume before editing.', 'paused');

  if (session && mutates) {
    const cp = await ensureCheckpoint(session, tool, docId);
    if (cp) {
      if (cp.note) notes.push(cp.note);
      if (session.docId === null) session.docId = cp.docId;
      if (docId === null) docId = cp.docId;
    }
  }

  const { docId: _ignored, ...opArgs } = args;
  const { result, doc } = await callOp(tool.op, tool.prepare ? tool.prepare(opArgs) : opArgs, { docId, timeoutS: meta.timeoutS, tool: tool.name });

  if (session) {
    if (tool.name === 'ps_document') {
      if (['open', 'create', 'duplicate', 'activate'].includes(args.action)) session.docId = result.id;
      else if (args.action === 'close' && result.closedId === session.docId) session.docId = null;
      else if (args.action === 'save' && result.saved && !result.inPlace) session.exports.add(result.saved);
    } else if (scoped && session.docId === null && doc !== null) session.docId = doc;
    if (mutates && doc !== null) session.editsSinceDisk.set(doc, (session.editsSinceDisk.get(doc) || 0) + 1);
  }
  if (tool.name === 'ps_render') pruneRenders();
  if (tool.name === 'ps_status') {
    result.compatibility = versionTested(result.version)
      ? { tested: true }
      : { tested: false, testedVersions: TESTED_VERSIONS, note: `Photoshop ${result.version} has not been through the test suite; tools should work but run \`npm test\` in photoshop-mcp to confirm.` };
    if (session) result.sessionDocId = session.docId;
  }
  return { result, notes, docId: doc };
}
