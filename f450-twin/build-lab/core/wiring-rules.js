// 組裝實訓室｜接線規則校驗（確定性邏輯，不使用 AI）
//
// 所有 PASS／錯誤判定只從這裡產生，有單元測試保護；AI 之後（P4）只負責用白話解釋這裡給的錯誤代碼。
// 檢查項目：極性、介面類型（插不插得進去）、接口用途（GPS／TELEM）、電調訊號順序、電調與電機對應、
// 供電路徑（主電池不可直接接飛控）、接口重複使用、飛控方向、槳葉旋向、整機完整性（例如接收機未連接）。
// 所有危險錯誤只在虛擬環境中判定與展示，不對任何真實硬體供電。

export const SEVERITY = Object.freeze({ ok: 'ok', warn: 'warn', danger: 'danger', critical: 'critical' });
export const SEVERITY_ZH = { ok: '正確', warn: '錯誤', danger: '危險錯誤', critical: '嚴重危險' };

export const CODES = Object.freeze({
  OK: 'OK',
  REVERSED_POLARITY: 'REVERSED_POLARITY',
  WRONG_PAD: 'WRONG_PAD',
  NO_FIT: 'NO_FIT',                     // 接頭插不進去（介面類型不同）
  SIGNAL_MISMATCH: 'SIGNAL_MISMATCH',   // 插得進去但訊號類型不對（例如電調訊號插 RC IN）
  ESC_ORDER: 'ESC_ORDER',               // 電調訊號接到錯的 MAIN OUT
  UART_WRONG_PORT: 'UART_WRONG_PORT',   // GPS／數傳插到彼此的序列埠
  MOTOR_MISMATCH: 'MOTOR_MISMATCH',     // 電調三相接到別顆電機（焊點錯誤）
  BATTERY_TO_FC: 'BATTERY_TO_FC',       // 主電池直接接飛控 POWER
  OCCUPIED: 'OCCUPIED',                 // 這個接口已經被別的線用掉
  UNKNOWN_POINT: 'UNKNOWN_POINT',
  FC_ORIENTATION: 'FC_ORIENTATION',
  PROP_REVERSED: 'PROP_REVERSED',
  RC_MISSING: 'RC_MISSING',
  TX_RX_SWAPPED: 'TX_RX_SWAPPED',       // 序列埠 TX／RX 沒有交叉
  VOLTAGE_RANGE: 'VOLTAGE_RANGE',       // 電池電壓超出零件規格
  ANTENNA_MISSING: 'ANTENNA_MISSING',   // 圖傳沒接天線就通電
  REQUIRED_MISSING: 'REQUIRED_MISSING',
});

/** 合併板卡接口與其他接點成一份目錄 */
export function buildCatalog(board, extraPoints) {
  return { ...board.ports, ...extraPoints };
}

const result = (code, severity, messageZh, fixZh) => ({ ok: code === CODES.OK, code, severity, messageZh, fixZh: fixZh || '' });
const OK = (msg) => result(CODES.OK, SEVERITY.ok, msg || '接對了。');

/**
 * 判斷某一步的接法。
 * @param {object} step     data/f450-wiring.js 的步驟
 * @param {object} choice   polarity 步驟：{ red: 接點 id }；port／phase 步驟：{ target: 接點 id }
 * @param {object} ctx      { catalog, fits（CONNECTOR_FITS）, occupied: Set<接點 id>（其他步驟已用掉的接口） }
 */
