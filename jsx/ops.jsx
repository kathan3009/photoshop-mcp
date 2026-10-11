// Operations callable from Node. Mutations live in __impl (no transaction) and are exposed through
// __ops with a one-history-step transaction, so ps_batch can chain several __impl calls in ONE step.

var __ops = {}, __impl = {};

function __mutation(name, label, fn) {
  __impl[name] = fn;
  __ops[name] = function (a) { return __tx('MCP: ' + label, function () { return fn(a); }); };
}

function __assertEditable(l, what) {
  var locked = false;
  try { locked = l.allLocked; } catch (e) {}
  if (locked) __fail('Layer "' + l.name + '" is locked, so it cannot ' + what + '. Unlock it with ps_set_layers {layer: ' + l.id + ', locked: false} if the user agrees.');
}

function __infos(ids) { var o = []; for (var i = 0; i < ids.length; i++) o.push(__layerInfoById(ids[i])); return o; }
function __topId() { return __activeLayerIds()[0]; }
function __targetRef() { var r = new ActionReference(); r.putEnumerated(s('layer'), s('ordinal'), s('targetEnum')); return r; }
function __nullTarget() { var d = new ActionDescriptor(); d.putReference(s('null'), __targetRef()); return d; }
function __px(n) { return UnitValue(n, 'px'); }
function __b(l) { var b = l.bounds; return [b[0].as('px'), b[1].as('px'), b[2].as('px'), b[3].as('px')]; }
function __docById(id) {
  for (var i = 0; i < app.documents.length; i++) if (app.documents[i].id === id) return app.documents[i];
  __fail('No open document with id ' + id + '. Call ps_status for open documents.');
}
function __pickDoc(a) { return a.docId !== undefined ? __docById(a.docId) : __requireDoc(); }

// Move a layer relative to another: {above|below|inside: ref} or {position: 'top'|'bottom'}.
function __place(id, a) {
  if (!a) return;
  var doc = app.activeDocument;
  if (a.inside !== undefined) {
    var g = __layer(a.inside);
    if (g.typename !== 'LayerSet') __fail('"inside" target must be a group.');
    var l = __layer(id); l.move(g, ElementPlacement.INSIDE);
  } else if (a.above !== undefined) {
    var t = __layer(a.above), l2 = __layer(id); l2.move(t, ElementPlacement.PLACEBEFORE);
  } else if (a.below !== undefined) {
    var t2 = __layer(a.below), l3 = __layer(id); l3.move(t2, ElementPlacement.PLACEAFTER);
  } else if (a.position === 'top') {
    __layer(id).move(doc, ElementPlacement.PLACEATBEGINNING);
  } else if (a.position === 'bottom') {
    var l4 = __layer(id), last = doc.layers[doc.layers.length - 1];
    if (last.isBackgroundLayer) l4.move(last, ElementPlacement.PLACEBEFORE); else l4.move(doc, ElementPlacement.PLACEATEND);
  }
  __selectLayers([id], false);
}

// Where new content goes. Photoshop creates new layers INSIDE a selected group (probed on 27.11), but the
// API contract is "above the selected layer"; remember a selected group so __finishNew can lift the layer out.
function __insertCtx(a) {
  if (a.above !== undefined) { __selectLayers([__resolveId(a.above)], false); return {}; }
  if (a.inside !== undefined || a.below !== undefined || a.position || a.clipTo !== undefined) return {};
  var top = __topId();
  if (top === undefined) return {};
  return __layerInfoById(top).type === 'group' ? { group: top } : {};
}

// Apply name/opacity/blend + placement to a new layer. Returns { created, notes? }.
function __finishNew(id, a, ctx) {
  var l = __layer(id), notes = [];
  if (a.name) l.name = a.name;
  if (a.opacity !== undefined) l.opacity = a.opacity;
  if (a.blendMode) l.blendMode = __blendDom(a.blendMode);
  if (a.inside !== undefined || a.below !== undefined || a.position) __place(id, { inside: a.inside, below: a.below, position: a.position });
  else if (ctx && ctx.group !== undefined && __parentOf(id) === ctx.group) {
    var g = __layer(ctx.group), nl = __layer(id);
    nl.move(g, ElementPlacement.PLACEBEFORE);
    __selectLayers([id], false);
    notes.push('Placed above the selected group "' + g.name + '" (pass inside: ' + ctx.group + ' to put it in the group).');
  }
  var r = { created: __layerInfoById(id) };
  if (notes.length) r.notes = notes;
  return r;
}

function __saveImage(dup, path, format, quality) {
  var f = new File(path);
  if (format === 'png') { var po = new PNGSaveOptions(); po.compression = 6; dup.saveAs(f, po, true); }
  else { var jo = new JPEGSaveOptions(); jo.quality = Math.max(0, Math.min(12, Math.round(quality / 100 * 12))); jo.embedColorProfile = true; dup.saveAs(f, jo, true); }
}

// Run fn on a throwaway 8-bit RGB duplicate (flattened unless png keeps transparency; one layer soloed with
// o.solo; cropped with o.crop). Converted to sRGB unless o.profile === 'document', so previews and exports
// look the same in every viewer. The source document is never touched.
function __flatCopy(doc, o, fn) {
  var layered = o.png || (o.solo !== undefined && o.solo !== null);
  var dup = doc.duplicate('__mcp_copy', !layered);
  try {
    if (o.solo !== undefined && o.solo !== null) __soloLayer(o.solo);
    if (o.crop) dup.crop([__px(o.crop[0]), __px(o.crop[1]), __px(o.crop[2]), __px(o.crop[3])]);
    if (!o.png) dup.flatten();
    if (dup.mode !== DocumentMode.RGB) dup.changeMode(ChangeMode.RGB);
    if (dup.bitsPerChannel !== BitsPerChannelType.EIGHT) dup.bitsPerChannel = BitsPerChannelType.EIGHT;
    if (o.profile !== 'document') { try { dup.convertProfile('sRGB IEC61966-2.1', Intent.RELATIVECOLORIMETRIC, true, true); } catch (e) {} }
    return fn(dup);
  } finally {
    dup.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
  }
}

// ===================================================================== reads

__ops.status = function () {
  var o = { app: app.name, version: app.version, documents: [] };
  if (app.documents.length === 0) return o;
  var ad = app.activeDocument;
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i], path = null;
    try { path = d.fullName.fsName; } catch (e) {}
    o.documents.push({ id: d.id, name: d.name, path: path, active: d.id === ad.id, unsavedChanges: !d.saved });
  }
  var cur = __historyIndex(ad), hs = ad.historyStates, h = [], real = [];
  for (var r = 0; r < hs.length; r++) if (!hs[r].snapshot) real.push(r);
  for (var k = Math.max(0, real.length - 10); k < real.length; k++) h.push((real[k] === cur ? '* ' : '  ') + k + ' ' + hs[real[k]].name);
  var exif = {};
  try { var ex = ad.info.exif; for (var x = 0; x < ex.length; x++) if (!/^EXIF tag/.test(ex[x][0])) exif[ex[x][0]] = ex[x][1]; } catch (e) {}
  o.activeDocument = {
    id: ad.id, name: ad.name, width: ad.width.as('px'), height: ad.height.as('px'), resolution: ad.resolution,
    mode: __enumName(ad.mode), bits: __enumName(ad.bitsPerChannel), layerCount: __flatLayers().length,
    selectedLayerIds: __activeLayerIds(), selection: __selBounds(ad), history: h, exif: exif
  };
  try { if (ad.colorProfileName) o.activeDocument.colorProfile = ad.colorProfileName; } catch (e) {}
  return o;
};

