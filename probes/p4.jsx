function mk() { var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('adjustmentLayer')); d.putReference(s('null'), r);
  var u = new ActionDescriptor(); u.putObject(s('type'), s('brightnessEvent'), new ActionDescriptor()); d.putObject(s('using'), s('adjustmentLayer'), u); __exec('make', d); }
function set(p) { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('adjustmentLayer'), s('ordinal'), s('targetEnum')); d.putReference(s('null'), r); d.putObject(s('to'), s('brightnessEvent'), p); __exec('set', d); }
function rb() { var a = executeActionGet(__layerRefById(__activeLayerIds()[0])).getList(s('adjustment')).getObjectValue(0), o = {};
  for (var i = 0; i < a.count; i++) { var k = a.getKey(i), t = a.getType(k);
    try { o[ts(k)] = t === DescValueType.ENUMERATEDTYPE ? ts(a.getEnumerationValue(k)) : t === DescValueType.BOOLEANTYPE ? a.getBoolean(k) : t === DescValueType.INTEGERTYPE ? a.getInteger(k) : t === DescValueType.DOUBLETYPE ? a.getDouble(k) : String(t); } catch (e) { o[ts(k)] = 'ERR ' + String(t); } }
  return o; }
var out = {}, step = "start";
try { step="mk1"; mk(); out.defaults = rb();
var p = new ActionDescriptor(); p.putEnumerated(s('brightnessMode'), s('brightnessMode'), s('brightnessModeLight'));
p.putInteger(s('brightnessExposure'), 30); p.putInteger(s('center'), 10); p.putInteger(s('brightnessHighlights'), -40); p.putInteger(s('brightnessShadows'), 35); p.putInteger(s('brightnessWhites'), 5); p.putInteger(s('brightnessBlacks'), -5);
step="setLight"; set(p); out.light = rb();
step="modern"; mk(); var m = new ActionDescriptor(); m.putEnumerated(s('brightnessMode'), s('brightnessMode'), s('brightnessModeModern')); m.putInteger(s('brightness'), 25); m.putInteger(s('center'), 10); set(m); out.modern = rb();
} catch (e) { out.failedAt = step; out.error = __errMsg(e) + " #" + e.number; } return out;
