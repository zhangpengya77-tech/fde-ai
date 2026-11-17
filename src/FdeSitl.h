#pragma once

// FDE-QGC V1.0｜仿真訓練：一鍵啟動／連線／關閉「隔離」的 ArduCopter SITL
// 安全界線：
// - 只在 WSL 發行版 FDE-DT-Ubuntu 內啟動 arducopter，固定 instance 11（TCP 5870），工作目錄 ~/fde-qgc-sitl/I11。
// - 只連 127.0.0.1:5870（WSL localhost 轉送），失敗才改用 WSL 內部 IP；不碰序列埠、不連真機。
// - 不使用 5762、8262、8263；不修改正式 Gateway／Gazebo。
// - 不自動 ARM、不自動起飛；起飛與 AUTO/RTL 一律由使用者在 QGC 原生介面確認。
// - 使用者不需要開 PowerShell 或 WSL：全部由按鈕完成。

#include <QtCore/QObject>
#include <QtCore/QString>

class FdeSitl : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString lastMessage READ lastMessage NOTIFY stateChanged)
    Q_PROPERTY(QString distro READ distro CONSTANT)
    Q_PROPERTY(int instance READ instance CONSTANT)
    Q_PROPERTY(int tcpPort READ tcpPort CONSTANT)

public:
    explicit FdeSitl(QObject *parent = nullptr);

    QString state() const { return _state; }
    QString lastMessage() const { return _message; }
    QString distro() const { return QStringLiteral("FDE-DT-Ubuntu"); }
    int instance() const { return 11; }
    int tcpPort() const { return 5760 + 10 * instance(); }

    /// 啟動 SITL（非阻塞）。homeLat/Lon/Alt/Heading 為仿真起飛點；wipe=true 時清除上次的 EEPROM 參數。
    Q_INVOKABLE void start(double homeLat, double homeLon, double homeAltM, double headingDeg, bool wipe);
    /// 3D 模擬（V2）：啟動隔離 Gazebo（GZ_PARTITION=fde_qgc、FDM 埠 9112）＋ JSON 模式 SITL。
    /// gui=true 會在 Windows 桌面開 Gazebo 3D 視窗（WSLg）；false 只跑伺服器（測試用）。
    /// 需先以 tools\claude\gazebo\setup_fde_gazebo.sh 建立 ~/fde-qgc-gazebo（只複製、不改正式 Gazebo）。
    Q_INVOKABLE void start3d(bool gui, bool wipe);
    /// 建立 QGC TCP 連線（動態連線，不寫入使用者的連線清單）
    Q_INVOKABLE void connectLink();
    /// 關閉本工具啟動的 SITL（只殺 pidfile 內記錄的程序）
    Q_INVOKABLE void stop();
    /// 檢查 SITL 是否仍在執行（非阻塞，結果透過 stateChanged 回報）
    Q_INVOKABLE void refresh();

signals:
    void stateChanged();

private:
    void _setState(const QString &state, const QString &message);
    void _runWsl(const QString &script, const QString &tag);

    QString _state = QStringLiteral("stopped");
    QString _message;
};
