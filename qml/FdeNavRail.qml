// FDE-QGC V1.0｜左側導覽列（2026-11-18 精簡為 8 項）
// 飛行監控・航線規劃・飛控設定・仿真訓練・日誌・AI 調參・教學工具・應用設定
// - 移除「參數管理」：它只是「飛控設定 → 參數」的捷徑，請從飛控設定進入。
// - 「飛行日誌」與「日誌分析」合併為「日誌」：日誌分析改成日誌頁裡的「智能診斷」子項。
// - 「系統設定」改名「應用設定」。
// 每一項都只呼叫 QGC 主視窗原本就有的切換函式（showFlyView／showPlanView／showTool…），
// 不另寫飛控功能；切換前一律經過 mainWindow.allowViewSwitch()（保留官方「校正中禁止切換」等保護）。
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls

Rectangle {
    id: rail

    property var    window                       // MainWindow（ApplicationWindow）
    property bool   flyVisible: false
    property bool   planVisible: false
    property bool   toolVisible: false
    property string currentKey: "fly"

    // 工具頁蓋在飛行／規劃畫面上方，所以先判斷工具頁
    readonly property string activeKey: toolVisible ? currentKey : (planVisible ? "plan" : (flyVisible ? "fly" : ""))

    width: ScreenTools.defaultFontPixelWidth * 10
    color: "#0d1b2a"

    readonly property var items: [
        { key: "fly",      label: "飛行監控", icon: "/qmlimages/PaperPlane.svg" },
        { key: "plan",     label: "航線規劃", icon: "/qmlimages/Plan.svg" },
        { key: "setup",    label: "飛控設定", icon: "/qmlimages/Quad.svg" },
        { key: "sim",      label: "仿真訓練", icon: "/qmlimages/Joystick.png" },
        // 原「飛行日誌」＋「日誌分析」合併：官方分析工具頁，子選單多一項「智能診斷」
        { key: "logs",     label: "日誌",     icon: "/qmlimages/Analyze.svg" },
        { key: "tune",     label: "AI 調參",  icon: "/qmlimages/Gears.svg" },
        { key: "teach",    label: "教學工具", icon: "/qmlimages/Megaphone.svg" },
        // 原「系統設定」改名，避免和「飛控設定」混淆（頁內標題仍是官方「應用程式設定」）
        { key: "settings", label: "應用設定", icon: "/res/QGCLogoWhite.svg" }
    ]

    function activate(key) {
        if (!window || !window.allowViewSwitch()) {
            return
        }
        currentKey = key
        switch (key) {
        case "fly":      window.showFlyView(); break
        case "plan":     window.showPlanView(); break
        case "setup":    window.showVehicleConfig(); break
        // V2-3：仿真訓練中心（單機訓練＋多機編隊）
        case "sim":      window.showTool("仿真訓練中心", "qrc:/qml/FDE/Ui/FdeSimCenterPage.qml", "/qmlimages/Joystick.png"); break
        // 日誌：官方分析工具頁（日誌檢視器、智能診斷、機載日誌、地理標記影像、MAVLink 控制台、MAVLink 檢測、振動）
        case "logs":     window.showAnalyzeTool(); break
        case "tune":     window.showTool("AI 調參", "qrc:/qml/FDE/Ui/FdeTuningPage.qml", "/qmlimages/Gears.svg"); break
        case "teach":    window.showTool("教學工具", "qrc:/qml/FDE/Ui/FdeTeachingPage.qml", "/qmlimages/Megaphone.svg"); break
        case "settings": window.showSettingsTool(); break
        }
    }

    // 品牌區
    Column {
        id: brand
        anchors.top: parent.top
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.topMargin: ScreenTools.defaultFontPixelHeight * 0.5
        spacing: 0
        QGCLabel {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "FDE"
            color: "#4dabf7"
            font.bold: true
            font.pointSize: ScreenTools.largeFontPointSize
        }
        QGCLabel {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "QGC V1.0"
            color: "#adb5bd"
            font.pointSize: ScreenTools.smallFontPointSize
        }
    }

    Flickable {
        anchors.top: brand.bottom
        anchors.topMargin: ScreenTools.defaultFontPixelHeight * 0.5
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        contentHeight: navColumn.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: navColumn
            width: parent.width
            spacing: ScreenTools.defaultFontPixelHeight * 0.15

            Repeater {
                model: rail.items

                Rectangle {
                    id: navItem
                    objectName: "fdeNav_" + modelData.key
                    width: navColumn.width
                    height: ScreenTools.defaultFontPixelHeight * 3.0
                    readonly property bool active: rail.activeKey === modelData.key
                    color: active ? "#1f6feb" : (mouse.containsMouse ? "#1b2b3d" : "transparent")

                    Rectangle {
                        visible: navItem.active
                        width: ScreenTools.defaultFontPixelWidth * 0.4
                        height: parent.height
                        color: "#9ec5fe"
                    }

                    Column {
                        anchors.centerIn: parent
                        spacing: ScreenTools.defaultFontPixelHeight * 0.15
                        QGCColoredImage {
                            anchors.horizontalCenter: parent.horizontalCenter
                            width: ScreenTools.defaultFontPixelHeight * 1.4
                            height: width
                            source: modelData.icon
                            color: "white"
                            sourceSize.height: height
                            fillMode: Image.PreserveAspectFit
                        }
                        QGCLabel {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: modelData.label
                            color: "white"
                            font.bold: navItem.active
                        }
                    }

                    MouseArea {
                        id: mouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: rail.activate(modelData.key)
                    }
                }
            }
        }
    }
}
