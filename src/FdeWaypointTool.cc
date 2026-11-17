#include "FdeWaypointTool.h"
#include "PrecisionWaypointMath.h"

#include "MissionItem.h"
#include "SimpleMissionItem.h"

#include <QtCore/QDateTime>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QStandardPaths>
#include <QtCore/QUrl>

#include <algorithm>

namespace {
constexpr int kCmdNavWaypoint = 16;       // MAV_CMD_NAV_WAYPOINT
constexpr int kCmdNavRtl = 20;            // MAV_CMD_NAV_RETURN_TO_LAUNCH
constexpr int kCmdNavTakeoff = 22;        // MAV_CMD_NAV_TAKEOFF
constexpr int kCmdDoChangeSpeed = 178;    // MAV_CMD_DO_CHANGE_SPEED
constexpr int kFrameGlobal = 0;           // MAV_FRAME_GLOBAL（AMSL）
constexpr int kFrameMission = 2;          // MAV_FRAME_MISSION
constexpr int kFrameGlobalRelative = 3;   // MAV_FRAME_GLOBAL_RELATIVE_ALT

QJsonObject waypoint(int seq, double lat, double lon, double alt, bool relative, int command = kCmdNavWaypoint)
{
    // param1 停留時間、param4 Yaw 刻意留 0：方位角（bearing）不是機頭 yaw。
    return QJsonObject{
        {"AMSLAltAboveTerrain", QJsonValue::Null},
        {"Altitude", alt},
        {"AltitudeMode", relative ? 1 : 2},
        {"autoContinue", true},
        {"command", command},
        {"doJumpId", seq},
        {"frame", relative ? kFrameGlobalRelative : kFrameGlobal},
        {"params", QJsonArray{0, 0, 0, 0, lat, lon, alt}},
        {"type", "SimpleItem"},
    };
}

QJsonObject changeSpeed(int seq, double speed)
{
    // param1=1 地速（Copter 使用）、param2=速度 m/s、param3=-1 油門不變
    return QJsonObject{
        {"autoContinue", true},
        {"command", kCmdDoChangeSpeed},
        {"doJumpId", seq},
        {"frame", kFrameMission},
        {"params", QJsonArray{1, speed, -1, 0, 0, 0, 0}},
        {"type", "SimpleItem"},
    };
}

// 把任務項目包成 QGC .plan（檔案版本 1，mission 版本 2）
QString wrapPlan(const QJsonArray &items, double speedMps, bool relative, double homeLat, double homeLon, double homeAmslM)
{
    const QJsonObject mission{
        {"cruiseSpeed", speedMps},
        {"firmwareType", 3},            // MAV_AUTOPILOT_ARDUPILOTMEGA
        {"globalPlanAltitudeMode", relative ? 1 : 2},
        {"hoverSpeed", speedMps},
        {"items", items},
        {"plannedHomePosition", QJsonArray{homeLat, homeLon, homeAmslM}},
        {"vehicleType", 2},             // MAV_TYPE_QUADROTOR
        {"version", 2},
    };
    const QJsonObject plan{
        {"fileType", "Plan"},
        {"geoFence", QJsonObject{{"circles", QJsonArray{}}, {"polygons", QJsonArray{}}, {"version", 2}}},
        {"groundStation", "QGroundControl"},
        {"mission", mission},
        {"rallyPoints", QJsonObject{{"points", QJsonArray{}}, {"version", 2}}},
        {"version", 1},
    };
    return QString::fromUtf8(QJsonDocument(plan).toJson(QJsonDocument::Indented));
}
} // namespace

// 建構：無狀態工具物件，可在 QML 直接建立
FdeWaypointTool::FdeWaypointTool(QObject *parent) : QObject(parent) {}

