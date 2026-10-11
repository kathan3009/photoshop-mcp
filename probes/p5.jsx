function mk() { var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('adjustmentLayer')); d.putReference(s('null'), r);
  var u = new ActionDescriptor(); u.putObject(s('type'), s('brightnessEvent'), new ActionDescriptor()); d.putObject(s('using'), s('adjustmentLayer'), u); __exec('make', d); }
function set(p) { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('adjustmentLayer'), s('ordinal'), s('targetEnum')); d.putReference(s('null'), r); d.putObject(s('to'), s('brightnessEvent'), p); __exec('set', d); }
var out = [];
var tries = [[2, 'int'], [-3, 'int'], [1.5, 'double'], [4, 'int'], [-5, 'int'], [8, 'int']];
for (var i = 0; i < tries.length; i++) {
  mk(); var p = new ActionDescriptor(); p.putEnumerated(s('brightnessMode'), s('brightnessMode'), s('brightnessModeLight'));
  if (tries[i][1] === 'int') p.putInteger(s('brightnessExposure'), tries[i][0]); else p.putDouble(s('brightnessExposure'), tries[i][0]);
  set(p);
  var a = executeActionGet(__layerRefById(__activeLayerIds()[0])).getList(s('adjustment')).getObjectValue(0);
  var v; try { v = a.getInteger(s('brightnessExposure')); } catch (e) { v = a.getDouble(s('brightnessExposure')); }
  out.push(tries[i][0] + ' -> ' + v);
}
return out;
