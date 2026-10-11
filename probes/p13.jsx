var out = {};
function try_(n, f) { try { out[n] = f() || 'ok'; } catch (e) { out[n] = 'FAIL ' + __errMsg(e); } }
var user = app.activeDocument;
var D = app.documents.add(UnitValue(1200, 'px'), UnitValue(800, 'px'), 72, 'p13', NewDocumentMode.RGB, DocumentFill.WHITE);
try {
  __ops.place_image({ path: '/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg', bounds: [600, 320, 1100, 720], fit: 'cover' });
  var so = __topId();
  try_('subjectOn1200doc', function () { return __ops.selection({ action: 'subject', layer: so }); });
  D.selection.deselect();
  try_('subjectAllLayers', function () { return __ops.selection({ action: 'subject' }); });
  D.selection.deselect();
  __ops.place_image({ path: '/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg', bounds: [0, 0, 1200, 800], fit: 'cover' });
  var so2 = __topId();
  try_('subjectFullCanvasPhoto', function () { return __ops.selection({ action: 'subject', layer: so2 }); });
} finally { D.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = user; }
return out;
