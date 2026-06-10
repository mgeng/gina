#!/usr/bin/env node
'use strict';

/**
 * gina-render CLI
 *
 * Usage:
 *   gina-render spec.json
 *   gina-render --base input.png --spec spec.json --out output.png
 *   gina-render batch specs/\*.json
 *
 * Exit codes:
 *   0  成功
 *   1  入力エラー（不正JSON、バリデーション失敗、ファイルなし）
 *   2  レンダリング失敗
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { registerGinaFonts } = require('../src/core/fonts');
const { renderSpec } = require('../src/core/renderer');

// ---- バリデーション ----

const VALID_TYPES = new Set(['bubble', 'text', 'monologue', 'sfx']);
const IMPLEMENTED_SHAPES = new Set(['normal']);

function validateSpec(spec, specPath) {
  if (typeof spec !== 'object' || spec === null) {
    throw new InputError('spec must be a JSON object');
  }
  if (spec.version !== '0.1') {
    throw new InputError(`unsupported version "${spec.version}"; expected "0.1"`);
  }
  if (!spec.output) {
    throw new InputError('"output" field is required');
  }
  if (!Array.isArray(spec.elements)) {
    throw new InputError('"elements" must be an array');
  }
  for (const [i, el] of spec.elements.entries()) {
    if (!el.type) throw new InputError(`element[${i}]: "type" field is required`);
    if (!VALID_TYPES.has(el.type)) throw new InputError(`element[${i}]: unknown type "${el.type}"`);
    if (el.type === 'sfx') continue; // sfx は skip、警告は renderer 側で出す
    if (el.type === 'bubble' && el.shape && !IMPLEMENTED_SHAPES.has(el.shape)) {
      throw new InputError(`element[${i}]: shape "${el.shape}" is not implemented in v0.1`);
    }
    if (typeof el.text !== 'string' || el.text.length === 0) {
      throw new InputError(`element[${i}]: "text" must be a non-empty string`);
    }
    if (typeof el.x !== 'number' || typeof el.y !== 'number') {
      throw new InputError(`element[${i}]: "x" and "y" must be numbers`);
    }
  }
  if (spec.base_image) {
    const basePath = path.dirname(path.resolve(specPath));
    const imgPath = path.isAbsolute(spec.base_image)
      ? spec.base_image
      : path.join(basePath, spec.base_image);
    if (!fs.existsSync(imgPath)) {
      throw new InputError(`base_image not found: ${spec.base_image}`);
    }
  }
}

// ---- エラー型 ----

class InputError extends Error {
  constructor(msg) { super(msg); this.name = 'InputError'; }
}

// ---- ファイル処理 ----

function loadSpec(specPath) {
  let raw;
  try {
    raw = fs.readFileSync(specPath, 'utf8');
  } catch (e) {
    throw new InputError(`cannot read spec file: ${e.message}`);
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    throw new InputError(`invalid JSON in spec file: ${e.message}`);
  }
  return spec;
}

async function processSpec(specPath) {
  const spec = loadSpec(specPath);
  validateSpec(spec, specPath);

  const basePath = path.dirname(path.resolve(specPath));
  let buf;
  try {
    buf = await renderSpec(spec, { createCanvas, loadImage, basePath });
  } catch (e) {
    throw Object.assign(new Error(`render failed: ${e.message}`), { code: 2 });
  }

  const outPath = path.isAbsolute(spec.output)
    ? spec.output
    : path.join(basePath, spec.output);
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

// ---- CLI エントリポイント ----

async function main(argv) {
  registerGinaFonts();

  const args = argv.slice(2);

  if (args.length === 0) {
    process.stderr.write('ERROR: no arguments provided\n');
    printUsage();
    process.exit(1);
  }

  // batch モード
  if (args[0] === 'batch') {
    const specFiles = args.slice(1);
    if (specFiles.length === 0) {
      process.stderr.write('ERROR: batch requires at least one spec file\n');
      process.exit(1);
    }
    let hasError = false;
    for (const f of specFiles) {
      try {
        const out = await processSpec(f);
        process.stdout.write(`OK: ${f} -> ${out}\n`);
      } catch (e) {
        process.stderr.write(`ERROR: ${f}: ${e.message}\n`);
        hasError = true;
      }
    }
    process.exit(hasError ? 1 : 0);
    return;
  }

  // --base / --spec / --out モード
  if (args[0] === '--base' || args[0] === '--spec') {
    let baseImage = null;
    let specFile = null;
    let outFile = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--base') baseImage = args[++i];
      else if (args[i] === '--spec') specFile = args[++i];
      else if (args[i] === '--out') outFile = args[++i];
    }
    if (!specFile) {
      process.stderr.write('ERROR: --spec is required\n');
      process.exit(1);
    }
    const spec = loadSpec(specFile);
    if (baseImage) spec.base_image = baseImage;
    if (outFile) spec.output = outFile;
    validateSpec(spec, specFile);
    try {
      const basePath = path.dirname(path.resolve(specFile));
      const buf = await renderSpec(spec, { createCanvas, loadImage, basePath });
      const resolvedOut = path.isAbsolute(spec.output)
        ? spec.output
        : path.join(basePath, spec.output);
      const outDir = path.dirname(resolvedOut);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(resolvedOut, buf);
      process.stdout.write(`OK: -> ${resolvedOut}\n`);
    } catch (e) {
      const code = e.code === 2 ? 2 : 1;
      process.stderr.write(`ERROR: ${e.message}\n`);
      process.exit(code);
    }
    return;
  }

  // デフォルト: spec.json を直接指定
  const specFile = args[0];
  try {
    const out = await processSpec(specFile);
    process.stdout.write(`OK: ${specFile} -> ${out}\n`);
  } catch (e) {
    const code = e.code === 2 ? 2 : (e instanceof InputError ? 1 : 2);
    process.stderr.write(`ERROR: ${e.message}\n`);
    process.exit(code);
  }
}

function printUsage() {
  process.stdout.write([
    'Usage:',
    '  gina-render spec.json',
    '  gina-render --base input.png --spec spec.json --out output.png',
    '  gina-render batch spec1.json spec2.json ...',
    '',
  ].join('\n'));
}

main(process.argv).catch((e) => {
  process.stderr.write(`FATAL: ${e.message}\n`);
  process.exit(2);
});
