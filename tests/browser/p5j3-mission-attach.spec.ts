import { expect, test } from '@playwright/test';

/**
 * P5-J3：Mission Runner 擁有唯一可寫入的 Gateway 連線。Chrome 透過受控測試注入，
 * 取得一次性、短效的唯讀 ticket。
 * 本測試規格絕不送出任何飛行指令。
 */
declare const process: {
  env: Record<string, string | undefined>;
  getBuiltinModule?: (name: string) => {
  writeFileSync: (path: string, data: string, options: { encoding: string }) => void;
  renameSync: (from: string, to: string) => void;
};
};

const attachJson = process.env.REA_PRO_ATTACH_JSON;
const lifecycleProbe = process.env.REA_PRO_TEST_LIFECYCLE === '1';
const lifecycleOnly = process.env.P5J3_LIFECYCLE_ONLY === '1';
const lifecycleSignal = process.env.P5J3_LIFECYCLE_SIGNAL;
const lifecycleFs = lifecycleSignal ? process.getBuiltinModule?.('fs') : undefined;
// 飛行中續發唯讀 ticket：Runner 寫入此檔，測試轉交頁面（ticket 本身不寫入日誌）
const renewFile = process.env.P5J3_RENEW_FILE;
const enabled = process.env.REA_PRO === '1' && process.env.REA_PRO_GAZEBO === '1' && !!attachJson;

