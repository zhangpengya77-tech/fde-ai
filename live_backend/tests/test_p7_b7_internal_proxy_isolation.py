"""P7-B7：Gateway 向 Django 換取 Assertion 時不得繼承主機代理設定。"""

from __future__ import annotations

import unittest
from pathlib import Path


class GatewayInternalProxyIsolationTests(unittest.TestCase):
    """攜帶 Session／CSRF 的 loopback 請求必須明確停用環境 Proxy。"""

    def test_assertion_exchange_disables_environment_proxy(self):
        source = (
            Path(__file__).resolve().parents[1] / "app" / "gateway.py"
        ).read_text(encoding="utf-8")
        start = source.index("async with httpx.AsyncClient(")
        end = source.index(") as client:", start)
        exchange = source[start:end]
        self.assertIn(
            "trust_env=False",
            exchange,
            "Gateway 的內部 Django Assertion 換票不得走主機 HTTP(S)_PROXY。",
        )
