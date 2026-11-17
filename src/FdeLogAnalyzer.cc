#include "FdeLogAnalyzer.h"

#include "LogViewerDataFlashParser.h"   // QGC 官方 ArduPilot DataFlash 解析器

#include <QtCore/QDateTime>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QPointer>
#include <QtCore/QStandardPaths>
#include <QtCore/QTextStream>
#include <QtCore/QThreadPool>
#include <QtCore/QUrl>

#include <algorithm>
#include <cmath>

namespace {

// ---------------------------------------------------------------------------
// 統計工具
// ---------------------------------------------------------------------------
struct Stats {
    int n = 0;
    double mean = NAN;
    double min = NAN;
    double max = NAN;
    double p95 = NAN;
    double last = NAN;
};

Stats statsOf(const QVector<QPointF> &v)
{
    Stats s;
    if (v.isEmpty()) {
        return s;
    }
    std::vector<double> ys;
    ys.reserve(v.size());
    double sum = 0;
    for (const QPointF &p : v) {
        if (std::isfinite(p.y())) {
            ys.push_back(p.y());
            sum += p.y();
        }
    }
    if (ys.empty()) {
        return s;
    }
    s.n = static_cast<int>(ys.size());
    s.mean = sum / s.n;
    s.last = ys.back();
    std::sort(ys.begin(), ys.end());
    s.min = ys.front();
    s.max = ys.back();
    s.p95 = ys[static_cast<size_t>(std::floor(0.95 * (s.n - 1)))];
    return s;
}

// 同一訊息內兩欄位逐筆配對（時間戳相同）→ 誤差 RMS、期望值 RMS、誤差正負號翻轉率（判斷振盪）
struct Tracking {
    int n = 0;
    double errRms = NAN;
    double desRms = NAN;
    double signFlipsPerSec = NAN;
};

Tracking trackingOf(const QVector<QPointF> &des, const QVector<QPointF> &act)
{
    Tracking t;
    const int n = static_cast<int>(std::min(des.size(), act.size()));
    if (n < 20) {
        return t;
    }
    double se = 0, sd = 0;
    int flips = 0, prevSign = 0;
    for (int i = 0; i < n; ++i) {
        const double e = act[i].y() - des[i].y();
        se += e * e;
        sd += des[i].y() * des[i].y();
        // 只計算明顯的誤差翻轉（|e|>1 單位），避免雜訊
        const int sign = e > 1.0 ? 1 : (e < -1.0 ? -1 : 0);
        if (sign != 0) {
            if (prevSign != 0 && sign != prevSign) {
                ++flips;
            }
            prevSign = sign;
        }
    }
    const double dur = des[n - 1].x() - des[0].x();
    t.n = n;
    t.errRms = std::sqrt(se / n);
    t.desRms = std::sqrt(sd / n);
    t.signFlipsPerSec = dur > 0 ? flips / dur : NAN;
    return t;
}

QVariant num(double v, int digits = 2)
{
    return std::isfinite(v) ? QVariant(std::round(v * std::pow(10.0, digits)) / std::pow(10.0, digits)) : QVariant();
}

// 等級：ok／warn／bad／info
QVariantMap finding(const QString &area, const QString &level, const QString &title, const QString &detail, const QString &advice)
{
    return {{"area", area}, {"level", level}, {"title", title}, {"detail", detail}, {"advice", advice}};
}

QVariantMap suggestion(const QString &param, double suggested, const QString &reason, const QString &level, bool needsCheck = false)
{
    return {{"param", param}, {"suggested", suggested}, {"reason", reason}, {"level", level}, {"needsCheck", needsCheck}};
}

const QVector<QPointF> &field(const QHash<QString, QVector<QPointF>> &s, const QString &name)
{
    static const QVector<QPointF> empty;
    const auto it = s.constFind(name);
    return it == s.constEnd() ? empty : it.value();
}

// ---------------------------------------------------------------------------
// 規則式調參建議（依 ArduPilot Copter 官方調參指引）
// metrics：分析數值；p：參數（日誌內或飛控目前值）
// ---------------------------------------------------------------------------
QVariantList buildSuggestions(const QVariantMap &m, const QVariantMap &p)
{
    QVariantList out;
    auto has = [&](const char *k) { return p.contains(QLatin1String(k)); };
    auto pv = [&](const char *k) { return p.value(QLatin1String(k)).toDouble(); };
    auto mv = [&](const char *k) { return m.value(QLatin1String(k)).toDouble(); };
    auto mhas = [&](const char *k) { return m.contains(QLatin1String(k)) && m.value(QLatin1String(k)).isValid(); };

    const bool vibeBad = mhas("vibeMaxP95") && mv("vibeMaxP95") >= 30.0;
    const bool clipping = mhas("clipTotal") && mv("clipTotal") > 0;

    // 1) 振動過大：先處理機械問題，不建議調高 PID
    if (vibeBad || clipping) {
        if (has("INS_HNTCH_ENABLE") && pv("INS_HNTCH_ENABLE") == 0) {
            out.append(suggestion("INS_HNTCH_ENABLE", 1, "振動偏高：啟用諧波陷波濾波器（寫入後需重新開機，並以 FFT 確認頻率）", "warn", true));
            if (has("INS_HNTCH_MODE")) {
                out.append(suggestion("INS_HNTCH_MODE", 1, "陷波頻率隨油門追蹤（模式 1）", "warn", true));
            }
            if (mhas("hoverThrottle") && has("INS_HNTCH_REF")) {
                out.append(suggestion("INS_HNTCH_REF", std::round(mv("hoverThrottle") * 100) / 100.0, "陷波參考油門＝日誌中的懸停油門", "warn", true));
            }
        }
    }

    // 2) 姿態追蹤：振盪 → 降低 P/D；遲鈍 → 建議 AutoTune（不直接調高增益）
    const bool rollOsc = mhas("rateRollFlips") && mv("rateRollFlips") > 4.0 && mhas("rateRollErrRatio") && mv("rateRollErrRatio") > 0.35;
    const bool pitchOsc = mhas("ratePitchFlips") && mv("ratePitchFlips") > 4.0 && mhas("ratePitchErrRatio") && mv("ratePitchErrRatio") > 0.35;
    if (!vibeBad) {
        if (rollOsc && has("ATC_RAT_RLL_P")) {
            out.append(suggestion("ATC_RAT_RLL_P", std::round(pv("ATC_RAT_RLL_P") * 0.8 * 10000) / 10000.0, "橫滾角速度誤差頻繁正負翻轉（疑似振盪）：P 降低 20%", "warn"));
            if (has("ATC_RAT_RLL_D") && pv("ATC_RAT_RLL_D") > 0) {
                out.append(suggestion("ATC_RAT_RLL_D", std::round(pv("ATC_RAT_RLL_D") * 0.8 * 100000) / 100000.0, "橫滾振盪：D 同步降低 20%", "warn"));
            }
        }
        if (pitchOsc && has("ATC_RAT_PIT_P")) {
            out.append(suggestion("ATC_RAT_PIT_P", std::round(pv("ATC_RAT_PIT_P") * 0.8 * 10000) / 10000.0, "俯仰角速度誤差頻繁正負翻轉（疑似振盪）：P 降低 20%", "warn"));
            if (has("ATC_RAT_PIT_D") && pv("ATC_RAT_PIT_D") > 0) {
                out.append(suggestion("ATC_RAT_PIT_D", std::round(pv("ATC_RAT_PIT_D") * 0.8 * 100000) / 100000.0, "俯仰振盪：D 同步降低 20%", "warn"));
            }
        }
    }

    // 3) 懸停油門學習值
    if (mhas("hoverThrottle") && has("MOT_THST_HOVER")) {
        const double h = mv("hoverThrottle");
        if (h > 0.1 && h < 0.9 && std::abs(h - pv("MOT_THST_HOVER")) > 0.05 && (!has("MOT_HOVER_LEARN") || pv("MOT_HOVER_LEARN") == 0)) {
            out.append(suggestion("MOT_THST_HOVER", std::round(h * 1000) / 1000.0, "日誌估計的懸停油門與參數差距超過 0.05（自動學習未開啟）", "info"));
        }
    }

    // 4) 電池失效保護
    if (has("BATT_FS_LOW_ACT") && pv("BATT_FS_LOW_ACT") == 0) {
        out.append(suggestion("BATT_FS_LOW_ACT", 2, "低電量失效保護未啟用：建議設為 RTL（2）", "bad"));
    }
    if (has("BATT_LOW_VOLT") && pv("BATT_LOW_VOLT") <= 0 && mhas("cells")) {
        out.append(suggestion("BATT_LOW_VOLT", mv("cells") * 3.5, QStringLiteral("未設定低電壓門檻：以 %1 芯 × 3.5 V 估算").arg(mv("cells")), "bad"));
    }
    if (has("BATT_CRT_VOLT") && pv("BATT_CRT_VOLT") <= 0 && mhas("cells") && has("BATT_FS_CRT_ACT")) {
        out.append(suggestion("BATT_CRT_VOLT", mv("cells") * 3.3, QStringLiteral("未設定臨界電壓：以 %1 芯 × 3.3 V 估算").arg(mv("cells")), "warn"));
    }

    // 5) 教學安全：圍欄
    if (has("FENCE_ENABLE") && pv("FENCE_ENABLE") == 0) {
        out.append(suggestion("FENCE_ENABLE", 1, "教學飛行建議啟用地理圍欄（搭配 FENCE_TYPE／FENCE_RADIUS／FENCE_ALT_MAX）", "warn"));
    }

    return out;
}

QVariantMap analyzeResult(const LogParseResult &r, QHash<QString, QVector<QPointF>> &keep)
{
    const auto &S = r.fieldSamples;
    QVariantList findings;
    QVariantMap metrics;
    QVariantMap params;
    for (const QVariant &row : r.parameters) {
        const QVariantMap m = row.toMap();
        params.insert(m.value("name").toString(), m.value("value"));
    }

    const double duration = (r.maxTimestamp > r.minTimestamp) ? r.maxTimestamp - r.minTimestamp : 0;
    metrics["durationSec"] = num(duration, 0);

    // ---- 振動 ----
    const Stats vx = statsOf(field(S, "VIBE.VibeX")), vy = statsOf(field(S, "VIBE.VibeY")), vz = statsOf(field(S, "VIBE.VibeZ"));
    if (vx.n > 0) {
        const double p95 = std::max({vx.p95, vy.p95, vz.p95});
        const double mx = std::max({vx.max, vy.max, vz.max});
        double clip = 0;
        for (const char *c : {"VIBE.Clip", "VIBE.Clip0", "VIBE.Clip1", "VIBE.Clip2"}) {
            const Stats cs = statsOf(field(S, QLatin1String(c)));
            if (cs.n > 0) {
                clip += cs.max;
            }
        }
        metrics["vibeMaxP95"] = num(p95, 1);
        metrics["vibeMax"] = num(mx, 1);
        metrics["clipTotal"] = num(clip, 0);
        const QString detail = QStringLiteral("X/Y/Z 95 百分位：%1／%2／%3 m/s²；最大 %4；削波（Clip）累計 %5")
                                   .arg(vx.p95, 0, 'f', 1).arg(vy.p95, 0, 'f', 1).arg(vz.p95, 0, 'f', 1).arg(mx, 0, 'f', 1).arg(clip, 0, 'f', 0);
        if (p95 >= 30 || clip > 0) {
            findings.append(finding("振動", "bad", "振動過大或加速度計削波", detail, "先處理機械：檢查槳葉平衡與破損、馬達軸承、飛控避震；振動合格前不要調高 PID。必要時啟用諧波陷波（見 AI 調參）。"));
        } else if (p95 >= 15) {
            findings.append(finding("振動", "warn", "振動偏高", detail, "建議檢查槳葉與避震；ArduPilot 建議長期低於 30 m/s²，最好低於 15。"));
        } else {
            findings.append(finding("振動", "ok", "振動良好", detail, "維持現狀。"));
        }
        keep["VIBE.VibeX"] = field(S, "VIBE.VibeX");
        keep["VIBE.VibeY"] = field(S, "VIBE.VibeY");
        keep["VIBE.VibeZ"] = field(S, "VIBE.VibeZ");
    } else {
        findings.append(finding("振動", "info", "日誌沒有 VIBE 資料", "", "確認 LOG_BITMASK 有記錄 IMU 相關訊息。"));
    }

    // ---- 姿態追蹤（角度）----
    const Tracking tr = trackingOf(field(S, "ATT.DesRoll"), field(S, "ATT.Roll"));
    const Tracking tp = trackingOf(field(S, "ATT.DesPitch"), field(S, "ATT.Pitch"));
    if (tr.n > 0) {
        metrics["attRollErrRms"] = num(tr.errRms, 2);
        metrics["attPitchErrRms"] = num(tp.errRms, 2);
        const double worst = std::max(tr.errRms, std::isfinite(tp.errRms) ? tp.errRms : 0.0);
        const QString detail = QStringLiteral("期望與實際角度誤差 RMS：橫滾 %1°、俯仰 %2°").arg(tr.errRms, 0, 'f', 2).arg(tp.errRms, 0, 'f', 2);
        if (worst > 10) {
            findings.append(finding("姿態追蹤", "bad", "姿態追蹤誤差大", detail, "可能是 PID 過低／過高、機體重心偏移或馬達故障；先看下方角速度分析與馬達平衡。"));
        } else if (worst > 5) {
            findings.append(finding("姿態追蹤", "warn", "姿態追蹤普通", detail, "建議在空曠處執行 AutoTune（官方自動調參）。"));
        } else {
            findings.append(finding("姿態追蹤", "ok", "姿態追蹤良好", detail, "維持現狀。"));
        }
        keep["ATT.DesRoll"] = field(S, "ATT.DesRoll");
        keep["ATT.Roll"] = field(S, "ATT.Roll");
        keep["ATT.DesPitch"] = field(S, "ATT.DesPitch");
        keep["ATT.Pitch"] = field(S, "ATT.Pitch");
    }

    // ---- 角速度追蹤（PID 響應／振盪）----
    const Tracking rr = trackingOf(field(S, "RATE.RDes"), field(S, "RATE.R"));
    const Tracking rp = trackingOf(field(S, "RATE.PDes"), field(S, "RATE.P"));
    if (rr.n > 0) {
        const double rRatio = rr.desRms > 1 ? rr.errRms / rr.desRms : NAN;
        const double pRatio = rp.desRms > 1 ? rp.errRms / rp.desRms : NAN;
        metrics["rateRollErrRatio"] = num(rRatio, 2);
        metrics["ratePitchErrRatio"] = num(pRatio, 2);
        metrics["rateRollFlips"] = num(rr.signFlipsPerSec, 1);
        metrics["ratePitchFlips"] = num(rp.signFlipsPerSec, 1);
        const QString detail = QStringLiteral("角速度誤差／期望比：橫滾 %1、俯仰 %2；誤差翻轉率：%3／%4 次/秒")
                                   .arg(rRatio, 0, 'f', 2).arg(pRatio, 0, 'f', 2).arg(rr.signFlipsPerSec, 0, 'f', 1).arg(rp.signFlipsPerSec, 0, 'f', 1);
        const bool osc = (rr.signFlipsPerSec > 4 && rRatio > 0.35) || (rp.signFlipsPerSec > 4 && pRatio > 0.35);
        if (osc) {
            findings.append(finding("PID 響應", "bad", "疑似振盪（誤差快速正負翻轉）", detail, "建議降低對應軸的 ATC_RAT_*_P 與 _D 約 20%，或重做 AutoTune。"));
        } else if ((std::isfinite(rRatio) && rRatio > 0.5) || (std::isfinite(pRatio) && pRatio > 0.5)) {
            findings.append(finding("PID 響應", "warn", "響應偏慢", detail, "建議執行 AutoTune，不建議手動大幅調高增益。"));
        } else {
            findings.append(finding("PID 響應", "ok", "角速度響應正常", detail, "維持現狀。"));
        }
        keep["RATE.RDes"] = field(S, "RATE.RDes");
        keep["RATE.R"] = field(S, "RATE.R");
        keep["RATE.PDes"] = field(S, "RATE.PDes");
        keep["RATE.P"] = field(S, "RATE.P");
    }

    // ---- 懸停油門 ----
    const Stats thh = statsOf(field(S, "CTUN.ThH"));
    const Stats tho = statsOf(field(S, "CTUN.ThO"));
    if (thh.n > 0 || tho.n > 0) {
        const double hover = thh.n > 0 ? thh.last : tho.mean;
        metrics["hoverThrottle"] = num(hover, 3);
        const QString detail = QStringLiteral("估計懸停油門 %1（0～1）").arg(hover, 0, 'f', 2);
        if (hover > 0.7) {
            findings.append(finding("動力", "bad", "懸停油門過高（動力不足）", detail, "減輕重量或更換更大槳／馬達；剩餘動力不足時抗風與操控性差。"));
        } else if (hover > 0.6) {
            findings.append(finding("動力", "warn", "懸停油門偏高", detail, "建議懸停油門在 0.2～0.6 之間。"));
        } else if (hover < 0.15) {
            findings.append(finding("動力", "warn", "懸停油門偏低（動力過剩）", detail, "油門解析度差、較難精細控制；可考慮較小槳或降低電壓。"));
        } else {
            findings.append(finding("動力", "ok", "懸停油門合理", detail, "維持現狀。"));
        }
    }

    // ---- 電池 ----
    const Stats bv = statsOf(field(S, "BAT.Volt"));
    const Stats bc = statsOf(field(S, "BAT.Curr"));
    if (bv.n > 0) {
        const int cells = bv.max > 0 ? static_cast<int>(std::round(bv.max / 4.15)) : 0;
        metrics["battMinV"] = num(bv.min, 2);
        metrics["battMaxV"] = num(bv.max, 2);
        metrics["battMaxA"] = num(bc.max, 1);
        if (cells > 0) {
            metrics["cells"] = cells;
        }
        const double perCell = cells > 0 ? bv.min / cells : NAN;
        const QString detail = QStringLiteral("電壓 %1～%2 V（推估 %3 芯，最低每芯 %4 V）；最大電流 %5 A")
                                   .arg(bv.min, 0, 'f', 2).arg(bv.max, 0, 'f', 2).arg(cells).arg(perCell, 0, 'f', 2).arg(bc.max, 0, 'f', 1);
        if (std::isfinite(perCell) && perCell < 3.3) {
            findings.append(finding("電池", "bad", "電池過放（每芯低於 3.3 V）", detail, "縮短飛行時間、檢查電池健康；設定低電壓失效保護（見 AI 調參）。"));
        } else if (std::isfinite(perCell) && perCell < 3.5) {
            findings.append(finding("電池", "warn", "電池電壓偏低", detail, "建議在每芯 3.5 V 前返航。"));
        } else {
            findings.append(finding("電池", "ok", "電池電壓正常", detail, "維持現狀。"));
        }
        keep["BAT.Volt"] = field(S, "BAT.Volt");
    }

    // ---- 飛控供電 ----
    const Stats vcc = statsOf(field(S, "POWR.Vcc"));
    if (vcc.n > 0) {
        metrics["vccMin"] = num(vcc.min, 2);
        metrics["vccMax"] = num(vcc.max, 2);
        const QString detail = QStringLiteral("飛控 5V 供電 %1～%2 V").arg(vcc.min, 0, 'f', 2).arg(vcc.max, 0, 'f', 2);
        if (vcc.min < 4.5 || vcc.max > 5.5 || (vcc.max - vcc.min) > 0.3) {
            findings.append(finding("供電", "warn", "飛控供電不穩", detail, "檢查電源模組（PM）與接線，避免舵機與飛控共用電源。"));
        } else {
            findings.append(finding("供電", "ok", "飛控供電穩定", detail, "維持現狀。"));
        }
    }

    // ---- GPS 定位品質 ----
    const Stats ns = statsOf(field(S, "GPS.NSats"));
    const Stats hd = statsOf(field(S, "GPS.HDop"));
    if (ns.n > 0) {
        metrics["gpsMinSats"] = num(ns.min, 0);
        metrics["gpsMaxHdop"] = num(hd.max, 2);
        const QString detail = QStringLiteral("衛星數最少 %1、HDOP 最大 %2").arg(ns.min, 0, 'f', 0).arg(hd.max, 0, 'f', 2);
        if (ns.min < 6 || hd.max > 2.5) {
            findings.append(finding("GPS", "warn", "GPS 品質不穩定", detail, "等待衛星數 ≥ 10、HDOP < 1.4 再起飛；檢查 GPS 天線是否遠離電源線與圖傳。"));
        } else {
            findings.append(finding("GPS", "ok", "GPS 品質良好", detail, "維持現狀。"));
        }
    }

    // ---- EKF 狀態估測變異 ----
    double ekfMax = 0;
    bool ekfHas = false;
    for (const char *f : {"XKF4.SV", "XKF4.SP", "XKF4.SH", "XKF4.SM"}) {
        const Stats e = statsOf(field(S, QLatin1String(f)));
        if (e.n > 0) {
            ekfHas = true;
            ekfMax = std::max(ekfMax, e.max);
        }
    }
    if (ekfHas) {
        metrics["ekfMaxVariance"] = num(ekfMax, 2);
        const QString detail = QStringLiteral("EKF 速度／位置／高度／磁力計變異最大值 %1").arg(ekfMax, 0, 'f', 2);
        if (ekfMax > 1.0) {
            findings.append(finding("EKF", "bad", "EKF 變異超過 1.0", detail, "可能是羅盤干擾、振動或 GPS 異常；重新校正羅盤並檢查振動。"));
        } else if (ekfMax > 0.5) {
            findings.append(finding("EKF", "warn", "EKF 變異偏高", detail, "注意羅盤與 GPS 品質。"));
        } else {
            findings.append(finding("EKF", "ok", "EKF 正常", detail, "維持現狀。"));
        }
    }

    // ---- 馬達平衡（四軸 RCOU C1～C4 平均 PWM）----
    QVector<double> motorMeans;
    for (int c = 1; c <= 4; ++c) {
        const Stats ms = statsOf(field(S, QStringLiteral("RCOU.C%1").arg(c)));
        if (ms.n > 0 && ms.mean > 1050) {
            motorMeans.append(ms.mean);
        }
    }
    if (motorMeans.size() == 4) {
        const auto [mn, mx] = std::minmax_element(motorMeans.begin(), motorMeans.end());
        const double spread = *mx - *mn;
        metrics["motorSpreadPwm"] = num(spread, 0);
        const QString detail = QStringLiteral("馬達平均輸出 M1～M4：%1／%2／%3／%4（差 %5）")
                                   .arg(motorMeans[0], 0, 'f', 0).arg(motorMeans[1], 0, 'f', 0).arg(motorMeans[2], 0, 'f', 0).arg(motorMeans[3], 0, 'f', 0).arg(spread, 0, 'f', 0);
        if (spread > 100) {
            findings.append(finding("馬達平衡", "warn", "馬達輸出不平均", detail, "檢查重心、馬達是否歪斜、槳是否裝反或損壞。"));
        } else {
            findings.append(finding("馬達平衡", "ok", "馬達輸出平均", detail, "維持現狀。"));
        }
    }

    // ---- 錯誤與失效保護 ----
    QStringList errs;
    for (const QVariant &ev : r.events) {
        const QVariantMap e = ev.toMap();
        if (e.value("type").toString() == QLatin1String("error")) {
            errs.append(QStringLiteral("%1 s：%2").arg(e.value("time").toDouble() - r.minTimestamp, 0, 'f', 1).arg(e.value("description").toString()));
        }
    }
    for (const QVariant &mv : r.messages) {
        const QString t = mv.toMap().value("text").toString();
        if (t.contains(QLatin1String("Crash"), Qt::CaseInsensitive) || t.contains(QLatin1String("failsafe"), Qt::CaseInsensitive)) {
            errs.append(QStringLiteral("%1 s：%2").arg(mv.toMap().value("time").toDouble() - r.minTimestamp, 0, 'f', 1).arg(t));
        }
    }
    metrics["errorCount"] = static_cast<int>(errs.size());
    if (!errs.isEmpty()) {
        findings.append(finding("錯誤事件", "bad", QStringLiteral("日誌有 %1 筆錯誤／失效保護／墜機訊息").arg(errs.size()),
                                errs.mid(0, 12).join(QLatin1Char('\n')), "逐筆檢查原因；墜機或失效保護後需完整檢查機體再飛。"));
    } else {
        findings.append(finding("錯誤事件", "ok", "沒有錯誤或失效保護紀錄", "", "維持現狀。"));
    }

    // ---- 總結 ----
    int bad = 0, warn = 0;
    for (const QVariant &f : findings) {
        const QString lv = f.toMap().value("level").toString();
        if (lv == QLatin1String("bad")) {
            ++bad;
        } else if (lv == QLatin1String("warn")) {
            ++warn;
        }
    }
    QVariantMap report{
        {"ok", true},
        {"vehicle", r.detectedVehicleType},
        {"firmware", r.firmwareMajorVersion >= 0 ? QStringLiteral("%1.%2").arg(r.firmwareMajorVersion).arg(r.firmwareMinorVersion) : QString()},
        {"startTime", r.startTime.isValid() ? r.startTime.toLocalTime().toString(QStringLiteral("yyyy-MM-dd HH:mm:ss")) : QString()},
        {"findings", findings},
        {"metrics", metrics},
        {"logParams", params},
        {"modeSegments", r.modeSegments},
        {"badCount", bad},
        {"warnCount", warn},
        {"overall", bad > 0 ? QStringLiteral("bad") : (warn > 0 ? QStringLiteral("warn") : QStringLiteral("ok"))},
    };
    report["suggestions"] = buildSuggestions(metrics, params);
    return report;
}

QString csvPath()
{
    const QString dir = QDir(QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation)).filePath(QStringLiteral("FDE-QGC/Tuning"));
    QDir().mkpath(dir);
    return QDir(dir).filePath(QStringLiteral("param-backup.csv"));
}

} // namespace

