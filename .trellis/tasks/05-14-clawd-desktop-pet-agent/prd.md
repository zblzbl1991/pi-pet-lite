# Clawd Desktop Pet Agent

## Goal

构建一个以电子宠物（Clawd 猫形角色）为交互形态的桌面 AI Agent，常驻用户电脑，通过自然语言接收指令，帮助用户完成各类电脑操作任务——不限场景、不限用户类型。

## What I already know

* 项目基于 TypeScript，当前是空白项目（仅有 package.json + tsconfig.json + src/index.ts 占位）
* 参考 earendil-works/pi 项目（49k stars, MIT），其核心包：
  - `pi-ai`: 统一多供应商 LLM API
  - `pi-agent-core`: Agent 运行时（tool calling + 状态管理）
  - `pi-coding-agent`: 编码 agent CLI
* Clawd 宠物已有 9 个 GIF 动画，覆盖完整 agent 状态机：
  - idle（待机）、waving（打招呼）、running/running-left/running-right（执行中）
  - review（思考）、waiting（等待用户）、jumping（庆祝成功）、failed（失败）
* 用户需求：通用场景，不限预设，通过 LLM + Tool 动态组合完成任务
* 核心使用场景举例：定时生成周报、快速编写脚本/项目、浏览器自动化操作

## Assumptions (temporary)

* 桌面壳使用 Electron（跨平台 + 系统级 API 成熟）
* Agent 运行时复用/参考 pi-agent-core 的 tool calling 架构
* LLM 调用层复用/参考 pi-ai 的多供应商统一接口
* 浏览器自动化使用 Playwright
* 定时任务使用 node-cron 或类似库
* 宠物动画在 Electron BrowserWindow 中用 CSS/Canvas 渲染 GIF

## Decisions

* **与 pi 项目的关系**：引用依赖 — npm install pi-ai / pi-agent-core，在其之上构建应用层
* **交互形态**：桌面浮窗宠物 + 系统托盘双模式。宠物可直接拖拽交互，也可缩小到托盘。
* **目标平台**：仅 Windows，最快交付。
* **MVP 范围**：最小可用 — 宠物 UI + 自然语言输入 + 基础 Tool（文件/脚本/定时）+ 确认门。主动建议、工作流编辑、插件系统放后续。
* **安全策略**：可配置信任等级 — 用户可为每个 Tool 配置信任等级（自动执行 / 一次性确认 / 逐步确认）。

## Open Questions

（已全部解决）

## Requirements (evolving)

* [R1] 桌面宠物 UI — Electron 常驻，Clawd GIF 状态动画，支持拖拽
* [R2] 自然语言交互 — 用户输入指令，LLM 理解意图并分解任务
* [R3] Agent 运行时 — tool calling 架构，动态调度工具执行
* [R4] Tool 系统 — 可扩展的工具集（文件操作、浏览器、脚本执行、定时任务等）
* [R5] 定时任务 — 用户可设定时触发（如每周五生成周报）
* [R6] 状态映射 — agent 各阶段自动切换对应 Clawd 动画

## Acceptance Criteria (evolving)

* [ ] Electron 应用可启动，Clawd 宠物显示在桌面并可拖拽
* [ ] 用户可通过气泡/输入框发送自然语言指令
* [ ] Agent 可调用至少 3 个 Tool 完成实际任务
* [ ] Clawd 动画根据 agent 状态自动切换
* [ ] 定时任务可创建、执行、查看

## Definition of Done

* 核心功能有集成测试覆盖
* TypeScript strict mode，无 lint 错误
* Electron 打包可安装运行（至少 Windows）
* 安全边界文档化（agent 权限说明）

## Out of Scope (explicit)

* 多宠物/换装系统
* 语音交互
* 移动端
* 云端同步
* 主动建议（后台监听用户行为）
* 可视化工作流编辑器
* 插件/扩展系统
* 多设备同步

**注**：后续需求已保存到 `backlog.md`

## Technical Notes

* 当前项目：空白 TypeScript 项目，无依赖
* 参考：earendil-works/pi（GitHub, MIT, TypeScript monorepo）
* Clawd GIF 资源：`clawd-gifs/` 目录，9 个动画文件
* 宠物名称 "Clawd" = Claude + Claw，猫形角色

## Grill-me 决策记录

| # | 问题 | 决策 |
|---|------|------|
| 1 | pi-agent-core API 是否适用 | ✅ 确认适用，tool calling + hooks + event stream 完整 |
| 2 | GIF vs Sprite Sheet | MVP 用 GIF，后续按需转 sprite sheet |
| 3 | Playwright 体积问题 | CDP 连接用户已有 Chrome/Edge，不打包浏览器二进制 |
| 4 | 信任系统复杂度 | MVP 硬编码安全分级，不做设置 UI，推到 backlog |
| 5 | Agent 运行进程 | Utility Process（Electron 28+） |
| 6 | IPC 拓扑 | 渲染进程 ←MessagePort→ Utility Process 直连，主进程只管窗口 |
| 7 | 前端框架 | React + TypeScript（降低开发难度） |
| 8 | pi-ai v0.x 稳定性 | 接受风险，锁版本 |
| 9 | LLM 配置方式 | 配置文件存储，托盘菜单打开设置窗口 |

## Technical Approach

