var out = {}, D = app.activeDocument;
function try_(n, f) { try { out[n] = f() || 'ok'; } catch (e) { out[n] = 'FAIL ' + __errMsg(e); } }
__ops.place_image({ path: '/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg', bounds: [600, 320, 1100, 720], fit: 'cover' });
var so = __topId();
__ops.adjustment({ type: 'hueSaturation', params: { saturation: -100 }, clipTo: so });
__ops.selection({ action: 'rect', bounds: [100, 100, 400, 300] });
__ops.selection({ action: 'feather', radius: 10 });
__ops.adjustment({ type: 'exposure', params: { exposure: -0.5 } });
out.selAfterAdj = __selBounds(D);
try_('subjectNow', function () { return __ops.selection({ action: 'subject', layer: so }); });
D.selection.deselect();
try_('subjectNoSel', function () { return __ops.selection({ action: 'subject', layer: so }); });
return out;
