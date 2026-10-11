// Runs inside Photoshop's ExtendScript engine (ES3): no JSON, let/const, arrow functions, Array#indexOf or String#trim.

// ---------- basics

function __j(v) {
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return String(v);
  if (t === 'string') {
    return '"' + v.replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
      var m = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
      return m[c] || ('\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
    }) + '"';
  }
  if (v instanceof Array) {
    var a = [];
    for (var i = 0; i < v.length; i++) a.push(__j(v[i]));
    return '[' + a.join(',') + ']';
  }
  var o = [];
  for (var k in v) if (v.hasOwnProperty(k) && v[k] !== undefined) o.push(__j(k) + ':' + __j(v[k]));
  return '{' + o.join(',') + '}';
}

function __errMsg(e) {
  var m = String((e && e.message) || e);
  // Photoshop prefixes most errors with this boilerplate; keep the useful part.
  m = m.replace(/^General Photoshop error occurred\. This functionality may not be available in this version of Photoshop\.\s*-?\s*/, '');
  return m.replace(/\s+$/, '');
}

function __fail(msg) { throw new Error(msg); }
function __has(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
function __round(n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; }
function __enumName(e) { return String(e).replace(/^[A-Za-z]+\./, ''); }

// Action Manager shorthands
function s(id) { return stringIDToTypeID(id); }
function c(id) { return charIDToTypeID(id); }
function ts(t) { return typeIDToStringID(t); }
function __exec(event, desc) { return executeAction(s(event), desc || new ActionDescriptor(), DialogModes.NO); }

function __requireDoc() {
  if (app.documents.length === 0) __fail('No document is open. Use ps_document with action "open" or "create" first.');
  return app.activeDocument;
}

// ---------- history / transactions

function __historyIndex(doc) {
  // The AM "current history state" get fails in PS 27.11; object equality works.
  var hs = doc.historyStates, cur = doc.activeHistoryState;
  for (var i = hs.length - 1; i >= 0; i--) if (hs[i] == cur) return i;
  return hs.length - 1;
}

// Run fn as ONE history step. On error, roll the document back to where it was.
function __tx(name, fn) {
  var doc = __requireDoc();
  var before = doc.activeHistoryState;
  $.global.__txfn = fn;
  $.global.__txres = null;
  doc.suspendHistory(name, 'try { $.global.__txres = { v: $.global.__txfn() }; } catch (e) { $.global.__txres = { e: e }; }');
  var r = $.global.__txres;
  if (!r || r.e) {
    try { app.activeDocument = doc; doc.activeHistoryState = before; } catch (ignore) {}
    throw (r && r.e) || new Error('Transaction "' + name + '" did not complete');
  }
  return r.v;
}

// ---------- colors

function __hex(h) {
  h = String(h || '#000000').replace('#', '');
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) __fail('Invalid hex color: ' + h);
  return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
}
function __toHex(r, g, b) {
  function p(n) { var x = Math.max(0, Math.min(255, Math.round(n))).toString(16); return x.length < 2 ? '0' + x : x; }
  return '#' + p(r) + p(g) + p(b);
}
function __solid(h) { var rgb = __hex(h), sc = new SolidColor(); sc.rgb.red = rgb.r; sc.rgb.green = rgb.g; sc.rgb.blue = rgb.b; return sc; }
function __rgbDesc(h) {
  var rgb = __hex(h), d = new ActionDescriptor();
  d.putDouble(c('Rd  '), rgb.r); d.putDouble(c('Grn '), rgb.g); d.putDouble(c('Bl  '), rgb.b);
  return d;
}
function __descHex(d) {
  try { return __toHex(d.getDouble(c('Rd  ')), d.getDouble(c('Grn ')), d.getDouble(c('Bl  '))); } catch (e) { return null; }
}

// ---------- layer lookup (by id; names resolved through the AM index walk)

function __layerRefById(id) { var r = new ActionReference(); r.putIdentifier(s('layer'), id); return r; }
function __layerExists(id) { try { executeActionGet(__layerRefById(id)); return true; } catch (e) { return false; } }

function __selectLayers(ids, makeVisible) {
  var d = new ActionDescriptor(), r = new ActionReference();
  for (var i = 0; i < ids.length; i++) r.putIdentifier(s('layer'), ids[i]);
  d.putReference(s('null'), r);
  d.putBoolean(s('makeVisible'), !!makeVisible);
  __exec('select', d);
}

