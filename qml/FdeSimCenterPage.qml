// FDE-QGC V2-3｜仿真訓練中心：把「仿真訓練（單機）」「仿真器（多機）」「編隊飛行」合成一頁
// 上方兩個分頁：
//   單機訓練：1 架 SITL（instance 11），可選 3D Gazebo，配合 8 字教學航線。
//   多機編隊：步驟 1 啟動並連線多架模擬機 → 步驟 2 編隊飛行（同一頁由上往下做完，不用切頁）。
// 左側導覽「仿真訓練」與系統設定「仿真與編隊」都開這一頁；最後選的分頁會記住。
import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

Item {
    id: page

    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight

    QGCPalette { id: pal; colorGroupEnabled: true }

    // 記住上次選的分頁
    Settings {
        id: store
        category: "FDE/SimCenter"
        property int tab: 0
    }

    // 自我測試用：simcenter:single／simcenter:multi 切換分頁
    Connections {
        target: FdeSelfTest
        function onCommandIssued(command) {
            if (command === "simcenter:single") { store.tab = 0 }
            else if (command === "simcenter:multi") { store.tab = 1 }
        }
    }

    // ---- 標題與分頁按鈕（選中的分頁以黃色標示）----
    ColumnLayout {
        id: header
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.margins: _fw * 2
        spacing: _fh * 0.4

        QGCLabel { text: "仿真訓練中心"; font.bold: true; font.pointSize: ScreenTools.largeFontPointSize }
        RowLayout {
            spacing: _fw
            Repeater {
                model: [
                    { label: "單機訓練", note: "1 架模擬機・8 字航線・3D" },
                    { label: "多機編隊", note: "2～6 架模擬機・編隊飛行" }
                ]
                delegate: Rectangle {
                    required property var modelData
                    required property int index
                    readonly property bool _sel: store.tab === index
                    objectName: "fdeSimCenterTab" + index
                    Layout.preferredWidth: _fw * 30
                    Layout.preferredHeight: _fh * 2.6
                    radius: height / 2
                    color: _sel ? "#ffe066" : "#2b3035"
                    Column {
                        anchors.centerIn: parent
                        QGCLabel {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: modelData.label
                            font.bold: true
                            color: _sel ? "#1b1b1b" : "white"
                        }
                        QGCLabel {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: modelData.note
                            font.pointSize: ScreenTools.smallFontPointSize
                            color: _sel ? "#333333" : "#adb5bd"
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: store.tab = index
                    }
                }
            }
        }
        Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }
    }

    // ---- 分頁內容 ----
    StackLayout {
        anchors.top: header.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        currentIndex: store.tab

        // 分頁 1：單機訓練（原「仿真訓練」頁，內容不變）
        FdeSimTrainingPage { }

        // 分頁 2：多機編隊（步驟 1 啟動並連線 → 步驟 2 編隊飛行）
        Item {
            QGCFlickable {
                anchors.fill: parent
                anchors.margins: _fw * 2
                contentHeight: multiCol.height
                clip: true

                ColumnLayout {
                    id: multiCol
                    width: Math.min(parent.width, _fw * 110)
                    spacing: _fh * 0.5

                    FdeSwarmLaunchControls { Layout.fillWidth: true }

                    Rectangle { Layout.fillWidth: true; height: 2; color: "#ffe066"; opacity: 0.6 }

                    QGCLabel { text: "步驟 2：編隊飛行（ArduPilot Follow 模式）"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
                    QGCLabel {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: "選一架長機，其餘為從機。從機用 ArduPilot 內建的 Follow（跟隨）模式，依隊形保持在長機的前後左右；"
                            + "地面站會把長機位置即時轉送給從機。飛行畫面下方的「編隊飛行」按鈕可打開同一組控制的浮動面板，邊看地圖邊操作。"
                    }
                    FdeFormationControls { Layout.fillWidth: true }
                }
            }
        }
    }
}
