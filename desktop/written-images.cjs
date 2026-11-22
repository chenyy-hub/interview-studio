'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function storeImage(buffer, directory, nativeImage) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 15 * 1024 * 1024) throw new Error('图片须在 15 MB 以内');
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error('图片格式无法识别，请使用 PNG、JPEG 或 WebP');
  const size = image.getSize();
  if (size.width * size.height > 24000000) throw new Error('图片尺寸过大，请先裁剪到题目区域');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, require('node:crypto').randomUUID() + '.png');
  fs.writeFileSync(filename, image.toPNG(), { mode: 0o600 });
  const preview = image.resize({ width: Math.min(size.width, 1000) }).toDataURL();
  return { path: filename, preview };
}
module.exports = { storeImage };
