// 組裝實訓室｜5 吋 FPV 錯誤案例（只在虛擬環境展示，不對任何真實硬體供電）
// 每個案例都把錯誤做法丟進 wiring-rules.js 實際判定。
import { evaluateStep, checkProp, checkVoltage, validateSystem, buildCatalog } from './wiring-rules.js';

export function buildFpv5ErrorCases(wiring, board, extraPoints, fits) {
  const catalog = buildCatalog(board, extraPoints);
  const ctx = { catalog, fits, occupied: new Set() };
  const step = (id) => wiring.steps.find((s) => s.id === id);
  const allIds = wiring.steps.map((s) => s.id);
  return [
    {
      id: 'ap-order', titleZh: '照 ArduPilot 編號焊電機',
      wrongZh: '以為 M1 在右前（ArduPilot 的習慣），把右前電機焊到電調 M1 焊盤。',
      run: () => evaluateStep(step('motor2-phase'), { target: 'esc.m1' }, ctx),
      effectZh: 'Betaflight 的 M1 在右後；馬達順序錯亂，解鎖起飛立刻翻。兩套韌體的編號一定要分開記。',
    },
    {
      id: 'xt60-reversed', titleZh: 'XT60 電源線正負反接',
      wrongZh: 'XT60 紅線焊到電調「BAT−」。',
      run: () => evaluateStep(step('xt60-solder'), { red: 'esc.bat-' }, ctx),
      effectZh: '接上電池瞬間 4 合 1 電調燒毀冒煙，鋰電池可能大電流短路起火。',
    },
    {
      id: 'cap-reversed', titleZh: '電容極性接反',
      wrongZh: '電容有條紋（負極）的那腳焊到「BAT＋」。',
      run: () => evaluateStep(step('capacitor'), { red: 'esc.bat-' }, ctx),
      effectZh: '通電後電容發熱、鼓包，嚴重時爆裂噴出電解液。',
    },
    {
      id: 'txrx', titleZh: '接收機 TX／RX 沒有交叉',
      wrongZh: '接收機 TX 焊到飛控 UART2 的 TX。',
      run: () => evaluateStep(step('rx-uart'), { red: 'fc.uart2.tx' }, ctx),
      effectZh: 'Betaflight Receiver 分頁完全沒有訊號，遙控器無法控制。',
    },
    {
      id: 'overvoltage', titleZh: '電池電壓超過零件規格',
      wrongZh: '把 6S 電池接到最高只支援 4S 的圖傳（示例規格）。',
      run: () => checkVoltage(6, [{ nameZh: '4 合 1 電調', minCells: 3, maxCells: 6 }, { nameZh: '示例圖傳（2～4S）', minCells: 2, maxCells: 4 }]),
      effectZh: '圖傳通電即燒毀。買零件前要先確認每一顆的電壓範圍。',
    },
    {
      id: 'prop-reversed', titleZh: '槳葉反裝',
      wrongZh: '右前 M2（CCW）裝上 CW 槳。',
      run: () => checkProp('CCW', 'CW'),
      effectZh: '這支槳往下吹，起飛瞬間往右前翻覆。',
    },
    {
      id: 'antenna-missing', titleZh: '圖傳沒接天線就通電',
      wrongZh: '其他線都接好了，忘了鎖圖傳天線就接電池。',
      run: () => validateSystem(allIds.filter((id) => id !== 'vtx-antenna'), wiring.requirements)[0],
      effectZh: '發射功率無處釋放，圖傳過熱，可能永久損壞。',
    },
    {
      id: 'rx-missing', titleZh: '接收機未連接',
      wrongZh: '接收機沒有接到任何 UART。',
      run: () => validateSystem(allIds.filter((id) => id !== 'rx-uart'), wiring.requirements)[0],
      effectZh: '遙控器控制不了飛機，也無法觸發失控保護。',
    },
  ];
}
