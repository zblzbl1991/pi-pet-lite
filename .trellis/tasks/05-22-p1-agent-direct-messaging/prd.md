# P1.3 Agent 间直连通信

## Goal

让 agent 之间可以不经过 Chief 中转直接发送消息，提升多 agent 协作的效率和灵活性。

## Background

当前所有 agent 间通信都通过 Chief 的 `delegate_task` 工具 + Blackboard KV 存储。这意味着：
- Coder 无法直接向 Scout 请求信息，必须经 Chief 中转
- Blackboard 是被动存储，agent 需要主动轮询
- 无法实现"Scout 完成后自动通知 Analyst"的推送模式

## Requirements

### R1: AgentChannel 原语
- 定义 `AgentChannel` 接口，支持 agent 间直接通信
- 每个通道绑定一对 (senderPetId, receiverPetId)
- 消息格式：`{ type: string, payload: unknown, timestamp: number }`
- 支持请求-响应模式（发送后等待回复）和通知模式（发后即忘）

### R2: 基于 EventBus 的消息路由
- 新增 EventBus 事件 `agent:message`
- PetManager 维护路由表：哪个 petId 在线、可接收消息
- 消息路由：sender → PetManager → target agent 的 EventBus → agent 接收

### R3: Agent 收件箱
- 每个 ManagedPet 增加收件箱 `inbox: AgentMessage[]`
- agent 执行过程中可以检查 `inbox`
- 新增 `check_inbox` 工具，LLM 可以主动查看收件箱
- 新增 system prompt 注入："你有来自 {sender} 的新消息"

### R4: Blackboard Watcher + 通知
- 扩展 P1.2 的 Blackboard watcher，支持 agent 级别的通知
- 当 watcher key 变化时，除了创建任务，还可以发送通知到指定 agent 的 inbox
- 用例：Scout 写入 blackboard → 自动通知 Analyst "研究数据已就绪"

### R5: 安全边界
- Agent 只能发送消息给在线的 pet
- 消息大小限制（避免大文件传输，应使用 Blackboard）
- 不支持远程 agent 间直连（A2A agent 只能通过 Chief 中转）

## Technical Approach

### 文件变更

1. **新增** `src/agent/agent-channel.ts` — AgentChannel 实现
2. **修改** `src/agent/event-bus.ts` — 新增 `AGENT_MESSAGE` 事件常量
3. **修改** `src/agent/pet-manager.ts` — 路由消息、维护 inbox
4. **修改** `src/agent/tools/registry.ts` — 新增 `check_inbox` 和 `send_message` 工具
5. **修改** `src/agent/runtime.ts` — system prompt 注入 inbox 通知

### 消息流

```
Coder (LLM decides to ask Scout):
  → 调用 send_message tool { to: "scout", type: "question", payload: "..." }
  → PetManager.routeMessage(coder, scout, msg)
  → Scout 的 inbox.push(msg)
  → Scout 的 system prompt 注入 "你有来自 coder 的消息"
  → Scout 下一次 prompt 时自动看到消息
  → Scout 调用 send_message { to: "coder", type: "answer", payload: "..." }
  → Coder 的 inbox.push(msg)
```

## Decision (ADR-lite)

### D1: 消息传递模型
**Context**: 同步 RPC 还是异步消息？
**Decision**: 异步消息。发送方不等接收方处理。
**Consequences**: 不会阻塞发送方的 agent loop。如果需要请求-响应模式，接收方通过 send_message 回复。

### D2: 消息持久化
**Context**: inbox 消息是否持久化到 SQLite？
**Decision**: 初版不持久化，纯内存。Agent dispose 后消息丢失。
**Consequences**: 简单。如果需要跨 dispose 恢复，可以在后续迭代中持久化到 session_store。

## Verification

1. Coder 可以通过 `send_message` 工具向 Scout 发送消息
2. Scout 的 system prompt 中出现"你有来自 coder 的消息"
3. Scout 通过 `check_inbox` 查看消息内容
4. 消息在目标 pet 离线时被拒绝（发送方收到错误提示）
5. 消息大小超限时被拒绝
