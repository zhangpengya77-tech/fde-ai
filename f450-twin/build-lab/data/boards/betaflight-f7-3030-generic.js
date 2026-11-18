// 組裝實訓室｜板卡配置檔：通用 Betaflight F7 飛控＋4 合 1 電調堆疊（30.5×30.5）
//
// 不同廠牌的飛控焊盤位置、UART 編號、8P 排線線序都不一樣，**不能把通用接線當成所有產品通用**。
// 這個檔只描述教學用的通用堆疊；選定真實產品後要依廠商官方接線圖另建一個配置檔，全部引腳標「待確認」。

const TBD = { status: '待確認', title: '通用教學堆疊；需依選定飛控／電調的官方接線圖核對', url: '', date: '' };

export const BETAFLIGHT_F7_3030_GENERIC = Object.freeze({
  boardId: 'betaflight-f7-3030-generic',
  nameZh: 'Betaflight F7 飛控＋4 合 1 電調（通用 30.5×30.5 堆疊）',
  vendor: '待確認（請提供實際選用的飛控與電調型號）',
  source: TBD,
  notes: [
    '電機三相線焊在 4 合 1 電調的 M1～M4 焊盤；Betaflight 預設 M1 右後、M2 右前、M3 左後、M4 左前。',
    '接收機用 UART 連接，TX／RX 交叉；協定 CRSF（ExpressLRS）。',
    '8P 排線的線序依廠牌而異，兩端一定要是同一套標準（待確認）。',
  ],
  ports: {
    'fc.esc8': { nameZh: '電調 8P 排線座', type: 'esc8', pins: '待確認（依廠牌：VBAT、GND、CUR、TLM、M1～M4）' },
    'fc.uart1.tx': { nameZh: 'UART1 TX 焊盤', type: 'uart-pin', group: 'fc.uart1', pin: 'tx' },
    'fc.uart1.rx': { nameZh: 'UART1 RX 焊盤', type: 'uart-pin', group: 'fc.uart1', pin: 'rx' },
    'fc.uart2.tx': { nameZh: 'UART2 TX 焊盤', type: 'uart-pin', group: 'fc.uart2', pin: 'tx' },
    'fc.uart2.rx': { nameZh: 'UART2 RX 焊盤', type: 'uart-pin', group: 'fc.uart2', pin: 'rx' },
    'fc.hd': { nameZh: '數位圖傳 6P 接口', type: 'hd6', pins: '待確認（依廠牌：VBAT／9V、GND、TX、RX、GND、SBUS）' },
  },
});
