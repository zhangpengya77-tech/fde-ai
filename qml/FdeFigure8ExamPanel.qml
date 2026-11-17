// FDE-QGC V2｜浮動面板：八字飛行考核（訓練輔助評分；不能取代民航局正式考試）
// 使用方式：先把飛機停在八字中心交叉點、機頭沿切線方向（前進方向），按「開始八字飛行」記錄；
//           左右兩圈的圓心在機頭方向的左右兩側各 R 公尺處，兩圈都通過交叉點。
// 評分項目（每 0.5 秒取樣一次，只在「已解鎖且離地 1 m 以上」時取樣）：
//   軌跡偏差＝與最近圓的距離差（容許 ±tol）、高度偏差＝與目標高度差（容許 ±altTol）、
//   速度合格率＝地速在 [vMin, vMax] 的比例、航向偏差＝機頭與該點切線的夾角（容許 ≤ hdgTol）、
//   左右環完成＝繞該圓心累計角度 ≥ 330°、用時 ≤ 時限。
// 本面板只讀遙測、不送任何指令。
import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtPositioning

import QGroundControl
import QGroundControl.Controls
import FDE.Tools

FdeFloatingPanel {
    id: root
    title: "八字飛行考核"
    icon: "∞"
    panelKey: "figure8Exam"
    defaultShown: false
    defaultRelX: 0.02
    defaultRelY: 0.30
    headerNote: running ? ("計時 " + Math.round(elapsed) + " s") : ""
    footerNote: "訓練輔助評分，不能取代民航局正式考試"

    property var _v: QGroundControl.multiVehicleManager.activeVehicle

    // ---- 評分標準（可調，記憶在 QSettings）----
    Settings {
        id: cfg
        category: "FDE/Figure8Exam"
        property real radius: 6          // 標準圓半徑（直徑 12 m）
        property real tol: 2             // 軌跡容許偏差 ±2 m（內圈 R-2、外圈 R+2）
        property real altTol: 1          // 高度容許 ±1 m
        property real vMin: 0.3          // 速度下限 m/s
        property real vMax: 3            // 速度上限 m/s
        property real hdgTol: 30         // 航向偏差上限（度）
        property real timeLimit: 180     // 時限（秒）
        property int  judgeMode: 0       // 0＝合格制、1＝計分制
    }

    // ---- 考核狀態 ----
    property bool running: false
    property bool finished: false
    property var  center: QtPositioning.coordinate()
    property real axisHdg: 0             // 開始時的機頭方向＝前進軸
    property real targetAlt: NaN         // 目標高度（相對高度）
    property real elapsed: 0
    property real _tStart: 0
    property bool _reached: false      // 是否已到達目標高度（到達後才開始計分）
    property var  track: []              // 考核座標系 [x, y]（x 向右、y 向前，單位 m）
    property var  st: ({})               // 統計值

    function resetStats() {
        st = { n: 0, devSum: 0, devMax: 0, inBand: 0, altMax: 0, hdgSum: 0, spdOk: 0, dist: 0,
               angL: 0, angR: 0, lastAngL: NaN, lastAngR: NaN, lastX: NaN, lastY: NaN }
        track = []
        elapsed = 0
    }
    Component.onCompleted: resetStats()

    // 開始：以目前位置為交叉點、目前機頭方向為前進軸（selftest 可指定軸向與目標高度）
    function start(axis, alt) {
        if (!_v || !_v.coordinate.isValid) { return }
        resetStats()
        center = _v.coordinate
        axisHdg = (axis !== undefined && !isNaN(axis)) ? axis : _v.heading.rawValue
        targetAlt = (alt !== undefined && !isNaN(alt)) ? alt : (_v.altitudeRelative.rawValue > 1 ? _v.altitudeRelative.rawValue : NaN)
        _tStart = 0
        _reached = false
        finished = false
        running = true
    }
    function stop() { running = false; finished = st.n > 0; reportSelfTest() }
    function resetAll() { running = false; finished = false; resetStats() }

    // 地理座標 → 考核座標系
    function toLocal(c) {
        const d = center.distanceTo(c)
        const az = center.azimuthTo(c) * Math.PI / 180
        const e = d * Math.sin(az), n = d * Math.cos(az)
        const h = axisHdg * Math.PI / 180
        return [e * Math.cos(h) - n * Math.sin(h), e * Math.sin(h) + n * Math.cos(h)]
    }
    function wrap180(a) { a = (a + 540) % 360 - 180; return a }

    // ---- 取樣 ----
    Timer {
        interval: 500; repeat: true; running: root.running
        onTriggered: root.sample()
    }
    function sample() {
        if (!_v || !_v.armed || isNaN(_v.altitudeRelative.rawValue) || _v.altitudeRelative.rawValue < 1) { return }
        // 尚未到達目標高度（例如從地面開始記錄、仍在爬升）時不計分，避免把起飛爬升算成高度偏差
        if (!isNaN(targetAlt) && !_reached) {
            if (Math.abs(_v.altitudeRelative.rawValue - targetAlt) > cfg.altTol) { return }
            _reached = true
        }
        const now = Date.now() / 1000
        if (_tStart === 0) { _tStart = now }
        elapsed = now - _tStart
        if (isNaN(targetAlt)) { targetAlt = _v.altitudeRelative.rawValue }
        const R = cfg.radius
        const p = toLocal(_v.coordinate)
        const x = p[0], y = p[1]
        const dL = Math.hypot(x + R, y), dR = Math.hypot(x - R, y)
        const left = dL < dR
        const dev = Math.abs((left ? dL : dR) - R)
        const s = Object.assign({}, st)
        s.n++; s.devSum += dev; s.devMax = Math.max(s.devMax, dev); if (dev <= cfg.tol) { s.inBand++ }
        s.altMax = Math.max(s.altMax, Math.abs(_v.altitudeRelative.rawValue - targetAlt))
        const gs = _v.groundSpeed.rawValue
        if (gs >= cfg.vMin && gs <= cfg.vMax) { s.spdOk++ }
        // 航向偏差：機頭方向與該點切線（垂直於半徑）的夾角，不分順逆時針
        const cx = left ? -R : R
        const radialAng = Math.atan2(x - cx, y) * 180 / Math.PI           // 由圓心指向飛機（考核座標，以 y 為 0°）
        const tangentHdg = axisHdg + radialAng + 90
        let a = Math.abs(wrap180(_v.heading.rawValue - tangentHdg)) % 180
        s.hdgSum += Math.min(a, 180 - a)
        // 繞圈角度累計（只在靠近該圓時累計）
        const ang = Math.atan2(x - cx, y) * 180 / Math.PI
        if (left) { if (!isNaN(s.lastAngL)) { s.angL += wrap180(ang - s.lastAngL) }; s.lastAngL = ang; s.lastAngR = NaN }
        else      { if (!isNaN(s.lastAngR)) { s.angR += wrap180(ang - s.lastAngR) }; s.lastAngR = ang; s.lastAngL = NaN }
        if (!isNaN(s.lastX)) { s.dist += Math.hypot(x - s.lastX, y - s.lastY) }
        s.lastX = x; s.lastY = y
        // 重新指定新物件／新陣列，畫面綁定才會更新（同一個參考不會觸發通知）
        st = Object.assign({}, s)
        const t = track.slice(); t.push([x, y]); track = t
        canvas.requestPaint()
        // 自動結束：兩圈都完成且回到交叉點附近，或超過時限
        if ((Math.abs(s.angL) >= 330 && Math.abs(s.angR) >= 330 && Math.hypot(x, y) <= cfg.tol) || elapsed > cfg.timeLimit) {
            stop()
        }
    }

    // ---- 結果 ----
    readonly property real avgDev: st.n ? st.devSum / st.n : NaN
    readonly property real avgHdg: st.n ? st.hdgSum / st.n : NaN
    readonly property real spdRate: st.n ? st.spdOk / st.n * 100 : NaN
    readonly property bool loopL: Math.abs(st.angL || 0) >= 330
    readonly property bool loopR: Math.abs(st.angR || 0) >= 330
    readonly property var  checks: [
        { k: "軌跡偏差", ok: avgDev <= cfg.tol },
        { k: "高度偏差", ok: st.altMax <= cfg.altTol },
        { k: "航向偏差", ok: avgHdg <= cfg.hdgTol },
        { k: "速度合格率", ok: spdRate >= 80 },
        { k: "用時", ok: elapsed <= cfg.timeLimit },
        { k: "左右環完成", ok: loopL && loopR }
    ]
    // 計分制：滿分 100，每項不合格扣分（軌跡 30、高度 20、航向 15、速度 15、時間 10、完成 10）
    readonly property int score: {
        if (!st.n) { return 0 }
        const w = [30, 20, 15, 15, 10, 10]
        let sc = 100
        checks.forEach((c, i) => { if (!c.ok) { sc -= w[i] } })
        return sc
    }
    // 記錄中只顯示「評分中」，結束後才給判定，避免學員飛到一半看到「不合格」
    readonly property string verdict: !st.n ? "--" : running ? "評分中" : (cfg.judgeMode === 0 ? (checks.every(c => c.ok) ? "合格" : "不合格") : (score + " 分"))

    function fmt(v, d) { return (v === undefined || isNaN(v)) ? "--" : Number(v).toFixed(d) }

    // 自我測試時把結果寫入紀錄
    function reportSelfTest() {
        if (FdeSelfTest.pages.length === 0) { return }
        FdeSelfTest.log("exam result verdict=" + verdict + " score=" + score + " samples=" + st.n + " avgDev=" + fmt(avgDev, 2) + " maxDev=" + fmt(st.devMax, 2)
                        + " inBand=" + fmt(st.n ? st.inBand / st.n * 100 : NaN, 0) + "% altMax=" + fmt(st.altMax, 2) + " avgHdg=" + fmt(avgHdg, 1)
                        + " spdRate=" + fmt(spdRate, 0) + "% dist=" + fmt(st.dist, 1) + " time=" + fmt(elapsed, 1) + " loopL=" + loopL + "(" + fmt(st.angL, 0) + ") loopR=" + loopR + "(" + fmt(st.angR, 0) + ")")
    }
    Connections {
        target: FdeSelfTest
        function onCommandIssued(command) {
            const p = command.split(":")
            if (p[0] !== "exam") { return }
            if (p[1] === "show") { root.setShown(true) }
            else if (p[1] === "radius") { cfg.radius = Number(p[2]) }
            else if (p[1] === "start") { root.start(Number(p[2]), Number(p[3])) }
            else if (p[1] === "stop") { root.stop() }
            else if (p[1] === "report") { root.reportSelfTest() }
        }
    }

    // ---- 版面 ----
    RowLayout {
        spacing: _fw * 0.6
        QGCLabel { text: "判定方式"; color: "#adb5bd" }
        QGCComboBox { model: ["合格制", "計分制"]; currentIndex: cfg.judgeMode; onActivated: (i) => cfg.judgeMode = i; Layout.preferredWidth: _fw * 11 }
        QGCLabel { text: "半徑"; color: "#adb5bd" }
        QGCTextField { text: cfg.radius; Layout.preferredWidth: _fw * 5; enabled: !root.running; onEditingFinished: { const v = Number(text); if (v >= 3 && v <= 50) { cfg.radius = v; canvas.requestPaint() } else { text = cfg.radius } } }
        QGCLabel { text: "m　容許 ±"; color: "#adb5bd" }
        QGCTextField { text: cfg.tol; Layout.preferredWidth: _fw * 4; enabled: !root.running; onEditingFinished: { const v = Number(text); if (v > 0 && v <= 10) { cfg.tol = v; canvas.requestPaint() } else { text = cfg.tol } } }
        QGCLabel { text: "m　" + Math.round(root.elapsed) + " / " + cfg.timeLimit + " s"; color: "white" }
    }
    QGCLabel {
        Layout.preferredWidth: _fw * 62
        wrapMode: Text.WordWrap
        font.pointSize: ScreenTools.smallFontPointSize
        color: "#adb5bd"
        text: "先將飛機置於八字中心交叉點、機頭沿切線方向，再按「開始八字飛行」。標準直徑 " + (cfg.radius * 2) + " m（半徑 " + cfg.radius + " m），"
            + "綠色帶為允許範圍（內圈 " + (cfg.radius - cfg.tol) + " m、外圈 " + (cfg.radius + cfg.tol) + " m）；紅線為實際航跡。"
            + "參考：時限 " + cfg.timeLimit + " s、高度 ±" + cfg.altTol + " m、速度 " + cfg.vMin + "～" + cfg.vMax + " m/s、航向偏差 ≤" + cfg.hdgTol + "°。"
    }

    // 八字軌跡圖：考核座標系（x 右、y 前，前方朝畫面上方）
    Canvas {
        id: canvas
        Layout.preferredWidth: _fw * 62
        Layout.preferredHeight: _fw * 34
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            ctx.fillStyle = "#1a2530"; ctx.fillRect(0, 0, width, height)
            const R = cfg.radius, tol = cfg.tol
            const k = Math.min(width / (4 * R + 2 * tol + 2), height / (2 * R + 2 * tol + 2))   // 像素／公尺
            const ox = width / 2, oy = height / 2
            const P = (x, y) => [ox + x * k, oy - y * k]
            ;[-R, R].forEach(cx => {
                const c = P(cx, 0)
                // 允許範圍帶（外圈到內圈）
                ctx.beginPath(); ctx.arc(c[0], c[1], (R + tol) * k, 0, Math.PI * 2); ctx.arc(c[0], c[1], Math.max(0, R - tol) * k, 0, Math.PI * 2, true)
                ctx.fillStyle = "rgba(81,207,102,0.18)"; ctx.fill()
                ctx.strokeStyle = "#4dabf7"; ctx.lineWidth = 3
                ctx.beginPath(); ctx.arc(c[0], c[1], (R + tol) * k, 0, Math.PI * 2); ctx.stroke()
                ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(0, R - tol) * k, 0, Math.PI * 2); ctx.stroke()
                // 標準軌跡（白色虛線）
                ctx.setLineDash([6, 6]); ctx.strokeStyle = "white"; ctx.lineWidth = 2
                ctx.beginPath(); ctx.arc(c[0], c[1], R * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
            })
            // 交叉點
            const o = P(0, 0); ctx.fillStyle = "#ff922b"; ctx.beginPath(); ctx.arc(o[0], o[1], 5, 0, Math.PI * 2); ctx.fill()
            // 實際航跡
            if (root.track.length > 1) {
                ctx.strokeStyle = "#ff4d4f"; ctx.lineWidth = 2.5; ctx.beginPath()
                root.track.forEach((p, i) => { const q = P(p[0], p[1]); if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]) })
                ctx.stroke()
            }
            // 目前飛機位置與機頭方向（紅色三角形）
            if (root._v && root._v.coordinate.isValid && root.center.isValid) {
                const lp = root.toLocal(root._v.coordinate), q = P(lp[0], lp[1])
                const h = (root._v.heading.rawValue - root.axisHdg) * Math.PI / 180
                ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(h)
                ctx.fillStyle = "#ff4d4f"; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill()
                ctx.restore()
            }
        }
    }

    // 結果表
    GridLayout {
        columns: 4
        columnSpacing: _fw * 2
        rowSpacing: 2
        component Res: Column {
            property string k
            property string v
            property bool ok: true
            QGCLabel { text: k; color: "#adb5bd"; font.pointSize: ScreenTools.smallFontPointSize }
            QGCLabel { text: v; color: (v === "--" || ok) ? "white" : "#ff6b6b"; font.bold: true }
        }
        Res { k: "判定結果"; v: root.verdict; ok: root.verdict !== "不合格" && !(cfg.judgeMode === 1 && !root.running && root.score < 60) }   // 計分制 60 分以下標紅
        Res { k: "平均軌跡偏差"; v: root.fmt(root.avgDev, 2) + (root.st.n ? " m" : ""); ok: root.checks[0].ok }
        Res { k: "最大高度偏差"; v: root.fmt(root.st.n ? root.st.altMax : NaN, 2) + (root.st.n ? " m" : ""); ok: root.checks[1].ok }
        Res { k: "平均航向偏差"; v: root.fmt(root.avgHdg, 1) + (root.st.n ? "°" : ""); ok: root.checks[2].ok }
        Res { k: "速度合格率"; v: root.fmt(root.spdRate, 0) + (root.st.n ? "%" : ""); ok: root.checks[3].ok }
        Res { k: "飛行距離"; v: root.fmt(root.st.dist, 1) + " m" }
        Res { k: "用時"; v: Math.round(root.elapsed) + " s"; ok: root.checks[4].ok }
        Res { k: "左右環完成"; v: "左" + (root.loopL ? "完成" : "未完成") + "　右" + (root.loopR ? "完成" : "未完成"); ok: root.checks[5].ok }
    }

    RowLayout {
        spacing: _fw * 0.6
        QGCButton { text: root.running ? "結束記錄" : "開始八字飛行"; primary: !root.running; enabled: !!root._v; onClicked: root.running ? root.stop() : root.start() }
        QGCButton { text: "重置"; onClicked: { root.resetAll(); canvas.requestPaint() } }
        QGCLabel { text: root.running ? "記錄中（已解鎖且離地 1 m 以上才取樣）" : (root.finished ? "已結束" : "未開始"); color: root.running ? "#51cf66" : "#adb5bd"; font.pointSize: ScreenTools.smallFontPointSize }
    }
}
