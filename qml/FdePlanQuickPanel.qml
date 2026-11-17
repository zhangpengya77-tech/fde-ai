// FDE-QGC V1.0｜航線規劃頁「航線快捷」面板（放在官方右側編輯面板的左邊）
// 顯示：各航段 高度／距離（1→2…）／航向／速度／預估飛行時間（單段與累計），全程距離與 QGC 官方估算總時間；
// 快捷：統一航點高度、設定任務速度、地理圍欄（圓形／多邊形／清除）。
// 安全：只修改「航線規劃頁上的計畫」，不會上傳到飛控；上傳仍需使用者按官方「上傳」。
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtPositioning

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

Rectangle {
    id: root

    FdeWaypointTool { id: fdeTool }

    property var planMasterController
    property bool expanded: true

    readonly property var _mc: planMasterController ? planMasterController.missionController : null
    readonly property var _gfc: planMasterController ? planMasterController.geoFenceController : null
    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight

    // 由計時器重新計算的快照（任務項目屬性變化很多，定時刷新最可靠）
    property var  legs: []
    property real totalDist: 0
    property real totalTime: 0          // 依本面板速度計算
    property real speed: 0
    property bool speedFromPlan: false
    property int  fenceCircles: 0
    property int  fencePolygons: 0
    property string message: ""

    width: _fw * 44
    height: expanded ? Math.min(col.implicitHeight + _fh, parent ? parent.height - y - _fh : col.implicitHeight) : header.height + _fh * 0.4
    radius: _fw * 0.6
    color: Qt.rgba(QGroundControl.globalPalette.window.r, QGroundControl.globalPalette.window.g, QGroundControl.globalPalette.window.b, 0.92)
    border.color: QGroundControl.globalPalette.brandingBlue
    clip: true

    function fmtTime(sec) {
        if (!isFinite(sec) || sec <= 0) { return "--" }
        const s = Math.round(sec)
        const m = Math.floor(s / 60)
        return m > 0 ? (m + " 分 " + (s % 60) + " 秒") : (s + " 秒")
    }

    function _settingsItem() {
        return _mc && _mc.visualItems.count > 0 ? _mc.visualItems.get(0) : null
    }

    function refresh() {
        if (!_mc) { legs = []; return }
        // 速度：任務設定有指定就用，否則用離線規劃預設懸停速度（多旋翼）
        const si = _settingsItem()
        let spd = QGroundControl.settingsManager.appSettings.offlineEditingHoverSpeed.rawValue
        speedFromPlan = false
        if (si && si.speedSection && si.speedSection.specifyFlightSpeed) {
            spd = si.speedSection.flightSpeed.rawValue
            speedFromPlan = true
        }
        speed = spd
        const out = []
        let wp = 0, cum = 0, cumT = 0
        for (let i = 1; i < _mc.visualItems.count; i++) {
            const it = _mc.visualItems.get(i)
            if (!it.specifiesCoordinate || it.isStandaloneCoordinate) {
                // 脫鉤／投放指令（DO_GRIPPER 211、DO_SET_SERVO 183）掛在前一個航點上顯示
                if (it.isSimpleItem && (it.command === 211 || it.command === 183) && out.length > 0) {
                    out[out.length - 1].drop = true
                }
                continue
            }
            wp++
            const d = isFinite(it.distance) ? it.distance : 0
            const t = spd > 0 ? d / spd : NaN
            cum += d
            cumT += isFinite(t) ? t : 0
            out.push({
                no: wp,
                seq: it.sequenceNumber,
                name: it.abbreviation !== "" ? it.abbreviation : it.commandName,
                alt: it.isSimpleItem && it.altitude ? Number(it.altitude.value) : NaN,
                dist: d,
                az: isFinite(it.azimuth) ? (it.azimuth + 360) % 360 : NaN,
                t: t,
                cumT: cumT,
                vi: i,
                drop: false
            })
        }
        legs = out
        totalDist = cum
        totalTime = cumT
        fenceCircles = _gfc ? _gfc.circles.count : 0
        fencePolygons = _gfc ? _gfc.polygons.count : 0
    }

    // 任務所有座標（含 Home）的外框，往外擴 25%（至少 30 m），給圍欄用
    function _missionBounds() {
        if (!_mc) { return null }
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180, n = 0
        const add = function(c) {
            if (!c || !c.isValid) { return }
            minLat = Math.min(minLat, c.latitude); maxLat = Math.max(maxLat, c.latitude)
            minLon = Math.min(minLon, c.longitude); maxLon = Math.max(maxLon, c.longitude); n++
        }
        add(_mc.plannedHomePosition)
        for (let i = 1; i < _mc.visualItems.count; i++) {
            const it = _mc.visualItems.get(i)
            if (it.specifiesCoordinate) { add(it.coordinate) }
        }
        if (n < 2) { return null }
        const padLat = Math.max((maxLat - minLat) * 0.25, 0.00027)
        const padLon = Math.max((maxLon - minLon) * 0.25, 0.00027 / Math.max(0.1, Math.cos(minLat * Math.PI / 180)))
        return { tl: QtPositioning.coordinate(maxLat + padLat, minLon - padLon), br: QtPositioning.coordinate(minLat - padLat, maxLon + padLon) }
    }

    function applyAltitude(alt) {
        if (!(alt >= 0 && alt <= 120)) { message = "高度需介於 0～120 公尺"; return }
        let n = 0
        for (let i = 1; i < _mc.visualItems.count; i++) {
            const it = _mc.visualItems.get(i)
            if (it.isSimpleItem && it.specifiesAltitude && it.altitude) { it.altitude.value = alt; n++ }
        }
        message = "已將 " + n + " 個航點高度設為 " + alt + " m（尚未上傳）"
        refresh()
    }

    function applySpeed(spd) {
        const si = _settingsItem()
        if (!si || !si.speedSection) { message = "此任務不支援設定速度"; return }
        if (!(spd > 0 && spd <= 15)) { message = "速度需介於 0～15 m/s"; return }
        si.speedSection.specifyFlightSpeed = true
        si.speedSection.flightSpeed.value = spd
        message = "任務速度設為 " + spd + " m/s（尚未上傳）"
        refresh()
    }

    // 在第 wpNo 個航點之後插入脫鉤（投放）指令；mode 0=夾爪 DO_GRIPPER 釋放、1=舵機 DO_SET_SERVO
    function addDrop(wpNo, mode, servoCh, pwm) {
        const leg = legs.find(l => l.no === wpNo)
        if (!leg) { message = "找不到第 " + wpNo + " 個航點"; return }
        if (mode === 1 && !(servoCh >= 1 && servoCh <= 16 && pwm >= 800 && pwm <= 2200)) { message = "舵機通道需 1～16、PWM 需 800～2200"; return }
        const wpItem = _mc.visualItems.get(leg.vi)
        const item = _mc.insertSimpleMissionItem(wpItem.coordinate, leg.vi + 1, false)
        if (!item) { message = "插入失敗"; return }
        if (mode === 0) {
            item.command = 211                    // MAV_CMD_DO_GRIPPER
            fdeTool.setItemParams(item, 1, 0)     // param1=夾爪編號 1、param2=0 釋放（GRIPPER_ACTION_RELEASE）
        } else {
            item.command = 183                    // MAV_CMD_DO_SET_SERVO
            fdeTool.setItemParams(item, servoCh, pwm)
        }
        message = "已在第 " + wpNo + " 個航點後加入脫鉤（" + (mode === 0 ? "夾爪釋放" : ("舵機 CH" + servoCh + "＝" + pwm)) + "），預估於起飛後 " + fmtTime(leg.cumT) + " 投放（尚未上傳）"
        refresh()
    }

    function addFence(circle) {
        const b = _missionBounds()
        if (!b) { message = "請先在地圖上放至少一個航點"; return }
        if (circle) { _gfc.addInclusionCircle(b.tl, b.br) } else { _gfc.addInclusionPolygon(b.tl, b.br) }
        message = (circle ? "已加入圓形" : "已加入多邊形") + "包含圍欄（涵蓋全部航點，可在地圖上拖曳調整；尚未上傳）"
        refresh()
    }

    Timer { interval: 1000; running: root.visible && root.expanded; repeat: true; triggeredOnStart: true; onTriggered: root.refresh() }

    // 阻擋點擊穿透到底下的地圖
    MouseArea { anchors.fill: parent; onWheel: (wheel) => wheel.accepted = true }

    Rectangle {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: _fh * 1.6
        radius: root.radius
        color: QGroundControl.globalPalette.brandingBlue
        QGCLabel { anchors.left: parent.left; anchors.leftMargin: _fw; anchors.verticalCenter: parent.verticalCenter; text: "航線快捷"; color: "white"; font.bold: true }
        QGCLabel {
            anchors.right: parent.right; anchors.rightMargin: _fw; anchors.verticalCenter: parent.verticalCenter
            text: root.expanded ? "收合 ▲" : "展開 ▼"; color: "white"
        }
        MouseArea { anchors.fill: parent; onClicked: root.expanded = !root.expanded; cursorShape: Qt.PointingHandCursor }
    }

    QGCFlickable {
        anchors.top: header.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: _fw * 0.6
        contentHeight: col.implicitHeight
        visible: root.expanded
        clip: true

        ColumnLayout {
            id: col
            width: parent.width
            spacing: _fh * 0.3

            // ---- 總覽 ----
            GridLayout {
                columns: 4
                columnSpacing: _fw
                rowSpacing: 0
                QGCLabel { text: "航點數" }
                QGCLabel { text: root.legs.length; font.bold: true }
                QGCLabel { text: "全程距離" }
                QGCLabel { text: root.totalDist.toFixed(0) + " m"; font.bold: true }
                QGCLabel { text: "速度" }
                QGCLabel { text: root.speed.toFixed(1) + " m/s" + (root.speedFromPlan ? "" : "（預設）"); font.bold: true }
                QGCLabel { text: "預估時間" }
                QGCLabel { objectName: "fdePlanEta"; text: root.fmtTime(root._mc ? root._mc.missionTime : 0); font.bold: true; color: QGroundControl.globalPalette.colorGreen }
            }
            QGCLabel {
                text: "※ 預估時間取自 QGC 官方估算（含起降與改速）；下表各段時間以上方速度估算。"
                font.pointSize: ScreenTools.smallFontPointSize; wrapMode: Text.WordWrap; Layout.fillWidth: true; opacity: 0.75
            }

            // ---- 航段表 ----
            RowLayout {
                spacing: _fw * 0.8
                Repeater {
                    model: [["航段", 7], ["高度", 6], ["距離", 7], ["航向", 5], ["單段", 6], ["累計", 7]]
                    QGCLabel { Layout.preferredWidth: _fw * modelData[1]; text: modelData[0]; font.bold: true; font.pointSize: ScreenTools.smallFontPointSize }
                }
            }
            Repeater {
                model: root.legs
                RowLayout {
                    spacing: _fw * 0.8
                    readonly property var leg: modelData
                    QGCLabel { Layout.preferredWidth: _fw * 7; text: (leg.no === 1 ? "H→1" : (leg.no - 1) + "→" + leg.no); font.pointSize: ScreenTools.smallFontPointSize; font.bold: leg.no === 2 }
                    QGCLabel { Layout.preferredWidth: _fw * 6; text: isNaN(leg.alt) ? "--" : leg.alt.toFixed(0) + "m"; font.pointSize: ScreenTools.smallFontPointSize }
                    QGCLabel { Layout.preferredWidth: _fw * 7; text: leg.dist.toFixed(1) + "m"; font.pointSize: ScreenTools.smallFontPointSize; font.bold: leg.no === 2 }
                    QGCLabel { Layout.preferredWidth: _fw * 5; text: isNaN(leg.az) ? "--" : leg.az.toFixed(0) + "°"; font.pointSize: ScreenTools.smallFontPointSize }
                    QGCLabel { Layout.preferredWidth: _fw * 6; text: root.fmtTime(leg.t); font.pointSize: ScreenTools.smallFontPointSize }
                    QGCLabel { Layout.preferredWidth: _fw * 7; text: root.fmtTime(leg.cumT) + (leg.drop ? " ⬇脫鉤" : ""); font.pointSize: ScreenTools.smallFontPointSize; color: leg.drop ? "#f59f00" : QGroundControl.globalPalette.text }
                }
            }
            QGCLabel {
                visible: root.legs.length === 0
                text: "尚無航點：在地圖上點擊新增，或從「教學工具」載入。"
                font.pointSize: ScreenTools.smallFontPointSize; wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
            QGCLabel {
                text: "航向：從前一點飛到此點的真北方位角（不是機頭 Yaw）。粗體為 1→2 航段。"
                font.pointSize: ScreenTools.smallFontPointSize; wrapMode: Text.WordWrap; Layout.fillWidth: true; opacity: 0.75
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: QGroundControl.globalPalette.text; opacity: 0.25 }

            // ---- 快捷設定 ----
            RowLayout {
                spacing: _fw * 0.5
                QGCLabel { text: "統一高度" }
                QGCTextField { id: altQuick; text: "30"; Layout.preferredWidth: _fw * 7 }
                QGCLabel { text: "m" }
                QGCButton { text: "套用全部航點"; pointSize: ScreenTools.smallFontPointSize; enabled: root.legs.length > 0; onClicked: root.applyAltitude(Number(altQuick.text)) }
            }
            RowLayout {
                spacing: _fw * 0.5
                QGCLabel { text: "任務速度" }
                QGCTextField { id: spdQuick; text: "5"; Layout.preferredWidth: _fw * 7 }
                QGCLabel { text: "m/s" }
                QGCButton { text: "套用"; pointSize: ScreenTools.smallFontPointSize; onClicked: root.applySpeed(Number(spdQuick.text)) }
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: QGroundControl.globalPalette.text; opacity: 0.25 }

            // ---- 脫鉤（投放）----
            QGCLabel { text: "脫鉤投放"; font.bold: true }
            RowLayout {
                spacing: _fw * 0.5
                QGCLabel { text: "在第" }
                QGCTextField { id: dropWp; text: "2"; Layout.preferredWidth: _fw * 4 }
                QGCLabel { text: "航點後" }
                QGCComboBox { id: dropMode; model: ["夾爪釋放", "舵機"]; Layout.preferredWidth: _fw * 10 }
            }
            RowLayout {
                visible: dropMode.currentIndex === 1
                spacing: _fw * 0.5
                QGCLabel { text: "舵機通道" }
                QGCTextField { id: dropCh; text: "9"; Layout.preferredWidth: _fw * 4 }
                QGCLabel { text: "PWM" }
                QGCTextField { id: dropPwm; text: "1900"; Layout.preferredWidth: _fw * 6 }
            }
            QGCButton {
                text: "加入脫鉤"
                pointSize: ScreenTools.smallFontPointSize
                enabled: root.legs.length > 0
                onClicked: root.addDrop(Number(dropWp.text), dropMode.currentIndex, Number(dropCh.text), Number(dropPwm.text))
            }
            QGCLabel {
                text: "飛到該航點後送出釋放指令；需飛控已設定夾爪（GRIP_ENABLE）或對應舵機輸出。只寫入計畫，上傳仍須按官方「上傳」，真機投放前由教官確認下方安全淨空。"
                font.pointSize: ScreenTools.smallFontPointSize; wrapMode: Text.WordWrap; Layout.fillWidth: true; opacity: 0.75
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: QGroundControl.globalPalette.text; opacity: 0.25 }

            // ---- 地理圍欄 ----
            QGCLabel { text: "地理圍欄：圓形 " + root.fenceCircles + "、多邊形 " + root.fencePolygons; font.bold: true }
            RowLayout {
                spacing: _fw * 0.5
                QGCButton { text: "＋圓形圍欄"; pointSize: ScreenTools.smallFontPointSize; onClicked: root.addFence(true) }
                QGCButton { text: "＋多邊形圍欄"; pointSize: ScreenTools.smallFontPointSize; onClicked: root.addFence(false) }
                QGCButton {
                    text: "清除圍欄"
                    pointSize: ScreenTools.smallFontPointSize
                    enabled: root.fenceCircles + root.fencePolygons > 0
                    onClicked: mainWindow._showMessageDialogWorker(mainWindow, "清除地理圍欄", "確定要清除航線規劃頁上的所有地理圍欄嗎？（尚未上傳到飛控）",
                                                                  Dialog.Yes | Dialog.No, function() { root._gfc.clearAllInteractive(); root.refresh() })
                }
            }
            QGCLabel {
                text: "圍欄會涵蓋目前所有航點與 Home，可在地圖上拖曳調整；詳細設定請切到官方右側面板的「圍欄」分頁。"
                font.pointSize: ScreenTools.smallFontPointSize; wrapMode: Text.WordWrap; Layout.fillWidth: true; opacity: 0.75
            }

            QGCLabel {
                visible: root.message !== ""
                text: root.message
                color: QGroundControl.globalPalette.colorGreen
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
    }
}