// 正算：WP1＋距離＋真北方位角 → WP2；錯誤（例如緯度超出 ±90）以 {ok:false,error} 回傳給 QML
QVariantMap FdeWaypointTool::direct(double lat, double lon, double distanceM, double bearingDeg) const
{
    try {
        const auto p = FdeQgc::directWgs84({lat, lon}, distanceM, bearingDeg);
        return {{"ok", true}, {"lat", p.latitudeDeg}, {"lon", p.longitudeDeg}};
    } catch (const std::exception &e) {
        return {{"ok", false}, {"error", QString::fromUtf8(e.what())}};
    }
}

// 反算：兩點 → 距離與起訖方位角（用來驗證正算結果）
QVariantMap FdeWaypointTool::inverse(double lat1, double lon1, double lat2, double lon2) const
{
    try {
        const auto r = FdeQgc::inverseWgs84({lat1, lon1}, {lat2, lon2});
        return {{"ok", true}, {"distance", r.distanceM}, {"bearing", r.initialBearingDeg}, {"finalBearing", r.finalBearingDeg}};
    } catch (const std::exception &e) {
        return {{"ok", false}, {"error", QString::fromUtf8(e.what())}};
    }
}

// 產生 WP1 → 改速 → WP2 的 QGC .plan（Relative 或 AMSL）
QString FdeWaypointTool::planJson(double wp1Lat, double wp1Lon, double distanceM, double bearingDeg, double altitudeM,
                                  const QString &altitudeReference, double speedMps, double homeAmslM) const
{
    const bool relative = altitudeReference.compare(QStringLiteral("amsl"), Qt::CaseInsensitive) != 0;
    const auto wp2 = FdeQgc::directWgs84({wp1Lat, wp1Lon}, distanceM, bearingDeg);
    QJsonArray items{
        waypoint(1, wp1Lat, wp1Lon, altitudeM, relative),
        changeSpeed(2, speedMps),
        waypoint(3, wp2.latitudeDeg, wp2.longitudeDeg, altitudeM, relative),
    };
    return wrapPlan(items, speedMps, relative, wp1Lat, wp1Lon, homeAmslM);
}

// 預設存放位置：文件\FDE-QGC\Plans
QString FdeWaypointTool::defaultPlanDirectory() const
{
    return QDir(QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation)).filePath(QStringLiteral("FDE-QGC/Plans"));
}

// 寫入 .plan 檔；path 可為本機路徑或 file: URL，空白時自動命名
QVariantMap FdeWaypointTool::writePlanFile(const QString &path, const QString &prefix, const QString &json) const
{
    QString target = path;
    if (target.startsWith(QStringLiteral("file:"))) {
        target = QUrl(target).toLocalFile();
    }
    if (target.isEmpty()) {
        QDir().mkpath(defaultPlanDirectory());
        target = QDir(defaultPlanDirectory()).filePath(QStringLiteral("%1-%2.plan").arg(prefix, QDateTime::currentDateTime().toString(QStringLiteral("yyyyMMdd-HHmmss"))));
    }
    QFile file(target);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        return {{"ok", false}, {"error", file.errorString()}};
    }
    file.write(json.toUtf8());
    file.close();
    return {{"ok", true}, {"path", QDir::toNativeSeparators(target)}, {"fileUrl", QUrl::fromLocalFile(target).toString()}, {"localPath", target}};
}

// 驗證速度與高度後寫出精確航點 .plan
QVariantMap FdeWaypointTool::savePlan(const QString &path, double wp1Lat, double wp1Lon, double distanceM, double bearingDeg,
                                      double altitudeM, const QString &altitudeReference, double speedMps, double homeAmslM) const
{
    if (!(speedMps > 0.0) || !(altitudeM >= 0.0)) {
        return {{"ok", false}, {"error", QStringLiteral("速度必須大於 0、高度不可為負")}};
    }
    try {
        return writePlanFile(path, QStringLiteral("FDE-WP"), planJson(wp1Lat, wp1Lon, distanceM, bearingDeg, altitudeM, altitudeReference, speedMps, homeAmslM));
    } catch (const std::exception &e) {
        return {{"ok", false}, {"error", QString::fromUtf8(e.what())}};
    }
}

