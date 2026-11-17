// FDE-QGC V2｜浮動面板：遙控器打桿監視（取代 V1.0「遙控器通道」，保留 8 通道條狀圖）
// - 上方：雙搖桿圖（美國手 Mode 2：左＝油門／偏航、右＝橫滾／俯仰），圓點位置即時顯示打桿量。
// - 通道對應讀飛控參數 RCMAP_ROLL／PITCH／THROTTLE／YAW（ArduPilot）；讀不到時用預設 1／2／3／4。
// - 資料來源：飛控回報 RC_CHANNELS（實體遙控器）；若沒有飛控資料但有 USB 搖桿（SDL），改顯示搖桿軸值並標示來源。
// - 本面板只讀顯示，不送出任何控制指令。
import QtQuick
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import QGroundControl.FactControls

FdeFloatingPanel {
    id: root
    title: "遙控器打桿監視"
    icon: "⌘"
    panelKey: "rcChannels"
    defaultRelX: 0.50
    defaultRelY: 0.02
    footerNote: _pwm.length > 0 ? "來源：飛控 RC_CHANNELS" : (_joySeen ? "來源：USB 搖桿（SDL）" : "等待飛機和遙控器數據")

    property var  _v: QGroundControl.multiVehicleManager.activeVehicle
    property var  _joy: (typeof joystickManager !== "undefined" && joystickManager) ? joystickManager.activeJoystick : null
    property var  _pwm: []                 // 飛控回報的 PWM（索引 0 = CH1）
    property var  _axes: [0, 0, 0, 0]      // 電腦搖桿 roll, pitch, yaw, throttle（-1～1）
    property bool _joySeen: false
    property bool showBars: false          // 是否展開 8 通道條狀圖

    // 通道對應（1 起算）；連線後讀 RCMAP_* 參數
    property int chRoll: 1
    property int chPitch: 2
    property int chThr: 3
    property int chYaw: 4

    on_VChanged: { _pwm = []; chRoll = 1; chPitch = 2; chThr = 3; chYaw = 4 }

    Connections {
        target: root._v
        ignoreUnknownSignals: true
        function onRcChannelsRawChanged(channelValues) { root._pwm = channelValues }
    }
    Connections {
        target: root._joy
        ignoreUnknownSignals: true
        function onAxisValues(roll, pitch, yaw, throttle) {
            root._axes = [roll, pitch, yaw, throttle]
            root._joySeen = true
        }
    }

    // 參數下載完成後讀 RCMAP（FactPanelController 需在飛控參數就緒後建立）
    Loader {
        active: !!root._v && root._v.parameterManager.parametersReady
        sourceComponent: Component {
            FactPanelController {
                Component.onCompleted: {
                    const rd = (n, d) => parameterExists(-1, n) ? getParameterFact(-1, n, false).rawValue : d
                    root.chRoll = rd("RCMAP_ROLL", 1); root.chPitch = rd("RCMAP_PITCH", 2)
                    root.chThr = rd("RCMAP_THROTTLE", 3); root.chYaw = rd("RCMAP_YAW", 4)
                }
            }
        }
    }

    // PWM → -1～1（1500 為中立）；沒有資料回傳 NaN
    function norm(ch) {
        const p = _pwm[ch - 1]
        return (p === undefined || p <= 0) ? NaN : Math.max(-1, Math.min(1, (p - 1500) / 500))
    }
    function pwmText(ch) { const p = _pwm[ch - 1]; return (p === undefined || p <= 0) ? "--" : String(p) }

    // 目前要顯示的四軸（-1～1），優先使用飛控回報，否則用 USB 搖桿
    readonly property bool _useRc: _pwm.length >= 4
    readonly property real _yaw:   _useRc ? norm(chYaw)   : (_joySeen ? _axes[2] : 0)
    readonly property real _thr:   _useRc ? norm(chThr)   : (_joySeen ? _axes[3] : -1)
    readonly property real _roll:  _useRc ? norm(chRoll)  : (_joySeen ? _axes[0] : 0)
    readonly property real _pitch: _useRc ? norm(chPitch) : (_joySeen ? _axes[1] : 0)

    // 圓形搖桿圖：sx／sy 為 -1～1（sy=+1 在上）
    component Stick: Column {
        property string caption
        property real sx: 0
        property real sy: 0
        property string valueText
        spacing: _fh * 0.3
        QGCLabel { anchors.horizontalCenter: parent.horizontalCenter; text: parent.caption; color: "white" }
        Item {
            width: _fh * 9; height: width
            anchors.horizontalCenter: parent.horizontalCenter
            Rectangle {   // 外圈
                anchors.fill: parent; radius: width / 2
                color: Qt.rgba(0.06, 0.14, 0.18, 1); border.color: "#38d9a9"; border.width: 3
            }
            Repeater {    // 同心刻度圈
                model: [0.66, 0.33]
                Rectangle {
                    anchors.centerIn: parent; width: parent.width * modelData; height: width; radius: width / 2
                    color: "transparent"; border.color: Qt.rgba(0.22, 0.85, 0.66, 0.25)
                }
            }
            Rectangle { anchors.centerIn: parent; width: 1; height: parent.height * 0.9; color: Qt.rgba(1, 1, 1, 0.15) }
            Rectangle { anchors.centerIn: parent; height: 1; width: parent.width * 0.9; color: Qt.rgba(1, 1, 1, 0.15) }
            Rectangle {   // 搖桿位置圓點
                readonly property real r: parent.width / 2 - width / 2 - 4
                width: _fh * 1.3; height: width; radius: width / 2
                x: parent.width / 2 - width / 2 + (isNaN(sx) ? 0 : sx) * r
                y: parent.height / 2 - height / 2 - (isNaN(sy) ? 0 : sy) * r
                gradient: Gradient { GradientStop { position: 0; color: "white" } GradientStop { position: 1; color: "#adb5bd" } }
                border.color: "#495057"
            }
        }
        QGCLabel { anchors.horizontalCenter: parent.horizontalCenter; text: parent.valueText; color: "#38d9a9"; font.bold: true; font.family: "Consolas" }
    }

    Row {
        spacing: _fw * 4
        Stick {
            caption: "左搖桿：油門／偏航"
            sx: root._yaw; sy: root._thr
            valueText: root._useRc ? (root.pwmText(root.chYaw) + "  /  " + root.pwmText(root.chThr)) : (root._joySeen ? root._axes[2].toFixed(2) + " / " + root._axes[3].toFixed(2) : "--  /  --")
        }
        Stick {
            caption: "右搖桿：橫滾／俯仰"
            // ArduPilot 慣例：俯仰 PWM 低＝推桿向前，因此畫面上取反向
            sx: root._roll; sy: -root._pitch
            valueText: root._useRc ? (root.pwmText(root.chRoll) + "  /  " + root.pwmText(root.chPitch)) : (root._joySeen ? root._axes[0].toFixed(2) + " / " + root._axes[1].toFixed(2) : "--  /  --")
        }
    }

    QGCLabel {
        text: root.showBars ? "▲ 收起 8 通道" : "▼ 顯示 8 通道 PWM"
        color: "#74c0fc"
        font.pointSize: ScreenTools.smallFontPointSize
        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.showBars = !root.showBars }
    }

    // 8 通道條狀圖（展開時顯示）
    Repeater {
        model: root.showBars ? 8 : 0
        RowLayout {
            spacing: _fw * 0.5
            readonly property int ch: index + 1
            readonly property string role: ch === root.chRoll ? "橫滾" : (ch === root.chPitch ? "俯仰" : (ch === root.chThr ? "油門" : (ch === root.chYaw ? "偏航" : "")))
            QGCLabel { text: "CH" + ch + " " + role; Layout.preferredWidth: _fw * 8; font.pointSize: ScreenTools.smallFontPointSize; color: "white" }
            Rectangle {
                Layout.preferredWidth: _fw * 26; height: _fh * 0.45; radius: height / 2; color: Qt.rgba(0.5, 0.5, 0.5, 0.35)
                Rectangle {
                    readonly property real n: root.norm(ch)
                    width: isNaN(n) ? 0 : (n + 1) / 2 * parent.width; height: parent.height; radius: parent.radius; color: "#1f6feb"
                }
            }
            QGCLabel { text: root.pwmText(ch); Layout.preferredWidth: _fw * 5; horizontalAlignment: Text.AlignRight; font.pointSize: ScreenTools.smallFontPointSize; color: "white" }
        }
    }

    QGCLabel {
        visible: !root._joy
        text: "未偵測到 USB 搖桿（RadioMaster Pocket 請選 USB Joystick 模式）"
        font.pointSize: ScreenTools.smallFontPointSize
        color: "#adb5bd"
    }
}
