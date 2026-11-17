#include "FdeSwarm.h"

#include "Fact.h"
#include "FirmwarePlugin.h"
#include "LinkInterface.h"
#include "LinkManager.h"
#include "MultiVehicleManager.h"
#include "ParameterManager.h"
#include "TCPLink.h"
#include "Vehicle.h"
#include "VehicleLinkManager.h"

#include <QtCore/QProcess>
#include <QtCore/QTimer>
#include <QtCore/QtMath>
#include <QtPositioning/QGeoCoordinate>

namespace {
// 模擬連線名稱前綴：isSimVehicle() 用它判斷「這架是不是模擬機」
const QString kSwarmLinkPrefix = QStringLiteral("FDE 編隊模擬 ");
// 單機仿真訓練（FdeSitl）建立的連線名稱，也算模擬機
const QString kSingleSitlLink = QStringLiteral("FDE SITL I11");

// 每段 WSL 腳本的共同開頭：工作目錄與 ArduPilot 原始碼位置
const QString kPrologue = QStringLiteral("BASE=$HOME/fde-qgc-swarm; AP=$HOME/ardupilot\n");

QString num(double v, int digits = 7)
{
    return QString::number(v, 'f', digits);
}
} // namespace

FdeSwarm::FdeSwarm(QObject *parent) : QObject(parent) {}

void FdeSwarm::_setState(const QString &state, const QString &message, int running)
{
    _state = state;
    _message = message;
    if (running >= 0) {
        _runningCount = running;
    }
    emit stateChanged();
}

void FdeSwarm::_setFormationMessage(const QString &message)
{
    _formationMessage = message;
    emit formationMessageChanged();
}

// ============================================================================
// 多機仿真器
// ============================================================================

void FdeSwarm::_runWsl(const QString &script, const QString &tag)
{
    // 與 FdeSitl 相同做法：腳本從 stdin 送進 bash，避免 wsl.exe 重新解析引號與 $
    auto *proc = new QProcess(this);
    proc->setProgram(QStringLiteral("wsl.exe"));
    proc->setArguments({QStringLiteral("-d"), distro(), QStringLiteral("--exec"), QStringLiteral("bash"), QStringLiteral("-l"), QStringLiteral("-s")});
    proc->setProcessChannelMode(QProcess::MergedChannels);
    connect(proc, &QProcess::started, proc, [proc, script]() {
        proc->write((kPrologue + script + QStringLiteral("\n")).toUtf8());
        proc->closeWriteChannel();
    });
    connect(proc, &QProcess::finished, this, [this, proc, tag](int code, QProcess::ExitStatus) {
        const QString out = QString::fromUtf8(proc->readAll()).trimmed();
        proc->deleteLater();
        // 腳本最後一定印出「FDE_SWARM_ALIVE n」：目前仍在執行的架數
        int alive = 0;
        const int pos = out.lastIndexOf(QLatin1String("FDE_SWARM_ALIVE "));
        if (pos >= 0) {
            alive = out.mid(pos + 16).section(QLatin1Char('\n'), 0, 0).trimmed().toInt();
        }
        if (tag == QLatin1String("start")) {
            if (code == 0 && alive >= _startedCount && alive > 0) {
                _setState(QStringLiteral("running"),
                          QStringLiteral("已啟動 %1 架模擬機（系統 ID %2～%3，TCP %4 起）。請按「連線全部」。").arg(alive).arg(firstSysId()).arg(firstSysId() + alive - 1).arg(tcpPortFor(1)), alive);
            } else {
                _setState(QStringLiteral("error"), QStringLiteral("模擬機啟動失敗（成功 %1 架）：%2").arg(alive).arg(out.right(500)), alive);
            }
        } else if (tag == QLatin1String("stop")) {
            _setState(QStringLiteral("stopped"), QStringLiteral("模擬機已全部關閉"), 0);
        } else {
            _setState(alive > 0 ? QStringLiteral("running") : QStringLiteral("stopped"),
                      alive > 0 ? QStringLiteral("%1 架模擬機執行中").arg(alive) : QStringLiteral("沒有執行中的模擬機"), alive);
        }
    });
    connect(proc, &QProcess::errorOccurred, this, [this, proc](QProcess::ProcessError) {
        _setState(QStringLiteral("error"), QStringLiteral("無法執行 wsl.exe：%1").arg(proc->errorString()));
    });
    proc->start();
}