// Accepts a layer id (number or digit string) or an exact layer name / "Group/Child" path.
function __resolveId(ref) {
  __requireDoc();
  if (ref === undefined || ref === null) __fail('A layer reference (id or name) is required.');
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    var id = Number(ref);
    if (!__layerExists(id)) __fail('No layer with id ' + id + ' in the active document. Call ps_snapshot for current ids.');
    return id;
  }
  var all = __flatLayers(), want = String(ref), hits = [];
  for (var i = 0; i < all.length; i++) if (all[i].name === want || all[i].path === want) hits.push(all[i]);
  if (hits.length === 1) return hits[0].id;
  if (hits.length === 0) __fail('No layer named "' + want + '". Call ps_snapshot to see layer names and ids.');
  var ids = [];
  for (var k = 0; k < hits.length; k++) ids.push(hits[k].id + ' (' + hits[k].path + ')');
  __fail('Layer name "' + want + '" is ambiguous — use an id: ' + ids.join(', '));
}

// Resolve + select, returning the DOM layer.
function __layer(ref) {
  var id = __resolveId(ref);
  __selectLayers([id], false);
  return app.activeDocument.activeLayer;
}

// ---------- fast layer reads via Action Manager

var __KIND = { 0: 'any', 1: 'pixel', 2: 'adjustment', 3: 'text', 4: 'shape', 5: 'smartObject', 6: 'video', 7: 'group', 8: '3d', 9: 'gradientFill', 10: 'patternFill', 11: 'solidFill', 12: 'background', 13: 'groupEnd' };

function __docInt(key) {
  var r = new ActionReference();
  r.putProperty(s('property'), s(key));
  r.putEnumerated(s('document'), s('ordinal'), s('targetEnum'));
  return executeActionGet(r).getInteger(s(key));
}
function __hasBackground() {
  var r = new ActionReference();
  r.putProperty(s('property'), s('hasBackgroundLayer'));
  r.putEnumerated(s('document'), s('ordinal'), s('targetEnum'));
  return executeActionGet(r).getBoolean(s('hasBackgroundLayer'));
}

function __unit(d, key) { try { return d.getUnitDoubleValue(s(key)); } catch (e) { return d.getDouble(s(key)); } }

function __boundsOf(d, key) {
  if (!d.hasKey(s(key))) return null;
  var b = d.getObjectValue(s(key));
  return [__round(__unit(b, 'left')), __round(__unit(b, 'top')), __round(__unit(b, 'right')), __round(__unit(b, 'bottom'))];
}

function __readLayerDesc(d, full) {
  var kind = __KIND[d.getInteger(s('layerKind'))] || 'unknown';
  var o = {
    id: d.getInteger(s('layerID')),
    name: d.getString(s('name')),
    type: kind === 'background' ? 'pixel' : kind,
    visible: d.getBoolean(s('visible')),
    opacity: Math.round(d.getInteger(s('opacity')) / 2.55),
    blendMode: ({ blendSubtraction: 'subtract', blendDivide: 'divide' })[ts(d.getEnumerationValue(s('mode')))] || ts(d.getEnumerationValue(s('mode')))
  };
  if (kind === 'background' || (d.hasKey(s('background')) && d.getBoolean(s('background')))) o.background = true;
  o.bounds = __boundsOf(d, 'boundsNoEffects') || __boundsOf(d, 'bounds');
  if (d.hasKey(s('fillOpacity'))) { var fo = Math.round(d.getInteger(s('fillOpacity')) / 2.55); if (fo !== 100) o.fillOpacity = fo; }
  if (d.hasKey(s('group')) && d.getBoolean(s('group'))) o.clipped = true;
  if (d.hasKey(s('hasUserMask')) && d.getBoolean(s('hasUserMask'))) o.mask = true;
  if (d.hasKey(s('hasVectorMask')) && d.getBoolean(s('hasVectorMask'))) o.vectorMask = true;
  if (d.hasKey(s('layerLocking'))) {
    var lk = d.getObjectValue(s('layerLocking'));
    if (lk.hasKey(s('protectAll')) && lk.getBoolean(s('protectAll'))) o.locked = true;
  }
  if (kind === 'adjustment' && d.hasKey(s('adjustment'))) {
    try { o.adjustment = ts(d.getList(s('adjustment')).getClass(0)); } catch (e) {}
  }
  if (kind === 'smartObject' && d.hasKey(s('smartObject'))) {
    try {
      var so = d.getObjectValue(s('smartObject'));
      o.smartObject = { linked: so.getBoolean(s('linked')) };
      if (so.hasKey(s('fileReference'))) o.smartObject.file = so.getString(s('fileReference'));
    } catch (e) {}
  }
  if (kind === 'text' && d.hasKey(s('textKey'))) {
    try {
      var tk = d.getObjectValue(s('textKey'));
      o.text = { contents: tk.getString(s('textKey')) };
      if (full !== false) {
        var st = tk.getList(s('textStyleRange')).getObjectValue(0).getObjectValue(s('textStyle'));
        var yy = 1;
        if (tk.hasKey(s('transform'))) yy = tk.getObjectValue(s('transform')).getDouble(s('yy'));
        if (st.hasKey(s('size'))) o.text.size = __round(__unit(st, 'size') * yy, 2);
        if (st.hasKey(s('fontPostScriptName'))) o.text.font = st.getString(s('fontPostScriptName'));
        if (st.hasKey(s('color'))) o.text.color = __descHex(st.getObjectValue(s('color')));
      }
    } catch (e) {}
  }
  return o;
}

