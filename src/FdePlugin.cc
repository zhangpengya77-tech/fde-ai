#include "FdePlugin.h"
#include "FdeLogAnalyzer.h"
#include "FdeSelfTest.h"
#include "FdeSitl.h"
#include "FdeSpeech.h"
#include "FdeSwarm.h"
#include "FdeWaypointTool.h"

#include "AppSettings.h"
#include "Fact.h"
#include "SettingsManager.h"

#include <QtCore/QCoreApplication>
#include <QtCore/QLocale>
#include <QtCore/QTimer>
#include "QGCMAVLink.h"
#include "QGCPalette.h"
#include "QmlComponentInfo.h"

#include <QtCore/QApplicationStatic>
#include <QtCore/QFile>
#include <QtQml/QQmlApplicationEngine>
#include <QtQml/qqml.h>

// 全程式唯一的 FDE 外掛實例（QGC 透過 CUSTOMCLASS::instance() 取得）
Q_APPLICATION_STATIC(FdePlugin, _fdePluginInstance);

// 飛行畫面選項（V2-3 起開放多機清單，給多機仿真與編隊飛行使用）
FdeFlyViewOptions::FdeFlyViewOptions(QGCOptions *options, QObject *parent)
    : QGCFlyViewOptions(options, parent)
{
}

// QGC 全域選項：沿用官方預設，只換掉飛行畫面選項
FdeOptions::FdeOptions(QObject *parent)
    : QGCOptions(parent)
    , _flyViewOptions(new FdeFlyViewOptions(this, this))
{
}

// 「日誌」頁子選單：複製官方清單，在「日誌檢視器」後面插入「智能診斷」（原「日誌分析」頁）
// 官方項目、順序與內容都不變；找不到日誌檢視器時（行動版沒有）放在第一項。
const QVariantList &FdePlugin::analyzePages()
{
    if (_analyzePages.isEmpty()) {
        _analyzePages = QGCCorePlugin::analyzePages();
        qsizetype insertAt = 0;
        for (qsizetype i = 0; i < _analyzePages.size(); i++) {
            const QmlComponentInfo *info = _analyzePages.at(i).value<QmlComponentInfo *>();
            if (info && info->url().toString().endsWith(QStringLiteral("LogViewerPage.qml"))) {
                insertAt = i + 1;
                break;
            }
        }
        _analyzePages.insert(insertAt, QVariant::fromValue(new QmlComponentInfo(
            QStringLiteral("智能診斷"),
            QUrl::fromUserInput(QStringLiteral("qrc:/qml/FDE/Ui/FdeLogDiagnosePage.qml")),
            QUrl::fromUserInput(QStringLiteral("qrc:/qmlimages/OnboardLogIcon.svg")),
            this)));
    }
    return _analyzePages;
}

// 建構：建立選項物件；語音、SITL、日誌分析等在 createQmlApplicationEngine 時建立
FdePlugin::FdePlugin(QObject *parent)
    : QGCCorePlugin(parent)
    , _options(new FdeOptions(this))
{
}

// 提供給 QGCCorePlugin::instance() 使用
QGCCorePlugin *FdePlugin::instance()
{
    return _fdePluginInstance();
}

// 調整 QGC 設定預設值（不隱藏任何官方設定）
void FdePlugin::adjustSettingMetaData(const QString &settingsGroup, FactMetaData &metaData, bool &userVisible)
{
    QGCCorePlugin::adjustSettingMetaData(settingsGroup, metaData, userVisible);

    if (settingsGroup == AppSettings::settingsGroup) {
        // 教學機隊為 ArduPilot 多旋翼：離線規劃預設 ArduPilot／多旋翼（使用者仍可在設定中更改）
        if (metaData.name() == AppSettings::offlineEditingFirmwareClassName) {
            metaData.setRawDefaultValue(QGCMAVLink::FirmwareClassArduPilot);
        } else if (metaData.name() == AppSettings::offlineEditingVehicleClassName) {
            metaData.setRawDefaultValue(QGCMAVLink::VehicleClassMultiRotor);
        }
    }
}

// FDE 品牌色（藍色）
void FdePlugin::paletteOverride(const QString &colorName, QGCPalette::PaletteColorInfo_t &colorInfo)
{
    // 只調整品牌色，不動告警色（warningText／alert*／colorRed 維持官方值）
    const QColor fdeBlue("#1f6feb");
    const QColor fdeBlueLight("#cfe2ff");
    if (colorName == QStringLiteral("brandingBlue")) {
        colorInfo[QGCPalette::Dark][QGCPalette::ColorGroupEnabled] = fdeBlue;
        colorInfo[QGCPalette::Dark][QGCPalette::ColorGroupDisabled] = fdeBlue;
        colorInfo[QGCPalette::Light][QGCPalette::ColorGroupEnabled] = fdeBlue;
        colorInfo[QGCPalette::Light][QGCPalette::ColorGroupDisabled] = fdeBlue;
    } else if (colorName == QStringLiteral("primaryButton")) {
        colorInfo[QGCPalette::Dark][QGCPalette::ColorGroupEnabled] = fdeBlue;
        colorInfo[QGCPalette::Light][QGCPalette::ColorGroupEnabled] = fdeBlueLight;
    }
}

