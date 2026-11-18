#pragma once

// FDE-QGC V1.0｜飛行日誌分析＋AI 調參建議（離線、規則式）
// - 解析：直接使用 QGC 5.1.5 官方 LogViewer 的 ArduPilot DataFlash 解析器（DataFlashParser::parseFile），不重寫格式。
// - 診斷：振動／削波、姿態與角速度追蹤（PID 響應）、電池與電源、懸停油門、GPS、EKF、馬達平衡、錯誤與失效保護。
// - 建議：依 ArduPilot 官方調參指引的規則產生「參數建議」，每條附理由與等級；**本類別不會寫入飛控**，
//   寫入由 QML 端在「已連線＋未解鎖＋使用者確認」後才進行，並先備份舊值。
// - 這是規則式專家系統，不是雲端或大型語言模型；所有計算在本機完成，不上傳任何資料。

#include <QtCore/QHash>
#include <QtCore/QObject>
#include <QtCore/QPointF>
#include <QtCore/QString>
#include <QtCore/QVector>
#include <QtCore/QVariantList>
#include <QtCore/QVariantMap>

class FdeLogAnalyzer : public QObject
{
    Q_OBJECT
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QVariantMap report READ report NOTIFY reportChanged)
    /// 「日誌」頁共用的日誌檔：在「日誌檢視器」開過的檔案，切到「智能診斷」時直接沿用（不用重新選檔）
    Q_PROPERTY(QString sharedLogPath READ sharedLogPath NOTIFY sharedLogPathChanged)

public:
    explicit FdeLogAnalyzer(QObject *parent = nullptr);

    bool busy() const { return _busy; }
    QVariantMap report() const { return _report; }
    QString sharedLogPath() const { return _sharedLogPath; }

    /// 從「日誌檢視器」頁（官方 LogViewerPage）記下目前開啟的日誌路徑。
    /// 在日誌頁切換子項、頁面被銷毀前由 MainWindow 呼叫；只讀官方控制器的 currentLogPath，不改它。
    Q_INVOKABLE void captureLogViewer(QObject *page);

    /// 背景執行緒分析 .bin（ArduPilot DataFlash）；完成後 reportChanged
    Q_INVOKABLE void analyze(const QString &fileOrUrl);
    /// 取某欄位的降採樣序列（給圖表）：[{x,y}...]，最多 maxPoints 點
    Q_INVOKABLE QVariantList series(const QString &field, int maxPoints = 600) const;
    /// 以「目前參數值」重新產生調參建議（currentParams: {名稱: 值}，通常來自已連線飛控）
    Q_INVOKABLE QVariantList suggestionsFor(const QVariantMap &currentParams) const;
    /// 備份將被修改的參數（寫入前呼叫）：附加到 文件\FDE-QGC\Tuning\param-backup.csv，回傳檔案路徑
    Q_INVOKABLE QString backupParam(const QString &name, double oldValue, double newValue, const QString &reason) const;
    /// 讀回最近一筆尚未還原的備份 {ok, name, oldValue, newValue}
    Q_INVOKABLE QVariantMap lastBackup() const;
    /// 把最近一筆備份標記為已還原
    Q_INVOKABLE void markLastRestored() const;
    Q_INVOKABLE QString tuningDirectory() const;

signals:
    void busyChanged();
    void reportChanged();
    void sharedLogPathChanged();

private:
    void _setResult(const QVariantMap &report, const QHash<QString, QVector<QPointF>> &samples);

    bool _busy = false;
    QVariantMap _report;
    QString _sharedLogPath;   // 日誌檢視器最後開啟的檔案（本機路徑）
    QHash<QString, QVector<QPointF>> _samples;   // 只保留圖表需要的欄位
};
