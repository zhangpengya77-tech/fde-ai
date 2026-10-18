# FDE-AI-UAS 2.0｜R4／R5／R8 外部模組探測最小修改設計（待教師核准）

日期：2026-10-14 12:55
執行者：WorkBuddy
依據：教師《開發完成後安全收尾指令》第二節
性質：**差異設計與影響評估；本輪不修改 `external_modules.py`／`settings.py`，等待教師核准**

---

## 零、設計前提（不可動搖的安全基線）

以下 I5 已修復項目**全部保留**，任何修改不得削弱：
1. **IP pinning**：`evaluate_entry_url()` 回傳單一已驗證 IP → `_probe_pinned(url, ip)`，連線過程 **0 次 DNS**（`_PinnedHTTPConnection` 未釘選即 `raise OSError`）。
2. **TLS 驗證**：`ssl.create_default_context()` + 原主機名 SNI（`_PinnedHTTPSConnection`），禁止關閉。
3. **雙層檢查與 fail-closed**：`_static_url_problem()`（免 DNS）＋解析後 IP 驗證；DNS 失敗＝`DNS_FAILED` 不探測。
4. **雙白名單語意**：`ALLOWED_HOSTS`（主機名信任，非空時強制）＋`ALLOW_PRIVATE_HOSTS`（精確、無通配）。
5. **四態與診斷碼**：未配置／權限不足（零探測）／暫時不可用／可使用；`DIAG_*` 不洩漏主機名 IP。
6. **測試捷徑優先**：`FDE_EXTERNAL_MODULE_PROBER` 注入時完全免 DNS／連線。

修改檔案（預估）：`student_portal/learning/external_modules.py`、`student_portal/config/settings.py`、`student_portal/learning/tests/test_external_module_interface.py`（測試調適）。**共 3 個檔案，無 Migration、無前端改動。**

---

## R4｜限制外部模組探測／入口埠號

### 現狀（已實證）
`_static_url_problem()` 檢查 scheme／帳密／敏感參數／reserved hostname／數字主機名／白名單／字面 IP，**完全不檢查埠號**；`_probe_pinned()` 接受 URL 中任意埠（預設僅在未指定時取 80/443）。→ 已過白名單的入口可被指向任意高位埠（擴大探測面與 SSRF 縱深）。

### 最小設計
新增設定（`settings.py`）：
```python
# R4：外部模組入口／探測允許的埠號（精確整數；空 = 僅允許 80/443）
FDE_EXTERNAL_MODULE_ALLOWED_PORTS = [
    int(p) for p in os.environ.get('FDE_EXTERNAL_MODULE_ALLOWED_PORTS', '').replace(' ', '').split(',')
    if p.strip().isdigit()
] or [80, 443]
```
在 `external_modules.py`：
1. `_allowed_ports()`：延遲讀取 settings（相容 `override_settings`），回傳 `set[int]`。
2. `_static_url_problem()` 內新增第 9 項檢查（**置於白名單檢查之後、任何 DNS 之前**）：
   - `parts.port is None` → 放行（隱含 80/443，與現行語意一致）。
   - `parts.port in _allowed_ports()` → 放行。
   - 否則 → `URL_REJECTED_PORT`（新增訊息，沿用現行文案風格：「…埠號未列於 FDE_EXTERNAL_MODULE_ALLOWED_PORTS，已暫時停用此模組入口。」），診斷碼 `DIAG_SECURITY_REJECTED`，**不探測**。
3. `_probe_pinned()` 不動（其 port 來自已通過靜態檢查的 URL；另加一道同名 allowlist 斷言，depth-in-defense，成本一行）。

### 影響範圍（已逐條比對現有測試）
| 現有測試 | 是否受影響 | 處遇 |
|---|---|
| `test_trusted_http_url_is_accepted`（:9000 期望 AVAILABLE） | ⚠️ 會失敗 | 該斷言本身示範「任意埠可用」= R4 要修的風險 → 更新為：未允許時 `SERVICE_UNAVAILABLE`+`url_rejected`；`ALLOWED_PORTS=[9000]` 時 AVAILABLE（保留原屬性並新增反向斷言） |
| `test_allowlisted_internal_host_is_accepted`（192.168.1.50:9000） | ⚠️ 會失敗 | 同上處遇：加 `FDE_EXTERNAL_MODULE_ALLOWED_PORTS=["9000"]` 後維持 AVAILABLE 斷言；另立新測試證明未列埠號即拒 |
| DNS rebind 測試（rebind.example.test:8198） | ⚠️ 會失敗（靜態檢查先於 mock 的 `_probe_pinned`） | override 加 `ALLOWED_PORTS=["8198"]`，其餘斷言（只解析一次 DNS、IP 釘選）不變 |
| `_probe_pinned` 直測（:8080） | ✅ 不受影響（不經靜態檢查） | 不動 |
| `test_internal_and_reserved_addresses_are_rejected_by_default` 等拒絕類 | ✅ 仍拒絕（理由增加一項） | 不動 |
| `demo/tools/verify_i1_external_modules.py`（46/46） | ✅ 不受影響（入口 URL 走 8112 服務主機，非外部模組 URL；且 prober 捷徑 prior 於靜態檢查前仍會跑靜態檢查——已核對該腳本未使用帶埠外部模組 URL） | 不動 |

