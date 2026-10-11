var out = {}, D = app.activeDocument;
function try_(n, f) { try { out[n] = f() || 'ok'; } catch (e) { out[n] = 'FAIL ' + __errMsg(e); } }
var n0 = D.historyStates.length;
try_('makeSnapshot', function () {
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('snapshotClass')); d.putReference(s('null'), r);
  var f = new ActionReference(); f.putProperty(s('historyState'), s('currentHistoryState')); d.putReference(s('from'), f);
  d.putString(s('name'), 'MCP checkpoint'); d.putEnumerated(s('using'), s('historyState'), s('fullDocument'));
  __exec('make', d);
});
out.statesAdded = D.historyStates.length - n0;
var names = []; for (var i = 0; i < D.historyStates.length; i++) names.push(D.historyStates[i].name + (D.historyStates[i].snapshot ? ' [snap]' : ''));
out.states = names;
D.artLayers.add().name = 'after';
try_('revertToSnapshot', function () {
  for (var i = 0; i < D.historyStates.length; i++) if (D.historyStates[i].snapshot && D.historyStates[i].name === 'MCP checkpoint') { D.activeHistoryState = D.historyStates[i]; return 'reverted, layers=' + D.layers.length; }
  return 'not found';
});
return out;
