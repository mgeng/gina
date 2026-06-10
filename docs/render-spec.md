# gina-render 入力スキーマ仕様 v0.1

## 概要

`gina-render` CLI の入力 JSON（render-spec）の仕様。  
ベース画像にフキダシ・テキストを合成して PNG を出力する。

---

## トップレベル構造

```json
{
  "version": "0.1",
  "base_image": "input/cut_001.png",
  "output": "output/cut_001_final.png",
  "canvas": {
    "width": 1200,
    "height": 1700
  },
  "elements": [ ... ]
}
```

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| `version` | string | ✓ | スキーマバージョン。現在は `"0.1"` のみ有効 |
| `base_image` | string | ✗ | ベース画像のファイルパス（spec JSONからの相対パスまたは絶対パス）。省略時は白背景 |
| `output` | string | ✓ | 出力 PNG のファイルパス |
| `canvas` | object | ✗ | キャンバスサイズ。省略時は base_image の自然サイズ、どちらもなければ 1200×1700 |
| `canvas.width` | number | ✗ | 幅（px）|
| `canvas.height` | number | ✗ | 高さ（px）|
| `elements` | array | ✓ | レンダリング要素の配列（下記参照）|

---

## elements の種類

### type: "bubble" — フキダシ（Canvas描画、自動サイジング）

テキストサイズに合わせてフキダシ本体が自動的にサイジングされる。

```json
{
  "type": "bubble",
  "id": "b1",
  "text": "おはよう、\n世界。",
  "x": 120,
  "y": 80,
  "shape": "normal",
  "tail": { "direction": "bottom-left" },
  "writing": "vertical",
  "font": "GenEiAntiquePv6",
  "fontSize": 28,
  "lineHeight": 1.1
}
```

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|-----|------|-----------|------|
| `type` | string | ✓ | — | `"bubble"` |
| `id` | string | ✗ | 自動生成 | 要素識別子（エラーメッセージ用）|
| `text` | string | ✓ | — | セリフ本文。`\n` で改行（縦書き時は列区切り）|
| `x` | number | ✓ | — | テキスト基準点の X 座標（px）|
| `y` | number | ✓ | — | テキスト基準点の Y 座標（px）|
| `shape` | string | ✗ | `"normal"` | フキダシの形状。現在は `"normal"` のみ対応（後述）|
| `tail` | object | ✗ | `{"direction":"bottom-left"}` | 尾の方向（現在は bottom-left 固定）|
| `writing` | string | ✗ | `"vertical"` | `"vertical"` または `"horizontal"` |
| `font` | string | ✗ | `"GenEiAntiquePv6"` | フォント名（後述）|
| `fontSize` | number | ✗ | 24 | 文字サイズ（px）|
| `lineHeight` | number | ✗ | 1.1 | 行間係数 |

#### shape の取りうる値

| 値 | 説明 | v0.1 実装状況 |
|----|------|--------------|
| `"normal"` | 楕円＋三角の尾 | **対応済み**（`computeBubbleShape` / `drawBubbleBox` を使用）|
| `"shout"` | トゲトゲの吹き出し | **未実装**（予約済み、exit 1）|
| `"thought"` | 雲形の吹き出し | **未実装**（予約済み、exit 1）|
| `"rect"` | 四角形の吹き出し | **未実装**（予約済み、exit 1）|

v0.1 では `"normal"` 以外を指定すると stderr にエラーを出して exit 1 する。

---

### type: "text" — フキダシなしのテキスト

```json
{
  "type": "text",
  "id": "t1",
  "text": "テキスト",
  "x": 200,
  "y": 300,
  "writing": "vertical",
  "font": "GenEiAntiquePv6",
  "fontSize": 24,
  "lineHeight": 1.1
}
```

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|-----|------|-----------|------|
| `type` | string | ✓ | — | `"text"` |
| `id` | string | ✗ | 自動生成 | 要素識別子 |
| `text` | string | ✓ | — | 本文。`\n` で改行 |
| `x` | number | ✓ | — | X 座標（px）|
| `y` | number | ✓ | — | Y 座標（px）|
| `writing` | string | ✗ | `"horizontal"` | `"vertical"` または `"horizontal"` |
| `font` | string | ✗ | `"GenEiAntiquePv6"` | フォント名 |
| `fontSize` | number | ✗ | 24 | 文字サイズ（px）|
| `lineHeight` | number | ✗ | 1.1 | 行間係数 |