// 統計仍在執行的架數（每個 I<instance>/sitl.pid 內的行程還活著就算一架）
static QString aliveCountScript()
{
    return QStringLiteral(
        "N=0; for P in \"$BASE\"/I*/sitl.pid; do [ -f \"$P\" ] && kill -0 $(cat \"$P\") 2>/dev/null && N=$((N+1)); done\n"
        "echo FDE_SWARM_ALIVE $N");
}

void FdeSwarm::startSwarm(int count, double homeLat, double homeLon, double homeAltM, double headingDeg, double spacingM, bool wipe)
{
    if (count < 1 || count > maxCount()) {
        _setState(QStringLiteral("error"), QStringLiteral("架數必須是 1～%1").arg(maxCount()));
        return;
    }
    if (!(homeLat >= -90 && homeLat <= 90 && homeLon >= -180 && homeLon <= 180) || qIsNaN(homeAltM)) {
        _setState(QStringLiteral("error"), QStringLiteral("起飛點座標不合法"));
        return;
    }
    spacingM = qBound(2.0, spacingM, 50.0);
    _startedCount = count;
    _setState(QStringLiteral("starting"), QStringLiteral("正在啟動 %1 架模擬機…（約 5～10 秒）").arg(count));

    // 起飛點：第 1 架在指定位置，其餘沿「機頭方向右側」（heading + 90°）每架間隔 spacingM 排開
    const QGeoCoordinate origin(homeLat, homeLon, homeAltM);
    QString script = QStringLiteral("mkdir -p \"$BASE\" || exit 1\n");
    for (int k = 1; k <= count; ++k) {
        const int inst = firstInstance() + k - 1;
        const QGeoCoordinate home = origin.atDistanceAndAzimuth(spacingM * (k - 1), headingDeg + 90.0);
        const QString homeStr = QStringLiteral("%1,%2,%3,%4").arg(num(home.latitude()), num(home.longitude()),
                                                                     num(homeAltM, 1), num(headingDeg, 0));
        // 系統 ID 用命令列 --sysid 設定（ArduPilot 4.7 起參數已改名為 MAV_SYSID，命令列寫法新舊版都通用）
        // 每架自己的參數檔：預先開啟 Follow 函式庫（FOLL_ENABLE=1 後 FOLL_* 參數才會出現）
        // setsid -f：與 wsl.exe 工作階段脫離；sitl.pid 記錄行程群組，關閉時整組結束（同 FdeSitl 的作法）
        script += QStringLiteral(
            "R=\"$BASE/I%1\"; mkdir -p \"$R\"\n"
            "if [ -f \"$R/sitl.pid\" ] && kill -0 $(cat \"$R/sitl.pid\") 2>/dev/null; then echo \"I%1 已在執行\"; else\n"
            "  printf 'FOLL_ENABLE 1\\n' > \"$R/fde.parm\"\n"
            "  ( cd \"$R\" && setsid -f bash -c 'echo $$ > sitl.pid; \"$0/build/sitl/bin/arducopter\" --model + --speedup 1 --slave 0 "
            "--defaults \"$0/Tools/autotest/default_params/copter.parm,$1/fde.parm\" --sim-address=127.0.0.1 -I%1 --sysid %2 %3 --home %4"
            "> sitl.log 2>&1 < /dev/null' \"$AP\" \"$R\" )\n"
            "fi\n")
                      .arg(inst)
                      .arg(firstSysId() + k - 1)
                      .arg(wipe ? QStringLiteral("-w") : QString(), homeStr);
    }
    script += QStringLiteral("sleep 4\n") + aliveCountScript();
    _runWsl(script, QStringLiteral("start"));
}

