// FDE-QGC｜「日誌 → 智能診斷」子頁（2026-11-18 導覽精簡：原左側「日誌分析」移到這裡）
// - 內容就是原本的日誌分析頁（FdeLogAnalysisPage），診斷規則與「前往 AI 調參」按鈕都不變。
// - 本頁只是外殼：填滿官方分析工具頁右側面板，並沿用「日誌檢視器」已開啟的 .bin，不用重新選檔。
// - 仍可按「開啟日誌（.bin）…」另選檔案。
import QtQuick
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

Item {
    id: root
    anchors.fill: parent          // 放進分析工具頁右側面板時填滿

    // 官方分析工具頁會連接 popout 訊號；本頁不提供彈出視窗，只宣告避免警告
    property bool popped: false
    signal popout()

    readonly property real _fw: ScreenTools.defaultFontPixelWidth

    // 路徑比較用：統一斜線方向與大小寫（Windows 路徑不分大小寫）
    function _norm(p) {
        return String(p || "").replace(/\\/g, "/").toLowerCase()
    }
    readonly property string _shared: FdeLogAnalyzer.sharedLogPath
    readonly property bool _sharedIsBin: /\.(bin|log)$/i.test(_shared)
    readonly property bool _usingShared: _shared !== "" && FdeLogAnalyzer.report && _norm(FdeLogAnalyzer.report.file) === _norm(_shared)

    // 日誌檢視器開過 .bin、且和目前診斷的檔案不同 → 直接用它分析
    function _useSharedLog() {
        if (!_sharedIsBin || FdeLogAnalyzer.busy || _usingShared) {
            return
        }
        FdeLogAnalyzer.analyze(_shared)
    }
    Component.onCompleted: _useSharedLog()

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // 提示：目前沿用日誌檢視器的檔案（或日誌檢視器開的是本頁不支援的格式）
        QGCLabel {
            objectName: "fdeDiagSharedNote"
            Layout.fillWidth: true
            Layout.leftMargin: root._fw * 1.5
            Layout.rightMargin: root._fw * 1.5
            Layout.topMargin: root._fw
            visible: root._shared !== "" && text !== ""
            wrapMode: Text.WordWrap
            color: root._sharedIsBin ? "#2fb344" : "#ffa94d"
            text: !root._sharedIsBin
                  ? ("「日誌檢視器」開啟的是 " + root._shared.split(/[\\/]/).pop() + "，智能診斷只支援 ArduPilot .bin／.log，請按「開啟日誌（.bin）…」另選檔案。")
                  : (FdeLogAnalyzer.busy ? ("正在分析「日誌檢視器」開啟的檔案：" + root._shared.split(/[\\/]/).pop() + " …")
                     : root._usingShared ? ("● 已沿用「日誌檢視器」開啟的檔案：" + root._shared.split(/[\\/]/).pop() + "（也可按「開啟日誌（.bin）…」另選）")
                     : "")
        }

        // 原日誌分析頁（內容不變）
        FdeLogAnalysisPage {
            Layout.fillWidth: true
            Layout.fillHeight: true
        }
    }
}
