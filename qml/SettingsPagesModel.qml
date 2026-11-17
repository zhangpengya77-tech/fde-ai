// FDE-QGC V2-3｜覆寫官方 SettingsPagesModel.qml（系統設定左側清單）
// - 內容複製自 QGC 5.1.5 建置時產生的同名檔（build/.../AppSettings/generated/SettingsPagesModel.qml），官方項目一律不改、不刪。
// - 只在「說明（Help）」上方新增 FDE 的「仿真與編隊」頁（＝仿真訓練中心：單機訓練／多機編隊兩個分頁）。
// - FdeOverrideInterceptor 會把 qrc:/qml/QGroundControl/AppSettings/SettingsPagesModel.qml 導向本檔。
// - 升級 QGC 版本時：重新複製官方產生檔，再把下方標示「FDE 新增」的區塊貼回同一位置。
import QtQml.Models
import QtQml

import QGroundControl
import QGroundControl.Controls

ListModel {
    property QtObject _page0SectionState: QtObject {
        property var _appSettings: QGroundControl.settingsManager.appSettings
        property var _sectionVisibility: [
            (QGroundControl.settingsManager.appSettings.qLocaleLanguage.userVisible || QGroundControl.settingsManager.appSettings.indoorPalette.userVisible || QGroundControl.settingsManager.appSettings.followTarget.userVisible || QGroundControl.settingsManager.appSettings.audioVolume.userVisible || QGroundControl.settingsManager.appSettings.androidDontSaveToSDCard.userVisible || QGroundControl.settingsManager.appSettings.uiScalePercent.userVisible || QGroundControl.settingsManager.appSettings.savePath.userVisible || QGroundControl.settingsManager.appSettings.clearSettingsNextBoot.userVisible),
            (QGroundControl.settingsManager.appSettings.preferredFirmwareClass.userVisible || QGroundControl.settingsManager.appSettings.preferredVehicleClass.userVisible),
            (QGroundControl.settingsManager.unitsSettings.userVisible) && (QGroundControl.settingsManager.unitsSettings.horizontalDistanceUnits.userVisible || QGroundControl.settingsManager.unitsSettings.verticalDistanceUnits.userVisible || QGroundControl.settingsManager.unitsSettings.areaUnits.userVisible || QGroundControl.settingsManager.unitsSettings.speedUnits.userVisible || QGroundControl.settingsManager.unitsSettings.temperatureUnits.userVisible)
        ]
    }

    property QtObject _page1SectionState: QtObject {
        property var hasChecklist: QGroundControl.corePlugin.options.preFlightChecklistUrl.toString().length
        property var useChecklistValue: QGroundControl.settingsManager.appSettings.useChecklist.value
        property var virtualJoystickOn: QGroundControl.settingsManager.appSettings.virtualJoystick.rawValue
        property var _sectionVisibility: [
            (QGroundControl.settingsManager.appSettings.useChecklist.userVisible || QGroundControl.settingsManager.appSettings.enforceChecklist.userVisible || QGroundControl.settingsManager.appSettings.enableMultiVehiclePanel.userVisible || QGroundControl.settingsManager.flyViewSettings.keepMapCenteredOnVehicle.userVisible || QGroundControl.settingsManager.flyViewSettings.showLogReplayStatusBar.userVisible || QGroundControl.settingsManager.flyViewSettings.showSimpleCameraControl.userVisible || QGroundControl.settingsManager.flyViewSettings.updateHomePosition.userVisible || QGroundControl.settingsManager.flyViewSettings.enableAutomaticMissionPopups.userVisible),
            (QGroundControl.settingsManager.flyViewSettings.guidedMinimumAltitude.userVisible || QGroundControl.settingsManager.flyViewSettings.guidedMaximumAltitude.userVisible || QGroundControl.settingsManager.flyViewSettings.maxGoToLocationDistance.userVisible || QGroundControl.settingsManager.flyViewSettings.forwardFlightGoToLocationLoiterRad.userVisible || QGroundControl.settingsManager.flyViewSettings.goToLocationRequiresConfirmInGuided.userVisible),
            true,
            (QGroundControl.settingsManager.appSettings.virtualJoystick.userVisible || QGroundControl.settingsManager.appSettings.virtualJoystickAutoCenterThrottle.userVisible || QGroundControl.settingsManager.appSettings.virtualJoystickLeftHandedMode.userVisible),
            (QGroundControl.settingsManager.flyViewSettings.showAdditionalIndicatorsCompass.userVisible || QGroundControl.settingsManager.flyViewSettings.lockNoseUpCompass.userVisible || QGroundControl.settingsManager.flyViewSettings.instrumentQmlFile2.userVisible)
        ]
    }

    property QtObject _page7SectionState: QtObject {
        property var settingsManager: QGroundControl.settingsManager
        property var logSettings: settingsManager.logManagerSettings
        property var diskLoggingEnabledValue: logSettings.diskLoggingEnabled.rawValue
        property var logSavePath: settingsManager.appSettings.logSavePath
        property var _sectionVisibility: [
            (QGroundControl.settingsManager.logManagerSettings.diskLoggingEnabled.userVisible || QGroundControl.settingsManager.logManagerSettings.diskLoggingMaxFileSizeMB.userVisible || QGroundControl.settingsManager.logManagerSettings.diskLoggingMaxBackupFiles.userVisible || QGroundControl.settingsManager.logManagerSettings.saveFormat.userVisible),
            (QGroundControl.settingsManager.appSettings.showAppLogTimestampAsElapsedTime.userVisible || QGroundControl.settingsManager.appSettings.gstDebugLevel.userVisible)
        ]
    }

    property QtObject _page12SectionState: QtObject {
        property var ridSettings: QGroundControl.settingsManager.remoteIDSettings
        property bool isEURegion: ridSettings.region.rawValue === RemoteIDSettings.RegionOperation.EU
        property bool isFAARegion: ridSettings.region.rawValue === RemoteIDSettings.RegionOperation.FAA
        property var sendBasicIDOn: ridSettings.sendBasicID.rawValue
        property var sendSelfIDOn: ridSettings.sendSelfID.rawValue
        property bool locationIsFixed: ridSettings.locationType.rawValue === RemoteIDSettings.LocationType.FIXED
        property bool classificationIsEU: ridSettings.classificationType.rawValue === RemoteIDSettings.ClassificationType.EU
        property var _sectionVisibility: [
            (QGroundControl.settingsManager.remoteIDSettings.region.userVisible),
            (QGroundControl.settingsManager.remoteIDSettings.sendBasicID.userVisible || QGroundControl.settingsManager.remoteIDSettings.basicIDType.userVisible || QGroundControl.settingsManager.remoteIDSettings.basicIDUaType.userVisible || QGroundControl.settingsManager.remoteIDSettings.basicID.userVisible),
            (QGroundControl.settingsManager.remoteIDSettings.sendOperatorID.userVisible || QGroundControl.settingsManager.remoteIDSettings.operatorIDType.userVisible || QGroundControl.settingsManager.remoteIDSettings.operatorIDEU.userVisible || QGroundControl.settingsManager.remoteIDSettings.operatorIDFAA.userVisible),
            (QGroundControl.settingsManager.remoteIDSettings.sendSelfID.userVisible || QGroundControl.settingsManager.remoteIDSettings.selfIDType.userVisible || QGroundControl.settingsManager.remoteIDSettings.selfIDFree.userVisible || QGroundControl.settingsManager.remoteIDSettings.selfIDExtended.userVisible || QGroundControl.settingsManager.remoteIDSettings.selfIDEmergency.userVisible),
            (QGroundControl.settingsManager.remoteIDSettings.locationType.userVisible || QGroundControl.settingsManager.remoteIDSettings.latitudeFixed.userVisible || QGroundControl.settingsManager.remoteIDSettings.longitudeFixed.userVisible || QGroundControl.settingsManager.remoteIDSettings.altitudeFixed.userVisible),
            true,
            true,
            (isEURegion) && (QGroundControl.settingsManager.remoteIDSettings.classificationType.userVisible || QGroundControl.settingsManager.remoteIDSettings.categoryEU.userVisible || QGroundControl.settingsManager.remoteIDSettings.classEU.userVisible)
        ]
    }

    property QtObject _page14SectionState: QtObject {
        property var videoSource: QGroundControl.settingsManager.videoSettings.videoSource.rawValue
        property var autoStreamConfig: QGroundControl.videoManager.autoStreamConfigured
        property bool sourceDisabled: videoSource === QGroundControl.settingsManager.videoSettings.disabledVideoSource
        property var isStreamSource: QGroundControl.videoManager.isStreamSource
        property var rtpLatencyVisible: !QGroundControl.settingsManager.videoSettings.lowLatencyMode.rawValue
        property var _sectionVisibility: [
            (QGroundControl.settingsManager.videoSettings.videoSource.userVisible),
            (!sourceDisabled && !autoStreamConfig) && (QGroundControl.settingsManager.videoSettings.rtspUrl.userVisible || QGroundControl.settingsManager.videoSettings.tcpUrl.userVisible || QGroundControl.settingsManager.videoSettings.udpUrl.userVisible),
            (!sourceDisabled) && (QGroundControl.settingsManager.videoSettings.aspectRatio.userVisible || QGroundControl.settingsManager.videoSettings.disableWhenDisarmed.userVisible || QGroundControl.settingsManager.videoSettings.lowLatencyMode.userVisible || QGroundControl.settingsManager.videoSettings.rtpJitterLatencyMs.userVisible || QGroundControl.settingsManager.videoSettings.rtspAutoReconnect.userVisible || QGroundControl.settingsManager.videoSettings.forceCpuVideoPath.userVisible || QGroundControl.settingsManager.videoSettings.forceVideoDecoder.userVisible),
            (!sourceDisabled) && (QGroundControl.settingsManager.videoSettings.recordingFormat.userVisible || QGroundControl.settingsManager.videoSettings.enableStorageLimit.userVisible || QGroundControl.settingsManager.videoSettings.maxVideoSize.userVisible)
        ]
    }


    ListElement {
        name: qsTranslate("SettingsPages.json", "General")
        nameKey: "General"
        url: "qrc:/qml/QGroundControl/AppSettings/GeneralSettings.qml"
        iconUrl: "qrc:/res/QGCLogoWhite.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("General.SettingsUI.json", "General"),
                    searchTerms: ["general language locale color scheme dark mode theme palette follow me audio volume sound gstreamer debug level ui scale font size zoom save path storage reset clear settings factory reset", qsTranslate("General.SettingsUI.json", "General").toLowerCase(), qsTranslate("General.SettingsUI.json", "language").toLowerCase(), qsTranslate("General.SettingsUI.json", "locale").toLowerCase(), qsTranslate("General.SettingsUI.json", "color scheme").toLowerCase(), qsTranslate("General.SettingsUI.json", "dark mode").toLowerCase(), qsTranslate("General.SettingsUI.json", "theme").toLowerCase(), qsTranslate("General.SettingsUI.json", "palette").toLowerCase(), qsTranslate("General.SettingsUI.json", "follow me").toLowerCase(), qsTranslate("General.SettingsUI.json", "audio").toLowerCase(), qsTranslate("General.SettingsUI.json", "volume").toLowerCase(), qsTranslate("General.SettingsUI.json", "sound").toLowerCase(), qsTranslate("General.SettingsUI.json", "gstreamer").toLowerCase(), qsTranslate("General.SettingsUI.json", "debug level").toLowerCase(), qsTranslate("General.SettingsUI.json", "ui scale").toLowerCase(), qsTranslate("General.SettingsUI.json", "font size").toLowerCase(), qsTranslate("General.SettingsUI.json", "zoom").toLowerCase(), qsTranslate("General.SettingsUI.json", "save path").toLowerCase(), qsTranslate("General.SettingsUI.json", "storage").toLowerCase(), qsTranslate("General.SettingsUI.json", "reset").toLowerCase(), qsTranslate("General.SettingsUI.json", "clear settings").toLowerCase(), qsTranslate("General.SettingsUI.json", "factory reset").toLowerCase()],
                    visible: _page0SectionState._sectionVisibility[0]
                },
                {
                    index: 1,
                    name: qsTranslate("General.SettingsUI.json", "Vehicle Preferences"),
                    searchTerms: ["general vehicle preferences firmware ardupilot px4 vehicle multirotor fixed wing vtol rover sub", qsTranslate("General.SettingsUI.json", "Vehicle Preferences").toLowerCase(), qsTranslate("General.SettingsUI.json", "firmware").toLowerCase(), qsTranslate("General.SettingsUI.json", "ardupilot").toLowerCase(), qsTranslate("General.SettingsUI.json", "px4").toLowerCase(), qsTranslate("General.SettingsUI.json", "vehicle").toLowerCase(), qsTranslate("General.SettingsUI.json", "multirotor").toLowerCase(), qsTranslate("General.SettingsUI.json", "fixed wing").toLowerCase(), qsTranslate("General.SettingsUI.json", "vtol").toLowerCase(), qsTranslate("General.SettingsUI.json", "rover").toLowerCase(), qsTranslate("General.SettingsUI.json", "sub").toLowerCase()],
                    visible: _page0SectionState._sectionVisibility[1]
                },
                {
                    index: 2,
                    name: qsTranslate("General.SettingsUI.json", "Units"),
                    searchTerms: ["general units metric imperial distance speed area temperature feet meters", qsTranslate("General.SettingsUI.json", "Units").toLowerCase(), qsTranslate("General.SettingsUI.json", "units").toLowerCase(), qsTranslate("General.SettingsUI.json", "metric").toLowerCase(), qsTranslate("General.SettingsUI.json", "imperial").toLowerCase(), qsTranslate("General.SettingsUI.json", "distance").toLowerCase(), qsTranslate("General.SettingsUI.json", "speed").toLowerCase(), qsTranslate("General.SettingsUI.json", "area").toLowerCase(), qsTranslate("General.SettingsUI.json", "temperature").toLowerCase(), qsTranslate("General.SettingsUI.json", "feet").toLowerCase(), qsTranslate("General.SettingsUI.json", "meters").toLowerCase()],
                    visible: _page0SectionState._sectionVisibility[2]
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Fly View")
        nameKey: "Fly View"
        url: "qrc:/qml/QGroundControl/AppSettings/FlyViewSettings.qml"
        iconUrl: "qrc:/qmlimages/PaperPlane.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("FlyView.SettingsUI.json", "General"),
                    searchTerms: ["fly view general checklist preflight multi vehicle center map log replay camera control home position mission popup", qsTranslate("FlyView.SettingsUI.json", "General").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "checklist").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "preflight").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "multi vehicle").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "center map").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "log replay").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "camera control").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "home position").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "mission popup").toLowerCase()],
                    visible: _page1SectionState._sectionVisibility[0]
                },
                {
                    index: 1,
                    name: qsTranslate("FlyView.SettingsUI.json", "Guided Commands"),
                    searchTerms: ["fly view guided commands altitude guided minimum maximum goto go to loiter radius confirmation", qsTranslate("FlyView.SettingsUI.json", "Guided Commands").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "altitude").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "guided").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "minimum").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "maximum").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "goto").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "go to").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "loiter radius").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "confirmation").toLowerCase()],
                    visible: _page1SectionState._sectionVisibility[1]
                },
                {
                    index: 2,
                    name: qsTranslate("FlyView.SettingsUI.json", "MAVLink Actions"),
                    searchTerms: ["fly view mavlink actions mavlink action pre-arm post-arm disarm", qsTranslate("FlyView.SettingsUI.json", "MAVLink Actions").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "mavlink action").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "pre-arm").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "post-arm").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "disarm").toLowerCase()],
                    visible: _page1SectionState._sectionVisibility[2]
                },
                {
                    index: 3,
                    name: qsTranslate("FlyView.SettingsUI.json", "Virtual Joystick"),
                    searchTerms: ["fly view virtual joystick joystick virtual stick throttle left handed auto center", qsTranslate("FlyView.SettingsUI.json", "Virtual Joystick").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "joystick").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "virtual stick").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "throttle").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "left handed").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "auto center").toLowerCase()],
                    visible: _page1SectionState._sectionVisibility[3]
                },
                {
                    index: 4,
                    name: qsTranslate("FlyView.SettingsUI.json", "Instrument Panel"),
                    searchTerms: ["fly view instrument panel compass indicators hud instrument nose up", qsTranslate("FlyView.SettingsUI.json", "Instrument Panel").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "compass").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "indicators").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "hud").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "instrument").toLowerCase(), qsTranslate("FlyView.SettingsUI.json", "nose up").toLowerCase()],
                    visible: _page1SectionState._sectionVisibility[4]
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "3D View")
        nameKey: "3D View"
        url: "qrc:/qml/QGroundControl/AppSettings/Viewer3DSettings.qml"
        iconUrl: "qrc:/qml/QGroundControl/Viewer3D/City3DMapIcon.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("Viewer3D.SettingsUI.json", "General"),
                    searchTerms: ["3d view general 3d map enable 3d map provider", qsTranslate("Viewer3D.SettingsUI.json", "General").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "3d view").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "3d map").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "enable 3d").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "map provider").toLowerCase()],
                    visible: (QGroundControl.settingsManager.viewer3DSettings.enabled.userVisible || QGroundControl.settingsManager.viewer3DSettings.mapProvider.userVisible || QGroundControl.settingsManager.viewer3DSettings.keepSceneAlive.userVisible)
                },
                {
                    index: 1,
                    name: qsTranslate("Viewer3D.SettingsUI.json", "Data"),
                    searchTerms: ["3d view data osm openstreetmap 3d data building height altitude bias", qsTranslate("Viewer3D.SettingsUI.json", "Data").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "osm").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "openstreetmap").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "3d data").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "building height").toLowerCase(), qsTranslate("Viewer3D.SettingsUI.json", "altitude bias").toLowerCase()],
                    visible: (QGroundControl.settingsManager.viewer3DSettings.osmFilePath.userVisible || QGroundControl.settingsManager.viewer3DSettings.osmFilePath.userVisible || QGroundControl.settingsManager.viewer3DSettings.buildingLevelHeight.userVisible || QGroundControl.settingsManager.viewer3DSettings.altitudeBias.userVisible)
                }
            ]
        }
        pageVisible: function() { return QGroundControl.settingsManager.viewer3DSettings.userVisible }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Plan View")
        nameKey: "Plan View"
        url: "qrc:/qml/QGroundControl/AppSettings/PlanViewSettings.qml"
        iconUrl: "qrc:/qmlimages/Plan.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("PlanView.SettingsUI.json", "General"),
                    searchTerms: ["plan view general mission altitude default altitude vtol transition condition gate takeoff landing pattern waypoint", qsTranslate("PlanView.SettingsUI.json", "General").toLowerCase(), qsTranslate("PlanView.SettingsUI.json", "mission altitude").toLowerCase(), qsTranslate("PlanView.SettingsUI.json", "default altitude").toLowerCase(), qsTranslate("PlanView.SettingsUI.json", "vtol transition").toLowerCase(), qsTranslate("PlanView.SettingsUI.json", "condition gate").toLowerCase(), qsTranslate("PlanView.SettingsUI.json", "takeoff").toLowerCase(), qsTranslate("PlanView.SettingsUI.json", "landing pattern").toLowerCase(), qsTranslate("PlanView.SettingsUI.json", "waypoint").toLowerCase()],
                    visible: (QGroundControl.settingsManager.appSettings.defaultMissionItemAltitude.userVisible || QGroundControl.settingsManager.planViewSettings.vtolTransitionDistance.userVisible || QGroundControl.settingsManager.planViewSettings.useConditionGate.userVisible || QGroundControl.settingsManager.planViewSettings.takeoffItemNotRequired.userVisible || QGroundControl.settingsManager.planViewSettings.allowMultipleLandingPatterns.userVisible)
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: "Divider"
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "ADSB Server")
        nameKey: "ADSB Server"
        url: "qrc:/qml/QGroundControl/AppSettings/ADSBServerSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/airplane.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("ADSBVehicleManager.SettingsUI.json", "ADSB Server"),
                    searchTerms: ["adsb server adsb ads-b traffic aircraft tracking sbs server host port", qsTranslate("ADSBVehicleManager.SettingsUI.json", "ADSB Server").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "adsb").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "ads-b").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "traffic").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "aircraft").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "tracking").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "sbs").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "server").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "host").toLowerCase(), qsTranslate("ADSBVehicleManager.SettingsUI.json", "port").toLowerCase()],
                    visible: (QGroundControl.settingsManager.adsbVehicleManagerSettings.adsbServerConnectEnabled.userVisible || QGroundControl.settingsManager.adsbVehicleManagerSettings.adsbServerHostAddress.userVisible || QGroundControl.settingsManager.adsbVehicleManagerSettings.adsbServerPort.userVisible)
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Comm Links")
        nameKey: "Comm Links"
        url: "qrc:/qml/QGroundControl/AppSettings/CommLinksSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/usb.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("CommLinks.SettingsUI.json", "Link Management"),
                    searchTerms: ["comm links link management link connection serial tcp udp bluetooth add link", qsTranslate("CommLinks.SettingsUI.json", "Link Management").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "link").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "connection").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "serial").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "tcp").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "udp").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "bluetooth").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "add link").toLowerCase()],
                    visible: true
                },
                {
                    index: 1,
                    name: qsTranslate("CommLinks.SettingsUI.json", "NMEA GPS"),
                    searchTerms: ["comm links nmea gps nmea gps serial baud rate external gps", qsTranslate("CommLinks.SettingsUI.json", "NMEA GPS").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "nmea").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "gps").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "serial").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "baud rate").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "external gps").toLowerCase()],
                    visible: true
                },
                {
                    index: 2,
                    name: qsTranslate("CommLinks.SettingsUI.json", "Android Serial"),
                    searchTerms: ["comm links android serial serial posix uart tty android", qsTranslate("CommLinks.SettingsUI.json", "Android Serial").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "serial").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "posix").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "uart").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "tty").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "android").toLowerCase()],
                    visible: (QGroundControl.settingsManager.appSettings.androidUsePosixSerial.userVisible)
                },
                {
                    index: 3,
                    name: qsTranslate("CommLinks.SettingsUI.json", "AutoConnect"),
                    searchTerms: ["comm links autoconnect auto connect pixhawk sik radio librepilot udp rtk gps usb", qsTranslate("CommLinks.SettingsUI.json", "AutoConnect").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "auto connect").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "pixhawk").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "sik radio").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "librepilot").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "udp").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "rtk gps").toLowerCase(), qsTranslate("CommLinks.SettingsUI.json", "usb").toLowerCase()],
                    visible: (QGroundControl.settingsManager.autoConnectSettings.userVisible) && (QGroundControl.settingsManager.autoConnectSettings.autoConnectPixhawk.userVisible || QGroundControl.settingsManager.autoConnectSettings.autoConnectSiKRadio.userVisible || QGroundControl.settingsManager.autoConnectSettings.autoConnectLibrePilot.userVisible || QGroundControl.settingsManager.autoConnectSettings.autoConnectUDP.userVisible || QGroundControl.settingsManager.autoConnectSettings.autoConnectRTKGPS.userVisible)
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "App Logging")
        nameKey: "App Logging"
        url: "qrc:/qml/QGroundControl/AppSettings/LoggingSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/conversation.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("Logging.SettingsUI.json", "Save To Disk"),
                    searchTerms: ["app logging save to disk disk logging file flush save path compression rotation backup", qsTranslate("Logging.SettingsUI.json", "Save To Disk").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "disk").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "logging").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "file").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "flush").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "save").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "path").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "compression").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "rotation").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "backup").toLowerCase()],
                    visible: _page7SectionState._sectionVisibility[0]
                },
                {
                    index: 1,
                    name: qsTranslate("Logging.SettingsUI.json", "Log Viewer"),
                    searchTerms: ["app logging log viewer console buffer entries elapsed timestamp time gstreamer debug", qsTranslate("Logging.SettingsUI.json", "Log Viewer").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "console").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "buffer").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "entries").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "elapsed").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "timestamp").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "time").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "gstreamer").toLowerCase(), qsTranslate("Logging.SettingsUI.json", "debug").toLowerCase()],
                    visible: _page7SectionState._sectionVisibility[1]
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "App Log Viewer")
        nameKey: "App Log Viewer"
        url: "qrc:/qml/QGroundControl/AppSettings/AppLogging.qml"
        iconUrl: "qrc:/InstrumentValueIcons/conversation.svg"
        sections: function() {
            return [
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Maps")
        nameKey: "Maps"
        url: "qrc:/qml/QGroundControl/AppSettings/MapsSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/globe.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("Maps.SettingsUI.json", "Map Provider"),
                    searchTerms: ["maps map provider satellite terrain street hybrid google bing", qsTranslate("Maps.SettingsUI.json", "Map Provider").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "map provider").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "satellite").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "terrain").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "street").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "hybrid").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "google").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "bing").toLowerCase()],
                    visible: true
                },
                {
                    index: 1,
                    name: qsTranslate("Maps.SettingsUI.json", "Offline Maps"),
                    searchTerms: ["maps offline maps offline download cache tile set", qsTranslate("Maps.SettingsUI.json", "Offline Maps").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "offline").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "download").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "cache").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "tile set").toLowerCase()],
                    visible: true
                },
                {
                    index: 2,
                    name: qsTranslate("Maps.SettingsUI.json", "Tokens"),
                    searchTerms: ["maps tokens token api key tianditu mapbox esri vworld openaip", qsTranslate("Maps.SettingsUI.json", "Tokens").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "token").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "api key").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "tianditu").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "mapbox").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "esri").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "vworld").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "openaip").toLowerCase()],
                    visible: (QGroundControl.settingsManager.appSettings.tiandituToken.userVisible || QGroundControl.settingsManager.appSettings.mapboxToken.userVisible || QGroundControl.settingsManager.appSettings.esriToken.userVisible || QGroundControl.settingsManager.appSettings.vworldToken.userVisible || QGroundControl.settingsManager.appSettings.openaipToken.userVisible)
                },
                {
                    index: 3,
                    name: qsTranslate("Maps.SettingsUI.json", "Mapbox Login"),
                    searchTerms: ["maps mapbox login mapbox account style", qsTranslate("Maps.SettingsUI.json", "Mapbox Login").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "mapbox").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "account").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "style").toLowerCase()],
                    visible: (QGroundControl.settingsManager.appSettings.mapboxAccount.userVisible || QGroundControl.settingsManager.appSettings.mapboxStyle.userVisible)
                },
                {
                    index: 4,
                    name: qsTranslate("Maps.SettingsUI.json", "Custom Map URL"),
                    searchTerms: ["maps custom map url custom map wms tile url tile server", qsTranslate("Maps.SettingsUI.json", "Custom Map URL").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "custom map").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "wms").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "tile url").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "tile server").toLowerCase()],
                    visible: (QGroundControl.settingsManager.appSettings.customURL.userVisible)
                },
                {
                    index: 5,
                    name: qsTranslate("Maps.SettingsUI.json", "Tile Cache"),
                    searchTerms: ["maps tile cache cache disk size memory size", qsTranslate("Maps.SettingsUI.json", "Tile Cache").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "cache").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "disk size").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "memory size").toLowerCase(), qsTranslate("Maps.SettingsUI.json", "tile cache").toLowerCase()],
                    visible: (QGroundControl.settingsManager.mapsSettings.maxCacheDiskSize.userVisible || QGroundControl.settingsManager.mapsSettings.maxCacheMemorySize.userVisible)
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "NTRIP/RTK")
        nameKey: "NTRIP/RTK"
        url: "qrc:/qml/QGroundControl/AppSettings/NTRIPSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/globe.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("NTRIP.SettingsUI.json", "Connection"),
                    searchTerms: ["ntrip/rtk connection ntrip rtk connection status corrections", qsTranslate("NTRIP.SettingsUI.json", "Connection").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "ntrip").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "rtk").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "connection status").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "corrections").toLowerCase()],
                    visible: true
                },
                {
                    index: 1,
                    name: qsTranslate("NTRIP.SettingsUI.json", "Server Settings"),
                    searchTerms: ["ntrip/rtk server settings ntrip server rtk caster host port username password mountpoint", qsTranslate("NTRIP.SettingsUI.json", "Server Settings").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "ntrip server").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "rtk").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "caster").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "host").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "port").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "username").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "password").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "mountpoint").toLowerCase()],
                    visible: true
                },
                {
                    index: 2,
                    name: qsTranslate("NTRIP.SettingsUI.json", "Mountpoint Browser"),
                    searchTerms: ["ntrip/rtk mountpoint browser mountpoint browse stream", qsTranslate("NTRIP.SettingsUI.json", "Mountpoint Browser").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "mountpoint").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "browse").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "stream").toLowerCase()],
                    visible: true
                },
                {
                    index: 3,
                    name: qsTranslate("NTRIP.SettingsUI.json", "GGA Position Reporting"),
                    searchTerms: ["ntrip/rtk gga position reporting gga vrs nmea position network rtk ntrip", qsTranslate("NTRIP.SettingsUI.json", "GGA Position Reporting").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "gga").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "vrs").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "nmea").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "position").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "network rtk").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "ntrip").toLowerCase()],
                    visible: (QGroundControl.settingsManager.ntripSettings.ntripGgaPositionSource.userVisible || QGroundControl.settingsManager.ntripSettings.ntripGgaIntervalSec.userVisible)
                },
                {
                    index: 4,
                    name: qsTranslate("NTRIP.SettingsUI.json", "Options"),
                    searchTerms: ["ntrip/rtk options rtcm whitelist message filter ntrip", qsTranslate("NTRIP.SettingsUI.json", "Options").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "rtcm").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "whitelist").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "message filter").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "ntrip").toLowerCase()],
                    visible: (QGroundControl.settingsManager.ntripSettings.ntripWhitelist.userVisible)
                },
                {
                    index: 5,
                    name: qsTranslate("NTRIP.SettingsUI.json", "UDP Forwarding"),
                    searchTerms: ["ntrip/rtk udp forwarding udp forward relay corrections forward rtcm", qsTranslate("NTRIP.SettingsUI.json", "UDP Forwarding").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "udp forward").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "relay").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "corrections forward").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "rtcm").toLowerCase()],
                    visible: (QGroundControl.settingsManager.ntripSettings.ntripUdpForwardEnabled.userVisible || QGroundControl.settingsManager.ntripSettings.ntripUdpTargetAddress.userVisible || QGroundControl.settingsManager.ntripSettings.ntripUdpTargetPort.userVisible)
                },
                {
                    index: 6,
                    name: qsTranslate("NTRIP.SettingsUI.json", "UDP RTCM Input"),
                    searchTerms: ["ntrip/rtk udp rtcm input udp rtcm", qsTranslate("NTRIP.SettingsUI.json", "UDP RTCM Input").toLowerCase(), qsTranslate("NTRIP.SettingsUI.json", "udp rtcm").toLowerCase()],
                    visible: (QGroundControl.settingsManager.ntripSettings.rtcmUdpInputEnabled.userVisible || QGroundControl.settingsManager.ntripSettings.rtcmUdpInputPort.userVisible || QGroundControl.settingsManager.ntripSettings.rtcmUdpValidate.userVisible)
                }
            ]
        }
        pageVisible: function() { return QGroundControl.settingsManager && QGroundControl.settingsManager.ntripSettings !== undefined }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "PX4 Log Transfer")
        nameKey: "PX4 Log Transfer"
        url: "qrc:/qml/QGroundControl/AppSettings/PX4LogTransferSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/inbox-download.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("PX4LogTransfer.SettingsUI.json", "Log Control"),
                    searchTerms: ["px4 log transfer log control px4 log logging start log stop log auto log", qsTranslate("PX4LogTransfer.SettingsUI.json", "Log Control").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "px4 log").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "logging").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "start log").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "stop log").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "auto log").toLowerCase()],
                    visible: true
                },
                {
                    index: 1,
                    name: qsTranslate("PX4LogTransfer.SettingsUI.json", "Upload Settings"),
                    searchTerms: ["px4 log transfer upload settings upload flight review email description wind rating", qsTranslate("PX4LogTransfer.SettingsUI.json", "Upload Settings").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "upload").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "flight review").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "email").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "description").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "wind").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "rating").toLowerCase()],
                    visible: true
                },
                {
                    index: 2,
                    name: qsTranslate("PX4LogTransfer.SettingsUI.json", "Log Files"),
                    searchTerms: ["px4 log transfer log files download delete upload logs", qsTranslate("PX4LogTransfer.SettingsUI.json", "Log Files").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "log files").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "download").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "delete").toLowerCase(), qsTranslate("PX4LogTransfer.SettingsUI.json", "upload logs").toLowerCase()],
                    visible: true
                }
            ]
        }
        pageVisible: function() { return QGroundControl.corePlugin.options.showPX4LogTransferOptions && QGroundControl.px4ProFirmwareSupported && (QGroundControl.multiVehicleManager.activeVehicle ? QGroundControl.multiVehicleManager.activeVehicle.px4Firmware : true) }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Remote ID")
        nameKey: "Remote ID"
        url: "qrc:/qml/QGroundControl/AppSettings/RemoteIDSettings.qml"
        iconUrl: "qrc:/qmlimages/RidIconManNoID.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("RemoteID.SettingsUI.json", "Region"),
                    searchTerms: ["remote id region faa eu regulation", qsTranslate("RemoteID.SettingsUI.json", "Region").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "region").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "faa").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "eu").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "remote id").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "regulation").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[0]
                },
                {
                    index: 1,
                    name: qsTranslate("RemoteID.SettingsUI.json", "Basic ID"),
                    searchTerms: ["remote id basic id serial number drone id ua type registration broadcast", qsTranslate("RemoteID.SettingsUI.json", "Basic ID").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "basic id").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "serial number").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "drone id").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "ua type").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "registration").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "broadcast").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[1]
                },
                {
                    index: 2,
                    name: qsTranslate("RemoteID.SettingsUI.json", "Operator ID"),
                    searchTerms: ["remote id operator id operator pilot registration broadcast", qsTranslate("RemoteID.SettingsUI.json", "Operator ID").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "operator").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "pilot").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "registration").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "broadcast").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[2]
                },
                {
                    index: 3,
                    name: qsTranslate("RemoteID.SettingsUI.json", "Self ID"),
                    searchTerms: ["remote id self id flight purpose emergency broadcast description", qsTranslate("RemoteID.SettingsUI.json", "Self ID").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "self id").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "flight purpose").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "emergency").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "broadcast").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "description").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[3]
                },
                {
                    index: 4,
                    name: qsTranslate("RemoteID.SettingsUI.json", "GroundStation Location"),
                    searchTerms: ["remote id groundstation location ground station gcs location latitude longitude altitude fixed position gnss", qsTranslate("RemoteID.SettingsUI.json", "GroundStation Location").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "ground station").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "gcs location").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "latitude").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "longitude").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "altitude").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "fixed position").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "gnss").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[4]
                },
                {
                    index: 5,
                    name: qsTranslate("RemoteID.SettingsUI.json", "GCS Position"),
                    searchTerms: ["remote id gcs position latitude longitude hdop", qsTranslate("RemoteID.SettingsUI.json", "GCS Position").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "latitude").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "longitude").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "hdop").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "gcs position").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[5]
                },
                {
                    index: 6,
                    name: qsTranslate("RemoteID.SettingsUI.json", "GPS Location"),
                    searchTerms: ["remote id gps location gps nmea hdop position", qsTranslate("RemoteID.SettingsUI.json", "GPS Location").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "gps").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "nmea").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "hdop").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "position").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[6]
                },
                {
                    index: 7,
                    name: qsTranslate("RemoteID.SettingsUI.json", "EU Vehicle Info"),
                    searchTerms: ["remote id eu vehicle info eu classification category class ce marking", qsTranslate("RemoteID.SettingsUI.json", "EU Vehicle Info").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "eu").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "classification").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "category").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "class").toLowerCase(), qsTranslate("RemoteID.SettingsUI.json", "ce marking").toLowerCase()],
                    visible: _page12SectionState._sectionVisibility[7]
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Telemetry")
        nameKey: "Telemetry"
        url: "qrc:/qml/QGroundControl/AppSettings/TelemetrySettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/drone.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("Telemetry.SettingsUI.json", "Ground Station"),
                    searchTerms: ["telemetry ground station system id mavlink id heartbeat initial download gcs", qsTranslate("Telemetry.SettingsUI.json", "Ground Station").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "system id").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "mavlink id").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "heartbeat").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "initial download").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "gcs").toLowerCase()],
                    visible: (QGroundControl.settingsManager.mavlinkSettings.gcsMavlinkSystemID.userVisible || QGroundControl.settingsManager.mavlinkSettings.sendGCSHeartbeat.userVisible || QGroundControl.settingsManager.mavlinkSettings.noInitialDownloadWhenFlying.userVisible)
                },
                {
                    index: 1,
                    name: qsTranslate("Telemetry.SettingsUI.json", "MAVLink Forwarding"),
                    searchTerms: ["telemetry mavlink forwarding forward relay mavlink forward host", qsTranslate("Telemetry.SettingsUI.json", "MAVLink Forwarding").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "forward").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "relay").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "mavlink forward").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "host").toLowerCase()],
                    visible: (QGroundControl.settingsManager.mavlinkSettings.forwardMavlink.userVisible || QGroundControl.settingsManager.mavlinkSettings.forwardMavlinkHostName.userVisible)
                },
                {
                    index: 2,
                    name: qsTranslate("Telemetry.SettingsUI.json", "Logging"),
                    searchTerms: ["telemetry logging telemetry log tlog save log recording csv", qsTranslate("Telemetry.SettingsUI.json", "Logging").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "telemetry log").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "tlog").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "save log").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "recording").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "csv").toLowerCase()],
                    visible: (QGroundControl.settingsManager.mavlinkSettings.telemetrySave.userVisible || QGroundControl.settingsManager.mavlinkSettings.telemetrySaveNotArmed.userVisible || QGroundControl.settingsManager.mavlinkSettings.saveCsvTelemetry.userVisible)
                },
                {
                    index: 3,
                    name: qsTranslate("Telemetry.SettingsUI.json", "Stream Rates (ArduPilot Only)"),
                    searchTerms: ["telemetry stream rates (ardupilot only) stream rate ardupilot apm raw sensors rc channels position rate", qsTranslate("Telemetry.SettingsUI.json", "Stream Rates (ArduPilot Only)").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "stream rate").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "ardupilot").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "apm").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "raw sensors").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "rc channels").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "position rate").toLowerCase()],
                    visible: (QGroundControl.apmFirmwareSupported) && (QGroundControl.settingsManager.mavlinkSettings.apmStartMavlinkStreams.userVisible || QGroundControl.settingsManager.apmMavlinkStreamRateSettings.streamRateRawSensors.userVisible || QGroundControl.settingsManager.apmMavlinkStreamRateSettings.streamRateExtendedStatus.userVisible || QGroundControl.settingsManager.apmMavlinkStreamRateSettings.streamRateRCChannels.userVisible || QGroundControl.settingsManager.apmMavlinkStreamRateSettings.streamRatePosition.userVisible || QGroundControl.settingsManager.apmMavlinkStreamRateSettings.streamRateExtra1.userVisible || QGroundControl.settingsManager.apmMavlinkStreamRateSettings.streamRateExtra2.userVisible || QGroundControl.settingsManager.apmMavlinkStreamRateSettings.streamRateExtra3.userVisible)
                },
                {
                    index: 4,
                    name: qsTranslate("Telemetry.SettingsUI.json", "Signing Key"),
                    searchTerms: ["telemetry signing key signing encryption key security mavlink2", qsTranslate("Telemetry.SettingsUI.json", "Signing Key").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "signing").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "encryption").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "key").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "security").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "mavlink2").toLowerCase()],
                    visible: true
                },
                {
                    index: 5,
                    name: qsTranslate("Telemetry.SettingsUI.json", "Link Status"),
                    searchTerms: ["telemetry link status packet loss received sent latency", qsTranslate("Telemetry.SettingsUI.json", "Link Status").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "link status").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "packet loss").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "received").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "sent").toLowerCase(), qsTranslate("Telemetry.SettingsUI.json", "latency").toLowerCase()],
                    visible: true
                }
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Video")
        nameKey: "Video"
        url: "qrc:/qml/QGroundControl/AppSettings/VideoSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/camera.svg"
        sections: function() {
            return [
                {
                    index: 0,
                    name: qsTranslate("Video.SettingsUI.json", "Video Source"),
                    searchTerms: ["video video source camera stream", qsTranslate("Video.SettingsUI.json", "Video Source").toLowerCase(), qsTranslate("Video.SettingsUI.json", "video source").toLowerCase(), qsTranslate("Video.SettingsUI.json", "camera").toLowerCase(), qsTranslate("Video.SettingsUI.json", "stream").toLowerCase()],
                    visible: _page14SectionState._sectionVisibility[0]
                },
                {
                    index: 1,
                    name: qsTranslate("Video.SettingsUI.json", "Connection"),
                    searchTerms: ["video connection rtsp tcp udp mpegts video url stream url", qsTranslate("Video.SettingsUI.json", "Connection").toLowerCase(), qsTranslate("Video.SettingsUI.json", "rtsp").toLowerCase(), qsTranslate("Video.SettingsUI.json", "tcp").toLowerCase(), qsTranslate("Video.SettingsUI.json", "udp").toLowerCase(), qsTranslate("Video.SettingsUI.json", "mpegts").toLowerCase(), qsTranslate("Video.SettingsUI.json", "video url").toLowerCase(), qsTranslate("Video.SettingsUI.json", "stream url").toLowerCase()],
                    visible: _page14SectionState._sectionVisibility[1]
                },
                {
                    index: 2,
                    name: qsTranslate("Video.SettingsUI.json", "Settings"),
                    searchTerms: ["video settings aspect ratio low latency decoder hardware decode disable when disarmed gpu zero-copy", qsTranslate("Video.SettingsUI.json", "Settings").toLowerCase(), qsTranslate("Video.SettingsUI.json", "aspect ratio").toLowerCase(), qsTranslate("Video.SettingsUI.json", "low latency").toLowerCase(), qsTranslate("Video.SettingsUI.json", "decoder").toLowerCase(), qsTranslate("Video.SettingsUI.json", "hardware decode").toLowerCase(), qsTranslate("Video.SettingsUI.json", "disable when disarmed").toLowerCase(), qsTranslate("Video.SettingsUI.json", "gpu").toLowerCase(), qsTranslate("Video.SettingsUI.json", "zero-copy").toLowerCase()],
                    visible: _page14SectionState._sectionVisibility[2]
                },
                {
                    index: 3,
                    name: qsTranslate("Video.SettingsUI.json", "Local Video Storage"),
                    searchTerms: ["video local video storage record recording format mp4 mkv storage limit video file", qsTranslate("Video.SettingsUI.json", "Local Video Storage").toLowerCase(), qsTranslate("Video.SettingsUI.json", "record").toLowerCase(), qsTranslate("Video.SettingsUI.json", "recording format").toLowerCase(), qsTranslate("Video.SettingsUI.json", "mp4").toLowerCase(), qsTranslate("Video.SettingsUI.json", "mkv").toLowerCase(), qsTranslate("Video.SettingsUI.json", "storage limit").toLowerCase(), qsTranslate("Video.SettingsUI.json", "video file").toLowerCase()],
                    visible: _page14SectionState._sectionVisibility[3]
                }
            ]
        }
        pageVisible: function() { return QGroundControl.settingsManager.videoSettings.userVisible }
    }

    // ===== FDE 新增（開始）=====
    ListElement {
        name: "Divider"
    }

    ListElement {
        name: "仿真與編隊"
        nameKey: "FdeSimCenter"
        url: "qrc:/qml/FDE/Ui/FdeSimCenterPage.qml"
        iconUrl: "qrc:/InstrumentValueIcons/drone.svg"
        sections: function() {
            return [
            ]
        }
        pageVisible: function() { return true }
    }
    // ===== FDE 新增（結束）=====

    ListElement {
        name: "Divider"
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Help")
        nameKey: "Help"
        url: "qrc:/qml/QGroundControl/AppSettings/HelpSettings.qml"
        iconUrl: "qrc:/InstrumentValueIcons/question.svg"
        sections: function() {
            return [
            ]
        }
        pageVisible: function() { return true }
    }

    ListElement {
        name: "Divider"
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Mock Link")
        nameKey: "Mock Link"
        url: "qrc:/qml/QGroundControl/AppSettings/MockLink.qml"
        iconUrl: "qrc:/InstrumentValueIcons/drone.svg"
        sections: function() {
            return [
            ]
        }
        pageVisible: function() { return ScreenTools.isDebug }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Debug")
        nameKey: "Debug"
        url: "qrc:/qml/QGroundControl/AppSettings/DebugWindow.qml"
        iconUrl: "qrc:/InstrumentValueIcons/bug.svg"
        sections: function() {
            return [
            ]
        }
        pageVisible: function() { return ScreenTools.isDebug }
    }

    ListElement {
        name: qsTranslate("SettingsPages.json", "Palette Test")
        nameKey: "Palette Test"
        url: "qrc:/qml/QGroundControl/AppSettings/QmlTest.qml"
        iconUrl: "qrc:/InstrumentValueIcons/photo.svg"
        sections: function() {
            return [
            ]
        }
        pageVisible: function() { return ScreenTools.isDebug }
    }
}
