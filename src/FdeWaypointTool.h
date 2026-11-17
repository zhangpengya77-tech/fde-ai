#pragma once

// FDE-QGC V1.0｜精確航點工具（給 QML 教學頁使用）
// 包裝 PrecisionWaypointMath（WGS84 Vincenty），並輸出 QGC 原生 .plan 格式：
//   WP1 → DO_CHANGE_SPEED（速度命令）→ WP2；高度框架 Relative（MAV_FRAME_GLOBAL_RELATIVE_ALT）或 AMSL（MAV_FRAME_GLOBAL）。
// 只寫檔，不上傳飛控；上傳一律經 QGC 原生 Plan View 的「Upload」由使用者確認。

#include <QtCore/QObject>
#include <QtCore/QVariantMap>

class FdeWaypointTool : public QObject
{
    Q_OBJECT

public:
    explicit FdeWaypointTool(QObject *parent = nullptr);

    /// WP1 + 水平距離 + 真北方位角 → WP2。回傳 {ok, lat, lon} 或 {ok:false, error}
    Q_INVOKABLE QVariantMap direct(double lat, double lon, double distanceM, double bearingDeg) const;
    /// 兩點 → 距離、起點方位、終點方位。接近對跖點不收斂時 {ok:false, error}
    Q_INVOKABLE QVariantMap inverse(double lat1, double lon1, double lat2, double lon2) const;
    /// 產生 QGC .plan JSON 字串（不寫檔）
    Q_INVOKABLE QString planJson(double wp1Lat, double wp1Lon, double distanceM, double bearingDeg,
                                 double altitudeM, const QString &altitudeReference, double speedMps,
                                 double homeAmslM = 0.0) const;
    /// 寫成 .plan 檔；path 空白時存到「文件\FDE-QGC\Plans」。回傳 {ok, path} 或 {ok:false, error}
    Q_INVOKABLE QVariantMap savePlan(const QString &path, double wp1Lat, double wp1Lon, double distanceM, double bearingDeg,
                                     double altitudeM, const QString &altitudeReference, double speedMps,
                                     double homeAmslM = 0.0) const;
    Q_INVOKABLE QString defaultPlanDirectory() const;

    /// 8 字教學航線：起飛 → 改速 → 中心點 → 西圓順時針 → 東圓逆時針 → RTL（高度一律 Relative）
    /// 參數不合法時丟出 FdeQgc::WaypointMathError
    QString figureEightPlanJson(double centerLat, double centerLon, double radiusM, double altitudeM,
                                double speedMps, int pointsPerLoop) const;
    /// 寫 8 字 .plan；回傳 {ok, path, fileUrl, localPath} 或 {ok:false, error}
    Q_INVOKABLE QVariantMap saveFigureEight(const QString &path, double centerLat, double centerLon, double radiusM,
                                            double altitudeM, double speedMps, int pointsPerLoop = 12) const;

    /// 設定航線規劃頁上某個 SimpleMissionItem 的 param1～param4（脫鉤／投放指令用）。
    /// 只改「計畫」，不會上傳飛控。item 不是 SimpleMissionItem 時回傳 false。
    Q_INVOKABLE bool setItemParams(QObject *item, double p1, double p2, double p3 = 0.0, double p4 = 0.0) const;

private:
    QVariantMap writePlanFile(const QString &path, const QString &prefix, const QString &json) const;
};
