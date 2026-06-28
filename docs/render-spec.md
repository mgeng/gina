# gina-render 入力スキーマ仕様 v0.1

## 概要

`gina-render` CLI の入力 JSON（**render-spec**）の仕様。
ベース画像にフキダシ・テキスト・モノローグを合成して PNG を出力する。

この render-spec は **AI が Gina をヘッドレスで操作するための「口」**である。AI は
小説などからこの JSON を生成し、`gina-render` CLI を呼ぶだけで漫画ページのセリフ
合成が完結する（`.mj` プロジェクトファイルを直接操作する必要はない）。

機械可読なスキーマ定義は [`render-spec.schema.json`](./render-spec.schema.json)（JSON Schema, Draft 2020-12）にある。生成前後の検証に利用できる。

> **この仕様書はコードと一致していることを実コマンドで検証済み**（`bin/gina-render.js` /
> `src/core/renderer.js`）。フィールドを変更したら本書も更新すること。

---

## トップレベル構造

```json
{
  "version": "0.1",
  "base_image": "input/cut_001.png",
  "output": "output/cut_001_final.png",
  "canvas": { "width": 1200, "height": 1700 },
  "elements": [ ... ]
}
```

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| `version` | string | ✓ | スキーマバージョン。現在は `"0.1"` のみ有効 |
| `base_image` | string | ✗ | ベース画像のファイルパス（spec JSON からの相対パスまたは絶対パス）。省略時は白背景 |
| `output` | string | ✓ | 出力 PNG のファイルパス（spec からの相対パスまたは絶対パス）。`--out` で上書き可 |
| `canvas` | object | ✗ | キャンバスサイズ。省略時は base_image の自然サイズ、どちらもなければ 1200×1700 |
| `canvas.width` | number | ✗ | 幅（px）|
| `canvas.height` | number | ✗ | 高さ（px）|
| `elements` | array | ✓ | レンダリング要素の配列（下記参照）。空配列も可 |

描画順は「白背景 → `base_image` → `elements`（配列順）」。後の要素が前面に重なる。

---

## elements 共通フィールド

すべての要素（`sfx` 除く）が持つ基本フィールド。

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|-----|------|-----------|------|
| `type` | string | ✓ | — | `"bubble"` / `"text"` / `"monologue"` / `"sfx"` |
| `id` | string | ✗ | 自動生成（`el_<index>`）| 要素識別子（エラーメッセージ用）|
| `text` | string | ✓ | — | 本文。`\n` で改行（縦書き時は列区切り、右→左）|
| `x` | number | ✓ | — | テキスト基準点の X 座標（px）|
| `y` | number | ✓ | — | テキスト基準点の Y 座標（px）|
| `writing` | string | ✗ | `"horizontal"` | `"vertical"` または `"horizontal"`（`"vertical"` 以外は横書き扱い）|
| `font` | string | ✗ | `"GenEiAntiquePv6"` | フォント名（後述）|
| `fontSize` | number | ✗ | `24` | 文字サイズ（px）|
| `lineHeight` | number | ✗ | `1.1` | 行間係数 |

> **注意**: `writing` のデフォルトは**全要素とも `"horizontal"`（横書き）**。縦書きにしたい場合は明示的に `"writing": "vertical"` を指定する。

---

## type: "bubble" — フキダシ（Canvas描画、自動サイジング）

テキストサイズに合わせてフキダシ本体（楕円＋三角の尾）が自動的にサイジングされる。

```json
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
  "lineHeight": 1.1,
  "tailOffsetX": 0,
  "tailOffsetY": 0
}
```

共通フィールドに加えて:

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|-----|------|-----------|------|
| `shape` | string | ✗ | `"normal"` | フキダシの形状。現在は `"normal"` のみ対応（後述）|
| `tailOffsetX` | number | ✗ | 既定オフセット | 尾の先端の X オフセット（px）。フキダシ中心からの相対 |
| `tailOffsetY` | number | ✗ | 既定オフセット | 尾の先端の Y オフセット（px）|

