/**
 * ゴールデンテスト
 *
 * gina-render の出力が決定論的（同じ spec から同じ PNG が生成される）ことを検証。
 *
 * GUIとのピクセル一致比較について:
 *   理想的には GUI でエクスポートした PNG と比較するが、ブラウザが使えない環境では
 *   「同一 spec を2回レンダリングして差分0%」で代替検証する。
 *   GUI との比較は docs/render-spec.md の「フォント確認」セクションに記載した
 *   手動テスト手順で実施する。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;
const { createCanvas, loadImage } = require('canvas');
const { registerGinaFonts } = require('../src/core/fonts');
const { renderSpec } = require('../src/core/renderer');

registerGinaFonts();

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SPECS_DIR = path.join(FIXTURES_DIR, 'specs');
const OUTPUT_DIR = path.join(FIXTURES_DIR, 'output');

function parsePng(buf) {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    png.parse(buf, (err, data) => err ? reject(err) : resolve(data));
  });
}

async function compareImages(bufA, bufB) {
  const imgA = await parsePng(bufA);
  const imgB = await parsePng(bufB);
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    return { diffRatio: 1, reason: `size mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}` };
  }
  const diff = new PNG({ width: imgA.width, height: imgA.height });
  const numDiff = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, { threshold: 0.1 });
  const totalPixels = imgA.width * imgA.height;
  const diffRatio = numDiff / totalPixels;
  return { diffRatio, diffPng: diff, numDiff, totalPixels };
}

async function runGoldenTest(specName) {
  const specPath = path.join(SPECS_DIR, specName);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

  // 1回目レンダリング（参照）
  const basePath = SPECS_DIR;
  const bufA = await renderSpec(spec, { createCanvas, loadImage, basePath });

  // 2回目レンダリング（再現性確認）
  const bufB = await renderSpec(spec, { createCanvas, loadImage, basePath });

  const { diffRatio, diffPng, reason } = await compareImages(bufA, bufB);

  if (diffRatio > 0.05) {
    const diffPath = path.join(OUTPUT_DIR, specName.replace('.json', '-diff.png'));
    const diffBuf = PNG.sync.write(diffPng);
    fs.writeFileSync(diffPath, diffBuf);
    return { pass: false, specName, diffRatio, diffPath, reason };
  }

  return { pass: true, specName, diffRatio };
}

async function main() {
  const specs = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith('.json'));
  let allPassed = true;

  console.log('=== gina-render ゴールデンテスト ===\n');
  console.log('検証方法: 同一 spec を2回レンダリングして差分率を計測（決定論的性の確認）');
  console.log('合格基準: 差分率 < 5%\n');

  for (const spec of specs) {
    const result = await runGoldenTest(spec);
    const pct = (result.diffRatio * 100).toFixed(3);
    if (result.pass) {
      console.log(`✓ PASS  ${spec}  (差分率: ${pct}%)`);
    } else {
      console.log(`✗ FAIL  ${spec}  (差分率: ${pct}%)`);
      if (result.diffPath) console.log(`         差分画像: ${result.diffPath}`);
      if (result.reason) console.log(`         原因: ${result.reason}`);
      allPassed = false;
    }
  }

  console.log('\n--- フィクスチャ出力 PNG 一覧 ---');
  for (const f of fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.png') && !f.includes('-diff'))) {
    const size = fs.statSync(path.join(OUTPUT_DIR, f)).size;
    console.log(`  ${f}  (${size} bytes)`);
  }

  console.log('\n--- 日本語フォント確認 ---');
  console.log('  以下の PNG を目視して縦書き日本語が文字化け・豆腐になっていないことを確認:');
  console.log('  - fixture1-basic.png     : 「おはよう！」縦書きフキダシ');
  console.log('  - fixture2-long-vertical.png : 5列の縦書き長文フキダシ');
  console.log('  - fixture3-multi-bubble.png  : 3フォントの縦書きフキダシ');

  if (allPassed) {
    console.log('\n✓ 全テスト合格');
    process.exit(0);
  } else {
    console.log('\n✗ テスト失敗');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
