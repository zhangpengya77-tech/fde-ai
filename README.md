# FDE Power Inspection Simulator

FDE 无人机电力巡检数字孪生训练系统是一个本地优先的浏览器教学模拟器。Phase 1 先完成一架 F450、一个输电线路场景和一次可评分巡检任务的闭环。

## 开发环境

```powershell
npm install
npm run dev
```

默认地址：`http://127.0.0.1:4173`

## 验证

```powershell
npm test
npm run test:browser
npm run build
```

当前阶段：P1-1 项目骨架。飞行、遥控器、巡检任务和评分将按实施计划逐阶段接入。

设计规格：`docs/superpowers/specs/2026-10-16-power-inspection-simulator-v1-design.md`

实施计划：`docs/superpowers/plans/2026-10-16-phase-1-mvp.md`
