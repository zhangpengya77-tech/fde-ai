#pragma once

// FDE-QGC V1.0｜WGS84 精確航點核心（C++20，無 Qt 依賴，可單獨測試）
// - directWgs84：由 WP1、水平距離、真北方位角求 WP2（Vincenty 正算）。
// - inverseWgs84：由兩點求水平距離與起點／終點方位角（Vincenty 反算）。
// - 兩者都限制迭代次數；不收斂時丟出 WaypointMathError，不會無限迴圈，也不回傳未收斂的值。
//   反算在「接近對跖點」時可能不收斂，呼叫端必須顯示錯誤，不可自行猜值。
// - 方位角（bearing）是兩點的地理方向，不是機頭 yaw。

#include <cmath>
#include <numbers>
#include <stdexcept>

namespace FdeQgc {

struct GeoCoordinate {
    double latitudeDeg;
    double longitudeDeg;
};

struct InverseResult {
    double distanceM;
    double initialBearingDeg;   // WP1 出發時的真北方位角 0–360
    double finalBearingDeg;     // 抵達 WP2 時的真北方位角 0–360
};

class WaypointMathError : public std::runtime_error
{
public:
    using std::runtime_error::runtime_error;
};

namespace detail {
constexpr double a = 6378137.0;
constexpr double f = 1.0 / 298.257223563;
constexpr double b = a * (1.0 - f);
constexpr double pi = std::numbers::pi_v<double>;
constexpr int maxIterations = 200;
inline double rad(double d) { return d * pi / 180.0; }
inline double deg(double r) { return r * 180.0 / pi; }
inline double wrap360(double d)
{
    d = std::fmod(d, 360.0);
    return d < 0.0 ? d + 360.0 : d;
}
inline double wrap180(double d) { return std::fmod(std::fmod(d + 180.0, 360.0) + 360.0, 360.0) - 180.0; }
inline void checkLatLon(const GeoCoordinate &c)
{
    if (!std::isfinite(c.latitudeDeg) || !std::isfinite(c.longitudeDeg) || c.latitudeDeg < -90.0 || c.latitudeDeg > 90.0 ||
        c.longitudeDeg < -180.0 || c.longitudeDeg > 180.0) {
        throw std::invalid_argument("Invalid WGS84 coordinate");
    }
}
} // namespace detail

// 以 WGS84 橢球正算由起點、水平距離與真北方位角求得下一個航點。
inline GeoCoordinate directWgs84(const GeoCoordinate start, const double distanceM, double bearingDeg)
{
    using namespace detail;
    checkLatLon(start);
    if (!std::isfinite(distanceM) || !std::isfinite(bearingDeg) || distanceM < 0.0) {
        throw std::invalid_argument("Invalid WGS84 waypoint input");
    }
    if (distanceM == 0.0) {
        return start;
    }

    bearingDeg = wrap360(bearingDeg);
    const double alpha1 = rad(bearingDeg);
    const double phi1 = rad(start.latitudeDeg);
    const double lambda1 = rad(start.longitudeDeg);
    const double tanU1 = (1.0 - f) * std::tan(phi1);
    const double cosU1 = 1.0 / std::sqrt(1.0 + tanU1 * tanU1);
    const double sinU1 = tanU1 * cosU1;
    const double sinAlpha1 = std::sin(alpha1);
    const double cosAlpha1 = std::cos(alpha1);
    const double sigma1 = std::atan2(tanU1, cosAlpha1);
    const double sinAlpha = cosU1 * sinAlpha1;
    const double cosSqAlpha = 1.0 - sinAlpha * sinAlpha;
    const double uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const double A = 1.0 + (uSq / 16384.0) * (4096.0 + uSq * (-768.0 + uSq * (320.0 - 175.0 * uSq)));
    const double B = (uSq / 1024.0) * (256.0 + uSq * (-128.0 + uSq * (74.0 - 47.0 * uSq)));

    double sigma = distanceM / (b * A);
    bool converged = false;
    for (int iteration = 0; iteration < maxIterations; ++iteration) {
        const double twoSigmaM = 2.0 * sigma1 + sigma;
        const double sinSigma = std::sin(sigma);
        const double cosSigma = std::cos(sigma);
        const double cosTwoSigmaM = std::cos(twoSigmaM);
        const double deltaSigma = B * sinSigma * (cosTwoSigmaM + (B / 4.0) *
            (cosSigma * (-1.0 + 2.0 * cosTwoSigmaM * cosTwoSigmaM) - (B / 6.0) * cosTwoSigmaM *
            (-3.0 + 4.0 * sinSigma * sinSigma) * (-3.0 + 4.0 * cosTwoSigmaM * cosTwoSigmaM)));
        const double nextSigma = distanceM / (b * A) + deltaSigma;
        if (std::abs(nextSigma - sigma) < 1e-13) {
            sigma = nextSigma;
            converged = true;
            break;
        }
        sigma = nextSigma;
    }
    if (!converged) {
        throw WaypointMathError("Vincenty direct did not converge");
    }

    const double sinSigma = std::sin(sigma);
    const double cosSigma = std::cos(sigma);
    const double twoSigmaM = 2.0 * sigma1 + sigma;
    const double cosTwoSigmaM = std::cos(twoSigmaM);
    const double phi2 = std::atan2(sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
        (1.0 - f) * std::sqrt(sinAlpha * sinAlpha + std::pow(sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1, 2.0)));
    const double lambda = std::atan2(sinSigma * sinAlpha1,
        cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
    const double C = (f / 16.0) * cosSqAlpha * (4.0 + f * (4.0 - 3.0 * cosSqAlpha));
    const double L = lambda - (1.0 - C) * f * sinAlpha *
        (sigma + C * sinSigma * (cosTwoSigmaM + C * cosSigma * (-1.0 + 2.0 * cosTwoSigmaM * cosTwoSigmaM)));

    return {deg(phi2), wrap180(deg(lambda1 + L))};
}

// 以 WGS84 橢球反算兩點的水平距離與方位角；接近對跖點不收斂時丟出 WaypointMathError。
inline InverseResult inverseWgs84(const GeoCoordinate p1, const GeoCoordinate p2)
{
    using namespace detail;
    checkLatLon(p1);
    checkLatLon(p2);
    const double L = rad(wrap180(p2.longitudeDeg - p1.longitudeDeg));
    const double tanU1 = (1.0 - f) * std::tan(rad(p1.latitudeDeg));
    const double cosU1 = 1.0 / std::sqrt(1.0 + tanU1 * tanU1);
    const double sinU1 = tanU1 * cosU1;
    const double tanU2 = (1.0 - f) * std::tan(rad(p2.latitudeDeg));
    const double cosU2 = 1.0 / std::sqrt(1.0 + tanU2 * tanU2);
    const double sinU2 = tanU2 * cosU2;

    double lambda = L, sinLambda = 0, cosLambda = 0, sinSigma = 0, cosSigma = 0, sigma = 0, cosSqAlpha = 0, cosTwoSigmaM = 0;
    bool converged = false;
    for (int iteration = 0; iteration < maxIterations; ++iteration) {
        sinLambda = std::sin(lambda);
        cosLambda = std::cos(lambda);
        const double sinSqSigma = std::pow(cosU2 * sinLambda, 2.0) + std::pow(cosU1 * sinU2 - sinU1 * cosU2 * cosLambda, 2.0);
        if (sinSqSigma == 0.0) {
            return {0.0, 0.0, 0.0};   // 同一點
        }
        sinSigma = std::sqrt(sinSqSigma);
        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = std::atan2(sinSigma, cosSigma);
        const double sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
        cosSqAlpha = 1.0 - sinAlpha * sinAlpha;
        cosTwoSigmaM = cosSqAlpha != 0.0 ? cosSigma - 2.0 * sinU1 * sinU2 / cosSqAlpha : 0.0;   // 赤道線
        const double C = (f / 16.0) * cosSqAlpha * (4.0 + f * (4.0 - 3.0 * cosSqAlpha));
        const double lambdaPrev = lambda;
        lambda = L + (1.0 - C) * f * sinAlpha * (sigma + C * sinSigma * (cosTwoSigmaM + C * cosSigma * (-1.0 + 2.0 * cosTwoSigmaM * cosTwoSigmaM)));
        if (std::abs(lambda) > pi) {
            break;   // 對跖點附近 λ 發散
        }
        if (std::abs(lambda - lambdaPrev) < 1e-12) {
            converged = true;
            break;
        }
    }
    if (!converged) {
        throw WaypointMathError("Vincenty inverse did not converge (near-antipodal points)");
    }
    const double uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const double A = 1.0 + (uSq / 16384.0) * (4096.0 + uSq * (-768.0 + uSq * (320.0 - 175.0 * uSq)));
    const double B = (uSq / 1024.0) * (256.0 + uSq * (-128.0 + uSq * (74.0 - 47.0 * uSq)));
    const double deltaSigma = B * sinSigma * (cosTwoSigmaM + (B / 4.0) * (cosSigma * (-1.0 + 2.0 * cosTwoSigmaM * cosTwoSigmaM) -
        (B / 6.0) * cosTwoSigmaM * (-3.0 + 4.0 * sinSigma * sinSigma) * (-3.0 + 4.0 * cosTwoSigmaM * cosTwoSigmaM)));
    const double s = b * A * (sigma - deltaSigma);
    const double alpha1 = std::atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    const double alpha2 = std::atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda);
    return {s, wrap360(deg(alpha1)), wrap360(deg(alpha2))};
}

} // namespace FdeQgc
