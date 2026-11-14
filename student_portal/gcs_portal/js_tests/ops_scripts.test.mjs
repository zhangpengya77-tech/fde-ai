// 教室啟動腳本的靜態檢查（雲端沒有 PowerShell，實際執行要在 Windows 驗收）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const opsDir = new URL('../../../ops/fde-gcs/', import.meta.url);
const raw = readFileSync(new URL('fde-gcs.ps1', opsDir));
const ps1 = raw.toString('utf8');

test('PowerShell script is UTF-8 with BOM and CRLF so Windows PowerShell 5.1 shows Chinese correctly', () => {
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(ps1.split('\n').length - 1, ps1.split('\r\n').length - 1, 'every line ends with CRLF');
});

test('web server only binds 127.0.0.1 on port 8260', () => {
  assert.match(ps1, /\$Port = 8260\b/);
  assert.match(ps1, /\$BindAddr = '127\.0\.0\.1'/);
  assert.doesNotMatch(ps1, /0\.0\.0\.0/);
  for (const reserved of ['8022', '8770', '8110', '8030', '8040', '8111', '8112', '8142', '8013', '5173', '8000', '8251']) {
    assert.doesNotMatch(ps1, new RegExp(`\\$Port = ${reserved}\\b`), reserved);
  }
});

test('runtime data goes to D: by default and C: is refused', () => {
  assert.match(ps1, /'D:\\FDE-GCS-runtime'/);
  assert.match(ps1, /-ieq 'C:'/);
});

test('stop only kills the process this script started and still owns the port', () => {
  const stops = ps1.match(/Stop-Process[^\r\n]*/g) || [];
  assert.equal(stops.length, 1);
  assert.match(ps1, /\$owner\.Pid -eq \$state\.pid -and \$process\.ProcessName -like 'python\*'/);
  assert.doesNotMatch(ps1, /taskkill/i);
});

test('SITL launcher never starts a second SITL', () => {
  const sitl = ps1.slice(ps1.indexOf('function Start-SitlTraining'), ps1.indexOf('switch ($Action)'));
  assert.ok(sitl.indexOf('Get-PortOwner 5760') < sitl.indexOf('Start-Process'), 'checks 5760 before starting anything');
  assert.match(sitl, /不重複啟動/);
});

test('each .bat file calls the script with the expected action', () => {
  for (const [file, action] of [['START_FDE_GCS_WEB.bat', 'start'], ['STOP_FDE_GCS_WEB.bat', 'stop'], ['CHECK_FDE_GCS.bat', 'check'], ['START_FDE_SITL_TRAINING.bat', 'sitl']]) {
    const bat = readFileSync(new URL(file, opsDir), 'latin1');
    assert.match(bat, new RegExp(`fde-gcs\\.ps1" -Action ${action}\\r\\n`), file);
    assert.match(bat, /^[\x00-\x7f]*$/, `${file} is plain ASCII`);
  }
});
