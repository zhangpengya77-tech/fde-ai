#include "FdeSitl.h"

#include "LinkManager.h"
#include "TCPLink.h"

#include <QtCore/QProcess>

namespace {
QString num(double v)
{
    return QString::number(v, 'f', 7);
}

// SITL 專用目錄（與其他人的 ArduPilot 執行分開，不覆寫別人的 eeprom.bin）
const QString kPrologue = QStringLiteral("RUN=$HOME/fde-qgc-sitl/I11; AP=$HOME/ardupilot\n");
} // namespace

FdeSitl::FdeSitl(QObject *parent) : QObject(parent) {}

void FdeSitl::_setState(const QString &state, const QString &message)
{
    _state = state;
    _message = message;
    emit stateChanged();
}

void FdeSitl::_runWsl(const QString &script, const QString &tag)
{
    // 腳本從 stdin 送進「wsl.exe --exec bash -l -s」：
    // wsl.exe 一般模式會把參數交給 shell 重新解析（$ 與引號會被吃掉），用 stdin 完全避開引號問題。
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
        if (tag == QLatin1String("start")) {
            if (code == 0 && out.contains(QLatin1String("FDE_SITL_STARTED"))) {
                _setState(QStringLiteral("running"), QStringLiteral("SITL 已啟動（instance 11，TCP %1）。請按「連線 SITL」。").arg(tcpPort()));
            } else {
                _setState(QStringLiteral("error"), QStringLiteral("SITL 啟動失敗：%1").arg(out.right(400)));
            }
        } else if (tag == QLatin1String("stop")) {
            _setState(QStringLiteral("stopped"), out.isEmpty() ? QStringLiteral("SITL 已關閉") : out.right(300));
        } else if (tag == QLatin1String("refresh")) {
            if (out.contains(QLatin1String("FDE_SITL_ALIVE"))) {
                _setState(QStringLiteral("running"), QStringLiteral("SITL 執行中（TCP %1）").arg(tcpPort()));
            } else {
                _setState(QStringLiteral("stopped"), QStringLiteral("SITL 未執行"));
            }
        }
    });
    connect(proc, &QProcess::errorOccurred, this, [this, proc](QProcess::ProcessError) {
        _setState(QStringLiteral("error"), QStringLiteral("無法執行 wsl.exe：%1").arg(proc->errorString()));
    });
    proc->start();
}

void FdeSitl::start(double homeLat, double homeLon, double homeAltM, double headingDeg, bool wipe)
{
    if (!(homeLat >= -90 && homeLat <= 90 && homeLon >= -180 && homeLon <= 180)) {
        _setState(QStringLiteral("error"), QStringLiteral("起飛點座標不合法"));
        return;
    }
    _setState(QStringLiteral("starting"), QStringLiteral("正在啟動 SITL…"));
    const QString home = QStringLiteral("%1,%2,%3,%4").arg(num(homeLat), num(homeLon), QString::number(homeAltM, 'f', 1), QString::number(headingDeg, 'f', 0));
    // setsid -f：與 wsl.exe 工作階段脫離，關掉這個 wsl.exe 後 SITL 仍持續執行；sitl.pid 記錄行程群組，關閉時整組結束。
    // 注意：不可用 exec 取代 bash（實測 exec 時 QGC 一連線 SITL 就結束），保留 bash 父行程。
    // 注意：ArduPilot SITL 只接受 SERIAL0 一個連線者；QGC 斷線後會回到等待連線狀態。
    const QString script = QStringLiteral(
        "mkdir -p \"$RUN\" && cd \"$RUN\" || exit 1\n"
        "if [ -f sitl.pid ] && kill -0 $(cat sitl.pid) 2>/dev/null; then echo FDE_SITL_STARTED already; exit 0; fi\n"
        "setsid -f bash -c 'echo $$ > sitl.pid; \"$0/build/sitl/bin/arducopter\" --model + --speedup 1 --slave 0 "
        "--defaults \"$0/Tools/autotest/default_params/copter.parm\" --sim-address=127.0.0.1 -I11 %1 --home %2 > sitl.log 2>&1 < /dev/null' \"$AP\"\n"
        "sleep 3\n"
        "if [ -f sitl.pid ] && kill -0 $(cat sitl.pid) 2>/dev/null; then echo FDE_SITL_STARTED; else tail -n 20 sitl.log; exit 1; fi")
        .arg(wipe ? QStringLiteral("-w") : QString(), home);
    _runWsl(script, QStringLiteral("start"));
}