__ops.snapshot = function (a) {
  var doc = __requireDoc(), out = [], byId = {}, count = 0, truncated = false;
  var flat = !!(a.name || a.type || a.visibleOnly);
  var rootId = a.root !== undefined ? __resolveId(a.root) : null, rootDepth = 0;
  __walk(function (d, path, depth, parents) {
    var id = d.getInteger(s('layerID'));
    if (id === rootId) rootDepth = depth;
    if (rootId !== null && id !== rootId && !__has(parents, rootId)) return;
    var info = __readLayerDesc(d, true);
    if (flat) {
      if (a.name && String(info.name).toLowerCase().indexOf(String(a.name).toLowerCase()) < 0) return;
      if (a.type && info.type !== a.type && info.adjustment !== a.type) return;
      if (a.visibleOnly && !info.visible) return;
      if (count >= a.maxLayers) { truncated = true; return; }
      info.path = path; out.push(info); count++;
      return;
    }
    var isRoot = rootId !== null && id === rootId;
    var parent = parents.length && !isRoot ? byId[parents[parents.length - 1]] : null;
    var relDepth = depth - rootDepth;
    if (parents.length && !isRoot && !parent) return;    // ancestor was cut off by depth/limit
    if (relDepth > a.depth || count >= a.maxLayers) {
      if (count >= a.maxLayers) truncated = true;
      if (parent) parent.childCount = (parent.childCount || 0) + 1;
      return;
    }
    count++;
    if (info.type === 'group') { info.children = []; byId[id] = info; }
    if (parent) parent.children.push(info); else out.push(info);
  });
  return {
    document: { id: doc.id, name: doc.name, width: doc.width.as('px'), height: doc.height.as('px') },
    selectedLayerIds: __activeLayerIds(),
    layers: out,
    layerCount: count,
    truncated: truncated
  };
};

__ops.inspect = function (a) {
  __requireDoc();
  var prev = __activeLayerIds(), out = [];
  try {
    for (var i = 0; i < a.layers.length; i++) {
      var id = __resolveId(a.layers[i]), d = executeActionGet(__layerRefById(id)), info = __readLayerDesc(d, true);
      if (info.type === 'adjustment' && d.hasKey(s('adjustment'))) {
        try { info.settings = __dump(d.getList(s('adjustment')).getObjectValue(0)); } catch (e) {}
      }
      if (info.type === 'text') {
        var ti = __layer(id).textItem, t = info.text;
        function tryGet(k, f) { try { t[k] = f(); } catch (e) {} }
        tryGet('kind', function () { return ti.kind === TextType.PARAGRAPHTEXT ? 'paragraph' : 'point'; });
        tryGet('align', function () { return __enumName(ti.justification).toLowerCase(); });
        tryGet('tracking', function () { return ti.tracking; });
        tryGet('leading', function () { return ti.useAutoLeading ? 'auto' : ti.leading.as('px'); });
        tryGet('position', function () { return [ti.position[0].as('px'), ti.position[1].as('px')]; });
        if (t.kind === 'paragraph') {
          var k = __typeScale(app.activeDocument);
          tryGet('box', function () { return { width: __round(ti.width.as('px') / k, 1), height: __round(ti.height.as('px') / k, 1) }; });
        }
      }
      if (info.type === 'smartObject' && d.hasKey(s('smartObject'))) {
        try {
          var so = d.getObjectValue(s('smartObject'));
          if (so.hasKey(s('filterFX'))) {
            var fx = so.getList(s('filterFX')), names = [];
            for (var f = 0; f < fx.count; f++) names.push(fx.getObjectValue(f).getString(s('name')));
            info.smartFilters = names;
          }
        } catch (e) {}
      }
      if (a.raw) info.raw = __dump(d);
      out.push(info);
    }
  } finally {
    if (prev.length) try { __selectLayers(prev, false); } catch (e) {}
  }
  return out;
};

// Composite the document (or one layer) into a downscaled sRGB image file. Never modifies the source document.
__ops.render = function (a) {
  var doc = __requireDoc(), soloId = a.layer !== undefined ? __resolveId(a.layer) : null;
  return __flatCopy(doc, { solo: soloId, png: a.format === 'png', crop: a.crop }, function (dup) {
    var w = dup.width.as('px'), h = dup.height.as('px'), k = Math.min(1, a.maxSize / Math.max(w, h));
    if (k < 1) dup.resizeImage(__px(Math.max(1, Math.round(w * k))), __px(Math.max(1, Math.round(h * k))), undefined, ResampleMethod.BICUBIC);
    __saveImage(dup, a.path, a.format, 75);
    return { path: a.path, width: dup.width.as('px'), height: dup.height.as('px'), scale: __round(k, 4), crop: a.crop || null, layer: soloId };
  });
};

function __histStats(h) {
  var n = 0, sum = 0, i;
  for (i = 0; i < 256; i++) { n += h[i]; sum += i * h[i]; }
  if (!n) return null;
  var mean = sum / n, varsum = 0, acc = 0, pct = { p1: null, p5: null, p50: null, p95: null, p99: null };
  var marks = [[0.01, 'p1'], [0.05, 'p5'], [0.5, 'p50'], [0.95, 'p95'], [0.99, 'p99']], m = 0;
  for (i = 0; i < 256; i++) {
    varsum += h[i] * (i - mean) * (i - mean);
    acc += h[i];
    while (m < marks.length && acc / n >= marks[m][0]) { pct[marks[m][1]] = i; m++; }
  }
  var lo = 0, hi = 0, sh = 0, mid = 0, hl = 0;
  for (i = 0; i < 256; i++) {
    if (i <= 2) lo += h[i];
    if (i >= 253) hi += h[i];
    if (i < 85) sh += h[i]; else if (i < 170) mid += h[i]; else hl += h[i];
  }
  return {
    mean: __round(mean, 1), stdDev: __round(Math.sqrt(varsum / n), 1), median: pct.p50,
    p1: pct.p1, p5: pct.p5, p95: pct.p95, p99: pct.p99,
    clippedShadowsPct: __round(100 * lo / n, 2), clippedHighlightsPct: __round(100 * hi / n, 2),
    tonesPct: { shadows: __round(100 * sh / n, 1), midtones: __round(100 * mid / n, 1), highlights: __round(100 * hl / n, 1) }
  };
}
function __bins(h, k) {
  var out = [], per = 256 / k, n = 0, i;
  for (i = 0; i < 256; i++) n += h[i];
  for (var b = 0; b < k; b++) { var t = 0; for (i = b * per; i < (b + 1) * per; i++) t += h[i]; out.push(__round(100 * t / n, 1)); }
  return out;
}

// Runs on a temporary merged duplicate: samplers and selections would otherwise add history states and
// mark the user's document as modified (found on a real PSD), even though no pixels change.
__ops.analyze = function (a) {
  var doc = __requireDoc(), activeSel = __selBounds(doc), region = a.region || activeSel, out = {};
  var dup = doc.duplicate('__mcp_analyze', true);
  try {
    if (region) dup.selection.select([[region[0], region[1]], [region[2], region[1]], [region[2], region[3]], [region[0], region[3]]]);
    var lum;
    try { lum = dup.histogram; } catch (e) { lum = dup.channels[0].histogram; }   // Grayscale has no composite luminosity histogram
    out.luminosity = __histStats(lum);
    out.luminosity.histogram16 = __bins(lum, 16);
    var comp = { RGB: ['red', 'green', 'blue'], CMYK: ['cyan', 'magenta', 'yellow', 'black'], LAB: ['lightness', 'a', 'b'], GRAYSCALE: ['gray'] }[__enumName(dup.mode)] || [];
    var means = {};
    out.mode = __enumName(dup.mode);
    if (comp.length) out.channels = {};
    for (var i = 0; i < comp.length; i++) {
      var st = __histStats(dup.channels[i].histogram);
      if (!st) continue;
      out.channels[comp[i]] = { mean: st.mean, p5: st.p5, p95: st.p95, clippedHighlightsPct: st.clippedHighlightsPct, clippedShadowsPct: st.clippedShadowsPct };
      means[comp[i]] = st.mean;
    }
    if (dup.mode === DocumentMode.RGB) {
      var warm = means.red - means.blue, tint = means.green - (means.red + means.blue) / 2, cast = [];
      if (warm > 8) cast.push('warm (red > blue by ' + __round(warm, 1) + ')'); else if (warm < -8) cast.push('cool (blue > red by ' + __round(-warm, 1) + ')');
      if (tint > 6) cast.push('green tint'); else if (tint < -6) cast.push('magenta tint');
      out.colorCast = cast.length ? cast.join(', ') : 'neutral';
    }
    if (region) dup.selection.deselect();
    if (a.points && a.points.length) {
      out.samples = [];
      for (var p = 0; p < a.points.length; p++) {
        var cs = dup.colorSamplers.add([__px(a.points[p][0]), __px(a.points[p][1])]);
        var c = cs.color.rgb, hsb = cs.color.hsb;
        out.samples.push({ at: a.points[p], hex: __toHex(c.red, c.green, c.blue), rgb: [Math.round(c.red), Math.round(c.green), Math.round(c.blue)], hsb: [Math.round(hsb.hue), Math.round(hsb.saturation), Math.round(hsb.brightness)] });
      }
    }
  } finally {
    dup.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
  }
  // (if/else on purpose: ExtendScript mis-parses unparenthesized nested ternaries — probed on 27.11)
  if (a.region) out.region = { bounds: a.region, source: 'region' };
  else if (activeSel) out.region = { bounds: activeSel, source: 'selection', note: 'analyzed the bounding box of the active selection' };
  else out.region = { bounds: [0, 0, doc.width.as('px'), doc.height.as('px')], source: 'whole image' };
  return out;
};

