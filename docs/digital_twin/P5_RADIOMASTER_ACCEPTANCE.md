# P5-D RadioMaster Pocket 人工验收 SOP

## 状态：PENDING_MANUAL

本轮未连接任何 USB 遥控器。现有 ExamInput / Gamepad API 输入路径保持不改；模拟输入、键盘或浏览器枚举不可代替实际 RadioMaster 验收。

教师现场步骤：

1. 以数据 USB 连接 RadioMaster Pocket，打开 FDE-AI 的既有“连接方式”面板。
2. 确认 HID 装置名称、连接状态及四个实时 axis 值。
3. 逐一确认 Mode 1/Mode 2 的 throttle、yaw、pitch、roll 映射、方向、中点和端点。
4. 确认最低油门才允许进入 Physics Pro 的解锁前准备状态。
5. 在 SITL（绝非真机）检查一次输入响应；拔出 USB，确认失联/看门狗释放；重新插入后重新确认。
6. 教师人工确认后才可将 RadioMaster Physics Pro 标记为 PASS。

禁止：自动连接真实飞控、自动 ARM、真实飞机 AUTO 或带桨测试。
