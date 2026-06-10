/**
 * gina-core/renderer.js
 *
 * フキダシ・縦書きテキストのレンダリングコア。
 * ブラウザ/DOM に依存しない純粋な Canvas 2D Context ベースの実装。
 *
 * このファイルの関数はすべて src/main.js の同名関数と完全に同じロジックを持つ。
 * main.js 側は変更せず、GUI は引き続き main.js 内のコピーを使う。
 * CLI (gina-render) はこのファイルを直接 require する。
 */

'use strict';

// --- フォント設定 ---
// src/main.js の FONTS 定数と同一
const FONTS = [
  { name: 'GenEiAntiquePv6', file: 'assets/fonts/GenEiAntiquePv6-M.ttf' },
  { name: 'GenEiAntiqueNv6', file: 'assets/fonts/GenEiAntiqueNv6-M.ttf' },
  { name: 'ChikaraDzuyoku', file: 'assets/fonts/851CHIKARA-DZUYOKU_kanaA_004.ttf' },
];

// --- フキダシ定数 (src/main.js と同値) ---
const BUBBLE_PADDING_X = 32;
const BUBBLE_PADDING_Y = 20;
const BUBBLE_BORDER = 3;
const BUBBLE_MIN_RX = 70;
const BUBBLE_MIN_RY = 46;
const BUBBLE_TAIL_OFFSET_X = -8;
const BUBBLE_TAIL_OFFSET_Y = 70;
const BUBBLE_TAIL_HALF_ANGLE = 0.18;

const MONOLOGUE_PADDING = 12;
const MONOLOGUE_BORDER = 2;

// --- テキスト処理 ---

function splitTextLines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function setupTextContext(ctx, layer) {
  ctx.fillStyle = '#000';
  ctx.font = `${layer.size}px "${layer.font}", sans-serif`;
}

function getVerticalGlyphOffset(char, size) {
  if ('、。，．､｡'.includes(char)) {
    return { x: size * 0.25, y: -size * 0.45 };
  }
  return { x: 0, y: 0 };
}

function drawVerticalGlyph(ctx, char, x, y, size) {
  const offset = getVerticalGlyphOffset(char, size);
  const drawX = x + offset.x;
  const drawY = y + offset.y;
  if ('…‥ーｰ'.includes(char)) {
    ctx.save();
    ctx.translate(drawX, drawY + size / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(char, 0, -size / 2);
    ctx.restore();
    return;
  }
  ctx.fillText(char, drawX, drawY);
}

// テキスト横幅の計測用共有キャンバス（createCanvas はコール時に注入される）
let _measureCanvas = null;

function setMeasureCanvas(canvas) {
  _measureCanvas = canvas;
}

function getMeasureCtx(layer) {
  if (!_measureCanvas) throw new Error('renderer: measureCanvas not initialized');
  const ctx = _measureCanvas.getContext('2d');
  setupTextContext(ctx, layer);
  return ctx;
}

// --- テキスト矩形計測 ---

function measureBubbleTextRect(layer) {
  const lines = splitTextLines(layer.text);
  const lineAdvance = layer.size * layer.lineHeight;
  if (layer.orientation === 'vertical') {
    const columns = Math.max(lines.length, 1);
    const rows = Math.max(...lines.map((l) => [...l].length), 1);
    return {
      x: -lineAdvance * (columns - 1),
      y: 0,
      width: lineAdvance * (columns - 1) + layer.size,
      height: lineAdvance * (rows - 1) + layer.size,
    };
  }
  const ctx = getMeasureCtx(layer);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width), layer.size);
  return { x: 0, y: 0, width, height: Math.max(lines.length, 1) * lineAdvance };
}