FdeLogAnalyzer::FdeLogAnalyzer(QObject *parent) : QObject(parent) {}

QString FdeLogAnalyzer::tuningDirectory() const
{
    return QFileInfo(csvPath()).absolutePath();
}

void FdeLogAnalyzer::analyze(const QString &fileOrUrl)
{
    if (_busy) {
        return;
    }
    QString path = fileOrUrl;
    if (path.startsWith(QStringLiteral("file:"))) {
        path = QUrl(path).toLocalFile();
    }
    if (!path.endsWith(QStringLiteral(".bin"), Qt::CaseInsensitive) && !path.endsWith(QStringLiteral(".log"), Qt::CaseInsensitive)) {
        _setResult({{"ok", false}, {"error", QStringLiteral("目前支援 ArduPilot DataFlash 日誌（.bin／.log）。tlog 請用「飛行日誌」頁的官方工具。")}}, {});
        return;
    }
    _busy = true;
    emit busyChanged();
    QPointer<FdeLogAnalyzer> self(this);
    QThreadPool::globalInstance()->start([self, path]() {
        const LogParseResult r = DataFlashParser::parseFile(path);
        QVariantMap report;
        QHash<QString, QVector<QPointF>> keep;
        if (!r.ok) {
            report = {{"ok", false}, {"error", r.errorMessage.isEmpty() ? QStringLiteral("無法解析日誌") : r.errorMessage}};
        } else {
            report = analyzeResult(r, keep);
        }
        report["file"] = QDir::toNativeSeparators(path);
        report["fileName"] = QFileInfo(path).fileName();
        if (self) {
            QMetaObject::invokeMethod(self, [self, report, keep]() {
                if (self) {
                    self->_setResult(report, keep);
                }
            }, Qt::QueuedConnection);
        }
    });
}