// Walk every layer top→bottom, skipping group end markers. fn(desc, path, depth, parentIds).
function __walk(fn) {
  var count = __docInt('numberOfLayers'), start = __hasBackground() ? 0 : 1, names = [], ids = [];
  for (var i = count; i >= start; i--) {
    var r = new ActionReference();
    r.putIndex(s('layer'), i);
    var d = executeActionGet(r);
    var section = ts(d.getEnumerationValue(s('layerSection')));
    if (section === 'layerSectionEnd') { names.pop(); ids.pop(); continue; }
    var name = d.getString(s('name')), id = d.getInteger(s('layerID'));
    fn(d, names.length ? names.join('/') + '/' + name : name, names.length, ids.slice(0));
    if (section === 'layerSectionStart') { names.push(name); ids.push(id); }
  }
}

function __flatLayers() {
  var out = [];
  __walk(function (d, path, depth) { out.push({ id: d.getInteger(s('layerID')), name: d.getString(s('name')), path: path, depth: depth }); });
  return out;
}

function __layerInfoById(id) { return __readLayerDesc(executeActionGet(__layerRefById(id))); }

function __activeLayerIds() {
  var r = new ActionReference();
  r.putProperty(s('property'), s('targetLayersIDs'));
  r.putEnumerated(s('document'), s('ordinal'), s('targetEnum'));
  var d = executeActionGet(r), ids = [];
  if (!d.hasKey(s('targetLayersIDs'))) return ids;
  var l = d.getList(s('targetLayersIDs'));
  for (var i = 0; i < l.count; i++) ids.push(l.getReference(i).getIdentifier());
  return ids;
}

// ---------- descriptor → plain object (for inspect). DescValueType must be compared with ==, not ===.

function __dumpValue(get, type, depth) {
  var T = DescValueType;
  if (type == T.INTEGERTYPE) return get('Integer');
  if (type == T.DOUBLETYPE) return __round(get('Double'), 4);
  if (type == T.BOOLEANTYPE) return get('Boolean');
  if (type == T.STRINGTYPE) return get('String');
  if (type == T.UNITDOUBLE) return __round(get('UnitDoubleValue'), 4);
  if (type == T.ENUMERATEDTYPE) return ts(get('EnumerationValue'));
  if (type == T.OBJECTTYPE) { var o = __dump(get('ObjectValue'), depth + 1); o._class = ts(get('ObjectType')); return o; }
  if (type == T.LISTTYPE) return __dumpList(get('List'), depth + 1);
  if (type == T.CLASSTYPE) return ts(get('Class'));
  return '<' + String(type).replace('DescValueType.', '') + '>';
}
function __dump(d, depth) {
  depth = depth || 0;
  if (depth > 8) return '…';
  var o = {};
  for (var i = 0; i < d.count; i++) {
    var k = d.getKey(i);
    try { o[ts(k) || ('#' + k)] = __dumpValue(function (m) { return d['get' + m](k); }, d.getType(k), depth); } catch (e) { o[ts(k)] = '<unreadable>'; }
  }
  return o;
}
function __dumpList(l, depth) {
  var a = [];
  for (var i = 0; i < l.count && i < 200; i++) {
    try { a.push(__dumpValue(function (m) { return l['get' + m](i); }, l.getType(i), depth)); } catch (e) { a.push('<unreadable>'); }
  }
  return a;
}

function __selBounds(doc) {
  try { var b = doc.selection.bounds; return [b[0].as('px'), b[1].as('px'), b[2].as('px'), b[3].as('px')]; } catch (e) { return null; }
}

