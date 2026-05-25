# P1.1 Agent Backend 抽象层

## Goal

将 `runtime.ts` 对 `pi-agent-core` 的直接依赖抽象为 `AgentBackend` 接口，使得 Agent Runtime 可以在不改动上层代码的前提下切换底层引擎（pi-agent-core / LangChain / 自定义实现）。这是所有后续 P1/P2 能力的架构基础。

## Background

当前 `createAgentRuntime()` 直接 `new core.Agent()` 并绑定 `pi-agent-core` 的类型系统（`PiAgentEvent`、`PiAssistantMessage` 等）。这意味着：
- 切换 LLM 推理框架需要改动 runtime.ts 的每一行
- 无法在同一应用中同时使用不同引擎
- 无法为特定 profile 指定不同的后端

## Requirements

### R1: AgentBackend 接口定义
- 定义 `AgentBackend` interface，包含以下方法：
  - `prompt(text: string): Promise<string>` — 发送消息并返回最终文本
  - `abort(): void` — 中断当前运行
  - `dispose(): void` — 清理资源
  - `subscribe(handler: (event: BackendEvent) => void): () => void` — 订阅事件，返回取消函数
  - `get state(): BackendState` — 获取当前状态（messages、isStreaming 等）
  - `set state(value: BackendState)` — 设置状态（用于 session 恢复）

### R2: BackendEvent 统一事件格式
- 定义引擎无关的事件类型：
  - `start` / `end` — agent 生命周期
  - `message_start` / `message_delta` / `message_end` — 消息流
  - `tool_start` / `tool_update` / `tool_end` — 工具执行
  - `error` — 错误
- 现有 pi-agent-core 事件映射到这个统一格式

### R3: PiAgentBackend 实现
- 将现有 `createAgentRuntime` 中的 `new core.Agent()` 逻辑封装到 `PiAgentBackend` 类中
- 该类实现 `AgentBackend` 接口，内部处理 `PiAgentEvent` → `BackendEvent` 的转换
- 成为默认 backend

### R4: Backend 工厂
- `createBackend(type: string, config: BackendConfig): AgentBackend`
- PetProfile 中新增可选 `backend` 字段（默认 `'pi-agent-core'`）
- PetManager 的 `ensureAgent` 根据 profile.backend 选择 backend

### R5: 现有功能不回归
- 所有现有 agent 功能必须完全不受影响
- EventBus、SessionStore、Tracer 的集成点不变
- 只是多了一层抽象，原有 `PiAgentBackend` 行为 100% 一致

## Technical Approach

### 文件变更

1. **新增** `src/agent/backends/types.ts` — AgentBackend 接口、BackendEvent、BackendState 类型定义
2. **新增** `src/agent/backends/pi-agent-backend.ts` — PiAgentBackend 实现（从 runtime.ts 抽取）
3. **新增** `src/agent/backends/factory.ts` — createBackend 工厂函数
4. **修改** `src/agent/runtime.ts` — 委托给 backend，自身变为薄包装层
5. **修改** `src/agent/pet-manager.ts` — 使用工厂创建 backend
6. **修改** `src/shared/types.ts` — PetProfile 增加 backend 字段

### AgentBackend 接口草案

```typescript
interface AgentBackend {
  prompt(text: string): Promise<string>;
  abort(): void;
  dispose(): void;
  subscribe(handler: (event: BackendEvent) => void): () => void;
  readonly state: { messages: unknown[]; isStreaming: boolean };
  setMessages(messages: unknown[]): void;  // for session restore
}
```

## Decision (ADR-lite)

### D1: 抽象层级
**Context**: 可以在 Agent 类级别抽象，也可以在更高层的 AgentRuntime 级别抽象。
**Decision**: 在 Agent 类级别抽象（AgentBackend），因为 AgentRuntime 已经包含了 tool registry、trust policy、SessionStore 集成等上层逻辑，这些不应随引擎变化。
**Consequences**: 切换引擎只需要实现新的 AgentBackend，tool 注册、确认机制、session 持久化全部复用。

### D2: 事件格式转换位置
**Context**: BackendEvent 应该由 backend 自己发出，还是由 runtime 包装？
**Decision**: 由 backend 自己发出统一格式的 BackendEvent。PiAgentBackend 内部做 PiAgentEvent → BackendEvent 的转换。
**Consequences**: 每个 backend 实现负责事件标准化，runtime 不需要知道底层事件格式。

## Verification

1. TypeScript 编译零错误
2. 启动应用，发送消息，对话流程完全不变
3. Session 恢复功能正常（关闭重开后历史消息保留）
4. EventBus 事件正常触发
5. Tracer trace/span 正确记录
6. PetProfile 不指定 backend 时默认使用 PiAgentBackend
