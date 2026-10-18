# FDE-AI-UAS 2.0｜R4／R5／R8 最終修復實施計畫（待教師明確核准後才動工）

日期：2026-10-14 13:40
執行者：WorkBuddy
依據：教師《Git 版本保護與 R4/R5/R8 安全收尾》第二至五節
性質：**最終修改檔案清單、精確差異方案、測試與回滾；本輪不修改任何受保護程式**

---

## 一、最終修改檔案清單（共 5 個檔案，全部已有版本或將納管）

| # | 檔案 | 性質 | 修改內容 |
|---|---|---|---|
| 1 | `student_portal/learning/external_modules.py` | **受保護核心** | R4 埠號檢查、R5 背景刷新原語、R8 有界併發（詳見第二至四節逐函數差異） |
| 2 | `student_portal/config/settings.py` | 設定 | 新增 3 個环境变數（`FDE_EXTERNAL_MODULE_ALLOWED_PORTS`／`PROBE_ASYNC`／`PROBE_MAX_CONCURRENCY`） |
| 3 | `student_portal/learning/tests/test_external_module_interface.py` | 測試調適 | 3 個既有測試加掛埠號白名單 override（不放寬任何安全語意） |
| 4 | `student_portal/learning/tests/test_external_module_probe_resource.py` | **新增測試檔** | R4/R5/R8 全部新增測試（12 項） |
| 5 | `student_portal/.env.example` | 文件 | 補 3 個變數說明（範例檔，非機密） |

**不動**：前端、Migration、正式資料庫、任何其他模組、I5 已修復之安全邏輯（IP pinning／TLS／fail-closed／雙白名單僅「新增檢查」，不改寫既有檢查）。

---

## 二、R4｜埠號白名單（正式預設僅 80／443）

### 2.1 `settings.py` 新增（接在現有 `FDE_EXTERNAL_MODULE_PROBE_TTL_SECONDS` 之後）

```python
# R4（2026-10-14 教師核准）：外部模組入口／探測允許埠號（精確整數清單）。
# 正式預設僅 80／443；開發或 DEMO 的非標準埠必須以本變數明確允許，
# 不得改寫程式預設值。空字串＝使用預設 {80,443}。
FDE_EXTERNAL_MODULE_ALLOWED_PORTS = [
    int(p) for p in os.environ.get('FDE_EXTERNAL_MODULE_ALLOWED_PORTS', '').replace(' ', '').split(',')
    if p.strip().lstrip('-').isdigit()
] or [80, 443]
```

### 2.2 `external_modules.py` 差異（3 處）

**差異 1——新增常式（置於 `URL_REJECTED_NETWORK` 附近）**

```python
# R4：埠號白名單（預設僅 80／443；教師可以 settings／環境變數明確放行特定埠）。
URL_REJECTED_PORT = (
    "模組入口 URL 未通過安全檢查：埠號未列於 FDE_EXTERNAL_MODULE_ALLOWED_PORTS，"
    "已暫時停用此模組入口。"
)

def _allowed_ports():
    """回傳允許埠號集合；未設定或解析失敗一律回落 {80,443}（fail-closed 預設）。"""
    raw = getattr(settings, "FDE_EXTERNAL_MODULE_ALLOWED_PORTS", None)
    try:
        ports = {int(p) for p in (raw or [])}
    except (TypeError, ValueError):
        return {80, 443}
    return ports or {80, 443}
```

**差異 2——`_static_url_problem()` 末尾插入（在 `return "", DIAG_OK` 之前；此時已完成 scheme／帳密／主機／白名單／敏感參數／內網檢查）**

```python
    # 9. 埠號白名單（R4）：未指定埠視為 scheme 預設（80/443）；指定埠必須精確命中。
    explicit_port = parts.port  # 上方已驗證可解析（ValueError 已先行攔截）
    if explicit_port is not None and explicit_port not in _allowed_ports():
        return URL_REJECTED_PORT, DIAG_SECURITY_REJECTED
    return "", DIAG_OK
```

**差異 3——縱深防禦（`_probe_pinned()` 開頭，與 `_probe_timeout()` 之後並列）**

```python
    if port not in _allowed_ports():
        return False  # 縱深：即使上層被繞過，探測也不連非允許埠
```

