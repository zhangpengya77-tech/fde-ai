"""外部模組接口層（I1 建立；I2-B 擴充為四狀態；I5-B 安全強化）。

統一預留「由教師在其他專案獨立開發」的模組入口與配置，避免為了整合入口而修改
受保護模組（MP12 內部、HQGC、F450 3D 獨立專案、Flight Health AI）的內部程式。

首批預留（教師總指令第六節）：
  - F450_DIGITAL_TWIN  （F450 3D 數位孿生，教師其他專案獨立開發）
  - MP_GROUND_STATION  （MP 地面站與考核，教師獨立開發）
  - HQGC_ASSESSMENT    （HQGC 考核，獨立專案）

I2-B 統一模組狀態（四態，皆有真實依據，不得互相冒充）：
  - AVAILABLE           已可使用     ：enabled 且 entry_url 非空，且健康探測通過
  - NOT_INTEGRATED      尚未接入     ：未啟用或未設定入口 URL（預設）
  - SERVICE_UNAVAILABLE 服務暫時不可用：已設定但不可用（DNS 失敗／安全拒絕／服務不可達）
  - ROLE_RESTRICTED     權限不足     ：已設定但當前角色不在 allowed_roles 內

設計約束：
  1. 不新增資料庫表；配置優先來自 Django settings.FDE_EXTERNAL_MODULES，未設定預設 DISABLED。
  2. 非 AVAILABLE 一律不輸出連結（url=""），不得產生假連結或假完成事件。
  3. 不得把 F450 十二任務（/platform/f450）重新命名為 3D 數位孿生；兩者為不同模組。
  4. 模組入口 URL 僅為基礎網址，不得附加登入 Token、學生個資等敏感參數。
  5. 本層只做配置檢查、角色檢查與健康探測；不建立第二套身分系統、不寫入正式 DB、
     不新增 Migration。
  6. 預設配置下（所有模組 DISABLED）**不會發出任何網路探測**，對既有行為零影響。
  7. （I3-B）入口 URL 須通過安全檢查才會被探測或輸出為連結；未通過者不探測、不連結，
     且不改變任何學習紀錄。
  8. 本層**不啟動任何外部服務**，只做設定檢查、角色檢查與被動健康探測。
  9. （I4-C）URL 僅來自伺服器端設定（settings／環境變數），**不接受任何請求輸入**；
     除 scheme／帳密／敏感參數檢查外，另拒絕內網、迴環、link-local、保留位址與
     雲端 metadata 目標。
 10. （I5-B，R1 DNS 重綁 TOCTOU）安全判定與實際連線必須使用**同一個經驗證的目標 IP**：
     `_resolve_probe_target()` 解析並驗證後只回傳單一 IP，`_probe_pinned()` 以該 IP
     建立連線（TCP 與 TLS 皆然），**連線過程不再解析 DNS**；因此「判定時為公網、
     連線時為內網」的變換無效。TLS 的 SNI 與憑證驗證仍使用**原始主機名**，
     且使用 `ssl.create_default_context()`，**未停用任何憑證驗證**。
     安全檢查失敗時**不得退回使用原始 hostname 連線**（未釘選 IP 即拋錯）。
 11. （I5-B，R2）白名單**不再繞過位址安全判定**：
       - `FDE_EXTERNAL_MODULE_ALLOWED_HOSTS` 為主機名信任清單（精確或 `*.suffix`），
         **非空時具有強制性**（未列出者不得作為模組目標）。
       - 指向內網／迴環／link-local／保留位址的目標，必須另外以
         `FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS` **精確**列出（不支援通配符），
         避免通配符自動放行所有內網 IP。
       - metadata 與 localhost 主機**無條件拒絕**，任何白名單皆不得放行。
 12. （I5-B，R3）DNS 解析失敗一律 **fail-closed**：不探測、狀態為「服務暫時不可用」
     （診斷碼 `DNS_FAILED`），不再把解析失敗當成安全。
 13. （I5-B，R7／R9）主機名一致正規化（小寫、去尾點、IDNA、去 IPv6 zone），
     並拒絕以十進位／十六進位／八進位等非標準表示法冒充主機名的情況。
 14. （I5-B）診斷碼僅供教師端，**不含任何主機名稱或 IP**，不得渲染於學員頁面；
     學員只看見四態之一與通用說明文字。
"""

import http.client
import ipaddress
import re
import socket
import ssl
import time
import urllib.parse

from django.conf import settings

# --- 四狀態定義 -------------------------------------------------------------
STATUS_AVAILABLE = "AVAILABLE"
STATUS_NOT_INTEGRATED = "NOT_INTEGRATED"
STATUS_SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
STATUS_ROLE_RESTRICTED = "ROLE_RESTRICTED"

# 顯示文字（教師 I2-B 指定用語；四態互相不可冒充）
STATUS_LABELS = {
    STATUS_AVAILABLE: "已可使用",
    STATUS_NOT_INTEGRATED: "尚未接入",
    STATUS_SERVICE_UNAVAILABLE: "服務暫時不可用",
    STATUS_ROLE_RESTRICTED: "權限不足",
}

