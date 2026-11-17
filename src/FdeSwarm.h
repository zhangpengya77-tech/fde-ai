#pragma once

// FDE-QGC V2-3｜多機仿真器＋編隊飛行（FDE 自行實作；參考市售地面站的「仿真器／編隊」操作概念，未使用其程式或素材）
//
// 一、多機仿真器（仿真訓練中心 → 多機編隊分頁「步驟 1」）
//   - 在 WSL 發行版 FDE-DT-Ubuntu 內一次啟動 2～6 架 ArduCopter SITL：instance 21～26、系統 ID 11～16。
//     （不用 1～6：真機與其他地面站的模擬器常用系統 ID 1，避免撞號後被 QGC 合併成同一架）
//   - 每架 TCP 埠 = 5760 + 10 × instance（5970、5980…6020）；不使用 5762、8262、8263，也不碰單機 SITL（instance 11）。
//   - 工作目錄 ~/fde-qgc-swarm/I<instance>，每架各自的 EEPROM，不覆寫任何人的資料。
//   - 起飛點依「排列方向」自動錯開（預設間距 5 m），避免模擬機一開始就重疊。
//
// 二、編隊飛行（仿真訓練中心 → 多機編隊分頁「步驟 2」、飛行畫面「編隊飛行」面板）
//   - 原理：ArduPilot 內建 FOLLOW（跟隨）模式。每架從機設定 FOLL_SYSID＝長機系統 ID、
//     FOLL_OFS_TYPE＝1（偏移量以長機機頭方向為準）、FOLL_OFS_X/Y/Z＝隊形中的相對位置，再切到 Follow 模式。
//   - 長機由使用者照平常方式操作（官方「飛到這裡」或自動任務），從機自動保持隊形。
//
// 安全界線：
//   - 編隊的所有控制（改參數、起飛、切模式）只接受「FDE 模擬連線」上的飛機（連線名稱以 FDE 開頭的 SITL），
//     真機一律拒絕並顯示原因；本版不開放真機編隊。
//   - 全體起飛前 QML 端一定先跳確認視窗；不自動上傳航點。
//   - 使用者不需要開 PowerShell 或 WSL：全部由按鈕完成。

#include <QtCore/QObject>
#include <QtCore/QString>
#include <QtCore/QVariantList>

#include "QGCMAVLink.h"

class Vehicle;

class FdeSwarm : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString lastMessage READ lastMessage NOTIFY stateChanged)
    Q_PROPERTY(int runningCount READ runningCount NOTIFY stateChanged)
    Q_PROPERTY(QString distro READ distro CONSTANT)
    Q_PROPERTY(int firstInstance READ firstInstance CONSTANT)
    Q_PROPERTY(int maxCount READ maxCount CONSTANT)
    Q_PROPERTY(QString formationMessage READ formationMessage NOTIFY formationMessageChanged)

