// FDE-QGC V2-3｜飛行畫面浮動面板：編隊飛行（預設隱藏；由下方面板開關列開啟）
// 內容與設定頁「編隊飛行」共用 FdeFormationControls；有全屏、隱藏、縮放（FdeFloatingPanel 提供）。
import QtQuick
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

FdeFloatingPanel {
    id: root
    title: "編隊飛行"
    icon: "◆"
    panelKey: "formation"
    defaultRelX: 0.62
    defaultRelY: 0.05
    defaultShown: false
    // 標題列右側：編隊中顯示長機編號，否則顯示目前連線架數
    headerNote: FdeSwarm.formationActive ? ("編隊中・長機 " + FdeSwarm.leaderId)
                                         : (QGroundControl.multiVehicleManager.vehicles.count + " 架已連線")
    footerNote: "僅限模擬機・啟動模擬機請到「仿真訓練 → 多機編隊」"

    FdeFormationControls { compact: true }

    // 自我測試用：formation:show／formation:hide（一般使用不會收到）
    Connections {
        target: FdeSelfTest
        function onCommandIssued(command) {
            if (command === "formation:show") { root.setShown(true) }
            else if (command === "formation:hide") { root.setShown(false) }
        }
    }
}
