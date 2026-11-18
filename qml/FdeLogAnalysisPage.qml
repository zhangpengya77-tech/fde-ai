// FDE-QGC V1.0｜日誌分析頁（2026-11-18 起放在「日誌 → 智能診斷」子項，由 FdeLogDiagnosePage 包裝）：開啟 ArduPilot DataFlash（.bin）→ 規則式診斷 → 圖表 → 前往 AI 調參
// 解析使用 QGC 官方解析器；所有計算在本機完成，不上傳資料。
import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

Item {
    id: page
    property bool popped: false

    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight
    readonly property var  rep: FdeLogAnalyzer.report
    readonly property bool hasReport: rep && rep.ok === true

    function levelColor(lv) { return lv === "bad" ? "#e03131" : (lv === "warn" ? "#f59f00" : (lv === "ok" ? "#2f9e44" : "#868e96")) }
    function levelText(lv)  { return lv === "bad" ? "🔴 需處理" : (lv === "warn" ? "🟡 注意" : (lv === "ok" ? "🟢 良好" : "ℹ 資訊")) }

    // 圖表選項：[標題, 欄位1(期望/X), 欄位2(實際/Y), 欄位3]
    readonly property var chartOptions: [
        { t: "橫滾角：期望 vs 實際（°）", f: ["ATT.DesRoll", "ATT.Roll"] },
        { t: "俯仰角：期望 vs 實際（°）", f: ["ATT.DesPitch", "ATT.Pitch"] },
        { t: "橫滾角速度：期望 vs 實際（°/s）", f: ["RATE.RDes", "RATE.R"] },
        { t: "俯仰角速度：期望 vs 實際（°/s）", f: ["RATE.PDes", "RATE.P"] },
        { t: "振動 X / Y / Z（m/s²）", f: ["VIBE.VibeX", "VIBE.VibeY", "VIBE.VibeZ"] },
        { t: "電池電壓（V）", f: ["BAT.Volt"] }
    ]
    readonly property var seriesColors: ["#4dabf7", "#ff6b6b", "#51cf66"]

    FileDialog {
        id: openDialog
        title: "開啟 ArduPilot 飛行日誌（.bin）"
        nameFilters: ["ArduPilot 日誌 (*.bin *.BIN *.log)", "所有檔案 (*)"]
        onAccepted: FdeLogAnalyzer.analyze(selectedFile.toString())
    }

    Connections {
        target: FdeLogAnalyzer
        function onReportChanged() { chart.requestPaint() }
    }

    QGCPalette { id: pal; colorGroupEnabled: true }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: _fw * 1.5
        spacing: _fh * 0.5

        RowLayout {
            spacing: _fw
            QGCLabel { text: "智能診斷"; font.bold: true; font.pointSize: ScreenTools.largeFontPointSize }
            QGCButton { text: "開啟日誌（.bin）…"; primary: true; enabled: !FdeLogAnalyzer.busy; onClicked: openDialog.open() }
            QGCButton {
                text: "前往 AI 調參 →"
                enabled: page.hasReport
                // 經左側導覽切換，讓「AI 調參」高亮
                onClicked: mainWindow.fdeActivateNav("tune")
            }
            BusyIndicator { running: FdeLogAnalyzer.busy; visible: running; Layout.preferredHeight: _fh * 1.6; Layout.preferredWidth: _fh * 1.6 }
            QGCLabel { visible: FdeLogAnalyzer.busy; text: "分析中…（大型日誌約需數十秒）" }
            Item { Layout.fillWidth: true }
        }
        QGCLabel {
            text: "從飛控 SD 卡或「日誌 → 機載日誌」取得 .bin 檔。分析為離線規則式診斷（依 ArduPilot 官方調參指引），結果僅供教學參考，不會改動飛控。"
            wrapMode: Text.WordWrap; Layout.fillWidth: true; font.pointSize: ScreenTools.smallFontPointSize; opacity: 0.8
        }
        QGCLabel {
            visible: rep && rep.ok === false
            text: rep && rep.error ? ("無法分析：" + rep.error) : ""
            color: pal.warningText; wrapMode: Text.WordWrap; Layout.fillWidth: true
        }

        // 總結列
        Rectangle {
            visible: page.hasReport
            Layout.fillWidth: true
            implicitHeight: sumRow.implicitHeight + _fh * 0.6
            radius: _fw * 0.5
            color: Qt.rgba(0, 0, 0, 0.15)
            border.color: page.levelColor(page.hasReport ? rep.overall : "")
            RowLayout {
                id: sumRow
                anchors.fill: parent
                anchors.margins: _fh * 0.3
                spacing: _fw * 2
                QGCLabel { objectName: "fdeLogOverall"; text: page.hasReport ? page.levelText(rep.overall) : ""; font.bold: true; color: page.levelColor(page.hasReport ? rep.overall : "") }
                QGCLabel { text: page.hasReport ? ("檔案：" + rep.fileName) : "" }
                QGCLabel { text: page.hasReport ? ("機型：" + (rep.vehicle || "未知") + (rep.firmware ? (" " + rep.firmware) : "")) : "" }
                QGCLabel { text: page.hasReport ? ("時長：" + Math.round(rep.metrics.durationSec || 0) + " 秒") : "" }
                QGCLabel { text: page.hasReport ? ("需處理 " + rep.badCount + "、注意 " + rep.warnCount) : "" }
                Item { Layout.fillWidth: true }
            }
        }

        RowLayout {
            visible: page.hasReport
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: _fw

            // 診斷清單
            QGCFlickable {
                Layout.fillHeight: true
                Layout.preferredWidth: parent.width * 0.48
                contentHeight: findCol.height
                clip: true
                Column {
                    id: findCol
                    width: parent.width
                    spacing: _fh * 0.3
                    Repeater {
                        model: page.hasReport ? rep.findings : []
                        Rectangle {
                            width: findCol.width
                            height: fc.implicitHeight + _fh * 0.6
                            radius: _fw * 0.5
                            color: Qt.rgba(0, 0, 0, 0.12)
                            Rectangle { width: _fw * 0.5; height: parent.height; radius: 2; color: page.levelColor(modelData.level) }
                            ColumnLayout {
                                id: fc
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.top: parent.top
                                anchors.margins: _fh * 0.3
                                anchors.leftMargin: _fw * 1.2
                                spacing: 2
                                QGCLabel { text: "【" + modelData.area + "】" + modelData.title + "　" + page.levelText(modelData.level); font.bold: true; color: page.levelColor(modelData.level); wrapMode: Text.WordWrap; Layout.fillWidth: true }
                                QGCLabel { visible: modelData.detail !== ""; text: modelData.detail; wrapMode: Text.WordWrap; Layout.fillWidth: true; font.pointSize: ScreenTools.smallFontPointSize }
                                QGCLabel { visible: modelData.level !== "ok"; text: "建議：" + modelData.advice; wrapMode: Text.WordWrap; Layout.fillWidth: true; font.pointSize: ScreenTools.smallFontPointSize }
                            }
                        }
                    }
                }
            }

            // 圖表
            ColumnLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                QGCComboBox {
                    id: chartSel
                    Layout.fillWidth: true
                    model: page.chartOptions.map(o => o.t)
                    onCurrentIndexChanged: chart.requestPaint()
                }
                Canvas {
                    id: chart
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    onWidthChanged: requestPaint()
                    onHeightChanged: requestPaint()
                    onPaint: {
                        const ctx = getContext("2d")
                        ctx.reset()
                        ctx.fillStyle = "#11161c"
                        ctx.fillRect(0, 0, width, height)
                        if (!page.hasReport) { return }
                        const opt = page.chartOptions[Math.max(0, chartSel.currentIndex)]
                        const data = opt.f.map(f => FdeLogAnalyzer.series(f, Math.max(100, Math.floor(width))))
                        let xmax = 0, ymin = Infinity, ymax = -Infinity
                        data.forEach(s => s.forEach(p => { xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y) }))
                        if (!isFinite(ymin) || xmax <= 0) {
                            ctx.fillStyle = "#adb5bd"; ctx.font = "14px sans-serif"; ctx.fillText("此日誌沒有這組資料", 12, 24); return
                        }
                        if (ymax - ymin < 1e-6) { ymax += 1; ymin -= 1 }
                        const padL = 48, padB = 22, padT = 10, padR = 10
                        const W = width - padL - padR, H = height - padT - padB
                        const X = x => padL + x / xmax * W
                        const Y = y => padT + (ymax - y) / (ymax - ymin) * H
                        // 格線與刻度
                        ctx.strokeStyle = "#2b3440"; ctx.lineWidth = 1; ctx.fillStyle = "#adb5bd"; ctx.font = "11px sans-serif"
                        for (let i = 0; i <= 4; i++) {
                            const yv = ymin + (ymax - ymin) * i / 4, yy = Y(yv)
                            ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(width - padR, yy); ctx.stroke()
                            ctx.fillText(yv.toFixed(1), 4, yy + 4)
                        }
                        ctx.fillText("0 s", padL, height - 6); ctx.fillText(Math.round(xmax) + " s", width - padR - 40, height - 6)
                        data.forEach((s, k) => {
                            ctx.strokeStyle = page.seriesColors[k]; ctx.lineWidth = 1.5; ctx.beginPath()
                            s.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y)) })
                            ctx.stroke()
                            ctx.fillStyle = page.seriesColors[k]; ctx.fillText(opt.f[k], padL + 8 + k * 120, padT + 12)
                        })
                    }
                }
            }
        }

        Item { visible: !page.hasReport; Layout.fillHeight: true; Layout.fillWidth: true }
    }
}