# 供前端樣式使用的穩定 class 後綴
STATUS_CLASSES = {
    STATUS_AVAILABLE: "available",
    STATUS_NOT_INTEGRATED: "not-integrated",
    STATUS_SERVICE_UNAVAILABLE: "service-unavailable",
    STATUS_ROLE_RESTRICTED: "role-restricted",
}

# 非「尚未接入」時，改用對應狀態的說明文字，避免出現自相矛盾的敘述。
# （「尚未接入」沿用各模組自帶的 note，保留「待接入」用語。）
_DEFAULT_STATUS_NOTES = {
    STATUS_AVAILABLE: "模組服務目前可使用，點擊進入。",
    STATUS_SERVICE_UNAVAILABLE: (
        "模組已設定，但目前無法使用（暫時不可用）。"
        "此狀態不影響你的學習紀錄與教師審核結果，請稍後再試或聯絡教師。"
    ),
    STATUS_ROLE_RESTRICTED: "此模組未開放給目前角色使用。",
}

# --- 教師端診斷碼（I5-B）--------------------------------------------------
# 只區分「為什麼不可用」，**不含主機名稱／IP／內網位址**等敏感資訊，
# 因此即使誤渲染也不會洩漏基礎設施。學員頁面一律使用四態通用文字。
DIAG_NOT_CONFIGURED = "NOT_CONFIGURED"
DIAG_ROLE_RESTRICTED = "ROLE_RESTRICTED"
DIAG_OK = "SERVICE_ONLINE"
DIAG_SERVICE_UNREACHABLE = "SERVICE_UNREACHABLE"
DIAG_DNS_FAILED = "DNS_FAILED"
DIAG_SECURITY_REJECTED = "SECURITY_REJECTED"

DIAGNOSIS_LABELS = {
    DIAG_NOT_CONFIGURED: "模組未配置或已停用",
    DIAG_ROLE_RESTRICTED: "使用者未授權（未探測）",
    DIAG_OK: "服務可連線",
    DIAG_SERVICE_UNREACHABLE: "服務不可達（逾時或連線失敗）",
    DIAG_DNS_FAILED: "DNS 解析失敗（fail-closed，未探測）",
    DIAG_SECURITY_REJECTED: "安全設定拒絕（未探測）",
}

# 每個模組的靜態契約。enabled / entry_url 可被 settings.FDE_EXTERNAL_MODULES 覆寫。
_EXTERNAL_MODULE_DEFS = {
    "F450_DIGITAL_TWIN": {
        "module_id": "F450_DIGITAL_TWIN",
        "display_name": "F450 數位孿生",
        "stage": "build",
        "allowed_roles": ["student", "teacher"],
        "integration_version": "reserved-1.0",
        "note": (
            "由教師在其他專案獨立開發的 F450 3D 數位孿生。本輪僅預留接口（待接入），"
            "不提供連結、不標記完成狀態。"
        ),
    },
    "MP_GROUND_STATION": {
        "module_id": "MP_GROUND_STATION",
        "display_name": "MP 地面站（預留）",
        "stage": "assess",
        "allowed_roles": ["student", "teacher"],
        "integration_version": "reserved-1.0",
        "note": (
            "MP 地面站與考核由教師獨立開發。本輪不修改 MP12 內部程式，僅預留接口（待接入），"
            "不提供連結、不標記完成狀態。"
        ),
    },
    "HQGC_ASSESSMENT": {
        "module_id": "HQGC_ASSESSMENT",
        "display_name": "HQGC 考核（預留）",
        "stage": "assess",
        "allowed_roles": ["student", "teacher"],
        "integration_version": "reserved-1.0",
        "note": (
            "HQGC 為獨立專案。本輪僅預留接口（待接入），不提供連結、不標記完成狀態。"
        ),
    },
}

# 探測用 User-Agent（可識別、非偽裝；不夾帶任何身分資訊）
PROBE_USER_AGENT = "FDE-Module-Probe/1.0"

# TLS 一律使用系統預設驗證（不停用任何憑證檢查）。
_PROBE_TLS_CONTEXT = ssl.create_default_context()


def _overrides():
    """延遲讀取 settings.FDE_EXTERNAL_MODULES（支援 override_settings）。"""
    return getattr(settings, "FDE_EXTERNAL_MODULES", {}) or {}


def _override_for(module_id):
    return _overrides().get(module_id, {}) or {}


# --- 健康探測（服務暫時不可用 的真實依據）-----------------------------------
_PROBE_CACHE = {}


def clear_probe_cache():
    """清空探測快取（測試用）。"""
    _PROBE_CACHE.clear()


def _probe_timeout():
    try:
        return float(getattr(settings, "FDE_EXTERNAL_MODULE_PROBE_TIMEOUT_SECONDS", 1.5) or 1.5)
    except (TypeError, ValueError):
        return 1.5


def _probe_ttl():
    try:
        return float(getattr(settings, "FDE_EXTERNAL_MODULE_PROBE_TTL_SECONDS", 30) or 30)
    except (TypeError, ValueError):
        return 30