// 建立 QML 引擎：註冊 FDE.Tools 型別／單例、安裝繁中翻譯、掛上 QML 覆寫攔截器
QQmlApplicationEngine *FdePlugin::createQmlApplicationEngine(QObject *parent)
{
    // C++ 工具註冊到 QML 模組 FDE.Tools
    qmlRegisterType<FdeWaypointTool>("FDE.Tools", 1, 0, "FdeWaypointTool");
    _speech = new FdeSpeech(this);
    _sitl = new FdeSitl(this);
    qmlRegisterSingletonInstance("FDE.Tools", 1, 0, "FdeSpeech", _speech);
    qmlRegisterSingletonInstance("FDE.Tools", 1, 0, "FdeSitl", _sitl);
    // V2-3：多機仿真器＋編隊飛行
    qmlRegisterSingletonInstance("FDE.Tools", 1, 0, "FdeSwarm", new FdeSwarm(this));
    qmlRegisterSingletonInstance("FDE.Tools", 1, 0, "FdeLogAnalyzer", new FdeLogAnalyzer(this));
    qmlRegisterSingletonInstance("FDE.Tools", 1, 0, "FdeSelfTest", new FdeSelfTest(this));

    // 繁體中文介面：QGC 5.1.5 官方 zh_TW 翻譯全空，改載入由官方 zh_CN 以 OpenCC 轉成的台灣正體翻譯
    _applyZhTwTranslator();
    if (Fact *lang = SettingsManager::instance()->appSettings()->qLocaleLanguage()) {
        connect(lang, &Fact::rawValueChanged, this, [this]() {
            // 等 QGC 自己的 setLanguage() 完成後再判斷
            QTimer::singleShot(0, this, [this]() {
                _applyZhTwTranslator();
                if (_qmlEngine) {
                    _qmlEngine->retranslate();
                }
            });
        });
    }

    _qmlEngine = QGCCorePlugin::createQmlApplicationEngine(parent);
    _urlInterceptor = new FdeOverrideInterceptor();
    _qmlEngine->addUrlInterceptor(_urlInterceptor);
    return _qmlEngine;
}

// 依目前介面語系安裝或移除 FDE 台灣正體翻譯
void FdePlugin::_applyZhTwTranslator()
{
    const QLocale loc;   // QGC setLanguage() 已設定預設語系
    const bool traditional = loc.language() == QLocale::Chinese
        && (loc.script() == QLocale::TraditionalChineseScript || loc.territory() == QLocale::Taiwan || loc.territory() == QLocale::HongKong);
    if (traditional && !_zhTwInstalled) {
        if (_zhTw.load(QStringLiteral(":/fde/i18n/fde_qgc_zh_TW.qm"))) {
            QCoreApplication::installTranslator(&_zhTw);
            _zhTwInstalled = true;
        }
    } else if (!traditional && _zhTwInstalled) {
        QCoreApplication::removeTranslator(&_zhTw);
        _zhTwInstalled = false;
    }
}

// 關閉 QML 引擎前先移除攔截器，避免懸空指標
void FdePlugin::destroyQmlApplicationEngine(QQmlApplicationEngine *qmlEngine)
{
    if (qmlEngine && (qmlEngine == _qmlEngine)) {
        qmlEngine->removeUrlInterceptor(_urlInterceptor);
        delete _urlInterceptor;
        _urlInterceptor = nullptr;
        _qmlEngine = nullptr;
    }
    QGCCorePlugin::destroyQmlApplicationEngine(qmlEngine);
}

// 若 custom.qrc 有同路徑的覆寫檔（qrc:/Custom/...），就改用覆寫檔
QUrl FdeOverrideInterceptor::intercept(const QUrl &url, QQmlAbstractUrlInterceptor::DataType type)
{
    switch (type) {
    case QQmlAbstractUrlInterceptor::QmlFile:
    case QQmlAbstractUrlInterceptor::UrlString:
        if (url.scheme() == QStringLiteral("qrc")) {
            const QString overrideRes = QStringLiteral(":/Custom%1").arg(url.path());
            if (QFile::exists(overrideRes)) {
                QUrl result;
                result.setScheme(QStringLiteral("qrc"));
                result.setPath(overrideRes.mid(1));
                return result;
            }
        }
        break;
    default:
        break;
    }
    return url;
}
