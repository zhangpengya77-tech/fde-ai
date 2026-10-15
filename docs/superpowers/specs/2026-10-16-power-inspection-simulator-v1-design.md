# FDE Power Inspection Simulator V1.0 Design

日期：2026-10-16  
状态：方案 A1 已于 2026-10-16 获教师确认  
产品名称：FDE 无人机电力巡检数字孪生训练系统

## 1. 目标与边界

V1 是可在普通 Windows 教学笔电浏览器中运行的中文无人机电力巡检教学模拟器。它服务于一堂完整课程：教师建立任务，学生规划航线、驾驶 F450、调整云台、拍摄证据、判断缺陷、返航，系统评分，教师复核。

V1 使用稳定、可解释的教学级运动模型，不声称真实空气动力学、真实温度或真实 AI 精度。系统不依赖 ROS、Gazebo、PX4、Docker、数据库服务器或公网服务。安装依赖后，开发和构建版本均不发起网络请求。

以下仅保留接口，不在 V1 实现：

- ArduPilot WASM 飞控。
- CRSF / ELRS 接收机桥。
- YOLO / best.pt 推论。
- 真实热成像物理模型。
- 多用户服务器、云端账户和远程教师后台。

## 2. 技术选择

- Vite + TypeScript。
- Three.js 负责场景、F450、相机和离屏截图。
- 小型事件驱动 Store，不引入 React 或 Zustand。
- IndexedDB 保存训练会话与截图；JSON 导出用于移交和审计。
- Canvas 2D 绘制航线剖面和简单统计图。
- Vitest 测试纯业务模块；Playwright 验证真实浏览器流程、视觉布局和截图。
- 所有电力设施优先用程序化低多边形几何生成。既有 F450 GLB 仅在来源和显示质量核实后复制到新项目。

## 3. 系统架构

```text
Input adapters
  -> InputNormalizer
  -> ChannelMapper
  -> FlightControllerAdapter
  -> SimpleFlightController
  -> F450 entity
  -> MissionEngine
  -> InspectionEngine
  -> GimbalCamera / PhotoValidator
  -> DefectAssessment
  -> ScoringEngine
  -> SessionRepository
  -> StudentReport / TeacherReview
```

各层通过 TypeScript 接口和不可变数据快照通信。渲染层不能直接修改任务、评分或持久化状态。

## 4. 输入系统

### 4.1 输入源

V1 支持：

- 键盘：WASD、方向键及明确的起飞、降落、返航、急停快捷键。
- 触控：双虚拟摇杆及独立安全操作按钮。
- Generic USB Joystick / Gamepad。
- RadioLink AT9S + Simulator Dongle，按 Generic USB Joystick 处理。
- RadioMaster / EdgeTX USB Joystick。
- DJI FPV Remote Controller 3，按 Gamepad API 实际枚举结果处理，标记为需要真机兼容性验收。

CRSF / ELRS 只定义未来 `ReceiverBridgeInputAdapter`，V1 不申请 WebSerial 或 WebHID 权限。

### 4.2 接口

```ts
interface PilotInputAdapter {
  readonly id: string;
  readonly type: 'keyboard-touch' | 'gamepad' | 'receiver-bridge';
  connect(): Promise<void>;
  disconnect(): void;
  poll(timestampMs: number): RawPilotInput;
}
```

`InputNormalizer` 使用每台设备的最小、中位、最大、反向、死区和 expo 设置，将轴转换为标准范围。Roll、Pitch、Yaw 为 `[-1, 1]`，Throttle 为 `[0, 1]`。

`ChannelMapper` 输出：

```ts
interface PilotCommand {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  arm: boolean;
  flightMode: 'manual' | 'hover' | 'mission';
  gimbalYaw: number;
  gimbalPitch: number;
}
```

默认提供 Mode 2 配置，但首次使用外部控制器必须运行校准向导。配置按 `Gamepad.id` 保存到 IndexedDB。设备断线或超过 250 ms 无新数据时，飞行器进入悬停并显示阻断提示，不把油门直接清零。

## 5. 飞行系统

`FlightControllerAdapter` 是 UI、任务与飞行实现之间唯一接口：

```ts
interface FlightControllerAdapter {
  arm(): Result;
  disarm(): Result;
  takeoff(altitudeM: number): Result;
  land(): Result;
  goto(position: Vector3Like): Result;
  setSpeed(speedMps: number): Result;
  setAltitude(altitudeM: number): Result;
  setYaw(yawDeg: number): Result;
  rtl(): Result;
  pause(): Result;
  resume(): Result;
  emergencyStop(): Result;
  update(command: PilotCommand, deltaSeconds: number): FlightSnapshot;
}
```

`SimpleFlightController` 使用限速、限加速度和姿态插值的运动模型。位置单位为米，世界坐标 Y 为高度。飞行器支持 Arm、Disarm、Takeoff、Land、Hover、前后左右、Yaw、升降、GoTo、RTL、Pause、Resume 和 Emergency Stop。