def _probe_seam():
    """測試注入點：設定後完全不進行 DNS 解析與連線。

    生產環境不會設定此值；它的存在是為了讓「四態判定」可以在沒有網路的測試環境驗證。
    靜態安全檢查（scheme／帳密／敏感參數／metadata／內網 IP）**仍一律執行**。
    """
    prober = getattr(settings, "FDE_EXTERNAL_MODULE_PROBER", None)
    return prober if callable(prober) else None


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """TCP 連線目標固定為「已驗證 IP」（R1：不得重新解析 DNS）。"""

    def __init__(self, host, port=None, *, pinned_ip="", **kwargs):
        self._pinned_ip = pinned_ip
        super().__init__(host, port=port, **kwargs)

    def connect(self):
        if not self._pinned_ip:
            # 安全檢查未取得經驗證的 IP：一律拋錯，不得退回使用原始 hostname。
            raise OSError("pinned_ip_required")
        self.sock = socket.create_connection((self._pinned_ip, self.port), timeout=self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """TLS 連線目標固定為「已驗證 IP」，但 SNI／憑證驗證仍使用原始主機名。

    因此「連到錯誤 IP 但用對的 Host 名」與「用錯 Host 名但 IP 對了」兩種繞過皆不可行，
    且 `ssl.create_default_context()` 的驗證完全保留。
    """

    def __init__(self, host, port=None, *, pinned_ip="", **kwargs):
        self._pinned_ip = pinned_ip
        super().__init__(host, port=port, **kwargs)

    def connect(self):
        if not self._pinned_ip:
            raise OSError("pinned_ip_required")
        self.sock = socket.create_connection((self._pinned_ip, self.port), timeout=self.timeout)
        server_hostname = self._tunnel_host or self.host
        self.sock = self._context.wrap_socket(self.sock, server_hostname=server_hostname)


def _probe_pinned(url, pinned_ip):
    """以「已驗證的 IP」送出單次 HEAD 請求；任何 HTTP 回應皆視為服務在線。

    - **不跟隨重新導向**：只取一次 response（`http.client` 本身不處理 3xx），
      因此 302 指向內網／metadata 也不會被跟隨。
    - **不攜帶任何憑證**：僅設定 User-Agent；無 Cookie、無 Authorization。
    - 不寫入任何資料、不讀取回應內容。
    - 連線逾時極短（預設 1.5 秒），例外一律吞掉並回 False（不得讓工作台出錯）。
    """
    timeout = _probe_timeout()
    try:
        parts = urllib.parse.urlsplit(url)
        scheme = (parts.scheme or "http").lower()
        host = parts.hostname or ""
        port = parts.port
    except ValueError:
        return False
    if not host:
        return False
    default_port = 443 if scheme == "https" else 80
    if not port:
        port = default_port
    selector = parts.path or "/"
    if parts.query:
        selector = "%s?%s" % (selector, parts.query)

    if scheme == "https":
        connection_class = _PinnedHTTPSConnection
        extra = {"context": _PROBE_TLS_CONTEXT}
    else:
        connection_class = _PinnedHTTPConnection
        extra = {}

    try:
        connection = connection_class(
            host, port=port, timeout=timeout, pinned_ip=pinned_ip, **extra
        )
    except Exception:
        return False
    try:
        connection.request("HEAD", selector, headers={"User-Agent": PROBE_USER_AGENT})
        connection.getresponse()
        # 任何 HTTP 回應（含 3xx／401／403／405）皆代表服務在線。
        return True
    except Exception:
        return False
    finally:
        try:
            connection.close()
        except Exception:
            pass


def _evaluate_and_probe(entry_url):
    """回傳 (available, diagnosis, safe_url)。

    測試捷徑（`FDE_EXTERNAL_MODULE_PROBER`）**優先於快取**：注入後完全不做 DNS 解析
    與連線，只保留靜態安全檢查，以便在無網路環境驗證四態判定。
    """
    prober = _probe_seam()
    if prober is not None:
        problem, diagnosis = _static_url_problem(entry_url)
        if problem:
            return False, diagnosis, ""
        try:
            available = bool(prober(entry_url))
        except Exception:
            return False, DIAG_SERVICE_UNREACHABLE, ""
        diagnosis = DIAG_OK if available else DIAG_SERVICE_UNREACHABLE
        return available, diagnosis, (entry_url if available else "")

    ttl = _probe_ttl()
    now = time.monotonic()
    cached = _PROBE_CACHE.get(entry_url)
    if cached is not None and (now - cached[0]) < ttl:
        return cached[1], cached[2], cached[3]

    evaluation = evaluate_entry_url(entry_url)
    if evaluation["problem"]:
        available, diagnosis, safe_url = False, evaluation["diagnosis"], ""
    else:
        available = _probe_pinned(evaluation["url"], evaluation["ip"])
        diagnosis = DIAG_OK if available else DIAG_SERVICE_UNREACHABLE
        safe_url = evaluation["url"] if available else ""

    _PROBE_CACHE[entry_url] = (now, available, diagnosis, safe_url)
    return available, diagnosis, safe_url


def _probe_available(entry_url):
    """回傳入口是否可用（兼容介面；不含診斷與 URL）。"""
    return _evaluate_and_probe(entry_url)[0]


# --- 入口 URL 安全檢查（I3-B；I5-B 強化）-------------------------------------
# 模組入口 URL 由教師以環境變數設定（受信任來源），但仍做完整安全檢查：
#   1. 只允許 http / https（拒絕 javascript:、file:、data:、ftp: 等）。
#   2. 不得含使用者資訊（user:pass@host）——避免憑證出現在 URL。
#   3. 查詢字串與片段不得出現 Token／密碼／個資等敏感參數名。
#   4. 不得指向 metadata / localhost（無條件拒絕，白名單亦不放行）。
#   5. 不得以十進位／十六進位／八進位等非標準表示法冒充主機名（I5-B R7）。
#   6. 主機名正規化：小寫、去尾點、IDNA、去 IPv6 zone（I5-B R9）。
#   7. 解析後之實際位址不得為內網／迴環／link-local／保留／多播／未指定；
#      除非該主機名或 IP 精確列於 FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS（I5-B R2）。
#   8. DNS 解析失敗一律 fail-closed（I5-B R3）。
# 未通過者一律**不探測、不連結**，狀態為「服務暫時不可用」，並在診斷碼標明原因。
_URL_SENSITIVE_KEY_PATTERN = re.compile(
    r"(?:^|[?&#;])(?:"
    r"token|access_token|refresh_token|id_token|jwt|"
    r"password|passwd|pwd|secret|api_?key|apikey|"
    r"auth|authorization|signature|sig|credential|credentials|"
    r"session|sessionid|sid|sso|"
    r"email|phone|mobile|tel|username|user_id|student_id|account|id_card"
    r")=",
    re.IGNORECASE,
)

# I5-B：雲端 metadata／本機主機保留名（比對前先正規化，故不含尾點變體）。
_RESERVED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
    "instance-data",
    "169.254.169.254",
    "169.254.170.2",
    "fd00:ec2::254",
}

