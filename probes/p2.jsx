function dump(d, depth) {
  depth = depth || 0; if (depth > 6) return '…';
  var o = {};
  for (var i = 0; i < d.count; i++) {
    var k = d.getKey(i), name = ts(k) || ('#' + k), t = d.getType(k);
    try { o[name] = val(d, k, t, depth); } catch (e) { o[name] = 'ERR ' + e.message; }
  }
  return o;
}
function val(d, k, t, depth) {
  switch (t) {
    case DescValueType.INTEGERTYPE: return d.getInteger(k);
    case DescValueType.DOUBLETYPE: return d.getDouble(k);
    case DescValueType.UNITDOUBLE: return d.getUnitDoubleValue(k) + ' ' + ts(d.getUnitDoubleType(k));
    case DescValueType.BOOLEANTYPE: return d.getBoolean(k);
    case DescValueType.STRINGTYPE: return d.getString(k);
    case DescValueType.ENUMERATEDTYPE: return ts(d.getEnumerationValue(k));
    case DescValueType.OBJECTTYPE: var x = dump(d.getObjectValue(k), depth + 1); x._class = ts(d.getObjectType(k)); return x;
    case DescValueType.LISTTYPE: return list(d.getList(k), depth);
    default: return String(t);
  }
}
function list(l, depth) {
  var a = [];
  for (var i = 0; i < l.count; i++) {
    var t = l.getType(i);
    if (t === DescValueType.OBJECTTYPE) { var x = dump(l.getObjectValue(i), depth + 1); x._class = ts(l.getObjectType(i)); a.push(x); }
    else if (t === DescValueType.INTEGERTYPE) a.push(l.getInteger(i));
    else if (t === DescValueType.DOUBLETYPE) a.push(l.getDouble(i));
    else if (t === DescValueType.REFERENCETYPE) a.push('ref');
    else a.push(String(t));
  }
  return a;
}
function chanRef(name) { var r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s(name)); return r; }
function intList(arr) { var l = new ActionList(); for (var i = 0; i < arr.length; i++) l.putInteger(arr[i]); return l; }

function makeAdj(type) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putClass(s('adjustmentLayer')); d.putReference(s('null'), r);
  var u = new ActionDescriptor(), td = new ActionDescriptor();
  if (type === 'levels' || type === 'curves' || type === 'hueSaturation' || type === 'exposure' || type === 'blackAndWhite') td.putEnumerated(s('presetKind'), s('presetKindType'), s('presetKindDefault'));
  if (type === 'gradientMapClass') td.putObject(s('gradient'), s('gradientClassEvent'), grad());
  u.putObject(s('type'), s(type), td);
  d.putObject(s('using'), s('adjustmentLayer'), u);
  __exec('make', d);
}
function setAdj(type, params) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(s('adjustmentLayer'), s('ordinal'), s('targetEnum'));
  d.putReference(s('null'), r);
  d.putObject(s('to'), s(type), params);
  __exec('set', d);
}
function grad() {
  var g = new ActionDescriptor();
  g.putString(s('name'), 'MCP');
  g.putEnumerated(s('gradientForm'), s('gradientForm'), s('customStops'));
  g.putDouble(s('interfaceIconFrameDimmed'), 4096);
  var cl = new ActionList(), stops = [['#1a2a6c', 0], ['#fdbb2d', 4096]];
  for (var i = 0; i < stops.length; i++) {
    var st = new ActionDescriptor();
    st.putObject(s('color'), s('RGBColor'), __rgbDesc(stops[i][0]));
    st.putEnumerated(s('type'), s('colorStopType'), s('userStop'));
    st.putInteger(s('location'), stops[i][1]); st.putInteger(s('midpoint'), 50);
    cl.putObject(s('colorStop'), st);
  }
  g.putList(s('colors'), cl);
  var tl = new ActionList();
  for (var j = 0; j < 2; j++) {
    var tt = new ActionDescriptor();
    tt.putUnitDouble(s('opacity'), s('percentUnit'), 100); tt.putInteger(s('location'), j * 4096); tt.putInteger(s('midpoint'), 50);
    tl.putObject(s('transferSpec'), tt);
  }
  g.putList(s('transparency'), tl);
  return g;
}