void FdeSitl::start3d(bool gui, bool wipe)
{
    _setState(QStringLiteral("starting"), gui ? QStringLiteral("正在啟動 3D 模擬（Gazebo 視窗約 10～20 秒後出現）…")
                                              : QStringLiteral("正在啟動 3D 模擬（背景模式）…"));
    // 由 ~/fde-qgc-gazebo/bin/fde_gazebo_ctl.sh 負責：隔離分區、9112 埠、行程群組管理
    const QString script = QStringLiteral(
        "CTL=$HOME/fde-qgc-gazebo/bin/fde_gazebo_ctl.sh\n"
        "[ -x \"$CTL\" ] || { echo '尚未建立 FDE 隔離 Gazebo 環境，請管理員執行 setup_fde_gazebo.sh'; exit 1; }\n"
        "\"$CTL\" start %1 %2 && echo FDE_SITL_STARTED")
        .arg(gui ? QStringLiteral("gui") : QStringLiteral("headless"), wipe ? QStringLiteral("wipe") : QString());
    _runWsl(script, QStringLiteral("start"));
}

void FdeSitl::stop()
{
    _setState(QStringLiteral("stopping"), QStringLiteral("正在關閉 SITL…"));
    // 只結束本工具記錄的 PID（行程群組），不影響其他人啟動的 SITL／MAVProxy；3D 模擬時連同 FDE 的 Gazebo 一起關閉
    const QString script = QStringLiteral(
        "CTL=$HOME/fde-qgc-gazebo/bin/fde_gazebo_ctl.sh\n"
        "if [ -x \"$CTL\" ] && [ -f $HOME/fde-qgc-gazebo/gz.pid ]; then \"$CTL\" stop >/dev/null; echo 'SITL 與 3D 模擬已關閉'; exit 0; fi\n"
        "cd \"$RUN\" 2>/dev/null || { echo 'SITL 未啟動過'; exit 0; }\n"
        "if [ -f sitl.pid ]; then P=$(cat sitl.pid); kill -- -$P 2>/dev/null || kill $P 2>/dev/null; sleep 1; "
        "kill -9 -- -$P 2>/dev/null; rm -f sitl.pid; echo \"SITL 已關閉（PID $P）\"; else echo 'SITL 未執行'; fi");
    _runWsl(script, QStringLiteral("stop"));
}

void FdeSitl::refresh()
{
    _runWsl(QStringLiteral("[ -f \"$RUN/sitl.pid\" ] && kill -0 $(cat \"$RUN/sitl.pid\") 2>/dev/null && echo FDE_SITL_ALIVE || true"),
            QStringLiteral("refresh"));
}

void FdeSitl::connectLink()
{
    // 動態 TCP 連線：關閉 QGC 後不留在使用者的連線清單（WSL2 會把 Windows 127.0.0.1 轉送到 WSL）
    auto *config = new TCPConfiguration(QStringLiteral("FDE SITL I11"));
    config->setHost(QStringLiteral("127.0.0.1"));
    config->setPort(static_cast<quint16>(tcpPort()));
    config->setDynamic(true);
    SharedLinkConfigurationPtr shared = LinkManager::instance()->addConfiguration(config);
    if (LinkManager::instance()->createConnectedLink(shared)) {
        _setState(_state, QStringLiteral("已向 127.0.0.1:%1 建立連線，等待飛控心跳…").arg(tcpPort()));
    } else {
        _setState(QStringLiteral("error"), QStringLiteral("建立 TCP 連線失敗（請確認 SITL 已啟動）"));
    }
}
