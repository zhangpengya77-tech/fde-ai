// FDE-QGC V2-3｜編隊飛行控制區（飛行畫面浮動面板與設定頁「編隊飛行」共用同一份）
// 原理：ArduPilot 內建 Follow（跟隨）模式。長機照平常方式飛，從機依 FOLL_OFS_X/Y/Z 保持相對位置。
// 地面站負責：① 設定從機的 FOLL_* 參數 ② 把長機位置轉送給從機 ③ 一鍵起飛／跟隨／懸停／返航／降落。
// 安全：所有按鈕只對「FDE 模擬連線」上的飛機有效（C++ FdeSwarm 會再檢查一次），真機一律拒絕。
import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

ColumnLayout {
    id: root
    spacing: _fh * 0.4

    /// compact=true：浮動面板用（較窄、隱藏長說明）
    property bool compact: false

    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight
    readonly property var _vehicles: QGroundControl.multiVehicleManager.vehicles

    QGCPalette { id: pal; colorGroupEnabled: true }

    // 隊形設定記憶（面板與設定頁共用）
    Settings {
        id: store
        category: "FDE/Formation"
        property int shapeIndex: 2
        property string spacing: "6"
        property string altStep: "0"
        property string takeoffAlt: "10"
        property int leaderId: 11
    }

    // 隊形清單：key 給 C++ 計算偏移量，label 顯示中文
    readonly property var shapes: [
        { key: "line",    label: "一字橫隊" },
        { key: "column",  label: "一字縱隊" },
        { key: "vee",     label: "V 字（人字）" },
        { key: "echelon", label: "右梯隊" },
        { key: "grid",    label: "方陣" },
        { key: "circle",  label: "圓形（長機在中心）" }
    ]

    // 未勾選的系統 ID（預設全部參與，只記錄「被取消」的）
    property var _excluded: ({})
    property int _rev: 0   // 勾選變動時遞增，觸發重新計算

    // 目前參與編隊的系統 ID 清單
    function selectedIds() {
        void _rev
        const ids = []
        for (let i = 0; i < _vehicles.count; i++) {
            const v = _vehicles.get(i)
            if (!_excluded[v.id] && FdeSwarm.isSimVehicle(v.id)) {
                ids.push(v.id)
            }
        }
        return ids
    }
    // 從機＝參與編隊、但不是長機
    function followerIds() {
        // 依系統 ID 由小到大排列：隊形中的第 1、2… 個位置固定對應 ID 較小的從機
        return selectedIds().filter(function(id) { return id !== store.leaderId }).sort(function(a, b) { return a - b })
    }
    function setIncluded(id, included) {
        const m = _excluded
        if (included) { delete m[id] } else { m[id] = true }
        _excluded = m
        _rev++
    }

    readonly property string _shapeKey: shapes[Math.max(0, Math.min(shapes.length - 1, store.shapeIndex))].key
    // 預覽用的偏移量（只計算，不送指令）
    readonly property var _preview: { void _rev; void _vehicles.count
        return FdeSwarm.formationOffsets(_shapeKey, Math.max(1, followerIds().length), Number(store.spacing), Number(store.altStep)) }

    // 送出前的二次確認（使用 QGC 主視窗的對話框）
    function confirm(title, text, action) {
        mainWindow._showMessageDialogWorker(mainWindow, title, text, Dialog.Yes | Dialog.No, action)
    }

    // ---- 飛機清單 ----
    QGCLabel { text: "參與飛機（勾選）"; font.bold: true }
    QGCLabel {
        visible: _vehicles.count === 0
        text: "目前沒有連線的飛機。請先完成「步驟 1」：① 啟動模擬機 → ② 連線全部（約 10～20 秒）。"
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
        Layout.preferredWidth: _fw * 40
    }
    // 每架一列：參與／ID／角色／模式／高度（固定欄寬，讓各列對齊）
    Column {
        visible: _vehicles.count > 0
        spacing: 0
        RowLayout {
            spacing: _fw
            QGCLabel { text: "參與"; font.bold: true; Layout.preferredWidth: _fw * 5 }
            QGCLabel { text: "ID"; font.bold: true; Layout.preferredWidth: _fw * 3 }
            QGCLabel { text: "角色"; font.bold: true; Layout.preferredWidth: _fw * 12 }
            QGCLabel { text: "模式"; font.bold: true; Layout.preferredWidth: _fw * 12 }
            QGCLabel { text: "高度"; font.bold: true; Layout.preferredWidth: _fw * 7 }
        }
        Repeater {
            model: _vehicles
            delegate: RowLayout {
                id: rowItem
                required property var object
                spacing: _fw
                // 是否為 FDE 模擬機（真機不能勾選，也不會被送出任何編隊指令）
                readonly property bool _sim: { void QGroundControl.multiVehicleManager.vehicles.count; return FdeSwarm.isSimVehicle(object.id) }
                readonly property bool _leader: object.id === store.leaderId
                QGCCheckBox {
                    Layout.preferredWidth: _fw * 5
                    checked: { void root._rev; return rowItem._sim && !root._excluded[rowItem.object.id] }
                    enabled: rowItem._sim
                    onClicked: root.setIncluded(rowItem.object.id, checked)
                }
                QGCLabel { text: String(rowItem.object.id); Layout.preferredWidth: _fw * 3 }
                QGCLabel {
                    Layout.preferredWidth: _fw * 12
                    text: !rowItem._sim ? "真機（不開放）" : (rowItem._leader ? "長機" : "從機")
                    color: !rowItem._sim ? pal.warningText : (rowItem._leader ? "#ffd43b" : pal.text)
                    font.bold: rowItem._leader
                }
                QGCLabel { text: rowItem.object.flightMode + (rowItem.object.armed ? "・解鎖" : ""); Layout.preferredWidth: _fw * 12 }
                QGCLabel { text: Number(rowItem.object.altitudeRelative.rawValue).toFixed(1) + " m"; Layout.preferredWidth: _fw * 7 }
            }
        }
    }

    // ---- 隊形設定 ----
    GridLayout {
        columns: 4
        columnSpacing: _fw
        rowSpacing: _fh * 0.2
        QGCLabel { text: "長機 ID" }
        QGCComboBox {
            id: leaderBox
            objectName: "fdeFormationLeader"
            Layout.preferredWidth: _fw * 12
            model: { void _vehicles.count; const ids = []; for (let i = 0; i < _vehicles.count; i++) { ids.push(String(_vehicles.get(i).id)) } return ids.length ? ids : [String(store.leaderId)] }
            currentIndex: Math.max(0, model.indexOf(String(store.leaderId)))
            onActivated: (index) => { store.leaderId = Number(model[index]); root._rev++ }
        }
        QGCLabel { text: "隊形" }
        QGCComboBox {
            objectName: "fdeFormationShape"
            Layout.preferredWidth: _fw * 16
            model: root.shapes.map(function(s) { return s.label })
            currentIndex: store.shapeIndex
            onActivated: (index) => store.shapeIndex = index
        }
        QGCLabel { text: "間距（m）" }
        QGCTextField { Layout.preferredWidth: _fw * 12; text: store.spacing; onEditingFinished: store.spacing = text }
        QGCLabel { text: "高度階梯（m）" }
        QGCTextField { Layout.preferredWidth: _fw * 16; text: store.altStep; onEditingFinished: store.altStep = text }
        QGCLabel { text: "起飛高度（m）" }
        QGCTextField { Layout.preferredWidth: _fw * 12; text: store.takeoffAlt; onEditingFinished: store.takeoffAlt = text }
    }
    QGCLabel {
        visible: !root.compact
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        font.pointSize: ScreenTools.smallFontPointSize
        text: "間距：相鄰飛機的水平距離（建議 5 m 以上）。高度階梯：每多一架從機就比長機高多少公尺（0＝同高度），可降低碰撞風險。"
    }

    // ---- 隊形預覽（長機在中央、機頭朝上）----
    Canvas {
        id: preview
        Layout.preferredWidth: _fw * 30
        Layout.preferredHeight: _fw * 22
        Layout.alignment: Qt.AlignHCenter
        property var pts: root._preview
        property var ids: { void root._rev; void root._vehicles.count; return root.followerIds() }
        onPtsChanged: requestPaint()
        onIdsChanged: requestPaint()
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            ctx.fillStyle = "rgba(0,0,0,0.35)"
            ctx.fillRect(0, 0, width, height)
            // 依最遠的點決定縮放比例
            let maxR = 1
            for (const p of pts) { maxR = Math.max(maxR, Math.abs(p.x), Math.abs(p.y)) }
            const sc = Math.min(width, height) * 0.4 / maxR
            const cx = width / 2, cy = height / 2
            // 長機：黃色三角形（機頭朝上＝前方）
            ctx.fillStyle = "#ffd43b"
            ctx.beginPath(); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx - 7, cy + 7); ctx.lineTo(cx + 7, cy + 7); ctx.closePath(); ctx.fill()
            // 從機：藍色圓點＋系統 ID（畫面上方＝長機前方，右方＝長機右方；沒有從機時顯示位置序號）
            ctx.font = "11px sans-serif"
            for (let i = 0; i < pts.length; i++) {
                const px = cx + pts[i].y * sc, py = cy - pts[i].x * sc
                ctx.fillStyle = "#4dabf7"
                ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill()
                ctx.fillStyle = "white"
                ctx.fillText(ids.length > i ? ("ID " + ids[i]) : String(i + 1), px + 8, py + 4)
            }
            ctx.fillStyle = "#adb5bd"
            ctx.fillText("▲ 長機前方（黃色＝長機 " + store.leaderId + "）", 4, 12)
        }
    }

    // ---- 按鈕為什麼是灰色：直接告訴使用者缺什麼、下一步按哪裡 ----
    readonly property string _blockReason: {
        void _rev; void _vehicles.count
        const sel = selectedIds()
        if (sel.length === 0) {
            return _vehicles.count === 0
                ? "按鈕是灰色的原因：還沒有連線的模擬機。請先完成「步驟 1」：按「① 啟動模擬機」，等執行中後按「② 連線全部」。"
                : "按鈕是灰色的原因：清單中沒有可用的 FDE 模擬機（真機不開放編隊），或全部都被取消勾選。"
        }
        if (sel.indexOf(store.leaderId) < 0) {
            return "請在「長機 ID」選一架有勾選的模擬機。"
        }
        if (followerIds().length === 0) {
            return "編隊至少需要 2 架（1 架長機＋1 架從機）。目前只有長機，「② 套用隊形」暫時不能按。"
        }
        if (!FdeSwarm.formationActive) {
            return "下一步：① 全體起飛（等全部到達起飛高度）→ ② 套用隊形；「③ 開始編隊」要先套用隊形才能按。"
        }
        return ""
    }
    QGCLabel {
        objectName: "fdeFormationBlockReason"
        visible: root._blockReason !== ""
        Layout.fillWidth: true
        Layout.preferredWidth: _fw * 40
        wrapMode: Text.WordWrap
        font.bold: true
        color: "#ffa94d"
        text: "▶ " + root._blockReason
    }

    // ---- 操作按鈕（依課堂順序）----
    GridLayout {
        columns: root.compact ? 2 : 4
        columnSpacing: _fw * 0.5
        rowSpacing: _fh * 0.3
        QGCButton {
            objectName: "fdeFormationTakeoff"
            text: "① 全體起飛"
            Layout.fillWidth: true
            enabled: root.selectedIds().length > 0
            onClicked: root.confirm("全體起飛（模擬機）",
                "將對 " + root.selectedIds().length + " 架模擬機依序執行：切 Guided → 解鎖 → 起飛到 " + store.takeoffAlt
                + " m。\n只會對 FDE 模擬機送出指令。確定執行？",
                function() { FdeSwarm.takeoffAll(root.selectedIds(), Number(store.takeoffAlt)) })
        }
        QGCButton {
            objectName: "fdeFormationApply"
            text: "② 套用隊形"
            Layout.fillWidth: true
            enabled: root.followerIds().length > 0
            onClicked: FdeSwarm.applyFormation(store.leaderId, root.followerIds(), root._shapeKey, Number(store.spacing), Number(store.altStep))
        }
        QGCButton {
            objectName: "fdeFormationFollow"
            text: "③ 開始編隊"
            primary: true
            Layout.fillWidth: true
            enabled: FdeSwarm.formationActive
            onClicked: root.confirm("開始編隊",
                "從機 " + root.followerIds().join("、") + " 會切換到 Follow（跟隨）模式，自動飛到隊形位置並跟著長機 " + store.leaderId + "。確定？",
                function() { FdeSwarm.startFollow(root.followerIds()) })
        }
        QGCButton {
            text: "全體懸停"
            Layout.fillWidth: true
            enabled: root.selectedIds().length > 0
            onClicked: FdeSwarm.commandAll(root.selectedIds(), "guided")
        }
        QGCButton {
            text: "全體返航"
            Layout.fillWidth: true
            enabled: root.selectedIds().length > 0
            onClicked: root.confirm("全體返航", "所有參與的模擬機切換到 RTL（返航）模式，並停止編隊。確定？",
                                    function() { FdeSwarm.commandAll(root.selectedIds(), "rtl") })
        }
        QGCButton {
            text: "全體降落"
            Layout.fillWidth: true
            enabled: root.selectedIds().length > 0
            onClicked: root.confirm("全體降落", "所有參與的模擬機在目前位置降落，並停止編隊。確定？",
                                    function() { FdeSwarm.commandAll(root.selectedIds(), "land") })
        }
        QGCButton {
            text: "停止編隊"
            Layout.fillWidth: true
            enabled: FdeSwarm.formationActive
            onClicked: { FdeSwarm.commandAll(root.followerIds(), "guided"); FdeSwarm.stopFormation() }
        }
    }

    // ---- 狀態 ----
    QGCLabel {
        objectName: "fdeFormationStatus"
        Layout.fillWidth: true
        Layout.preferredWidth: _fw * 40
        wrapMode: Text.WordWrap
        text: (FdeSwarm.formationActive ? ("編隊中：長機 " + FdeSwarm.leaderId + "，已轉送長機位置 " + FdeSwarm.relayCount + " 次。\n") : "")
              + (FdeSwarm.formationMessage || "依序按 ① ② ③。長機請用官方飛行畫面操作（地圖點選「飛到這裡」或自動任務）。")
    }
}