# I5-B R7：非標準數值／進位制主機名表示法。
_NUMERIC_HOST_PATTERN = re.compile(r"^(?:0[xX][0-9a-fA-F]+|\d+)$")

URL_REJECTED_SCHEME = "模組入口 URL 未通過安全檢查：只允許 http 或 https，已暫時停用此模組入口。"
URL_REJECTED_CREDENTIALS = "模組入口 URL 未通過安全檢查：網址不得包含帳號或密碼，已暫時停用此模組入口。"
URL_REJECTED_HOST = "模組入口 URL 未通過安全檢查：主機位址格式不正確，已暫時停用此模組入口。"
URL_REJECTED_SENSITIVE = (
    "模組入口 URL 未通過安全檢查：不得夾帶 Token、密碼或學生個資等敏感參數，已暫時停用此模組入口。"
)
URL_REJECTED_METADATA = (
    "模組入口 URL 未通過安全檢查：不得指向 localhost 或雲端 metadata 位址，已暫時停用此模組入口。"
)
URL_REJECTED_NUMERIC_HOST = (
    "模組入口 URL 未通過安全檢查：主機名稱使用了非標準的數字／進位制表示法，已暫時停用此模組入口。"
)
URL_REJECTED_NOT_ALLOWLISTED = (
    "模組入口 URL 未通過安全檢查：主機未列於 FDE_EXTERNAL_MODULE_ALLOWED_HOSTS，已暫時停用此模組入口。"
)
URL_REJECTED_DNS = (
    "模組入口 URL 的 DNS 解析失敗（fail-closed），未進行探測，已暫時停用此模組入口。"
)
# I5-B：內網／迴環／link-local／保留位址與雲端 metadata（SSRF 防護縱深）。
URL_REJECTED_NETWORK = (
    "模組入口 URL 未通過安全檢查：不得指向內網、迴環或雲端 metadata 位址。"
    "如需指向內網服務，請在 FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS 精確列出可信主機，"
    "已暫時停用此模組入口。"
)


def _normalize_hostname(host):
    """主機名一致正規化（I5-B R9）：小寫、去尾點、去 IPv6 zone、IDNA。

    無法解譯時回 None（呼叫端視為不安全）。
    """
    if not host:
        return None
    value = str(host).strip().lower()
    while value.endswith("."):
        value = value[:-1]
    if not value:
        return None
    if "%" in value:  # IPv6 zone id（fe80::1%eth0）
        head, _, _zone = value.partition("%")
        value = head or value
    try:
        ipaddress.ip_address(value)
        return value
    except ValueError:
        pass
    try:
        value = value.encode("idna").decode("ascii").lower()
    except (UnicodeError, UnicodeDecodeError):
        try:
            value = value.encode("ascii").decode("ascii").lower()
        except UnicodeDecodeError:
            return None
    return value or None


def _is_numeric_host_form(host):
    """拒絕以數值／進位制表示法冒充主機名（I5-B R7）。"""
    if not host:
        return True
    if _NUMERIC_HOST_PATTERN.match(host):
        return True
    if "." in host:
        segments = host.split(".")
        if all(segment.isdigit() for segment in segments):
            if any(len(seg) > 1 and seg.startswith("0") for seg in segments):
                return True  # 八進位表示法（0177.0.0.1）
    return False


def _literal_address(host):
    """主機名本身即為 IP 字面值時回傳 ipaddress 物件，否則 None。"""
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        return None