public:
    explicit FdeSwarm(QObject *parent = nullptr);

    QString state() const { return _state; }
    QString lastMessage() const { return _message; }
    int runningCount() const { return _runningCount; }
    QString distro() const { return QStringLiteral("FDE-DT-Ubuntu"); }
    int firstInstance() const { return 21; }
    int maxCount() const { return 6; }
    /// 第 1 架模擬機的系統 ID（第 k 架＝firstSysId + k − 1）
    Q_PROPERTY(int firstSysId READ firstSysId CONSTANT)
    int firstSysId() const { return 11; }
    QString formationMessage() const { return _formationMessage; }

    /// 第 index 架（從 1 開始）的 TCP 埠
    Q_INVOKABLE int tcpPortFor(int index) const { return 5760 + 10 * (firstInstance() + index - 1); }

    // ---------------- 多機仿真器 ----------------
    /// 啟動 count 架模擬機（非阻塞）。起飛點從 (lat, lon) 起，沿「機頭方向右側」每架間隔 spacingM 公尺排開。
    Q_INVOKABLE void startSwarm(int count, double homeLat, double homeLon, double homeAltM, double headingDeg,
                                double spacingM, bool wipe);
    /// 為正在執行的每一架模擬機建立 QGC TCP 連線（動態連線，不寫入使用者的連線清單）
    Q_INVOKABLE void connectAll();
    /// 關閉本工具啟動的所有模擬機（只結束 pidfile 內記錄的行程群組）
    Q_INVOKABLE void stopSwarm();
    /// 檢查有幾架模擬機仍在執行
    Q_INVOKABLE void refresh();

    // ---------------- 編隊飛行 ----------------
    /// 這架飛機是否連在 FDE 模擬連線上（只有模擬機可以使用編隊控制）
    Q_INVOKABLE bool isSimVehicle(int vehicleId) const;
    /// 計算隊形偏移量（不送出任何指令，給面板畫預覽圖用）。
    /// 回傳 [{x: 前方公尺, y: 右方公尺, z: 高度差公尺(向上為正)}, ...]，長度 = followerCount。
    Q_INVOKABLE QVariantList formationOffsets(const QString &shape, int followerCount, double spacingM, double altStepM) const;
    /// 套用隊形：設定每架從機的 FOLL_* 參數（不切模式、不起飛）
    Q_INVOKABLE void applyFormation(int leaderId, const QVariantList &followerIds, const QString &shape, double spacingM, double altStepM);
    /// 從機切換到 Follow 模式，開始保持隊形
    Q_INVOKABLE void startFollow(const QVariantList &followerIds);
    /// 全體起飛到 altM 公尺（Guided 模式＋解鎖＋起飛；每架間隔 1.5 秒依序執行）
    Q_INVOKABLE void takeoffAll(const QVariantList &vehicleIds, double altM);
    /// 全體切換模式：action = "guided"（原地懸停）／"rtl"（返航）／"land"（降落）
    Q_INVOKABLE void commandAll(const QVariantList &vehicleIds, const QString &action);
    /// 停止編隊：停止轉送長機位置（從機會因收不到長機位置而跟隨逾時，請先按「全體懸停」）
    Q_INVOKABLE void stopFormation();

    /// 是否正在轉送長機位置給從機
    Q_PROPERTY(bool formationActive READ formationActive NOTIFY formationChanged)
    /// 目前編隊的長機系統 ID（未編隊時為 0）
    Q_PROPERTY(int leaderId READ leaderId NOTIFY formationChanged)
    /// 已轉送的長機位置封包數（畫面顯示「轉送中」與自我測試用）
    Q_PROPERTY(int relayCount READ relayCount NOTIFY relayCountChanged)
    bool formationActive() const { return _leaderId > 0; }
    int leaderId() const { return _leaderId; }
    int relayCount() const { return _relayCount; }

signals:
    void stateChanged();
    void formationMessageChanged();
    void formationChanged();
    void relayCountChanged();

private:
    /// 為什麼需要轉送：每架模擬機只連到地面站，從機彼此聽不到長機。
    /// ArduPilot 的 Follow 模式要靠長機的 GLOBAL_POSITION_INT（系統 ID＝FOLL_SYSID）推算位置，
    /// 所以由地面站把長機送來的這個封包，原封不動（保留長機系統 ID）轉送到每架從機的連線。
    void _startRelay(int leaderId, const QList<int> &followerIds);
    void _relayLeaderMessage(const mavlink_message_t &message);

    int _leaderId = 0;
    QList<int> _followerIds;
    QMetaObject::Connection _relayConn;
    QMetaObject::Connection _removedConn;
    int _relayCount = 0;

    void _setState(const QString &state, const QString &message, int running = -1);
    void _setFormationMessage(const QString &message);
    void _runWsl(const QString &script, const QString &tag);
    /// 取得模擬機；不是模擬機或不存在時回傳 nullptr 並把原因附加到 errors
    Vehicle *_simVehicle(int vehicleId, QStringList &errors) const;
    /// 設定一個參數；參數不存在時回傳 false
    static bool _setParam(Vehicle *vehicle, const QString &name, double value);

    QString _state = QStringLiteral("stopped");
    QString _message;
    QString _formationMessage;
    int _runningCount = 0;
    int _startedCount = 0;
};