void FdeLogAnalyzer::_setResult(const QVariantMap &report, const QHash<QString, QVector<QPointF>> &samples)
{
    _report = report;
    _samples = samples;
    if (_busy) {
        _busy = false;
        emit busyChanged();
    }
    emit reportChanged();
}

QVariantList FdeLogAnalyzer::series(const QString &fieldName, int maxPoints) const
{
    QVariantList out;
    const auto it = _samples.constFind(fieldName);
    if (it == _samples.constEnd() || it->isEmpty()) {
        return out;
    }
    const QVector<QPointF> &v = it.value();
    const int step = std::max(1, static_cast<int>(v.size() / std::max(10, maxPoints)));
    const double t0 = v.first().x();
    for (int i = 0; i < v.size(); i += step) {
        out.append(QVariantMap{{"x", v[i].x() - t0}, {"y", v[i].y()}});
    }
    return out;
}

QVariantList FdeLogAnalyzer::suggestionsFor(const QVariantMap &currentParams) const
{
    if (!_report.value("ok").toBool()) {
        // 沒有日誌時，只依參數給安全類建議
        return buildSuggestions({}, currentParams);
    }
    QVariantMap p = _report.value("logParams").toMap();
    for (auto it = currentParams.cbegin(); it != currentParams.cend(); ++it) {
        p.insert(it.key(), it.value());   // 以飛控目前值為準
    }
    return buildSuggestions(_report.value("metrics").toMap(), p);
}