void FdeSwarm::stopSwarm()
{
    stopFormation();
    _setState(QStringLiteral("stopping"), QStringLiteral("正在關閉模擬機…"));
    // 只結束本工具記錄的 PID（行程群組），不影響單機 SITL、正式 Gazebo 或其他人的 ArduPilot
    const QString script = QStringLiteral(
        "for P in \"$BASE\"/I*/sitl.pid; do [ -f \"$P\" ] || continue; G=$(cat \"$P\"); "
        "kill -- -$G 2>/dev/null || kill $G 2>/dev/null; done\n"
        "sleep 1\n"
        "for P in \"$BASE\"/I*/sitl.pid; do [ -f \"$P\" ] || continue; G=$(cat \"$P\"); kill -9 -- -$G 2>/dev/null; rm -f \"$P\"; done\n")
        + aliveCountScript();
    _runWsl(script, QStringLiteral("stop"));
}

void FdeSwarm::refresh()
{
    _runWsl(aliveCountScript(), QStringLiteral("refresh"));
}

void FdeSwarm::connectAll()
{
    const int n = qMax(_runningCount, _startedCount);
    if (n <= 0) {
        _setState(_state, QStringLiteral("沒有執行中的模擬機，請先按「啟動」"));
        return;
    }
    // 已經有同名連線（已連上）的就跳過，避免重複連線
    QStringList existing;
    for (const SharedLinkInterfacePtr &link : LinkManager::instance()->links()) {
        if (link && link->linkConfiguration()) {
            existing << link->linkConfiguration()->name();
        }
    }
    int created = 0;
    for (int k = 1; k <= n; ++k) {
        const QString name = kSwarmLinkPrefix + QString::number(k);
        if (existing.contains(name)) {
            continue;
        }
        // 動態 TCP 連線：關閉 QGC 後不留在使用者的連線清單（WSL2 會把 Windows 127.0.0.1 轉送到 WSL）
        auto *config = new TCPConfiguration(name);
        config->setHost(QStringLiteral("127.0.0.1"));
        config->setPort(static_cast<quint16>(tcpPortFor(k)));
        config->setDynamic(true);
        SharedLinkConfigurationPtr shared = LinkManager::instance()->addConfiguration(config);
        if (LinkManager::instance()->createConnectedLink(shared)) {
            ++created;
        }
    }
    _setState(_state, QStringLiteral("已建立 %1 條連線，約 10～20 秒後所有模擬機會出現在飛機清單").arg(created));
}

// ============================================================================
// 編隊飛行
// ============================================================================

bool FdeSwarm::isSimVehicle(int vehicleId) const
{
    Vehicle *vehicle = MultiVehicleManager::instance()->getVehicleById(vehicleId);
    if (!vehicle) {
        return false;
    }
    // 這架飛機「所有」連線都必須是 FDE 模擬連線；只要有一條不是（例如同時接了數傳），就當成真機
    const QStringList names = vehicle->vehicleLinkManager()->linkNames();
    if (names.isEmpty()) {
        return false;
    }
    for (const QString &name : names) {
        if (!name.startsWith(kSwarmLinkPrefix) && name != kSingleSitlLink) {
            return false;
        }
    }
    return true;
}

Vehicle *FdeSwarm::_simVehicle(int vehicleId, QStringList &errors) const
{
    Vehicle *vehicle = MultiVehicleManager::instance()->getVehicleById(vehicleId);
    if (!vehicle) {
        errors << QStringLiteral("找不到系統 ID %1 的飛機").arg(vehicleId);
        return nullptr;
    }
    if (!isSimVehicle(vehicleId)) {
        errors << QStringLiteral("系統 ID %1 不是 FDE 模擬機，編隊控制不開放給真機").arg(vehicleId);
        return nullptr;
    }
    if (!vehicle->apmFirmware() || !vehicle->multiRotor()) {
        errors << QStringLiteral("系統 ID %1 不是 ArduPilot 多旋翼").arg(vehicleId);
        return nullptr;
    }
    return vehicle;
}