系统记录位置、Roll、Pitch、Yaw、高度、水平速度、垂直速度、航向、Home Point、飞行模式和任务状态。控制器不包含场景、评分或 UI 逻辑。

## 6. F450 表示

首选资产为本机现有 `F450_Assembly.glb` 的复制件，但须先完成节点、尺度、材质、桨叶和授权检查。若不合格，使用 Three.js 几何构建正确 X 型 F450 教学模型。

模型必须包含四臂、四马达、四片正常形状桨叶、中心板、Pixhawk、GPS、电池和云台相机。每个旋翼是独立节点，按相对方向旋转。机身姿态来自飞行快照，云台姿态独立于机身。

## 7. 场景系统

三个场景共享统一 `SceneDefinition`，但分别延迟创建和释放资源：

1. 配电线路：5 根杆塔、横担、绝缘子、10 kV 导线、变压器、熔断器、避雷器、开关、道路、树木和建筑。
2. 输电线路：4 座大型输电塔、三相导线、地线、绝缘子串、金具、跨距和弧垂。
3. 变电站：主变、断路器、隔离开关、CT、PT、避雷器、母线、绝缘子、控制建筑和围栏。

导线用分段曲线模拟弧垂。场景尺寸强调教学合理性，不声称工程设计尺寸。设备使用共享材质和 InstancedMesh 控制 draw call。

## 8. 任务与巡检点

```ts
interface InspectionPoint {
  id: string;
  name: string;
  equipmentType: string;
  position: Vector3Like;
  recommendedDistance: Range;
  recommendedAltitude: Range;
  cameraYaw: Range;
  cameraPitch: Range;
  requiredPhoto: boolean;
  defect: DefectDefinition | null;
  riskLevel: 'low' | 'medium' | 'high';
}
```

飞近目标只进入 `discovered`，不会自动完成。目标完成必须同时满足定位、距离、高度、云台角度和合格照片要求。任务模式为自由训练、指定巡检和考核。考核模式隐藏缺陷提示和目标辅助高亮。

## 9. 航线规划

学生可在俯视规划图点击建立 WP1、WP2 等航点。每个航点保存位置、高度、速度、等待时间、云台角度和是否拍照。

V1 的路线验证检查：高度边界、禁飞区、障碍包围体、安全距离和相邻航点可达性。航线剖面图以累计航程为 X、高度为 Y。任务飞行按航点顺序调用 `goto()`，可暂停、继续和 RTL。

V1 不实现动态 A* 自动重规划；只保留 `RoutePlanner` 接口和直线段安全验证。后续版本可加入基于网格的 A*。

## 10. 云台、拍照与照片质量

主视图、FPV 和云台相机分别维护。云台支持 Yaw、Pitch 和离散 Zoom。拍照使用独立 WebGLRenderTarget，不改变主画面。

`PhotoValidator` 依据以下确定性数据评分：

- 目标包围盒是否投影到画面内。
- 投影面积占画面比例。
- 无遮挡可见比例。
- 飞机与目标距离。
- 高度是否在建议范围。
- 云台 Yaw/Pitch 误差。

保存内容包括时间、位置、高度、距离、Yaw、Pitch、目标 ID、PNG/WebP Blob、质量分数和失败原因。

## 11. 缺陷与热成像

V1 缺陷包括绝缘子破损、绝缘子缺片、导线异物、断股模拟、横担异常、连接金具异常、变压器异常和避雷器异常。视觉变化应局部、克制，并附着在确定设备节点。

学生对每个目标选择正常或疑似异常；异常时必须选择缺陷类型。教师可在开始前选择正常、指定缺陷或随机缺陷任务。

RGB/THERMAL 切换通过材质覆盖实现。热点仅表示模拟异常位置，不显示伪造的真实摄氏温度。热成像判定仍基于指定热点是否进入画面。

## 12. 安全机制

安全系统每帧检查：

- 飞机与导线线段的最近距离。
- 飞机与设备/铁塔包围体碰撞。
- 禁飞体积。
- 最低和最高高度。
- 场景边界。

距离导线小于 2 m 产生危险事件并持续扣分，但允许学生离开危险区继续。碰撞暂停当前任务、记录严重违规并提供“重置至安全点”和“重新尝试”，不关闭软件。

## 13. 评分

总分 100：飞行安全 25、巡检完成 25、照片质量 20、故障判断 20、操作效率 10。

扣分事件：碰撞 -30、危险距离 -5、漏检 -5、错误判断 -3、漏拍 -3。重复发生的连续危险只在离开后再次进入时新增一次，避免每帧无限扣分。

报告显示飞行安全、完成率、漏检数量、异常发现率、照片合格率、危险次数、飞行时间、总航程和总分。评分规则是纯函数并具有单元测试。

## 14. 会话与持久化

每次训练产生 `SessionRecord`：

- student、mission、startTime、endTime。
- flightPath（按固定频率采样）。
- inspectionPoints、photos、defects、violations、score。
- 教师复核状态与备注。

