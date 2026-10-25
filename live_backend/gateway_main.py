"""以獨立程序啟動 P3-D 身分閘道。

僅在明確指定本模組時生效；既有 `app.main:create_app` 行為不受影響。
缺少 `FDE_GATEWAY_INTERNAL_AUTH_KEY` 或 `FDE_LIVE_PROXY_KEY` 時，閘道對所有
`/api/live/` 請求回 503（Fail Closed），不會回退成信任瀏覽器標頭。
"""

from app.gateway import create_gateway_app

app = create_gateway_app()
