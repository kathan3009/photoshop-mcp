var out = {}, D = app.activeDocument;
function try_(n, f) { try { out[n] = f() || 'ok'; } catch (e) { out[n] = 'FAIL ' + __errMsg(e); } }
function maskAdd(how) { var d = new ActionDescriptor(); d.putClass(s('new'), s('channel')); var r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('mask')); d.putReference(s('at'), r); d.putEnumerated(s('using'), s('userMaskEnabled'), s(how)); __exec('make', d); }
function selMask() { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('mask')); d.putReference(s('null'), r); d.putBoolean(s('makeVisible'), false); __exec('select', d); }
function selRGB() { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('RGB')); d.putReference(s('null'), r); d.putBoolean(s('makeVisible'), false); __exec('select', d); }
var d0 = new ActionDescriptor(); d0.putPath(s('null'), new File('/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg')); __exec('placeEvent', d0);
maskAdd('revealAll');
try_('subjectWithMaskTargeted', function () { var d = new ActionDescriptor(); d.putBoolean(s('sampleAllLayers'), false); __exec('autoCutout', d); return __selBounds(D); });
D.selection.deselect();
try_('docHistMaskTargeted', function () { return D.histogram.length; });
selMask(); __exec('invert');
try_('docHistAfterMaskInvert', function () { return D.histogram.length; });
try_('selRGB', function () { selRGB(); return 'selected'; });
try_('docHistAfterRGB', function () { return D.histogram.length; });
try_('subjectAfterRGB', function () { var d = new ActionDescriptor(); d.putBoolean(s('sampleAllLayers'), false); __exec('autoCutout', d); return __selBounds(D); });
return out;