__ops.fonts = function (a) {
  var f = app.fonts, q = String(a.query || '').toLowerCase(), hits = [];
  for (var i = 0; i < f.length && hits.length < a.limit; i++) {
    var x = f[i];
    if (!q || (x.name + ' ' + x.postScriptName + ' ' + x.family).toLowerCase().indexOf(q) >= 0) hits.push({ postScriptName: x.postScriptName, family: x.family, style: x.style });
  }
  return { total: f.length, matches: hits };
};

function __actionSets() {
  var sets = [];
  for (var i = 1; ; i++) {
    var r = new ActionReference(); r.putIndex(s('actionSet'), i);
    var d; try { d = executeActionGet(r); } catch (e) { break; }
    var n = d.hasKey(s('numberOfChildren')) ? d.getInteger(s('numberOfChildren')) : 0, acts = [];
    for (var j = 1; j <= n; j++) { var ar = new ActionReference(); ar.putIndex(s('action'), j); ar.putIndex(s('actionSet'), i); acts.push(executeActionGet(ar).getString(s('name'))); }
    sets.push({ set: d.getString(s('name')), actions: acts });
  }
  return sets;
}

__ops.actions = function (a) {
  if (a.action === 'list') return __actionSets();
  if (!a.set || !a.name) __fail('play needs both "set" and "name". Use action "list" to see them.');
  function play() {
    var d = new ActionDescriptor(), r = new ActionReference();
    r.putName(s('action'), a.name); r.putName(s('actionSet'), a.set);
    d.putReference(s('null'), r);
    __exec('play', d);
    return app.documents.length ? { activeDocument: app.activeDocument.name, selectedLayers: __infos(__activeLayerIds()) } : {};
  }
  return app.documents.length ? __tx('MCP: action ' + a.name, play) : play();
};

// ===================================================================== documents

function __docSummary(d) {
  var path = null, profile = null;
  try { path = d.fullName.fsName; } catch (e) {}
  try { profile = d.colorProfileName; } catch (e2) {}
  return { id: d.id, name: d.name, path: path, width: d.width.as('px'), height: d.height.as('px'), resolution: d.resolution, mode: __enumName(d.mode), bits: __enumName(d.bitsPerChannel), profile: profile };
}

__ops.document = function (a) {
  var act = a.action;
  if (act === 'open') {
    var f = new File(a.path);
    if (!f.exists) __fail('File not found: ' + a.path);
    return __docSummary(app.open(f));
  }
  if (act === 'create') {
    var nd = app.documents.add(__px(a.width), __px(a.height), a.resolution, a.name, NewDocumentMode.RGB, a.fill === 'transparent' ? DocumentFill.TRANSPARENT : DocumentFill.WHITE);
    if (a.fill && a.fill !== 'white' && a.fill !== 'transparent') { nd.selection.selectAll(); nd.selection.fill(__solid(a.fill === 'black' ? '#000000' : a.fill)); nd.selection.deselect(); }
    return __docSummary(nd);
  }
  var doc = __pickDoc(a);
  if (act === 'activate') { app.activeDocument = doc; return __docSummary(doc); }
  if (act === 'save') {
    var inPlace = !a.path;
    if (inPlace) {
      var hasFile = true; try { doc.fullName; } catch (e) { hasFile = false; }
      if (!hasFile) __fail('This document has never been saved. Pass a "path" to save it.');
      if (!a.overwrite) __fail('Saving in place overwrites ' + doc.fullName.fsName + '. Pass overwrite: true if the user asked for that, or pass a new "path" to save a copy.');
      doc.save();
      return { saved: doc.fullName.fsName, inPlace: true };
    }
    var out = new File(a.path);
    if (out.exists && !a.overwrite) __fail('File exists: ' + a.path + '. Pass overwrite: true to replace it.');
    var fmt = a.format || (String(a.path).match(/\.([a-z0-9]+)$/i) || [])[1];
    fmt = String(fmt || 'psd').toLowerCase();
    if (fmt === 'jpeg') fmt = 'jpg';
    if (fmt === 'tif') fmt = 'tiff';
    if (fmt === 'psd' || fmt === 'psb') {
      var ps = new PhotoshopSaveOptions(); ps.layers = true; ps.embedColorProfile = true; ps.maximizeCompatibility = true;
      doc.saveAs(out, ps, a.asCopy !== false);
    } else if (fmt === 'tiff') {
      var to = new TiffSaveOptions(); to.layers = true; to.embedColorProfile = true; to.imageCompression = TIFFEncoding.TIFFLZW;
      doc.saveAs(out, to, a.asCopy !== false);
    } else if (fmt === 'png' || fmt === 'jpg') {
      var profile = __flatCopy(doc, { png: fmt === 'png', profile: a.profile }, function (dup) { __saveImage(dup, out.fsName, fmt, a.quality); return dup.colorProfileName; });
      return { saved: out.fsName, format: fmt, bytes: new File(out.fsName).length, profile: profile };
    } else __fail('Unsupported format "' + fmt + '". Use psd, tiff, png or jpg.');
    return { saved: out.fsName, format: fmt, bytes: new File(out.fsName).length };
  }
  if (act === 'close') {
    var closedId = doc.id;
    if (!doc.saved && !a.save && !a.discard) __fail('"' + doc.name + '" has unsaved changes. Pass discard: true to close without saving (only if the user agreed), or save it first.');
    if (a.save) {
      if (!a.overwrite) __fail('close with save: true overwrites the file on disk. Pass overwrite: true if the user asked for that.');
      doc.close(SaveOptions.SAVECHANGES);
    } else doc.close(SaveOptions.DONOTSAVECHANGES);
    return { closed: true, closedId: closedId, remaining: app.documents.length };
  }
  if (act === 'duplicate') return __docSummary(doc.duplicate(a.name || (doc.name + ' copy'), false));
  app.activeDocument = doc;
  return __tx('MCP: ' + act, function () {
    if (act === 'resizeImage') {
      var w = doc.width.as('px'), h = doc.height.as('px'), nw = a.width, nh = a.height;
      if (!nw && !nh) __fail('resizeImage needs width and/or height.');
      if (!nw) nw = Math.round(w * nh / h);
      if (!nh) nh = Math.round(h * nw / w);
      doc.resizeImage(__px(nw), __px(nh), undefined, ResampleMethod.BICUBIC);
    } else if (act === 'resizeCanvas') {
      var anchors = { topLeft: 'TOPLEFT', top: 'TOPCENTER', topRight: 'TOPRIGHT', left: 'MIDDLELEFT', center: 'MIDDLECENTER', right: 'MIDDLERIGHT', bottomLeft: 'BOTTOMLEFT', bottom: 'BOTTOMCENTER', bottomRight: 'BOTTOMRIGHT' };
      doc.resizeCanvas(__px(a.width || doc.width.as('px')), __px(a.height || doc.height.as('px')), AnchorPosition[anchors[a.anchor || 'center']]);
    } else if (act === 'crop') {
      if (!a.bounds) __fail('crop needs bounds [left, top, right, bottom].');
      doc.crop([__px(a.bounds[0]), __px(a.bounds[1]), __px(a.bounds[2]), __px(a.bounds[3])]);
    } else if (act === 'trim') {
      doc.trim(TrimType.TRANSPARENT, true, true, true, true);
    } else if (act === 'flatten') {
      doc.flatten();
    } else __fail('Unknown document action "' + act + '".');
    return __docSummary(doc);
  });
};

