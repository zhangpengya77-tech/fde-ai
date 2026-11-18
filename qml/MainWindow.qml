import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts
import QtQuick.Window
import QtPositioning

import QGroundControl
import QGroundControl.Controls
import QGroundControl.FactControls
import QGroundControl.FlyView
import QGroundControl.FlightMap
import QGroundControl.PlanView
import QGroundControl.Toolbar
import FDE.Ui
import FDE.Tools

// FDE-QGC V1.0：此檔由官方 QGC v5.1.5 src/MainWindow/MainWindow.qml 複製，只做三處修改（標註 FDE）：
//   1) 匯入 FDE.Ui；2) 加入左側 8 項導覽列 FdeNavRail；3) 飛行／規劃／工具畫面改為貼齊導覽列右側。
//   其餘（關閉檢查、關鍵告警彈窗、確認對話框）完全保留官方程式。
/// @brief Native QML top level window
/// All properties defined here are visible to all QML pages.
ApplicationWindow {
    id:         mainWindow
    visible:    true
    // The special casing for android prevents white bars from showing up on the edges of the screen with newer android versions
    flags:      Qt.Window | (ScreenTools.isAndroid ? Qt.ExpandedClientAreaHint | Qt.NoTitleBarBackgroundHint : 0)

    // Qt 6.9+ auto-sets ApplicationWindow padding to the display safe-area insets on mobile,
    // which insets our full-bleed content and leaves a blank strip along the screen edge.
    // QGC draws edge-to-edge and manages its own insets, so zero the padding.
    topPadding:    0
    bottomPadding: 0
    leftPadding:   0
    rightPadding:  0

    Component.onCompleted: {
        // Start the sequence of first run prompt(s)
        firstRunPromptManager.nextPrompt()
    }

    /// Saves main window position and size and re-opens it in the same position and size next time
    MainWindowSavedState {
        window: mainWindow
    }

    QtObject {
        id: firstRunPromptManager

        property var currentDialog:     null
        property var rgPromptIds:       QGroundControl.corePlugin.firstRunPromptsToShow()
        property int nextPromptIdIndex: 0

        function clearNextPromptSignal() {
            if (currentDialog) {
                currentDialog.closed.disconnect(nextPrompt)
            }
        }

        function nextPrompt() {
            if (nextPromptIdIndex < rgPromptIds.length) {
                var component = Qt.createComponent(QGroundControl.corePlugin.firstRunPromptResource(rgPromptIds[nextPromptIdIndex]));
                currentDialog = component.createObject(mainWindow)
                currentDialog.closed.connect(nextPrompt)
                currentDialog.open()
                nextPromptIdIndex++
            } else {
                currentDialog = null
                showPreFlightChecklistIfNeeded()
            }
        }
    }

    readonly property real      _topBottomMargins:          ScreenTools.defaultFontPixelHeight * 0.5

    //-------------------------------------------------------------------------
    //-- Global Scope Variables

    QtObject {
        id: globals

        readonly property var       activeVehicle:                  QGroundControl.multiVehicleManager.activeVehicle
        readonly property real      defaultTextHeight:              ScreenTools.defaultFontPixelHeight
        readonly property real      defaultTextWidth:               ScreenTools.defaultFontPixelWidth
        readonly property var       planMasterControllerFlyView:    flyView.planController
        readonly property var       guidedControllerFlyView:        flyView.guidedController

        // Number of QGCTextField's with validation errors. Used to prevent closing panels with validation errors.
        property int                validationErrorCount:           0

        // Set to a non-empty string to block navigation with a custom reason (e.g. during calibration)
        property string             navigationBlockedReason:        ""

        // Property to manage RemoteID quick access to settings page
        property bool               commingFromRIDIndicator:        false
    }

    /// Default color palette used throughout the UI
    QGCPalette { id: qgcPal; colorGroupEnabled: true }

    //-------------------------------------------------------------------------
    //-- Actions

    signal armVehicleRequest
    signal forceArmVehicleRequest
    signal disarmVehicleRequest
    signal vtolTransitionToFwdFlightRequest
    signal vtolTransitionToMRFlightRequest
    signal showPreFlightChecklistIfNeeded

    //-------------------------------------------------------------------------
    //-- Global Scope Functions

    // This function is used to prevent view switching if there are validation errors
    function allowViewSwitch(previousValidationErrorCount = 0, showErrorOnDisallow = true) {
        // Check for explicit navigation block (e.g. calibration in progress)
        if (globals.navigationBlockedReason !== "") {
            if (showErrorOnDisallow) {
                validationErrorToast.text = globals.navigationBlockedReason
                if (validationErrorToast.visible) {
                    validationErrorToast.close()
                }
                validationErrorToast.open()
            }
            return false
        }
        // Run validation on active focus control to ensure it is valid before switching views
        if (mainWindow.activeFocusControl instanceof FactTextField) {
            mainWindow.activeFocusControl._onEditingFinished()
        }
        var allowed = globals.validationErrorCount <= previousValidationErrorCount
        if (!allowed && showErrorOnDisallow) {
            validationErrorToast.text = qsTr("Please correct the invalid value before continuing")
            if (validationErrorToast.visible) {
                validationErrorToast.close()
            }
            validationErrorToast.open()
        }
        return allowed
    }

    function showPlanView() {
        flyView.visible = false
        planView.visible = true
        toolDrawer.visible = false
    }

    function showFlyView() {
        flyView.visible = true
        planView.visible = false
        toolDrawer.visible = false
    }

    function showTool(toolTitle, toolSource, toolIcon) {
        toolDrawer.backIcon     = flyView.visible ? "/qmlimages/PaperPlane.svg" : "/qmlimages/Plan.svg"
        toolDrawer.toolTitle    = toolTitle
        toolDrawer.toolSource   = toolSource
        toolDrawer.toolIcon     = toolIcon
        toolDrawer.visible      = true
    }

    function showAnalyzeTool() {
        showTool(qsTr("Analyze Tools"), "qrc:/qml/QGroundControl/AnalyzeView/AnalyzeView.qml", "/qmlimages/Analyze.svg")
    }

    // FDE：經左側導覽切換頁面（頁內按鈕用，讓左側高亮跟著正確的項目）
    function fdeActivateNav(key) {
        fdeNavRail.activate(key)
    }

    // FDE：開啟「日誌」頁並切到指定子項（例如「智能診斷」）。
    // 子選單清單來自 QGroundControl.corePlugin.analyzePages；切換方式與官方子選單按鈕相同。
    function fdeShowAnalyzeSubPage(pageTitle) {
        if (!allowViewSwitch()) {
            return false
        }
        fdeNavRail.currentKey = "logs"
        showAnalyzeTool()
        const view = toolDrawerLoader.item
        const pages = QGroundControl.corePlugin.analyzePages
        for (let i = 0; i < pages.length; i++) {
            if (pages[i].title === pageTitle) {
                if (view && view._currentPage !== pages[i]) {
                    view._currentPage = pages[i]
                    view._updatePanelSource()
                }
                return true
            }
        }
        return false
    }

    function showVehicleConfig() {
        showTool(qsTr("Vehicle Configuration"), "qrc:/qml/QGroundControl/VehicleSetup/VehicleConfigView.qml", "/qmlimages/Gears.svg")
    }

    function showVehicleConfigParametersPage() {
        showVehicleConfig()
        toolDrawerLoader.item.showParametersPanel()
    }

    function showKnownVehicleComponentConfigPage(knownVehicleComponent) {
        showVehicleConfig()
        let vehicleComponent = globals.activeVehicle.autopilotPlugin.findKnownVehicleComponent(knownVehicleComponent)
        if (vehicleComponent) {
            toolDrawerLoader.item.showVehicleComponentPanel(vehicleComponent)
        }
    }

    function showSettingsTool(settingsPage = "") {
        showTool(qsTr("Application Settings"), "qrc:/qml/QGroundControl/Controls/AppSettings.qml", "/res/QGCLogoWhite")
        if (settingsPage !== "") {
            toolDrawerLoader.item.showSettingsPage(settingsPage)
        }
    }

    //-------------------------------------------------------------------------
    //-- Global simple message dialog

    function _showMessageDialogWorker(owner, dialogTitle, dialogText, buttons = Dialog.Ok, acceptFunction = null, closeFunction = null, bypassNavigationCheck = false) {
        let dialog = simpleMessageDialogComponent.createObject(owner, { title: dialogTitle, text: dialogText, buttons: buttons, acceptFunction: acceptFunction, closeFunction: closeFunction, bypassNavigationCheck: bypassNavigationCheck })
        dialog.open()
    }

    // This variant is only meant to be called by QGCApplication
    function _showMessageDialog(dialogTitle, dialogText) {
        _showMessageDialogWorker(mainWindow, dialogTitle, dialogText)
    }

    // This variant is only meant to be called by QGCApplication. Ok reboots the active vehicle.
    function _showRebootVehicleDialog(dialogTitle, dialogText) {
        _showMessageDialogWorker(mainWindow, dialogTitle,
                                 dialogText + " " + qsTr("Click Ok to reboot the vehicle now."),
                                 Dialog.Ok | Dialog.Cancel,
                                 function() {
                                     const activeVehicle = QGroundControl.multiVehicleManager.activeVehicle
                                     if (activeVehicle) {
                                         activeVehicle.rebootVehicle()
                                     }
                                 })
    }

    Connections {
        target: QGroundControl

        function onShowMessageDialogRequested(owner, title, text, buttons, acceptFunction, closeFunction) {
            _showMessageDialogWorker(owner, title, text, buttons, acceptFunction, closeFunction)
        }
    }

    Component {
        id: simpleMessageDialogComponent

        QGCSimpleMessageDialog {
        }
    }

    property bool _forceClose: false
    property bool suppressCriticalVehicleMessages: false

    function finishCloseProcess() {
        _forceClose = true
        // For some reason on the Qml side Qt doesn't automatically disconnect a signal when an object is destroyed.
        // So we have to do it ourselves otherwise the signal flows through on app shutdown to an object which no longer exists.
        firstRunPromptManager.clearNextPromptSignal()
        QGroundControl.linkManager.shutdown()
        QGroundControl.videoManager.stopVideo();
        mainWindow.close()
    }

    // Check for things which should prevent the app from closing
    //  Returns true if it is OK to close
    readonly property int _skipUnsavedMissionCheckMask: 0x01
    readonly property int _skipPendingParameterWritesCheckMask: 0x02
    readonly property int _skipActiveConnectionsCheckMask: 0x04
    property int _closeChecksToSkip: 0
    property bool _reentrantCloseGuard: false
    function performCloseChecks() {
        if (!(_closeChecksToSkip & _skipUnsavedMissionCheckMask) && !checkForUnsavedMission()) {
            return false
        }
        if (!(_closeChecksToSkip & _skipPendingParameterWritesCheckMask) && !checkForPendingParameterWrites()) {
            return false
        }
        if (!(_closeChecksToSkip & _skipActiveConnectionsCheckMask) && !checkForActiveConnections()) {
            return false
        }
        finishCloseProcess()
        return true
    }

    function checkForUnsavedMission() {
        // Only warn when edits are neither saved to disk nor uploaded to the vehicle.
        // If either happened the edits are recoverable, so closing loses nothing.
        // With no active vehicle an upload can't have happened, so treat the plan as
        // not uploaded regardless of dirtyForUpload.
        if (planView._planMasterController.dirtyForSave &&
                (planView._planMasterController.dirtyForUpload || !QGroundControl.multiVehicleManager.activeVehicle)) {
            let accepted = false
            _reentrantCloseGuard = true
            _showMessageDialogWorker(mainWindow, qsTr("Unsaved Mission"),
                              qsTr("You have a mission edit in progress which has not been saved/uploaded. If you close you will lose changes. Are you sure you want to close?"),
                              Dialog.Yes | Dialog.No,
                              function() { accepted = true; _closeChecksToSkip |= _skipUnsavedMissionCheckMask; performCloseChecks() },
                              function() { if (!accepted) _reentrantCloseGuard = false },
                              true /* bypassNavigationCheck */)
            return false
        } else {
            return true
        }
    }

    function checkForPendingParameterWrites() {
        for (var index=0; index<QGroundControl.multiVehicleManager.vehicles.count; index++) {
            if (QGroundControl.multiVehicleManager.vehicles.get(index).parameterManager.pendingWrites) {
                let accepted = false
                _reentrantCloseGuard = true
                _showMessageDialogWorker(mainWindow, qsTr("Pending Parameter Updates"),
                    qsTr("You have pending parameter updates to a vehicle. If you close you will lose changes. Are you sure you want to close?"),
                    Dialog.Yes | Dialog.No,
                    function() { accepted = true; _closeChecksToSkip |= _skipPendingParameterWritesCheckMask; performCloseChecks() },
                    function() { if (!accepted) _reentrantCloseGuard = false },
                    true /* bypassNavigationCheck */)
                return false
            }
        }
        return true
    }

    function checkForActiveConnections() {
        if (QGroundControl.multiVehicleManager.activeVehicle) {
            let accepted = false
            _reentrantCloseGuard = true
            _showMessageDialogWorker(mainWindow, qsTr("Active Vehicle Connections"),
                qsTr("There are still active connections to vehicles. Are you sure you want to exit?"),
                Dialog.Yes | Dialog.No,
                function() { accepted = true; _closeChecksToSkip |= _skipActiveConnectionsCheckMask; performCloseChecks() },
                function() { if (!accepted) _reentrantCloseGuard = false },
                true /* bypassNavigationCheck */)
            return false
        } else {
            return true
        }
    }

    onClosing: (close) => {
        if (!_forceClose) {
            if (_reentrantCloseGuard) {
                close.accepted = false
                return
            }
            _closeChecksToSkip = 0
            close.accepted = performCloseChecks()
        }
    }

    background: Rectangle {
        anchors.fill:   parent
        color:          QGroundControl.globalPalette.window
    }

    // FDE：左側 8 項導覽列
    FdeNavRail {
        id:             fdeNavRail
        objectName:     "fdeNavRail"
        anchors.left:   parent.left
        anchors.top:    parent.top
        anchors.bottom: parent.bottom
        window:         mainWindow
        flyVisible:     flyView.visible
        planVisible:    planView.visible
        toolVisible:    toolDrawer.visible
        z:              1
    }

    FlyView {
        id:                     flyView
        objectName:             "mainView_fly"
        // FDE：原為 anchors.fill: parent
        anchors.left:           fdeNavRail.right
        anchors.right:          parent.right
        anchors.top:            parent.top
        anchors.bottom:         parent.bottom
    }

    PlanView {
        id:             planView
        objectName:     "mainView_plan"
        // FDE：原為 anchors.fill: parent
        anchors.left:   fdeNavRail.right
        anchors.right:  parent.right
        anchors.top:    parent.top
        anchors.bottom: parent.bottom
        visible:        false
    }
    // FDE：驗收自我測試（只有設定環境變數 FDE_QGC_SELFTEST 時才會執行；一般使用不會啟動）
    Timer {
        id:         fdeSelfTestTimer
        interval:   4000
        repeat:     true
        running:    FdeSelfTest.pages.length > 0
        property int idx: -1
        onTriggered: {
            // 首次執行提示視窗會擋住畫面：自我測試時直接關閉
            if (firstRunPromptManager.currentDialog) {
                firstRunPromptManager.currentDialog.close()
                return
            }
            if (idx >= 0) {
                FdeSelfTest.grab(mainWindow, (idx + 1) + "_" + FdeSelfTest.pages[idx])
            }
            idx++
            if (idx >= FdeSelfTest.pages.length) {
                FdeSelfTest.finish(0)
                return
            }
            const k = FdeSelfTest.pages[idx]
            FdeSelfTest.log("activate " + k)
            if (k.indexOf("cmd:") === 0) {
                fdeSelfTestCommand(k.substring(4))
            } else {
                fdeNavRail.activate(k)
            }
        }
    }
    // 自我測試用：在物件樹（data 含子項目與非視覺物件）中找第一個符合條件的物件
    function _fdeFindObject(obj, pred, depth = 0) {
        if (!obj || depth > 60) {
            return null
        }
        try { if (pred(obj)) { return obj } } catch (e) { }
        const kids = obj.data !== undefined ? obj.data : (obj.children !== undefined ? obj.children : [])
        for (let i = 0; i < kids.length; i++) {
            const r = _fdeFindObject(kids[i], pred, depth + 1)
            if (r) {
                return r
            }
        }
        return null
    }

    // 自我測試的額外動作
    function fdeSelfTestCommand(cmd) {
        if (cmd === "loadplan") {
            const p = FdeSelfTest.outDir + "/selftest.plan"
            planView._planMasterController.loadFromFile(p)
            showPlanView()
        } else if (cmd === "sitlstart") {
            FdeSitl.start(-35.3632621, 149.1652374, 584, 353, true)
        } else if (cmd === "sitlstart3d") {
            // 3D 模擬自我測試：背景模式（不開 Gazebo 視窗）
            FdeSitl.start3d(false, true)
        } else if (cmd === "sitlstop") {
            FdeSitl.stop()
        } else if (cmd === "sitlstate") {
            FdeSelfTest.log("sitl state=" + FdeSitl.state + " msg=" + FdeSitl.lastMessage)
        } else if (cmd === "sitlconnect") {
            FdeSitl.connectLink()
        } else if (cmd === "fly") {
            showFlyView()
        } else if (cmd === "make8") {
            const v = QGroundControl.multiVehicleManager.activeVehicle
            const c = v && v.coordinate.isValid ? v.coordinate : QtPositioning.coordinate(-35.3632621, 149.1652374)
            const r = fdeSelfTestTool.saveFigureEight(FdeSelfTest.outDir + "/selftest.plan", c.latitude, c.longitude, 20, 15, 3, 12)
            FdeSelfTest.log("make8 " + JSON.stringify(r))
        } else if (cmd === "upload") {
            // 僅自我測試（SITL）使用：一般使用者流程仍須在航線規劃頁手動按「上傳」
            const v = QGroundControl.multiVehicleManager.activeVehicle
            FdeSelfTest.log("upload vehicle=" + (v ? v.id : "none") + " items=" + planView._planMasterController.missionController.visualItems.count)
            if (v) { planView._planMasterController.sendToVehicle() }
        } else if (cmd === "readback") {
            planView._planMasterController.loadFromVehicle()
        } else if (cmd === "count") {
            const mc = planView._planMasterController.missionController
            let cmds = []
            for (let i = 1; i < mc.visualItems.count; i++) { const it = mc.visualItems.get(i); cmds.push(it.isSimpleItem ? it.command : "complex") }
            FdeSelfTest.log("plan items=" + (mc.visualItems.count - 1) + " commands=" + cmds.join(",") + " time=" + Math.round(mc.missionTime) + "s dirtyUpload=" + planView._planMasterController.dirtyForUpload)
        } else if (cmd === "analyze") {
            FdeLogAnalyzer.analyze(FdeSelfTest.outDir + "/test.bin")
        } else if (cmd === "report") {
            const r = FdeLogAnalyzer.report
            FdeSelfTest.log("report ok=" + r.ok + " overall=" + r.overall + " vehicle=" + r.vehicle + " fw=" + r.firmware + " error=" + (r.error || "") + " findings=" + JSON.stringify((r.findings || []).map(f => f.area + ":" + f.level + ":" + f.title)) + " metrics=" + JSON.stringify(r.metrics || {}) + " suggestions=" + JSON.stringify((r.suggestions || []).map(s => s.param + "=" + s.suggested)))
        } else if (cmd === "tts") {
            FdeSelfTest.log("tts engine=" + FdeSpeech.engine + " status=" + JSON.stringify(FdeSpeech.status()))
            FdeSelfTest.log("tts speak zh-TW=" + FdeSpeech.speak("測試", "zh-TW") + " zh-CN=" + FdeSpeech.speak("测试", "zh-CN") + " en-US=" + FdeSpeech.speak("test", "en-US"))
        } else if (cmd === "vehicle") {
            const v = QGroundControl.multiVehicleManager.activeVehicle
            FdeSelfTest.log(v ? ("vehicle id=" + v.id + " mode=" + v.flightMode + " armed=" + v.armed + " alt=" + v.altitudeRelative.rawValue.toFixed(1) + " lat=" + v.coordinate.latitude.toFixed(7) + " lon=" + v.coordinate.longitude.toFixed(7)) : "vehicle none")
        } else if (cmd.indexOf("asub:") === 0) {
            // 導覽精簡驗收：開啟「日誌」頁第 n 個子項並記錄標題
            const pages = QGroundControl.corePlugin.analyzePages
            const n = Number(cmd.substring(5))
            const ok = n < pages.length && fdeShowAnalyzeSubPage(pages[n].title)
            FdeSelfTest.log("asub " + n + " title=" + (n < pages.length ? pages[n].title : "?") + " ok=" + ok
                            + " item=" + (_inPanelAnalyzePage !== null) + " nav=" + fdeNavRail.activeKey + " tool=" + toolDrawer.toolTitle)
        } else if (cmd === "asublist") {
            const pages = QGroundControl.corePlugin.analyzePages
            let t = []
            for (let i = 0; i < pages.length; i++) { t.push(pages[i].title) }
            FdeSelfTest.log("asublist " + t.join(" | "))
        } else if (cmd === "navlist") {
            FdeSelfTest.log("navlist count=" + fdeNavRail.items.length + " " + fdeNavRail.items.map(it => it.label).join(" | "))
        } else if (cmd === "lvopen") {
            // 在「日誌檢視器」頁開啟測試用 .bin（呼叫官方頁面自己的 loadBinFile，和按「開啟」選檔相同）
            const lv = _fdeFindObject(_inPanelAnalyzePage, o => typeof o.loadBinFile === "function")
            FdeSelfTest.log("lvopen found=" + (lv !== null))
            if (lv) { lv.loadBinFile(FdeSelfTest.outDir + "/test.bin") }
        } else if (cmd === "logstate") {
            const r = FdeLogAnalyzer.report
            FdeSelfTest.log("logstate shared=" + FdeLogAnalyzer.sharedLogPath + " busy=" + FdeLogAnalyzer.busy + " reportFile=" + (r && r.file ? r.file : "")
                            + " ok=" + (r ? r.ok : "") + " overall=" + (r ? r.overall : "") + " nav=" + fdeNavRail.activeKey + " tool=" + toolDrawer.toolTitle)
        } else if (cmd === "diaggotune") {
            // 智能診斷頁的「前往 AI 調參 →」按鈕：模擬點擊
            const b = _fdeFindObject(_inPanelAnalyzePage, o => o.text === "前往 AI 調參 →" && o.clicked !== undefined)
            FdeSelfTest.log("diaggotune found=" + (b !== null) + " enabled=" + (b ? b.enabled : false))
            if (b && b.enabled) { b.clicked() }
        } else if (cmd === "tunegodiag") {
            // AI 調參頁的「前往智能診斷」按鈕：模擬點擊
            const b = _fdeFindObject(toolDrawerLoader.item, o => o.text === "前往智能診斷" && o.clicked !== undefined)
            FdeSelfTest.log("tunegodiag found=" + (b !== null))
            if (b) { b.clicked() }
        } else if (cmd === "params") {
            // 飛控設定 → 參數（取代原「參數管理」入口）
            fdeNavRail.activate("setup")
            if (QGroundControl.multiVehicleManager.activeVehicle) { showVehicleConfigParametersPage() }
            const pc = _fdeFindObject(toolDrawerLoader.item, o => o.searchText !== undefined && o.showModifiedOnly !== undefined)
            FdeSelfTest.log("params nav=" + fdeNavRail.activeKey + " tool=" + toolDrawer.toolTitle + " editor=" + (pc !== null)
                            + " rows=" + (pc && pc.parameters ? pc.parameters.rowCount : -1))
        } else if (cmd.indexOf("paramsearch:") === 0) {
            const pc = _fdeFindObject(toolDrawerLoader.item, o => o.searchText !== undefined && o.showModifiedOnly !== undefined)
            if (pc) { pc.searchText = cmd.substring(12) }
            FdeSelfTest.log("paramsearch text=" + cmd.substring(12) + " editor=" + (pc !== null) + " rows=" + (pc && pc.parameters ? pc.parameters.rowCount : -1))
        } else if (cmd.indexOf("paramedit:") === 0 || cmd === "paramread") {
            // 只對 FDE 模擬機修改參數（LOG_DISARMED，0/1，不影響飛行）；用官方 Fact 寫入，和在參數頁手動修改相同
            const v = QGroundControl.multiVehicleManager.activeVehicle
            const pc = _fdeFindObject(toolDrawerLoader.item, o => o.searchText !== undefined && o.showModifiedOnly !== undefined)
            if (!v || !FdeSwarm.isSimVehicle(v.id) || !pc) {
                FdeSelfTest.log("paramedit refused vehicle=" + (v ? v.id : "none") + " sim=" + (v ? FdeSwarm.isSimVehicle(v.id) : false) + " editor=" + (pc !== null))
            } else {
                const f = pc.getParameterFact(-1, "LOG_DISARMED", false)
                if (f && cmd !== "paramread") { f.value = Number(cmd.substring(10)) }
                FdeSelfTest.log("param LOG_DISARMED=" + (f ? f.rawValue : "missing") + " vehicle=" + v.id)
            }
        } else if (cmd.indexOf("settings:") === 0) {
            // V2-3：開啟應用設定的指定頁（例如 settings:FdeSimCenter）
            showSettingsTool(cmd.substring(9))
        } else if (cmd === "swarmstart") {
            // V2-3 多機仿真自我測試：3 架模擬機、間距 5 m（ArduPilot 官方測試場 CMAC）
            FdeSwarm.startSwarm(3, -35.3632621, 149.1652374, 584, 0, 5, true)
        } else if (cmd === "swarmconnect") {
            FdeSwarm.connectAll()
        } else if (cmd === "swarmstop") {
            FdeSwarm.stopSwarm()
        } else if (cmd === "swarmstate") {
            // 記錄每架飛機的狀態與「從機相對長機」的實際位置（前方／右方公尺），用來驗證隊形
            const vs = QGroundControl.multiVehicleManager.vehicles
            const lead = QGroundControl.multiVehicleManager.getVehicleById(11)
            let s = "swarm state=" + FdeSwarm.state + " running=" + FdeSwarm.runningCount + " vehicles=" + vs.count
                  + " formation=" + FdeSwarm.formationActive + " relay=" + FdeSwarm.relayCount + " msg=" + FdeSwarm.formationMessage
            for (let i = 0; i < vs.count; i++) {
                const v = vs.get(i)
                s += " | id=" + v.id + " sim=" + FdeSwarm.isSimVehicle(v.id) + " links=" + v.vehicleLinkManager.linkNames.join("/") + " mode=" + v.flightMode + " armed=" + v.armed
                     + " alt=" + Number(v.altitudeRelative.rawValue).toFixed(1)
                if (lead && v.id !== 11 && lead.coordinate.isValid && v.coordinate.isValid) {
                    // 換算到長機機頭座標：前方 = 距離×cos(方位差)，右方 = 距離×sin(方位差)
                    const d = lead.coordinate.distanceTo(v.coordinate)
                    const a = (lead.coordinate.azimuthTo(v.coordinate) - lead.heading.rawValue) * Math.PI / 180
                    s += " fwd=" + (d * Math.cos(a)).toFixed(1) + " right=" + (d * Math.sin(a)).toFixed(1)
                }
            }
            FdeSelfTest.log(s)
        } else if (cmd === "formtakeoff") {
            FdeSwarm.takeoffAll([11, 12, 13], 10)
        } else if (cmd === "formapply") {
            FdeSwarm.applyFormation(11, [12, 13], "vee", 6, 0)
        } else if (cmd === "formfollow") {
            FdeSwarm.startFollow([12, 13])
        } else if (cmd === "formgoto") {
            // 長機往正北飛 40 m（模擬學員在地圖上點「飛到這裡」）；只對 FDE 模擬機送出
            const lead = QGroundControl.multiVehicleManager.getVehicleById(11)
            if (lead && FdeSwarm.isSimVehicle(11)) { lead.guidedModeGotoLocation(lead.coordinate.atDistanceAndAzimuth(40, 0)) }
            else { FdeSelfTest.log("formgoto skipped: 11 is not an FDE sim vehicle") }
        } else if (cmd === "formland") {
            FdeSwarm.commandAll([11, 12, 13], "land")
        } else {
            // 其他指令（例如 exam:start）廣播給飛行畫面上的面板處理
            FdeSelfTest.broadcast(cmd)
        }
    }
    FdeWaypointTool { id: fdeSelfTestTool }
    // FDE：航線規劃頁「航線快捷」面板（高度／1→2 距離／航向／速度／預估時間／脫鉤／地理圍欄）
    // 放在官方右側編輯面板（寬 min(1/3, 30 字寬)）的左邊，不覆蓋官方面板。
    FdePlanQuickPanel {
        id:                     fdePlanQuickPanel
        objectName:             "fdePlanQuickPanel"
        visible:                planView.visible && !toolDrawer.visible
        planMasterController:   planView._planMasterController
        anchors.right:          planView.right
        anchors.rightMargin:    Math.min(planView.width / 3, ScreenTools.defaultFontPixelWidth * 30) + ScreenTools.defaultFontPixelWidth * 1.5
        anchors.top:            planView.top
        anchors.topMargin:      ScreenTools.toolbarHeight + ScreenTools.defaultFontPixelHeight * 0.5
        z:                      planView.z + 1
    }

    footer: LogReplayStatusBar {
        visible: QGroundControl.settingsManager.flyViewSettings.showLogReplayStatusBar.rawValue
    }

    MessageDialog {
        id:                 showTouchAreasNotification
        title:              qsTr("Debug Touch Areas")
        text:               qsTr("Touch Area display toggled")
        buttons:            MessageDialog.Ok
    }

    MessageDialog {
        id:                 advancedModeOnConfirmation
        title:              qsTr("Advanced Mode")
        text:               QGroundControl.corePlugin.showAdvancedUIMessage
        buttons:            MessageDialog.Yes | MessageDialog.No
        onButtonClicked: function (button, role) {
            if (button === MessageDialog.Yes) {
                QGroundControl.corePlugin.showAdvancedUI = true
            }
        }
    }

    MessageDialog {
        id:                 advancedModeOffConfirmation
        title:              qsTr("Advanced Mode")
        text:               qsTr("Turn off Advanced Mode?")
        buttons:            MessageDialog.Yes | MessageDialog.No
        onButtonClicked: function (button, role) {
            if (button === MessageDialog.Yes) {
                QGroundControl.corePlugin.showAdvancedUI = false
            }
        }
    }

    function showToolSelectDialog() {
        if (mainWindow.allowViewSwitch()) {
            mainWindow.showIndicatorDrawer(toolSelectComponent, null)
        }
    }

    // Toast notification shown when a view switch is blocked by a validation error
    ToolTip {
        id:             validationErrorToast
        x:              (mainWindow.width - width) / 2
        y:              mainWindow.height - height - ScreenTools.defaultFontPixelHeight * 3
        timeout:        3000
        closePolicy:    Popup.NoAutoClose
        text:           qsTr("Please correct the invalid value before continuing")

        background: Rectangle {
            color:  qgcPal.alertBackground
            radius: ScreenTools.defaultFontPixelWidth / 2
        }

        contentItem: QGCLabel {
            text:   validationErrorToast.text
            color:  qgcPal.alertText
        }
    }

    Component {
        id: toolSelectComponent

        SelectViewDropdown {
        }
    }

    Rectangle {
        id:             toolDrawer
        objectName:     "mainView_toolDrawer"
        // FDE：原為 anchors.fill: parent
        anchors.left:   fdeNavRail.right
        anchors.right:  parent.right
        anchors.top:    parent.top
        anchors.bottom: parent.bottom
        visible:        false
        color:          qgcPal.window

        property var backIcon
        property string toolTitle
        property alias toolSource:  toolDrawerLoader.source
        property var toolIcon

        onVisibleChanged: {
            if (!toolDrawer.visible) {
                toolDrawerLoader.source = ""
            }
        }

        // This need to block click event leakage to underlying map.
        DeadMouseArea {
            anchors.fill: parent
        }

        Rectangle {
            id:             toolDrawerToolbar
            anchors.left:   parent.left
            anchors.right:  parent.right
            anchors.top:    parent.top
            height:         ScreenTools.toolbarHeight
            color:          qgcPal.toolbarBackground

            RowLayout {
                id:                 toolDrawerToolbarLayout
                anchors.leftMargin: ScreenTools.defaultFontPixelWidth
                anchors.left:       parent.left
                anchors.top:        parent.top
                anchors.bottom:     parent.bottom
                spacing:            ScreenTools.defaultFontPixelWidth

                QGCToolBarButton {
                    id: qgcButton
                    objectName: "toolbar_qgcLogo"
                    height: parent.height
                    icon.source: "/res/QGCLogoFull.svg"
                    logo: true
                    onClicked: mainWindow.showToolSelectDialog()
                }

                QGCLabel {
                    id:             toolbarDrawerText
                    text:           toolDrawer.toolTitle
                    font.pointSize: ScreenTools.largeFontPointSize
                }
            }
        }

        Loader {
            id:             toolDrawerLoader
            anchors.left:   parent.left
            anchors.right:  parent.right
            anchors.top:    toolDrawerToolbar.bottom
            anchors.bottom: parent.bottom
        }
    }

    //-------------------------------------------------------------------------
    //-- Critical Vehicle Message Popup

    function showCriticalVehicleMessage(message) {
        if (suppressCriticalVehicleMessages) {
            return
        }
        if (criticalVehicleMessagePopup.visible || QGroundControl.videoManager.fullScreen) {
            // We received additional warning message while an older warning message was still displayed.
            // When the user close the older one drop the message indicator tool so they can see the rest of them.
            criticalVehicleMessagePopup.additionalCriticalMessagesReceived = true
        } else {
            criticalVehicleMessagePopup.criticalVehicleMessage      = message
            criticalVehicleMessagePopup.additionalCriticalMessagesReceived = false
            criticalVehicleMessagePopup.open()
        }
    }

    // No focus and no Escape handler: either would steal keys from whatever the user is typing in.
    Popup {
        id:                 criticalVehicleMessagePopup
        objectName:         "criticalVehicleMessage_popup"
        y:                  ScreenTools.toolbarHeight + ScreenTools.defaultFontPixelHeight
        x:                  Math.round((mainWindow.width - width) * 0.5)
        width:              mainWindow.width  * 0.55
        height:             criticalVehicleMessageText.contentHeight + ScreenTools.defaultFontPixelHeight * 2
        modal:              false
        closePolicy:        Popup.CloseOnPressOutside

        property alias  criticalVehicleMessage:             criticalVehicleMessageText.text
        property bool   additionalCriticalMessagesReceived: false

        function acknowledge() {
            close()
            if (additionalCriticalMessagesReceived) {
                additionalCriticalMessagesReceived = false
                flyView.dropMainStatusIndicatorTool()
            } else if (QGroundControl.multiVehicleManager.activeVehicle) {
                QGroundControl.multiVehicleManager.activeVehicle.resetErrorLevelMessages()
            }
        }

        background: Rectangle {
            anchors.fill:   parent
            color:          qgcPal.alertBackground
            radius:         ScreenTools.defaultFontPixelHeight * 0.5
            border.color:   qgcPal.alertBorder
            border.width:   2

            Rectangle {
                anchors.horizontalCenter:   parent.horizontalCenter
                anchors.top:                parent.top
                anchors.topMargin:          -(height / 2)
                color:                      qgcPal.alertBackground
                radius:                     ScreenTools.defaultFontPixelHeight * 0.25
                border.color:               qgcPal.alertBorder
                border.width:               1
                width:                      vehicleWarningLabel.contentWidth + _margins
                height:                     vehicleWarningLabel.contentHeight + _margins

                property real _margins: ScreenTools.defaultFontPixelHeight * 0.25

                QGCLabel {
                    id:                 vehicleWarningLabel
                    anchors.centerIn:   parent
                    text:               qsTr("Vehicle Error")
                    font.pointSize:     ScreenTools.smallFontPointSize
                    color:              qgcPal.alertText
                }
            }

            Rectangle {
                id:                         additionalErrorsIndicator
                anchors.horizontalCenter:   parent.horizontalCenter
                anchors.bottom:             parent.bottom
                anchors.bottomMargin:       -(height / 2)
                color:                      qgcPal.alertBackground
                radius:                     ScreenTools.defaultFontPixelHeight * 0.25
                border.color:               qgcPal.alertBorder
                border.width:               1
                width:                      additionalErrorsLabel.contentWidth + _margins
                height:                     additionalErrorsLabel.contentHeight + _margins
                visible:                    criticalVehicleMessagePopup.additionalCriticalMessagesReceived

                property real _margins: ScreenTools.defaultFontPixelHeight * 0.25

                QGCLabel {
                    id:                 additionalErrorsLabel
                    anchors.centerIn:   parent
                    text:               qsTr("Additional errors received")
                    font.pointSize:     ScreenTools.smallFontPointSize
                    color:              qgcPal.alertText
                }
            }
        }

        QGCLabel {
            id:                 criticalVehicleMessageText
            objectName:         "criticalVehicleMessage_text"
            width:              criticalVehicleMessagePopup.width - ScreenTools.defaultFontPixelHeight
            anchors.centerIn:   parent
            wrapMode:           Text.WordWrap
            color:              qgcPal.alertText
            textFormat:         TextEdit.RichText
        }

        MouseArea {
            anchors.fill: parent
            onClicked: criticalVehicleMessagePopup.acknowledge()
        }
    }

    //-------------------------------------------------------------------------
    //-- Indicator Drawer

    function showIndicatorDrawer(drawerComponent, indicatorItem) {
        indicatorDrawer.sourceComponent = drawerComponent
        indicatorDrawer.indicatorItem = indicatorItem
        indicatorDrawer.open()
    }

    function closeIndicatorDrawer() {
        indicatorDrawer.close()
    }

    Popup {
        id:             indicatorDrawer
        x:              calcXPosition()
        y:              ScreenTools.toolbarHeight + _margins
        leftInset:      0
        rightInset:     0
        topInset:       0
        bottomInset:    0
        padding:        _margins * 2
        visible:        false
        modal:          true
        focus:          true
        closePolicy:    Popup.CloseOnEscape | Popup.CloseOnPressOutside

        property var sourceComponent
        property var indicatorItem

        property bool _expanded:    false
        property real _margins:     ScreenTools.defaultFontPixelHeight / 4

        function calcXPosition() {
            if (indicatorItem) {
                var xCenter = indicatorItem.mapToItem(mainWindow.contentItem, indicatorItem.width / 2, 0).x
                return Math.max(_margins, Math.min(xCenter - (contentItem.implicitWidth / 2), mainWindow.contentItem.width - contentItem.implicitWidth - _margins - (indicatorDrawer.padding * 2) - (ScreenTools.defaultFontPixelHeight / 2)))
            } else {
                return _margins
            }
        }

        onOpened: {
            _expanded                               = false;
            indicatorDrawerLoader.sourceComponent   = indicatorDrawer.sourceComponent
        }
        onClosed: {
            _expanded                               = false
            indicatorItem                           = undefined
            indicatorDrawerLoader.sourceComponent   = undefined
        }

        background: Item {
            Rectangle {
                id:             backgroundRect
                anchors.fill:   parent
                color:          QGroundControl.globalPalette.window
                radius:         indicatorDrawer._margins
                opacity:        0.85
            }

            Rectangle {
                objectName:                 "indicatorDrawerExpandButton"
                anchors.horizontalCenter:   backgroundRect.right
                anchors.verticalCenter:     backgroundRect.top
                width:                      ScreenTools.largeFontPixelHeight
                height:                     width
                radius:                     width / 2
                color:                      QGroundControl.globalPalette.button
                border.color:               QGroundControl.globalPalette.buttonText
                visible:                    indicatorDrawerLoader.item && indicatorDrawerLoader.item._showExpand && !indicatorDrawer._expanded

                QGCLabel {
                    anchors.centerIn:   parent
                    text:               ">"
                    color:              QGroundControl.globalPalette.buttonText
                }

                QGCMouseArea {
                    fillItem: parent
                    onClicked: indicatorDrawer._expanded = true
                }
            }
        }

        contentItem: QGCFlickable {
            id:             indicatorDrawerLoaderFlickable
            implicitWidth:  Math.min(mainWindow.contentItem.width - (2 * indicatorDrawer._margins) - (indicatorDrawer.padding * 2), indicatorDrawerLoader.width)
            implicitHeight: Math.min(mainWindow.contentItem.height - ScreenTools.toolbarHeight - (2 * indicatorDrawer._margins) - (indicatorDrawer.padding * 2), indicatorDrawerLoader.height)
            contentWidth:   indicatorDrawerLoader.width
            contentHeight:  indicatorDrawerLoader.height

            Loader {
                id:         indicatorDrawerLoader
                objectName: "indicatorDrawerLoader"

                Binding {
                    target:     indicatorDrawerLoader.item
                    property:   "expanded"
                    value:      indicatorDrawer._expanded
                }

                Binding {
                    target:     indicatorDrawerLoader.item
                    property:   "drawer"
                    value:      indicatorDrawer
                }
            }
        }
    }

    // Analyze page items (both in-panel and popped-out windows) are created with mainWindow as their
    // QObject parent so their lifetime is not tied to AnalyzeView. This lets a popped-out window
    // survive AnalyzeView being unloaded from the tool drawer.

    // Tracks the analyze page item currently shown inside AnalyzeView's panel (not popped out).
    // null when no page is loaded or the item has been handed off to a popup window.
    property var _inPanelAnalyzePage: null

    // Called by AnalyzeView.Component.onDestruction to destroy the in-panel item while
    // panelContainer is still alive.
    function destroyInPanelAnalyzePage() {
        if (_inPanelAnalyzePage) {
            // FDE：離開日誌頁前記下「日誌檢視器」開啟的檔案，給「智能診斷」沿用
            FdeLogAnalyzer.captureLogViewer(_inPanelAnalyzePage)
            _inPanelAnalyzePage.destroy()
            _inPanelAnalyzePage = null
        }
    }

    // Called by AnalyzeView to create an analyze page item owned by mainWindow.
    // The caller sets the visual parent to panelContainer after creation.
    function createAnalyzePage(source) {
        if (_inPanelAnalyzePage) {
            // FDE：切換日誌頁子項前記下「日誌檢視器」開啟的檔案，給「智能診斷」沿用
            FdeLogAnalyzer.captureLogViewer(_inPanelAnalyzePage)
            _inPanelAnalyzePage.destroy()
            _inPanelAnalyzePage = null
        }
        var component = Qt.createComponent(source)
        if (component.status !== Component.Ready) {
            console.warn("createAnalyzePage failed source:", source, "errorString:", component.errorString())
            return null
        }
        _inPanelAnalyzePage = component.createObject(mainWindow)
        return _inPanelAnalyzePage
    }

    // Called by AnalyzeView when the in-panel item is handed off to a popup window.
    // Clears _inPanelAnalyzePage so destroyInPanelAnalyzePage() does not destroy it
    // when AnalyzeView is torn down.
    function analyzePageMovedToPopup() {
        _inPanelAnalyzePage = null
    }

    function createWindowedAnalyzePage(title, source, requiresVehicle, existingItem) {
        var windowedPage = windowedAnalyzePage.createObject(mainWindow)
        windowedPage.title = title
        windowedPage.requiresVehicle = requiresVehicle
        if (existingItem) {
            windowedPage.adoptItem(existingItem)
        } else {
            windowedPage.source = source
        }
        windowedPage.visible = true
    }

    Component {
        id: windowedAnalyzePage

        Window {
            width:      ScreenTools.defaultFontPixelWidth  * 100
            height:     ScreenTools.defaultFontPixelHeight * 40
            visible:    false

            property alias source: loader.source
            property bool requiresVehicle: false

            function adoptItem(item) {
                loader.visible = false
                loader.source = ""
                item.parent = contentRect
                item.anchors.fill = contentRect
                item.popped = true
                item.visible = true
            }

            Connections {
                target: QGroundControl.multiVehicleManager
                function onActiveVehicleChanged() {
                    if (requiresVehicle) {
                        close()
                    }
                }
            }

            Rectangle {
                id:             contentRect
                color:          QGroundControl.globalPalette.window
                anchors.fill:   parent

                Loader {
                    id:             loader
                    anchors.fill:   parent
                    onLoaded:       item.popped = true
                }
            }

            onClosing: {
                visible = false
                // Destroy any reparented children (not owned by loader)
                for (var i = contentRect.children.length - 1; i >= 0; i--) {
                    var child = contentRect.children[i]
                    if (child !== loader) {
                        child.destroy()
                    }
                }
                source = ""
                Qt.callLater(destroy)
            }
        }
    }
}