### 2.3 DEMO／開發的非標準埠用法（依教師規定：獨立環境設定，不改預設）

DEMO 預設三個外部模組全停用，**正常情況不需要任何埠號放行**。若教師日後在 DEMO 接上內網模組：

```bash
# demo 環境變數範例（僅 DEMO／開發；正式環境保持預設 {80,443}）
FDE_EXTERNAL_MODULE_ALLOWED_PORTS=9000,8198
```

### 2.4 對既有測試的影響（3 支，調適方式）

| 測試 | 現斷言 | 調適 |
|---|---|---|
| `test_trusted_http_url_is_accepted`（:9000） | AVAILABLE | override 加 `FDE_EXTERNAL_MODULE_ALLOWED_PORTS=["9000"]` 維持 AVAILABLE；**新增**反向斷言：未設定時 rejected |
| `test_allowlisted_internal_host_is_accepted`（192.168.1.50:9000） | AVAILABLE | 同上加 override；私有主機白名單語意不變 |
| DNS rebind 測試（rebind.example.test:8198） | AVAILABLE＋只解析一次 DNS | override 加 `ALLOWED_PORTS=["8198"]`；IP 釘選與單次 DNS 斷言原樣保留 |

---

## 三、R5｜背景刷新與快取優先（請求路徑不阻塞）

### 3.1 `settings.py` 新增

```python
# R5：外部模組探測背景刷新開關（預設開）。設 false 退回同步探測（舊行為）。
FDE_EXTERNAL_MODULE_PROBE_ASYNC = (
    os.environ.get('FDE_EXTERNAL_MODULE_PROBE_ASYNC', 'true').strip().lower() == 'true'
)
```

### 3.2 `external_modules.py` 差異

**差異 1——`import threading`（現有 import 區：http.client/ipaddress/re/socket/ssl/time/urllib.parse）**

**差異 2——模組級原語（接在 `_PROBE_CACHE = {}` 之後）**

```python
# --- 背景刷新與有界併發原語（R5／R8）----------------------------------------
_PROBE_LOCKS = {}                 # entry_url -> Lock（單飛：同 URL 只允許一個真實探測）
_PROBE_LOCKS_GUARD = threading.Lock()
_PROBE_THREADS = set()            # 在飛背景執行緒（生命週期追蹤）
_PROBE_THREADS_GUARD = threading.Lock()
_PROBE_SEMAPHORE = None           # 有界信號量（延遲建立，相容 override_settings）
_PROBE_SEMAPHORE_SIZE = None


def _probe_async():
    return bool(getattr(settings, "FDE_EXTERNAL_MODULE_PROBE_ASYNC", True))


def _probe_max_concurrency():
    try:
        return max(1, int(getattr(settings, "FDE_EXTERNAL_MODULE_PROBE_MAX_CONCURRENCY", 2) or 2))
    except (TypeError, ValueError):
        return 2


def _probe_semaphore():
    global _PROBE_SEMAPHORE, _PROBE_SEMAPHORE_SIZE
    size = _probe_max_concurrency()
    if _PROBE_SEMAPHORE is None or _PROBE_SEMAPHORE_SIZE != size:
        _PROBE_SEMAPHORE = threading.BoundedSemaphore(size)
        _PROBE_SEMAPHORE_SIZE = size
    return _PROBE_SEMAPHORE


def _entry_lock(entry_url):
    with _PROBE_LOCKS_GUARD:
        lock = _PROBE_LOCKS.get(entry_url)
        if lock is None:
            lock = threading.Lock()
            _PROBE_LOCKS[entry_url] = lock
        return lock
```

**差異 3——單次真實探測（新函數 `_probe_once`；內容為原 `_evaluate_and_probe` 快取未命中段的等價搬移＋單飛＋信號量）**

