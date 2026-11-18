// 組裝實訓室｜Betaflight 設定檢查報告（模擬，不連接、不寫入任何真實飛控）
//
// 設定名稱依 Betaflight 4.5.2 原始碼 src/main/cli/settings.c 與官方文件核對（2026-11-19）；
// 實際韌體版本、電調支援的協定、圖傳廠牌的 OSD 設定都「待確認」，所有項目標 PENDING_MANUAL。

const SRC = (title, url) => ({ status: 'PENDING_MANUAL', title, url, date: '2026-11-19' });
const SETTINGS = SRC('Betaflight 4.5.2 原始碼 src/main/cli/settings.c', 'https://github.com/betaflight/betaflight/blob/4.5.2/src/main/cli/settings.c');
const MIXER = SRC('Betaflight 原始碼 src/main/flight/mixer_init.c（mixerQuadX）', 'https://github.com/betaflight/betaflight/blob/master/src/main/flight/mixer_init.c');
const MOTORS_TAB = SRC('Betaflight 文件：Motors 分頁', 'https://betaflight.com/docs/wiki/app/motors-tab');

export function buildBetaflightReport(state) {
  const has = (id) => state.connections.includes(id);
  const rows = [
    { name: 'Mixer（機型）', value: 'QUADX', meaningZh: 'X 型四旋翼；馬達順序 M1 右後、M2 右前、M3 左後、M4 左前', why: '225 mm X 型機架。', source: MIXER },
    { name: 'yaw_motors_reversed', value: 'OFF', meaningZh: 'Motors 分頁「Motor direction is reversed」：OFF＝槳向內（預設）', why: '本實訓採預設「槳向內」：右前與左後 CCW、左前與右後 CW。', source: MOTORS_TAB },
    { name: 'motor_pwm_protocol', value: 'DSHOT600', meaningZh: '電調通訊協定（可選 PWM、ONESHOT125、DSHOT150／300／600 等）', why: '通用 4 合 1 電調多支援 DShot；實際依電調規格（待確認）。', source: SETTINGS },
    { name: 'Ports：UART2', value: has('rx-uart') ? 'Serial RX 開啟' : '（接收機未接）', meaningZh: 'Ports 分頁要在接收機所在的 UART 開啟 Serial RX', why: '接收機接在 UART2。', source: SETTINGS },
    { name: 'serialrx_provider', value: 'CRSF', meaningZh: '序列接收機協定（選項含 SBUS、IBUS、CRSF、GHST 等）', why: 'ExpressLRS 接收機使用 CRSF 協定。', source: SETTINGS },
    { name: 'osd_displayport_device', value: has('vtx-fc') ? 'MSP' : '（圖傳未接）', meaningZh: 'OSD 輸出裝置（NONE、AUTO、MAX7456、MSP、FRSKYOSD）', why: '數位圖傳透過 MSP DisplayPort 顯示 OSD；圖傳所在 UART 要開 MSP（依圖傳說明書，待確認）。', source: SETTINGS },
    { name: 'vcd_video_system', value: has('vtx-fc') ? 'HD' : '（圖傳未接）', meaningZh: '影像系統（AUTO、PAL、NTSC、HD）', why: '數位圖傳用 HD。', source: SETTINGS },
  ];
  const checklist = [
    '連上 Betaflight Configurator 前先**拆槳**',
    'Setup 分頁：飛機實際傾斜方向與畫面模型一致（確認飛控方向）',
    'Receiver 分頁：搖桿動作與通道對應正確；設定解鎖開關',
    'Motors 分頁：逐顆測試順序（M1 右後、M2 右前、M3 左後、M4 左前）與旋向（**拆槳**）',
    '失控保護（Failsafe）設定並實測：關遙控器時馬達要停止（**拆槳**）',
    '圖傳：先接天線再通電，確認眼鏡有畫面與 OSD',
  ];
  return { rows, checklist, firmwareNote: '依 Betaflight 4.5.x 設定名稱；實際韌體版本待確認。', writesToVehicle: false };
}

/** 報告轉成純文字（下載用） */
export function betaflightReportToText(report, meta = {}) {
  return [
    '# FDE-AI 組裝實訓室｜Betaflight 設定檢查報告（模擬）',
    '# 這不是 diff／dump 檔，不可直接貼進飛控 CLI；所有數值須經教師覆核（PENDING_MANUAL）。',
    `# ${report.firmwareNote}`,
    `# 產生時間：${new Date().toISOString()}  版本：${meta.version || ''}`,
    '',
    ...report.rows.map((r) => `# ${r.name} = ${r.value}    ｜${r.meaningZh}｜${r.why}｜來源：${r.source.title}`),
    '',
    '# 上線前檢查清單：',
    ...report.checklist.map((c, i) => `# ${i + 1}. ${c.replace(/\*\*/g, '')}`),
  ].join('\n');
}
