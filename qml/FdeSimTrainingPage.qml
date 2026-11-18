// FDE-QGC V1.0｜仿真訓練中心「單機訓練」分頁（V2-3 起嵌在 FdeSimCenterPage）：一鍵啟動隔離的 ArduCopter SITL（WSL：FDE-DT-Ubuntu，instance 11）
// 使用者不需要開 PowerShell 或 WSL。本頁不會自動解鎖、起飛、上傳任務或切換模式；
// 這些動作一律在 QGC 原生畫面由使用者確認（保留官方的確認滑桿與安全檢查）。
import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

Item {
    id: page
    property bool popped: false

    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight
    property var _v: QGroundControl.multiVehicleManager.activeVehicle

    QGCPalette { id: pal; colorGroupEnabled: true }

    // 模擬起飛點記憶在 QSettings（預設為 ArduPilot 官方 SITL 測試場 CMAC）
    Settings {
        id: simStore
        category: "FDE/Sim"
        property string lat: "-35.3632621"
        property string lon: "149.1652374"
        property string alt: "584"
        property string heading: "353"
    }

    // 開頁時檢查 SITL 是否已在執行（例如上一堂課沒關）
    Component.onCompleted: FdeSitl.refresh()

    QGCFlickable {
        anchors.fill: parent
        anchors.margins: _fw * 2
        contentHeight: col.height
        clip: true

        ColumnLayout {
            id: col
            width: Math.min(parent.width, _fw * 110)
            spacing: _fh * 0.5

            QGCLabel { text: "單機訓練（1 架 ArduPilot SITL）"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
            QGCLabel {
                text: "本頁啟動的是電腦裡的「模擬飛機」，與真機完全隔離：只在 WSL 發行版 " + FdeSitl.distro + " 執行 ArduCopter instance " + FdeSitl.instance
                      + "，QGC 以 TCP 127.0.0.1:" + FdeSitl.tcpPort + " 連線。不會連接序列埠或真機。"
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: stateRow.implicitHeight + _fh
                radius: _fw * 0.5
                color: FdeSitl.state === "running" ? "#1b4332" : (FdeSitl.state === "error" ? "#5c1a1a" : "#343a40")
                RowLayout {
                    id: stateRow
                    anchors.fill: parent
                    anchors.margins: _fh * 0.5
                    QGCLabel {
                        objectName: "fdeSitlState"
                        text: "SITL 狀態：" + ({ running: "執行中", stopped: "未執行", starting: "啟動中…", stopping: "關閉中…", error: "錯誤" }[FdeSitl.state] || FdeSitl.state)
                        color: "white"
                        font.bold: true
                    }
                    QGCLabel {
                        text: FdeSitl.lastMessage
                        color: "white"
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                }
            }

            QGCLabel { text: "模擬起飛點"; font.bold: true }
            GridLayout {
                columns: 4
                columnSpacing: _fw
                QGCLabel { text: "緯度" }
                QGCTextField { id: latF; Layout.preferredWidth: _fw * 16; text: simStore.lat; onEditingFinished: simStore.lat = text }
                QGCLabel { text: "經度" }
                QGCTextField { id: lonF; Layout.preferredWidth: _fw * 16; text: simStore.lon; onEditingFinished: simStore.lon = text }
                QGCLabel { text: "海拔（m）" }
                QGCTextField { id: altF; Layout.preferredWidth: _fw * 16; text: simStore.alt; onEditingFinished: simStore.alt = text }
                QGCLabel { text: "機頭方向（°）" }
                QGCTextField { id: hdgF; Layout.preferredWidth: _fw * 16; text: simStore.heading; onEditingFinished: simStore.heading = text }
            }
            QGCCheckBox { id: wipeBox; text: "啟動時清除上次的模擬參數（建議每堂課勾選）"; checked: true }
            // V2：3D 模擬（Gazebo），使用與正式環境隔離的 FDE 專用副本
            QGCCheckBox { id: gz3dBox; objectName: "fdeSitl3d"; text: "3D 模擬（Gazebo：開啟 3D 視窗，物理由 Gazebo 計算；起飛點固定為跑道場景）"; checked: false }

            RowLayout {
                spacing: _fw
                QGCButton {
                    objectName: "fdeSitlStart"
                    text: "① 啟動 SITL"
                    primary: true
                    enabled: FdeSitl.state !== "starting" && FdeSitl.state !== "running"
                    // 勾選 3D 模擬時改走 Gazebo（顯示 3D 視窗）；否則用原本的內建物理 SITL
                    onClicked: gz3dBox.checked ? FdeSitl.start3d(true, wipeBox.checked)
                                               : FdeSitl.start(Number(latF.text), Number(lonF.text), Number(altF.text), Number(hdgF.text), wipeBox.checked)
                }
                QGCButton {
                    objectName: "fdeSitlConnect"
                    text: "② 連線 SITL"
                    enabled: FdeSitl.state === "running" && !page._v
                    onClicked: FdeSitl.connectLink()
                }
                QGCButton { text: "重新檢查"; onClicked: FdeSitl.refresh() }
                QGCButton {
                    objectName: "fdeSitlStop"
                    text: "⑤ 關閉 SITL"
                    enabled: FdeSitl.state === "running" || FdeSitl.state === "error"
                    onClicked: FdeSitl.stop()
                }
            }
            QGCLabel {
                text: page._v ? ("目前連線飛控：系統 ID " + page._v.id + "，模式 " + page._v.flightMode + (page._v.armed ? "，已解鎖" : "，未解鎖")) : "目前沒有連線飛控"
                font.bold: true
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }

            QGCLabel { text: "課堂流程"; font.bold: true }
            QGCLabel {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: "① 按「啟動 SITL」，等狀態變成「執行中」。\n"
                    + "② 按「連線 SITL」，約 10～20 秒後上方工具列出現飛控狀態。\n"
                    + "③ 到「教學工具」→ B. 8 字教學航線，按「用目前飛機位置當中心」→「產生並載入到航線規劃」。\n"
                    + "④ 在「航線規劃」檢查航點後按官方「上傳」；到「飛行監控」用官方滑桿確認「起飛」與「開始任務」（AUTO）。\n"
                    + "   任務結束會自動 RTL；也可隨時用官方「返航（RTL）」按鈕。\n"
                    + "⑤ 下課前按「關閉 SITL」。飛行紀錄（tlog）在「日誌」頁與 QGC 存檔資料夾。"
            }
            QGCLabel {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                color: pal.warningText
                text: "安全提醒：本頁只操作模擬飛機。連接真機時請勿使用 8 字教學航線，除非教官已現場檢查並核准。"
            }
        }
    }
}