// ===================================================================== layers

__mutation('create_layer', 'create layer', function (a) {
  var doc = __requireDoc(), ctx = __insertCtx(a);
  var k = a.kind, id;
  if (k === 'pixel') {
    id = __makeLayer();
    if (a.color) { doc.selection.selectAll(); doc.selection.fill(__solid(a.color)); doc.selection.deselect(); }
  } else if (k === 'group') {
    id = __makeGroup(a.name, __resolveIds(a.layers));
    if (a.layers && a.layers.length) ctx = {};   // wrapping existing layers: the group belongs where they were
  } else {
    var md = new ActionDescriptor(), mr = new ActionReference();
    mr.putClass(s('contentLayer')); md.putReference(s('null'), mr);
    var ld = new ActionDescriptor();
    if (k === 'gradientFill') {
      var gd = new ActionDescriptor();
      gd.putUnitDouble(s('angle'), s('angleUnit'), a.angle !== undefined ? a.angle : 90);
      gd.putEnumerated(s('type'), s('gradientType'), s(a.gradientType || 'linear'));
      gd.putObject(s('gradient'), s('gradientClassEvent'), __gradientDesc(a.stops || [{ color: '#000000', location: 0 }, { color: '#ffffff', location: 100 }]));
      ld.putObject(s('type'), s('gradientLayer'), gd);
    } else {
      var cd = new ActionDescriptor(); cd.putObject(s('color'), s('RGBColor'), __rgbDesc(a.color || '#808080'));
      ld.putObject(s('type'), s('solidColorLayer'), cd);
    }
    if (k === 'rectangle' || k === 'ellipse') {
      if (!a.bounds) __fail(k + ' needs bounds [left, top, right, bottom].');
      var sh = new ActionDescriptor(), keys = ['left', 'top', 'right', 'bottom'];
      for (var b = 0; b < 4; b++) sh.putUnitDouble(s(keys[b]), s('pixelsUnit'), a.bounds[b]);
      if (k === 'rectangle' && a.radius) {
        var cs = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
        for (var q = 0; q < 4; q++) sh.putUnitDouble(s(cs[q]), s('pixelsUnit'), a.radius);
      }
      ld.putObject(s('shape'), s(k), sh);
    }
    md.putObject(s('using'), s('contentLayer'), ld);
    __exec('make', md);
    id = __topId();
  }
  return __finishNew(id, a, ctx);
});

function __gradientDesc(stops) {
  var g = new ActionDescriptor();
  g.putString(s('name'), 'Custom');
  g.putEnumerated(s('gradientForm'), s('gradientForm'), s('customStops'));
  g.putDouble(s('interfaceIconFrameDimmed'), 4096);
  var cl = new ActionList(), tl = new ActionList();
  for (var i = 0; i < stops.length; i++) {
    var loc = Math.round((stops[i].location !== undefined ? stops[i].location : (100 * i / Math.max(1, stops.length - 1))) / 100 * 4096);
    var st = new ActionDescriptor();
    st.putObject(s('color'), s('RGBColor'), __rgbDesc(stops[i].color));
    st.putEnumerated(s('type'), s('colorStopType'), s('userStop'));
    st.putInteger(s('location'), loc); st.putInteger(s('midpoint'), 50);
    cl.putObject(s('colorStop'), st);
    var tt = new ActionDescriptor();
    tt.putUnitDouble(s('opacity'), s('percentUnit'), stops[i].opacity !== undefined ? stops[i].opacity : 100);
    tt.putInteger(s('location'), loc); tt.putInteger(s('midpoint'), 50);
    tl.putObject(s('transferSpec'), tt);
  }
  g.putList(s('colors'), cl);
  g.putList(s('transparency'), tl);
  return g;
}

function __applyTextProps(l, a) {
  var t = l.textItem, k = __typeScale(app.activeDocument);
  if (a.box) {
    t.kind = TextType.PARAGRAPHTEXT;
    t.width = __px(a.box.width * k); t.height = __px(a.box.height * k);
  }
  if (a.text !== undefined) t.contents = String(a.text).replace(/\n/g, '\r');
  if (a.size !== undefined) t.size = __px(a.size * k);
  if (a.font) t.font = a.font;
  if (a.color) t.color = __solid(a.color);
  if (a.align) t.justification = Justification[{ left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'FULLYJUSTIFIED' }[a.align]];
  if (a.tracking !== undefined) t.tracking = a.tracking;
  if (a.leading !== undefined) { if (a.leading === 'auto') t.useAutoLeading = true; else { t.useAutoLeading = false; t.leading = __px(a.leading); } }
  if (a.x !== undefined && a.y !== undefined) t.position = [__px(a.x), __px(a.y)];
  if (a.font) {
    // Photoshop silently falls back when a font is missing; report it instead of pretending.
    var got = t.font;
    if (got !== a.font) __fail('Font "' + a.font + '" is not available (Photoshop used "' + got + '"). Use ps_fonts to find the exact PostScript name.');
  }
}

__mutation('add_text', 'add text', function (a) {
  var doc = __requireDoc(), ctx = __insertCtx(a);
  __makeLayer();
  var l = doc.activeLayer;
  l.kind = LayerKind.TEXT;
  l.textItem.color = __solid(a.color || '#000000');
  __applyTextProps(l, a);
  if (!a.name) l.name = String(a.text).split('\n')[0].substr(0, 40);
  return __finishNew(l.id, a, ctx);
});

__mutation('edit_text', 'edit text', function (a) {
  var l = __layer(a.layer);
  if (l.kind !== LayerKind.TEXT) __fail('Layer "' + l.name + '" is not a text layer.');
  __assertEditable(l, 'be edited');
  __applyTextProps(l, a);
  return { changed: [__layerInfoById(l.id)] };
});

__mutation('place_image', 'place image', function (a) {
  var doc = __requireDoc();
  var f = new File(a.path);
  if (!f.exists) __fail('File not found: ' + a.path);
  var ctx = __insertCtx(a), masked = false;
  var d = new ActionDescriptor();
  d.putPath(s('null'), f);
  if (a.linked) d.putBoolean(s('linked'), true);
  d.putEnumerated(s('freeTransformCenterState'), s('quadCenterState'), s('QCSAverage'));
  __exec('placeEvent', d);
  var l = doc.activeLayer, id = l.id;
  if (a.bounds) {
    var mode = a.fit || 'contain', bx = a.bounds, tw = bx[2] - bx[0], th = bx[3] - bx[1];
    // Photoshop's transforms land slightly off the requested scale (rounding, ppi differences between the file
    // and the document), so measure after each pass and correct until the box is really covered/filled.
    for (var pass = 0; pass < 4; pass++) {
      var b = __b(l), w = b[2] - b[0], h = b[3] - b[1];
      var sx = tw / w, sy = th / h;
      if (mode === 'contain') sx = sy = Math.min(sx, sy);
      else if (mode === 'cover') sx = sy = Math.max(sx, sy) * (1 + 1 / Math.min(tw, th));
      else { sx *= 1 + 0.5 / tw; sy *= 1 + 0.5 / th; }
      if (Math.abs(sx - 1) > 0.0004 || Math.abs(sy - 1) > 0.0004) l.resize(sx * 100, sy * 100, AnchorPosition.MIDDLECENTER);
      b = __b(l);
      var nw = b[2] - b[0], nh = b[3] - b[1];
      var dx = bx[0] + (tw - nw) / 2 - b[0], dy = bx[1] + (th - nh) / 2 - b[1];
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) l.translate(__px(dx), __px(dy));
      b = __b(l);
      var ok = mode === 'cover' ? (b[0] <= bx[0] && b[1] <= bx[1] && b[2] >= bx[2] && b[3] >= bx[3])
        : mode === 'stretch' ? (Math.abs(b[0] - bx[0]) <= 1 && Math.abs(b[1] - bx[1]) <= 1 && Math.abs(b[2] - bx[2]) <= 1 && Math.abs(b[3] - bx[3]) <= 1)
        : (b[0] >= bx[0] - 1 && b[1] >= bx[1] - 1 && b[2] <= bx[2] + 1 && b[3] <= bx[3] + 1 && (Math.abs(nw - tw) <= 1 || Math.abs(nh - th) <= 1));
      if (ok) break;
    }
    if (mode === 'cover' && a.clipToBounds !== false) {
      // Mask the overflow so "cover" really stays inside the box.
      doc.selection.select([[a.bounds[0], a.bounds[1]], [a.bounds[2], a.bounds[1]], [a.bounds[2], a.bounds[3]], [a.bounds[0], a.bounds[3]]]);
      __maskAdd('revealSelection');
      doc.selection.deselect();
      __targetComposite();
      masked = true;
    }
  }
  var r = __finishNew(id, a, ctx);
  if (masked) (r.notes = r.notes || []).push('cover fit added a layer mask that clips the image to the box (clipToBounds: false to skip; ps_mask replace: true to swap it).');
  return r;
});

