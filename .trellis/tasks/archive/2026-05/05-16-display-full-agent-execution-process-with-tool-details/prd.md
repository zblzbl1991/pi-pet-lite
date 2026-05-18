# Display Full Agent Execution Process with Tool Details

## Goal

让用户在 Chat 面板中完整看到 agent 的执行过程——包括工具调用参数、执行结果、思考过程、轮次进度等——使 agent 行为完全透明可控。

## Decisions (11 questions resolved)

| # | 问题 | 决定 |
|---|------|------|
| Q1 | 事件类型扩展 | A — 扩展现有 `tool-execution` 加可选字段 |
| Q2 | tool_result 气泡 | A — 删除独立气泡，结果只进工具卡片 |
| Q3 | thinking 显示位置 | A — 和 text 合并在同一个气泡 |
| Q4 | thinkingLevel | C — Settings 里加下拉框可配置 |
| Q5 | toolcall_delta | B — 不流式，`tool_execution_start` 时一次性显示 |
| Q6 | 折叠摘要 | C — 常用工具有硬编码摘要规则 + 通用 fallback |
| Q7 | 自动折叠 | A — 每个卡片独立折叠，完成 1.5s 后 |
| Q8 | 持久化 | A — 工具卡片数据存入 message buffer |
| Q9 | 数据模型 | B — `ChatEntry = ChatMessage | ToolCardEntry` 联合类型 |
| Q10 | thinking 存储 | C — `ChatMessage` 加 `thinking?: string` 独立字段 |
| Q11 | 错误卡片折叠 | B — 错误保持展开不自动折叠 |

## Requirements

* [R1] 工具调用卡片：工具名称 + 状态指示（running/done/error）+ 摘要
* [R2] 可折叠参数区（格式化显示，tool_execution_start 时填充）
* [R3] 可折叠结果区（支持长文本滚动，tool_execution_update 流式更新）
* [R4] 渐进式：运行中自动展开，done 后 1.5s 自动折叠；error 不折叠
* [R5] 折叠后显示摘要（混合策略：已知工具硬编码 + 通用 fallback）
* [R6] thinking 内容：`ChatMessage.thinking` 字段，渲染为淡色斜体块
* [R7] Turn 指示器：`turn_start/end` 触发，居中分隔线 + "Turn N"
* [R8] thinkingLevel 从 Settings 读取，写入 `LLMConfig.thinkingLevel`
* [R9] 工具卡片数据持久化到 message buffer（`ChatEntry` 联合类型）
* [R10] 手动点击卡片头部可覆盖自动折叠行为
* [R11] 现有流式文本、状态转换、确认请求不受影响

## Acceptance Criteria

* [ ] 每个工具调用显示名称、完整参数、执行结果
* [ ] 运行中自动展开，done 1.5s 后折叠为摘要，error 保持展开
* [ ] thinking 内容在 assistant 气泡内以淡色斜体显示
* [ ] Turn 轮次分隔线正确显示
* [ ] Chat 窗口重载后工具卡片通过 syncHistory 恢复
* [ ] Settings 里可配置 thinkingLevel（off/low/medium/high）
* [ ] 现有功能回归正常

## Definition of Done

* types.ts: 新增 `ChatEntry`, `ToolCardEntry`, 扩展 `ChatMessage`, `AgentToRendererMessage`, `LLMConfig`
* runtime.ts: 转发 thinking_delta, tool_execution_update, turn_start/end；args/result/partialResult
* ChatPanel.tsx: 渲染 ToolCardEntry 卡片（渐进式）+ thinking 块 + Turn 指示器
* SettingsWindow.tsx: 新增 Thinking Level 下拉框
* config-store.ts: 默认 thinkingLevel='low'
* main.ts: message buffer 支持 ChatEntry，syncHistory 返回 ChatEntry[]
* 手动验证通过

## Out of Scope

* 不修改 pi-agent-core 或 pi-ai 上游包
* 不改变事件总线架构（MessagePort + IPC）
* 不添加新的 agent 状态
* Pet 窗口 ChatBubble 不变

## Technical Approach

### 文件改动清单（6 files）

| 文件 | 改动 |
|------|------|
| `src/shared/types.ts` | +ToolCardEntry, +ChatEntry, 扩展 ChatMessage(+thinking), AgentToRendererMessage(+args/result/partialResult/duration/turn), LLMConfig(+thinkingLevel) |
| `src/agent/runtime.ts` | 转发 thinking_delta → chat-thinking; tool_execution_start 带 args; tool_execution_update 带 partialResult; tool_execution_end 带 result+duration; turn_start/end → turn-indicator; thinkingLevel 从 config 读取 |
| `src/renderer/chat/ChatPanel.tsx` | messages 改为 ChatEntry[]; 渲染 ToolCardEntry 组件（渐进式折叠）; thinking 块; Turn 分隔线; 摘要函数 getToolSummary() |
| `src/renderer/settings/SettingsWindow.tsx` | +Thinking Level 下拉框（off/low/medium/high）|
| `src/config/config-store.ts` | DEFAULT_CONFIG.llm 加 thinkingLevel: 'low' |
| `src/main/main.ts` | message buffer 类型改为 ChatEntry[]; broadcastToWindows 处理新事件; syncHistory 返回 ChatEntry[] |

### AgentToRendererMessage 扩展

```typescript
type AgentToRendererMessage =
  // ...existing types...
  | { type: 'tool-execution'; toolCallId: string; toolName: string;
      status: 'running' | 'done' | 'error';
      args?: Record<string, unknown>;      // running 时带
      partialResult?: string;               // update 时带
      result?: string;                      // done 时带
      duration?: number }                   // done 时带
  | { type: 'chat-thinking'; id: string; delta: string }
  | { type: 'turn-indicator'; turn: number; event: 'start' | 'end' }
```

### ChatEntry 数据模型

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: number;
  streaming?: boolean;
}

interface ToolCardEntry {
  type: 'tool-card';
  id: string;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: string;
  toolStatus: 'running' | 'done' | 'error';
  timestamp: number;
}

type ChatEntry = ChatMessage | ToolCardEntry;
```

### Tool Summary 规则

```typescript
function getToolSummary(toolName: string, args: any, result: string): string
// Glob: count lines → "N files found" / "No files found"
// Grep: count "N files, M matches"
// Read: extract filename → "Read filename.ts"
// Edit: extract filename → "Edited filename.ts"
// Write: extract filename → "Wrote filename.ts"
// Bash: "exit code 0" / "exit code 1"
// default: result.split('\n')[0].slice(0, 80)
```

### 预览

`preview-agent-execution.html` — 三种方案的交互式 HTML 对比
