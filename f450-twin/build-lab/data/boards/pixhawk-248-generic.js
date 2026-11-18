// 組裝實訓室｜板卡配置檔：Pixhawk 2.4.8（通用克隆版）
//
// 為什麼要有板卡配置檔：市面上的 Pixhawk 2.4.8 是多家廠商依 Pixhawk 1（FMUv2／v3）開源設計做的克隆版，
// 接口位置、接頭型號、甚至個別引腳都可能不同。所以接線規則一律讀這個檔，不把引腳寫死在程式裡；
// 換成另一家的板子時，複製這個檔改值即可。
//
// 引腳事實來源：PX4 使用手冊「3DR Pixhawk 1」引腳表、PX4 開源硬體 FMUv2.4.6（CC BY-SA 3.0），
// 與既有 f450-twin/training/pins.js（同樣來源）一致。克隆版是否相同：待確認（需實機或廠商資料核對）。
// type：power6（電源模組口）、pwm（伺服排針 S／＋／−）、rcin（遙控輸入）、uart（序列埠）、i2c、buzzer、switch、usb

const PX4_PIXHAWK1 = {
  status: '待確認',
  title: 'PX4 User Guide：3DR Pixhawk 1 Flight Controller（引腳表）＋ PX4 開源硬體 FMUv2.4.6（CC BY-SA 3.0）；克隆版未逐一核對',
  url: 'https://docs.px4.io/main/en/flight_controller/pixhawk.html',
  date: '2026-11-19',
};
const AP_WIRING = {
  status: 'PENDING_MANUAL',
  title: 'ArduPilot wiki：Pixhawk Wiring Quick Start',
  url: 'https://ardupilot.org/copter/docs/common-pixhawk-wiring-and-quick-start.html',
  date: '2026-11-19',
};

const pin = (n, label, kind) => ({ n, label, kind });
const servoPins = [pin('S', '訊號', 'sig'), pin('+', '排針電源', 'rail'), pin('-', 'GND', 'gnd')];

export const PIXHAWK_248_GENERIC = Object.freeze({
  boardId: 'pixhawk-248-generic',
  nameZh: 'Pixhawk 2.4.8（通用克隆版）',
  vendor: '待確認（請提供實際購買的廠商／絲印）',
  source: PX4_PIXHAWK1,
  notes: [
    // ArduPilot 文件明確說明的重點（PENDING_MANUAL：仍需教師覆核）
    'Pixhawk 由 POWER 口（電源模組）供電；伺服排針（MAIN OUT）不會供電給飛控，MAIN OUT 只傳訊號。',
    '蜂鳴器與安全開關對 Pixhawk 是必要的，分別接 BUZZER 與 SWITCH。',
    '多旋翼依馬達編號接 MAIN OUT：1 號接 MAIN OUT 1，依此類推。',
  ],
  notesSource: AP_WIRING,
  ports: {
    'fc.power': { nameZh: 'POWER 電源口', type: 'power6', pins: [pin(1, '5V', 'v5'), pin(2, '5V', 'v5'), pin(3, 'CUR', 'cur'), pin(4, 'VOLT', 'volt'), pin(5, 'GND', 'gnd'), pin(6, 'GND', 'gnd')], maxInputV: 5.7 },
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`fc.main${n}`, { nameZh: `MAIN OUT ${n}`, type: 'pwm', index: n, pins: servoPins }])),
    'fc.rcin': { nameZh: 'RC IN 遙控輸入', type: 'rcin', pins: servoPins, accepts: ['PPM', 'SBUS'] },
    'fc.gps': { nameZh: 'GPS 口', type: 'uart', role: 'gps', pins: [pin(1, '5V', 'v5'), pin(2, 'TX', 'tx'), pin(3, 'RX', 'rx'), pin(4, 'CAN2 TX', 'nc'), pin(5, 'CAN2 RX', 'nc'), pin(6, 'GND', 'gnd')] },
    'fc.telem1': { nameZh: 'TELEM1 數傳口', type: 'uart', role: 'telem', pins: [pin(1, '5V', 'v5'), pin(2, 'TX', 'tx'), pin(3, 'RX', 'rx'), pin(4, 'CTS', 'cts'), pin(5, 'RTS', 'rts'), pin(6, 'GND', 'gnd')] },
    'fc.telem2': { nameZh: 'TELEM2 數傳口', type: 'uart', role: 'telem', pins: [pin(1, '5V', 'v5'), pin(2, 'TX', 'tx'), pin(3, 'RX', 'rx'), pin(4, 'CTS', 'cts'), pin(5, 'RTS', 'rts'), pin(6, 'GND', 'gnd')] },
    'fc.i2c': { nameZh: 'I2C 口', type: 'i2c', pins: [pin(1, '5V', 'v5'), pin(2, 'SCL', 'scl'), pin(3, 'SDA', 'sda'), pin(4, 'GND', 'gnd')] },
    'fc.buzzer': { nameZh: 'BUZZER 蜂鳴器口', type: 'buzzer', pins: [pin(1, 'BUZ', 'buzz'), pin(2, 'GND', 'gnd')] },
    'fc.switch': { nameZh: 'SWITCH 安全開關口', type: 'switch', pins: [pin(1, '3.3V', 'v33'), pin(2, 'LED', 'led'), pin(3, 'SAFETY', 'safety')] },
    'fc.usb': { nameZh: 'USB（Micro USB）', type: 'usb', pins: [] },
  },
});