> **装飾フィールド（`color` / `glow` / `gradient` / `strokeColor` 等）は `bubble` では無視される**（文字は黒・装飾なし）。装飾が必要なら `type:"text"` を使う。

#### shape の取りうる値

| 値 | 説明 | v0.1 実装状況 |
|----|------|--------------|
| `"normal"` | 楕円＋三角の尾 | **対応済み** |
| `"shout"` | トゲトゲの吹き出し | **未実装**（指定すると exit 1）|
| `"thought"` | 雲形の吹き出し | **未実装**（指定すると exit 1）|
| `"rect"` | 四角形の吹き出し | **未実装**（指定すると exit 1）|

v0.1 では `"normal"` 以外を指定すると stderr にエラーを出して exit 1 する。

---

## type: "text" — フキダシなしのテキスト（装飾対応）

`type:"text"` のみ、色・縁取り・グロー・グラデーションに対応する。

```json
{
  "type": "text",
  "id": "t1",
  "text": "派手な\n描き文字",
  "x": 200,
  "y": 300,
  "writing": "horizontal",
  "font": "RocknRollOne",
  "fontSize": 48,
  "lineHeight": 1.1,
  "color": "#cc0000",
  "strokeColor": "#000000",
  "strokeWidth": 3,
  "glow": { "color": "#ffff00", "blur": 10 },
  "gradient": { "from": "#ff0000", "to": "#0000ff", "angle": 45 }
}
```

共通フィールドに加えて（すべて任意・装飾系）:

| フィールド | 型 | デフォルト | 説明 |
|------------|-----|-----------|------|
| `color` | string | 黒系 | 文字色（CSS カラー）。`gradient` 指定時はそちらが優先 |
| `strokeColor` | string | なし | 縁取りの色（CSS カラー）|
| `strokeWidth` | number | なし | 縁取りの太さ（px）。`strokeColor` と併用 |
| `glow` | object | なし | 外側グロー。`{ "color": CSS, "blur": number }`。`blur > 0` で有効 |
| `gradient` | object | なし | 文字のグラデーション塗り。`{ "from": CSS, "to": CSS, "angle": number=90 }`。`from`/`to` 両方が必要 |

---

## type: "monologue" — モノローグ（枠付きナレーション）

白背景＋黒枠のボックスを描画する。共通フィールドのみ（**装飾フィールドは無視**）。

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

---

## type: "sfx" — 効果音文字（スコープ外・予約のみ）

```json
{ "type": "sfx", "text": "ドーン！", "x": 300, "y": 400 }
```

v0.1 では未実装。指定すると stderr に警告を出してその要素を**スキップ**する（exit 0）。
バリデーションも `sfx` は `text`/`x`/`y` チェックをスキップする。

---

## 利用可能なフォント

| `font` 値 | フォント名 | TTF パス |
|-----------|-----------|---------|
| `"GenEiAntiquePv6"` | 源暎アンチック Pv6（標準セリフ）| `assets/fonts/GenEiAntiquePv6-M.ttf` |
| `"GenEiAntiqueNv6"` | 源暎アンチック Nv6 | `assets/fonts/GenEiAntiqueNv6-M.ttf` |
| `"ChikaraDzuyoku"` | 851チカラヅヨク かなA | `assets/fonts/851CHIKARA-DZUYOKU_kanaA_004.ttf` |
| `"RocknRollOne"` | RocknRoll One（丸ゴシック）| `assets/fonts/RocknRollOne-Regular.ttf` |
| `"ShipporiMinchoB"` | しっぽり明朝 B（上品な明朝）| `assets/fonts/ShipporiMincho-Bold.ttf` |
| `"YujiSyuku"` | Yuji Syuku（筆書き楷書）| `assets/fonts/YujiSyuku-Regular.ttf` |