bool FdeSwarm::_setParam(Vehicle *vehicle, const QString &name, double value)
{
    ParameterManager *pm = vehicle->parameterManager();
    if (!pm->parameterExists(ParameterManager::defaultComponentId, name)) {
        return false;
    }
    pm->getParameter(ParameterManager::defaultComponentId, name)->setRawValue(value);
    return true;
}

QVariantList FdeSwarm::formationOffsets(const QString &shape, int followerCount, double spacingM, double altStepM) const
{
    // 座標：x＝長機前方（公尺），y＝長機右方，z＝高度差（向上為正）。長機在 (0,0,0)。
    QVariantList list;
    const double s = qBound(2.0, spacingM, 100.0);
    for (int i = 1; i <= followerCount; ++i) {
        double x = 0;
        double y = 0;
        const int pair = (i + 1) / 2;                 // 1,1,2,2,3,3…：左右成對
        const double side = (i % 2 == 1) ? 1.0 : -1.0; // 奇數在右、偶數在左
        if (shape == QLatin1String("column")) {         // 一字縱隊：全部排在長機正後方
            x = -s * i;
        } else if (shape == QLatin1String("vee")) {     // V 字（人字）：左右兩翼向後展開
            x = -s * pair;
            y = side * s * pair;
        } else if (shape == QLatin1String("echelon")) { // 右梯隊：斜線排在右後方
            x = -s * i;
            y = s * i;
        } else if (shape == QLatin1String("grid")) {    // 方陣：長機在左前角，依列往後排
            const int cols = qMax(2, static_cast<int>(qCeil(qSqrt(followerCount + 1.0))));
            const int row = i / cols;
            const int col = i % cols;
            x = -s * row;
            y = s * col;
        } else if (shape == QLatin1String("circle")) {  // 圓形：從機平均分布在以長機為圓心、半徑 s 的圓上
            const double a = 2.0 * M_PI * (i - 1) / qMax(1, followerCount);
            x = s * qCos(a);
            y = s * qSin(a);
        } else {                                        // 預設「line」一字橫隊：左右交錯排在長機兩側
            y = side * s * pair;
        }
        QVariantMap m;
        m.insert(QStringLiteral("x"), x);
        m.insert(QStringLiteral("y"), y);
        m.insert(QStringLiteral("z"), altStepM * i);
        list << m;
    }
    return list;
}

