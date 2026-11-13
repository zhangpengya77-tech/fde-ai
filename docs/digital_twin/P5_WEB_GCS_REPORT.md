# P5-C FDE-AI 网页地面站训练入口

## 结果：PASS（本机计划与安全门槛）；未连接 Gateway / mission protocol

入口为 `/?mode=gcs`，与 `?mode=exam` 的考照模拟器路由独立。

页面显示：四个航点、局部航点视图、航点序号、高度、速度、任务进度、连接状态、权威来源提示、电池/模式/日志占位与 RTL 状态入口。无 Gateway session 时显示“未连接”，并禁用“上传至 SITL”“执行 AUTO”“RTL 返航”；不会把浏览器计划写为已上载 MAVLink mission。

真实 Chrome/Playwright 专项：`tests/browser/p5-ground-station.spec.ts --project=desktop-chrome`，1 passed。

尚未实现：经 Gateway 的 mission protocol、真实遥测填充、地图瓦片、QGC 等价功能。网页入口明确标示为训练工具，非完整 QGC。

### P5-G 复核

Gazebo/SITL 的 telemetry_v2 已可由 Gateway 产生，但本轮没有把尚未完成的 mission protocol 接入 `?mode=gcs`。因此网页仍只通过既有安全门槛展示计划；它没有显示“任务已上传”、没有伪造 AUTO/RTL 状态，也没有把教学计划变成飞控任务。真实 3D Gazebo 权威同步需先取得可重复的 Chrome 数值对照，当前为 **PENDING**。
# P5-H 更新（2026-11-11）

Chrome GCS 的既有入口与 Web Lite 未被本轮修改。本轮尚未在满足 IMU 健康门槛的 Gazebo 会话中执行 Mission AUTO，因此网页四航点进度、AUTO/RTL 状态及真实 3D 航线数值同步均为 **BLOCKED**，不得以旧的 Physics Pro 起飞闭环替代本项验收。

