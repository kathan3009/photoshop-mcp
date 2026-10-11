var out = {}, D = app.activeDocument;
function try_(n, f) { try { out[n] = f() || 'ok'; } catch (e) { out[n] = 'FAIL ' + __errMsg(e); } }
function subj(all) { var d = new ActionDescriptor(); d.putBoolean(s('sampleAllLayers'), all); __exec('autoCutout', d); return __selBounds(D); }
__ops.place_image({ path: '/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg', bounds: [600, 320, 1100, 720], fit: 'cover' });
var so = __topId();
try_('coverMasked', function () { __selectLayers([so], false); return subj(false); }); D.selection.deselect();
try_('coverMaskedAll', function () { __selectLayers([so], false); return subj(true); }); D.selection.deselect();
__ops.place_image({ path: '/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg', bounds: [600, 320, 1100, 720], fit: 'contain' });
var so2 = __topId();
try_('containSmall', function () { __selectLayers([so2], false); return subj(false); }); D.selection.deselect();
return out;
