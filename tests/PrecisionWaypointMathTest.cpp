// FDE-QGC V1.0｜WGS84 精確航點核心測試（不依賴 Qt；MSVC：cl /std:c++20 /utf-8 /EHsc）
#include "../src/PrecisionWaypointMath.h"

#include <cmath>
#include <iostream>

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::cout << "FAIL " << msg << "\n"; ++failures; } else { std::cout << "PASS " << msg << "\n"; } } while (0)

int main()
{
    using namespace FdeQgc;

    // 真北 0° 必須增加緯度，而不是把方位角寫成 yaw。
    const auto north = directWgs84({0.0, 0.0}, 50.0, 0.0);
    CHECK(north.latitudeDeg > 0.0 && std::abs(north.longitudeDeg) < 1e-9, "north bearing increases latitude");

    // 東向 90° 必須增加經度。
    const auto east = directWgs84({0.0, 0.0}, 50.0, 90.0);
    CHECK(east.longitudeDeg > 0.0 && std::abs(east.latitudeDeg) < 1e-8, "east bearing increases longitude");

    // 跨越國際換日線後，經度必須正規化到 [-180, 180)。
    const auto dateline = directWgs84({0.0, 179.9999}, 50.0, 90.0);
    CHECK(dateline.longitudeDeg < 0.0 && dateline.longitudeDeg >= -180.0, "antimeridian longitude normalised");

    // 極區與小距離不能產生 NaN 或無限值。
    const auto polar = directWgs84({89.999, 0.0}, 1000.0, 0.0);
    CHECK(std::isfinite(polar.latitudeDeg) && std::isfinite(polar.longitudeDeg), "polar region finite");

    // 正算後反算要回到同一距離與方位角（台北 101 附近，100 m、方位 37°）。
    const GeoCoordinate wp1{25.033964, 121.564468};
    const auto wp2 = directWgs84(wp1, 100.0, 37.0);
    const auto inv = inverseWgs84(wp1, wp2);
    CHECK(std::abs(inv.distanceM - 100.0) < 1e-4 && std::abs(inv.initialBearingDeg - 37.0) < 1e-5, "direct/inverse round trip 100 m @ 37 deg");

    // 已知參考：Flinders Peak → Buninyong（Vincenty 1975 範例）：54972.271 m，起始方位 306°52'05.37"
    const auto ref = inverseWgs84({-37.95103341666667, 144.42486788888889}, {-37.65282113888889, 143.92649552777778});
    CHECK(std::abs(ref.distanceM - 54972.271) < 0.001 && std::abs(ref.initialBearingDeg - (306.0 + 52.0 / 60.0 + 5.37 / 3600.0)) < 1e-5, "Vincenty reference geodesic");

    // 距離 0 回傳原點；同點反算距離 0。
    const auto same = directWgs84(wp1, 0.0, 123.0);
    CHECK(same.latitudeDeg == wp1.latitudeDeg && same.longitudeDeg == wp1.longitudeDeg && inverseWgs84(wp1, wp1).distanceM == 0.0, "zero distance");

    // 不合法輸入要丟出例外。
    bool threw = false;
    try { directWgs84({91.0, 0.0}, 10.0, 0.0); } catch (const std::invalid_argument &) { threw = true; }
    CHECK(threw, "invalid latitude rejected");
    threw = false;
    try { directWgs84({0.0, 0.0}, -1.0, 0.0); } catch (const std::invalid_argument &) { threw = true; }
    CHECK(threw, "negative distance rejected");

    // 接近對跖點：反算必須在有限次數內結束，並丟出明確錯誤（不無限迴圈、不回傳錯值）。
    threw = false;
    bool finished = true;
    try { (void)inverseWgs84({0.0, 0.0}, {0.5, 179.7}); } catch (const WaypointMathError &) { threw = true; }
    CHECK(finished && threw, "near-antipodal inverse throws WaypointMathError");

    std::cout << (failures == 0 ? "PrecisionWaypointMath PASS\n" : "PrecisionWaypointMath FAIL\n");
    return failures == 0 ? 0 : 1;
}