function __alignDelta(b, al) {
  var doc = app.activeDocument, t;
  if (!al.to || al.to === 'canvas') t = [0, 0, doc.width.as('px'), doc.height.as('px')];
  else if (al.to === 'selection') { t = __selBounds(doc); if (!t) __fail('align to "selection" needs an active selection.'); }
  else t = __layerInfoById(__resolveId(al.to)).bounds;
  var dx = 0, dy = 0;
  if (al.h === 'left') dx = t[0] - b[0];
  if (al.h === 'center') dx = Math.round((t[0] + t[2]) / 2 - (b[0] + b[2]) / 2);
  if (al.h === 'right') dx = t[2] - b[2];
  if (al.v === 'top') dy = t[1] - b[1];
  if (al.v === 'middle') dy = Math.round((t[1] + t[3]) / 2 - (b[1] + b[3]) / 2);
  if (al.v === 'bottom') dy = t[3] - b[3];
  return [dx, dy];
}

__mutation('set_layers', 'update layers', function (a) {
  var changed = [], notes = [];
  for (var i = 0; i < a.updates.length; i++) {
    var u = a.updates[i], l = __layer(u.layer), id = l.id;
    var onlyLock = true;
    for (var key in u) if (u.hasOwnProperty(key) && key !== 'layer' && key !== 'locked' && u[key] !== undefined) onlyLock = false;
    if (u.locked === false) l.allLocked = false;
    else if (!onlyLock) __assertEditable(l, 'be changed');
    var needsUnlock = u.opacity !== undefined || u.fillOpacity !== undefined || u.blendMode || u.dx || u.dy || u.x !== undefined || u.y !== undefined || u.width || u.height || u.scale || u.rotate || u.align;
    if (l.typename === 'ArtLayer' && l.isBackgroundLayer && needsUnlock) {
      l.isBackgroundLayer = false;
      l = app.activeDocument.activeLayer; id = l.id;   // converting the background assigns a new layer id
      notes.push('Converted background layer "' + l.name + '" to a normal layer so it could be changed.');
    }
    if (u.name !== undefined) l.name = u.name;
    if (u.visible !== undefined) l.visible = u.visible;
    if (u.opacity !== undefined) l.opacity = u.opacity;
    if (u.fillOpacity !== undefined) l.fillOpacity = u.fillOpacity;
    if (u.blendMode) l.blendMode = __blendDom(u.blendMode);
    if (u.scale || u.width || u.height) {
      var b0 = __b(l), w = b0[2] - b0[0], h = b0[3] - b0[1];
      if (!w || !h) __fail('Layer "' + l.name + '" is empty; nothing to resize.');
      var sx = u.scale || (u.width ? 100 * u.width / w : null), sy = u.scale || (u.height ? 100 * u.height / h : null);
      if (sx === null) sx = sy; if (sy === null) sy = sx;
      l.resize(sx, sy, AnchorPosition.MIDDLECENTER);
    }
    if (u.rotate) l.rotate(u.rotate, AnchorPosition.MIDDLECENTER);
    if (u.x !== undefined || u.y !== undefined) {
      var b1 = __b(l);
      l.translate(__px(u.x !== undefined ? u.x - b1[0] : 0), __px(u.y !== undefined ? u.y - b1[1] : 0));
    }
    if (u.dx || u.dy) l.translate(__px(u.dx || 0), __px(u.dy || 0));
    if (u.align) { var dd = __alignDelta(__b(l), u.align); if (dd[0] || dd[1]) l.translate(__px(dd[0]), __px(dd[1])); }
    if (u.locked !== undefined) l.allLocked = u.locked;
    changed.push(__layerInfoById(id));
  }
  var r = { changed: changed };
  if (notes.length) r.notes = notes;
  return r;
});

__mutation('layer_op', 'layer op', function (a) {
  var doc = __requireDoc(), act = a.action, ids = __resolveIds(a.layers), i;
  if (!ids.length && act !== 'select') __fail('"' + act + '" needs at least one layer in "layers".');
  function each(fn) { var out = []; for (var j = 0; j < ids.length; j++) { __selectLayers([ids[j]], false); var r = fn(ids[j]); if (r !== undefined) out.push(r); } return out; }
  if (act === 'select') { __selectLayers(ids, false); return { selected: __infos(ids) }; }
  if (act === 'delete') {
    var names = []; for (i = 0; i < ids.length; i++) names.push(__layerInfoById(ids[i]).name);
    __selectLayers(ids, false); __exec('delete', __nullTarget());
    return { deleted: names };
  }
  if (act === 'duplicate') {
    return { created: each(function () { var d = __nullTarget(); if (a.name) d.putString(s('name'), a.name); __exec('duplicate', d); return __layerInfoById(__topId()); }) };
  }
  if (act === 'group') return { created: [__layerInfoById(__makeGroup(a.name, ids))] };
  if (act === 'ungroup') { each(function () { __exec('ungroupLayersEvent', __nullTarget()); }); return { selected: __infos(__activeLayerIds()) }; }
  if (act === 'merge') {
    __selectLayers(ids, false);
    __exec('mergeLayersNew');   // one layer selected = merge down
    var mid = __topId(); if (a.name) __layer(mid).name = a.name;
    return { created: [__layerInfoById(mid)] };
  }
  if (act === 'rasterize') return { changed: each(function (id) { __exec('rasterizeLayer', __nullTarget()); return __layerInfoById(id); }) };
  if (act === 'smartObject') {
    __selectLayers(ids, false); __exec('newPlacedLayer');
    var sid = __topId(); if (a.name) __layer(sid).name = a.name;
    return { created: [__layerInfoById(sid)] };
  }
  if (act === 'clip') return { changed: each(function (id) { if (!(__layerInfoById(id).clipped)) __exec('groupEvent', __nullTarget()); return __layerInfoById(id); }) };
  if (act === 'unclip') return { changed: each(function (id) { if (__layerInfoById(id).clipped) __exec('ungroup', __nullTarget()); return __layerInfoById(id); }) };
  if (act === 'move') {
    if (a.above === undefined && a.below === undefined && a.inside === undefined && !a.position) __fail('move needs one of: above, below, inside, position.');
    // Keep relative order: place the bottom-most first when stacking above, top-most first otherwise.
    var order = ids.slice(0);
    if (a.above !== undefined || a.inside !== undefined || a.position === 'top') order.reverse();
    for (i = 0; i < order.length; i++) __place(order[i], a);
    return { changed: __infos(ids) };
  }
  __fail('Unknown layer action "' + act + '".');
});

// ===================================================================== adjustments

function __chanRef(name) { var r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s(name)); return r; }
function __intList(arr) { var l = new ActionList(); for (var i = 0; i < arr.length; i++) l.putInteger(Math.round(arr[i])); return l; }
// Hue/Saturation color ranges: [localRange, beginRamp, beginSustain, endSustain, endRamp] in degrees.
var __HS_RANGES = { reds: [1, 315, 345, 15, 45], yellows: [2, 15, 45, 75, 105], greens: [3, 75, 105, 135, 165], cyans: [4, 135, 165, 195, 225], blues: [5, 195, 225, 255, 285], magentas: [6, 255, 285, 315, 345] };