// Blend modes: AM names in reads, friendly camelCase names everywhere in the API.
var __BLEND_DOM = {
  normal: 'NORMAL', dissolve: 'DISSOLVE', darken: 'DARKEN', multiply: 'MULTIPLY', colorBurn: 'COLORBURN', linearBurn: 'LINEARBURN',
  darkerColor: 'DARKERCOLOR', lighten: 'LIGHTEN', screen: 'SCREEN', colorDodge: 'COLORDODGE', linearDodge: 'LINEARDODGE',
  lighterColor: 'LIGHTERCOLOR', overlay: 'OVERLAY', softLight: 'SOFTLIGHT', hardLight: 'HARDLIGHT', vividLight: 'VIVIDLIGHT',
  linearLight: 'LINEARLIGHT', pinLight: 'PINLIGHT', hardMix: 'HARDMIX', difference: 'DIFFERENCE', exclusion: 'EXCLUSION',
  subtract: 'SUBTRACT', divide: 'DIVIDE', hue: 'HUE', saturation: 'SATURATION', color: 'COLORBLEND', luminosity: 'LUMINOSITY',
  passThrough: 'PASSTHROUGH'
};
function __blendDom(name) {
  var k = __BLEND_DOM[name];
  if (!k) __fail('Unknown blend mode "' + name + '".');
  return BlendMode[k];
}

// Target the composite channel. After mask edits Photoshop leaves the mask channel targeted, which breaks
// histograms ("The requested property does not exist") and other composite operations (probed on PS 27.11).
function __targetComposite() {
  var names = ['RGB', 'CMYK', 'lab', 'gray'];
  for (var i = 0; i < names.length; i++) {
    try {
      var d = new ActionDescriptor(), r = new ActionReference();
      r.putEnumerated(s('channel'), s('channel'), s(names[i]));
      d.putReference(s('null'), r); d.putBoolean(s('makeVisible'), false);
      __exec('select', d);
      return;
    } catch (e) {}
  }
}

// ---------- creation helpers shared by ops

function __resolveIds(refs) { var ids = []; for (var i = 0; i < (refs || []).length; i++) ids.push(__resolveId(refs[i])); return ids; }

// Parent group id of a layer (null at top level).
function __parentOf(id) {
  var found = null;
  __walk(function (d, path, depth, parents) { if (d.getInteger(s('layerID')) === id) found = parents.length ? parents[parents.length - 1] : null; });
  return found;
}

function __makeLayer() {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putClass(s('layer')); d.putReference(s('null'), r);
  __exec('make', d);
  return __activeLayerIds()[0];
}

// New group, optionally wrapping the given layer ids.
function __makeGroup(name, ids) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putClass(s('layerSection')); d.putReference(s('null'), r);
  if (ids && ids.length) {
    __selectLayers(ids, false);
    var f = new ActionReference(); f.putEnumerated(s('layer'), s('ordinal'), s('targetEnum'));
    d.putReference(s('from'), f);
  }
  var u = new ActionDescriptor(); u.putString(s('name'), name || 'Group'); d.putObject(s('using'), s('layerSection'), u);
  __exec('make', d);
  return __activeLayerIds()[0];
}

// The text DOM reads font size and paragraph-box px values as points at the document resolution (probed on
// 27.11: size 100 "px" on a 300 ppi document renders 417 px tall). Leading and position are true pixels.
function __typeScale(doc) { return 72 / doc.resolution; }

// Run fn while keeping the current selection (some commands, e.g. deleting a mask, drop it).
function __keepSelection(doc, fn) {
  if (!__selBounds(doc)) return fn();
  var ch = doc.channels.add(); ch.name = '__mcp_selection';
  doc.selection.store(ch);
  try { return fn(); }
  finally {
    try { doc.selection.load(ch); } catch (e) {}
    try { ch.remove(); } catch (e2) {}
    __targetComposite();
  }
}

// Hide every layer except `id`, its descendants and its ancestors (used on a throwaway duplicate).
function __soloLayer(id) {
  var hide = new ActionList(), show = new ActionList(), nh = 0, anc = [];
  __walk(function (d, path, depth, parents) {
    var lid = d.getInteger(s('layerID'));
    if (lid === id) anc = parents;
    if (lid === id || __has(parents, id)) return;
    var r = new ActionReference(); r.putIdentifier(s('layer'), lid); hide.putReference(r); nh++;
  });
  if (nh) { var hd = new ActionDescriptor(); hd.putList(s('null'), hide); __exec('hide', hd); }
  anc.push(id);
  for (var i = 0; i < anc.length; i++) { var ar = new ActionReference(); ar.putIdentifier(s('layer'), anc[i]); show.putReference(ar); }
  var sd = new ActionDescriptor(); sd.putList(s('null'), show); __exec('show', sd);
}