export function evaluateStep(step, choice, ctx) {
  const { catalog, fits, occupied = new Set() } = ctx;
  if (step.kind === 'polarity') {
    const red = catalog[choice.red];
    if (!red) return result(CODES.UNKNOWN_POINT, SEVERITY.warn, '找不到這個接點。');
    if (red.group !== step.group) {
      return result(CODES.WRONG_PAD, SEVERITY.warn, `要接在「${step.groupZh || catalog[step.expect.red].nameZh.replace(/ ＋$/, '')}」這一組。`,
        step.pair === 'uart' ? '接收機固定接在設定好的那一組 UART，Betaflight 的 Ports 分頁也要開同一組。' : '每顆電調焊在自己機臂旁邊的那組焊盤，線最短、不交叉。');
    }
    if (choice.red !== step.expect.red) {
      if (step.pair === 'uart') {
        return result(CODES.TX_RX_SWAPPED, SEVERITY.warn,
          'TX／RX 沒有交叉：接收機的 TX（傳送）接到了飛控的 TX，兩邊都在講話、沒有人在聽，飛控收不到遙控訊號。',
          '序列埠要交叉接：接收機 TX → 飛控 RX、接收機 RX → 飛控 TX。');
      }
      return result(CODES.REVERSED_POLARITY, SEVERITY.danger,
        step.capacitor ? '電容極性接反！電解電容反接通電會發熱、鼓包甚至爆裂。' : '正負極接反！通電瞬間可能燒毀電調或電源模組，嚴重時會讓鋰電池短路起火。',
        step.capacitor ? '電容外殼有白色條紋（−號）的那腳接「−」焊盤，另一腳接「＋」。' : '紅線（正）接「＋」、黑線（負）接「−」：正接正、負接負。');
    }
    return OK(step.pair === 'uart' ? 'TX／RX 交叉正確。' : '極性正確：紅接＋、黑接−。');
  }

  const target = catalog[choice.target];
  if (!target) return result(CODES.UNKNOWN_POINT, SEVERITY.warn, '找不到這個接點。');
  if (choice.target !== step.expect && occupied.has(choice.target)) {
    return result(CODES.OCCUPIED, SEVERITY.warn, `「${target.nameZh}」已經接了別的線。`, '一個接口只能接一個裝置。');
  }

  if (step.kind === 'phase') {
    const phaseType = step.targetType || 'motor-phase';
    if (target.type !== phaseType) return result(CODES.NO_FIT, SEVERITY.warn, '三相線只能焊在電機／電調的三相焊盤上。');
    if (choice.target !== step.expect) {
      return result(CODES.MOTOR_MISMATCH, SEVERITY.danger,
        `焊點錯誤：應該接「${catalog[step.expect].nameZh}」，卻接到「${target.nameZh}」。起飛時馬達順序錯亂，飛機會立刻翻覆。`,
        step.orderRuleZh || '每顆電調只接自己機臂上的那顆電機（電調編號＝電機編號）。');
    }
    return OK('三相線接好了；旋向之後用馬達測試確認（拆槳）。');
  }

  // 一般接頭（port）
  const fitTypes = fits[step.connector] || [];
  const accepted = step.accept || [step.expect];
  if (step.connector === 'xt60' && target.type === 'power6') {
    return result(CODES.BATTERY_TO_FC, SEVERITY.critical,
      '嚴重危險：主電池電壓（3S 約 11～12.6V）直接接飛控 POWER 口，遠超過 5V 的設計，會立即燒毀飛控。',
      '電池只能接電源模組，由電源模組降壓成 5V 再送到飛控。');
  }
  if (!fitTypes.includes(target.type)) {
    return result(CODES.NO_FIT, SEVERITY.warn, `接頭插不進「${target.nameZh}」（介面類型不同）。`, '先看接頭針數與形狀，再找對應的接口。');
  }
  if (accepted.includes(choice.target)) return OK();

  // 插得進去但不對：依情況給具體說明
  if (target.type === 'pwm' && step.connector === 'esc-signal') {
    const want = Number(step.expect.replace('fc.main', ''));
    return result(CODES.ESC_ORDER, SEVERITY.danger,
      `電調訊號順序錯誤：${want} 號電調接到了 MAIN OUT ${target.index}。飛控會把 ${target.index} 號馬達的指令送給 ${want} 號位置的電機，起飛會翻。`,
      step.orderRuleZh || `依 ArduPilot Quad X：${want} 號電調接 MAIN OUT ${want}。`);
  }
  if (target.type === 'uart') {
    const what = step.connector === 'gps-6p' ? 'GPS' : '數傳';
    return result(CODES.UART_WRONG_PORT, SEVERITY.warn,
      `${what}插到「${target.nameZh}」了。接頭一樣插得進去，但飛控不會在這個口找${what}，${what === 'GPS' ? '會一直沒有定位' : '地面站會連不上'}。`,
      `GPS 接 GPS 口；數傳接 TELEM1（TELEM2 也能用，但要另外改 SERIAL2 參數，本課程統一接 TELEM1）。`);
  }
  return result(CODES.SIGNAL_MISMATCH, SEVERITY.warn,
    `「${target.nameZh}」插得進去，但訊號類型不對（${step.connector === 'rx-servo' ? '接收機要接 RC IN 輸入，不是 MAIN OUT 輸出' : '電調訊號要接 MAIN OUT 輸出，不是 RC IN 輸入'}）。`,
    '輸入（遙控接收機）接 RC IN；輸出（電調）接 MAIN OUT。');
}

