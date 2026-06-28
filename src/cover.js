// Gina Cover — 表紙作成モード
//
// 漫画オーサリング本体 (src/main.js) とは独立した軽量エディタ。
// レンダリング中核 (src/core/renderer.js → globalThis.GinaRenderCore) のみを共有し、
// 1 枚絵の表紙（背景画像 + 文字レイヤー）の作成と PNG 書き出しに特化する。

const {
  FONTS,
  measureTextLayerBounds,
  drawTextLayer,
  setMeasureCanvas,
} = globalThis.GinaRenderCore;

// 中核の計測用キャンバスを注入。
setMeasureCanvas(document.createElement('canvas'));

// フォント登録。FONTS の file はプロジェクトルート相対なので /cover/ から見て '../' を足す。
function registerFonts() {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  for (const f of FONTS) {
    const face = new FontFace(f.name, `url(../${f.file})`, { display: 'swap' });
    document.fonts.add(face);
    face.load().catch((err) => console.warn(`Font load failed: ${f.name}`, err));
  }
}
registerFonts();

// === キャンバスサイズ（小説サイト表紙: 1600×2560 = 1:1.6 固定） ===
// 可変にする必要が出たらプリセット + セレクトUIを復活させる。
const CANVAS_SIZE = { width: 1600, height: 2560 };

// === DOM ===
const els = {
  canvas: document.getElementById('cvCanvas'),
  stage: document.getElementById('cvStage'),
  bgInput: document.getElementById('cvBgInput'),
  imageInput: document.getElementById('cvImageInput'),
  openInput: document.getElementById('cvOpenInput'),
  contextMenu: document.getElementById('cvContextMenu'),
  exportBtn: document.getElementById('cvExport'),
  help: document.getElementById('cvHelp'),
  helpClose: document.getElementById('cvHelpClose'),
  inspector: document.getElementById('cvInspector'),
  deleteText: document.getElementById('cvDeleteText'),
  imageInspector: document.getElementById('cvImageInspector'),
  deleteImage: document.getElementById('cvDeleteImage'),
  imgWidth: document.getElementById('cvImgWidth'),
  imgHeight: document.getElementById('cvImgHeight'),
  imgLockRatio: document.getElementById('cvImgLockRatio'),
  text: document.getElementById('cvText'),
  font: document.getElementById('cvFont'),
  orientation: document.getElementById('cvOrientation'),
  size: document.getElementById('cvSize'),
  lineHeight: document.getElementById('cvLineHeight'),
  color: document.getElementById('cvColor'),
  gradEnable: document.getElementById('cvGradEnable'),
  gradFrom: document.getElementById('cvGradFrom'),
  gradTo: document.getElementById('cvGradTo'),
  gradAngle: document.getElementById('cvGradAngle'),
  glowEnable: document.getElementById('cvGlowEnable'),
  glowColor: document.getElementById('cvGlowColor'),
  glowBlur: document.getElementById('cvGlowBlur'),
  strokeEnable: document.getElementById('cvStrokeEnable'),
  strokeColor: document.getElementById('cvStrokeColor'),
  strokeWidth: document.getElementById('cvStrokeWidth'),
};

const ctx = els.canvas.getContext('2d');

// === 状態 ===
const state = {
  canvasW: CANVAS_SIZE.width,
  canvasH: CANVAS_SIZE.height,
  bgImage: null,
  bgBlob: null,   // 背景の元バイト列（保存時に再エンコードせずそのまま埋め込む）
  layers: [],     // renderer の layer 互換オブジェクト (kind: 'text' | 'image')
  selectedId: null,
  seq: 0,
  fileHandle: null, // 上書き保存用（File System Access API）
  fileName: null,
};

// コピー&ペースト用クリップボード（選択レイヤーの複製元）。
let clipboard = null;

// 文字インライン編集の状態（{ id, el, original } または null）。
let editing = null;

// === 初期化: セレクト類を埋める ===
function fillSelects() {
  els.font.innerHTML = FONTS
    .map((f) => `<option value="${f.name}">${f.label}</option>`)
    .join('');
}
fillSelects();