> **議和選項（供教師選擇）**：
> A（建議，預設從嚴）：預設僅 80/443，如上述調適 3 個測試。
> B（零測試變動）：預設空＝「不限制」，僅當教師設定 `FDE_EXTERNAL_MODULE_ALLOWED_PORTS` 才強制。
> 兩者都不動 I5 任何安全語意；A 符合專案一貫的 fail-closed 預設價值。

### 新增測試
- `test_non_standard_port_is_rejected_by_default`（:9000 未設定 → rejected，且 prober 零呼叫）。
- `test_configured_port_is_accepted`（ALLOWED_PORTS=[9000] → AVAILABLE）。
- `test_implicit_ports_are_allowed`（無埠 http/https 放行）。

---

## R5｜避免同步探測阻塞 Django 請求處理

### 現狀（已實證）
`get_external_module()` → `_resolve_module_state()` → `_evaluate_and_probe()` 在**請求執行緒內**做 DNS（`socket.getaddrinfo` 無 timeout）＋連線（1.5s）＋30s TTL 快取。首次／快取过期時，學員頁渲染最壞可阻塞數十秒（Django 同步 worker 被佔滿 → 全站排队）。

### 最小設計（背景單飛刷新＋快取優先）
1. `settings.py` 新增 `FDE_EXTERNAL_MODULE_PROBE_ASYNC`（預設 `true`）。
2. `_evaluate_and_probe()` 改為：
   - **捷徑與快取命中路徑完全不變**（prober 注入仍同步回傳 → 全部現有測試語意不變）。
   - 未命中快取時：啟動**背景單飛**（`threading.Thread(daemon=True)`，每 entry_url 一把 `_PROBE_LOCKS`，全域 `_PROBE_GUARD` 保護 lock dict）；**本請求立即回傳「暫時不可用」**（`available=False, DIAG_SERVICE_UNREACHABLE, ""`）——**fail-closed 保持：未經驗證不得 AVAILABLE**。
   - 背景執行完後寫入 `_PROBE_CACHE`（沿用現有 TTL 結構），後續請求正常命中。
3. `clear_probe_cache()` 一併清 locks 與 inflight 集合（測試隔離不受背景執行緒污染）；提供 `_wait_for_probe_threads()` 測試用 helper。
4. 教師診斷場景：維持同步語義的方式是注入 prober（現行測試作法）或新增 `?probe=1` 僅教師診斷視圖使用——**本設計採前者，不新增端點**。

### 影響範圍
| 項目 | 影響 |
|---|---|
| 現有 39/39 I5 安全測試 | ✅ **全部不受影響**（皆注入 prober，走捷徑） |
| `verify_i1_external_modules.py` 46/46 | ✅ 不受影響（同用 prober） |
| 產品行為（預設配置） | 無感知：預設全 DISABLED，根本不進探測分支 |
| 產品行為（啟用模組後首屏） | 首次載入可能顯示「暫時不可用」約 1–2 秒，重新整理後恢復——在 SOP 與文件中註記（可接受降級，非缺陷） |
| 併發 | daemon thread 生命週期短（≤ timeout＋解析）；Django runserver/gunicorn 皆相容 |

### 新增測試
- `test_cold_cache_does_not_block_and_fails_closed`（未命中快取 → 立即 UNAVAILABLE，且不拋錯）。
- `test_background_refresh_populates_cache`（等背景執行緒後第二次呼叫 AVAILABLE）。
- `test_single_flight_per_entry`（併發兩請求 → 探測僅一次）。
- `test_prober_shortcut_still_synchronous`（回歸保護）。

---

## R8｜探測併發限制與資源保護