function measureTextLayerBounds(layer) {
  const padding = layer.kind === 'monologue' ? MONOLOGUE_PADDING : 0;
  const lines = splitTextLines(layer.text);
  const lineAdvance = layer.size * layer.lineHeight;
  if (layer.orientation === 'vertical') {
    const columns = Math.max(lines.length, 1);
    const rows = Math.max(...lines.map((l) => [...l].length), 1);
    return {
      x: -lineAdvance * (columns - 1) - padding,
      y: -padding,
      width: lineAdvance * (columns - 1) + layer.size + padding * 2,
      height: lineAdvance * (rows - 1) + layer.size + padding * 2,
    };
  }
  const ctx = getMeasureCtx(layer);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width), layer.size);
  return {
    x: -padding,
    y: -padding,
    width: width + padding * 2,
    height: Math.max(lines.length, 1) * lineAdvance + padding * 2,
  };
}

// --- フキダシジオメトリ ---

function computeBubbleShape(layer) {
  const textRect = measureBubbleTextRect(layer);
  const cx = textRect.x + textRect.width / 2;
  const cy = textRect.y + textRect.height / 2;
  const halfW = textRect.width / 2 + BUBBLE_PADDING_X;
  const halfH = textRect.height / 2 + BUBBLE_PADDING_Y;
  const rx = Math.max(halfW * Math.SQRT2, BUBBLE_MIN_RX);
  const ry = Math.max(halfH * Math.SQRT2, BUBBLE_MIN_RY);
  const tipX = cx + BUBBLE_TAIL_OFFSET_X;
  const tipY = cy + BUBBLE_TAIL_OFFSET_Y;
  const tipAngle = Math.atan2((tipY - cy) * rx, (tipX - cx) * ry);
  return { cx, cy, rx, ry, tipX, tipY, tipAngle };
}

function drawSpeechBubblePath(ctx, shape) {
  const { cx, cy, rx, ry, tipX, tipY, tipAngle } = shape;
  const a1 = tipAngle - BUBBLE_TAIL_HALF_ANGLE;
  const a2 = tipAngle + BUBBLE_TAIL_HALF_ANGLE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, a2, a1 + 2 * Math.PI);
  ctx.lineTo(tipX, tipY);
  ctx.closePath();
}

// --- 描画関数 ---

function drawBubbleBox(ctx, layer) {
  const shape = computeBubbleShape(layer);
  ctx.save();
  ctx.translate(layer.x, layer.y);
  drawSpeechBubblePath(ctx, shape);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = BUBBLE_BORDER;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  ctx.stroke();
  ctx.restore();
}

function drawMonologueBox(ctx, layer) {
  const bounds = measureTextLayerBounds(layer);
  const x = layer.x + bounds.x;
  const y = layer.y + bounds.y;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, bounds.width, bounds.height);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = MONOLOGUE_BORDER;
  const inset = MONOLOGUE_BORDER / 2;
  ctx.strokeRect(x + inset, y + inset, bounds.width - MONOLOGUE_BORDER, bounds.height - MONOLOGUE_BORDER);
}

function drawHorizontalTextLayer(ctx, layer) {
  setupTextContext(ctx, layer);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lineAdvance = layer.size * layer.lineHeight;
  splitTextLines(layer.text).forEach((line, index) => {
    ctx.fillText(line, layer.x, layer.y + lineAdvance * index);
  });
}

function drawVerticalTextLayer(ctx, layer) {
  setupTextContext(ctx, layer);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const charAdvance = layer.size * layer.lineHeight;
  const columnAdvance = layer.size * layer.lineHeight;
  splitTextLines(layer.text).forEach((column, columnIndex) => {
    const x = layer.x + layer.size / 2 - columnAdvance * columnIndex;
    for (const [charIndex, char] of [...column].entries()) {
      drawVerticalGlyph(ctx, char, x, layer.y + charAdvance * charIndex, layer.size);
    }
  });
}

function drawTextLayer(ctx, layer) {
  if (layer.kind === 'monologue') {
    drawMonologueBox(ctx, layer);
  } else if (layer.kind === 'bubble') {
    drawBubbleBox(ctx, layer);
  }
  if (layer.orientation === 'vertical') {
    drawVerticalTextLayer(ctx, layer);
  } else {
    drawHorizontalTextLayer(ctx, layer);
  }
}