def _address_is_restricted(address):
    """判斷單一 IP 是否屬內網／迴環／link-local／保留／多播／未指定。"""
    try:
        ip = ipaddress.ip_address(str(address).split("%")[0])
    except ValueError:
        return False
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _trusted_host_patterns():
    """教師明確信任的主機名清單（I5-B：僅信任主機名，不授予放行內網 IP 的能力）。

    來源：settings.FDE_EXTERNAL_MODULE_ALLOWED_HOSTS（list[str]）。
    元素可為精確主機名（"mp.school.edu.tw"）或後綴樣式（"*.school.edu.tw"）。
    **非空時具有強制性**：只有列出者得作為模組目標。
    """
    raw = getattr(settings, "FDE_EXTERNAL_MODULE_ALLOWED_HOSTS", None) or []
    if isinstance(raw, str):
        raw = [item for item in re.split(r"[,\s]+", raw) if item]
    patterns = []
    for item in raw:
        value = str(item or "").strip().lower()
        if value:
            patterns.append(value)
    return patterns


def _host_is_allowlisted(host):
    for pattern in _trusted_host_patterns():
        if pattern.startswith("*."):
            suffix = pattern[2:]
            if host == suffix or host.endswith("." + suffix):
                return True
        elif host == pattern:
            return True
    return False


def _private_target_allowlist():
    """明確允許指向「內網／迴環／link-local／保留位址」的精確清單（I5-B R2）。

    來源：settings.FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS。
    **僅接受精確主機名或精確 IP，不支援通配符**——避免通配符自動放行所有內網 IP。
    """
    raw = getattr(settings, "FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS", None) or []
    if isinstance(raw, str):
        raw = [item for item in re.split(r"[,\s]+", raw) if item]
    entries = set()
    for item in raw:
        normalized = _normalize_hostname(item)
        if normalized:
            entries.add(normalized)
    return entries


def _private_target_is_allowed(host):
    return _normalize_hostname(host) in _private_target_allowlist()


def _resolve_host_addresses(host, port):
    """解析主機名；回傳 (位址清單, 診斷碼)。解析失敗一律 DNS_FAILED（fail-closed）。"""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError):
        return [], DIAG_DNS_FAILED
    addresses = []
    for info in infos:
        address = str(info[4][0]).split("%")[0]
        if address and address not in addresses:
            addresses.append(address)
    return addresses, None


def _host_level_block(host):
    """不需 DNS 的主機層級阻擋；通過回 None，否則回診斷碼。"""
    normalized = _normalize_hostname(host)
    if not normalized:
        return DIAG_SECURITY_REJECTED
    if normalized in _RESERVED_HOSTNAMES:
        return DIAG_SECURITY_REJECTED  # metadata / localhost：白名單亦不得放行
    if _is_numeric_host_form(normalized):
        return DIAG_SECURITY_REJECTED  # R7
    patterns = _trusted_host_patterns()
    if patterns and not _host_is_allowlisted(normalized):
        return DIAG_SECURITY_REJECTED  # 白名單非空時的強制性
    address = _literal_address(normalized)
    if address is not None and _address_is_restricted(address):
        # 字面內網 IP：只有精確配置才放行（R2）。
        if not _private_target_is_allowed(normalized) and normalized not in _private_target_allowlist():
            return DIAG_SECURITY_REJECTED
    return None


def _resolve_probe_target(host, port):
    """解析並驗證主機，回傳**單一**經驗證的 IP（I5-B R1：IP 釘選）。

    R1：呼叫端之後一律以回傳的 IP 建線，連線過程不再解析 DNS。
    R2：受限位址必須精確列於 FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS。
    R3：解析失敗一律 fail-closed。
    """
    normalized = _normalize_hostname(host)
    if not normalized:
        return "", DIAG_SECURITY_REJECTED
    blocked = _host_level_block(normalized)
    if blocked:
        return "", blocked

    addresses, diagnosis = _resolve_host_addresses(normalized, port)
    if diagnosis or not addresses:
        return "", DIAG_DNS_FAILED

    safe = [item for item in addresses if not _address_is_restricted(item)]
    if safe:
        return safe[0], DIAG_OK

    # 全部解析結果皆為受限位址：只有精確配置才放行。
    if _private_target_is_allowed(normalized):
        return addresses[0], DIAG_OK
    allowed_private = _private_target_allowlist()
    for address in addresses:
        if address in allowed_private:
            return address, DIAG_OK
    return "", DIAG_SECURITY_REJECTED


