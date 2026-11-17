# FDE-QGC V1.0：僅覆寫應用程式識別，保留 ArduPilot 與 PX4 官方外掛。
# 注意：QGC_APP_NAME 同時是 CMake 專案／執行檔名稱，不可含空白 → 執行檔為 FDE-QGC.exe；
# 「FDE-QGC V1.0 地面站」用於桌面捷徑與視窗說明。
set(QGC_APP_NAME "FDE-QGC" CACHE STRING "FDE application name" FORCE)
set(QGC_APP_DESCRIPTION "FDE-QGC V1.0 FDE-AI Ground Control Station (based on QGroundControl 5.1.5)" CACHE STRING "FDE application description" FORCE)
set(QGC_ORG_NAME "FDE-AI" CACHE STRING "FDE organization" FORCE)
set(QGC_ORG_DOMAIN "fde-ai.local" CACHE STRING "FDE organization domain" FORCE)
set(QGC_PACKAGE_NAME "org.fdeai.fdeqgc" CACHE STRING "FDE package identifier" FORCE)
# Windows 應用程式圖示（FDE 自製，tools\claude\make_fde_icon.py 產生）
set(QGC_WINDOWS_ICON_PATH "${CMAKE_SOURCE_DIR}/${QGC_CUSTOM_DIR}/deploy/windows/FdeQgc.ico" CACHE FILEPATH "Windows application icon" FORCE)
