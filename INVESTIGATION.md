# Phase 0: Gina レンダリングエンジン headless 化 — 調査レポート

## 1. レンダリングコアの所在

すべてのレンダリングロジックは **`src/main.js`** 単一ファイル（4659行）に実装されている。ライブラリ分割なし。

### フキダシ描画

| 関数名 | 行 | 役割 |
|--------|-----|------|
| `computeBubbleShape(layer)` | 3410 | テキスト矩形からフキダシ楕円＋尾のジオメトリを計算（pure関数） |
| `drawSpeechBubblePath(ctx, shape)` | 3429 | Canvas 2D パスで楕円＋三角尾を構築 |
| `drawBubbleBox(ctx, layer)` | 3442 | 白塗り＋黒縁のフキダシ本体を描画 |
| `measureBubbleTextRect(layer)` | 3382 | フキダシ用テキスト矩形計測（縦書き/横書き両対応） |
| `drawMonologueBox(ctx, layer)` | 3457 | モノローグ（枠付きナレーション）を描画 |

### 縦書きテキスト・改行処理

| 関数名 | 行 | 役割 |
|--------|-----|------|
| `splitTextLines(text)` | 3236 | `\n` 区切りで行分割（pure関数） |
| `setupTextContext(ctx, layer)` | 3240 | フォント・色をコンテキストに設定 |
| `getVerticalGlyphOffset(char, size)` | 3245 | 句読点（、。）の縦書きオフセット計算 |
| `drawVerticalGlyph(ctx, char, x, y, size)` | 3255 | 1文字縦書き描画（ー・…の90°回転を含む） |
| `drawVerticalTextLayer(ctx, layer)` | 3365 | 複数行の縦書きテキスト描画（列ごとに右→左） |
| `drawHorizontalTextLayer(ctx, layer)` | 3355 | 横書きテキスト描画 |
| `drawTextLayer(ctx, layer)` | 3469 | ディスパッチャ（monologue/bubble/text/vertical） |

### テキスト矩形・レイアウト

| 関数名 | 行 | 役割 |
|--------|-----|------|
| `measureTextLayerBounds(layer)` | 3272 | テキスト全体の包含矩形を計算 |

### 素材・コマ描画

| 関数名 | 行 | 役割 |
|--------|-----|------|
| `computeMaterialPlacement(material, pw, ph)` | 3085 | 素材の cover フィット配置を計算（pure関数） |
| `computePanelPixelRect(panel, pageW, pageH, gutterPx)` | 3131 | コマのピクセル矩形を計算（pure関数） |
| `drawPanelsAndMaterials(ctx, page, pageW, pageH)` | 3142 | コマ・素材・集中線を canvas に描画 |
| `renderCurrentPageToPngBlob()` | 4149 | メインエクスポート関数（DOM 依存大） |

---

## 2. ブラウザ/DOM依存箇所（完全列挙）

### レンダリングパス上の依存

| 依存API | 箇所 | Node.js代替 |
|---------|------|------------|
| `document.createElement('canvas')` | L3154, 3295, 3396, 4154 | `createCanvas(w,h)` from `canvas` npm |
| `new Image()` | L3097–3101 | `loadImage(src)` from `canvas` npm |
| `document.fonts.load()` | L3228 | `registerFont(path, {family})` from `canvas` npm |
| `document.fonts.ready` | L3229 | 不要（registerFont は同期） |
| `getComputedStyle(...).getPropertyValue('--panel-gutter')` | L3147, 4170 | 引数として渡す（デフォルト: 14px） |
| `getComputedStyle(...).getPropertyValue('--panel-border-width')` | L4174 | 引数として渡す（デフォルト: 4px） |
| `els.panelContainer.clientWidth` | L3145, 4168 | headless では pageW そのもの（スケール=1.0） |
| `fetch(src)` | L3116–3124 | `fs.readFile` or `path.resolve` |

### レンダリング非依存（GUIのみ）

`window.showSaveFilePicker`, `FileReader`, `localStorage`, `requestAnimationFrame`, `document.fonts.add(face)` — これらはすべてUIのみで使われており、レンダリングロジックには無関係。

---

## 3. Fabric.js のバージョン

**Fabric.js は使用されていない。** 純粋な HTML5 Canvas 2D Context API（`CanvasRenderingContext2D`）のみを使用している。よって Fabric.js / node-canvas 連携の検討は不要。

---

## 4. フォントの扱い

- **場所**: `assets/fonts/` に 3 本の TTF ファイル
  - `GenEiAntiquePv6-M.ttf`（源暎アンチック Pv6）
  - `GenEiAntiqueNv6-M.ttf`（源暎アンチック Nv6）
  - `851CHIKARA-DZUYOKU_kanaA_004.ttf`（851チカラヅヨク かなA）
- **ブラウザ側の登録**: `FontFace` API + `document.fonts.add(face)` + `face.load()`（L24–31）
- **Node.js での使用法**: `canvas` npm パッケージの `registerFont(filePath, { family: 'FontName' })` を呼ぶ。これは同期APIで、canvas 作成前に呼べばよい。TTFパスはプロジェクトルートからの相対パスで渡せる。

