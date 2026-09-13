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
- 深蹲状态机、2 秒站姿校准、五帧中值平滑、角度迟滞和防重复计数
- 身体入镜、深度、膝盖轨迹、躯干前倾和左右对称五类实时矫姿
- 小智官方 WebSocket / 裸 Opus / STT / TTS / emotion / MCP 对话，失败时自动降级
- 用户授权后的低频 JPEG 关键帧复核；原始图片、音频和完整聊天不落盘
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

## 小智与 Vercel 配置

复制 `.env.example`，在 Vercel 项目中配置 `XIAOZHI_COOKIE_SECRET`，并保留 `VITE_XIAOZHI_ENABLED=true`。部署后到 Project Settings → Functions 开启 Fluid Compute。WebSocket 函数最长运行 300 秒，浏览器会按 1、2、4、8、15 秒退避重连；训练计数不依赖网络。

首次进入训练后，页面会显示六位激活码。登录 [xiaozhi.me](https://xiaozhi.me) 完成绑定即可。角色提示词见 [`docs/XIAOZHI_PERSONA.md`](docs/XIAOZHI_PERSONA.md)，第三方说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 自测

```bash
pnpm test
pnpm test:e2e
pnpm run build
```

核心测试覆盖 BLE Measurement flags、心率区间边界和 XP 公式。真实 BLE 连接必须在桌面 Chrome/Edge 的 HTTPS 或 localhost 页面中，由用户点击“连接心率带”并选择支持 Heart Rate Service 的设备。
