# Gina Cover 仕様（AI 向け説明書）

小説サイト用の **表紙（1 枚絵カバー）** を AI が生成するための仕様。
対象は `cover/` の表紙作成モード（漫画本体 `src/main.js` とは独立）。

## AI はどう「使う」か（API は不要）

表紙作成モードはブラウザ GUI だが、その入出力ファイル **`.mjcover` が AI の「口」** になる。
新しい API・サーバを足さなくても、次の手順で AI が表紙を作れる：

1. AI が **`cover.json`（＋必要なら画像アセット）を書く**。
2. それを **`.mjcover`（ZIP）にまとめる**（後述のスニペット参照）。
3. ユーザーが GUI で **Ctrl+O → その `.mjcover` を開く**と、AI が組んだ表紙がそのまま編集状態で再現される。
4. 微調整後、ユーザーが **Ctrl+S 保存 / Ctrl+Shift+E で JPG 書き出し**（`cover.jpg`、品質 0.92）。

> 現状、表紙を **ヘッドレスで画像化する CLI は無い**（`bin/gina-render.js` は漫画コマ用の render-spec 専用で、`cover.json` は扱わない）。
> 表紙の最終画像化（JPG）は GUI 上の書き出しに依存する。これが将来不便になったら headless レンダラを足す余地がある。今は不要。

---

## ファイル形式 `.mjcover`

`.mjcover` は ZIP バンドル（拡張子が違うだけで中身は通常の ZIP）。構成：

```
my-cover.mjcover
├── manifest.json        # 形式識別子（固定）
├── cover.json           # 表紙ドキュメント本体（AI が書く主対象）
└── assets/              # 画像を使う場合のみ
    ├── bg.png           # 背景画像（任意）
    └── cv_3.png         # image レイヤーの実体（任意・複数可）
```

### `manifest.json`（固定値）

```json
{ "format": "gina-cover", "version": "1" }
```

### `cover.json`（トップレベル）

| フィールド    | 型             | 説明 |
| ------------ | -------------- | ---- |
| `width`      | number         | キャンバス幅。標準は **1600** |
| `height`     | number         | キャンバス高。標準は **2560**（1:1.6 固定運用） |
| `background` | string \| null | 背景画像の ZIP 内パス（例 `"assets/bg.png"`）。無い場合は `null`（白地） |
| `bgScale`    | number         | 背景の拡大率。**1 = cover フィット**（キャンバス全面を覆う基準）。`1` 超で拡大（はみ出しはトリム）、`1` 未満で縮小（端に白地が出る）。省略時 `1`。中央基準 |
| `bgOffsetX`  | number         | 背景の中央基準からの水平オフセット（px）。正で右へ。省略時 `0` |
| `bgOffsetY`  | number         | 背景の中央基準からの垂直オフセット（px）。正で下へ。省略時 `0` |
| `layers`     | array          | レイヤー配列。**配列順 = 重ね順（後ろの要素ほど前面）**。背景は常に最背面 |

---

## 座標系・共通ルール

- **原点は左上、単位は px**、キャンバス座標（`width`×`height`）でそのまま指定する。表示ズームは無関係。
- すべてのレイヤーは `id`（文字列）と `kind`（`"text"` / `"rect"` / `"image"`）を持つ。
- `id` は **`cv_<整数>` 形式を推奨**（例 `cv_1`）。GUI はこの番号で連番を継続する。全レイヤーで一意にすること。
- z 順は `layers` の並び順。先に書いたものが下、後に書いたものが上。

---

## `kind: "text"` — 文字レイヤー