void FdeSwarm::applyFormation(int leaderId, const QVariantList &followerIds, const QString &shape, double spacingM, double altStepM)
{
    QStringList errors;
    if (!_simVehicle(leaderId, errors)) {
        _setFormationMessage(QStringLiteral("無法套用隊形：") + errors.join(QStringLiteral("；")));
        return;
    }
    QList<int> ids;
    for (const QVariant &v : followerIds) {
        const int id = v.toInt();
        if (id != leaderId && !ids.contains(id)) {
            ids << id;
        }
    }
    if (ids.isEmpty()) {
        _setFormationMessage(QStringLiteral("請至少勾選一架從機"));
        return;
    }

    const QVariantList offsets = formationOffsets(shape, ids.count(), spacingM, altStepM);
    QStringList done;
    QStringList needRefresh;
    for (int i = 0; i < ids.count(); ++i) {
        Vehicle *v = _simVehicle(ids[i], errors);
        if (!v) {
            continue;
        }
        if (!v->parameterManager()->parametersReady()) {
            errors << QStringLiteral("系統 ID %1 參數尚未下載完成").arg(ids[i]);
            continue;
        }
        // FOLL_* 參數要在 FOLL_ENABLE=1 且重新整理參數後才會出現
        if (!v->parameterManager()->parameterExists(ParameterManager::defaultComponentId, QStringLiteral("FOLL_OFS_X"))) {
            if (_setParam(v, QStringLiteral("FOLL_ENABLE"), 1)) {
                v->parameterManager()->refreshAllParameters();
                needRefresh << QString::number(ids[i]);
            } else {
                errors << QStringLiteral("系統 ID %1 的韌體沒有 Follow 功能").arg(ids[i]);
            }
            continue;
        }
        const QVariantMap o = offsets[i].toMap();
        _setParam(v, QStringLiteral("FOLL_SYSID"), leaderId);        // 跟隨對象＝長機
        _setParam(v, QStringLiteral("FOLL_OFS_TYPE"), 1);            // 偏移量以長機機頭方向為準
        _setParam(v, QStringLiteral("FOLL_OFS_X"), o.value(QStringLiteral("x")).toDouble());
        _setParam(v, QStringLiteral("FOLL_OFS_Y"), o.value(QStringLiteral("y")).toDouble());
        _setParam(v, QStringLiteral("FOLL_OFS_Z"), -o.value(QStringLiteral("z")).toDouble()); // ArduPilot 的 Z 以「向下」為正
        _setParam(v, QStringLiteral("FOLL_ALT_TYPE"), 1);            // 相對高度
        _setParam(v, QStringLiteral("FOLL_YAW_BEHAVE"), 2);          // 機頭與長機同方向
        _setParam(v, QStringLiteral("FOLL_DIST_MAX"), 300);          // 與長機超過 300 m 才視為失效
        done << QString::number(ids[i]);
    }

    // 開始把長機位置轉送給已設定好的從機
    QList<int> relayTo;
    for (const QString &d : done) {
        relayTo << d.toInt();
    }
    if (!relayTo.isEmpty()) {
        _startRelay(leaderId, relayTo);
    }

    QString msg;
    if (!done.isEmpty()) {
        msg += QStringLiteral("已套用隊形到從機 %1（長機 %2）。").arg(done.join(QStringLiteral("、"))).arg(leaderId);
    }
    if (!needRefresh.isEmpty()) {
        msg += QStringLiteral("從機 %1 剛開啟 Follow 功能，正在重新下載參數，約 10 秒後請再按一次「套用隊形」。").arg(needRefresh.join(QStringLiteral("、")));
    }
    if (!errors.isEmpty()) {
        msg += QStringLiteral("注意：") + errors.join(QStringLiteral("；"));
    }
    _setFormationMessage(msg);
}

void FdeSwarm::_startRelay(int leaderId, const QList<int> &followerIds)
{
    QObject::disconnect(_relayConn);
    QObject::disconnect(_removedConn);
    _leaderId = leaderId;
    _followerIds = followerIds;
    Vehicle *leader = MultiVehicleManager::instance()->getVehicleById(leaderId);
    if (leader) {
        _relayConn = connect(leader, &Vehicle::mavlinkMessageReceived, this, &FdeSwarm::_relayLeaderMessage);
    }
    // 長機或從機斷線時自動整理清單；長機不見就停止編隊
    _removedConn = connect(MultiVehicleManager::instance(), &MultiVehicleManager::vehicleRemoved, this, [this](Vehicle *v) {
        if (!v) {
            return;
        }
        if (v->id() == _leaderId) {
            stopFormation();
            _setFormationMessage(QStringLiteral("長機已斷線，編隊停止。請讓從機「全體懸停」或「全體返航」。"));
        } else {
            _followerIds.removeAll(v->id());
        }
    });
    emit formationChanged();
}

void FdeSwarm::_relayLeaderMessage(const mavlink_message_t &message)
{
    // 只轉送 Follow 需要的長機位置封包；其他訊息一律不轉送
    if (message.msgid != MAVLINK_MSG_ID_GLOBAL_POSITION_INT || message.sysid != _leaderId) {
        return;
    }
    for (int id : std::as_const(_followerIds)) {
        Vehicle *follower = MultiVehicleManager::instance()->getVehicleById(id);
        // 再確認一次：只轉送給模擬機
        if (!follower || !isSimVehicle(id)) {
            continue;
        }
        SharedLinkInterfacePtr link = follower->vehicleLinkManager()->primaryLink().lock();
        if (link) {
            follower->sendMessageOnLinkThreadSafe(link.get(), message);
        }
    }
    ++_relayCount;
    // 降低畫面更新頻率：每 10 個封包通知一次
    if (_relayCount % 10 == 0) {
        emit relayCountChanged();
    }
}

