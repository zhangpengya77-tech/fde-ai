#pragma once

// FDE-QGC V1.0｜QGC Custom Build 核心外掛
// - 依官方 custom-example 架構：QGCCorePlugin 子類別 + QML URL 覆寫攔截器。
// - 只「加」東西（左側導覽、浮動面板、教學頁、仿真訓練），不刪官方安全資訊與告警。
// - 不修改 QGC 原始碼；所有差異都在 custom/ 目錄。

#include <QtCore/QTranslator>
#include <QtQml/QQmlAbstractUrlInterceptor>

#include "QGCCorePlugin.h"
#include "QGCOptions.h"

class FdePlugin;
class FdeSpeech;
class FdeSitl;
class QQmlApplicationEngine;

class FdeFlyViewOptions : public QGCFlyViewOptions
{
    Q_OBJECT

public:
    explicit FdeFlyViewOptions(QGCOptions *options, QObject *parent = nullptr);

    /// V2-3：顯示官方多機清單（多機仿真、編隊飛行時可切換／勾選飛機；只有一架時官方會自動隱藏）
    bool showMultiVehicleList() const final { return true; }
};

class FdeOptions : public QGCOptions
{
    Q_OBJECT

public:
    explicit FdeOptions(QObject *parent = nullptr);

    QGCFlyViewOptions *flyViewOptions() const final { return _flyViewOptions; }

private:
    FdeFlyViewOptions *_flyViewOptions = nullptr;
};

class FdePlugin : public QGCCorePlugin
{
    Q_OBJECT

public:
    explicit FdePlugin(QObject *parent = nullptr);

    static QGCCorePlugin *instance();

    QGCOptions *options() final { return _options; }
    void adjustSettingMetaData(const QString &settingsGroup, FactMetaData &metaData, bool &userVisible) final;
    void paletteOverride(const QString &colorName, QGCPalette::PaletteColorInfo_t &colorInfo) final;
    QQmlApplicationEngine *createQmlApplicationEngine(QObject *parent) final;
    void destroyQmlApplicationEngine(QQmlApplicationEngine *qmlEngine) final;

private:
    /// 介面語言為繁體中文時安裝 FDE 的台灣正體翻譯，否則移除
    void _applyZhTwTranslator();

    QTranslator _zhTw;
    bool _zhTwInstalled = false;
    FdeOptions *_options = nullptr;
    FdeSpeech *_speech = nullptr;
    FdeSitl *_sitl = nullptr;
    QQmlApplicationEngine *_qmlEngine = nullptr;
    class FdeOverrideInterceptor *_urlInterceptor = nullptr;
};

/// 把 qrc:/qml/... 導向 qrc:/Custom/qml/...（只有 custom.qrc 內真的有覆寫檔時才導向）
class FdeOverrideInterceptor : public QQmlAbstractUrlInterceptor
{
public:
    QUrl intercept(const QUrl &url, QQmlAbstractUrlInterceptor::DataType type) final;
};