| フィールド     | 型                | 必須 | 説明 |
| ------------- | ----------------- | :--: | ---- |
| `id`          | string            |  ✓   | 例 `"cv_1"` |
| `kind`        | `"text"`          |  ✓   | |
| `text`        | string            |  ✓   | 本文。`\n` で行/列を分割。**縦書きでは列が右→左**に並ぶ |
| `x`, `y`      | number            |  ✓   | テキストブロックの基準点（左上）|
| `font`        | string            |  ✓   | フォント名（[フォント一覧](#フォント一覧)の `name`）|
| `size`        | number            |  ✓   | フォントサイズ px（標準新規は約 112 = 幅×0.07）|
| `lineHeight`  | number            |  ✓   | 行間倍率（例 `1.1`）|
| `orientation` | `"vertical"` \| `"horizontal"` | ✓ | 縦書き / 横書き |
| `color`       | string `#rrggbb`  |  ✓   | 文字色。`gradient` 有効時は無視される |
| `gradient`    | object \| 省略     |      | `{ "from": "#rrggbb", "to": "#rrggbb", "angle": 0..360 }`。`from`/`to` 必須、`angle` 既定 90 |
| `glow`        | object \| 省略     |      | `{ "color": "#rrggbb", "blur": number }`。`blur > 0` で発光 |
| `strokeColor` | string `#rrggbb` \| 省略 | | フチ色。`strokeWidth` と対で指定 |
| `strokeWidth` | number \| 省略     |      | フチ太さ px（`> 0` で有効）|

> 装飾（`color`/`gradient`/`glow`/`strokeColor`+`strokeWidth`）は **文字レイヤー専用**。
> 使わない装飾はフィールドごと省略する（`undefined` 相当）。

---

## `kind: "rect"` — 帯 / 単色四角レイヤー（今回追加）

タイトル帯・キャッチ帯・画像の上に敷く半透明シートなどに使う、単色塗りの矩形。

| フィールド  | 型               | 必須 | 説明 |
| ---------- | ---------------- | :--: | ---- |
| `id`       | string           |  ✓   | 例 `"cv_2"` |
| `kind`     | `"rect"`         |  ✓   | |
| `x`, `y`   | number           |  ✓   | 左上座標 |
| `width`    | number           |  ✓   | 幅 px |
| `height`   | number           |  ✓   | 高さ px |
| `color`    | string `#rrggbb` |  ✓   | 塗り色 |
| `opacity`  | number 0.0–1.0   |  ✓   | 不透明度。`0.6` で 60%。半透明にすると下の画像が透ける |

**全幅の横帯**（GUI の既定挿入と同じ形）を作る例：`x: 0`, `width: <キャンバス幅>`, `height ≈ 幅×0.14`。

```json
{ "id": "cv_2", "kind": "rect", "x": 0, "y": 2050, "width": 1600, "height": 224, "color": "#000000", "opacity": 0.7 }
```

---

## `kind: "image"` — 画像 / ロゴレイヤー

画像は ZIP 内に実体ファイルが必要。`src` がその ZIP 内パスを指す。

| フィールド  | 型      | 必須 | 説明 |
| ---------- | ------- | :--: | ---- |
| `id`       | string  |  ✓   | 例 `"cv_3"` |
| `kind`     | `"image"` | ✓  | |
| `x`, `y`   | number  |  ✓   | 左上座標 |
| `width`    | number  |  ✓   | 表示幅 px |
| `height`   | number  |  ✓   | 表示高 px |
| `natW`     | number  |  ✓   | 元画像の自然幅（縦横比固定リサイズ用）|
| `natH`     | number  |  ✓   | 元画像の自然高 |
| `src`      | string  |  ✓   | ZIP 内パス（例 `"assets/cv_3.png"`）。対応ファイルが無いレイヤーは読み込み時に無視される |

---

## フォント一覧

`font` には次の `name` を使う（実体は `assets/fonts/` に同梱、書き出し時も使用）：

| name              | 内容 |
| ----------------- | ---- |
| `GenEiAntiquePv6` | 源暎アンチック Pv6 |
| `GenEiAntiqueNv6` | 源暎アンチック Nv6 |
| `ChikaraDzuyoku`  | 851チカラヅヨク かなA |
| `RocknRollOne`    | RocknRoll One（丸太ゴシック・OFL）|
| `ShipporiMinchoB` | しっぽり明朝 B（上品な明朝・OFL）— 表紙文字の既定 |
| `YujiSyuku`       | Yuji Syuku（筆書き楷書・OFL）|

---

## 最小例（背景＋帯＋タイトル文字）

`cover.json`：

```json
{
  "width": 1600,
  "height": 2560,
  "background": "assets/bg.png",
  "layers": [
    { "id": "cv_1", "kind": "rect", "x": 0, "y": 1980, "width": 1600, "height": 300, "color": "#1a0a14", "opacity": 0.72 },
    {
      "id": "cv_2", "kind": "text",
      "text": "誘惑の\n夜",
      "x": 1180, "y": 320,
      "font": "ShipporiMinchoB", "size": 168, "lineHeight": 1.05,
      "orientation": "vertical",
      "color": "#ffffff",
      "glow": { "color": "#ff66cc", "blur": 24 },
      "strokeColor": "#3a0020", "strokeWidth": 6
    },
    {
      "id": "cv_3", "kind": "text",
      "text": "著者名",
      "x": 120, "y": 2060,
      "font": "ShipporiMinchoB", "size": 64, "lineHeight": 1.1,
      "orientation": "horizontal",
      "color": "#ffffff"
    }
  ]
}
```

背景を使わないなら `"background": null` にして `assets/bg.png` は同梱しなくてよい。

---

## `.mjcover` の作り方

### Node.js（同梱の JSZip を使用）

```js
const fs = require('fs');
const JSZip = require('./assets/vendor/jszip.min.js'); // プロジェクトルートから

const zip = new JSZip();
zip.file('manifest.json', JSON.stringify({ format: 'gina-cover', version: '1' }));
zip.file('cover.json', fs.readFileSync('cover.json', 'utf8'));
zip.file('assets/bg.png', fs.readFileSync('bg.png'));     // 背景を使う場合
// zip.file('assets/cv_3.png', fs.readFileSync('logo.png')); // image レイヤーがある場合

zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
   .then((buf) => fs.writeFileSync('my-cover.mjcover', buf));
```

### シェル（`zip` CLI）

```sh
mkdir -p build/assets
cp cover.json build/cover.json
printf '{"format":"gina-cover","version":"1"}' > build/manifest.json
cp bg.png build/assets/bg.png            # 背景を使う場合のみ
( cd build && zip -r -X ../my-cover.mjcover manifest.json cover.json assets )
```

どちらで作っても、ユーザーが GUI で **Ctrl+O** から開けば再現される。

---

## 制約・注意点（v1）

- キャンバスは運用上 **1600×2560 固定**。`cover.json` の `width`/`height` は読み込み時に反映されるが、新規 GUI セッションは常に 1600×2560 で始まる。
- 装飾（色/グラデ/グロー/フチ）は **`text` 専用**。`rect`/`image` では指定しても無視される。
- 色入力は `#rrggbb` 形式を使う（GUI のカラーピッカー互換）。`rect` の `color` はレンダリング上は任意の CSS 色でも描けるが、GUI で再編集する前提なら `#rrggbb` に揃える。
- 画像レイヤーは `src` の実体ファイルが ZIP に無いと **読み込み時に黙って捨てられる**。`natW`/`natH` も必ず入れる。
- `id` は全レイヤーで一意・`cv_<整数>` 推奨。重複や非数値 id でも開けるが、GUI 内の連番継続が崩れる。
- 最終画像化は現状 GUI の **JPG 書き出し**（Ctrl+Shift+E → `cover.jpg`）に依存（ヘッドレス CLI なし）。

---

## 参考：GUI 操作と cover.json の対応

| GUI 操作 | cover.json への反映 |
| -------- | ------------------- |
| 右クリック →「文字を追加」 | `kind:"text"` レイヤー追加 |
| 右クリック →「帯 / 四角を追加」 | `kind:"rect"` レイヤー追加（全幅の横帯）|
| 右クリック →「画像 / ロゴを追加」 | `kind:"image"` レイヤー追加（assets に実体）|
| 空き領域をダブルクリック | `background` を差し替え |
| 空き領域をクリック | 背景を選択（背景画像があるとき）。ドラッグ / 矢印で `bgOffsetX/Y` を移動 |
| 背景選択中 or 未選択で Ctrl+↑/↓ | `bgScale`（背景の拡大/縮小・中央基準・はみ出しトリム）|
| ドラッグ / 矢印キー(1px) | `x`/`y` |
| 右下ハンドル / インスペクタ | `width`/`height`（画像）|
| Ctrl+←→ / Ctrl+↑↓（帯選択中）| 帯の `width` / `height` |
| Ctrl+↑/↓（文字選択中） | `size`（文字）|
| インスペクタ各項目 | 対応する装飾・`color`・`opacity` 等 |