var __ADJ = {
  curves: {
    cls: 'curves', preset: true,
    build: function (p) {
      var d = new ActionDescriptor(), l = new ActionList(), map = { rgb: 'composite', red: 'red', green: 'green', blue: 'blue' }, n = 0;
      for (var ch in map) {
        if (!p[ch]) continue;
        var a = new ActionDescriptor(), pts = new ActionList(), xy = p[ch];
        if (xy.length < 2) __fail('curves.' + ch + ' needs at least 2 points [[in,out],...].');
        for (var i = 0; i < xy.length; i++) { var pt = new ActionDescriptor(); pt.putDouble(s('horizontal'), xy[i][0]); pt.putDouble(s('vertical'), xy[i][1]); pts.putObject(s('paint'), pt); }
        a.putReference(s('channel'), __chanRef(map[ch])); a.putList(s('curve'), pts);
        l.putObject(s('curvesAdjustment'), a); n++;
      }
      if (!n) __fail('curves needs at least one of rgb/red/green/blue point lists.');
      d.putList(s('adjustment'), l); return d;
    }
  },
  levels: {
    cls: 'levels', preset: true,
    build: function (p) {
      var d = new ActionDescriptor(), l = new ActionList(), chans = [['rgb', 'composite', p], ['red', 'red', p.red], ['green', 'green', p.green], ['blue', 'blue', p.blue]];
      for (var i = 0; i < chans.length; i++) {
        var q = chans[i][2];
        if (!q || (i === 0 && q.inputBlack === undefined && q.inputWhite === undefined && q.gamma === undefined && q.outputBlack === undefined && q.outputWhite === undefined)) continue;
        var a = new ActionDescriptor();
        a.putReference(s('channel'), __chanRef(chans[i][1]));
        a.putList(s('input'), __intList([q.inputBlack || 0, q.inputWhite === undefined ? 255 : q.inputWhite]));
        a.putDouble(s('gamma'), q.gamma === undefined ? 1 : q.gamma);
        a.putList(s('output'), __intList([q.outputBlack || 0, q.outputWhite === undefined ? 255 : q.outputWhite]));
        l.putObject(s('levelsAdjustment'), a);
      }
      d.putList(s('adjustment'), l); return d;
    }
  },
  brightnessContrast: {
    cls: 'brightnessEvent',
    build: function (p) {
      var d = new ActionDescriptor();
      d.putEnumerated(s('brightnessMode'), s('brightnessMode'), s('brightnessModeModern'));
      d.putInteger(s('brightness'), p.brightness || 0); d.putInteger(s('center'), p.contrast || 0);
      return d;
    }
  },
  // PS 27.x "Light" adjustment. Setting these keys without brightnessModeLight is silently ignored (probed).
  light: {
    cls: 'brightnessEvent',
    build: function (p) {
      var d = new ActionDescriptor();
      d.putEnumerated(s('brightnessMode'), s('brightnessMode'), s('brightnessModeLight'));
      d.putInteger(s('brightnessExposure'), p.exposure || 0); d.putInteger(s('center'), p.contrast || 0);
      d.putInteger(s('brightnessHighlights'), p.highlights || 0); d.putInteger(s('brightnessShadows'), p.shadows || 0);
      d.putInteger(s('brightnessWhites'), p.whites || 0); d.putInteger(s('brightnessBlacks'), p.blacks || 0);
      return d;
    }
  },
  hueSaturation: {
    cls: 'hueSaturation', preset: true,
    build: function (p) {
      var d = new ActionDescriptor(), l = new ActionList();
      function item(q, range) {
        var a = new ActionDescriptor();
        if (range) {   // Photoshop's default hue ramps for the six color ranges (probed on 27.11)
          a.putInteger(s('localRange'), range[0]); a.putInteger(s('beginRamp'), range[1]); a.putInteger(s('beginSustain'), range[2]);
          a.putInteger(s('endSustain'), range[3]); a.putInteger(s('endRamp'), range[4]);
        }
        a.putInteger(s('hue'), q.hue || 0); a.putInteger(s('saturation'), q.saturation || 0); a.putInteger(s('lightness'), q.lightness || 0);
        l.putObject(s('hueSatAdjustmentV2'), a);
      }
      item(p, null);
      for (var name in __HS_RANGES) if (p[name]) item(p[name], __HS_RANGES[name]);
      d.putBoolean(s('colorize'), !!p.colorize); d.putList(s('adjustment'), l);
      return d;
    }
  },
  colorBalance: {
    cls: 'colorBalance',
    build: function (p) {
      var d = new ActionDescriptor(), z = [0, 0, 0];
      d.putList(s('shadowLevels'), __intList(p.shadows || z)); d.putList(s('midtoneLevels'), __intList(p.midtones || z)); d.putList(s('highlightLevels'), __intList(p.highlights || z));
      d.putBoolean(s('preserveLuminosity'), p.preserveLuminosity !== false);
      return d;
    }
  },
  vibrance: {
    cls: 'vibrance',
    build: function (p) { var d = new ActionDescriptor(); d.putInteger(s('vibrance'), p.vibrance || 0); d.putInteger(s('saturation'), p.saturation || 0); return d; }
  },
  photoFilter: {
    cls: 'photoFilter',
    build: function (p) {
      var d = new ActionDescriptor();
      d.putObject(s('color'), s('RGBColor'), __rgbDesc(p.color || '#ec8a00'));
      d.putInteger(s('density'), p.density === undefined ? 25 : p.density);
      d.putBoolean(s('preserveLuminosity'), p.preserveLuminosity !== false);
      return d;
    }
  },
  exposure: {
    cls: 'exposure', preset: true,
    build: function (p) { var d = new ActionDescriptor(); d.putDouble(s('exposure'), p.exposure || 0); d.putDouble(s('offset'), p.offset || 0); d.putDouble(s('gammaCorrection'), p.gamma === undefined ? 1 : p.gamma); return d; }
  },
  blackAndWhite: {
    cls: 'blackAndWhite', preset: true,
    build: function (p) {
      var d = new ActionDescriptor();
      d.putInteger(s('red'), p.reds === undefined ? 40 : p.reds); d.putInteger(s('yellow'), p.yellows === undefined ? 60 : p.yellows);
      d.putInteger(s('grain'), p.greens === undefined ? 40 : p.greens); d.putInteger(s('cyan'), p.cyans === undefined ? 60 : p.cyans);
      d.putInteger(s('blue'), p.blues === undefined ? 20 : p.blues); d.putInteger(s('magenta'), p.magentas === undefined ? 80 : p.magentas);
      d.putBoolean(s('useTint'), !!p.tint);
      if (p.tint) d.putObject(s('tintColor'), s('RGBColor'), __rgbDesc(p.tint));
      return d;
    }
  },
  gradientMap: {
    cls: 'gradientMapClass',
    makeParams: function (p) { var d = new ActionDescriptor(); d.putObject(s('gradient'), s('gradientClassEvent'), __gradientDesc(p.stops || [{ color: '#000000' }, { color: '#ffffff' }])); return d; },
    build: function (p) {
      var d = new ActionDescriptor();
      d.putObject(s('gradient'), s('gradientClassEvent'), __gradientDesc(p.stops || [{ color: '#000000' }, { color: '#ffffff' }]));
      d.putBoolean(s('reverse'), !!p.reverse);
      return d;
    }
  },
  invert: { cls: 'invert', build: null },
  posterize: { cls: 'posterize', build: function (p) { var d = new ActionDescriptor(); d.putInteger(s('levels'), p.levels || 4); return d; } },
  threshold: { cls: 'thresholdClassEvent', build: function (p) { var d = new ActionDescriptor(); d.putInteger(s('level'), p.level || 128); return d; } }
};

function __adjSet(cls, desc) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(s('adjustmentLayer'), s('ordinal'), s('targetEnum'));
  d.putReference(s('null'), r); d.putObject(s('to'), s(cls), desc);
  __exec('set', d);
}

