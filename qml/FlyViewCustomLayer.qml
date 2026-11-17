// FDE-QGC V1.0｜覆寫 QGC 的 FlyViewCustomLayer.qml（官方預留給 Custom Build 的飛行畫面圖層）
// - 保留官方 insets 傳遞（不改變地圖與官方元件的版面計算）。
// - 加入三個 FDE 浮動面板與一列「面板開關」。
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import QGroundControl.FlyView
import FDE.Ui

Item {
    id: _root

    property var parentToolInsets
    property var totalToolInsets:   _toolInsets
    property var mapControl

    readonly property real _margin: ScreenTools.defaultFontPixelWidth * 0.75

    // 官方 insets 原樣傳遞（面板是浮動的，不佔用固定版面）
    QGCToolInsets {
        id:                     _toolInsets
        leftEdgeTopInset:       parentToolInsets.leftEdgeTopInset
        leftEdgeCenterInset:    parentToolInsets.leftEdgeCenterInset
        leftEdgeBottomInset:    parentToolInsets.leftEdgeBottomInset
        rightEdgeTopInset:      parentToolInsets.rightEdgeTopInset
        rightEdgeCenterInset:   parentToolInsets.rightEdgeCenterInset
        rightEdgeBottomInset:   parentToolInsets.rightEdgeBottomInset
        topEdgeLeftInset:       parentToolInsets.topEdgeLeftInset
        topEdgeCenterInset:     parentToolInsets.topEdgeCenterInset
        topEdgeRightInset:      parentToolInsets.topEdgeRightInset
        bottomEdgeLeftInset:    parentToolInsets.bottomEdgeLeftInset
        bottomEdgeCenterInset:  parentToolInsets.bottomEdgeCenterInset
        bottomEdgeRightInset:   parentToolInsets.bottomEdgeRightInset
    }

    // 安全區域：本圖層內縮邊距，並避開左側官方工具列（tool strip）
    readonly property rect _safe: Qt.rect(
        parentToolInsets.leftEdgeTopInset + _margin,
        _margin,
        Math.max(0, width - parentToolInsets.leftEdgeTopInset - _margin * 2),
        Math.max(0, height - panelToggles.height - _margin * 3))

    // 面板共用的「最上層」計數：點哪個面板，哪個就浮到最上面（FdeFloatingPanel.raise() 使用）
    property int _fdeTopZ: 10

    // V2 面板（參照課堂常用版面重新設計，全部為 FDE 自行實作）
    FdeQuickDataPanel    { id: quickDataPanel;   safeArea: _root._safe }   // 快速數據（取代 V1.0 飛行數據）
    FdeRcChannelsPanel   { id: rcPanel;          safeArea: _root._safe }   // 遙控器打桿監視
    FdeHudPanel          { id: hudPanel;         safeArea: _root._safe }   // HUD 姿態
    FdeFigure8ExamPanel  { id: examPanel;        safeArea: _root._safe }   // 八字飛行考核（預設隱藏）
    FdeLicenseTeachPanel { id: teachPanel;       safeArea: _root._safe }   // 考照教學（預設隱藏）
    FdeFormationPanel    { id: formationPanel;   safeArea: _root._safe }   // V2-3 編隊飛行（預設隱藏，僅限模擬機）

    // 面板開關列（畫面下方中央偏左，避開官方右下角的飛行數值）
    Rectangle {
        id: panelToggles
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.leftMargin: parentToolInsets.leftEdgeBottomInset + _margin
        anchors.bottomMargin: parentToolInsets.bottomEdgeLeftInset + _margin
        width: toggleRow.implicitWidth + _margin * 2
        height: toggleRow.implicitHeight + _margin
        radius: _margin
        color: Qt.rgba(0, 0, 0, 0.45)

        RowLayout {
            id: toggleRow
            anchors.centerIn: parent
            spacing: _margin * 0.5

            component Toggle: QGCButton {
                property var target
                text: target ? target.title : ""
                checkable: true
                checked: target ? target.shown : false
                onClicked: target.setShown(checked)
                pointSize: ScreenTools.smallFontPointSize
            }
            Toggle { target: quickDataPanel }
            Toggle { target: rcPanel }
            Toggle { target: hudPanel }
            Toggle { target: examPanel }
            Toggle { target: teachPanel }
            Toggle { target: formationPanel }
            QGCButton {
                text: "重設位置"
                pointSize: ScreenTools.smallFontPointSize
                onClicked: { quickDataPanel.reset(); rcPanel.reset(); hudPanel.reset(); examPanel.reset(); teachPanel.reset(); formationPanel.reset() }
            }
        }
    }
}
