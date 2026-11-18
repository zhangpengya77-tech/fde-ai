# ============================================================================
# FDE-QGC V1.0 Custom Build overlay（依官方 custom-example 架構）
# - 不修改 QGC 原始碼；所有差異都在 custom/。
# - C++：FdePlugin（核心外掛）、FdeWaypointTool（WGS84 精確航點／8 字航線）、FdeSpeech（三語語音）、FdeSitl（隔離 SITL）、FdeSwarm（多機仿真＋編隊）
# - QML 模組 FDE.Ui：導覽列、浮動面板、教學頁、仿真訓練頁
# - custom.qrc：覆寫官方 MainWindow.qml 與 FlyViewCustomLayer.qml，以及品牌圖示
# ============================================================================

message(STATUS "QGC: Adding FDE-QGC V1.0 custom plugin")

# ----------------------------------------------------------------------------
# 資源（QML 覆寫檔與品牌圖）
# ----------------------------------------------------------------------------
list(APPEND CUSTOM_RESOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/custom.qrc
)
set(QGC_RESOURCES ${QGC_RESOURCES} ${CUSTOM_RESOURCES} CACHE STRING "Paths to .qrc Resources" FORCE)

# ----------------------------------------------------------------------------
# QML 模組 FDE.Ui（qrc:/qml/FDE/Ui/...）
# ----------------------------------------------------------------------------
qt_add_library(FdeUiModule STATIC)

set(FDE_UI_QML
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeNavRail.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeFloatingPanel.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeFlightDataPanel.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeRcChannelsPanel.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeLicenseTeachPanel.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeTeachingPage.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeSimTrainingPage.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdePlanQuickPanel.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeLogAnalysisPage.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeLogDiagnosePage.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeTuningPage.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeQuickDataPanel.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeHudPanel.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeFigure8ExamPanel.qml
    # V2-3：仿真訓練中心（單機訓練＋多機編隊合為一頁）與飛行畫面「編隊飛行」浮動面板
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeSimCenterPage.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeSwarmLaunchControls.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeFormationControls.qml
    ${CMAKE_CURRENT_SOURCE_DIR}/qml/FdeFormationPanel.qml
)
# 讓資源路徑是 FDE/Ui/<檔名>，而不是 FDE/Ui/qml/<檔名>
qgc_set_qt_resource_alias(${FDE_UI_QML})

qt_add_qml_module(FdeUiModule
    URI FDE.Ui
    VERSION 1.0
    RESOURCE_PREFIX /qml
    QML_FILES ${FDE_UI_QML}
    NO_PLUGIN
)

# ----------------------------------------------------------------------------
# C++ 原始碼與編譯設定
# ----------------------------------------------------------------------------
set(CUSTOM_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeLogAnalyzer.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeLogAnalyzer.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSelfTest.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSelfTest.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdePlugin.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdePlugin.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSitl.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSitl.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSpeech.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSpeech.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSwarm.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeSwarm.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeWaypointTool.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/FdeWaypointTool.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/PrecisionWaypointMath.h
    CACHE INTERNAL "" FORCE
)

set(CUSTOM_LIBRARIES
    FdeUiModule
    Qt6::TextToSpeech
    CACHE INTERNAL "" FORCE
)

set(CUSTOM_INCLUDE_DIRECTORIES
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    CACHE INTERNAL "" FORCE
)

set(CUSTOM_DEFINITIONS
    QGC_CUSTOM_BUILD
    CUSTOMHEADER="FdePlugin.h"
    CUSTOMCLASS=FdePlugin
    CACHE INTERNAL "" FORCE
)

set(CUSTOM_QT_COMPONENTS
    Core
    TextToSpeech
    CACHE INTERNAL "" FORCE
)