__mutation('adjustment', 'adjustment', function (a) {
  var doc = __requireDoc(), spec = __ADJ[a.type];
  if (!spec) __fail('Unknown adjustment type "' + a.type + '".');
  var p = a.params || {}, id, ctx = null;
  if ((a.type === 'curves' || a.type === 'levels') && (p.red || p.green || p.blue) && doc.mode !== DocumentMode.RGB) __fail('Per-channel red/green/blue ' + a.type + ' needs an RGB document; this one is ' + __enumName(doc.mode) + '. Use the composite (rgb) settings only.');
  if ((a.type === 'colorBalance' || a.type === 'photoFilter' || a.type === 'blackAndWhite' || a.type === 'vibrance') && doc.mode === DocumentMode.GRAYSCALE) __fail(a.type + ' is not available in Grayscale documents.');
  if (a.layer !== undefined) {
    id = __resolveId(a.layer);
    var cur = __layerInfoById(id);
    if (cur.type !== 'adjustment') __fail('Layer "' + cur.name + '" is not an adjustment layer.');
    __selectLayers([id], false);
    if (spec.build) __adjSet(spec.cls, spec.build(p));
  } else {
    if (a.clipTo !== undefined) __selectLayers([__resolveId(a.clipTo)], false);
    ctx = __insertCtx(a);
    var d = new ActionDescriptor(), r = new ActionReference();
    r.putClass(s('adjustmentLayer')); d.putReference(s('null'), r);
    var u = new ActionDescriptor(), td = spec.makeParams ? spec.makeParams(p) : new ActionDescriptor();
    if (spec.preset) td.putEnumerated(s('presetKind'), s('presetKindType'), s('presetKindDefault'));
    u.putObject(s('type'), s(spec.cls), td);
    if (a.clipTo !== undefined) u.putBoolean(s('group'), true);
    d.putObject(s('using'), s('adjustmentLayer'), u);
    __exec('make', d);   // an active selection automatically becomes the adjustment's mask
    id = __topId();
    if (spec.build) __adjSet(spec.cls, spec.build(p));
  }
  var r2 = __finishNew(id, a, ctx), info = r2.created;
  var ld = executeActionGet(__layerRefById(id));
  try { info.settings = __dump(ld.getList(s('adjustment')).getObjectValue(0)); } catch (e) {}
  return a.layer !== undefined ? { changed: [info] } : r2;
});

// ===================================================================== filters

var __FILTERS = {
  gaussianBlur: function (p) { var d = new ActionDescriptor(); d.putUnitDouble(s('radius'), s('pixelsUnit'), p.radius === undefined ? 2 : p.radius); return d; },
  unsharpMask: function (p) { var d = new ActionDescriptor(); d.putUnitDouble(s('amount'), s('percentUnit'), p.amount === undefined ? 80 : p.amount); d.putUnitDouble(s('radius'), s('pixelsUnit'), p.radius === undefined ? 1 : p.radius); d.putInteger(s('threshold'), p.threshold || 0); return d; },
  addNoise: function (p) { var d = new ActionDescriptor(); d.putEnumerated(s('distribution'), s('distribution'), s(p.uniform ? 'uniformDistribution' : 'gaussianDistribution')); d.putUnitDouble(s('noise'), s('percentUnit'), p.amount === undefined ? 3 : p.amount); d.putBoolean(s('monochromatic'), p.monochromatic !== false); return d; },
  highPass: function (p) { var d = new ActionDescriptor(); d.putUnitDouble(s('radius'), s('pixelsUnit'), p.radius === undefined ? 2 : p.radius); return d; },
  motionBlur: function (p) { var d = new ActionDescriptor(); d.putInteger(s('angle'), p.angle || 0); d.putUnitDouble(s('distance'), s('pixelsUnit'), p.distance === undefined ? 10 : p.distance); return d; },
  median: function (p) { var d = new ActionDescriptor(); d.putUnitDouble(s('radius'), s('pixelsUnit'), p.radius === undefined ? 1 : p.radius); return d; }
};

__mutation('filter', 'filter', function (a) {
  var doc = __requireDoc(), build = __FILTERS[a.type];
  if (!build) __fail('Unknown filter "' + a.type + '".');
  var id = __resolveId(a.layer), info = __layerInfoById(id), notes = [];
  __selectLayers([id], false);
  __assertEditable(app.activeDocument.activeLayer, 'be filtered');
  if (info.type !== 'smartObject' && info.type !== 'pixel') __fail('Filters apply to pixel or smart object layers; "' + info.name + '" is ' + info.type + '. Rasterize or convert it to a smart object first (ps_layer_op).');
  if (info.type === 'pixel' && a.smart !== false) {
    __exec('newPlacedLayer');
    id = __topId();
    notes.push('Converted "' + info.name + '" to a smart object so the filter stays editable (pass smart: false for a destructive filter).');
  }
  __exec(a.type, build(a.params || {}));
  var r = { changed: [__layerInfoById(id)] };
  if (notes.length) r.notes = notes;
  return r;
});

// ===================================================================== selections & masks

function __shapeDesc(kind, b) {
  var sh = new ActionDescriptor(), keys = ['left', 'top', 'right', 'bottom'];
  for (var i = 0; i < 4; i++) sh.putUnitDouble(s(keys[i]), s('pixelsUnit'), b[i]);
  return sh;
}

__mutation('selection', 'selection', function (a) {
  var doc = __requireDoc(), act = a.action, note = null, ev = { replace: 'set', add: 'addTo', subtract: 'subtractFrom', intersect: 'intersectWith' }[a.mode || 'replace'];
  function selRef() { var r = new ActionReference(); r.putProperty(s('channel'), s('selection')); return r; }
  if (act === 'all') doc.selection.selectAll();
  else if (act === 'none') doc.selection.deselect();
  else if (act === 'invert') doc.selection.invert();
  else if (act === 'rect' || act === 'ellipse') {
    if (!a.bounds) __fail(act + ' needs bounds [left, top, right, bottom].');
    var d = new ActionDescriptor(); d.putReference(s('null'), selRef());
    d.putObject(s('to'), s(act === 'rect' ? 'rectangle' : 'ellipse'), __shapeDesc(act, a.bounds));
    d.putBoolean(s('antiAlias'), true);
    __exec(ev, d);
  } else if (act === 'subject') {
    var sid = a.layer !== undefined ? __resolveId(a.layer) : null;
    if (sid !== null) __selectLayers([sid], false);
    __targetComposite();
    // Select Subject always replaces the selection; keep the previous one in a channel to honor add/subtract/intersect.
    var prevCh = null;
    if (ev !== 'set' && __selBounds(doc)) {
      prevCh = doc.channels.add(); prevCh.name = '__mcp_prev_selection'; doc.selection.store(prevCh);
      __targetComposite();   // adding a channel targets it, which makes Select Subject reject its parameters
      if (sid !== null) __selectLayers([sid], false);
    }
    var sd = new ActionDescriptor(); sd.putBoolean(s('sampleAllLayers'), sid === null);
    try { __exec('autoCutout', sd); }
    catch (e) {
      if (prevCh) { try { prevCh.remove(); } catch (ignore) {} }
      // Per-layer Select Subject fails when the layer doesn't cover the whole canvas (probed on PS 27.11).
      if (sid === null) throw e;
      __fail('Select Subject cannot analyze a single layer that does not fill the canvas. Instead: ps_selection {action: "subject"} without a layer (uses the visible image), then {action: "layer", layer: ' + sid + ', mode: "intersect"} to limit it to this layer.');
    }
    if (prevCh) {
      try {
        if (ev === 'addTo') doc.selection.load(prevCh, SelectionType.EXTEND);
        else if (ev === 'intersectWith') doc.selection.load(prevCh, SelectionType.INTERSECT);
        else { doc.selection.invert(); doc.selection.load(prevCh, SelectionType.INTERSECT); }   // previous minus subject
      } finally { try { prevCh.remove(); } catch (ignore2) {} __targetComposite(); }
    }
  } else if (act === 'layer') {
    var id = __resolveId(a.layer), ld = new ActionDescriptor(), cr = new ActionReference();
    cr.putEnumerated(s('channel'), s('channel'), s('transparencyEnum')); cr.putIdentifier(s('layer'), id);
    ld.putReference(s('null'), selRef()); ld.putReference(s('to'), cr);
    __exec(ev, ld);
  } else if (act === 'feather') doc.selection.feather(__px(a.radius || 2));
  else if (act === 'expand') doc.selection.expand(__px(a.radius || 2));
  else if (act === 'contract') doc.selection.contract(__px(a.radius || 2));
  else if (act === 'fill') {
    if (!__selBounds(doc)) __fail('fill needs an active selection.');
    var l = __layer(a.layer);
    if (l.kind !== LayerKind.NORMAL) __fail('fill works on pixel layers; "' + l.name + '" is ' + __enumName(l.kind) + '.');
    if (!l.visible) __fail('Layer "' + l.name + '" is hidden and Photoshop cannot fill hidden layers. Show it first (ps_set_layers visible: true).');
    __assertEditable(l, 'be filled');
    doc.selection.fill(__solid(a.color || '#000000'), ColorBlendMode.NORMAL, a.opacity === undefined ? 100 : a.opacity);
  } else if (act === 'clear') {
    if (!__selBounds(doc)) __fail('clear needs an active selection.');
    var cl = __layer(a.layer);
    if (!cl.visible) __fail('Layer "' + cl.name + '" is hidden and Photoshop cannot clear pixels on hidden layers. Show it first.');
    doc.selection.clear();
  } else __fail('Unknown selection action "' + act + '".');
  var res = { selection: __selBounds(doc) };
  if (note) res.notes = [note];
  return res;
});

