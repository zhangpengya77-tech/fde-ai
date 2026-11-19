// 組裝實訓室入口（選項 B）：首頁數位孿生卡片內有新版入口一個，舊版入口仍是一個且不變
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD_LAB_FLAGS } from '../../f450-twin/build-lab/build-lab-flags.js';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('首頁：新版入口一個、指向 /f450-twin/build-lab/；舊版入口仍是一個', () => {
  assert.equal(html.match(/id="buildLabEntry"/g)?.length, 1);
  assert.match(html, /id="buildLabEntry" href="\/f450-twin\/build-lab\/"/);
  assert.equal(html.match(/id="buildF450TwinEntry"/g)?.length, 1);
  // 新版入口放在數位孿生卡片內（與舊版並列）
  const card = html.slice(html.indexOf('id="buildF450Twin"'), html.indexOf('build-layout'));
  assert.ok(card.includes('id="buildLabEntry"'));
  assert.equal(BUILD_LAB_FLAGS.entryVisible, true);
});
