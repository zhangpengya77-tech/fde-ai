#include "FdeSelfTest.h"

#include <QtCore/QCoreApplication>
#include <QtCore/QDateTime>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QStandardPaths>
#include <QtGui/QImage>
#include <QtQuick/QQuickWindow>

#include <cstdlib>

// 讀取環境變數：沒有設定 FDE_QGC_SELFTEST 時 pages 為空，MainWindow 的自我測試計時器不會啟動
FdeSelfTest::FdeSelfTest(QObject *parent) : QObject(parent)
{
    const QString spec = qEnvironmentVariable("FDE_QGC_SELFTEST");
    if (!spec.isEmpty()) {
        _pages = spec.split(QLatin1Char(','), Qt::SkipEmptyParts);
    }
    _outDir = qEnvironmentVariable("FDE_QGC_SELFTEST_OUT");
    if (_outDir.isEmpty()) {
        _outDir = QDir(QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation)).filePath(QStringLiteral("FDE-QGC/SelfTest"));
    }
    if (!_pages.isEmpty()) {
        QDir().mkpath(_outDir);
    }
}

// 擷取整個主視窗畫面（離屏模式也可用）；結果與尺寸寫入 selftest.log 作為驗收證據
bool FdeSelfTest::grab(QObject *window, const QString &name) const
{
    auto *w = qobject_cast<QQuickWindow *>(window);
    if (!w) {
        log(QStringLiteral("grab %1: not a QQuickWindow").arg(name));
        return false;
    }
    const QImage img = w->grabWindow();
    QString safe = name;
    safe.replace(QLatin1Char(':'), QLatin1Char('_'));   // Windows 檔名不可含冒號
    const QString path = QDir(_outDir).filePath(safe + QStringLiteral(".png"));
    const bool ok = !img.isNull() && img.save(path);
    log(QStringLiteral("grab %1 -> %2 (%3x%4) %5").arg(name, path).arg(img.width()).arg(img.height()).arg(ok ? QStringLiteral("OK") : QStringLiteral("FAIL")));
    return ok;
}

// 每行加上 ISO 時間戳，附加寫入（不覆蓋舊紀錄）
void FdeSelfTest::log(const QString &line) const
{
    QFile f(QDir(_outDir).filePath(QStringLiteral("selftest.log")));
    if (f.open(QIODevice::Append | QIODevice::Text)) {
        f.write((QDateTime::currentDateTime().toString(Qt::ISODate) + QLatin1Char(' ') + line + QLatin1Char('\n')).toUtf8());
    }
}

void FdeSelfTest::finish(int code) const
{
    log(QStringLiteral("finish %1").arg(code));
    // 自我測試直接結束，避免關閉確認對話框卡住
    std::_Exit(code);
}