フォント未指定時は `"GenEiAntiquePv6"`。不明なフォント名は stderr に警告を出して
`"GenEiAntiquePv6"` にフォールバックする。

### Node.js環境でのフォント登録

`gina-render` CLI は起動時に上記すべてを `canvas` の `registerFont()` で自動登録する
（`bin/gina-render.js` の `registerGinaFonts()`）。CLI 経由なら追加作業は不要。

---

## CLI の起動方法

```
# 1) spec をそのまま実行（出力先は spec 内 "output"）
gina-render spec.json

# 2) base / spec / out を個別指定（spec の base_image・output を上書き）
gina-render --base input.png --spec spec.json --out output.png

# 3) 複数 spec を一括（複数ページ。1つでも失敗すると exit 1）
gina-render batch page1.json page2.json ...
```

| 終了コード | 意味 |
|-----------|------|
| `0` | 成功（`OK: ...` を stdout に出力）|
| `1` | 入力エラー（バリデーション失敗・引数不足など）|
| `2` | 描画・実行時エラー |

`--base` / `--out` は省略可。`--spec` は必須。`batch` は各ファイルの結果を
`OK:` / `ERROR:` で逐次出力する。

---

## バリデーション規則

以下を満たさない場合は stderr に `ERROR: <メッセージ>` を 1 行出力して **exit 1** する。

| 規則 | エラーメッセージ |
|------|-----------------|
| JSON パース失敗 | `invalid JSON in spec file: ...` |
| spec がオブジェクトでない | `spec must be a JSON object` |
| `version` が `"0.1"` 以外 | `unsupported version "..."; expected "0.1"` |
| `output` がない | `"output" field is required` |
| `elements` が配列でない | `"elements" must be an array` |
| 要素に `type` がない | `element[i]: "type" field is required` |
| `type` が未知 | `element[i]: unknown type "..."` |
| `bubble` の `shape` が未実装 | `element[i]: shape "..." is not implemented in v0.1` |
| `text` が空文字列（sfx 以外）| `element[i]: "text" must be a non-empty string` |
| `x`/`y` が数値でない（sfx 以外）| `element[i]: "x" and "y" must be numbers` |
| `base_image` が存在しない | `base_image not found: ...` |

---

## 座標系とテキストの扱い

- 原点は**左上**、単位は px。Y は下方向に増加。
- `x`,`y` はテキストの**基準点**。`bubble` はこの基準点の周囲にフキダシが自動サイズで描かれる。
- `\n` は改行。**縦書き（`writing:"vertical"`）では列の区切り**となり、列は**右から左**へ並ぶ。

---

## 小説 → 漫画ワークフロー（現状の使い方）

1. 小説本文から、AI が「ページ構成・各コマの絵・セリフ・配置」を設計する。
2. 各ページの絵（漫画アート）を用意する（画像生成など。Gina 外）。
3. ページごとに render-spec JSON を生成し、`gina-render --base ページ絵.png --spec セリフ.json --out ページ.png` でセリフを焼き込む。複数ページは `batch` でまとめて処理する。

### v0.1 の制約（次フェーズ候補）

- **1 spec = 1 ページ = 下地絵 1 枚**。1 つの spec 内で複数のコマ絵を配置する
  **コマ割り合成（panel）は未対応**。コマ割りは下地絵側で完結させる。
- `sfx`（描き文字）、`shape` の `shout`/`thought`/`rect` は未実装。

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
      "writing": "vertical",
      "font": "ChikaraDzuyoku",
      "fontSize": 32,
      "lineHeight": 1.2
    },
    {
      "type": "text",
      "id": "t1",
      "text": "ドーン",
      "x": 300,
      "y": 500,
      "font": "RocknRollOne",
      "fontSize": 64,
      "color": "#ffffff",
      "strokeColor": "#000000",
      "strokeWidth": 6,
      "glow": { "color": "#ff3300", "blur": 14 }
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
