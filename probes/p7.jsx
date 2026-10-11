var out = {};
function attempt(name, fn) { try { var r = fn(); out[name] = r === undefined ? 'ok' : r; } catch (e) { out[name] = 'FAIL: ' + __errMsg(e) + ' (line ' + e.line + ')'; } }
function top() { return __layerInfoById(__activeLayerIds()[0]); }
var D = app.activeDocument;
var a1 = D.artLayers.add(); a1.name = 'A'; var a2 = D.artLayers.add(); a2.name = 'B';
D.selection.select([[10, 10], [210, 10], [210, 110], [10, 110]]); D.selection.fill(__solid('#ff0000')); D.selection.deselect();

attempt('paragraphText', function () {
  var l = D.artLayers.add(); l.kind = LayerKind.TEXT; var t = l.textItem;
  t.kind = TextType.PARAGRAPHTEXT; t.contents = 'A paragraph of text that should wrap inside its box nicely.';
  t.position = [UnitValue(100, 'px'), UnitValue(100, 'px')]; t.width = UnitValue(400, 'px'); t.height = UnitValue(300, 'px');
  t.size = UnitValue(36, 'px'); t.justification = Justification.CENTER; t.tracking = 50; t.useAutoLeading = false; t.leading = UnitValue(48, 'px');
  t.font = 'Helvetica-Bold'; return top();
});
attempt('groupSelected', function () {
  __selectLayers([a1.id, a2.id], false);
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('layerSection')); d.putReference(s('null'), r);
  var fr = new ActionReference(); fr.putEnumerated(s('layer'), s('ordinal'), s('targetEnum')); d.putReference(s('from'), fr);
  var u = new ActionDescriptor(); u.putString(s('name'), 'MyGroup'); d.putObject(s('using'), s('layerSection'), u);
  __exec('make', d); return top();
});
attempt('alignCenterToCanvas', function () {
  __selectLayers([a2.id], false);
  var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('layer'), s('ordinal'), s('targetEnum')); d.putReference(s('null'), r);
  d.putEnumerated(s('using'), s('alignDistributeSelector'), s('ADSCentersH')); d.putBoolean(s('alignToCanvas'), true);
  __exec('align', d); return top().bounds;
});
attempt('moveLayerToTop', function () { var l = __layer(a1.id); l.move(D, ElementPlacement.PLACEATBEGINNING); return __flatLayers(); });
attempt('ungroup', function () { var g = __resolveId('MyGroup'); __selectLayers([g], false); __exec('ungroupLayersEvent', (function () { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('layer'), s('ordinal'), s('targetEnum')); d.putReference(s('null'), r); return d; })()); return __flatLayers().length; });
attempt('mergeTwo', function () { __selectLayers([a1.id, a2.id], false); __exec('mergeLayersNew'); return top(); });
attempt('histogram', function () { var h = D.histogram; var r = D.channels[0].histogram; return { lum: h.length, red: r.length, red128: r[128] }; });
attempt('histogramInSelection', function () { D.selection.select([[0, 0], [100, 0], [100, 100], [0, 100]]); var h = D.histogram, n = 0; for (var i = 0; i < 256; i++) n += h[i]; D.selection.deselect(); return n; });
attempt('colorSampler', function () { var cs = D.colorSamplers.add([UnitValue(800, 'px'), UnitValue(450, 'px')]); var col = cs.color.rgb; var r = [col.red, col.green, col.blue]; cs.remove(); return r; });
attempt('exif', function () { return { exifCount: D.info.exif.length, sample: D.info.exif.slice(0, 4) }; });
attempt('xmp', function () { var r = new ActionReference(); r.putProperty(s('property'), s('XMPMetadataAsUTF8')); r.putEnumerated(s('document'), s('ordinal'), s('targetEnum')); var x = executeActionGet(r).getString(s('XMPMetadataAsUTF8')); return x.length; });
attempt('actionSets', function () {
  var sets = [], i = 1;
  while (true) { var r = new ActionReference(); r.putIndex(s('actionSet'), i); var d; try { d = executeActionGet(r); } catch (e) { break; }
    var name = d.getString(s('name')), n = d.hasKey(s('numberOfChildren')) ? d.getInteger(s('numberOfChildren')) : 0, acts = [];
    for (var j = 1; j <= Math.min(n, 3); j++) { var ar = new ActionReference(); ar.putIndex(s('action'), j); ar.putIndex(s('actionSet'), i); acts.push(executeActionGet(ar).getString(s('name'))); }
    sets.push({ name: name, count: n, first: acts }); i++; }
  return sets;
});
attempt('fontsMatching', function () { var f = app.fonts, hits = [], n = f.length; for (var i = 0; i < n && hits.length < 5; i++) if (/helvetica/i.test(f[i].name)) hits.push(f[i].postScriptName + ' | ' + f[i].family + ' ' + f[i].style); return { total: n, hits: hits }; });
attempt('rasterizeText', function () { var id = __activeLayerIds()[0]; var t = __flatLayers(); for (var i = 0; i < t.length; i++) if (/paragraph/i.test(t[i].name)) { __selectLayers([t[i].id], false); __exec('rasterizeLayer', (function () { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('layer'), s('ordinal'), s('targetEnum')); d.putReference(s('null'), r); return d; })()); return top(); } });
return out;