test.describe('P5-J3 同 Session Mission 唯讀 3D', () => {
  test.skip(!enabled, '需要受控 G5 Mission Runner 注入短效唯讀 ticket');
  // 實測隔離 G5 的 AUTO + RTL 可能超過原本 60 秒的降落觀察窗；
  // 這是測試編排的時間上限，不是飛行安全門檻。
  test.setTimeout(360_000);

  test('Chrome 不建立第二個 Session，且由同一 Mission telemetry 驅動 Three.js', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', '隔離 SITL 只允許桌機單一 Chrome 訂閱者');
    const attach = JSON.parse(attachJson!);
    const sessionWrites: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/sessions') && ['POST', 'DELETE'].includes(request.method())) {
        sessionWrites.push(`${request.method()} ${request.url()}`);
      }
    });
    await page.addInitScript((readAttach) => {
      Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, writable: true, value: () => [] });
      localStorage.setItem('fde-rea-exam-prefs-v1', JSON.stringify({
        engine: 'physics_pro', proBase: 'http://127.0.0.1:8200', proToken: '', mode: 'position',
        subjectId: 'hover-small', airframeId: 'quad-800g',
      }));
      sessionStorage.setItem('fde-rea-attach-v1', JSON.stringify(readAttach));
    }, attach);
    await page.goto('/?mode=exam&exam=0');
    await page.locator('[data-rea-start]').click();
    await page.evaluate(() => {
      const key = '__p5j3ReadOnlyHistory';
      const w = window as unknown as Window & { [key: string]: unknown };
      const samples: unknown[] = [];
      w[key] = samples;
      window.setInterval(() => {
        const d = document.querySelector<HTMLElement>('[data-rea-canvas]')?.dataset;
        if (!d?.reaAuthoritySample || d.reaAuthoritySample !== d.reaRenderSample) return;
        samples.push({ sampleId: d.reaAuthoritySample, renderFrame: d.reaRenderFrame,
          sourceAt: d.reaAuthoritySourceAt, receivedAt: d.reaAuthorityReceivedAt,
          enu: d.reaAuthorityPositionEnu, attitude: d.reaAuthorityAttitudeDeg,
          quaternion: d.reaDroneQuaternion, mode: d.reaAuthorityMode, armed: d.reaAuthorityArmed,
          mission: d.reaAuthorityMission, link: d.reaAuthorityLink });
        if (samples.length > 2048) samples.splice(0, samples.length - 2048);
      }, 50);
    });
    await expect(page.locator('[data-rea-engine]')).toContainText('PHYSICS PRO');
    // 診斷：每 15 秒輸出一次畫面資料集，卡住時可從 Runner 的 playwright.stdout.log 看出停在哪一步
    const diagFs = process.getBuiltinModule?.('fs') as unknown as { appendFileSync: (p: string, d: string, o: { encoding: string }) => void } | undefined;
    const diagFile = process.env.P5J3_DIAG_FILE ?? `D:/FDE-CC-Takeover/runs/p5j3-diag-${lifecycleOnly ? 'lifecycle' : 'flight'}-${Date.now()}.log`;
    // 同時輸出到 stdout 與 D 槽檔案
    const diag = (line: string) => { console.log(line); try { diagFs?.appendFileSync(diagFile, `${line}\n`,{ encoding: 'utf8' }); } catch { /* 寫檔失敗不影響測試 */ } };
    const stageLog = (name: string) => diag(`[P5J3 階段] ${new Date().toISOString()} ${name}`);
    const dumpTimer = setInterval(() => {
      void page.evaluate(() => {
        const c = document.querySelector<HTMLElement>('[data-rea-canvas]')?.dataset ?? {};
        const r = document.querySelector<HTMLElement>('.rea-root')?.dataset ?? {};
        const h = document.querySelector<HTMLElement>('[data-rea-hud]')?.dataset ?? {};
        return JSON.stringify({ phase: r.reaPhase, train: r.reaTrainingStatus, ev: r.reaTrainingEvidence, n: r.reaTrainingSamples,
          alt: h.alt, link: c.reaAuthorityLink, armed: c.reaAuthorityArmed, mode: c.reaAuthorityMode, mission: c.reaAuthorityMission,
          aSample: c.reaAuthoritySample, rSample: c.reaRenderSample });
      }).then((x) => diag(`[P5J3 資料集] ${new Date().toISOString()} ${x}`))
.catch((e) => diag(`[P5J3 資料集] 讀取失敗 ${e}`));
    }, 15_000);
    page.on('console', (m) => { if (m.type() === 'error') diag(`[P5J3 瀏覽器錯誤] ${m.text()}`); });
    page.on('pageerror', (e) => diag(`[P5J3 頁面例外] ${e.message}`));
    test.info().annotations.push({ type: 'diag', description: 'stage-log' });
    stageLog('引擎就緒');
    let renewDelivered = 0;
    let renewSeq = 0;
    const renewFs = renewFile && !lifecycleOnly ? process.getBuiltinModule?.('fs') as unknown as { readFileSync: (p: string, e: string) => string } | undefined : undefined;
    const renewTimer = renewFs ? setInterval(() => {
      let next: { seq?: number } | undefined;
      try { next = JSON.parse(renewFs.readFileSync(renewFile!, 'utf8')) as { seq?: number }; } catch { return; } // 尚未產生或寫入中
      if (!next?.seq || next.seq <= renewSeq) return;
      renewSeq = next.seq;
      void page.evaluate((detail) => window.dispatchEvent(new CustomEvent('fde-rea-attach-renew', { detail })), next)
        .then(() => { renewDelivered += 1; diag(`[P5J3 續發] ${new Date().toISOString()} 第 ${renewSeq} 張已轉交頁面`); })
        .catch((e) => diag(`[P5J3 續發] 轉交失敗 ${e}`));
    }, 1_000) : undefined;
    if (lifecycleOnly) {
      // 這個全新的短效觀察端只用於飛行後的生命週期探測；
      // 不接收任何控制，也絕不重用飛行觀察端的 ticket 或 sessionStorage attach。
      await expect.poll(async () => page.locator('[data-rea-canvas]').getAttribute('data-rea-authority-link'), {
        timeout: 45_000, intervals: [250, 500],
      }).toBe('stale');
      if (lifecycleSignal && lifecycleFs) {
        const pending = `${lifecycleSignal}.tmp`;
        lifecycleFs.writeFileSync(pending, 'stale', { encoding: 'utf8' });
        lifecycleFs.renameSync(pending, lifecycleSignal);
      }
      await expect.poll(async () => page.locator('[data-rea-canvas]').getAttribute('data-rea-authority-link'), {
        timeout: 45_000, intervals: [250, 500],
      }).toBe('disconnected');
      // 教師唯讀檢視：斷線後顯示結果畫面，可下載 JSON；證據鏈因遙測過期必須是 INVALID，且無寫入授權
      await expect(page.locator('[data-rea-teacher-view]')).toBeAttached({ timeout: 15_000 });
      // 證據 INVALID 時不得顯示任何練習等級
      await expect(page.locator('[data-rea-ungraded]')).toHaveText('未評等');
      await page.locator('[data-rea-teacher-view] summary').click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-rea-export-json]').click()]);
      const readFs = process.getBuiltinModule?.('fs') as unknown as { readFileSync: (p: string, e: string) => string } | undefined;
      const exported = JSON.parse(readFs!.readFileSync((await download.path())!, 'utf8')) as {
        summary: { status: string }; teacherReview: { writeAuthorization: string; teacherDecision: unknown };
      };
      expect(exported.summary.status).toBe('INVALID');
      expect(exported.teacherReview).toMatchObject({ writeAuthorization: 'NONE', teacherDecision: null });
      await download.saveAs(info.outputPath('training-export.json'));
      expect(sessionWrites).toEqual([]);
      await page.screenshot({ path: info.outputPath('p5j3-mission-lifecycle.png') });
      return;
    }
    // expect.poll 在 Playwright 測試（Node）環境執行；
    // 透過 Page 讀取 HUD，確保斷言觀察的是真實 Chrome 文件。
    await expect.poll(async () => Number(await page.locator('[data-rea-hud]').getAttribute('data-alt') ?? 0), {
      timeout: 180_000, intervals: [500, 1000],
    }).toBeGreaterThan(1);
    stageLog('高度 > 1 m');
    const [hudHeight, droneHeight] = await page.evaluate(() => [
      Number(document.querySelector<HTMLElement>('[data-rea-hud]')?.dataset.alt ?? 0),
      Number(document.querySelector<HTMLElement>('[data-rea-canvas]')?.dataset.reaDroneHeight ?? 0),
    ]);
    expect(Math.abs(hudHeight - droneHeight)).toBeLessThan(0.05);
    const aligned = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('[data-rea-canvas]')!.dataset;
      return { authoritySample: d.reaAuthoritySample, renderSample: d.reaRenderSample,
        enu: JSON.parse(d.reaAuthorityPositionEnu ?? '[]'), rendered: JSON.parse(d.reaDronePosition ?? '[]'),
        attitude: JSON.parse(d.reaAuthorityAttitudeDeg ?? '{}'), quaternion: JSON.parse(d.reaDroneQuaternion ?? '[]'),
        mode: d.reaAuthorityMode, armed: d.reaAuthorityArmed, mission: JSON.parse(d.reaAuthorityMission ?? '{}') };
    });
    expect(aligned.authoritySample).toBe(aligned.renderSample);
    expect(aligned.rendered[0]).toBeCloseTo(aligned.enu[0], 3);
    expect(aligned.rendered[2]).toBeCloseTo(-aligned.enu[1], 3);
    await expect.poll(async () => page.evaluate(() => JSON.parse(document.querySelector<HTMLElement>('[data-rea-canvas]')?.dataset.reaAuthorityMission ?? '{}').last_reached_seq ?? 0), {
      timeout: 180_000, intervals: [500, 1000],
    }).toBeGreaterThanOrEqual(5);
    stageLog('任務航點 ≥ 5');
    await expect.poll(async () => page.locator('[data-rea-canvas]').getAttribute('data-rea-authority-armed'), {
      timeout: 180_000, intervals: [500, 1000],
    }).toBe('false');
    stageLog('已上鎖（armed=false）');
    const history = await page.evaluate(() => (window as Window & { __p5j3ReadOnlyHistory?: unknown[] }).__p5j3ReadOnlyHistory ?? []);
    const parsed = history.map((raw) => raw as { sampleId: string; renderFrame: string; sourceAt: string; attitude: string; quaternion: string; mode: string; mission: string });
    // AUTO 期間 MISSION_CURRENT 應單調遞增；RTL 會合法改變任務執行狀態，
    // 因此在下方另外驗證。
    const seq = parsed.filter((s) => s.mode === 'AUTO')
      .map((s) => Number(JSON.parse(s.mission || '{}').current_seq ?? -1)).filter((v) => v >= 0);
    expect(new Set(seq).size).toBeGreaterThanOrEqual(3);
    expect(seq.every((value, index) => index === 0 || value >= seq[index - 1])).toBeTruthy();
    expect(parsed.some((s) => s.mode === 'RTL')).toBeTruthy();
    const degrees = Math.PI / 180;
    const mul = (a: number[], b: number[]) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    const errors = parsed.map((s) => {
      const a = JSON.parse(s.attitude) as { roll: number; pitch: number; yaw: number };
      const half = (angle: number) => angle * degrees / 2;
      const expected = mul(mul([0, Math.sin(half(-a.yaw)), 0, Math.cos(half(-a.yaw))], [Math.sin(half(-a.pitch)), 0, 0, Math.cos(half(-a.pitch))]), [0, 0, Math.sin(half(-a.roll)), Math.cos(half(-a.roll))]);
      const actual = JSON.parse(s.quaternion) as number[];
      const dot = Math.min(1, Math.abs(expected.reduce((sum, value, i) => sum + value * actual[i], 0)));
      return 2 * Math.acos(dot) / degrees;
    });
    expect(errors.length).toBeGreaterThan(10);
    expect(Math.max(...errors)).toBeLessThan(0.1);
    // 訓練證據鏈（Claude 接管補齊）：唯讀遙測 → 轉接器 → 證據 → 狀態機，飛行期間持續累積且未被判 INVALID
    const training = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('.rea-root')!.dataset;
      return { evidence: d.reaTrainingEvidence, status: d.reaTrainingStatus, samples: Number(d.reaTrainingSamples ?? 0) };
    });
    expect(training.evidence).toBe('accepted');
    expect(training.status).toBe('RUNNING');
    expect(training.samples).toBeGreaterThan(10);
    if (lifecycleProbe) {
      await expect.poll(async () => page.locator('[data-rea-canvas]').getAttribute('data-rea-authority-link'), { timeout: 45_000, intervals: [250, 500] }).toBe('stale');
      // 來源停止 → 遙測過期 → 訓練任務必須 INVALID（不得用過期資料評分）
      await expect.poll(async () => page.evaluate(() => document.querySelector<HTMLElement>('.rea-root')?.dataset.reaTrainingStatus), { timeout: 10_000 }).toBe('INVALID');
      if (lifecycleSignal && lifecycleFs) {
        const pending = `${lifecycleSignal}.tmp`;
        lifecycleFs.writeFileSync(pending, 'stale', { encoding: 'utf8' });
        lifecycleFs.renameSync(pending, lifecycleSignal);
      }
      await expect.poll(async () => page.locator('[data-rea-canvas]').getAttribute('data-rea-authority-link'), { timeout: 45_000, intervals: [250, 500] }).toBe('disconnected');
    }
    clearInterval(dumpTimer);
    if (renewTimer) clearInterval(renewTimer);
    // 續發：頁面收到的每一張都必須被接受（身分相符、效期更晚），不得有拒絕
    const renewState = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('.rea-root')!.dataset;
      return { ok: Number(d.reaReadRenewals ?? 0), rejected: Number(d.reaReadRenewRejected ?? 0) };
    });
    diag(`[P5J3 續發] 轉交 ${renewDelivered} 張、頁面接受 ${renewState.ok}、拒絕 ${renewState.rejected}`);
    expect(renewState.rejected).toBe(0);
    expect(renewState.ok).toBe(renewDelivered);
    stageLog('全部斷言通過');
    expect(sessionWrites).toEqual([]);
    await page.screenshot({ path: info.outputPath('p5j3-mission-attach.png') });
  });
});
