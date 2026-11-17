// FDE-QGC V1.0｜浮動面板三：考照教學（練習步驟提示＋語音播報）
// 內容為教學練習流程，不是官方考題；正式考科以交通部民用航空局最新公告為準。
// 本面板只顯示提示與播報，不會操控飛機。
import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

FdeFloatingPanel {
    id: root
    title: "考照教學"
    panelKey: "licenseTeach"
    icon: "✎"
    defaultShown: false
    defaultRelX: 0.02
    defaultRelY: 0.98

    readonly property var steps: [
        { t: "飛行前檢查", d: "確認電池電量、槳葉鎖緊、GPS 衛星數足夠、飛行模式正確、周邊淨空。" },
        { t: "解鎖與起飛", d: "在教官確認後解鎖，平穩起飛至約 3 公尺高度。" },
        { t: "定點停懸", d: "保持位置與高度穩定，停懸約 10 秒，注意風向修正。" },
        { t: "矩形航線", d: "依序飛行四邊，轉角處停頓並保持機頭方向一致。" },
        { t: "8 字航線", d: "以兩個相切圓飛行 8 字，速度均勻、高度不變。可在『教學工具』產生 8 字仿真任務。" },
        { t: "返航與降落", d: "回到起飛點上方，緩慢下降並平穩著陸，著陸後上鎖。" },
        { t: "飛行後檢查", d: "檢查機體與電池溫度，記錄飛行日誌。" }
    ]

    Settings {
        id: teachStore
        category: "FDE/Teach"
        property int step: 0
        property string voiceLocale: "zh-TW"
    }

    property int step: Math.min(Math.max(teachStore.step, 0), steps.length - 1)
    property string speakResult: ""

    function speakStep() {
        const s = steps[step]
        const ok = FdeSpeech.speak("第" + (step + 1) + "步，" + s.t + "。" + s.d, teachStore.voiceLocale)
        speakResult = ok ? "" : ("此電腦沒有 " + teachStore.voiceLocale + " 語音，無法播報")
    }

    QGCLabel {
        text: "步驟 " + (root.step + 1) + " / " + root.steps.length + "：" + root.steps[root.step].t
        font.bold: true
    }
    QGCLabel {
        text: root.steps[root.step].d
        wrapMode: Text.WordWrap
        Layout.preferredWidth: ScreenTools.defaultFontPixelWidth * 32
    }
    RowLayout {
        spacing: ScreenTools.defaultFontPixelWidth * 0.5
        QGCButton { text: "上一步"; enabled: root.step > 0; onClicked: teachStore.step = root.step - 1 }
        QGCButton { text: "下一步"; enabled: root.step < root.steps.length - 1; onClicked: teachStore.step = root.step + 1 }
        QGCButton { text: "播報"; onClicked: root.speakStep() }
        QGCButton { text: "停止"; onClicked: FdeSpeech.stop() }
    }
    QGCLabel {
        visible: root.speakResult !== ""
        text: root.speakResult
        color: QGroundControl.globalPalette.warningText
        wrapMode: Text.WordWrap
        Layout.preferredWidth: ScreenTools.defaultFontPixelWidth * 32
        font.pointSize: ScreenTools.smallFontPointSize
    }
    QGCLabel {
        text: "※ 教學練習流程，正式考科以民航局公告為準"
        font.pointSize: ScreenTools.smallFontPointSize
        opacity: 0.7
    }
}
