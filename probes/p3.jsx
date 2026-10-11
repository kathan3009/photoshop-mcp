var user = app.activeDocument;
var doc = app.open(new File('/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg'));
function mk() { var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('adjustmentLayer')); d.putReference(s('null'), r);
  var u = new ActionDescriptor(); u.putObject(s('type'), s('brightnessEvent'), new ActionDescriptor()); d.putObject(s('using'), s('adjustmentLayer'), u); __exec('make', d); }
function set(p) { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('adjustmentLayer'), s('ordinal'), s('targetEnum')); d.putReference(s('null'), r); d.putObject(s('to'), s('brightnessEvent'), p); __exec('set', d); }
function rb() { var a = executeActionGet(__layerRefById(__activeLayerIds()[0])).getList(s('adjustment')).getObjectValue(0), o = {};
  for (var i = 0; i < a.count; i++) { var k = a.getKey(i), t = a.getType(k); o[ts(k)] = t === DescValueType.ENUMERATEDTYPE ? ts(a.getEnumerationValue(k)) : (t === DescValueType.BOOLEANTYPE ? a.getBoolean(k) : a.getDouble ? (function(){ try { return a.getInteger(k); } catch(e) { return a.getDouble(k); } })() : '?'); } return o; }
var out = {};
mk(); var p = new ActionDescriptor(); p.putInteger(s('brightnessExposure'), 30); p.putInteger(s('center'), 10); p.putInteger(s('brightnessHighlights'), -40); p.putInteger(s('brightnessShadows'), 35); p.putInteger(s('brightnessWhites'), 5); p.putInteger(s('brightnessBlacks'), -5); set(p); out.light = rb();
mk(); var q = new ActionDescriptor(); q.putInteger(s('brightness'), 25); q.putInteger(s('center'), 10); q.putBoolean(s('useLegacy'), true); set(q); out.legacy = rb();
mk(); var m = new ActionDescriptor(); m.putEnumerated(s('brightnessMode'), s('brightnessMode'), s('brightnessModeBrightness')); m.putInteger(s('brightness'), 25); m.putInteger(s('center'), 10); try { set(m); out.modeBrightness = rb(); } catch (e) { out.modeBrightness = 'ERR ' + __errMsg(e); }
doc.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = user;
return out;