---

### type: "monologue" — モノローグ（枠付きナレーション）

```json
{
  "type": "monologue",
  "id": "m1",
  "text": "そして時は流れた。",
  "x": 50,
  "y": 50,
  "writing": "horizontal",
  "font": "GenEiAntiquePv6",
  "fontSize": 20,
  "lineHeight": 1.1
}
```

`"text"` と同じフィールドを持つ。白背景＋黒枠付きのボックスを描画する。

---

### type: "sfx" — 効果音文字（スコープ外・予約のみ）

```json
{
  "type": "sfx",
  "text": "ドーン！",
  "x": 300,
  "y": 400
}
```

v0.1 では未実装。指定すると stderr に警告を出してその要素をスキップする（exit 0）。

---

## 利用可能なフォント

| `font` 値 | フォント名 | TTF パス |
|-----------|-----------|---------|
| `"GenEiAntiquePv6"` | 源暎アンチック Pv6 | `assets/fonts/GenEiAntiquePv6-M.ttf` |
| `"GenEiAntiqueNv6"` | 源暎アンチック Nv6 | `assets/fonts/GenEiAntiqueNv6-M.ttf` |
| `"ChikaraDzuyoku"` | 851チカラヅヨク かなA | `assets/fonts/851CHIKARA-DZUYOKU_kanaA_004.ttf` |

フォント未指定時は `"GenEiAntiquePv6"` を使用する。  
不明なフォント名を指定した場合は stderr に警告を出し `"GenEiAntiquePv6"` にフォールバックする。

### Node.js環境でのフォント登録

`canvas` npm パッケージの `registerFont()` を使用する:

```js
const { registerFont } = require('canvas');
const path = require('path');

const ASSET_ROOT = path.resolve(__dirname, '../../assets');

registerFont(path.join(ASSET_ROOT, 'fonts/GenEiAntiquePv6-M.ttf'), { family: 'GenEiAntiquePv6' });
registerFont(path.join(ASSET_ROOT, 'fonts/GenEiAntiqueNv6-M.ttf'), { family: 'GenEiAntiqueNv6' });
registerFont(path.join(ASSET_ROOT, 'fonts/851CHIKARA-DZUYOKU_kanaA_004.ttf'), { family: 'ChikaraDzuyoku' });
```

`registerFont()` は canvas コンテキスト生成より前に呼び出す必要がある。

---

## バリデーション規則

以下を満たさない場合は stderr に 1行エラーを出力して **exit 1** する:

| 規則 | エラーメッセージ例 |
|------|-----------------|
| JSON パース失敗 | `ERROR: invalid JSON in spec file: Unexpected token ...` |
| `version` が `"0.1"` 以外 | `ERROR: unsupported version "1.0"; expected "0.1"` |
| `output` フィールドがない | `ERROR: "output" field is required` |
| `elements` が配列でない | `ERROR: "elements" must be an array` |
| 要素に `type` フィールドがない | `ERROR: element[0]: "type" field is required` |
| `type` が未知 | `ERROR: element[0]: unknown type "unknown"` |
| `shape` が未実装 | `ERROR: element[0]: shape "shout" is not implemented in v0.1` |
| `base_image` が存在しない | `ERROR: base_image not found: input/cut_001.png` |
| テキスト文字列が空 | `ERROR: element[0]: "text" must be a non-empty string` |

---

## 完全な使用例

```json
{
  "version": "0.1",
  "base_image": "input/page_001.png",
  "output": "output/page_001_with_dialog.png",
  "elements": [
    {
      "type": "bubble",
      "id": "b1",
      "text": "おはよう、\n世界。",
      "x": 120,
      "y": 80,
      "shape": "normal",
      "writing": "vertical",
      "font": "GenEiAntiquePv6",
      "fontSize": 28,
      "lineHeight": 1.1
    },
    {
      "type": "bubble",
      "id": "b2",
      "text": "今日もいい天気ですね！",
      "x": 600,
      "y": 200,
      "shape": "normal",
      "writing": "vertical",
      "font": "ChikaraDzuyoku",
      "fontSize": 32,
      "lineHeight": 1.2
    },
    {
      "type": "monologue",
      "id": "m1",
      "text": "春の朝。",
      "x": 20,
      "y": 20,
      "writing": "horizontal",
      "fontSize": 20
    }
  ]
}
```
