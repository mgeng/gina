/**
 * gina-core/renderer.js
 *
 * フキダシ・縦書きテキストのレンダリングコア。
 * ブラウザ/DOM に依存しない純粋な Canvas 2D Context ベースの実装。
 *
 * GUI (src/main.js) と CLI (bin/gina-render) の双方がこの単一実装を共有する。
 * 重複コピーは持たない。
 *  - ブラウザ: <script src="src/core/renderer.js"> で読み込むと globalThis.GinaRenderCore に公開される。
 *  - Node:     require('../src/core/renderer') で module.exports から取得する。
 *
 * 中核は DOM・グローバル・イベントに一切依存しない。テキスト計測に必要な
 * Canvas だけは呼び出し側から setMeasureCanvas() で注入する
 * (ブラウザ: document.createElement('canvas') / Node: node-canvas の createCanvas)。
 */

'use strict';

// IIFE で内部宣言を閉じ込める。ブラウザではクラシックスクリプトの top-level const が
// グローバル字句スコープに漏れて main.js 側と衝突するため、ここでスコープを切る。
// 公開は末尾の GinaRenderCore (module.exports / globalThis) 経由のみ。
(function () {

// --- フォント設定 ---
// GUI のフォント select / 書き出しの両方がこの一覧を参照する。ここに追記すれば両方へ反映される。
// label は GUI 専用 (CLI/フォント登録は name/file のみ使用)。
const FONTS = [
  { name: 'GenEiAntiquePv6', label: '源暎アンチック Pv6', file: 'assets/fonts/GenEiAntiquePv6-M.ttf' },
  { name: 'GenEiAntiqueNv6', label: '源暎アンチック Nv6', file: 'assets/fonts/GenEiAntiqueNv6-M.ttf' },
  { name: 'ChikaraDzuyoku', label: '851チカラヅヨク かなA', file: 'assets/fonts/851CHIKARA-DZUYOKU_kanaA_004.ttf' },
  // 表紙カバー向け(SIL OFL / 商用利用可)
  { name: 'DelaGothicOne', label: 'Dela Gothic One（極太見出し）', file: 'assets/fonts/DelaGothicOne-Regular.ttf' },
  { name: 'RocknRollOne', label: 'RocknRoll One（丸太ゴシック）', file: 'assets/fonts/RocknRollOne-Regular.ttf' },
  { name: 'ShipporiMinchoB', label: 'しっぽり明朝 B（上品な明朝）', file: 'assets/fonts/ShipporiMincho-Bold.ttf' },
  { name: 'YujiSyuku', label: 'Yuji Syuku（筆書き楷書）', file: 'assets/fonts/YujiSyuku-Regular.ttf' },
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

// グローを重ねる回数。多いほど発光が強くなる。
const GLOW_PASSES = 3;

function setupTextContext(ctx, layer) {
  ctx.fillStyle = layer.color || '#000';
  ctx.font = `${layer.size}px "${layer.font}", sans-serif`;
}

// グロー(発光)→ 本文 の順で塗る共通ルーチン。
// drawAllFn は「全グリフを現在の ctx 設定で 1 回描く」関数。
function paintTextWithStyle(ctx, layer, drawAllFn) {
  ctx.save();
  if (layer.glow && layer.glow.blur > 0) {
    ctx.shadowColor = layer.glow.color || '#ffffff';
    ctx.shadowBlur = layer.glow.blur;
    ctx.fillStyle = layer.glow.color || '#ffffff';
    for (let pass = 0; pass < GLOW_PASSES; pass++) drawAllFn();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
  applyTextFillStyle(ctx, layer);
  drawAllFn();
  ctx.restore();
}

// 本文の塗り(単色 or グラデーション)を ctx.fillStyle に設定する。src/main.js と同一ロジック。
function applyTextFillStyle(ctx, layer) {
  const g = layer.gradient;
  if (g && g.from && g.to) {
    const b = measureTextLayerBounds(layer);
    const angle = ((typeof g.angle === 'number' ? g.angle : 90) * Math.PI) / 180;
    const cx = layer.x + b.x + b.width / 2;
    const cy = layer.y + b.y + b.height / 2;
    const half = Math.max(b.width, b.height) / 2 || layer.size / 2;
    const dx = Math.cos(angle) * half;
    const dy = Math.sin(angle) * half;
    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    grad.addColorStop(0, g.from);
    grad.addColorStop(1, g.to);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = layer.color || '#000';
  }
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
  if (layer.kind === 'bubble') {
    const s = computeBubbleShape(layer);
    const left = Math.min(s.cx - s.rx, s.tipX) - BUBBLE_BORDER;
    const top = Math.min(s.cy - s.ry, s.tipY) - BUBBLE_BORDER;
    const right = Math.max(s.cx + s.rx, s.tipX) + BUBBLE_BORDER;
    const bottom = Math.max(s.cy + s.ry, s.tipY) + BUBBLE_BORDER;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
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
  // Per-element tail direction (spec: tailOffsetX/Y). Defaults point down; Y auto-scales with bubble size.
  const tailOffX = typeof layer.tailOffsetX === 'number' ? layer.tailOffsetX : BUBBLE_TAIL_OFFSET_X;
  const tailOffY = typeof layer.tailOffsetY === 'number' ? layer.tailOffsetY : Math.max(ry * 1.6, BUBBLE_TAIL_OFFSET_Y);
  const tipX = cx + tailOffX;
  const tipY = cy + tailOffY;
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
  const lines = splitTextLines(layer.text);
  paintTextWithStyle(ctx, layer, () => {
    lines.forEach((line, index) => {
      const tx = layer.x, ty = layer.y + lineAdvance * index;
      if (layer.strokeWidth) {
        ctx.lineWidth = layer.strokeWidth;
        ctx.strokeStyle = layer.strokeColor || '#000';
        ctx.lineJoin = 'round';
        ctx.strokeText(line, tx, ty);
      }
      ctx.fillText(line, tx, ty);
    });
  });
}

function drawVerticalTextLayer(ctx, layer) {
  setupTextContext(ctx, layer);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const charAdvance = layer.size * layer.lineHeight;
  const columnAdvance = layer.size * layer.lineHeight;
  const columns = splitTextLines(layer.text);
  paintTextWithStyle(ctx, layer, () => {
    columns.forEach((column, columnIndex) => {
      const x = layer.x + layer.size / 2 - columnAdvance * columnIndex;
      for (const [charIndex, char] of [...column].entries()) {
        drawVerticalGlyph(ctx, char, x, layer.y + charAdvance * charIndex, layer.size);
      }
    });
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
      tailOffsetX: typeof el.tailOffsetX === 'number' ? el.tailOffsetX : undefined,
      tailOffsetY: typeof el.tailOffsetY === 'number' ? el.tailOffsetY : undefined,
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
    color: el.color || undefined,
    strokeColor: el.strokeColor || undefined,
    strokeWidth: typeof el.strokeWidth === 'number' ? el.strokeWidth : undefined,
    glow: (el.glow && typeof el.glow === 'object' && el.glow.blur > 0)
      ? { color: el.glow.color || '#ffffff', blur: Number(el.glow.blur) }
      : undefined,
    gradient: (el.gradient && el.gradient.from && el.gradient.to)
      ? { from: el.gradient.from, to: el.gradient.to, angle: typeof el.gradient.angle === 'number' ? el.gradient.angle : 90 }
      : undefined,
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

const GinaRenderCore = {
  // 定数
  FONTS,
  GLOW_PASSES,
  BUBBLE_PADDING_X,
  BUBBLE_PADDING_Y,
  BUBBLE_BORDER,
  BUBBLE_MIN_RX,
  BUBBLE_MIN_RY,
  BUBBLE_TAIL_OFFSET_X,
  BUBBLE_TAIL_OFFSET_Y,
  BUBBLE_TAIL_HALF_ANGLE,
  MONOLOGUE_PADDING,
  MONOLOGUE_BORDER,
  // CLI エントリ
  renderSpec,
  specElementToLayer,
  // 描画・計測コア（GUI / CLI 共有）
  splitTextLines,
  setupTextContext,
  applyTextFillStyle,
  paintTextWithStyle,
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
  setMeasureCanvas,
};

// UMD: Node (CommonJS) では module.exports、ブラウザ (<script>) では globalThis に公開。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GinaRenderCore;
} else {
  globalThis.GinaRenderCore = GinaRenderCore;
}

})();