/** 飛控方向：箭頭偏離機頭且沒有在 AHRS_ORIENTATION 設定對應旋轉 → 錯誤 */
export function checkOrientation(rotYDeg, ahrsOrientation = 0) {
  // AHRS_ORIENTATION：0 None、2 Yaw90、4 Yaw180、6 Yaw270（ArduPilot Copter-4.6.3 參數說明）
  const yawFor = { 0: 0, 2: 90, 4: 180, 6: 270 };
  const physical = ((Math.round(rotYDeg) % 360) + 360) % 360;
  const configured = yawFor[ahrsOrientation];
  if (configured !== undefined && physical === configured) return OK('飛控方向與設定一致。');
  return result(CODES.FC_ORIENTATION, SEVERITY.danger,
    `飛控方向錯誤：箭頭偏離機頭 ${physical}°，設定卻是 ${configured ?? '未知'}°。飛控會把傾斜方向算錯，一起飛就翻。`,
    '把飛控箭頭轉回朝機頭；若空間限制只能轉向安裝，就要設定 AHRS_ORIENTATION 並重新校準水平。');
}

/** 槳葉旋向必須與電機旋向一致 */
export function checkProp(motorSpin, propSpin) {
  if (motorSpin === propSpin) return OK('槳葉與電機旋向一致。');
  return result(CODES.PROP_REVERSED, SEVERITY.danger,
    `槳葉反裝：電機是 ${motorSpin}，槳卻是 ${propSpin}。這支槳會往下吹，飛機起飛瞬間翻覆。`,
    'CW 電機裝 CW 正槳、CCW 電機裝 CCW 反槳；槳葉前緣（較厚、較圓那邊）要朝旋轉方向。');
}

/** 整機完整性檢查（接線全部完成後、模擬上電前） */
const F450_REQUIREMENTS = [
  { stepId: 'rx-rcin', code: CODES.RC_MISSING, severity: SEVERITY.danger, messageZh: '接收機未連接：遙控器無法控制飛機，也無法觸發失控保護。', fixZh: '接收機接到 RC IN，並在地面站做遙控校準。' },
];
export function validateSystem(connectedStepIds, requirements = F450_REQUIREMENTS) {
  return requirements
    .filter((req) => !connectedStepIds.includes(req.stepId))
    .map((req) => result(req.code || CODES.REQUIRED_MISSING, req.severity || SEVERITY.danger, req.messageZh, req.fixZh));
}

/**
 * 電池電壓檢查：電池滿電電壓必須落在每個零件的規格範圍內（公式：串數 × 4.2V）。
 * @param {number} cells   電池串數（例如 4 代表 4S）
 * @param {Array<{nameZh: string, minCells: number, maxCells: number}>} parts
 */
export function checkVoltage(cells, parts) {
  const over = parts.filter((p) => cells > p.maxCells);
  const under = parts.filter((p) => cells < p.minCells);
  if (over.length) {
    return result(CODES.VOLTAGE_RANGE, SEVERITY.critical,
      `電壓超出規格：${cells}S 電池滿電約 ${(cells * 4.2).toFixed(1)}V，超過「${over.map((p) => `${p.nameZh}（最高 ${p.maxCells}S）`).join('、')}」，通電可能燒毀。`,
      '先確認電調、圖傳等零件標示的電壓範圍，選擇規格內的電池。');
  }
  if (under.length) {
    return result(CODES.VOLTAGE_RANGE, SEVERITY.warn,
      `電壓不足：${cells}S 低於「${under.map((p) => `${p.nameZh}（最低 ${p.minCells}S）`).join('、')}」的需求，可能無法正常開機或動力不足。`,
      '選擇零件規格範圍內的電池。');
  }
  return OK('電池電壓在所有零件的規格範圍內。');
}