```python
def _probe_once(entry_url):
    """執行一次真實探測並寫入快取。

    - 單飛：同一 entry_url 同時只一個執行緒進入（lock.acquire 逾時＝讓位）。
    - 有界：信號量限制程序內真實探測併發（R8）；取不到即放棄本輪。
    - fail-closed：任何失敗／例外 → 記 UNAVAILABLE，絕不記 AVAILABLE。
    """
    lock = _entry_lock(entry_url)
    if not lock.acquire(timeout=_probe_timeout() + 1.0):
        return
    try:
        semaphore = _probe_semaphore()
        if not semaphore.acquire(timeout=0.5):
            return
        try:
            evaluation = evaluate_entry_url(entry_url)
            if evaluation["problem"]:
                outcome = (False, evaluation["diagnosis"], "")
            else:
                available = _probe_pinned(evaluation["url"], evaluation["ip"])
                outcome = (
                    available,
                    DIAG_OK if available else DIAG_SERVICE_UNREACHABLE,
                    evaluation["url"] if available else "",
                )
        finally:
            semaphore.release()
        _PROBE_CACHE[entry_url] = (time.monotonic(),) + outcome
    finally:
        lock.release()
```

**差異 4——背景執行緒管理（有上限、不死等、不堆積）**

```python
def _spawn_probe_thread(entry_url):
    """啟動背景探測；在飛執行緒已達上限時直接放棄（fail-closed，不排隊）。"""
    with _PROBE_THREADS_GUARD:
        _PROBE_THREADS.difference_update(t for t in list(_PROBE_THREADS) if not t.is_alive())
        if len(_PROBE_THREADS) >= _probe_max_concurrency():
            return False
        thread = threading.Thread(
            target=_run_probe_guarded, args=(entry_url,),
            daemon=True, name="fde-module-probe",
        )
        _PROBE_THREADS.add(thread)
    thread.start()
    return True


def _run_probe_guarded(entry_url):
    try:
        _probe_once(entry_url)
    except Exception:
        pass  # daemon 執行緒例外不得外洩
```

**差異 5——`_evaluate_and_probe()` 快取未命中分支改寫（prober 捷徑與快取命中路徑完全不動）**

```python
    # （原有：ttl/now/cached 命中判斷保持不變）
    if cached is not None and (now - cached[0]) < ttl:
        return cached[1], cached[2], cached[3]

    if _probe_async():
        # R5：請求路徑不阻塞。背景單飛刷新；本請求立即 fail-closed。
        _spawn_probe_thread(entry_url)
        return False, DIAG_SERVICE_UNREACHABLE, ""

    # 同步退回路徑（PROBE_ASYNC=false；仍受單飛與有界信號量保護）。
    _probe_once(entry_url)
    cached = _PROBE_CACHE.get(entry_url)
    if cached is None:
        return False, DIAG_SERVICE_UNREACHABLE, ""
    return cached[1], cached[2], cached[3]
```

**差異 6——`clear_probe_cache()` 擴充＋測試輔助函數**

```python
def clear_probe_cache():
    """清空探測快取與單飛鎖（測試用）。在飛背景執行緒自然結束（daemon）。"""
    _PROBE_CACHE.clear()
    with _PROBE_LOCKS_GUARD:
        _PROBE_LOCKS.clear()


def _wait_for_probe_threads(timeout=5.0):
    """測試用：等待在飛背景探測執行緒結束；回傳是否全部結束。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _PROBE_THREADS_GUARD:
            alive = [t for t in _PROBE_THREADS if t.is_alive()]
        if not alive:
            return True
        time.sleep(0.05)
    return False
```

### 3.3 教師指定六大確認事項的分析