function __maskAdd(how) {
  var d = new ActionDescriptor(); d.putClass(s('new'), s('channel'));
  var r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('mask')); d.putReference(s('at'), r);
  d.putEnumerated(s('using'), s('userMaskEnabled'), s(how));
  __exec('make', d);
}
function __maskRef() { var r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('mask')); return r; }

// Delete (or apply) the selected layer's mask. Photoshop drops the active selection while doing so; keep it.
function __maskDelete(doc, apply) {
  __keepSelection(doc, function () {
    var d = new ActionDescriptor(); d.putReference(s('null'), __maskRef()); if (apply) d.putBoolean(s('apply'), true);
    __exec('delete', d);
  });
}

__mutation('mask', 'mask', function (a) {
  var doc = __requireDoc(), id = __resolveId(a.layer), info = __layerInfoById(id), act = a.action;
  __selectLayers([id], false);
  if (act === 'add') {
    if (info.mask) {
      if (!a.replace) __fail('Layer "' + info.name + '" already has a mask (place_image cover fit adds one). Pass replace: true to swap it, or use invert/apply/delete.');
      __maskDelete(doc, false);
    }
    var how = a.from || (__selBounds(doc) ? 'selection' : 'revealAll');
    if (how === 'selection' && !__selBounds(doc)) __fail('No active selection. Make one with ps_selection or use from: "revealAll"/"hideAll".');
    __maskAdd({ selection: 'revealSelection', revealAll: 'revealAll', hideAll: 'hideAll' }[how]);
    if (how === 'selection') doc.selection.deselect();
  } else {
    if (!info.mask) __fail('Layer "' + info.name + '" has no mask.');
    if (act === 'delete' || act === 'apply') __maskDelete(doc, act === 'apply');
    else if (act === 'invert') {
      var sd = new ActionDescriptor(); sd.putReference(s('null'), __maskRef()); sd.putBoolean(s('makeVisible'), false); __exec('select', sd);
      __exec('invert');
    } else if (act === 'enable' || act === 'disable') {
      var ed = new ActionDescriptor(), ld = new ActionDescriptor(); ed.putReference(s('null'), __targetRef());
      ld.putBoolean(s('userMaskEnabled'), act === 'enable'); ed.putObject(s('to'), s('layer'), ld);
      __exec('set', ed);
    } else __fail('Unknown mask action "' + act + '".');
  }
  __targetComposite();
  return { changed: [__layerInfoById(id)] };
});

// ===================================================================== history, batch, escape hatch

__ops.history = function (a) {
  var doc = __requireDoc(), hs = doc.historyStates, cur = __historyIndex(doc), real = [], snaps = [], i;
  for (i = 0; i < hs.length; i++) (hs[i].snapshot ? snaps : real).push(i);
  var pos = 0;
  for (i = 0; i < real.length; i++) if (real[i] === cur) pos = i;
  var onSnapshot = hs[cur].snapshot;
  if (a.action === 'list') {
    var list = [], sl = [];
    for (i = 0; i < real.length; i++) list.push((real[i] === cur ? '* ' : '  ') + i + ' ' + hs[real[i]].name);
    for (i = 0; i < snaps.length; i++) sl.push((snaps[i] === cur ? '* ' : '  ') + hs[snaps[i]].name);
    return { current: onSnapshot ? null : pos, states: list, snapshots: sl };
  }
  var target;
  if (a.action === 'undo') target = real[Math.max(0, pos - a.steps)];
  else if (a.action === 'redo') target = real[Math.min(real.length - 1, pos + a.steps)];
  else if (a.action === 'goto') { if (a.index < 0 || a.index >= real.length) __fail('History index out of range 0..' + (real.length - 1)); target = real[a.index]; }
  else if (a.action === 'snapshot') {
    __makeSnapshot(a.name || 'MCP snapshot');
    return { snapshot: a.name || 'MCP snapshot' };
  } else if (a.action === 'revert') {
    var want = a.name || null, found = null;
    for (i = snaps.length - 1; i >= 0; i--) if (!want || hs[snaps[i]].name === want) { found = snaps[i]; if (want || /^MCP/.test(hs[snaps[i]].name)) break; }
    if (found === null) __fail('No snapshot' + (want ? ' named "' + want + '"' : '') + '. Use action "list" to see snapshots.');
    doc.activeHistoryState = hs[found];
    return { revertedTo: hs[found].name };
  }
  doc.activeHistoryState = hs[target];
  return { from: hs[cur].name, to: hs[target].name };
};

function __makeSnapshot(name) {
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('snapshotClass')); d.putReference(s('null'), r);
  var f = new ActionReference(); f.putProperty(s('historyState'), s('currentHistoryState')); d.putReference(s('from'), f);
  d.putString(s('name'), name); d.putEnumerated(s('using'), s('historyState'), s('fullDocument'));
  __exec('make', d);
}

// Safety net before an agent's first edit: an in-memory history snapshot, plus a copy on disk when the
// document has unsaved work (a crash would otherwise lose it). Saving a copy never rebinds the document.
__ops.checkpoint = function (a) {
  var doc = __requireDoc(), out = { docId: doc.id, snapshot: null, file: null };
  if (a.skip && __has(a.skip, doc.id)) return { docId: doc.id, skipped: true };
  var stamp = (function () { var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); })();
  if (a.history !== false) { __makeSnapshot('MCP checkpoint ' + stamp.substr(9)); out.snapshot = 'MCP checkpoint ' + stamp.substr(9); }
  var hasFile = true; try { doc.fullName; } catch (e) { hasFile = false; }
  if (a.disk !== false && (!doc.saved || !hasFile)) {
    var f = new Folder(a.dir); if (!f.exists) f.create();
    var base = a.dir + '/' + doc.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') + '-' + stamp;
    var file = new File(base + '.psd');
    try {
      var o = new PhotoshopSaveOptions(); o.layers = true; o.embedColorProfile = true; o.maximizeCompatibility = false;
      doc.saveAs(file, o, true);
    } catch (e) {
      // PSD tops out at 2 GB / 30,000 px; fall back to the large document format.
      file = new File(base + '.psb');
      var sd = new ActionDescriptor(), lo = new ActionDescriptor();
      lo.putBoolean(s('maximizeCompatibility'), false);
      sd.putObject(s('as'), s('largeDocumentFormat'), lo);
      sd.putPath(s('in'), file); sd.putBoolean(s('copy'), true);
      __exec('save', sd);
    }
    out.file = file.fsName;
  } else if (hasFile) out.onDisk = doc.fullName.fsName;
  return out;
};

__ops.batch = function (a) {
  return __tx(a.label || 'MCP: batch', function () {
    var results = [];
    for (var i = 0; i < a.ops.length; i++) {
      var op = a.ops[i];
      try { results.push(__impl[op.op](op.args)); }
      catch (e) { throw new Error('op ' + i + ' (' + op.op + ') failed: ' + __errMsg(e) + ' — the whole batch was rolled back.'); }
    }
    return results;
  });
};

__ops.exec = function (a) {
  var fn = new Function(a.code);
  return a.tx && app.documents.length ? __tx(a.label || 'MCP: script', fn) : fn();
};
