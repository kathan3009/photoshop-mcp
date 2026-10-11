var out = {}, step;
function attempt(name, fn) { step = name; try { var r = fn(); out[name] = r === undefined ? 'ok' : r; } catch (e) { out[name] = 'FAIL: ' + __errMsg(e); } }
function top() { return __layerInfoById(__activeLayerIds()[0]); }
function px(v) { return v; }

attempt('shapeRect', function () {
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('contentLayer')); d.putReference(s('null'), r);
  var ld = new ActionDescriptor(), cd = new ActionDescriptor();
  cd.putObject(s('color'), s('RGBColor'), __rgbDesc('#ff3366'));
  ld.putObject(s('type'), s('solidColorLayer'), cd);
  var sh = new ActionDescriptor();
  sh.putUnitDouble(s('top'), s('pixelsUnit'), 100); sh.putUnitDouble(s('left'), s('pixelsUnit'), 100);
  sh.putUnitDouble(s('bottom'), s('pixelsUnit'), 300); sh.putUnitDouble(s('right'), s('pixelsUnit'), 500);
  sh.putUnitDouble(s('topLeft'), s('pixelsUnit'), 24); sh.putUnitDouble(s('topRight'), s('pixelsUnit'), 24);
  sh.putUnitDouble(s('bottomLeft'), s('pixelsUnit'), 24); sh.putUnitDouble(s('bottomRight'), s('pixelsUnit'), 24);
  ld.putObject(s('shape'), s('rectangle'), sh);
  d.putObject(s('using'), s('contentLayer'), ld);
  __exec('make', d); return top();
});
attempt('shapeEllipse', function () {
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('contentLayer')); d.putReference(s('null'), r);
  var ld = new ActionDescriptor(), cd = new ActionDescriptor();
  cd.putObject(s('color'), s('RGBColor'), __rgbDesc('#33aaff')); ld.putObject(s('type'), s('solidColorLayer'), cd);
  var sh = new ActionDescriptor();
  sh.putUnitDouble(s('top'), s('pixelsUnit'), 400); sh.putUnitDouble(s('left'), s('pixelsUnit'), 600);
  sh.putUnitDouble(s('bottom'), s('pixelsUnit'), 600); sh.putUnitDouble(s('right'), s('pixelsUnit'), 900);
  ld.putObject(s('shape'), s('ellipse'), sh); d.putObject(s('using'), s('contentLayer'), ld);
  __exec('make', d); return top();
});
attempt('solidFill', function () {
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('contentLayer')); d.putReference(s('null'), r);
  var ld = new ActionDescriptor(), cd = new ActionDescriptor();
  cd.putObject(s('color'), s('RGBColor'), __rgbDesc('#203040')); ld.putObject(s('type'), s('solidColorLayer'), cd);
  d.putObject(s('using'), s('contentLayer'), ld); __exec('make', d); return top();
});
attempt('gradientFill', function () {
  var d = new ActionDescriptor(), r = new ActionReference(); r.putClass(s('contentLayer')); d.putReference(s('null'), r);
  var ld = new ActionDescriptor(), gd = new ActionDescriptor();
  gd.putUnitDouble(s('angle'), s('angleUnit'), 90);
  gd.putEnumerated(s('type'), s('gradientType'), s('linear'));
  var g = new ActionDescriptor(); g.putString(s('name'), 'MCP'); g.putEnumerated(s('gradientForm'), s('gradientForm'), s('customStops')); g.putDouble(s('interfaceIconFrameDimmed'), 4096);
  var cl = new ActionList(), st = [['#000000', 0], ['#ffffff', 4096]];
  for (var i = 0; i < 2; i++) { var x = new ActionDescriptor(); x.putObject(s('color'), s('RGBColor'), __rgbDesc(st[i][0])); x.putEnumerated(s('type'), s('colorStopType'), s('userStop')); x.putInteger(s('location'), st[i][1]); x.putInteger(s('midpoint'), 50); cl.putObject(s('colorStop'), x); }
  g.putList(s('colors'), cl);
  var tl = new ActionList(), op = [100, 0];
  for (var j = 0; j < 2; j++) { var t = new ActionDescriptor(); t.putUnitDouble(s('opacity'), s('percentUnit'), op[j]); t.putInteger(s('location'), j * 4096); t.putInteger(s('midpoint'), 50); tl.putObject(s('transferSpec'), t); }
  g.putList(s('transparency'), tl);
  gd.putObject(s('gradient'), s('gradientClassEvent'), g);
  ld.putObject(s('type'), s('gradientLayer'), gd);
  d.putObject(s('using'), s('contentLayer'), ld); __exec('make', d); return top();
});
attempt('placeImage', function () {
  var d = new ActionDescriptor();
  d.putPath(s('null'), new File('/Users/kathan/Developer/photoshop-mcp/test/fixtures/photo.jpg'));
  d.putEnumerated(s('freeTransformCenterState'), s('quadCenterState'), s('QCSAverage'));
  __exec('placeEvent', d); return top();
});
attempt('scaleAndMoveSmartObject', function () {
  var l = app.activeDocument.activeLayer; l.resize(25, 25, AnchorPosition.TOPLEFT);
  var b = l.bounds; l.translate(UnitValue(50 - b[0].as('px'), 'px'), UnitValue(50 - b[1].as('px'), 'px')); return top();
});
attempt('gaussianOnSmartObject', function () {
  var d = new ActionDescriptor(); d.putUnitDouble(s('radius'), s('pixelsUnit'), 4); __exec('gaussianBlur', d);
  var ld = executeActionGet(__layerRefById(__activeLayerIds()[0]));
  return { smartFilters: ld.hasKey(s('smartObject')) && ld.getObjectValue(s('smartObject')).hasKey(s('filterFX')) };
});
attempt('selectBackgroundThenSubject', function () {
  __selectLayers([1], false);
  var d = new ActionDescriptor(); d.putBoolean(s('sampleAllLayers'), false); __exec('autoCutout', d);
  var b = app.activeDocument.selection.bounds; return [b[0].as('px'), b[1].as('px'), b[2].as('px'), b[3].as('px')];
});
attempt('pixelLayerFromSelectionMask', function () {
  var l = app.activeDocument.artLayers.add(); l.name = 'Masked';
  var d = new ActionDescriptor(); d.putClass(s('new'), s('channel'));
  var r = new ActionReference(); r.putEnumerated(s('channel'), s('channel'), s('mask')); d.putReference(s('at'), r);
  d.putEnumerated(s('using'), s('userMaskEnabled'), s('revealSelection'));
  __exec('make', d); return top();
});
attempt('deselect', function () { app.activeDocument.selection.deselect(); });
attempt('clipToBelow', function () { var d = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(s('layer'), s('ordinal'), s('targetEnum')); d.putReference(s('null'), r); __exec('groupEvent', d); return top(); });
attempt('unsharpOnBackground', function () {
  __selectLayers([1], false);
  var d = new ActionDescriptor(); d.putUnitDouble(s('amount'), s('percentUnit'), 80); d.putUnitDouble(s('radius'), s('pixelsUnit'), 1.2); d.putInteger(s('threshold'), 2); __exec('unsharpMask', d);
});
attempt('addNoise', function () {
  var d = new ActionDescriptor(); d.putEnumerated(s('distribution'), s('distribution'), s('gaussianDistribution')); d.putUnitDouble(s('noise'), s('percentUnit'), 3); d.putBoolean(s('monochromatic'), true); __exec('addNoise', d);
});
attempt('highPass', function () { var d = new ActionDescriptor(); d.putUnitDouble(s('radius'), s('pixelsUnit'), 2); __exec('highPass', d); });
attempt('convertToSmartObject', function () { __exec('newPlacedLayer'); return top(); });
var all = []; __walk(function (d, path) { var i = __readLayerDesc(d); all.push(i.id + ' ' + path + ' [' + i.type + (i.clipped ? ',clipped' : '') + (i.mask ? ',mask' : '') + ']'); });
out.final = all;
return out;