### 現狀（已實證）
**無**併發上限、**無**單飛、**無**全域探測預算：快取過期的瞬間，N 個併發請求可觸發 N 次 DNS＋N 條連線（與 R5 疊加後果最嚴重）。

### 最小設計（與 R5 同一組執行緒原語）
1. `settings.py` 新增 `FDE_EXTERNAL_MODULE_PROBE_MAX_CONCURRENCY`（預設 `2`）。
2. 模組級 `threading.BoundedSemaphore(max)`：**只包住真實探測段**（`evaluate_entry_url`＋`_probe_pinned`），**不包** prober 捷徑（測試語意不變）。
3. 單飛：`_PROBE_LOCKS[entry_url]`（R5 已引入，此處共用）——快取未命中且已有執行中探測 → 直接回退「暫時不可用」，**不排队等待**。
4. 語意保護：`semaphore.acquire(timeout=剩餘預算)` 失敗或任何例外 → `return False`（吞異常路徑與現行 `_probe_pinned` 一致），**不得拋出、不得升級為 AVAILABLE**。
5. 已知限制（誠實記錄）：`socket.getaddrinfo` 在 stdlib 無 timeout 參數，DNS 解析時間**仍不可硬性上限**；R8 限制的是「併發探測數量」而非「單次 DNS 時長」。若日後需硬上限，須改用非同步 resolver 或執行緒池＋`future.result(timeout)`（列為後續可選項，本輪不做）。

### 影響範圍
| 項目 | 影響 |
|---|---|
| I5 39/39、I1 46/46 | ✅ 不受影響（prober 捷徑不進 semaphore） |
| 預設配置 | 無感知（全停用不探測） |
| 啟用後 | 最多 2 個併發探測，其餘立即 fail-closed 降级；上限可調 |
| 新增測試 | 見下 |

### 新增測試
- `test_probe_concurrency_is_bounded`（monkeypatch 探測記錄在飛數，16 執行緒併發 → 峰值 ≤ 2）。
- `test_no_duplicate_concurrent_probe`（同 entry 併發 → 真實探測 1 次）。
- `test_semaphore_failure_fails_closed`（注入 acquire 失敗 → UNAVAILABLE 不拋錯）。

---

## 三項合計的回歸必跑清單（核准後執行）

| # | 指令 | 預期 |
|---|---|---|
| 1 | `manage.py test learning`（隔離 DB，六批） | 與現基準一致（843 pass／26 skip／**2 已知歷史失敗**）＋新增測試全過 |
| 2 | `demo/tools/verify_i5_security.py` | 39/39 |
| 3 | `demo/tools/verify_i1_external_modules.py`（:8112 隔離） | 46/46 |
| 4 | 靜態對照 | `evaluate_entry_url`→`_probe_pinned` path 無第二次 DNS；TLS context 未變；`follow_redirects` 行為未變 |
| 5 | I4 代理回歸（deny 35／allow 36） | 不退步 |

## 回滾方式（核准後實施時）

1. 動工前複製現行三個檔案為 `.r458-prebak`（不進 Git）。
2. 變更僅限三檔；若任一回歸失敗 → 以 `.r458-prebak` 還原 → 重跑上表 1–5 → 全綠才算修復完成。
3. 設立開關：R5（`PROBE_ASYNC`）、R8（`MAX_CONCURRENCY`）皆可由環境變數單獨關閉／調參；R4 白名單預設從嚴（選項 A）可改環境變數放行特定埠。**任何一項出問題都可單獨退到現行行為，不必整體回滾。**

---

## 待教師核准事項（三項）

1. **範圍**：R4＋R5＋R8 一次做，或分批（建議 R5＋R8 同批、R4 獨立批，因 R4 涉測試斷言語意）。
2. **R4 預設值**：選項 A（預設僅 80/443，調適 3 個既有測試）或選項 B（預設不限制，設定才強制）。
3. **測試調適授權**：上述 3 個既有測試的斷言調整（`test_trusted_http_url_is_accepted`、`test_allowlisted_internal_host_is_accepted`、DNS rebind 測試）是否許可——調整方向為「補上埠號設定後維持原安全屬性」，不放寬任何安全語意。

**本輪未修改任何受保護核心；`external_modules.py` 與 `settings.py` 位元組級未動。**
**狀態維持**：`FDE_2_0_DEV_COMPLETE`（開發面）／`MANUAL_ACCEPTANCE_PENDING`／`PRODUCTION_RELEASE_PENDING`。
