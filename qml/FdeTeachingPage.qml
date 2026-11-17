// FDE-QGC V1.0｜教學工具頁
//  A. WGS84 精確航點：WP1 + 水平距離 + 真北方位角 → WP2（Vincenty），地圖預覽、匯出 .plan、載入到航線規劃
//  B. 8 字教學航線：產生 起飛→8 字→RTL 的 .plan（只給仿真訓練使用，載入後仍需使用者在航線規劃頁自行上傳）
//  C. 三語語音測試：zh-TW／zh-CN／en-US，沒有該語言聲音就標示 BLOCKED，不以其他語言冒充
// 安全：本頁不會自動上傳任務到飛控，也不會解鎖或起飛。
import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts
import QtLocation
import QtPositioning

import QGroundControl
import QGroundControl.Controls
import QGroundControl.FlightMap
import FDE.Tools

Item {
    id: page

    property bool popped: false   // 與 QGC 工具頁介面一致

    FdeWaypointTool { id: tool }

    readonly property real _fw: ScreenTools.defaultFontPixelWidth
    readonly property real _fh: ScreenTools.defaultFontPixelHeight
    property var  _v: QGroundControl.multiVehicleManager.activeVehicle

    // ---- 精確航點狀態 ----
    property var  wp1: QtPositioning.coordinate(25.033964, 121.564468)
    property var  wp2: QtPositioning.coordinate()
    property var  check: ({})
    property string wpError: ""
    property string lastFile: ""
    property string statusText: ""

    function num(field) { return Number(field.text) }

    function recompute() {
        wpError = ""
        const lat = num(latField), lon = num(lonField), d = num(distField), b = num(bearField)
        if ([lat, lon, d, b].some(isNaN)) { wpError = "請輸入數字"; wp2 = QtPositioning.coordinate(); return }
        const r = tool.direct(lat, lon, d, b)
        if (!r.ok) { wpError = r.error; wp2 = QtPositioning.coordinate(); return }
        wp1 = QtPositioning.coordinate(lat, lon)
        wp2 = QtPositioning.coordinate(r.lat, r.lon)
        check = tool.inverse(lat, lon, r.lat, r.lon)
        previewMap.fitTo([wp1, wp2])
    }

    function validateFlightInputs() {
        const alt = num(altField), spd = num(speedField)
        if (isNaN(alt) || alt < 0 || alt > 120) { return "高度需介於 0～120 公尺" }
        if (isNaN(spd) || spd <= 0 || spd > 15) { return "速度需介於 0～15 m/s" }
        return ""
    }

    function exportPlan(path) {
        recompute()
        const err = wpError !== "" ? wpError : validateFlightInputs()
        if (err !== "") { statusText = "無法匯出：" + err; return null }
        const r = tool.savePlan(path, num(latField), num(lonField), num(distField), num(bearField),
                                num(altField), refCombo.currentIndex === 0 ? "relative" : "amsl", num(speedField), num(homeAmslField) || 0)
        statusText = r.ok ? ("已匯出：" + r.path) : ("匯出失敗：" + r.error)
        if (r.ok) { lastFile = r.localPath }
        return r.ok ? r : null
    }

    // 載入到 QGC 原生航線規劃頁（取代目前航線前先確認；不自動上傳）
    function loadIntoPlanView(localPath) {
        const pmc = planView._planMasterController
        const doLoad = function() {
            pmc.loadFromFile(localPath)
            mainWindow.showPlanView()
        }
        if (pmc.dirtyForSave || pmc.containsItems) {
            mainWindow._showMessageDialogWorker(mainWindow, "載入到航線規劃",
                "航線規劃頁目前已有航線，載入會取代它（未存檔的修改會遺失）。要繼續嗎？\n載入後請在航線規劃頁檢查，再自行按「上傳」。",
                Dialog.Yes | Dialog.No, doLoad)
        } else {
            doLoad()
        }
    }

    FileDialog {
        id: saveDialog
        title: "匯出 .plan"
        fileMode: FileDialog.SaveFile
        defaultSuffix: "plan"
        nameFilters: ["QGC 任務檔 (*.plan)"]
        currentFolder: "file:///" + tool.defaultPlanDirectory()
        onAccepted: page.exportPlan(selectedFile.toString())
    }

    QGCPalette { id: pal; colorGroupEnabled: true }

    RowLayout {
        anchors.fill: parent
        anchors.margins: _fw
        spacing: _fw

        // ================= 左：表單 =================
        QGCFlickable {
            Layout.fillHeight: true
            Layout.preferredWidth: _fw * 62
            contentHeight: form.height
            clip: true

            ColumnLayout {
                id: form
                width: parent.width - _fw
                spacing: _fh * 0.4

                // ---------- A. 精確航點 ----------
                QGCLabel { text: "A. WGS84 精確航點（WP1 → WP2）"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
                QGCLabel {
                    text: "輸入 WP1、水平距離與「真北方位角」（0°=北、90°=東），以 WGS84 橢球 Vincenty 公式算出 WP2。方位角是地理方向，不是機頭 Yaw。"
                    wrapMode: Text.WordWrap; Layout.fillWidth: true; font.pointSize: ScreenTools.smallFontPointSize
                }
                GridLayout {
                    columns: 2
                    columnSpacing: _fw
                    rowSpacing: _fh * 0.2
                    Layout.fillWidth: true

                    QGCLabel { text: "WP1 緯度（°）" }
                    QGCTextField { id: latField; objectName: "fdeWp1Lat"; text: "25.033964"; Layout.fillWidth: true; onEditingFinished: page.recompute() }
                    QGCLabel { text: "WP1 經度（°）" }
                    QGCTextField { id: lonField; objectName: "fdeWp1Lon"; text: "121.564468"; Layout.fillWidth: true; onEditingFinished: page.recompute() }
                    QGCLabel { text: "水平距離（m）" }
                    QGCTextField { id: distField; objectName: "fdeDistance"; text: "100"; Layout.fillWidth: true; onEditingFinished: page.recompute() }
                    QGCLabel { text: "真北方位角（°）" }
                    QGCTextField { id: bearField; objectName: "fdeBearing"; text: "37"; Layout.fillWidth: true; onEditingFinished: page.recompute() }
                    QGCLabel { text: "高度（m）" }
                    QGCTextField { id: altField; objectName: "fdeAltitude"; text: "30"; Layout.fillWidth: true }
                    QGCLabel { text: "高度基準" }
                    QGCComboBox { id: refCombo; objectName: "fdeAltRef"; model: ["相對起飛點 Relative", "海拔 AMSL"]; Layout.fillWidth: true }
                    QGCLabel { text: "起飛點海拔（m，AMSL 用）"; visible: refCombo.currentIndex === 1 }
                    QGCTextField { id: homeAmslField; text: "0"; Layout.fillWidth: true; visible: refCombo.currentIndex === 1 }
                    QGCLabel { text: "速度（m/s）" }
                    QGCTextField { id: speedField; objectName: "fdeSpeed"; text: "5"; Layout.fillWidth: true }
                }
                RowLayout {
                    spacing: _fw * 0.5
                    QGCButton { text: "計算 WP2"; primary: true; onClicked: page.recompute() }
                    QGCButton { text: "用目前飛機位置當 WP1"; enabled: !!page._v && page._v.coordinate.isValid
                        onClicked: { latField.text = page._v.coordinate.latitude.toFixed(7); lonField.text = page._v.coordinate.longitude.toFixed(7); page.recompute() } }
                }
                QGCLabel {
                    objectName: "fdeWp2Result"
                    visible: page.wp2.isValid
                    text: page.wp2.isValid ? ("WP2：" + page.wp2.latitude.toFixed(8) + ", " + page.wp2.longitude.toFixed(8)
                                              + "\n反算驗證：距離 " + Number(page.check.distance).toFixed(4) + " m，起始方位 " + Number(page.check.bearing).toFixed(5) + "°") : ""
                    font.bold: true
                }
                QGCLabel { visible: page.wpError !== ""; text: "錯誤：" + page.wpError; color: pal.warningText; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                RowLayout {
                    spacing: _fw * 0.5
                    QGCButton { text: "匯出 .plan（預設資料夾）"; onClicked: page.exportPlan("") }
                    QGCButton { text: "另存新檔…"; onClicked: saveDialog.open() }
                    QGCButton {
                        text: "載入到航線規劃"
                        onClicked: { const r = page.exportPlan(""); if (r) { page.loadIntoPlanView(r.localPath) } }
                    }
                }

                Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }

                // ---------- B. 8 字教學航線 ----------
                QGCLabel { text: "B. 8 字教學航線（仿真訓練用）"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
                QGCLabel {
                    text: "產生：起飛 → 改速 → 中心點 → 西圓順時針 → 東圓逆時針 → 返航（RTL）。請只在『仿真訓練』的 SITL 執行；實機飛行前須由教官檢查。"
                    wrapMode: Text.WordWrap; Layout.fillWidth: true; font.pointSize: ScreenTools.smallFontPointSize
                }
                GridLayout {
                    columns: 2
                    columnSpacing: _fw
                    rowSpacing: _fh * 0.2
                    Layout.fillWidth: true
                    QGCLabel { text: "中心緯度（°）" }
                    QGCTextField { id: f8Lat; text: "-35.3632621"; Layout.fillWidth: true }
                    QGCLabel { text: "中心經度（°）" }
                    QGCTextField { id: f8Lon; text: "149.1652374"; Layout.fillWidth: true }
                    QGCLabel { text: "單圈半徑（m）" }
                    QGCTextField { id: f8Radius; text: "20"; Layout.fillWidth: true }
                    QGCLabel { text: "高度（m，Relative）" }
                    QGCTextField { id: f8Alt; text: "15"; Layout.fillWidth: true }
                    QGCLabel { text: "速度（m/s）" }
                    QGCTextField { id: f8Speed; text: "3"; Layout.fillWidth: true }
                }
                RowLayout {
                    spacing: _fw * 0.5
                    QGCButton { text: "用目前飛機位置當中心"; enabled: !!page._v && page._v.coordinate.isValid
                        onClicked: { f8Lat.text = page._v.coordinate.latitude.toFixed(7); f8Lon.text = page._v.coordinate.longitude.toFixed(7) } }
                    QGCButton {
                        text: "產生並載入到航線規劃"
                        onClicked: {
                            const r = tool.saveFigureEight("", Number(f8Lat.text), Number(f8Lon.text), Number(f8Radius.text), Number(f8Alt.text), Number(f8Speed.text), 12)
                            page.statusText = r.ok ? ("8 字航線已產生：" + r.path) : ("無法產生：" + r.error)
                            if (r.ok) { page.loadIntoPlanView(r.localPath) }
                        }
                    }
                }

                Rectangle { Layout.fillWidth: true; height: 1; color: pal.text; opacity: 0.25 }

                // ---------- C. 三語語音 ----------
                QGCLabel { text: "C. 三語語音播報測試（引擎：" + FdeSpeech.engine + "）"; font.bold: true; font.pointSize: ScreenTools.mediumFontPointSize }
                Repeater {
                    id: voiceRows
                    model: FdeSpeech.status()
                    QGCLabel {
                        objectName: "fdeVoice_" + modelData.locale
                        text: modelData.locale + "：" + (modelData.available ? (modelData.voice + "（" + modelData.gender + "）— " + modelData.note) : modelData.note)
                        color: modelData.available ? pal.text : pal.warningText
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                }
                RowLayout {
                    spacing: _fw * 0.5
                    QGCComboBox { id: ttsLocale; model: ["zh-TW", "zh-CN", "en-US"] }
                    QGCTextField { id: ttsText; text: "FDE 地面站語音測試"; Layout.fillWidth: true }
                }
                RowLayout {
                    spacing: _fw * 0.5
                    QGCButton {
                        text: "播放"
                        onClicked: {
                            const ok = FdeSpeech.speak(ttsText.text, ttsLocale.currentText)
                            page.statusText = ok ? ("播放中（" + ttsLocale.currentText + "）") : ("BLOCKED：此電腦沒有 " + ttsLocale.currentText + " 語音")
                        }
                    }
                    QGCButton { text: "停止"; onClicked: FdeSpeech.stop() }
                    QGCButton {
                        text: "範例句"
                        onClicked: ttsText.text = ttsLocale.currentIndex === 0 ? "請注意，電量剩餘百分之三十，準備返航。"
                                               : (ttsLocale.currentIndex === 1 ? "请注意，电量剩余百分之三十，准备返航。" : "Attention. Battery at thirty percent. Prepare to return.")
                    }
                }

                QGCLabel {
                    objectName: "fdeTeachStatus"
                    visible: page.statusText !== ""
                    text: page.statusText
                    wrapMode: Text.WrapAnywhere
                    Layout.fillWidth: true
                    color: pal.colorGreen
                }
            }
        }

        // ================= 右：地圖預覽 =================
        FlightMap {
            id: previewMap
            Layout.fillWidth: true
            Layout.fillHeight: true
            mapName: "FdeTeachingPreview"
            center: page.wp1
            zoomLevel: 17

            function fitTo(coords) {
                const valid = coords.filter(c => c && c.isValid)
                if (valid.length === 0) { return }
                if (valid.length === 1) { center = valid[0]; return }
                let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180
                valid.forEach(c => { minLat = Math.min(minLat, c.latitude); maxLat = Math.max(maxLat, c.latitude); minLon = Math.min(minLon, c.longitude); maxLon = Math.max(maxLon, c.longitude) })
                const padLat = Math.max((maxLat - minLat) * 0.3, 0.0003), padLon = Math.max((maxLon - minLon) * 0.3, 0.0003)
                setVisibleRegion(QtPositioning.rectangle(QtPositioning.coordinate(maxLat + padLat, minLon - padLon), QtPositioning.coordinate(minLat - padLat, maxLon + padLon)))
            }

            MapPolyline {
                visible: page.wp2.isValid
                line.width: 3
                line.color: "#ffd43b"
                path: page.wp2.isValid ? [page.wp1, page.wp2] : []
            }

            component Pin: MapQuickItem {
                property string label
                property color pinColor
                anchorPoint.x: dot.width / 2
                anchorPoint.y: dot.height / 2
                sourceItem: Rectangle {
                    id: dot
                    width: ScreenTools.defaultFontPixelHeight * 1.6
                    height: width
                    radius: width / 2
                    color: pinColor
                    border.color: "white"
                    border.width: 2
                    QGCLabel { anchors.centerIn: parent; text: label; color: "white"; font.bold: true; font.pointSize: ScreenTools.smallFontPointSize }
                }
            }
            Pin { coordinate: page.wp1; label: "1"; pinColor: "#1f6feb" }
            Pin { coordinate: page.wp2; label: "2"; pinColor: "#e8590c"; visible: page.wp2.isValid }
        }
    }

    Component.onCompleted: recompute()
}
