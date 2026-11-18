// 組裝實訓室｜機型註冊表：每個機型的零件、接線、板卡、規則參數、報告、錯誤案例與接線版面都在這裡集中。
// 新增機型只要在這裡加一筆，頁面主程式（ui/app.js）不用改。
import { F450_MODEL, CATEGORIES } from './f450-pixhawk248.js';
import { F450_WIRING, EXTRA_POINTS as F450_POINTS, CONNECTOR_FITS as F450_FITS } from './f450-wiring.js';
import { PIXHAWK_248_GENERIC } from './boards/pixhawk-248-generic.js';
import { FPV5_MODEL } from './fpv5-225.js';
import { FPV5_WIRING, FPV5_EXTRA_POINTS, FPV5_FITS } from './fpv5-wiring.js';
import { BETAFLIGHT_F7_3030_GENERIC } from './boards/betaflight-f7-3030-generic.js';
import { buildParamsReport, reportToText } from '../core/params-report.js';
import { buildBetaflightReport, betaflightReportToText } from '../core/betaflight-report.js';
import { buildErrorCases } from '../core/error-cases.js';
import { buildFpv5ErrorCases } from '../core/fpv5-error-cases.js';

export { CATEGORIES };

export const MODELS = {
  'f450-pixhawk248': {
    model: F450_MODEL, wiring: F450_WIRING, board: PIXHAWK_248_GENERIC, points: F450_POINTS, fits: F450_FITS,
    layout: () => import('../ui/layouts/f450-layout.js').then((m) => m.makeF450Layout()),
    reportTitle: 'ArduPilot 參數模擬設定報告', reportFile: 'build-lab-ardupilot-模擬設定報告.txt',
    buildReport: buildParamsReport, reportToText,
    buildCases: () => buildErrorCases(F450_WIRING, PIXHAWK_248_GENERIC, F450_POINTS, F450_FITS),
  },
  'fpv5-225': {
    model: FPV5_MODEL, wiring: FPV5_WIRING, board: BETAFLIGHT_F7_3030_GENERIC, points: FPV5_EXTRA_POINTS, fits: FPV5_FITS,
    layout: () => import('../ui/layouts/fpv5-layout.js').then((m) => m.makeFpv5Layout()),
    reportTitle: 'Betaflight 設定檢查報告（模擬）', reportFile: 'build-lab-betaflight-設定檢查報告.txt',
    buildReport: buildBetaflightReport, reportToText: betaflightReportToText,
    buildCases: () => buildFpv5ErrorCases(FPV5_WIRING, BETAFLIGHT_F7_3030_GENERIC, FPV5_EXTRA_POINTS, FPV5_FITS),
  },
};

export const DEFAULT_MODEL = 'f450-pixhawk248';

/** 從網址參數 ?model= 選機型；不認識的值退回預設機型 */
export function pickModel(search) {
  const id = new URLSearchParams(search || '').get('model');
  return MODELS[id] ? id : DEFAULT_MODEL;
}