记录与图片保存在 IndexedDB，并以逻辑路径 `sessions/{sessionId}/session.json` 与 `sessions/{sessionId}/photos/` 组织。浏览器导出时生成同样目录结构的 ZIP 课程档案；也允许单独下载 `session.json` 或逐张下载照片。路径回放从已保存的 flightPath 生成，不重新计算飞行。刷新页面后可恢复未完成会话或开始新会话。

## 15. AI 扩展

```ts
interface InspectionAIAdapter {
  analyze(image: Blob): Promise<InspectionAIResult>;
}

interface InspectionAIResult {
  status: 'mock' | 'real' | 'unavailable';
  detections: Array<{ class: string; confidence: number; bbox: [number, number, number, number] }>;
}
```

V1 的 `MockInspectionAI` 只返回由任务定义驱动的明确模拟结果，UI 必须显示“教学模拟结果”。真实缺陷判定仍由学生完成。未来 YOLO 适配器不能改变任务或评分接口。

## 16. UI

默认进入实际训练台，不制作营销首页。顶部工具条提供场景、模式、教师设置和会话操作。

桌面布局：左上任务、中央 3D、右上云台、左下飞行状态、右下巡检清单、底部飞行控制。移动端改为全屏 3D 加可收合抽屉和触控摇杆，不把多个卡片嵌套。

教师模式只提供场景、难度、故障、开始/结束考试、成绩、照片和漏检项目。技术诊断收进折叠详情，不暴露 JSON 或内部 ID 作为主要界面。

## 17. 性能与错误处理

- 目标 1920x1080、普通教学笔电稳定 30 FPS。
- 渲染器限制 devicePixelRatio 上限。
- 场景延迟创建；切换时释放 geometry、material、texture 和 render target。
- 飞行更新使用固定时间步，渲染使用 requestAnimationFrame。
- 模型加载失败时使用程序化 F450 备用模型并显示非阻断提示。
- IndexedDB 写入失败时允许 JSON 下载，不能丢失当前内存会话。
- 控制器未连接、断线或校准失效均进入悬停，不产生随机输入。

## 18. 测试与验收

### 单元测试

- 输入归一化、死区、反向和通道映射。
- 飞行状态机与全部控制命令。
- 安全距离和碰撞。
- 巡检点状态机。
- 投影照片质量。
- 缺陷判断和评分。
- 会话序列化和恢复。

### 浏览器测试

- 三场景切换和资源释放。
- F450 显示、起飞、悬停、移动、升降、降落、RTL。
- Gamepad 模拟事件和断线悬停。
- 云台、Zoom、拍照和预览。
- 任务完成、缺陷选择、危险和碰撞。
- 报告生成、刷新恢复和路径回放。
- 1920x1080 与移动视口无重叠。
- WebGL canvas 非空、关键像素不全黑、控制台无 critical error。

Phase 1 的 TEST-01 至 TEST-20 必须逐项记录 PASS/FAIL。真实 RadioLink、EdgeTX 和 DJI 控制器另列真实设备验收，自动模拟不能替代。

## 19. 许可证与来源

- DroneCommander：MIT，可在保留版权和许可时参考或复用小段代码。
- powerline_inspection_simulation：Apache-2.0，只参考场景和任务概念；若复制任何代码/资产需保留版权、License 和 NOTICE。
- uav-path-planning-demo：MIT，只参考规划、安全和日志结构。
- ardupilot-wasm / ArduPilot：含 GPLv3 组件，V1 不复制或分发。
- Three.js、Vite、Vitest、Playwright 等依赖按锁文件版本记录于 `THIRD_PARTY_NOTICES.md`。
- 不从授权不明的网站下载模型、图片或代码。

## 20. 文件结构

```text
D:\FDE-Power-Inspection-Simulator
├─ public/models/f450/
├─ src/
│  ├─ app/
│  ├─ input/adapters/
│  ├─ flight/adapters/
│  ├─ drone/
│  ├─ scenes/
│  ├─ mission/
│  ├─ inspection/
│  ├─ camera/
│  ├─ safety/
│  ├─ scoring/
│  ├─ ai/
│  ├─ persistence/
│  ├─ reporting/
│  ├─ teacher/
│  └─ ui/
├─ tests/
├─ screenshots/
├─ docs/superpowers/specs/
├─ README.md
├─ ARCHITECTURE.md
├─ LICENSES.md
├─ THIRD_PARTY_NOTICES.md
├─ TEST_REPORT.md
└─ acceptance-report.md
```

## 21. 实施顺序

1. 工程、测试和离线壳。
2. 输入接口与校准。
3. 飞行控制器和程序化 F450 备用模型。
4. 现有 F450 GLB 验证与接入。
5. 三场景与安全几何。
6. 巡检点、云台、拍照和质量判定。
7. 缺陷、热成像和学生判断。
8. 航线规划和剖面图。
9. 评分、会话、回放和教师复核。
10. 20 项验收、截图、文档和性能收尾。

每一步先写失败测试，再实现最小功能，然后运行定向测试。不得把所有模块写完后一次性测试。
