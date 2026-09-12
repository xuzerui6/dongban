# 动伴 Motion Buddy Web Demo

把真实训练转化为动作评分、心率反馈、XP、成就和数字分身装备的可运行黑客松 Demo。

## 本地运行

```bash
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:5173/`。BLE 心率带需要 Chrome 或 Edge，并通过 HTTPS 或 localhost 访问。

## 已实现

- 首页、今日任务、连续训练、XP 与等级
- 摄像头 + MediaPipe Pose 浏览器端姿态识别
- 深蹲状态机、自动计数，以及由深度、膝稳定、躯干倾角和左右对称计算的动作评分
- Web Bluetooth 标准心率服务（0x180D / 0x2A37），支持 uint8/uint16 Measurement 与断连状态
- 所有 BPM、平均/最大心率与 Zone 数据仅由真实 BLE Notify 数据包驱动
- 统一 WorkoutSession：训练计时、动作指标、平均/最大心率及 Zone 1–5 停留秒数
- 训练结算使用真实 Session，并按 reps、动作质量和 Zone 3 时长计算 XP
- 首页每日任务从当天训练历史聚合，训练结束立即刷新
- 90+ 评分成就、精准训练手套解锁
- 角色装备、装备库、锁定条件与稀有度
- localStorage 本地持久化
- 390×844 手机画布及桌面投影展示布局

## 生产构建

```bash
pnpm build
pnpm preview
```

## 自测

```bash
pnpm run test:core
pnpm run build
```

核心测试覆盖 BLE Measurement flags、心率区间边界和 XP 公式。真实 BLE 连接必须在桌面 Chrome/Edge 的 HTTPS 或 localhost 页面中，由用户点击“连接心率带”并选择支持 Heart Rate Service 的设备。
