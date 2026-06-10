'use strict';

const path = require('path');
const { registerFont } = require('canvas');
const { FONTS } = require('./renderer');

const PROJECT_ROOT = path.resolve(__dirname, '../../');

let _registered = false;

function registerGinaFonts() {
  if (_registered) return;
  for (const f of FONTS) {
    const ttfPath = path.join(PROJECT_ROOT, f.file);
    registerFont(ttfPath, { family: f.name });
  }
  _registered = true;
}

module.exports = { registerGinaFonts };
