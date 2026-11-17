// FDE-QGC V1.0／V2｜通用浮動面板外框（飛行監控畫面用）
// 版面：標題列（圖示＋標題＋右側說明＋「全屏」＋「–」收合）／內容／底部列（說明＋「－ 100% ＋」縮放＋「隱藏」）
// 功能：拖曳移動、位置與縮放記憶（QSettings）、全屏與還原、一鍵重設、限制在安全區域內、點擊時移到最上層。
// 注意：QGC 的關鍵告警（Vehicle Error 彈窗、確認滑桿彈窗）是 Popup，畫在最上層 overlay，面板不會蓋住它們。
import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls

Rectangle {
    id: panel

    // ---- 外部設定 ----
    property string title: ""
    property string icon: ""                   // 標題左側的小圖示文字（例如「∞」「◇」「▦」）
    property string headerNote: ""             // 標題列右側的小字（例如「等待飛控」）
    property string footerNote: ""             // 底部列左側的說明文字
    property string panelKey: "panel"          // 存檔用的唯一鍵
    property real   defaultRelX: 0.1           // 預設位置（相對於安全區域 0~1）
    property real   defaultRelY: 0.1
    property bool   defaultShown: true
    property real   minScale: 0.6
    property real   maxScale: 2.0
    property rect   safeArea: Qt.rect(0, 0, parent ? parent.width : 0, parent ? parent.height : 0)
    default property alias content: contentColumn.data

    // ---- 狀態（存檔）----
    property bool shown: store.shown
    property bool collapsed: store.collapsed
    property bool fullscreen: false            // 全屏不存檔：重開程式一律回到一般大小
    readonly property real uiScale: store.uiScale

    // 全屏時把內容等比放大到塞滿安全區域
    readonly property real _fitScale: Math.max(0.3, Math.min(
        (safeArea.width - _pad * 2) / Math.max(1, contentColumn.implicitWidth),
        (safeArea.height - header.height - footer.height - _pad * 2) / Math.max(1, contentColumn.implicitHeight)))
    readonly property real _scale: fullscreen ? _fitScale : uiScale

    readonly property real _pad: ScreenTools.defaultFontPixelWidth * 0.8
    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight


    visible: shown
    width:  fullscreen ? safeArea.width
                       : Math.max(contentColumn.implicitWidth * _scale, headerRow.implicitWidth, footerRow.implicitWidth) + _pad * 2
    height: fullscreen ? safeArea.height
                       : header.height + (collapsed ? 0 : contentColumn.implicitHeight * _scale + _pad * 2 + footer.height)
    radius: _fw * 0.6
    color:  Qt.rgba(0.05, 0.11, 0.17, 0.90)
    border.color: Qt.rgba(0.30, 0.67, 0.97, 0.55)
    border.width: 1

    QGCPalette { id: qgcPal; colorGroupEnabled: true }

    // 位置記憶：負值代表「尚未存過」→ 使用預設位置
    Settings {
        id: store
        category: "FDE/Panels/" + panel.panelKey
        property real x: -1
        property real y: -1
        property bool shown: panel.defaultShown
        property bool collapsed: false
        property real uiScale: 1.0
    }

    function setShown(value) { store.shown = value; if (!value) { fullscreen = false } }
    function toggle() { setShown(!store.shown) }
    function setScale(s) { store.uiScale = Math.round(Math.min(maxScale, Math.max(minScale, s)) * 10) / 10; Qt.callLater(clamp) }
    // 浮到最上層：父層（FlyViewCustomLayer）的 _fdeTopZ 是所有面板共用的計數
    function raise() { if (parent && parent._fdeTopZ !== undefined) { parent._fdeTopZ = parent._fdeTopZ + 1; z = parent._fdeTopZ } }

    // 回到預設位置、預設大小並顯示
    function reset() {
        fullscreen = false
        store.x = -1
        store.y = -1
        store.collapsed = false
        store.uiScale = 1.0
        store.shown = panel.defaultShown
        _place()
    }

    // 全屏切換：全屏時貼齊安全區域左上角；還原時回到原本位置
    function toggleFullscreen() {
        fullscreen = !fullscreen
        raise()
        if (fullscreen) {
            store.collapsed = false
            x = safeArea.x
            y = safeArea.y
        } else {
            _place()
        }
    }

    // 把位置限制在安全區域內
    function clamp() {
        if (fullscreen) { x = safeArea.x; y = safeArea.y; return }
        const minX = safeArea.x
        const minY = safeArea.y
        const maxX = Math.max(minX, safeArea.x + safeArea.width - width)
        const maxY = Math.max(minY, safeArea.y + safeArea.height - height)
        x = Math.min(Math.max(x, minX), maxX)
        y = Math.min(Math.max(y, minY), maxY)
    }

    function _place() {
        // 視窗尺寸還沒決定時不要算位置（否則所有面板都會擠在左上角）
        if (!parent || safeArea.width <= 0 || safeArea.height <= 0) {
            return
        }
        if (store.x >= 0 && store.y >= 0) {
            x = store.x
            y = store.y
        } else {
            x = safeArea.x + (safeArea.width - width) * defaultRelX
            y = safeArea.y + (safeArea.height - height) * defaultRelY
        }
        clamp()
    }

    Component.onCompleted: Qt.callLater(_place)
    // 使用者還沒拖曳過（沒有存檔位置）→ 依視窗大小重新放到預設位置；拖曳過 → 只做邊界限制
    onSafeAreaChanged: Qt.callLater(function() { if (store.x < 0 || store.y < 0) { panel._place() } else { panel.clamp() } })
    onHeightChanged: Qt.callLater(clamp)
    onWidthChanged: Qt.callLater(clamp)

    // 小按鈕（標題列與底部列共用）
    component PanelButton: Rectangle {
        id: pb
        property string text
        property bool highlight: false
        signal clicked()
        implicitWidth: Math.max(lbl.implicitWidth + panel._fw * 1.6, panel._fh * 1.6)
        implicitHeight: panel._fh * 1.5
        radius: panel._fw * 0.4
        color: highlight ? "#1f6feb" : (ma.containsMouse ? Qt.rgba(1, 1, 1, 0.16) : Qt.rgba(1, 1, 1, 0.08))
        border.color: highlight ? "#4dabf7" : "transparent"
        QGCLabel { id: lbl; anchors.centerIn: parent; text: pb.text; color: "white"; font.pointSize: ScreenTools.smallFontPointSize }
        MouseArea { id: ma; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: pb.clicked() }
    }

    // ---- 標題列（拖曳把手）----
    Rectangle {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: _fh * 2.2
        radius: panel.radius
        color: Qt.rgba(0.07, 0.16, 0.25, 0.95)

        // 拖曳區放在最底層，按鈕蓋在上面才點得到
        MouseArea {
            id: dragArea
            anchors.fill: parent
            drag.target: panel.fullscreen ? null : panel
            drag.threshold: 2
            cursorShape: panel.fullscreen ? Qt.ArrowCursor : (pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor)
            onPressed: panel.raise()
            onDoubleClicked: panel.toggleFullscreen()
            onReleased: {
                panel.clamp()
                if (!panel.fullscreen) {
                    store.x = panel.x
                    store.y = panel.y
                }
            }
        }

        RowLayout {
            id: headerRow
            anchors.fill: parent
            anchors.leftMargin: panel._pad
            anchors.rightMargin: panel._pad * 0.5
            spacing: _fw * 0.6

            QGCLabel { visible: panel.icon !== ""; text: panel.icon; color: "#4dabf7"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
            QGCLabel { text: panel.title; color: "white"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
            Item { Layout.fillWidth: true; implicitWidth: _fw }
            QGCLabel { visible: panel.headerNote !== ""; text: panel.headerNote; color: "#adb5bd"; font.pointSize: ScreenTools.smallFontPointSize }
            PanelButton { text: panel.fullscreen ? "還原" : "全屏"; highlight: panel.fullscreen; onClicked: panel.toggleFullscreen() }
            PanelButton { text: panel.collapsed ? "▢" : "–"; visible: !panel.fullscreen; onClicked: store.collapsed = !store.collapsed }
        }
    }

    // 阻擋點擊／滾輪穿透到底下的地圖
    MouseArea {
        anchors.top: header.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: !panel.collapsed
        onPressed: panel.raise()
        onWheel: (wheel) => wheel.accepted = true
    }

    // ---- 內容（依縮放比例放大縮小；全屏時置中）----
    Item {
        id: contentHolder
        anchors.top: header.bottom
        anchors.topMargin: panel._pad
        anchors.horizontalCenter: panel.fullscreen ? parent.horizontalCenter : undefined
        anchors.left: panel.fullscreen ? undefined : parent.left
        anchors.leftMargin: panel._pad
        width: contentColumn.implicitWidth * panel._scale
        height: contentColumn.implicitHeight * panel._scale
        visible: !panel.collapsed

        ColumnLayout {
            id: contentColumn
            spacing: _fh * 0.25
            scale: panel._scale
            transformOrigin: Item.TopLeft
        }
    }

    // ---- 底部列：說明＋縮放＋隱藏 ----
    Rectangle {
        id: footer
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: _fh * 2.0
        visible: !panel.collapsed
        radius: panel.radius
        color: Qt.rgba(0.07, 0.16, 0.25, 0.95)

        RowLayout {
            id: footerRow
            anchors.fill: parent
            anchors.leftMargin: panel._pad
            anchors.rightMargin: panel._pad * 0.5
            spacing: _fw * 0.4

            QGCLabel {
                text: panel.footerNote
                color: "#adb5bd"
                font.pointSize: ScreenTools.smallFontPointSize
                elide: Text.ElideRight
                Layout.fillWidth: true
                Layout.maximumWidth: _fw * 30
            }
            Item { Layout.fillWidth: true; implicitWidth: 1 }
            PanelButton { text: "－"; visible: !panel.fullscreen; onClicked: panel.setScale(panel.uiScale - 0.1) }
            QGCLabel { text: Math.round(panel._scale * 100) + "%"; color: "white"; font.pointSize: ScreenTools.smallFontPointSize; Layout.preferredWidth: _fw * 4.5; horizontalAlignment: Text.AlignHCenter }
            PanelButton { text: "＋"; visible: !panel.fullscreen; onClicked: panel.setScale(panel.uiScale + 0.1) }
            PanelButton { text: "隱藏"; highlight: true; onClicked: panel.setShown(false) }
        }
    }
}
