// FDE-QGC V2｜浮動面板：快速數據（取代 V1.0「飛行數據」，功能為其超集合）
// - 4 欄 × 4 列共 16 張數據卡；點任一張卡可從清單自選要顯示的 MAVLink 數據，選擇會記住（QSettings）。
// - 數值全部來自 QGC 官方 Vehicle Fact（單位依 QGC 系統設定），本面板只讀顯示、不送任何指令。
import QtCore
import QtQml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls

FdeFloatingPanel {
    id: root
    title: "快速數據"
    icon: "▦"
    panelKey: "quickData"
    defaultRelX: 0.98
    defaultRelY: 0.30
    headerNote: _v ? "" : "等待飛控"
    footerNote: "點擊數據卡可自選 MAVLink 欄位；拖曳標題可移動"

    property var _v: QGroundControl.multiVehicleManager.activeVehicle
    property var _bat: _v && _v.batteries.count > 0 ? _v.batteries.get(0) : null

    // ---- 可選欄位目錄：key → [中文名稱, 取值路徑, 小數位, 卡片色] ----
    // 取值路徑：「v.欄位」＝飛控本體、「gps.欄位」「wind.欄位」「vib.欄位」「bat.欄位」＝對應數據群組；「fdeFlightTime」＝本面板自算
    readonly property var catalog: ({
        "altRel":   ["相對高度", "v.altitudeRelative", 1, "#4dabf7"],
        "altAmsl":  ["海拔高度", "v.altitudeAMSL", 1, "#4dabf7"],
        "hdop":     ["水平精度因子 HDOP", "gps.hdop", 2, "#ff922b"],
        "vdop":     ["垂直精度因子 VDOP", "gps.vdop", 2, "#ff922b"],
        "sats":     ["衛星數", "gps.count", 0, "#51cf66"],
        "lock":     ["GPS 定位類型", "gps.lock", 0, "#51cf66"],
        "roll":     ["橫滾角（Roll）", "v.roll", 1, "#cc5de8"],
        "pitch":    ["俯仰角（Pitch）", "v.pitch", 1, "#cc5de8"],
        "heading":  ["航向角（Heading）", "v.heading", 0, "#fcc419"],
        "cog":      ["地面航向（COG）", "gps.courseOverGround", 0, "#fcc419"],
        "wpDist":   ["航點距離", "v.distanceToNextWP", 1, "#ff6b6b"],
        "wpHdg":    ["航點方位", "v.headingToNextWP", 0, "#ff6b6b"],
        "homeDist": ["離家距離", "v.distanceToHome", 1, "#ff6b6b"],
        "climb":    ["升降速度", "v.climbRate", 1, "#ffd43b"],
        "gs":       ["地面速度", "v.groundSpeed", 1, "#4dabf7"],
        "as":       ["空速", "v.airSpeed", 1, "#4dabf7"],
        "thr":      ["油門百分比", "v.throttlePct", 0, "#ff922b"],
        "flyDist":  ["飛行里程", "v.flightDistance", 0, "#20c997"],
        "flyTime":  ["飛行時間", "fdeFlightTime", 0, "#20c997"],
        "lat":      ["緯度（Latitude）", "gps.lat", 7, "#51cf66"],
        "lon":      ["經度（Longitude）", "gps.lon", 7, "#51cf66"],
        "batPct":   ["電量", "bat.percentRemaining", 0, "#51cf66"],
        "batV":     ["電池電壓", "bat.voltage", 2, "#51cf66"],
        "batA":     ["電池電流", "bat.current", 1, "#51cf66"],
        "vibX":     ["振動 X", "vib.xAxis", 1, "#e64980"],
        "vibY":     ["振動 Y", "vib.yAxis", 1, "#e64980"],
        "vibZ":     ["振動 Z", "vib.zAxis", 1, "#e64980"],
        "windSpd":  ["風速", "wind.speed", 1, "#74c0fc"],
        "windDir":  ["風向", "wind.direction", 0, "#74c0fc"],
        "rssi":     ["遙控訊號 RSSI", "v.rcRSSI", 0, "#adb5bd"],
        "xtrack":   ["偏航距離（橫向誤差）", "v.xTrackError", 1, "#ff6b6b"],
        "imuTemp":  ["IMU 溫度", "v.imuTemp", 1, "#adb5bd"]
    })
    // 預設 16 張卡（參照課堂常用欄位）
    readonly property var defaultKeys: ["altRel", "hdop", "vdop", "sats", "roll", "heading", "wpDist", "batPct",
                                        "climb", "gs", "cog", "homeDist", "pitch", "flyTime", "lon", "lat"]

    Settings {
        id: qdStore
        category: "FDE/QuickData"
        property string keys: ""        // 逗號分隔；空字串＝用預設
    }
    property var keys: {
        const k = qdStore.keys !== "" ? qdStore.keys.split(",") : defaultKeys
        return k.length === 16 ? k : defaultKeys
    }
    function setKey(index, key) {
        const k = keys.slice()
        k[index] = key
        qdStore.keys = k.join(",")
    }

    // ---- 飛行時間：解鎖起算，上鎖停止（QGC 沒有現成 Fact，本面板自算）----
    property real _armedAt: 0
    property real _flightSec: 0
    Connections {
        target: root._v
        ignoreUnknownSignals: true
        function onArmedChanged() { if (root._v.armed) { root._armedAt = Date.now() } }
    }
    Timer {
        interval: 1000; repeat: true; running: !!root._v
        onTriggered: if (root._v && root._v.armed && root._armedAt > 0) { root._flightSec = (Date.now() - root._armedAt) / 1000 }
    }

    // 依取值路徑讀出 {text, unit}
    function read(key) {
        const c = catalog[key]
        if (!c || !_v) { return { text: "--", unit: "" } }
        if (c[1] === "fdeFlightTime") {
            const s = Math.round(_flightSec)
            return { text: Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"), unit: "" }
        }
        const parts = c[1].split(".")
        const grp = parts[0] === "v" ? _v : (parts[0] === "gps" ? _v.gps : (parts[0] === "wind" ? _v.wind : (parts[0] === "vib" ? _v.vibration : (parts[0] === "bat" ? _bat : null))))
        const f = grp ? grp[parts[1]] : null
        if (!f || f.rawValue === undefined || (typeof f.rawValue === "number" && isNaN(f.rawValue))) { return { text: "--", unit: f ? f.units : "" } }
        if (f.enumStrings && f.enumStrings.length > 0) { return { text: f.enumStringValue, unit: "" } }
        return { text: Number(f.value).toFixed(c[2]), unit: f.units }
    }

    // 每 0.5 秒刷新一次畫面（數據卡多，定時刷新比逐一綁定省資源）
    property int _tick: 0
    Timer { interval: 500; repeat: true; running: root.visible && !root.collapsed; onTriggered: root._tick++ }

    GridLayout {
        columns: 4
        columnSpacing: _fw * 0.4
        rowSpacing: _fw * 0.4

        Repeater {
            model: 16
            Rectangle {
                id: card
                readonly property string key: root.keys[index]
                readonly property var info: root.catalog[key] || ["?", "", 0, "#868e96"]
                readonly property var val: { root._tick; return root.read(key) }
                Layout.preferredWidth: _fw * 15
                Layout.preferredHeight: _fh * 3.6
                radius: _fw * 0.4
                color: cardMouse.containsMouse ? Qt.rgba(0.20, 0.32, 0.45, 0.95) : Qt.rgba(0.12, 0.22, 0.32, 0.95)
                border.color: Qt.rgba(1, 1, 1, 0.10)

                Rectangle { width: _fw * 0.35; height: parent.height; radius: 2; color: card.info[3] }
                QGCLabel {
                    anchors.left: parent.left; anchors.leftMargin: _fw * 0.8
                    anchors.right: parent.right; anchors.rightMargin: _fw * 0.4
                    anchors.top: parent.top; anchors.topMargin: _fh * 0.25
                    text: card.info[0]; color: "white"; elide: Text.ElideRight
                }
                QGCLabel {
                    anchors.left: parent.left; anchors.leftMargin: _fw * 0.8
                    anchors.bottom: parent.bottom; anchors.bottomMargin: _fh * 0.2
                    text: card.val.text; color: card.val.text === "--" ? card.info[3] : "white"
                    font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize
                }
                QGCLabel {
                    anchors.right: parent.right; anchors.rightMargin: _fw * 0.5
                    anchors.bottom: parent.bottom; anchors.bottomMargin: _fh * 0.25
                    text: card.val.unit; color: "#adb5bd"; font.pointSize: ScreenTools.smallFontPointSize
                }
                MouseArea {
                    id: cardMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: { pickMenu.cardIndex = index; pickMenu.popup() }
                }
            }
        }
    }

    // 點數據卡後跳出的欄位選單
    Menu {
        id: pickMenu
        property int cardIndex: 0
        // Menu 動態項目要用 Instantiator 插入（Qt 官方建議做法）
        Instantiator {
            model: Object.keys(root.catalog)
            delegate: MenuItem {
                text: root.catalog[modelData][0]
                checkable: true
                checked: root.keys[pickMenu.cardIndex] === modelData
                onTriggered: root.setKey(pickMenu.cardIndex, modelData)
            }
            onObjectAdded: (index, object) => pickMenu.insertItem(index, object)
            onObjectRemoved: (index, object) => pickMenu.removeItem(object)
        }
        MenuSeparator { }
        MenuItem { text: "全部恢復預設"; onTriggered: qdStore.keys = "" }
    }
}