def _static_url_problem(raw_url):
    """不需 DNS 的靜態安全檢查；回傳 (問題訊息, 診斷碼)，通過時皆為空。"""
    raw = (raw_url or "").strip()
    if not raw:
        return "", DIAG_NOT_CONFIGURED
    try:
        parts = urllib.parse.urlsplit(raw)
    except ValueError:
        return URL_REJECTED_HOST, DIAG_SECURITY_REJECTED
    if parts.scheme.lower() not in ("http", "https"):
        return URL_REJECTED_SCHEME, DIAG_SECURITY_REJECTED
    if not parts.netloc or "@" in parts.netloc:
        return URL_REJECTED_CREDENTIALS, DIAG_SECURITY_REJECTED
    try:
        parts.port
    except ValueError:
        return URL_REJECTED_HOST, DIAG_SECURITY_REJECTED
    host = _normalize_hostname(parts.hostname)
    if not host:
        return URL_REJECTED_HOST, DIAG_SECURITY_REJECTED
    if host in _RESERVED_HOSTNAMES:
        return URL_REJECTED_METADATA, DIAG_SECURITY_REJECTED
    if _is_numeric_host_form(host):
        return URL_REJECTED_NUMERIC_HOST, DIAG_SECURITY_REJECTED
    patterns = _trusted_host_patterns()
    if patterns and not _host_is_allowlisted(host):
        return URL_REJECTED_NOT_ALLOWLISTED, DIAG_SECURITY_REJECTED
    probe = "?" + parts.query + "#" + parts.fragment
    if _URL_SENSITIVE_KEY_PATTERN.search(probe):
        return URL_REJECTED_SENSITIVE, DIAG_SECURITY_REJECTED
    address = _literal_address(host)
    if address is not None and _address_is_restricted(address):
        if not _private_target_is_allowed(host):
            return URL_REJECTED_NETWORK, DIAG_SECURITY_REJECTED
    return "", DIAG_OK


def _rejected_evaluation(message, diagnosis):
    return {"url": "", "ip": "", "problem": message or URL_REJECTED_NETWORK, "diagnosis": diagnosis}


def evaluate_entry_url(raw_url):
    """完整安全評估：靜態檢查 + DNS 解析 + IP 釘選。回傳 dict。

    回傳鍵：url（通過時為正規化後網址）、ip（通過時為經驗證的 IP）、
    problem（未通過時的繁體中文原因，供教師診斷）、diagnosis（診斷碼）。
    """
    raw = (raw_url or "").strip()
    if not raw:
        return {"url": "", "ip": "", "problem": "", "diagnosis": DIAG_NOT_CONFIGURED}
    problem, diagnosis = _static_url_problem(raw)
    if problem:
        return _rejected_evaluation(problem, diagnosis)
    try:
        parts = urllib.parse.urlsplit(raw)
        host = _normalize_hostname(parts.hostname)
        port = parts.port
    except ValueError:
        return _rejected_evaluation(URL_REJECTED_HOST, DIAG_SECURITY_REJECTED)
    if not host:
        return _rejected_evaluation(URL_REJECTED_HOST, DIAG_SECURITY_REJECTED)

    pinned_ip, ip_diagnosis = _resolve_probe_target(host, port)
    if not pinned_ip:
        message = URL_REJECTED_NETWORK
        if ip_diagnosis == DIAG_DNS_FAILED:
            message = URL_REJECTED_DNS
        return _rejected_evaluation(message, ip_diagnosis)
    return {
        "url": urllib.parse.urlunsplit(parts),
        "ip": pinned_ip,
        "problem": "",
        "diagnosis": DIAG_OK,
    }


def validate_entry_url(raw_url):
    """檢查模組入口 URL 是否為可信任目標（兼容介面）。

    回傳 (url, problem)：通過時 url 為正規化後網址、problem 為空字串；
    未通過時 url 為空字串、problem 為繁體中文原因說明（含診斷用訊息，不含目標位址）。
    """
    result = evaluate_entry_url(raw_url)
    return result["url"], result["problem"]


def _resolve_module_state(enabled, entry_url, allowed_roles, role):
    """依序判定：尚未接入 → 權限不足（不探測）→ 服務暫時不可用 → 已可使用。"""
    if not enabled or not (entry_url or "").strip():
        return STATUS_NOT_INTEGRATED, DIAG_NOT_CONFIGURED, ""
    if role is not None and role not in allowed_roles:
        # 角色不符時不進行任何解析或探測（不對未授權者洩漏服務可用性）。
        return STATUS_ROLE_RESTRICTED, DIAG_ROLE_RESTRICTED, ""
    available, diagnosis, safe_url = _evaluate_and_probe((entry_url or "").strip())
    status = STATUS_AVAILABLE if available else STATUS_SERVICE_UNAVAILABLE
    return status, diagnosis, safe_url


def get_external_module(module_id, role=None):
    """回傳單一模組的渲染用 dict。

    role=None 表示不檢查角色（僅做配置與探測判定）；非 AVAILABLE 時 url 一律為空。
    `diagnosis` 為教師端診斷碼（不含主機名／IP），**不得渲染於學員頁面**。
    """
    base = _EXTERNAL_MODULE_DEFS.get(module_id)
    if base is None:
        return None
    override = _override_for(module_id)
    enabled = bool(override.get("enabled", False))
    raw_url = (override.get("entry_url") or "").strip()
    allowed_roles = list(override.get("allowed_roles", base["allowed_roles"]))

    status, diagnosis, safe_url = _resolve_module_state(enabled, raw_url, allowed_roles, role)
    note = _DEFAULT_STATUS_NOTES.get(status, base["note"])
    return {
        "module_id": base["module_id"],
        "name": base["display_name"],
        "stage": base["stage"],
        "enabled": enabled,
        "entry_url": safe_url if status == STATUS_AVAILABLE else "",
        "url": safe_url if status == STATUS_AVAILABLE else "",
        "availability_status": status,
        "status_key": STATUS_CLASSES[status],
        "state": STATUS_LABELS[status],
        "allowed_roles": allowed_roles,
        "integration_version": override.get("integration_version", base["integration_version"]),
        "note": note,
        "url_rejected": diagnosis == DIAG_SECURITY_REJECTED,
        "diagnosis": diagnosis,
    }


