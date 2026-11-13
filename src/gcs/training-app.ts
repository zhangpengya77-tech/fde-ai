import './training.css';
import { createTrainingMission, validateTrainingMission } from './mission-plan';

export interface GroundStationTrainingApp {
  dispose(): void;
}

/**
 * P5 網頁地面站訓練入口。
 *
 * 航線在這裡只是本機教學計畫；沒有受控 Gateway session 時，不提供上傳、AUTO 或 RTL。
 * 因此不會將前端資料誤稱為已進入 SITL 的 MAVLink mission。
 */
export function createGroundStationTrainingApp(root: HTMLElement): GroundStationTrainingApp {
  const mission = createTrainingMission();
  const errors = validateTrainingMission(mission);
  root.className = 'gcs-root';
  root.innerHTML = `
    <main class="gcs-layout" aria-label="FDE-AI 地面站訓練">
      <header class="gcs-header">
        <a href="../" class="gcs-home">← 返回 FDE-AI 訓練</a>
        <div><h1>地面站訓練</h1><p>單機 SITL 航點規劃・非正式 QGC 替代品</p></div>
        <span class="gcs-status gcs-status-offline" data-gcs-connection>Gateway／SITL：未連線</span>
      </header>
      <section class="gcs-workspace">
        <section class="gcs-card gcs-plan">
          <h2>本機四航點訓練計畫</h2>
          <p class="gcs-note">此計畫尚未上傳至 ArduPilot SITL。高度與速度僅為教學設定，不是官方考照門檻。</p>
          <ol class="gcs-waypoints">
            ${mission.waypoints.map((waypoint) => `<li data-gcs-waypoint><b>WP${waypoint.sequence}</b><span>東 ${waypoint.eastM} m／北 ${waypoint.northM} m</span><span>${waypoint.altitudeM} m・${waypoint.speedMps} m/s</span></li>`).join('')}
          </ol>
          <p class="gcs-validation" data-gcs-validation>${errors.length ? errors.join('；') : '航點檢查完成；等待受控 Gateway session。'}</p>
          <div class="gcs-actions">
            <button type="button" data-gcs-upload disabled>上傳至 SITL</button>
            <button type="button" data-gcs-auto disabled>執行 AUTO</button>
            <button type="button" data-gcs-rtl disabled>RTL 返航</button>
          </div>
        </section>
        <section class="gcs-card gcs-map" aria-label="局部航點視圖">
          <h2>局部航點視圖</h2>
          <svg viewBox="-4 -4 20 20" role="img" aria-label="四航點局部航線圖">
            <path d="M0 0 L0 12 L12 12 L12 0 L0 0" class="gcs-route" />
            ${mission.waypoints.map((waypoint) => `<g><circle cx="${waypoint.eastM}" cy="${12 - waypoint.northM}" r="0.9" class="gcs-waypoint-dot"/><text x="${waypoint.eastM}" y="${11.7 - waypoint.northM}" text-anchor="middle">${waypoint.sequence}</text></g>`).join('')}
            <circle cx="0" cy="12" r="0.5" class="gcs-home-dot"/><text x="0.8" y="12.4">HOME</text>
          </svg>
          <p class="gcs-map-caption">北 ↑・單位：m；瀏覽器顯示不取代 QGC 地圖。</p>
        </section>
        <section class="gcs-card gcs-telemetry">
          <h2>遙測與任務狀態</h2>
          <dl>
            <dt>權威來源</dt><dd data-gcs-source>未連線（不顯示模擬數值）</dd>
            <dt>飛行模式</dt><dd>—</dd><dt>高度</dt><dd>—</dd><dt>速度</dt><dd>—</dd>
            <dt>電池</dt><dd>—</dd><dt>任務進度</dt><dd>0 / 4</dd><dt>日誌</dt><dd>等待 session</dd>
          </dl>
          <p class="gcs-warning">安全：僅受控 localhost Gateway + SITL 可啟用上傳／AUTO／RTL；絕不連接真實飛控。</p>
        </section>
      </section>
    </main>`;
  return { dispose: () => { root.innerHTML = ''; root.className = ''; } };
}