void FdeSwarm::stopFormation()
{
    if (_leaderId == 0) {
        return;
    }
    QObject::disconnect(_relayConn);
    QObject::disconnect(_removedConn);
    _leaderId = 0;
    _followerIds.clear();
    emit formationChanged();
}

void FdeSwarm::startFollow(const QVariantList &followerIds)
{
    if (!formationActive()) {
        _setFormationMessage(QStringLiteral("請先按「套用隊形」"));
        return;
    }
    QStringList errors;
    QStringList ok;
    for (const QVariant &id : followerIds) {
        Vehicle *v = _simVehicle(id.toInt(), errors);
        if (!v || id.toInt() == _leaderId) {
            continue;
        }
        if (!v->armed() || !v->flying()) {
            errors << QStringLiteral("系統 ID %1 尚未起飛").arg(id.toInt());
            continue;
        }
        v->setFlightMode(v->firmwarePlugin()->followFlightMode());
        ok << id.toString();
    }
    _setFormationMessage((ok.isEmpty() ? QString() : QStringLiteral("從機 %1 已切換到跟隨模式。").arg(ok.join(QStringLiteral("、"))))
                         + (errors.isEmpty() ? QString() : QStringLiteral("注意：") + errors.join(QStringLiteral("；"))));
}

void FdeSwarm::takeoffAll(const QVariantList &vehicleIds, double altM)
{
    altM = qBound(2.0, altM, 120.0);
    QStringList errors;
    QList<int> ids;
    for (const QVariant &id : vehicleIds) {
        if (_simVehicle(id.toInt(), errors)) {
            ids << id.toInt();
        }
    }
    if (ids.isEmpty()) {
        _setFormationMessage(QStringLiteral("沒有可起飛的模擬機。") + errors.join(QStringLiteral("；")));
        return;
    }
    _setFormationMessage(QStringLiteral("依序起飛 %1 架到 %2 m…").arg(ids.count()).arg(altM, 0, 'f', 0)
                         + (errors.isEmpty() ? QString() : QStringLiteral(" 注意：") + errors.join(QStringLiteral("；"))));
    // 每架間隔 1.5 秒：官方起飛流程（切 Guided → 解鎖 → 起飛）會等待飛控確認，錯開避免同時塞指令
    for (int i = 0; i < ids.count(); ++i) {
        const int id = ids[i];
        QTimer::singleShot(1500 * i, this, [id, altM]() {
            if (Vehicle *v = MultiVehicleManager::instance()->getVehicleById(id)) {
                v->guidedModeTakeoff(altM);
            }
        });
    }
}

void FdeSwarm::commandAll(const QVariantList &vehicleIds, const QString &action)
{
    QStringList errors;
    QStringList ok;
    for (const QVariant &id : vehicleIds) {
        Vehicle *v = _simVehicle(id.toInt(), errors);
        if (!v) {
            continue;
        }
        if (action == QLatin1String("rtl")) {
            v->guidedModeRTL(false);
        } else if (action == QLatin1String("land")) {
            v->guidedModeLand();
        } else {
            // 懸停：切 Guided，ArduCopter 會在目前位置停住
            v->setFlightMode(v->firmwarePlugin()->gotoFlightMode());
        }
        ok << id.toString();
    }
    // 返航或降落後不再需要轉送長機位置
    if (action == QLatin1String("rtl") || action == QLatin1String("land")) {
        stopFormation();
    }
    const QString actName = action == QLatin1String("rtl") ? QStringLiteral("返航") : (action == QLatin1String("land") ? QStringLiteral("降落") : QStringLiteral("懸停"));
    _setFormationMessage(QStringLiteral("已送出「全體%1」給 %2 架。").arg(actName).arg(ok.count())
                         + (errors.isEmpty() ? QString() : QStringLiteral("注意：") + errors.join(QStringLiteral("；"))));
}
