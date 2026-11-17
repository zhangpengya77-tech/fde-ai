// FDE-QGC V2｜浮動面板：HUD 姿態（抬頭顯示器）
// - 人工地平儀：天空／地面隨橫滾（Roll）旋轉、隨俯仰（Pitch）上下移動；俯仰刻度每 10°。
// - 上方航向框（Heading）、左方地面速度、右方相對高度；下方空速與升降速度；底列連線／GPS／電量狀態。
// - 數值來自 QGC 官方 Vehicle Fact，只讀顯示。
import QtQuick
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls

FdeFloatingPanel {
    id: root
    title: "HUD 姿態"
    icon: "◇"
    panelKey: "hud"
    defaultRelX: 0.50
    defaultRelY: 0.98
    headerNote: "拖動標題可移動"
    footerNote: !_v ? "等待飛控連線" : ("GPS " + _fmt(_v.gps.count, 0) + " 顆　電量 " + (_bat ? _fmt(_bat.percentRemaining, 0) : "--") + "%")

    property var _v: QGroundControl.multiVehicleManager.activeVehicle
    property var _bat: _v && _v.batteries.count > 0 ? _v.batteries.get(0) : null
    readonly property real _roll:  _v && !isNaN(_v.roll.rawValue)  ? _v.roll.rawValue  : 0
    readonly property real _pitch: _v && !isNaN(_v.pitch.rawValue) ? _v.pitch.rawValue : 0
    readonly property real _hdg:   _v && !isNaN(_v.heading.rawValue) ? _v.heading.rawValue : 0

    function _fmt(fact, d) { return (!fact || isNaN(fact.rawValue)) ? "--" : Number(fact.value).toFixed(d) }

    // 數值框（左右兩側）
    component ValueBox: Rectangle {
        property string caption
        property string value
        property string unit
        width: _fw * 11; height: _fh * 4.4; radius: _fw * 0.6
        color: Qt.rgba(0.05, 0.10, 0.16, 0.80); border.color: Qt.rgba(1, 1, 1, 0.35)
        Column {
            anchors.centerIn: parent
            QGCLabel { anchors.horizontalCenter: parent.horizontalCenter; text: caption; color: "white"; font.pointSize: ScreenTools.smallFontPointSize }
            QGCLabel { anchors.horizontalCenter: parent.horizontalCenter; text: value; color: "white"; font.bold: true; font.pointSize: ScreenTools.largeFontPointSize }
            QGCLabel { anchors.horizontalCenter: parent.horizontalCenter; text: unit; color: "#ffd43b"; font.pointSize: ScreenTools.smallFontPointSize }
        }
    }

    Item {
        id: hud
        implicitWidth: _fh * 30
        implicitHeight: _fh * 17
        clip: true
        readonly property real pxPerDeg: height / 50       // 畫面高度約顯示 ±25° 俯仰

        // ---- 天空與地面（整塊隨姿態轉動）----
        Item {
            id: horizon
            anchors.centerIn: parent
            width: parent.width * 3; height: parent.height * 3
            rotation: -root._roll
            transform: Translate { y: root._pitch * hud.pxPerDeg }
            Rectangle { width: parent.width; height: parent.height / 2; gradient: Gradient { GradientStop { position: 0; color: "#1c5aa8" } GradientStop { position: 1; color: "#6fb3ef" } } }
            Rectangle { y: parent.height / 2; width: parent.width; height: parent.height / 2; gradient: Gradient { GradientStop { position: 0; color: "#9bd36a" } GradientStop { position: 1; color: "#3d6b25" } } }
            Rectangle { y: parent.height / 2 - 1; width: parent.width; height: 2; color: "white" }   // 地平線
            // 俯仰刻度：±10°、±20°
            Repeater {
                model: [-20, -10, 10, 20]
                Item {
                    x: horizon.width / 2 - width / 2
                    y: horizon.height / 2 - modelData * hud.pxPerDeg
                    width: hud.width * 0.36; height: 1
                    Rectangle { anchors.verticalCenter: parent.verticalCenter; width: parent.width; height: 2; color: "white"; opacity: 0.9 }
                    QGCLabel { anchors.right: parent.left; anchors.rightMargin: _fw * 0.5; anchors.verticalCenter: parent.verticalCenter; text: Math.abs(modelData); color: "white"; font.bold: true }
                    QGCLabel { anchors.left: parent.right; anchors.leftMargin: _fw * 0.5; anchors.verticalCenter: parent.verticalCenter; text: Math.abs(modelData); color: "white"; font.bold: true }
                }
            }
        }

        // ---- 固定的飛機基準線（中央紅線）----
        Rectangle { anchors.centerIn: parent; width: parent.width * 0.42; height: 3; color: "#e03131"; opacity: 0.9 }
        Rectangle { anchors.centerIn: parent; width: _fw * 1.2; height: width; radius: width / 2; color: "#e03131" }

        // ---- 上方航向框 ----
        Rectangle {
            anchors.top: parent.top; anchors.topMargin: _fh * 0.2
            anchors.horizontalCenter: parent.horizontalCenter
            width: _fw * 10; height: _fh * 2; color: "white"; border.color: "#212529"
            QGCLabel {
                anchors.centerIn: parent
                text: root._v ? String(Math.round(root._hdg) % 360).padStart(3, "0") + "°" : "---°"
                color: "#212529"; font.bold: true; font.pointSize: ScreenTools.largeFontPointSize
            }
        }

        // ---- 左右數值框 ----
        ValueBox {
            anchors.left: parent.left; anchors.leftMargin: _fw * 0.6; anchors.verticalCenter: parent.verticalCenter
            caption: "地面速度"; value: root._fmt(root._v ? root._v.groundSpeed : null, 1); unit: root._v ? root._v.groundSpeed.units : "m/s"
        }
        ValueBox {
            anchors.right: parent.right; anchors.rightMargin: _fw * 0.6; anchors.verticalCenter: parent.verticalCenter
            caption: "相對高度"; value: root._fmt(root._v ? root._v.altitudeRelative : null, 1); unit: root._v ? root._v.altitudeRelative.units : "m"
        }

        // ---- 中央狀態（未連線、未解鎖）----
        Rectangle {
            visible: !root._v || !root._v.armed
            anchors.centerIn: parent
            width: stateLbl.implicitWidth + _fw * 2; height: stateLbl.implicitHeight + _fh * 0.6
            radius: _fw * 0.5; color: Qt.rgba(0, 0, 0, 0.55)
            QGCLabel { id: stateLbl; anchors.centerIn: parent; text: !root._v ? "等待飛控" : "未解鎖"; color: "#ff6b6b"; font.bold: true; font.pointSize: ScreenTools.largeFontPointSize }
        }

        // ---- 下方空速與升降 ----
        QGCLabel {
            anchors.left: parent.left; anchors.leftMargin: _fw * 0.6; anchors.bottom: parent.bottom; anchors.bottomMargin: _fh * 0.2
            text: "空速 " + root._fmt(root._v ? root._v.airSpeed : null, 1) + " m/s"; color: "white"; font.bold: true
        }
        QGCLabel {
            anchors.right: parent.right; anchors.rightMargin: _fw * 0.6; anchors.bottom: parent.bottom; anchors.bottomMargin: _fh * 0.2
            text: "升降 " + root._fmt(root._v ? root._v.climbRate : null, 1) + " m/s"; color: "white"; font.bold: true
        }
    }
}