### 三进程架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Renderer 进程    │     │  Main 进程        │     │  Utility 进程    │
│  (宠物 UI)        │     │  (窗口管理)        │     │  (Agent 运行时)  │
│                   │     │                    │     │                  │
│  - GIF 动画       │     │  - BrowserWindow  │     │  - pi-agent-core │
│  - 聊天气泡       │     │  - 系统托盘        │     │  - pi-ai LLM     │
│  - 用户输入       │     │  - 屏幕坐标管理    │     │  - Tool 执行      │
│  - 状态展示       │     │  - 应用生命周期    │     │  - 事件流         │
│                   │     │                    │     │                  │
│       ←──── MessagePort 直连 ────→  ←──── MessagePort ────→        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**IPC 设计：渲染进程与 Utility Process 通过 MessagePort 直连通信**，主进程不转发 agent 消息，只负责窗口创建/销毁、托盘、屏幕坐标。

### 目录结构

```
src/
├── main/                   # Electron 主进程
│   ├── main.ts             # 入口，窗口管理
│   ├── tray.ts             # 系统托盘
│   └── windows.ts          # BrowserWindow 创建与配置
├── renderer/               # Electron 渲染进程（宠物 UI）
│   ├── pet/
│   │   ├── PetWindow.tsx   # 宠物浮窗（透明无边框）
│   │   ├── PetAnimator.tsx # GIF 状态切换
│   │   └── ChatBubble.tsx  # 聊天气泡/输入框
│   ├── settings/
│   │   └── SettingsWindow.tsx # LLM 配置设置窗口
│   ├── index.html
│   └── preload.ts          # contextBridge + MessagePort
├── agent/                  # Agent 核心层（Utility Process）
│   ├── agent-process.ts    # Utility Process 入口
│   ├── runtime.ts          # Agent 运行时（包装 pi-agent-core）
│   ├── llm.ts              # LLM 接口（包装 pi-ai）
│   ├── state-machine.ts    # Agent 状态 → Clawd 动画映射
│   └── tools/
│       ├── registry.ts     # Tool 注册中心
│       ├── file-system.ts  # 文件操作 Tool
│       ├── script-exec.ts  # 脚本执行 Tool
│       ├── browser.ts      # 浏览器自动化 Tool（Playwright CDP）
│       ├── scheduler.ts    # 定时任务 Tool（node-cron）
│       └── trust-policy.ts # 硬编码信任策略（MVP）
├── shared/
│   ├── types.ts            # 共享类型
│   ├── constants.ts        # 常量（状态枚举等）
│   └── ipc-channels.ts     # IPC 消息类型定义
└── config/
    └── config-store.ts     # 配置文件读写（LLM Key 等）
```

### 关键技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 桌面壳 | Electron 33+ | BrowserWindow 透明无边框模式 |
| 前端 | React + TypeScript | 渲染进程 UI |
| Agent 核心 | pi-agent-core | npm 依赖，tool calling |
| LLM | pi-ai | npm 依赖，多供应商统一接口 |
| 浏览器自动化 | Playwright CDP | 连接用户已有 Chrome/Edge，零体积膨胀 |
| 定时任务 | node-cron | 进程内 cron 调度 |
| 打包 | electron-builder | Windows NSIS 安装包 |
| IPC | Electron ipcMain/ipcRenderer | 主进程↔渲染进程通信 |

### Agent 状态 → Clawd 动画映射

```
AgentState.IDLE        → clawd-idle.gif
AgentState.GREETING    → clawd-waving.gif
AgentState.THINKING    → clawd-review.gif
AgentState.EXECUTING   → clawd-running.gif
AgentState.WAITING     → clawd-waiting.gif
AgentState.SUCCESS     → clawd-jumping.gif
AgentState.FAILED      → clawd-failed.gif
```

### 信任等级配置（MVP：硬编码）

```typescript
enum TrustLevel {
  AUTO = 'auto',           // 自动执行，无需确认
  CONFIRM_ONCE = 'once',   // 一次性确认整个任务
  CONFIRM_STEP = 'step',   // 逐步确认每个操作
}

// MVP: 硬编码的安全分级，不做 UI 和持久化
const TRUST_POLICY: Record<string, TrustLevel> = {
  read_file: TrustLevel.AUTO,
  list_directory: TrustLevel.AUTO,
  write_file: TrustLevel.CONFIRM_ONCE,
  run_script: TrustLevel.CONFIRM_ONCE,
  browser_action: TrustLevel.CONFIRM_STEP,
};
// 通过 pi-agent-core 的 beforeToolCall hook 实现
```

## Implementation Plan (分步 PR)

* **PR1**: Electron 脚手架 + 三进程架构 + 宠物浮窗（透明窗口 + GIF 渲染 + 拖拽）+ 系统托盘
* **PR2**: Agent 核心（Utility Process + pi-ai + pi-agent-core 集成）+ MessagePort IPC + 自然语言交互 UI
* **PR3**: 基础 Tool 实现（文件操作 + 脚本执行 + 定时任务）+ 硬编码信任策略
* **PR4**: 浏览器自动化 Tool（Playwright CDP 连接用户浏览器）
* **PR5**: LLM 配置设置窗口（托盘入口 + 配置文件存储）
* **PR6**: Windows 打包 + 安装程序 + 测试