| 確認事項 | 設計答覆 |
|---|---|
| **多 worker 行為** | `_PROBE_CACHE`／信號量／鎖皆為**程序內**狀態：gunicorn 3 workers ＝ 3 份獨立快取。最壞同時真實探測數＝workers × MAX_CONCURRENCY（預設 3×2＝6），**每個 worker 內仍有界**；無共享狀態→無跨程序死鎖。快取分歧最多持續一個 TTL（預設 30s），各 worker 可能短暫顯示不同態——**語意上安全**（每worker 各自 fail-closed），UI 上可接受。DEMO（runserver／uvicorn 單程序）無此問題。 |
| **背景執行緒生命週期** | daemon 執行緒＋具名（fde-module-probe）＋註冊表追蹤；每次 spawn 前自動清除已死執行緒；**在飛數達 MAX_CONCURRENCY 即拒絕再 spawn**（不排隊、不堆積）。程序結束時 daemon 自動終止。 |
| **超時與資源釋放** | 分層逾時：單飛 lock acquire `probe_timeout+1s`；信號量 acquire `0.5s`；連線 `socket timeout=probe_timeout(1.5s)`；`_probe_pinned` 既有 `finally: connection.close()`；信號量與 lock 均在 `finally` 釋放。**已知限制（誠實記錄）**：`socket.getaddrinfo` 在 stdlib 無 timeout 參數，DNS 解析時長不可硬性上限；緩解＝執行緒總數有上限（≤MAX_CONCURRENCY）＋daemon 化，卡住的執行緒不影響請求路徑與其他模組。 |
| **快取過期與 fail-closed** | 過期未命中＝**立即可用不可用**（`False, SERVICE_UNREACHABLE, ""`）＋背景刷新；刷新成功寫入後自然恢復。**未經驗證永不記 AVAILABLE**（含例外路徑）。 |
| **服務重啟後狀態** | 快取純記憶體→重啟即空→每個模組首次請求 fail-closed 併發動背景刷新，一個探測週期（≤數秒）後恢復。無持久化＝無過期僵態資料。已寫入驗收 runbook 預期現象。 |
| **不會重複無上限探測** | 四重保護：①TTL 快取 ②per-URL 單飛鎖 ③全域在飛執行緒上限 ④有界信號量。靜態檢查拒絕（SECURITY_REJECTED）在背景執行緒內發生，同樣記快取，不會每請求重跑。 |

---

## 四、R8｜有界併發控制（預設最多 2 個真實探測）

### 4.1 `settings.py` 新增

```python
# R8：程序內真實探測最大併發數（預設 2，最小值 1）。
FDE_EXTERNAL_MODULE_PROBE_MAX_CONCURRENCY = max(
    1, int(os.environ.get('FDE_EXTERNAL_MODULE_PROBE_MAX_CONCURRENCY', '2') or 2)
)
```

### 4.2 機制（與 R5 共用原語，無額外程式）

`_probe_once()` 內的 `BoundedSemaphore(2)`：未取得信號量→放棄本輪（下個 TTL 週期再試）→**請求出路恒為 fail-closed，不拋錯、不排队等待**。高併發／探測失敗／DNS 卡住／資源釋放四類行為全部由第三節原語覆蓋，R8 不另加程式碼。

### 4.3 教師指定四類測試（納入新測試檔）

| 場景 | 測試設計 | 判準 |
|---|---|---|
| 高併發 | patch `_probe_pinned` 記錄在飛數並 sleep 0.2s；16 執行緒同時呼叫 `_probe_once`（不同 URL） | 峰值在飛 ≤ 2；全部回傳不拋錯 |
| 探測失敗 | patch `_probe_pinned` 拋例外／回 False | 回 UNAVAILABLE；信號量與鎖確實釋放（後續可再探） |
| DNS 卡住 | patch `socket.getaddrinfo` 阻塞於 Event；請求路徑呼叫 `_evaluate_and_probe` | 請求**立即**回 fail-closed（<0.5s）；在飛執行緒數 ≤2 不再增加；Event 設置＋`_wait_for_probe_threads()` 後快取正確寫入且執行緒數歸 0 |
| 資源釋放 | 上列三個測試後檢查 `_PROBE_THREADS` 無存活執行緒、信號量可再次 acquire | 無洩漏 |

---

## 五、新測試檔內容規劃（`test_external_module_probe_resource.py`，12 項）

