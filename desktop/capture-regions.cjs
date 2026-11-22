'use strict';

function createRegionCapture({ appState, capture, screen }) {
  let lastRegion = null, busy = false;
  const displays = () => JSON.stringify(screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, rotation: d.rotation })).sort((a, b) => a.id - b.id));
  const status = () => ({ canRepeat: !!lastRegion && lastRegion.displays === displays() });
  async function run({ area = true, repeat = false } = {}) {
    if (busy) throw new Error('正在截图，请完成或取消当前选区');
    if (repeat && !status().canRepeat) throw new Error('请先选择截图区域；显示器或缩放变化后需要重新选择');
    busy = true;
    const helper = appState.cropperWindowHelper;
    const original = helper.showCropper;
    let selected;
    const signature = displays();
    try {
      if (area !== false) helper.showCropper = async (...args) => {
        selected = repeat ? { ...lastRegion.bounds } : await original.apply(helper, args);
        return selected;
      };
      const image = await (area === false ? capture.takeScreenshot(appState, false) : capture.takeSelectiveScreenshot(appState, false));
      if (selected && signature === displays()) lastRegion = { bounds: { ...selected }, displays: signature };
      return image;
    } finally { helper.showCropper = original; busy = false; }
  }
  return { run, status };
}
module.exports = { createRegionCapture };