def external_modules_for_stage(stage_key, role=None):
    """回傳某階段應顯示的外部模組清單（渲染用）；預設依 stage 過濾。"""
    result = []
    for module_id in _EXTERNAL_MODULE_DEFS:
        if _EXTERNAL_MODULE_DEFS[module_id]["stage"] == stage_key:
            result.append(get_external_module(module_id, role=role))
    return result


def all_external_modules(role=None):
    """回傳全部外部模組（渲染或契約檢視用）。"""
    return [get_external_module(mid, role=role) for mid in _EXTERNAL_MODULE_DEFS]


def external_module_contract():
    """回傳外部模組接口契約（欄位說明與四狀態定義），供驗收報告引用。

    I4-B（2026-10-13 教師指令第四節）：契約需清楚說明模組 ID、服務 URL 配置、
    啟用與停用、權限要求、服務可用性、未來資料交換格式、錯誤及降級行為。
    I5-B：新增 IP 釘選、白名單語意、fail-closed DNS、正規化與診斷碼條款。
    """
    return {
        "fields": [
            "module_id",
            "display_name",
            "enabled",
            "entry_url",
            "availability_status",
            "allowed_roles",
            "integration_version",
        ],
        "statuses": [
            {"key": STATUS_AVAILABLE, "label": STATUS_LABELS[STATUS_AVAILABLE], "linkable": True},
            {"key": STATUS_NOT_INTEGRATED, "label": STATUS_LABELS[STATUS_NOT_INTEGRATED], "linkable": False},
            {"key": STATUS_SERVICE_UNAVAILABLE, "label": STATUS_LABELS[STATUS_SERVICE_UNAVAILABLE], "linkable": False},
            {"key": STATUS_ROLE_RESTRICTED, "label": STATUS_LABELS[STATUS_ROLE_RESTRICTED], "linkable": False},
        ],
        # I5-B：狀態判定語意（教師指定）。
        "state_rules": {
            "not_configured_or_disabled": STATUS_NOT_INTEGRATED,
            "dns_failure": STATUS_SERVICE_UNAVAILABLE,
            "security_rejected": STATUS_SERVICE_UNAVAILABLE,
            "service_unreachable": STATUS_SERVICE_UNAVAILABLE,
            "unauthorized": STATUS_ROLE_RESTRICTED,
            "probe_skipped_for_unauthorized": True,
            "safe_and_reachable": STATUS_AVAILABLE,
        },
        "defaults": {
            "enabled": False,
            "entry_url": "",
            "availability_status": STATUS_NOT_INTEGRATED,
        },
        "override_source": "settings.FDE_EXTERNAL_MODULES",
        "probe_override": "settings.FDE_EXTERNAL_MODULE_PROBER（測試注入；未設定則做真實輕量探測）",
        "no_database_table": True,
        "first_batch": list(_EXTERNAL_MODULE_DEFS.keys()),
        "module_ids": [
            {
                "module_id": base["module_id"],
                "display_name": base["display_name"],
                "stage": base["stage"],
                "integration_version": base["integration_version"],
                "independent_project": True,
                "note": base["note"],
            }
            for base in _EXTERNAL_MODULE_DEFS.values()
        ],
        "url_configuration": {
            "setting": "settings.FDE_EXTERNAL_MODULES[<module_id>]['entry_url']",
            "environment_variable": "FDE_MODULE_<module_id>_URL",
            "value_form": "僅基礎網址（scheme + host + port + path），不得夾帶 Token／密碼／學生個資",
            "validated_by": "validate_entry_url()",
            "invalid_result": STATUS_SERVICE_UNAVAILABLE,
            "trusted_host_allowlist": "FDE_EXTERNAL_MODULE_ALLOWED_HOSTS",
            "private_target_allowlist": "FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS",
        },
        "activation": {
            "default": "DISABLED",
            "enable_setting": "FDE_MODULE_<module_id>_ENABLED=1",
            "disabled_effect": "狀態為「尚未接入」；不解析、不探測、不產生連結、不影響任何學習紀錄",
            "enabled_without_url_effect": "狀態仍為「尚未接入」（需同時提供 entry_url）",
            "runtime_reload": "讀取 settings，服務重啟後生效（本層不提供熱切換 API）",
        },
        "permissions": {
            "field": "allowed_roles",
            "values": ["student", "teacher"],
            "default": ["student", "teacher"],
            "not_allowed_effect": STATUS_ROLE_RESTRICTED,
            "check_order": "角色判定先於 DNS 解析與健康探測（不對未授權者洩漏服務可用性，也不發出任何連線）",
            "auth_source": "沿用既有 Django session 角色（不建立第二套身分系統）",
        },
        "availability": {
            "probe_method": "HEAD",
            "probe_timeout_seconds_setting": "FDE_EXTERNAL_MODULE_PROBE_TIMEOUT_SECONDS",
            "probe_ttl_seconds_setting": "FDE_EXTERNAL_MODULE_PROBE_TTL_SECONDS",
            "probe_timeout_seconds_default": 1.5,
            "any_http_response_means_online": True,
            "failure_means": STATUS_SERVICE_UNAVAILABLE,
            "never_raises": True,
            "follows_redirects": False,
            "connection_ip_pinned": True,
            "tls_context": "ssl.create_default_context()（未停用任何憑證驗證）",
            "sni_and_host_header_use_original_hostname": True,
        },
        "data_exchange": {
            "status": "RESERVED（尚未實作；本輪不接入獨立專案、不指定未知服務埠）",
            "transport": "HTTPS + JSON（模組自帶認證，不得把憑證放在 URL）",
            "entry": "GET {entry_url}（由模組自身完成登入；本層不代傳憑證）",
            "reserved_endpoints": [
                {"path": "/health", "method": "GET", "purpose": "健康探測（目前以 HEAD 探測入口替代）"},
                {"path": "/sessions", "method": "POST", "purpose": "建立一次實訓／考核工作階段"},
                {"path": "/results", "method": "POST", "purpose": "回傳成果（僅供教師端複核，不自動寫入學習紀錄）"},
            ],
            "envelope": {
                "module_id": "字串，模組 ID（如 MP_GROUND_STATION）",
                "integration_version": "字串，模組自行宣告的介接版本",
                "student_ref": "偽名化參照（學號雜湊或模組端代號），不得為姓名／Email／身分證號",
                "event": "字串，事件類型（如 SESSION_COMPLETED）",
                "occurred_at": "ISO 8601 時間字串",
                "payload": "物件，模組自訂內容",
                "signature": "字串，模組端簽章（供教師端驗證來源）",
            },
            "forbidden": [
                "學生個資（姓名／Email／電話／身分證號）",
                "登入 Token／密碼／API Key 置於 URL",
                "自動寫入學習紀錄或自動標記任務完成",
                "自動建立成績、事件或完成紀錄",
            ],
            "teacher_review_required": True,
        },
        "error_and_degradation": {
            "config_error": "狀態「尚未接入」",
            "role_denied": "狀態「權限不足」，不解析、不探測",
            "dns_error": "狀態「服務暫時不可用」，診斷碼 DNS_FAILED，不產生連結，工作台仍正常 200",
            "security_error": "狀態「服務暫時不可用」，診斷碼 SECURITY_REJECTED，不產生連結，工作台仍正常 200",
            "service_error": "狀態「服務暫時不可用」，診斷碼 SERVICE_UNREACHABLE，不產生連結，工作台仍正常 200",
            "learning_record_impact": "無（不修改任何學習紀錄、任務完成狀態或教師複核結果）",
            "workbench_impact": "無（任何失敗絕不拋出例外）",
            "ui_text": "明示「不影響你的學習紀錄與教師審核結果」",
        },
        # I5-B：教師端診斷碼（不含主機名／IP，不得渲染於學員頁面）。
        "diagnosis": {
            "purpose": "教師端診斷用途；區分 DNS 失敗與安全設定拒絕",
            "student_visible": False,
            "contains_host_or_ip": False,
            "codes": DIAGNOSIS_LABELS,
        },
        # I3-B：入口 URL 安全契約（未通過者不探測、不連結，狀態「服務暫時不可用」）。
        "url_safety": {
            "schemes_allowed": ["http", "https"],
            "userinfo_allowed": False,
            "sensitive_query_keys_rejected": True,
            "untrusted_hosts": sorted(_RESERVED_HOSTNAMES),
            "rejected_status": STATUS_SERVICE_UNAVAILABLE,
            "rejected_is_probed": False,
            "auto_start_external_service": False,
            "config_source": "settings.FDE_EXTERNAL_MODULES（僅伺服器端設定；不接受請求輸入）",
            "restricted_address_classes": [
                "private",
                "loopback",
                "link_local",
                "reserved",
                "multicast",
                "unspecified",
            ],
            "dns_resolution_checked": True,
            "redirects_followed_by_probe": False,
            "trusted_host_allowlist_setting": "FDE_EXTERNAL_MODULE_ALLOWED_HOSTS",
            # I5-B：白名單不再繞過位址判定。
            "allowlist_precedence": False,
            "allowlist_enforcement": "mandatory_when_non_empty",
            "allowlist_grants_private_access": False,
            "private_allowlist_setting": "FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS",
            "private_allowlist_wildcards": False,
            "metadata_and_localhost_always_denied": True,
            "hostname_normalization": ["lowercase", "trailing_dot", "ipv6_zone", "idna"],
            "numeric_host_forms_rejected": True,
            "dns_failure_is_fail_closed": True,
            "dns_failure_status": STATUS_SERVICE_UNAVAILABLE,
            # I5-B R1：IP 釘選。
            "pinned_ip_used_for_connection": True,
            "dns_lookups_per_probe": 1,
            "dns_rebinding_blocked": True,
            "hostname_fallback_after_rejection": False,
            "credentials_sent_by_probe": False,
            "probe_method": "HEAD",
            "probe_writes_data": False,
            "tls_verification_disabled": False,
            "sni_uses_original_hostname": True,
        },
    }



