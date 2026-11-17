// FDE-QGC V2-3｜多機模擬「步驟 1：啟動並連線」控制區（放在「仿真訓練中心 → 多機編隊」分頁上半部）
// 一次啟動多架 ArduCopter 模擬機（給編隊飛行練習用）
// - 全部由按鈕完成，使用者不需要開 PowerShell 或 WSL。
// - 模擬機在 WSL 發行版 FDE-DT-Ubuntu 執行（instance 21～26、系統 ID 11～16），與真機完全隔離。
// - 本頁不會解鎖、起飛或切模式；那些動作在「編隊飛行」面板或官方飛行畫面，由使用者確認後執行。
import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

ColumnLayout {
    id: page
    spacing: _fh * 0.5

    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight

    QGCPalette { id: pal; colorGroupEnabled: true }

    // 起飛點與單機「仿真訓練」頁共用（同一個設定分類 FDE/Sim）
    Settings {
        id: simStore
        category: "FDE/Sim"
        property string lat: "-35.3632621"
        property string lon: "149.1652374"
        property string alt: "584"
        property string heading: "353"
    }
    // 多機專用設定
    Settings {
        id: swarmStore
        category: "FDE/Swarm"
        property int count: 3
        property string spacing: "5"
    }

    // 開頁時檢查是否有上一堂課沒關的模擬機
    Component.onCompleted: FdeSwarm.refresh()

    // 依系統 ID 找已連線的飛機（沒有連上時回傳 null）
    function vehicleById(id) {
        return QGroundControl.multiVehicleManager.getVehicleById(id)
    }

    QGCLabel { text: "步驟 1：啟動並連線模擬機"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
    QGCLabel {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: "一次在電腦裡啟動多架「模擬飛機」，給編隊飛行練習使用。模擬機在 WSL 發行版 " + FdeSwarm.distro
              + " 執行，系統 ID 從 " + FdeSwarm.firstSysId + " 起（避開真機常用的 1），每架有自己的 TCP 連接埠，與真機完全隔離，不會連接序列埠或數傳。"
    }

    // ---- 狀態列 ----
    Rectangle {
        Layout.fillWidth: true
        implicitHeight: stateRow.implicitHeight + _fh
        radius: _fw * 0.5
        color: FdeSwarm.state === "running" ? "#1b4332" : (FdeSwarm.state === "error" ? "#5c1a1a" : "#343a40")
        RowLayout {
            id: stateRow
            anchors.fill: parent
            anchors.margins: _fh * 0.5
            QGCLabel {
                objectName: "fdeSwarmState"
                text: "狀態：" + ({ running: "執行中", stopped: "未執行", starting: "啟動中…", stopping: "關閉中…", error: "錯誤" }[FdeSwarm.state] || FdeSwarm.state)
                      + "（" + FdeSwarm.runningCount + " 架）"
                color: "white"
                font.bold: true
            }
            QGCLabel {
                text: FdeSwarm.lastMessage
                color: "white"
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
    }

    // ---- 參數 ----
    QGCLabel { text: "模擬機數量與起飛點"; font.bold: true }
    GridLayout {
        columns: 4
        columnSpacing: _fw
        QGCLabel { text: "架數（1～" + FdeSwarm.maxCount + "）" }
        QGCComboBox {
            id: countBox
            objectName: "fdeSwarmCount"
            Layout.preferredWidth: _fw * 16
            model: [1, 2, 3, 4, 5, 6]
            currentIndex: Math.max(0, Math.min(5, swarmStore.count - 1))
            onActivated: (index) => swarmStore.count = index + 1
        }
        QGCLabel { text: "起飛點間距（m）" }
        QGCTextField { id: spacingF; Layout.preferredWidth: _fw * 16; text: swarmStore.spacing; onEditingFinished: swarmStore.spacing = text }
        QGCLabel { text: "第 1 架緯度" }
        QGCTextField { id: latF; Layout.preferredWidth: _fw * 16; text: simStore.lat; onEditingFinished: simStore.lat = text }
        QGCLabel { text: "第 1 架經度" }
        QGCTextField { id: lonF; Layout.preferredWidth: _fw * 16; text: simStore.lon; onEditingFinished: simStore.lon = text }
        QGCLabel { text: "海拔（m）" }
        QGCTextField { id: altF; Layout.preferredWidth: _fw * 16; text: simStore.alt; onEditingFinished: simStore.alt = text }
        QGCLabel { text: "機頭方向（°）" }
        QGCTextField { id: hdgF; Layout.preferredWidth: _fw * 16; text: simStore.heading; onEditingFinished: simStore.heading = text }
    }
    QGCLabel {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        font.pointSize: ScreenTools.smallFontPointSize
        text: "第 2 架以後會排在第 1 架的「機頭右側」，每架間隔上面設定的距離。起飛點與「單機訓練」分頁共用。"
    }
    QGCCheckBox { id: wipeBox; text: "啟動時清除上次的模擬參數（建議每堂課勾選）"; checked: true }

    RowLayout {
        spacing: _fw
        QGCButton {
            objectName: "fdeSwarmStart"
            text: "① 啟動模擬機"
            primary: true
            enabled: FdeSwarm.state !== "starting" && FdeSwarm.state !== "stopping"
            onClicked: FdeSwarm.startSwarm(countBox.currentIndex + 1, Number(latF.text), Number(lonF.text),
                                           Number(altF.text), Number(hdgF.text), Number(spacingF.text), wipeBox.checked)
        }
        QGCButton {
            objectName: "fdeSwarmConnect"
            text: "② 連線全部"
            enabled: FdeSwarm.runningCount > 0
            onClicked: FdeSwarm.connectAll()
        }
        QGCButton { text: "重新檢查"; onClicked: FdeSwarm.refresh() }
        QGCButton {
            objectName: "fdeSwarmStop"
            text: "關閉全部模擬機"
            enabled: FdeSwarm.runningCount > 0 || FdeSwarm.state === "error"
            onClicked: FdeSwarm.stopSwarm()
        }
    }

    // 已連線的 FDE 模擬機架數（用來判斷「下一步」該做什麼）
    readonly property int connectedSimCount: {
        const vs = QGroundControl.multiVehicleManager.vehicles
        let n = 0
        for (let i = 0; i < vs.count; i++) { if (FdeSwarm.isSimVehicle(vs.get(i).id)) { n++ } }
        return n
    }
    // 「下一步」提示：告訴使用者現在該按哪個按鈕、按鈕為什麼是灰色
    QGCLabel {
        objectName: "fdeSwarmNextStep"
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        font.bold: true
        color: page.connectedSimCount >= 2 ? "#2fb344" : "#ffa94d"
        text: FdeSwarm.state === "starting" ? "▶ 模擬機啟動中，約 5～10 秒…"
            : FdeSwarm.state === "stopping" ? "▶ 正在關閉模擬機…"
            : FdeSwarm.runningCount === 0 ? "▶ 下一步：按「① 啟動模擬機」（「② 連線全部」要等模擬機執行中才能按）"
            : page.connectedSimCount < FdeSwarm.runningCount ? ("▶ 下一步：按「② 連線全部」，約 10～20 秒後下表會顯示「已連線」（目前 "
                                                                 + page.connectedSimCount + "／" + FdeSwarm.runningCount + " 架）")
            : page.connectedSimCount >= 2 ? ("● 完成：" + page.connectedSimCount + " 架模擬機都已連線，請到下方「步驟 2：編隊飛行」")
            : "● 1 架模擬機已連線。編隊至少需要 2 架，請把架數改成 2 架以上再啟動"
    }

    Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }

    // ---- 每架模擬機的狀態表 ----
    QGCLabel { text: "模擬機清單"; font.bold: true }
    GridLayout {
        columns: 6
        columnSpacing: _fw * 2
        rowSpacing: _fh * 0.2
        QGCLabel { text: "編號"; font.bold: true }
        QGCLabel { text: "系統 ID"; font.bold: true }
        QGCLabel { text: "TCP 埠"; font.bold: true }
        QGCLabel { text: "連線"; font.bold: true }
        QGCLabel { text: "模式"; font.bold: true }
        QGCLabel { text: "高度"; font.bold: true }
        Repeater {
            // 每架 6 格：依序展開成表格
            model: Math.max(FdeSwarm.runningCount, countBox.currentIndex + 1) * 6
            QGCLabel {
                readonly property int k: Math.floor(index / 6) + 1
                readonly property int c: index % 6
                // 讀 multiVehicleManager.vehicles.count 讓飛機連上／斷線時重新計算
                readonly property var v: QGroundControl.multiVehicleManager.vehicles.count >= 0 ? page.vehicleById(FdeSwarm.firstSysId + k - 1) : null
                text: c === 0 ? ("第 " + k + " 架")
                    : c === 1 ? String(FdeSwarm.firstSysId + k - 1)
                    : c === 2 ? String(FdeSwarm.tcpPortFor(k))
                    : c === 3 ? (v ? "已連線" : "—")
                    : c === 4 ? (v ? v.flightMode + (v.armed ? "（已解鎖）" : "") : "—")
                    : (v ? Number(v.altitudeRelative.rawValue).toFixed(1) + " m" : "—")
                color: c === 3 && v ? "#2fb344" : pal.text
            }
        }
    }

    Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }

    QGCLabel { text: "使用流程"; font.bold: true }
    QGCLabel {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: "① 選架數，按「啟動模擬機」，等狀態變成「執行中」。\n"
            + "② 按「連線全部」，約 10～20 秒後飛行畫面左上會出現多機清單。\n"
            + "③ 到本頁下方「步驟 2：編隊飛行」（或飛行畫面下方的「編隊飛行」面板）：選長機與隊形 → 全體起飛 → 套用隊形 → 開始編隊。\n"
            + "④ 長機照平常方式操作（在地圖上「飛到這裡」或執行自動任務），從機會自動保持隊形。\n"
            + "⑤ 結束時按「全體返航」或「全體降落」，下課前按「關閉全部模擬機」。"
    }
    QGCLabel {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        color: pal.warningText
        text: "安全提醒：多機仿真與編隊控制只開放給本頁啟動的模擬機。連接真機時，編隊按鈕不會對真機送出任何指令。"
    }
}
