const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Git 的開發安裝工具分類有學生可見標籤', () => {
  const source = fs.readFileSync(path.join(__dirname, 'downloads.js'), 'utf8');

  assert.match(source, /"development-installation-tool": "開發／安裝工具 \/ Development \/ Installation Tool"/);
});
