#pragma once

// FDE-QGC V1.0｜驗收用自我測試（只在設定環境變數 FDE_QGC_SELFTEST 時啟用；一般使用者完全不受影響）
// FDE_QGC_SELFTEST=fly,plan,teach,...  依序切換導覽列頁面並把視窗存成 PNG，最後結束程式。
// FDE_QGC_SELFTEST_OUT=輸出資料夾（預設 文件\FDE-QGC\SelfTest）
// 搭配 QT_QPA_PLATFORM=offscreen 可在不顯示視窗的情況下驗收畫面。

#include <QtCore/QObject>
#include <QtCore/QStringList>

class FdeSelfTest : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QStringList pages READ pages CONSTANT)
    Q_PROPERTY(QString outDir READ outDir CONSTANT)

public:
    explicit FdeSelfTest(QObject *parent = nullptr);

    QStringList pages() const { return _pages; }
    QString outDir() const { return _outDir; }

    /// 擷取 QQuickWindow 畫面存成 <outDir>/<name>.png
    Q_INVOKABLE bool grab(QObject *window, const QString &name) const;
    /// 寫一行文字紀錄到 <outDir>/selftest.log
    Q_INVOKABLE void log(const QString &line) const;
    /// 結束程式（不經過關閉確認，僅自我測試使用）
    Q_INVOKABLE void finish(int code = 0) const;
    /// 把自我測試指令廣播給各面板（例如「exam:start:0:15」讓八字考核面板開始評分）
    Q_INVOKABLE void broadcast(const QString &command) { emit commandIssued(command); }

signals:
    /// 自我測試指令（面板以 Connections 接收；一般使用時不會發出）
    void commandIssued(const QString &command);

private:
    QStringList _pages;
    QString _outDir;
};
