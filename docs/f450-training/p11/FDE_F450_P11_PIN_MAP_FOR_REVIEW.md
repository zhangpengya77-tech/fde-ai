# F450 實訓 P11：引腳級接線對照表（待教師確認）

- 日期：2026-11-15
- 狀態：**草案，請老師逐條確認後才做進網頁**。接錯引腳在實機上可能燒毀飛控或周邊。
- 做法（使用者決定）：
  - 2D 畫布改成引腳級，學員一根一根接線；3D 顯示接好的彩色線束。
  - Pixhawk 外形依 PX4 開源硬體檔等比例繪製。

## 1. 資料來源

| 來源 | 用途 | 授權 |
|---|---|---|
| PX4 官方文件《3DR Pixhawk 1》引腳表（[docs.px4.io](https://docs.px4.io/main/en/flight_controller/pixhawk.html)，[GitHub 原始檔](https://github.com/PX4/PX4-user_guide/blob/main/en/flight_controller/pixhawk.md)） | TELEM、GPS、SERIAL4/5、I2C、CAN、SPI、POWER、SWITCH 的引腳 | 文件 CC-BY 4.0 |
| PX4 開源硬體 `PX4/Hardware/FMUv2/PX4FMUv2.4.6.brd`、`PX4FMUv2.4.5.pdf`（[GitHub](https://github.com/PX4/Hardware/tree/master/FMUv2)） | 每個接頭在板上的實際位置（mm）、伺服排針 J901 每一腳的訊號名稱、BUZZER／SPKT 引腳 | CC-BY-SA 3.0（衍生的 Pixhawk 圖需標出處、以同授權公開） |
| 樂迪官方《R9DS user manual》（[radiolink.com](https://www.radiolink.com/en/r9ds_manual)） | SBUS 模式由 **CH9** 口輸出；尺寸 43×24×15 mm、9 g；工作電壓 4.8–10 V | 只引用事實 |
| ArduPilot《Pixhawk 接線快速入門》《電調與馬達接線》 | Quad X 馬達順序；伺服排針不供電、訊號線要連同地線；RC IN 只供接收機 | 只引用事實 |
| 使用者提供的「端口示意圖／端口解析」與《Pixhawk 2.4.8 飛控安裝指導》 | 逐腳比對（全部一致，見第 4 節） | 只作比對，不上網頁 |

注意：官方文件提醒，很多 Pixhawk 相容板（含 2.4.8）用 Molex PicoBlade 接頭取代 DF13，外形相似但不能假設互通。**老師的 2.4.8 是哪一種接頭，請確認。**

## 2. Pixhawk 2.4.8 接頭位置（依 FMUv2.4.6 電路板，板長 70 mm × 寬 40.5 mm）

座標 x＝從排針端往機頭（0→70 mm），y＝板寬。

| 接頭 | 板上編號 | x (mm) | 所在列 |
|---|---|---|---|
| 伺服排針（RC IN、S.B.OUT、MAIN 8→1、AUX 6→1） | J901 | 3.8 | 後端 |
| BUZZER | J701 | 18.3 | 列 A |
| SERIAL4/5 | J204 | 27.2 | 列 A |
| GPS | J203 | 35.0 | 列 A |
| CAN | J405 | 42.7 | 列 A |
| I2C | J401 | 57.7 | 列 A |
| ADC 6.6V | J402 | 65.4 | 列 A（最靠機頭） |
| SPKT/DSM | J801 | 19.9 | 列 B |
| TELEM2 | J202 | 27.2 | 列 B |
| TELEM1 | J201 | 35.0 | 列 B |
| USB | J302 | 42.7 | 列 B |
| SPI | J403 | 57.7 | 列 B |
| POWER | J601 | 65.4 | 列 B（最靠機頭） |
| SWITCH | J702 | 27.2 | 中間 |
| ADC 3.3V | J404 | 42.7 | 中間 |

機頭朝上時，列 A 在左、列 B 在右，與使用者給的圖、安裝指導書一致。

## 3. 這台 F450 要接的每一根線（共 55 根）

「＋」＝紅色正極，「−」＝黑色地線，「S」＝訊號。

| # | 從（零件・引腳） | 到（零件・引腳） | 說明 |
|---|---|---|---|
| 1–2 | 電池 XT60 ＋／− | 電源模組輸入 XT60 ＋／− | XT60 有防呆，一次插上 |
| 3–4 | 電源模組輸出 XT60 ＋／− | 下中心板主電源 ＋／− | |
| 5–10 | 電源模組 6P：1 5V、2 5V、3 CURRENT、4 VOLTAGE、5 GND、6 GND | Pixhawk POWER（J601）同編號 1–6 | 原廠 6P 線，一對一 |
| 11–18 | 下中心板焊盤 ＋／−（右前、左前、左後、右後） | 各電調電源線 ＋（紅）／−（黑） | 焊接，紅正黑負 |
| 19–30 | 各電調三相線 A、B、C | 各馬達三相線 | 三根都要接；順序互換兩根＝轉向反過來 |
| 31–38 | 各電調訊號線 S、− | Pixhawk MAIN OUT 1–4 的 S、−（右前 1、左後 2、左前 3、右後 4） | **紅線（＋）不接**：Pixhawk 不供電給排針；若電調有 BEC，只能留一顆的紅線 |
| 39–41 | R9DS **CH9（SBUS）** 的 S、＋、− | Pixhawk RC IN 的 S（SBUS）、＋（5V）、− | R9DS 先切到 SBUS（短按 ID SET 兩下，藍／紫燈） |
| 42–45 | GPS 6P：VCC、TX、RX、GND | Pixhawk GPS（J203）：1 5V、**3 RX**、**2 TX**、6 GND | **TX 接 RX、RX 接 TX（交叉）**；CAN2 兩腳不接 |
| 46–49 | 羅盤 4P：VCC、SCL、SDA、GND | Pixhawk I2C（J401）：1 5V、2 SCL、3 SDA、4 GND | SCL 對 SCL、SDA 對 SDA（不交叉） |
| 50–52 | 安全開關 3P：3.3V、LED、SAFETY | Pixhawk SWITCH（J702）：1 3.3V、2 LED、3 SAFETY | 原廠 3P 線，一對一 |
| 53–54 | 蜂鳴器 ＋、− | Pixhawk BUZZER（J701）：1 BUZZER、2 GND | |
| 55 | （選配，不計分）數傳 | TELEM1 | |

### 需要老師確認的地方

1. **GPS 模組的引腳順序**：Pixhawk 端已依官方確認。GPS 模組端（哪根線是 TX、RX）依品牌不同，目前用通用 M8N 寫法，標「待實機核對」。請提供 GPS 型號或線上標籤照片。
2. **電調是否有 BEC**：F450 常見的 DJI 30A 是光耦電調（沒有 BEC），訊號線只接 S 與 −。若老師的電調有 BEC，規則要改。
3. **接頭類型**：DF13 或 Molex PicoBlade。
4. **R9DS**：確認實機用 SBUS 模式、CH9 口。

## 4. 與使用者提供的接口圖逐腳比對

| 接頭 | 官方 | 使用者的圖 | 結果 |
|---|---|---|---|
| TELEM1/2 | 5V TX RX CTS RTS GND | 5V TX RX CTS RTS GND | 一致 |
| GPS | 5V TX RX CAN2TX CAN2RX GND | 5V TX RX … GND | 一致 |
| SERIAL4/5 | 5V TX4 RX4 TX5 RX5 GND | 同 | 一致 |
| I2C | 5V SCL SDA GND | 5V SCL SDA GND | 一致 |
| CAN | 5V CAN_H CAN_L GND | 5V H L GND | 一致 |
| SPI | 5V SCK MISO MOSI NSS GPIO GND | 同 | 一致 |
| SWITCH | 3.3V LED SAFETY | 3v3 led safety | 一致 |
| SPKT/DSM | 3.3V GND RX（電路板 J801） | RX GND 3V3（由另一端數） | 一致（方向相反的數法） |
| 伺服排針 | RC、S.B.OUT、MAIN 8→1、AUX 6→1；每欄 S／＋／− | AUX OUT、MAIN OUT、SBUS RCIN | 一致 |

## 5. 網頁上會怎麼做（確認後開始）

- **2D 畫布**：每個接頭展開成引腳（印上 5V、TX、RX、GND…），學員一根一根接。
- **自動檢查**新增引腳級錯誤：
  - TX 沒交叉；
  - 5V 接到 GND；
  - 接錯接頭；
  - 漏接地線；
  - 電調紅線接上排針（警告）；
  - 接到不用的腳。
- **3D**：接好的線以彩色線束顯示。
- **教學／練習／考核與判分**沿用，配分改成依引腳計算（20 條連線 → 55 根線）。
- **Pixhawk 圖**：依上面的實際座標等比例繪製，頁面標示「依 PX4 開源硬體 FMUv2（CC-BY-SA 3.0）繪製」。
- **R9DS**：依官方尺寸 43×24×15 mm 繪製，CH1–CH9 排針，CH9 標 SBUS。
