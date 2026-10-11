var D = app.activeDocument, out = {};
var a = D.artLayers.add(); a.name = 'A'; D.selection.select([[10,10],[210,10],[210,110],[10,110]]); D.selection.fill(__solid('#00ff00')); D.selection.deselect();
var b = D.artLayers.add(); b.name = 'B';
__selectLayers([a.id, b.id], false); out.multiSelect = __activeLayerIds();
var dup = D.duplicate('dupcheck', false);
var ids = []; __walk(function (d) { ids.push(d.getInteger(s('layerID'))); });
out.dupIds = ids; dup.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = D;
var origIds = []; __walk(function (d) { origIds.push(d.getInteger(s('layerID'))); }); out.origIds = origIds;
// align by math: center A horizontally on canvas
var l = __layer(a.id), bb = l.bounds, w = D.width.as('px');
l.translate(UnitValue(Math.round((w - (bb[2].as('px') - bb[0].as('px'))) / 2 - bb[0].as('px')), 'px'), UnitValue(0, 'px'));
out.centered = __layerInfoById(a.id).bounds;
return out;
