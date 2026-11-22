const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegionCapture } = require('./capture-regions.cjs');

test('repeat capture reuses the confirmed region without opening another cropper, and never requests focus', async () => {
  let selections = 0, scale = 1;
  const bounds = {x:10,y:10,width:200,height:100}, used = [];
  const original = async () => { selections++; return bounds; };
  const state = { cropperWindowHelper: { showCropper: original } };
  const capture = { takeSelectiveScreenshot: async (state, focus) => { assert.equal(focus,false); used.push(await state.cropperWindowHelper.showCropper()); return 'image.png'; } };
  const controller = createRegionCapture({ appState: state, capture, screen: { getAllDisplays: () => [{id:1,bounds:{x:0,y:0,width:1920,height:1080},scaleFactor:scale}] } });
  await assert.rejects(controller.run({repeat:true}), /请先选择/);
  await controller.run(); await controller.run({repeat:true});
  assert.equal(selections, 1); assert.deepEqual(used, [bounds,bounds]); assert.equal(state.cropperWindowHelper.showCropper, original);
  scale = 1.25; assert.equal(controller.status().canRepeat, false);
  await assert.rejects(controller.run({repeat:true}), /缩放变化/);
});

test('cancelled selection restores the helper and cannot overwrite a previous region', async () => {
  const original = async () => null;
  const state = { cropperWindowHelper: { showCropper: original } };
  const controller = createRegionCapture({appState: state, screen:{getAllDisplays:()=>[]}, capture:{takeSelectiveScreenshot:async state=>{await state.cropperWindowHelper.showCropper();throw new Error('Selection cancelled');}}});
  await assert.rejects(controller.run(), /cancelled/); assert.equal(controller.status().canRepeat,false); assert.equal(state.cropperWindowHelper.showCropper,original);
});