// === 背景画像の cover フィット配置 ===
function coverRect(imgW, imgH, boxW, boxH) {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

// 背景未設定時のプレースホルダー（書き出しには含まれない）。
function drawBackgroundPlaceholder(w, h) {
  // サイズはキャンバス幅基準（表示ズームに依らず一定の見た目）。
  const u = w / 1000;
  ctx.save();
  // 薄いグレー地 + 破線枠
  ctx.fillStyle = '#f2f3f5';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c2c6cf';
  ctx.lineWidth = 2 * u;
  ctx.setLineDash([14 * u, 10 * u]);
  const inset = 20 * u;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.setLineDash([]);
  // 案内テキスト
  ctx.fillStyle = '#9aa0ab';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(44 * u)}px sans-serif`;
  ctx.fillText('ダブルクリックで背景画像を追加', w / 2, h / 2 - 34 * u);
  ctx.font = `${Math.round(30 * u)}px sans-serif`;
  ctx.fillText('右クリックで文字・画像を追加', w / 2, h / 2 + 34 * u);
  ctx.restore();
}

// === 描画 ===
function getSelected() {
  return state.layers.find((l) => l.id === state.selectedId) || null;
}

function render(withOverlay = true) {
  const { canvasW, canvasH } = state;
  if (els.canvas.width !== canvasW) els.canvas.width = canvasW;
  if (els.canvas.height !== canvasH) els.canvas.height = canvasH;

  // 表示スケール（ステージに収める）
  const pad = 48;
  const availW = Math.max(els.stage.clientWidth - pad, 100);
  const availH = Math.max(els.stage.clientHeight - pad, 100);
  const scale = Math.min(availW / canvasW, availH / canvasH, 1);
  els.canvas.style.width = `${canvasW * scale}px`;
  els.canvas.style.height = `${canvasH * scale}px`;

  // 背景（白 → 画像）
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvasW, canvasH);
  if (state.bgImage) {
    const r = coverRect(state.bgImage.width, state.bgImage.height, canvasW, canvasH);
    ctx.drawImage(state.bgImage, r.x, r.y, r.w, r.h);
  } else if (withOverlay) {
    drawBackgroundPlaceholder(canvasW, canvasH);
  }

  // レイヤー（文字 / 画像）
  for (const layer of state.layers) {
    // 編集中の文字はオーバーレイの textarea が表示するのでキャンバスには描かない。
    if (editing && layer.id === editing.id) continue;
    if (layer.kind === 'image') {
      if (layer.img) ctx.drawImage(layer.img, layer.x, layer.y, layer.width, layer.height);
    } else {
      drawTextLayer(ctx, layer);
    }
  }

  // 選択枠（書き出し時・編集中の対象は描かない）
  if (withOverlay) {
    const sel = getSelected();
    if (sel && (!editing || sel.id !== editing.id)) drawSelectionOutline(sel);
  }
}

// レイヤーの矩形（左上x,y,幅,高さ）を返す。文字は measureTextLayerBounds 基準。
function layerRect(layer) {
  if (layer.kind === 'image') {
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }
  const b = measureTextLayerBounds(layer);
  return { x: layer.x + b.x, y: layer.y + b.y, width: b.width, height: b.height };
}

// 画像のリサイズハンドル（右下角）の矩形（キャンバス座標）。
const HANDLE_PX = 22;
function handleRect(layer) {
  const r = layerRect(layer);
  const s = state.canvasW / Math.max(els.canvas.clientWidth, 1); // 表示→キャンバス係数
  const h = HANDLE_PX * s;
  return { x: r.x + r.width - h / 2, y: r.y + r.height - h / 2, w: h, h };
}

function drawSelectionOutline(layer) {
  const r = layerRect(layer);
  const lw = Math.max(state.canvasW / els.canvas.clientWidth, 1) * 1.5;
  ctx.save();
  ctx.strokeStyle = '#4c8dff';
  ctx.lineWidth = lw;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  ctx.restore();
  // 画像はリサイズハンドルを描く。
  if (layer.kind === 'image') {
    const hr = handleRect(layer);
    ctx.save();
    ctx.fillStyle = '#4c8dff';
    ctx.fillRect(hr.x, hr.y, hr.w, hr.h);
    ctx.restore();
  }
}

// === 文字レイヤー操作 ===
function makeTextLayer(x, y) {
  state.seq += 1;
  return {
    id: `cv_${state.seq}`,
    kind: 'text',
    text: 'タイトル',
    x: Math.round(x),
    y: Math.round(y),
    font: 'RocknRollOne',
    size: Math.round(state.canvasW * 0.07),
    lineHeight: 1.1,
    orientation: 'vertical',
    color: '#ffffff',
    gradient: undefined,
    glow: undefined,
    strokeColor: undefined,
    strokeWidth: undefined,
  };
}

function addText(x, y) {
  const layer = makeTextLayer(x, y);
  state.layers.push(layer);
  state.selectedId = layer.id;
  syncInspector();
  render();
}

// 画像レイヤーを追加。初期幅はキャンバス幅の 40%、縦横比を保ち、(x,y) を中心に置く。
function addImageLayer(img, cx, cy, blob) {
  state.seq += 1;
  const w = Math.round(state.canvasW * 0.4);
  const h = Math.round(w * (img.height / img.width));
  const layer = {
    id: `cv_${state.seq}`,
    kind: 'image',
    img,
    blob: blob || null,
    natW: img.width,
    natH: img.height,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    width: w,
    height: h,
  };
  state.layers.push(layer);
  state.selectedId = layer.id;
  syncInspector();
  render();
}

function deleteSelected() {
  if (!state.selectedId) return;
  state.layers = state.layers.filter((l) => l.id !== state.selectedId);
  state.selectedId = null;
  syncInspector();
  render();
}

// === インスペクタ ⇄ レイヤー 同期 ===
function syncInspector() {
  const sel = getSelected();
  const isImage = sel && sel.kind === 'image';
  els.inspector.hidden = !sel || isImage;
  els.imageInspector.hidden = !isImage;
  if (!sel) return;
  if (isImage) {
    els.imgWidth.value = Math.round(sel.width);
    els.imgHeight.value = Math.round(sel.height);
    return;
  }
  els.text.value = sel.text;
  els.font.value = sel.font;
  els.orientation.value = sel.orientation;
  els.size.value = sel.size;
  els.lineHeight.value = sel.lineHeight;
  els.color.value = toHex(sel.color, '#ffffff');

  els.gradEnable.checked = !!sel.gradient;
  els.gradFrom.value = toHex(sel.gradient && sel.gradient.from, '#ffffff');
  els.gradTo.value = toHex(sel.gradient && sel.gradient.to, '#ff66cc');
  els.gradAngle.value = (sel.gradient && typeof sel.gradient.angle === 'number') ? sel.gradient.angle : 90;

  els.glowEnable.checked = !!sel.glow;
  els.glowColor.value = toHex(sel.glow && sel.glow.color, '#ffffff');
  els.glowBlur.value = (sel.glow && sel.glow.blur) || 12;

  els.strokeEnable.checked = !!sel.strokeWidth;
  els.strokeColor.value = toHex(sel.strokeColor, '#000000');
  els.strokeWidth.value = sel.strokeWidth || 4;
}

// インスペクタの入力値を選択レイヤーへ反映。
function applyInspector() {
  const sel = getSelected();
  if (!sel || sel.kind === 'image') return;
  sel.text = els.text.value || ' ';
  sel.font = els.font.value;
  sel.orientation = els.orientation.value;
  sel.size = clampNum(els.size.value, 8, 600, sel.size);
  sel.lineHeight = clampNum(els.lineHeight.value, 0.5, 3, sel.lineHeight);
  sel.color = els.color.value;

  sel.gradient = els.gradEnable.checked
    ? { from: els.gradFrom.value, to: els.gradTo.value, angle: clampNum(els.gradAngle.value, 0, 360, 90) }
    : undefined;

  const blur = clampNum(els.glowBlur.value, 0, 80, 12);
  sel.glow = (els.glowEnable.checked && blur > 0)
    ? { color: els.glowColor.value, blur }
    : undefined;

  const sw = clampNum(els.strokeWidth.value, 0, 40, 4);
  sel.strokeColor = els.strokeEnable.checked ? els.strokeColor.value : undefined;
  sel.strokeWidth = (els.strokeEnable.checked && sw > 0) ? sw : undefined;

  render();
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// color input は #rrggbb のみ受け付けるので、その他表記はフォールバック。
function toHex(value, fallback) {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return fallback;
}

// === ヒットテスト（最前面優先） ===
function pointInRect(cx, cy, r) {
  return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
}

function layerAtPoint(cx, cy) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    if (pointInRect(cx, cy, layerRect(layer))) return layer;
  }
  return null;
}

function clientToCanvas(clientX, clientY) {
  const rect = els.canvas.getBoundingClientRect();
  const sx = state.canvasW / rect.width;
  const sy = state.canvasH / rect.height;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

// === ドラッグ（移動 / 画像リサイズ） ===
let drag = null;
els.canvas.addEventListener('pointerdown', (e) => {
  // 左ボタン以外（右クリック=コンテキストメニュー, 中クリック等）は無視。
  // これを通すと右クリックで誤って選択/ドラッグが始まりメニュー操作と競合する。
  if (e.button !== 0) return;
  const p = clientToCanvas(e.clientX, e.clientY);
  const sel = getSelected();

  // 選択中の画像なら、まず右下リサイズハンドルを判定。
  if (sel && sel.kind === 'image' && pointInRect(p.x, p.y, handleRect(sel))) {
    drag = { mode: 'resize', startW: sel.width, startH: sel.height, startX: p.x, startY: p.y, ratio: sel.width / sel.height };
    els.canvas.setPointerCapture(e.pointerId);
    els.canvas.style.cursor = 'nwse-resize';
    return;
  }

  const hit = layerAtPoint(p.x, p.y);
  if (hit) {
    state.selectedId = hit.id;
    drag = { mode: 'move', dx: p.x - hit.x, dy: p.y - hit.y };
    els.canvas.setPointerCapture(e.pointerId);
    els.canvas.style.cursor = 'grabbing';
    syncInspector();
    render();
  } else if (state.selectedId) {
    state.selectedId = null;
    syncInspector();
    render();
  }
});
els.canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const sel = getSelected();
  if (!sel) return;
  const p = clientToCanvas(e.clientX, e.clientY);
  if (drag.mode === 'resize') {
    let w = Math.max(8, drag.startW + (p.x - drag.startX));
    let h = els.imgLockRatio.checked ? w / drag.ratio : Math.max(8, drag.startH + (p.y - drag.startY));
    sel.width = Math.round(w);
    sel.height = Math.round(h);
    syncInspector();
  } else {
    sel.x = Math.round(p.x - drag.dx);
    sel.y = Math.round(p.y - drag.dy);
  }
  render();
});
function endDrag() {
  drag = null;
  els.canvas.style.cursor = 'default';
}
els.canvas.addEventListener('pointerup', endDrag);
els.canvas.addEventListener('pointercancel', endDrag);

// === 画像読み込みユーティリティ ===
function loadImageFile(file, onload) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); onload(img, file); };
  img.onerror = () => { URL.revokeObjectURL(url); alert('画像を読み込めませんでした。'); };
  img.src = url;
}

// === 文字インライン編集（文字オブジェクトをダブルクリック） ===
function positionTextEditor(ta, layer) {
  const rect = els.canvas.getBoundingClientRect();
  const scale = rect.width / state.canvasW; // 表示px / キャンバスpx
  const lr = layerRect(layer);
  ta.style.left = `${rect.left + lr.x * scale}px`;
  ta.style.top = `${rect.top + lr.y * scale}px`;
  ta.style.width = `${Math.max(lr.width * scale, 24)}px`;
  ta.style.height = `${Math.max(lr.height * scale, 24)}px`;
  ta.style.fontFamily = `"${layer.font}", sans-serif`;
  ta.style.fontSize = `${Math.max(layer.size * scale, 8)}px`;
  ta.style.lineHeight = String(layer.lineHeight);
  ta.style.color = layer.color || '#ffffff';
  ta.style.writingMode = layer.orientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb';
}

function startTextEdit(layer) {
  if (editing) finishTextEdit(true);
  const ta = document.createElement('textarea');
  ta.className = 'cv-text-edit';
  ta.value = layer.text;
  positionTextEditor(ta, layer);
  document.body.appendChild(ta);
  editing = { id: layer.id, el: ta, original: layer.text };
  render(); // 下の文字を隠す
  ta.focus();
  ta.select();

  ta.addEventListener('input', () => {
    layer.text = ta.value;
    syncInspector();
    render();
    positionTextEditor(ta, layer); // 文字量でボックスが変わるので追従
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Ctrl+C/V 等のグローバルショートカットを抑止
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishTextEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishTextEdit(false); }
  });
  ta.addEventListener('blur', () => finishTextEdit(true));
}

function finishTextEdit(commit) {
  if (!editing) return;
  const { el, id, original } = editing;
  const layer = state.layers.find((l) => l.id === id);
  editing = null; // blur の再入を防ぐため先に解除
  if (layer) {
    if (!commit) layer.text = original;
    if (!layer.text) layer.text = ' '; // 空だと描画/計測が壊れるので空白を入れる
  }
  el.remove();
  syncInspector();
  render();
}

// === 背景: ダブルクリックで追加 / 差し替え（文字の上では編集を優先） ===
els.canvas.addEventListener('dblclick', (e) => {
  const p = clientToCanvas(e.clientX, e.clientY);
  const hit = layerAtPoint(p.x, p.y);
  if (hit && hit.kind === 'text') {
    state.selectedId = hit.id;
    syncInspector();
    render();
    startTextEdit(hit);
    return;
  }
  if (hit && hit.kind === 'image') return; // 画像の上では何もしない
  els.bgInput.click(); // 空き領域 → 背景を追加 / 差し替え
});
els.bgInput.addEventListener('change', () => {
  loadImageFile(els.bgInput.files && els.bgInput.files[0], (img, file) => {
    state.bgImage = img;
    state.bgBlob = file || null;
    render();
  });
  els.bgInput.value = '';
});

// === 右クリック: コンテキストメニュー（クリック位置に追加） ===
let pendingPoint = { x: 0, y: 0 }; // 次に追加する要素のキャンバス座標

els.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  pendingPoint = clientToCanvas(e.clientX, e.clientY);
  const menu = els.contextMenu;
  menu.hidden = false;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
});

function hideContextMenu() { els.contextMenu.hidden = true; }
document.addEventListener('pointerdown', (e) => {
  if (!els.contextMenu.hidden && !els.contextMenu.contains(e.target)) hideContextMenu();
});
window.addEventListener('blur', hideContextMenu);

els.contextMenu.addEventListener('click', (e) => {
  const action = e.target.dataset && e.target.dataset.action;
  if (!action) return;
  hideContextMenu();
  if (action === 'text') {
    addText(pendingPoint.x, pendingPoint.y);
  } else if (action === 'image') {
    const pt = { x: pendingPoint.x, y: pendingPoint.y };
    els.imageInput.onchange = () => {
      loadImageFile(els.imageInput.files && els.imageInput.files[0], (img, file) => addImageLayer(img, pt.x, pt.y, file));
      els.imageInput.value = '';
    };
    els.imageInput.click();
  }
});

els.deleteText.addEventListener('click', deleteSelected);
els.deleteImage.addEventListener('click', deleteSelected);

// 画像インスペクタ（幅/高さ）の反映。
function applyImageInspector() {
  const sel = getSelected();
  if (!sel || sel.kind !== 'image') return;
  const changedHeight = document.activeElement === els.imgHeight;
  let w = clampNum(els.imgWidth.value, 8, 4000, sel.width);
  let h = clampNum(els.imgHeight.value, 8, 4000, sel.height);
  if (els.imgLockRatio.checked) {
    const ratio = sel.natW / sel.natH;
    if (changedHeight) w = Math.round(h * ratio);
    else h = Math.round(w / ratio);
  }
  sel.width = Math.round(w);
  sel.height = Math.round(h);
  els.imgWidth.value = sel.width;
  els.imgHeight.value = sel.height;
  render();
}
[els.imgWidth, els.imgHeight, els.imgLockRatio].forEach((el) => {
  el.addEventListener('input', applyImageInspector);
  el.addEventListener('change', applyImageInspector);
});

// インスペクタの入力は即時反映。
[
  els.text, els.font, els.orientation, els.size, els.lineHeight, els.color,
  els.gradEnable, els.gradFrom, els.gradTo, els.gradAngle,
  els.glowEnable, els.glowColor, els.glowBlur,
  els.strokeEnable, els.strokeColor, els.strokeWidth,
].forEach((el) => {
  el.addEventListener('input', applyInspector);
  el.addEventListener('change', applyInspector);
});

// === コピー & ペースト（設定を引き継いだ複製） ===
// レイヤーを深めに複製。入れ子オブジェクトは別物にして、後の編集が複製元に波及しないようにする。
function cloneLayer(src) {
  const copy = { ...src };
  if (src.gradient) copy.gradient = { ...src.gradient };
  if (src.glow) copy.glow = { ...src.glow };
  // 画像レイヤーの img / blob は参照を共有（描画・再保存に問題なし）。
  return copy;
}

function copySelected() {
  const sel = getSelected();
  if (!sel) return false;
  clipboard = cloneLayer(sel);
  return true;
}

const PASTE_OFFSET = 40; // 複製を少しずらして重なりを分かりやすく
function pasteClipboard() {
  if (!clipboard) return false;
  state.seq += 1;
  const layer = cloneLayer(clipboard);
  layer.id = `cv_${state.seq}`;
  layer.x = Math.round((layer.x || 0) + PASTE_OFFSET);
  layer.y = Math.round((layer.y || 0) + PASTE_OFFSET);
  state.layers.push(layer);
  state.selectedId = layer.id;
  syncInspector();
  render();
  return true;
}

// === 保存 / 読み込み（.mjcover = mj と同じ ZIP バンドル形式） ===
function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

// 画像を blob 化。元 blob があればそのまま（無劣化）、無ければ canvas で PNG に再エンコード。
function imageToBlob(img, originalBlob) {
  if (originalBlob) return Promise.resolve({ blob: originalBlob, ext: extFromMime(originalBlob.type) });
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    c.toBlob((blob) => {
      if (blob) resolve({ blob, ext: 'png' });
      else reject(new Error('画像のエンコードに失敗しました'));
    }, 'image/png');
  });
}

async function buildCoverBlob() {
  if (typeof JSZip === 'undefined') throw new Error('JSZip が読み込まれていません');
  const zip = new JSZip();
  let background = null;
  if (state.bgImage) {
    const { blob, ext } = await imageToBlob(state.bgImage, state.bgBlob);
    background = `assets/bg.${ext}`;
    zip.file(background, blob);
  }
  const layers = [];
  for (const l of state.layers) {
    if (l.kind === 'image' && l.img) {
      const { blob, ext } = await imageToBlob(l.img, l.blob);
      const src = `assets/${l.id}.${ext}`;
      zip.file(src, blob);
      layers.push({ kind: 'image', id: l.id, x: l.x, y: l.y, width: l.width, height: l.height, natW: l.natW, natH: l.natH, src });
    } else {
      const { img, blob, ...rest } = l; // 文字レイヤーは全プロパティをそのまま
      layers.push(rest);
    }
  }
  zip.file('manifest.json', JSON.stringify({ format: 'gina-cover', version: '1' }));
  zip.file('cover.json', JSON.stringify({
    width: state.canvasW, height: state.canvasH, background, layers,
  }, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveCover() {
  let blob;
  try {
    blob = await buildCoverBlob();
  } catch (e) {
    alert('保存に失敗しました: ' + (e && e.message || e));
    return;
  }
  const suggested = state.fileName || 'cover.mjcover';
  // File System Access API があれば、初回はダイアログ、以降は同じハンドルへ上書き。
  if (window.showSaveFilePicker) {
    try {
      if (!state.fileHandle) {
        state.fileHandle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: 'Gina Cover', accept: { 'application/zip': ['.mjcover'] } }],
        });
        state.fileName = state.fileHandle.name;
      }
      const writable = await state.fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // ユーザーがキャンセル
      state.fileHandle = null; // 失敗時はダウンロードにフォールバック
    }
  }
  downloadBlob(blob, suggested);
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を復元できませんでした')); };
    img.src = url;
  });
}

async function loadCoverFile(file) {
  if (!file) return;
  if (typeof JSZip === 'undefined') { alert('JSZip が読み込まれていません'); return; }
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    alert('ファイルを開けませんでした。'); return;
  }
  const docEntry = zip.file('cover.json');
  if (!docEntry) { alert('cover.json が見つかりません（対応していない形式です）。'); return; }
  let doc;
  try { doc = JSON.parse(await docEntry.async('string')); }
  catch (e) { alert('cover.json の解析に失敗しました。'); return; }

  // 状態をリセットしてから流し込む。
  state.bgImage = null;
  state.bgBlob = null;
  state.layers = [];
  state.selectedId = null;
  state.seq = 0;
  if (doc.width) state.canvasW = doc.width;
  if (doc.height) state.canvasH = doc.height;

  if (doc.background && zip.file(doc.background)) {
    const blob = await zip.file(doc.background).async('blob');
    try { state.bgImage = await blobToImage(blob); state.bgBlob = blob; } catch (_) { /* skip */ }
  }

  let maxSeq = 0;
  for (const l of (doc.layers || [])) {
    const m = /^cv_(\d+)$/.exec(l.id || '');
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    if (l.kind === 'image') {
      const entry = l.src && zip.file(l.src);
      if (!entry) continue;
      const blob = await entry.async('blob');
      let img;
      try { img = await blobToImage(blob); } catch (_) { continue; }
      state.layers.push({
        id: l.id, kind: 'image', img, blob,
        natW: l.natW || img.width, natH: l.natH || img.height,
        x: l.x, y: l.y, width: l.width, height: l.height,
      });
    } else {
      state.layers.push({ ...l, kind: 'text' });
    }
  }
  state.seq = maxSeq;

  // 開いたファイルを上書き保存対象にする（File System Access API の input 経由では handle 不可なので名前のみ）。
  state.fileHandle = null;
  state.fileName = file.name || 'cover.mjcover';

  syncInspector();
  render();
}

els.openInput.addEventListener('change', () => {
  const file = els.openInput.files && els.openInput.files[0];
  loadCoverFile(file);
  els.openInput.value = '';
});

// === ヘルプ / ショートカット一覧 ===
function showHelp() { els.help.hidden = false; }
function hideHelp() { els.help.hidden = true; }
function toggleHelp() { els.help.hidden = !els.help.hidden; }
els.helpClose.addEventListener('click', hideHelp);
els.help.addEventListener('click', (e) => { if (e.target === els.help) hideHelp(); });

// === キーボードショートカット ===
function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  // ヘルプ表示中は Esc で閉じる（修飾キー不要）。
  if (e.key === 'Escape' && !els.help.hidden) { e.preventDefault(); hideHelp(); return; }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === '/') { e.preventDefault(); toggleHelp(); return; }
  if (key === 's') { e.preventDefault(); saveCover(); return; }
  if (key === 'o') { e.preventDefault(); els.openInput.click(); return; }
  // テキスト入力中の C/V は通常のコピペに任せる。
  if (isEditableTarget(document.activeElement)) return;
  if (key === 'c') { if (copySelected()) e.preventDefault(); }
  else if (key === 'v') { if (pasteClipboard()) e.preventDefault(); }
});

// === 書き出し ===
els.exportBtn.addEventListener('click', async () => {
  // フォント描画ズレ防止に念のため読み込み完了を待つ。
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) { /* noop */ }
  }
  render(false); // 選択枠を含めずに描画
  const url = els.canvas.toDataURL('image/png');
  render(true);  // 表示を元に戻す
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cover.png';
  a.click();
});

// 表示領域変化に追従。
window.addEventListener('resize', () => render());

// 初期描画。
render();
