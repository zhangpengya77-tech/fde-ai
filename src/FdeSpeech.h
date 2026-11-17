#pragma once

// FDE-QGC V1.0｜三語語音播報（zh-TW、zh-CN、en-US）
// - 使用 Qt TextToSpeech 與這台 Windows 已合法安裝的系統聲音，不下載、不上網。
// - 每種語言只用「該語言」的聲音：找不到 zh-TW 聲音時回報 BLOCKED，不拿 zh-CN 冒充台灣中文。
// - 優先挑女聲；沒有女聲時用該語言的其他聲音，並在 status() 裡清楚標示。
// - 語音只是輔助，不取代 QGC 原有的告警與語音。

#include <QtCore/QList>
#include <QtCore/QObject>
#include <QtCore/QVariantList>
#include <QtCore/QVariantMap>

class QTextToSpeech;

class FdeSpeech : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString engine READ engine CONSTANT)

public:
    explicit FdeSpeech(QObject *parent = nullptr);
    ~FdeSpeech() override;

    QString engine() const { return _engine; }

    /// 三語狀態：[{locale:"zh-TW", available, voice, gender, female, note}]
    Q_INVOKABLE QVariantList status() const;
    /// 用指定語言播報；該語言沒有聲音時回傳 false（不改用其他語言）
    Q_INVOKABLE bool speak(const QString &text, const QString &locale);
    Q_INVOKABLE void stop();
    /// 系統所有可用聲音（給設定頁顯示）
    Q_INVOKABLE QVariantList allVoices() const;

private:
    QVariantMap _pick(const QString &locale) const;

    QList<QTextToSpeech *> _engines;   // winrt、sapi（依序搜尋）
    QString _engine;
};