var P = {};
P.brightnessEvent = function () { var d = new ActionDescriptor(); d.putInteger(s('brightness'), 20); d.putInteger(s('center'), 15); d.putBoolean(s('useLegacy'), false); return d; };
P.levels = function () {
  var d = new ActionDescriptor(), l = new ActionList(), a = new ActionDescriptor();
  a.putReference(s('channel'), chanRef('composite')); a.putList(s('input'), intList([10, 240])); a.putDouble(s('gamma'), 1.2); a.putList(s('output'), intList([5, 250]));
  l.putObject(s('levelsAdjustment'), a); d.putList(s('adjustment'), l); return d;
};
P.curves = function () {
  var d = new ActionDescriptor(), l = new ActionList(), a = new ActionDescriptor(), pts = new ActionList();
  var xy = [[0, 0], [64, 50], [192, 205], [255, 255]];
  for (var i = 0; i < xy.length; i++) { var p = new ActionDescriptor(); p.putDouble(s('horizontal'), xy[i][0]); p.putDouble(s('vertical'), xy[i][1]); pts.putObject(s('paint'), p); }
  a.putReference(s('channel'), chanRef('composite')); a.putList(s('curve'), pts);
  l.putObject(s('curvesAdjustment'), a); d.putList(s('adjustment'), l); return d;
};
P.hueSaturation = function () {
  var d = new ActionDescriptor(), l = new ActionList(), a = new ActionDescriptor();
  a.putInteger(s('hue'), 5); a.putInteger(s('saturation'), -20); a.putInteger(s('lightness'), 0);
  l.putObject(s('hueSatAdjustmentV2'), a); d.putBoolean(s('colorize'), false); d.putList(s('adjustment'), l); return d;
};
P.colorBalance = function () {
  var d = new ActionDescriptor();
  d.putList(s('shadowLevels'), intList([-10, 0, 15])); d.putList(s('midtoneLevels'), intList([0, 0, 0])); d.putList(s('highlightLevels'), intList([10, 0, -12]));
  d.putBoolean(s('preserveLuminosity'), true); return d;
};
P.vibrance = function () { var d = new ActionDescriptor(); d.putInteger(s('vibrance'), 25); d.putInteger(s('saturation'), -5); return d; };
P.photoFilter = function () { var d = new ActionDescriptor(); d.putObject(s('color'), s('RGBColor'), __rgbDesc('#ec8a00')); d.putInteger(s('density'), 30); d.putBoolean(s('preserveLuminosity'), true); return d; };
P.exposure = function () { var d = new ActionDescriptor(); d.putDouble(s('exposure'), 0.3); d.putDouble(s('offset'), 0.01); d.putDouble(s('gammaCorrection'), 1.05); return d; };
P.blackAndWhite = function () { var d = new ActionDescriptor(); d.putInteger(s('red'), 40); d.putInteger(s('yellow'), 60); d.putInteger(s('grain'), 40); d.putInteger(s('cyan'), 60); d.putInteger(s('blue'), 20); d.putInteger(s('magenta'), 80); d.putBoolean(s('useTint'), false); return d; };
P.gradientMapClass = function () { var d = new ActionDescriptor(); d.putObject(s('gradient'), s('gradientClassEvent'), grad()); return d; };
P.invert = function () { return new ActionDescriptor(); };
P.posterize = function () { var d = new ActionDescriptor(); d.putInteger(s('levels'), 6); return d; };
P.thresholdClassEvent = function () { var d = new ActionDescriptor(); d.putInteger(s('level'), 140); return d; };

var user = app.activeDocument;
var doc = app.open(new File('/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg'));
var res = {};
for (var type in P) {
  try {
    makeAdj(type);
    var params = P[type]();
    if (params.count) setAdj(type, params);
    var info = __layerInfoById(__activeLayerIds()[0]);
    var ld = executeActionGet(__layerRefById(info.id));
    var adj = ld.getList(s('adjustment'));
    res[type] = { ok: true, name: info.name, adjClass: ts(adj.getClass(0)), readback: dump(adj.getObjectValue(0)) };
  } catch (e) { res[type] = { ok: false, error: __errMsg(e) }; }
}
doc.close(SaveOptions.DONOTSAVECHANGES);
app.activeDocument = user;
return res;
