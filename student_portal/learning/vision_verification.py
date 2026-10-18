"""教師圖片驗證的安全狀態判定（PROP_DIRECTION_V1 / FOUR_SIDE_HOVER_V1）。

本模組只判斷「現在能不能跑推論」，不執行推論、不載入任何 .pt。

安全立場（教師 2026-10-08 指令，2026-10-10 補充）：
    學生 .pt 是 PyTorch pickle，載入即執行任意程式碼，**禁止在 Django 服務進程內載入**。
    推論一律交由既有的 Live Backend 推論服務執行（該服務本來就以載入 .pt 為職責）。

2026-10-10 變更說明：
    原實作把 `available` 硬編碼為 False，導致教師圖片驗證永久 BLOCKED。
    改為探測既有 Live Backend 推論服務是否可用：
      - 服務可用 → 允許驗證，推論在該服務的獨立進程中執行。
      - 服務不可用 → 明確 BLOCKED，並顯示原因，**不偽造任何辨識結果**。

    這不降低安全性：Django 進程仍然完全不載入 .pt；被信任的推論服務與
    Django 為不同進程、不同 Python 環境。
"""

# 模型執行環境種類。
EXECUTION_ENVIRONMENTS = (
    ("NONE", "無可用隔離環境"),
    ("LIVE_BACKEND", "既有 Live Backend 推論服務（獨立進程）"),
    ("OS_SANDBOX", "作業系統級沙箱"),
    ("CONTAINER", "容器隔離"),
    ("EXTERNAL", "外部隔離執行環境"),
)

# 進程內載入 .pt 的立場：永久禁止。
IN_PROCESS_LOADING_ALLOWED = False


def _probe_live_backend() -> tuple[bool, str]:
    """探測既有 Live Backend 推論服務是否可用。不載入任何模型。"""
    from . import vision_submission

    try:
        vision_submission.list_models()
        return True, ""
    except RuntimeError as exc:
        return False, str(exc)
    except Exception as exc:  # 設定缺失等意外狀況，一律視為不可用
        return False, f"{type(exc).__name__}: {exc}"


def runner_state() -> dict:
    """回傳目前推論 Runner 的可用狀態。

    可用性由「既有 Live Backend 推論服務是否在線」決定，而非硬編碼。
    Django 進程本身永不載入 .pt。
    """
    ok, detail = _probe_live_backend()
    if ok:
        return {
            "available": True,
            "environment": "LIVE_BACKEND",
            "environment_label": "既有 Live Backend 推論服務（獨立進程）",
            "reason": "",
            "required_for_enable": "",
            "detail": "推論於 Live Backend 獨立進程執行；Django 不載入 .pt。",
        }
    return {
        "available": False,
        "environment": "NONE",
        "environment_label": "無可用隔離環境",
        "reason": "Live Backend 推論服務目前無法連線，未執行任何推論。",
        "required_for_enable": "請確認 Live Backend（DEMO :8111）已啟動且 VISION_SUBMISSION_API_BASE_URL 指向正確位址。",
        "detail": detail,
    }


def runner_available() -> bool:
    """推論 Runner 是否可用。"""
    return bool(runner_state()["available"])


def verification_blocked_reason(evidence) -> str:
    """判斷此模型目前可否進入圖片驗證；回傳空字串代表允許執行。

    即使 Runner 可用，仍需先由教師列為候選。
    """
    from .vision_flywheel import review_status_of

    if not runner_available():
        return runner_state()["reason"]
    if review_status_of(evidence) != "CANDIDATE":
        return "此模型尚未由教師列為候選，不可進行圖片驗證。"
    return ""


def verification_ready(evidence) -> bool:
    """是否可實際執行推論。"""
    return verification_blocked_reason(evidence) == ""
