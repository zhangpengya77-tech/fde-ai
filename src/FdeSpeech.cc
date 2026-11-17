#include "FdeSpeech.h"

#include <QtCore/QLocale>
#include <QtTextToSpeech/QTextToSpeech>
#include <QtTextToSpeech/QVoice>

namespace {
QLocale toLocale(const QString &name)
{
    return QLocale(QString(name).replace(u'-', u'_'));
}

// 語言＋地區都要相符：zh-TW 不接受 zh-CN／zh-HK，en-US 不接受 en-GB
bool matches(const QLocale &voice, const QString &want)
{
    const QLocale w = toLocale(want);
    return voice.language() == w.language() && voice.territory() == w.territory();
}
} // namespace

FdeSpeech::FdeSpeech(QObject *parent) : QObject(parent)
{
    // Windows 上有兩套系統語音：winrt（OneCore 聲音）與 sapi（傳統 Desktop 聲音），
    // 兩者安裝的聲音不同（例如 en-US Zira 只在 sapi），所以兩個引擎都建立、依序搜尋。
    const QStringList engines = QTextToSpeech::availableEngines();
    for (const QString &name : {QStringLiteral("winrt"), QStringLiteral("sapi")}) {
        if (engines.contains(name)) {
            _engines.append(new QTextToSpeech(name, this));
        }
    }
    if (_engines.isEmpty()) {
        _engines.append(new QTextToSpeech(this));   // 其他平台：預設引擎
    }
    QStringList names;
    for (QTextToSpeech *t : std::as_const(_engines)) {
        names.append(t->engine());
    }
    _engine = names.join(QStringLiteral(" + "));
}

// 解構：QTextToSpeech 物件由 Qt 父子關係自動釋放
FdeSpeech::~FdeSpeech() = default;

// 列出所有引擎的所有聲音（設定頁顯示用）
QVariantList FdeSpeech::allVoices() const
{
    QVariantList out;
    for (QTextToSpeech *t : _engines) {
        for (const QVoice &v : t->availableVoices()) {
            out.append(QVariantMap{{"engine", t->engine()}, {"name", v.name()}, {"locale", v.locale().bcp47Name()}, {"gender", QVoice::genderName(v.gender())}});
        }
        // availableVoices() 只列出目前語系；再補上其他語系
        for (const QLocale &l : t->availableLocales()) {
            for (const QVoice &v : t->findVoices(l)) {
                const QVariantMap row{{"engine", t->engine()}, {"name", v.name()}, {"locale", v.locale().bcp47Name()}, {"gender", QVoice::genderName(v.gender())}};
                if (!out.contains(row)) {
                    out.append(row);
                }
            }
        }
    }
    return out;
}

// 為指定語言挑聲音：只接受「語言＋地區」完全相符，優先女聲
QVariantMap FdeSpeech::_pick(const QString &locale) const
{
    // 先找女聲；任何引擎有女聲就用，否則用第一個找到的該語言聲音
    QVariantMap best;
    for (int i = 0; i < _engines.size(); ++i) {
        QTextToSpeech *t = _engines.at(i);
        for (const QLocale &l : t->availableLocales()) {
            if (!matches(l, locale)) {
                continue;
            }
            for (const QVoice &v : t->findVoices(l)) {
                const bool female = v.gender() == QVoice::Female;
                if (best.isEmpty() || (female && !best.value("female").toBool())) {
                    best = QVariantMap{{"engineIndex", i}, {"engine", t->engine()}, {"voice", v.name()},
                                       {"gender", QVoice::genderName(v.gender())}, {"female", female}, {"voiceLocale", l.name()}};
                }
            }
        }
    }
    return best;
}

// 三語狀態（找不到就標 BLOCKED，絕不以其他語言替代）
QVariantList FdeSpeech::status() const
{
    QVariantList out;
    for (const QString &loc : {QStringLiteral("zh-TW"), QStringLiteral("zh-CN"), QStringLiteral("en-US")}) {
        const QVariantMap v = _pick(loc);
        QVariantMap row{{"locale", loc}, {"available", !v.isEmpty()}};
        row.insert(v);
        if (v.isEmpty()) {
            row["note"] = QStringLiteral("BLOCKED：這台 Windows 沒有安裝 %1 語音（不以其他語言替代）。可由系統管理員在 Windows「設定→時間與語言→語音」新增。").arg(loc);
        } else if (!v.value("female").toBool()) {
            row["note"] = QStringLiteral("有 %1 語音，但不是女聲").arg(loc);
        } else {
            row["note"] = QStringLiteral("可用（女聲）");
        }
        out.append(row);
    }
    return out;
}

// 播報：先停止前一句，再用挑到的引擎與聲音朗讀
bool FdeSpeech::speak(const QString &text, const QString &locale)
{
    const QVariantMap v = _pick(locale);
    if (v.isEmpty() || text.trimmed().isEmpty()) {
        return false;
    }
    stop();
    QTextToSpeech *t = _engines.at(v.value("engineIndex").toInt());
    const QLocale l(v.value("voiceLocale").toString());
    t->setLocale(l);
    for (const QVoice &voice : t->findVoices(l)) {
        if (voice.name() == v.value("voice").toString()) {
            t->setVoice(voice);
            break;
        }
    }
    t->say(text);
    return true;
}

// 停止所有引擎的播報
void FdeSpeech::stop()
{
    for (QTextToSpeech *t : std::as_const(_engines)) {
        t->stop();
    }
}