QString FdeLogAnalyzer::backupParam(const QString &name, double oldValue, double newValue, const QString &reason) const
{
    const QString path = csvPath();
    QFile f(path);
    const bool isNew = !f.exists();
    if (!f.open(QIODevice::Append | QIODevice::Text)) {
        return QString();
    }
    QTextStream ts(&f);
    if (isNew) {
        ts << "time,param,old,new,restored,reason\n";
    }
    QString r = reason;
    r.replace(QLatin1Char(','), QStringLiteral("，")).replace(QLatin1Char('\n'), QLatin1Char(' '));
    ts << QDateTime::currentDateTime().toString(Qt::ISODate) << ',' << name << ',' << QString::number(oldValue, 'g', 10) << ','
       << QString::number(newValue, 'g', 10) << ",0," << r << '\n';
    return QDir::toNativeSeparators(path);
}

QVariantMap FdeLogAnalyzer::lastBackup() const
{
    QFile f(csvPath());
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        return {{"ok", false}};
    }
    const QStringList lines = QString::fromUtf8(f.readAll()).split(QLatin1Char('\n'), Qt::SkipEmptyParts);
    for (int i = lines.size() - 1; i >= 1; --i) {
        const QStringList c = lines[i].split(QLatin1Char(','));
        if (c.size() >= 5 && c[4] == QLatin1String("0")) {
            return {{"ok", true}, {"name", c[1]}, {"oldValue", c[2].toDouble()}, {"newValue", c[3].toDouble()}, {"time", c[0]}};
        }
    }
    return {{"ok", false}};
}

void FdeLogAnalyzer::markLastRestored() const
{
    QFile f(csvPath());
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        return;
    }
    QStringList lines = QString::fromUtf8(f.readAll()).split(QLatin1Char('\n'), Qt::SkipEmptyParts);
    f.close();
    for (int i = lines.size() - 1; i >= 1; --i) {
        QStringList c = lines[i].split(QLatin1Char(','));
        if (c.size() >= 5 && c[4] == QLatin1String("0")) {
            c[4] = QStringLiteral("1");
            lines[i] = c.join(QLatin1Char(','));
            break;
        }
    }
    if (f.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
        f.write((lines.join(QLatin1Char('\n')) + QLatin1Char('\n')).toUtf8());
    }
}
