// FDE-QGC V1.0｜浮動面板一：飛行數據（只讀顯示，不送出任何指令）
import QtQuick
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls

FdeFloatingPanel {
    id: root
    title: "飛行數據"
    panelKey: "flightData"
    defaultRelX: 0.02
    defaultRelY: 0.25

    // 目前連線的飛控（未連線時為 null，所有欄位顯示「--」）
    property var _v: QGroundControl.multiVehicleManager.activeVehicle
    // 第一顆電池（多電池機只顯示第 1 顆）
    property var _bat: _v && _v.batteries.count > 0 ? _v.batteries.get(0) : null

    // 讀 Fact 數值並格式化；沒有載具或 NaN 時顯示「--」
    function factText(fact, digits) {
        if (!fact || isNaN(fact.rawValue)) {
            return "--"
        }
        return Number(fact.value).toFixed(digits) + " " + fact.units
    }

    // 兩欄表格：左欄名稱、右欄數值（數值全部來自官方 Vehicle Fact，單位依 QGC 設定）
    GridLayout {
        columns: 2
        columnSpacing: ScreenTools.defaultFontPixelWidth * 1.5
        rowSpacing: 0

        QGCLabel { text: "連線" }
        QGCLabel { text: root._v ? "已連線" : "未連線"; color: root._v ? "#2fb344" : "#e8590c"; font.bold: true }

        QGCLabel { text: "飛行模式" }
        QGCLabel { text: root._v ? root._v.flightMode : "--"; font.bold: true }

        QGCLabel { text: "解鎖狀態" }
        QGCLabel { text: root._v ? (root._v.armed ? "已解鎖 ARMED" : "未解鎖") : "--"; color: root._v && root._v.armed ? "#e03131" : QGroundControl.globalPalette.text }

        QGCLabel { text: "相對高度" }
        QGCLabel { text: root.factText(root._v ? root._v.altitudeRelative : null, 1) }

        QGCLabel { text: "海拔高度 AMSL" }
        QGCLabel { text: root.factText(root._v ? root._v.altitudeAMSL : null, 1) }

        QGCLabel { text: "地速" }
        QGCLabel { text: root.factText(root._v ? root._v.groundSpeed : null, 1) }

        QGCLabel { text: "爬升率" }
        QGCLabel { text: root.factText(root._v ? root._v.climbRate : null, 1) }

        QGCLabel { text: "航向" }
        QGCLabel { text: root.factText(root._v ? root._v.heading : null, 0) }

        QGCLabel { text: "離 Home 距離" }
        QGCLabel { text: root.factText(root._v ? root._v.distanceToHome : null, 0) }

        QGCLabel { text: "電量" }
        QGCLabel { text: root._bat ? root.factText(root._bat.percentRemaining, 0) + "／" + root.factText(root._bat.voltage, 2) : "--" }

        QGCLabel { text: "GPS 衛星／HDOP" }
        QGCLabel { text: root._v ? (root.factText(root._v.gps.count, 0) + "／" + root.factText(root._v.gps.hdop, 1)) : "--" }
    }
}
