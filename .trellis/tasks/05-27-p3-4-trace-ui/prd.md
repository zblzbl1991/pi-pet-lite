# P3.4 Trace 可视化调试 UI

## Goal

基于 Tracer 采集的 trace/span 数据，在 Settings 窗口新增 "Traces" tab，提供可视化调试界面。用户能浏览历史 trace、查看单条 trace 的瀑布图详情、实时接收新 trace 通知。

## Design Decisions

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 集成位置 | Settings 窗口新增 tab | 复用现有 tab 结构，避免多窗口复杂度 |
| 查询 API | Tracer 类直接加查询方法 | 数据量小，无需单独 Store |
| IPC 通道 | list + detail + subscribe | 全量功能 |
| 实时推送 | EventBus → webContents.send() | 复用现有架构 |
| 列表分页 | 无限滚动 | 调试场景最自然的浏览方式 |
| 瀑布图 | SVG 手写（JSX 内嵌） | 零依赖，span 数量少 |
| 布局 | 页面切换（列表 ↔ 详情） | 680×520 窗口空间有限 |
| 筛选 | status + pet | 覆盖主要调试场景 |
| 数据保留 | 7 天（不变） | 调试看近期数据即可 |

## Requirements

### R1: Tracer 查询 API（backend）

在 `src/agent/tracer.ts` 的 `Tracer` 类上新增：

- `listTraces(options: { offset, limit, status?, petId? }): { traces: Trace[], total: number }` — 分页列表，支持按 status 和 petId 筛选
- `getTraceDetail(traceId: string): { trace: Trace, spans: Span[] }` — 单条 trace 详情 + 所有关联 spans
- `endTrace()` 完成后通过 `eventBus.emit('trace:completed', { traceId, status })` 通知

### R2: IPC 通道（main → renderer）

在 `src/main/main.ts` 注册：

- `ipcMain.handle('trace:list', (_, options) => tracer.listTraces(options))` — 列表查询
- `ipcMain.handle('trace:detail', (_, traceId) => tracer.getTraceDetail(traceId))` — 详情查询
- 订阅 EventBus `trace:completed` 事件 → `settingsWindow.webContents.send('trace:completed', data)` — 实时推送

在 `src/preload/settings-preload.ts` 暴露：

- `traceList(options)` → `ipcRenderer.invoke('trace:list', options)`
- `traceDetail(traceId)` → `ipcRenderer.invoke('trace:detail', traceId)`
- `onTraceCompleted(callback)` → `ipcRenderer.on('trace:completed', callback)`
- `removeTraceCompletedListener(callback)` → `ipcRenderer.removeListener()`

### R3: Traces Tab — 列表页（renderer）

Settings 窗口新增 "Traces" tab，列表页包含：

- 筛选栏：status 下拉（all / ok / error）、pet 下拉（all + 已有 pet 列表）
- 列表区：每行显示 trace 的开始时间、耗时、状态图标、pet 名称、span 数量
- 无限滚动：滚动到底部时加载下一页（offset/limit）
- 实时更新：收到 `trace:completed` 事件时，新 trace 插入列表顶部
- 点击某条 trace → 切换到详情页

### R4: Traces Tab — 详情页（renderer）

详情页包含：

- 顶部面包屑：`< Back` 按钮 + trace ID + 状态 + 总耗时
- 瀑布图（SVG）：
  - 横轴为时间（相对于 trace 开始时间）
  - 每行一个 span，横向矩形表示时间范围
  - 颜色区分：`llm.call` 蓝色、`tool.execute` 绿色、其他灰色
  - hover 显示 tooltip（span name、耗时、精确时间）
- Span 详情面板：
  - 点击瀑布图中的 span，下方展示 attributes（JSON 格式化显示）
  - tool span：显示工具名、参数、结果摘要、耗时
  - llm.call span：显示模型信息（如有）

### R5: 样式

- 遵循项目设计系统（`.impeccable.md`）
- 深色主题，slate 底色
- 状态颜色：ok=green、error=red、running=amber
- 使用 CSS 变量，不硬编码颜色值
- 瀑布图颜色使用 role color 系统

## Change Scope

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/agent/tracer.ts` | 扩展 | 新增 listTraces, getTraceDetail, trace:completed 事件 |
| `src/main/main.ts` | 扩展 | 注册 3 个 IPC handlers + EventBus 转发 |
| `src/preload/settings-preload.ts` | 扩展 | 暴露 trace IPC 调用 |
| `src/renderer/settings/SettingsWindow.tsx` | 扩展 | 新增 Traces tab |
| `src/renderer/settings/` | 新增 | TracesTab 组件（列表页 + 详情页 + SVG 瀑布图） |

无外部依赖新增。无架构层变动。

## Out of Scope

- session 筛选、时间范围筛选（后续可加）
- 独立 DevTools 窗口（后续可拆）
- trace 搜索（按内容搜索）
- trace 导出功能
- 用户可配置的保留天数