---

## 5. mj形式の構造

`.mj` ファイルは JSZip で生成された ZIP アーカイブ。内部構造:

```
gina.mj (ZIP)
├── manifest.json         { version: 3, pages: N }
└── pages/
    └── 1/
        ├── text.json     # レイヤーデータ（下記参照）
        ├── panels.json   # コマレイアウト
        ├── memo.txt      # メモ（任意）
        ├── materials/    # コマ素材画像（dataURL を展開したもの）
        └── overlays/     # オーバーレイ画像
```

### text.json（レイヤーデータ）の構造

```json
{
  "version": 2,
  "canvas": { "width": 1200, "height": 1700 },
  "layers": [
    {
      "kind": "sticker",
      "src": "assets/bubbles/vertical/bubble-01-oval.png",
      "x": 100, "y": 80, "width": 280, "height": 280,
      "flipH": false, "flipV": false, "panelId": null
    },
    {
      "kind": "text",
      "text": "セリフ",
      "x": 120, "y": 100,
      "font": "GenEiAntiquePv6",
      "size": 24,
      "orientation": "vertical",
      "lineHeight": 1.1
    },
    {
      "kind": "monologue",
      "text": "ナレーション",
      "x": 50, "y": 50,
      "font": "GenEiAntiquePv6",
      "size": 20,
      "orientation": "horizontal",
      "lineHeight": 1.1
    }
  ]
}
```

### 注意

- GUIが作成するフキダシは **`kind: "sticker"`（PNG画像）＋ `kind: "text"`（テキスト）のペア**。
- `kind: "bubble"` は Canvas描画の楕円フキダシ（`computeBubbleShape`で自動サイジング）として実装済みだが、**GUIのコンテキストメニューからは生成できない**。コード上のデータとして存在し、`applyProjectData` でのロード時も処理される。

---

## 6. mj 再利用 vs 新規 render-spec 推奨

### mj をそのまま CLI 入力にするのが困難な理由

1. **バイナリ ZIP**。画像がすべて ZIP 内部に格納されており、AI が JSON として生成するのに適していない。
2. **過剰な複雑さ**。パネルレイアウト・素材画像・集中線・AI生成画像など、CLI スコープ外の情報を大量に含む。
3. **フキダシが PNG 参照**。`sticker` + `text` ペアはテキスト位置の手動計算が必要で、AI が生成しにくい。

### 新規 render-spec JSON を推奨する理由

1. **シンプルな JSON 1ファイル**。AI が直接生成・編集できる。
2. **`kind: "bubble"` ベースの自動サイジング**。テキストを渡すだけでフキダシサイズが自動決定される。
3. **入力としてベース画像のファイルパスを持てる**。mj形式に「ベース画像」という概念はない。

---

## 7. 推奨プラン

### **Plan A: `canvas` (node-canvas) で Node.js 上に直接レンダリング**

**選択理由**:
- DOM依存が少なく、すべて `canvas` npm パッケージで代替可能。
- 既存のレンダリング関数（`drawTextLayer`, `drawVerticalTextLayer`, `computeBubbleShape` 等）はほぼそのまま移植できる。Canvas 2D Context API は node-canvas と互換。
- Plan B (Playwright) より起動が 10–100倍速く、パイプラインに組み込みやすい。
- Node.js v20 が利用可能（`canvas` npm が推奨するバージョン範囲内）。

**移植時に置き換えが必要な箇所（全 8 箇所）**:
1. `document.createElement('canvas')` → `createCanvas()`
2. `new Image()` → `loadImage()`
3. `document.fonts.load` / `document.fonts.ready` → `registerFont()`
4. `getComputedStyle(...)` の CSS変数 → 引数化（gutter: 14, borderWidth: 4）
5. `els.panelContainer.clientWidth` → canvas幅をそのまま使う（スケール=1.0）
6. `fetch` for assets → `fs.readFile` / `path.join(__dirname, ...)`
7. `atob` → Node.js 16+ でグローバル利用可能（そのまま）
8. `FontFace` → `registerFont()`

### Plan B は選択しない

DOM 依存が深い場合のフォールバックだが、今回は依存が浅く明確に代替可能。Playwright の起動オーバーヘッド（数秒）はパイプライン用途に不適。

---

## 8. 実装にあたっての注意事項

1. **`kind: "bubble"` はキャンバス描画フキダシとして使えるが、形状は「楕円＋三角尾（1種類のみ）」**。shout/thought/rect 形状は将来のフェーズで実装する。Phase 1 では shape: "normal" のみを対象とする。
2. **縦書きの改行処理**: `splitTextLines` は `\n` で列を分割し、右→左に描画する（`drawVerticalTextLayer`）。
3. **フォント測定**: `measureTextLayerBounds` の横書きパスが `document.createElement('canvas')` を使って測定キャッシュを持つ。Node.js でも同様に動作する。
4. **gutter と borderWidth は HTML スライダー由来**。headless CLI では引数で指定（デフォルト: gutter=0, borderWidth=0 を推奨。ベース画像描画時には不要）。
