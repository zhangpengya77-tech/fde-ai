// FDE-QGC V1.0｜AI 調參助理（離線規則式）
// 依「日誌 → 智能診斷」結果＋已連線飛控目前參數，產生 ArduPilot 參數建議。
// 寫入保護：必須 已連線＋參數下載完成＋未解鎖，且每一筆都要使用者確認；寫入前先把舊值備份到
// 文件\FDE-QGC\Tuning\param-backup.csv，可一鍵還原最近一次修改。不會自動寫入、不會切換飛行模式。
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import QGroundControl.FactControls
import FDE.Tools

Item {
    id: page
    property bool popped: false

    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight
    readonly property var  _v: QGroundControl.multiVehicleManager.activeVehicle
    readonly property bool _paramsReady: !!_v && _v.parameterManager.parametersReady
    readonly property bool _canWrite: _paramsReady && !_v.armed
    readonly property var  rep: FdeLogAnalyzer.report
    readonly property bool hasReport: rep && rep.ok === true

    // 建議規則會用到的參數
    readonly property var watchParams: ["ATC_RAT_RLL_P", "ATC_RAT_RLL_D", "ATC_RAT_PIT_P", "ATC_RAT_PIT_D", "MOT_THST_HOVER", "MOT_HOVER_LEARN",
        "INS_HNTCH_ENABLE", "INS_HNTCH_MODE", "INS_HNTCH_REF", "BATT_FS_LOW_ACT", "BATT_LOW_VOLT", "BATT_CRT_VOLT", "BATT_FS_CRT_ACT", "FENCE_ENABLE"]

    property var  suggestions: []
    property var  current: ({})
    property var  logValues: ({})
    property string status: ""
    property var  last: FdeLogAnalyzer.lastBackup()

    // 參數控制器需綁定目前飛控；飛控變更時重新建立
    Loader {
        id: ctlLoader
        active: page._paramsReady
        sourceComponent: Component { FactPanelController { } }
        onLoaded: page.recompute()
    }
    function ctl() { return ctlLoader.item }

    function paramFact(name) {
        const c = ctl()
        return c && c.parameterExists(-1, name) ? c.getParameterFact(-1, name, false) : null
    }

    function recompute() {
        const cur = {}
        if (ctl()) {
            watchParams.forEach(n => { const f = paramFact(n); if (f) { cur[n] = f.rawValue } })
        }
        // 未連線時，「目前值」顯示日誌記錄的參數值（僅供參考，不能寫入）
        logValues = {}
        if (hasReport && rep.logParams) {
            watchParams.forEach(n => { if (rep.logParams[n] !== undefined) { logValues[n] = rep.logParams[n] } })
        }
        current = cur
        suggestions = FdeLogAnalyzer.suggestionsFor(cur)
        last = FdeLogAnalyzer.lastBackup()
    }

    function fmt(v) { return (v === undefined || v === null || v === "") ? "--" : (typeof v === "number" ? +v.toFixed(5) : v) }

    function writeParam(name, newValue, reason) {
        const f = paramFact(name)
        if (!f) { status = "飛控沒有參數 " + name; return }
        if (!_canWrite) { status = "只能在已連線、參數下載完成、且「未解鎖」時寫入"; return }
        const oldValue = f.rawValue
        mainWindow._showMessageDialogWorker(mainWindow, "寫入參數確認",
            "參數：" + name + "\n目前值：" + fmt(oldValue) + "\n新值：" + fmt(newValue) + "\n理由：" + reason
            + "\n\n寫入前會自動備份舊值，可在本頁一鍵還原。確定寫入飛控？",
            Dialog.Yes | Dialog.No,
            function() {
                const path = FdeLogAnalyzer.backupParam(name, oldValue, newValue, reason)
                if (path === "") { page.status = "備份失敗，已取消寫入"; return }
                f.rawValue = newValue
                page.status = "已寫入 " + name + " = " + fmt(newValue) + "（舊值 " + fmt(oldValue) + " 已備份：" + path + "）"
                Qt.callLater(page.recompute)
            })
    }

    function restoreLast() {
        const b = FdeLogAnalyzer.lastBackup()
        if (!b.ok) { status = "沒有可還原的備份"; return }
        const f = paramFact(b.name)
        if (!f || !_canWrite) { status = "需連線同一架飛控且未解鎖才能還原"; return }
        mainWindow._showMessageDialogWorker(mainWindow, "還原參數",
            "把 " + b.name + " 從 " + fmt(f.rawValue) + " 還原為 " + fmt(b.oldValue) + "？",
            Dialog.Yes | Dialog.No,
            function() {
                f.rawValue = b.oldValue
                FdeLogAnalyzer.markLastRestored()
                page.status = "已還原 " + b.name + " = " + fmt(b.oldValue)
                Qt.callLater(page.recompute)
            })
    }

    Component.onCompleted: recompute()
    Connections { target: FdeLogAnalyzer; function onReportChanged() { page.recompute() } }
    on_ParamsReadyChanged: Qt.callLater(recompute)

    QGCPalette { id: pal; colorGroupEnabled: true }

    QGCFlickable {
        anchors.fill: parent
        anchors.margins: _fw * 1.5
        contentHeight: col.height
        clip: true

        ColumnLayout {
            id: col
            width: Math.min(parent.width, _fw * 130)
            spacing: _fh * 0.5

            QGCLabel { text: "AI 調參助理"; font.bold: true; font.pointSize: ScreenTools.largeFontPointSize }
            QGCLabel {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pointSize: ScreenTools.smallFontPointSize; opacity: 0.85
                text: "離線規則式專家系統（依 ArduPilot Copter 官方調參指引），不是雲端或大型語言模型，不上傳任何資料。"
                    + "原則：振動合格前不調高 PID；響應偏慢優先用官方 AutoTune；振盪時才降低 P／D。所有建議需教官確認後才寫入。"
            }

            // 狀態
            GridLayout {
                columns: 2
                columnSpacing: _fw * 2
                QGCLabel { text: "日誌來源" }
                QGCLabel { text: page.hasReport ? (rep.fileName + "（" + (rep.overall === "bad" ? "有需處理項目" : (rep.overall === "warn" ? "有注意項目" : "良好")) + "）") : "尚未分析日誌（只會給安全設定類建議）"; font.bold: true }
                QGCLabel { text: "飛控" }
                QGCLabel {
                    text: !page._v ? "未連線（只能查看建議，不能寫入）" : (!page._paramsReady ? "參數下載中…" : (page._v.armed ? "已解鎖：禁止寫入參數" : "已連線、未解鎖：可寫入"))
                    color: page._canWrite ? pal.colorGreen : pal.warningText
                    font.bold: true
                }
            }
            RowLayout {
                spacing: _fw
                QGCButton { text: "重新產生建議"; onClicked: page.recompute() }
                QGCButton {
                    text: "前往智能診斷"
                    // 導覽精簡：原「日誌分析」頁已併入「日誌 → 智能診斷」
                    onClicked: mainWindow.fdeShowAnalyzeSubPage("智能診斷")
                }
                QGCButton {
                    text: page.last.ok ? ("還原上次修改（" + page.last.name + "）") : "還原上次修改"
                    enabled: page.last.ok && page._canWrite
                    onClicked: page.restoreLast()
                }
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }

            QGCLabel { text: "參數建議（" + page.suggestions.length + "）"; font.bold: true }
            QGCLabel {
                visible: page.suggestions.length === 0
                text: page.hasReport ? "目前沒有需要調整的參數。響應若仍不理想，請改用官方 AutoTune。" : "請先到「日誌 → 智能診斷」開啟一份飛行日誌，或連線飛控。"
                wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
            Repeater {
                model: page.suggestions
                Rectangle {
                    id: sugCard
                    Layout.fillWidth: true
                    implicitHeight: srow.implicitHeight + _fh * 0.6
                    radius: _fw * 0.5
                    color: Qt.rgba(0, 0, 0, 0.12)
                    readonly property var cur: page.current[modelData.param]
                    readonly property var shown: cur !== undefined ? cur : page.logValues[modelData.param]
                    RowLayout {
                        id: srow
                        anchors.fill: parent
                        anchors.margins: _fh * 0.3
                        spacing: _fw
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            QGCLabel {
                                text: modelData.param + "：" + page.fmt(sugCard.shown) + (sugCard.cur === undefined && sugCard.shown !== undefined ? "（日誌值）" : "") + " → " + page.fmt(modelData.suggested) + (modelData.needsCheck ? "　（需實測確認）" : "")
                                font.bold: true
                                color: modelData.level === "bad" ? "#e03131" : (modelData.level === "warn" ? "#f59f00" : pal.text)
                            }
                            QGCLabel { text: modelData.reason; wrapMode: Text.WordWrap; Layout.fillWidth: true; font.pointSize: ScreenTools.smallFontPointSize }
                        }
                        QGCButton {
                            text: "寫入飛控…"
                            enabled: page._canWrite && sugCard.cur !== undefined
                            onClicked: page.writeParam(modelData.param, modelData.suggested, modelData.reason)
                        }
                    }
                }
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }

            QGCLabel { text: "官方 AutoTune（自動調參）步驟"; font.bold: true }
            QGCLabel {
                Layout.fillWidth: true; wrapMode: Text.WordWrap
                text: "1. 先確認智能診斷的「振動」為良好。\n"
                    + "2. 在「飛控設定 → 飛行模式」把一個開關位置設為 AUTOTUNE。\n"
                    + "3. 無風空曠處以 AltHold 起飛，切到 AUTOTUNE，飛機會自行擺動數分鐘；過程中可隨時切回原模式中止。\n"
                    + "4. 完成後在 AUTOTUNE 模式下降落上鎖即保存；再飛一次並重新做智能診斷確認。\n"
                    + "（本程式不會自動切換到 AUTOTUNE，必須由操作者在現場執行。）"
            }

            QGCLabel {
                visible: page.status !== ""
                text: page.status
                wrapMode: Text.WrapAnywhere
                Layout.fillWidth: true
                color: pal.colorGreen
            }
        }
    }
}
