# P3.4 Trace 可视化调试 UI

## Goal

基于 Tracer 采集的 trace/span 数据，提供可视化调试界面，让开发者能看到每次用户请求的完整生命周期。

## Requirements

### R1: Trace 列表视图
- 按时间倒序显示所有 traces
- 每个 trace 显示：开始时间、耗时、状态（ok/error）、涉及的 agent、span 数量
- 支持按 session/pet/status 筛选

### R2: Trace 详情 - 时间线视图
- 瀑布图（类似 Chrome DevTools Network 面板）
- 每行一个 span，横向展示时间范围
- span 类型用颜色区分：llm.call（蓝）、tool.execute（绿）
- 点击 span 展开详情（attributes、duration）

### R3: Span 详情面板
- 显示 span 的所有 attributes（JSON 格式）
- 对于 tool span：显示工具名、参数、结果摘要、耗时
- 对于 llm.call span：显示 token 使用量（如有）、模型信息

### R4: 实时 Trace 流
- 连接 EventBus 的 trace 事件
- 新 trace 完成时自动追加到列表
- 当前活跃 trace 高亮

### R5: 集成位置
- Settings 窗口新增 "Traces" tab
- 或：独立 DevTools 窗口（快捷键 Ctrl+Shift+T）

## Technical Approach

- 前端使用 React + CSS Grid 实现瀑布图
- 数据源：agent-process 通过 MessagePort 暴露 trace 查询接口
- 现有 IPC 扩展：新增 `trace:list`、`trace:detail`、`trace:subscribe` channels
