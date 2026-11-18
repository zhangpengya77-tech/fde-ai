// 組裝實訓室｜錯誤案例教學（只在虛擬環境展示，不對任何真實硬體供電）
//
// 每個案例都把「錯誤接法」實際丟進 wiring-rules.js 跑一次，畫面顯示的判定結果就是規則引擎的真實輸出，
// 證明系統能識別這種錯誤；再附上虛擬後果與正確做法。
import { evaluateStep, checkOrientation, checkProp, validateSystem, buildCatalog } from './wiring-rules.js';

export function buildErrorCases(wiring, board, extraPoints, fits) {
  const catalog = buildCatalog(board, extraPoints);
  const ctx = { catalog, fits, occupied: new Set() };
  const step = (id) => wiring.steps.find((s) => s.id === id);
  return [
    {
      id: 'reversed-polarity', titleZh: '正負極反接',
      wrongZh: '1 號電調的紅線焊到分電板「−」焊盤。',
      run: () => evaluateStep(step('esc1-power'), { red: 'pdb.fr-' }, ctx),
      effectZh: '通電瞬間電流反向，電調 MOS 管燒毀冒煙；若在電池端反接，可能造成鋰電池短路起火。',
    },
    {
      id: 'gps-wrong-port', titleZh: 'GPS 插錯口',
      wrongZh: 'GPS 的 6P 線插到 TELEM1。',
      run: () => evaluateStep(step('gps-uart'), { target: 'fc.telem1' }, ctx),
      effectZh: '地面站一直顯示「No GPS」，無法使用定點、返航等需要定位的模式。',
    },
    {
      id: 'esc-order', titleZh: '電調訊號順序錯誤',
      wrongZh: '1 號電調的訊號線插到 MAIN OUT 3。',
      run: () => evaluateStep(step('esc1-signal'), { target: 'fc.main3' }, ctx),
      effectZh: '飛控要右前加速時，實際加速的是左前；解鎖起飛瞬間就翻覆。',
    },
    {
      id: 'fc-orientation', titleZh: '飛控方向錯誤',
      wrongZh: 'Pixhawk 箭頭朝機尾安裝（轉了 180°），但 AHRS_ORIENTATION 仍是 0。',
      run: () => checkOrientation(180, 0),
      effectZh: '飛控以為機頭在後面，修正姿態時方向全部相反，離地就翻。',
    },
    {
      id: 'prop-reversed', titleZh: '槳葉反裝',
      wrongZh: 'M1（CCW 電機）裝上 CW 正槳。',
      run: () => checkProp('CCW', 'CW'),
      effectZh: '這支槳產生向下的推力，推力嚴重不平衡，起飛瞬間往該角翻覆。',
    },
    {
      id: 'rc-missing', titleZh: '接收機未連接',
      wrongZh: '其他線都接好了，唯獨接收機沒有接到 RC IN。',
      run: () => validateSystem(wiring.steps.map((s) => s.id).filter((id) => id !== 'rx-rcin'))[0],
      effectZh: '遙控器完全控制不了飛機，地面站解鎖前檢查也會報錯（RC not calibrated／No RC Receiver）。',
    },
    {
      id: 'motor-mismatch', titleZh: '焊點錯誤（電調接錯電機）',
      wrongZh: '1 號電調的三條相線焊到 M2 電機。',
      run: () => evaluateStep(step('esc1-phase'), { target: 'motor.m2' }, ctx),
      effectZh: '電調編號與電機位置對不上，馬達順序錯亂，起飛會翻。',
    },
    {
      id: 'battery-to-fc', titleZh: '主電池直接接飛控 POWER 口',
      wrongZh: '用轉接線把電池直接接到 Pixhawk 的 POWER 口。',
      run: () => evaluateStep(step('battery'), { target: 'fc.power' }, ctx),
      effectZh: '飛控設計只能吃 5V 左右，3S 電池約 11～12.6V，通電即燒毀飛控。',
    },
  ];
}
