var out = {};
function try_(n, f) { try { out[n] = f() || 'ok'; } catch (e) { out[n] = 'FAIL ' + __errMsg(e); } }
var d0 = new ActionDescriptor(); d0.putPath(s('null'), new File('/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg')); __exec('placeEvent', d0);
var so = __topId();
try_('soNoSample', function () { var d = new ActionDescriptor(); d.putBoolean(s('sampleAllLayers'), false); __exec('autoCutout', d); return __selBounds(app.activeDocument); });
app.activeDocument.selection.deselect();
try_('soSampleAll', function () { __selectLayers([so], false); var d = new ActionDescriptor(); d.putBoolean(s('sampleAllLayers'), true); __exec('autoCutout', d); return __selBounds(app.activeDocument); });
app.activeDocument.selection.deselect();
try_('soWithExistingSelection', function () { app.activeDocument.selection.select([[0,0],[100,0],[100,100],[0,100]]); __selectLayers([so], false); var d = new ActionDescriptor(); d.putBoolean(s('sampleAllLayers'), false); __exec('autoCutout', d); return __selBounds(app.activeDocument); });
app.activeDocument.selection.deselect();
// adjustment layer active (mask channel targeted) then subject
try_('afterAdjMask', function () {
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('adjustmentLayer')); d.putReference(s('null'), r);
  var u = new ActionDescriptor(); u.putObject(s('type'), s('invert'), new ActionDescriptor()); d.putObject(s('using'), s('adjustmentLayer'), u); __exec('make', d);
  __selectLayers([so], false); var e = new ActionDescriptor(); e.putBoolean(s('sampleAllLayers'), false); __exec('autoCutout', e); return __selBounds(app.activeDocument); });
app.activeDocument.selection.deselect();
try_('histAfterMaskTargeted', function () {
  var d = new ActionDescriptor(); d.putClass(s('new'), s('channel')); var r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('mask')); d.putReference(s('at'), r); d.putEnumerated(s('using'), s('userMaskEnabled'), s('revealAll')); __exec('make', d);
  try { var h = app.activeDocument.channels[0].histogram; return 'hist ok'; } catch (e) { return 'hist FAIL ' + __errMsg(e) + ' | active channels: ' + app.activeDocument.activeChannels.length + ' ' + app.activeDocument.activeChannels[0].name; } });
try_('histAfterSelectRGB', function () { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('RGB')); d.putReference(s('null'), r); __exec('select', d); var h = app.activeDocument.channels[0].histogram; return 'ok ' + h.length; });
return out;