// 8 字教學航線：檢查半徑／高度／速度上限後產生航點
QString FdeWaypointTool::figureEightPlanJson(double centerLat, double centerLon, double radiusM, double altitudeM,
                                             double speedMps, int pointsPerLoop) const
{
    if (!(radiusM >= 5.0 && radiusM <= 500.0)) {
        throw FdeQgc::WaypointMathError("8 字半徑需介於 5～500 公尺");
    }
    if (!(altitudeM > 0.0 && altitudeM <= 120.0)) {
        throw FdeQgc::WaypointMathError("高度需大於 0 且不超過 120 公尺");
    }
    if (!(speedMps > 0.0 && speedMps <= 15.0)) {
        throw FdeQgc::WaypointMathError("速度需介於 0～15 m/s");
    }
    const int n = std::clamp(pointsPerLoop, 4, 36);
    const FdeQgc::GeoCoordinate c{centerLat, centerLon};
    // 兩個相切圓：西圓圓心在中心點正西 R、東圓圓心在正東 R；交會點即中心點
    const auto west = FdeQgc::directWgs84(c, radiusM, 270.0);
    const auto east = FdeQgc::directWgs84(c, radiusM, 90.0);

    int seq = 1;
    QJsonArray items;
    items.append(waypoint(seq++, centerLat, centerLon, altitudeM, true, kCmdNavTakeoff));
    items.append(changeSpeed(seq++, speedMps));
    items.append(waypoint(seq++, centerLat, centerLon, altitudeM, true));
    // 西圓：從中心點（自西圓圓心看方位 90°）順時針繞一圈
    for (int k = 1; k <= n; ++k) {
        const auto p = FdeQgc::directWgs84(west, radiusM, 90.0 + 360.0 * k / n);
        items.append(waypoint(seq++, p.latitudeDeg, p.longitudeDeg, altitudeM, true));
    }
    // 東圓：從中心點（自東圓圓心看方位 270°）逆時針繞一圈 → 形成 8 字
    for (int k = 1; k <= n; ++k) {
        const auto p = FdeQgc::directWgs84(east, radiusM, 270.0 - 360.0 * k / n);
        items.append(waypoint(seq++, p.latitudeDeg, p.longitudeDeg, altitudeM, true));
    }
    items.append(QJsonObject{
        {"autoContinue", true},
        {"command", kCmdNavRtl},
        {"doJumpId", seq},
        {"frame", kFrameMission},
        {"params", QJsonArray{0, 0, 0, 0, 0, 0, 0}},
        {"type", "SimpleItem"},
    });
    return wrapPlan(items, speedMps, true, centerLat, centerLon, 0.0);
}

// 直接設定任務項目 param1～4（脫鉤用：DO_GRIPPER 或 DO_SET_SERVO）
bool FdeWaypointTool::setItemParams(QObject *item, double p1, double p2, double p3, double p4) const
{
    auto *simple = qobject_cast<SimpleMissionItem *>(item);
    if (!simple) {
        return false;
    }
    MissionItem &mi = simple->missionItem();
    mi.setParam1(p1);
    mi.setParam2(p2);
    mi.setParam3(p3);
    mi.setParam4(p4);
    return true;
}

// 寫出 8 字航線 .plan（錯誤以 {ok:false,error} 回傳）
QVariantMap FdeWaypointTool::saveFigureEight(const QString &path, double centerLat, double centerLon, double radiusM,
                                             double altitudeM, double speedMps, int pointsPerLoop) const
{
    try {
        return writePlanFile(path, QStringLiteral("FDE-8字"), figureEightPlanJson(centerLat, centerLon, radiusM, altitudeM, speedMps, pointsPerLoop));
    } catch (const std::exception &e) {
        return {{"ok", false}, {"error", QString::fromUtf8(e.what())}};
    }
}