| # | 測試 | 對應 |
|---|---|---|
| 1 | `test_non_standard_port_rejected_by_default`（:9000 未設定→SECURITY_REJECTED，prober 零呼叫） | R4 |
| 2 | `test_configured_port_accepted`（ALLOWED_PORTS=[9000]→AVAILABLE） | R4 |
| 3 | `test_implicit_ports_allowed`（無埠 http/https 放行） | R4 |
| 4 | `test_cold_cache_returns_immediately_fail_closed`（patch `_probe_pinned` sleep 3s；請求 <0.5s 回 UNAVAILABLE） | R5 |
| 5 | `test_background_refresh_populates_cache`（等背景執行緒後第二次 AVAILABLE） | R5 |
| 6 | `test_single_flight_per_entry`（10 執行緒同 URL→真實探測 1 次） | R5 |
| 7 | `test_async_disable_falls_back_to_sync`（PROBE_ASYNC=false→同步行為與舊版一致） | R5 |
| 8 | `test_concurrency_peak_bounded`（16 執行緒→峰值 ≤2） | R8 |
| 9 | `test_probe_failure_fails_closed_and_releases`（例外→UNAVAILABLE＋資源釋放） | R8 |
| 10 | `test_dns_stall_does_not_block_or_leak`（Event 阻塞 getaddrinfo→立即回覆／執行緒有上限／事後歸 0） | R5+R8 |
| 11 | `test_prober_shortcut_still_synchronous`（回歸保護：39/39 語意不變） | 回歸 |
| 12 | `test_restart_equivalent_cold_state`（`clear_probe_cache()` 後首調 fail-closed＋背景恢復） | R5 |

---

## 六、I5 安全回歸測試（核准後實作完成時必跑）

| # | 指令 | 預期 |
|---|---|---|
| 1 | `manage.py test learning.tests.test_external_module_interface` | 全過（含 3 支調適後測試） |
| 2 | `manage.py test learning`（隔離 DB，六批） | 843 pass／26 skip／**2 已知歷史失敗**＋新增 12 項全過 |
| 3 | `python demo/tools/verify_i5_security.py` | **39/39**（R1/R2/R3/R7/R9 無退步） |
| 4 | `python demo/tools/verify_i1_external_modules.py` | **46/46**（I1 教師確認基準） |
| 5 | `manage.py test live_backend`（Python 3.14） | 315/315 |
| 6 | 靜態核對 | `_probe_pinned` 仍以釘選 IP 建線、連線過程 0 次 DNS、`ssl.create_default_context()` 未改、不跟隨重導未改、`DIAG_*` 不含主機名 IP |
| 7 | I4 代理回歸（deny 35／allow 36） | 不退步 |

> 任一項失敗→停止發布修復，走第七節回滾。

---

## 七、失敗回滾方案

| 層級 | 做法 |
|---|---|
| 動工前 | 複製現行 3 個受改檔為 `.r458-prebak`（`external_modules.py`、`settings.py`、`test_external_module_interface.py`；**不進 Git**） |
| 程式回滾 | 以 `.r458-prebak` 還原 3 檔＋刪除新測試檔→重跑第六節 1–5 → 全綠才算收束 |
| 行為回滾（不改碼） | R5：`FDE_EXTERNAL_MODULE_PROBE_ASYNC=false` 退回同步；R8：`FDE_EXTERNAL_MODULE_PROBE_MAX_CONCURRENCY` 調大／縮小；R4：`FDE_EXTERNAL_MODULE_ALLOWED_PORTS` 放行特定埠。三項皆可單獨退場，不必整體回滾 |
| 版本回滾（若已 commit） | 該批次 commit 尚未發生；未來若已 commit，則 `git revert <修復commit>`（提交計畫見 `PRE_COMMIT_CHECK_AND_STAGING_PLAN_2026-10-14.md`） |
| 資料 | 不涉及 Migration 與資料庫；無資料回滾需求 |

---

## 八、待教師明確核准（一次核准制）

1. 修改範圍：5 個檔案（1 個受保護核心＋1 設定＋2 測試＋1 範例檔）。
2. R4 預設值：**正式僅 80／443**（教師已原則核准）；DEMO／開發以 `FDE_EXTERNAL_MODULE_ALLOWED_PORTS` 獨立放行。
3. R5／R8 預設值：`PROBE_ASYNC=true`、`MAX_CONCURRENCY=2`、TTL 維持 30s。
4. 3 支既有測試的 override 調適（不放寬安全語意，只補埠號設定與反向斷言）。
5. 動工順序建議：先實作＋新測試檔自測→跑第六節 1–5→全綠才回報；任何一步失敗即停在原狀並回報。

**狀態維持**：`FDE_2_0_DEV_COMPLETE`（開發面）／`MANUAL_ACCEPTANCE_PENDING`／`PRODUCTION_RELEASE_PENDING`。
**本輪未修改 `external_modules.py` 與任何受保護程式。**