// --- render-spec → layer 変換 ---

const ELEMENT_DEFAULTS = {
  font: 'GenEiAntiquePv6',
  fontSize: 24,
  lineHeight: 1.1,
  writing: 'horizontal',
};

/**
 * render-spec の element オブジェクトを
 * drawTextLayer が期待する layer オブジェクトに変換する。
 */
function specElementToLayer(el, index) {
  const id = el.id || `el_${index}`;
  const font = el.font || ELEMENT_DEFAULTS.font;
  const size = typeof el.fontSize === 'number' ? el.fontSize : ELEMENT_DEFAULTS.fontSize;
  const lineHeight = typeof el.lineHeight === 'number' ? el.lineHeight : ELEMENT_DEFAULTS.lineHeight;
  const orientation = el.writing === 'vertical' ? 'vertical' : 'horizontal';

  if (el.type === 'bubble') {
    return {
      id,
      kind: 'bubble',
      text: el.text,
      x: el.x,
      y: el.y,
      font,
      size,
      lineHeight,
      orientation,
    };
  }
  if (el.type === 'monologue') {
    return {
      id,
      kind: 'monologue',
      text: el.text,
      x: el.x,
      y: el.y,
      font,
      size,
      lineHeight,
      orientation,
    };
  }
  // type: "text"
  return {
    id,
    kind: 'text',
    text: el.text,
    x: el.x,
    y: el.y,
    font,
    size,
    lineHeight,
    orientation,
  };
}

// --- メインレンダリング関数 ---

/**
 * renderSpec(spec, options) → Promise<Buffer>
 *
 * @param {object} spec - パース済みの render-spec JSON
 * @param {object} options
 * @param {Function} options.createCanvas - node-canvas の createCanvas
 * @param {Function} options.loadImage   - node-canvas の loadImage
 * @param {string}  [options.basePath]   - spec ファイルのあるディレクトリ（相対パス解決用）
 * @returns {Promise<Buffer>} PNG バイト列
 */
async function renderSpec(spec, { createCanvas, loadImage, basePath = process.cwd() } = {}) {
  const path = require('path');

  // キャンバスサイズ決定
  let canvasW = (spec.canvas && spec.canvas.width) || 1200;
  let canvasH = (spec.canvas && spec.canvas.height) || 1700;

  // ベース画像のロード
  let baseImg = null;
  if (spec.base_image) {
    const imgPath = path.isAbsolute(spec.base_image)
      ? spec.base_image
      : path.join(basePath, spec.base_image);
    baseImg = await loadImage(imgPath);
    if (!spec.canvas) {
      canvasW = baseImg.width;
      canvasH = baseImg.height;
    }
  }

  // canvas 生成
  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  // 測定用 canvas を初期化
  setMeasureCanvas(createCanvas(1, 1));

  // 背景
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // ベース画像描画
  if (baseImg) {
    ctx.drawImage(baseImg, 0, 0, canvasW, canvasH);
  }

  // elements を描画
  for (const [i, el] of (spec.elements || []).entries()) {
    if (el.type === 'sfx') {
      // sfx は v0.1 未実装: 警告して skip
      process.stderr.write(`WARN: element[${i}] type "sfx" is not implemented in v0.1, skipping\n`);
      continue;
    }
    const layer = specElementToLayer(el, i);
    drawTextLayer(ctx, layer);
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  FONTS,
  renderSpec,
  // 内部関数も export（テスト・GUI再利用用）
  splitTextLines,
  setupTextContext,
  getVerticalGlyphOffset,
  drawVerticalGlyph,
  measureBubbleTextRect,
  measureTextLayerBounds,
  computeBubbleShape,
  drawSpeechBubblePath,
  drawBubbleBox,
  drawMonologueBox,
  drawHorizontalTextLayer,
  drawVerticalTextLayer,
  drawTextLayer,
  specElementToLayer,
  setMeasureCanvas,
};
