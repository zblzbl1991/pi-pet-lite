# A2A Remote Agent Integration

## Goal

让 Clawd 宠物团队能通过 Google A2A（Agent-to-Agent）协议接入远程 agent，将其作为团队成员使用。Chief 可以像委派本地 specialist 一样，将任务委派给远程 agent，用户通过 Settings UI 管理远程 agent 连接。

## What I already know

### A2A 协议
- Google A2A 是开放协议，基于 JSON-RPC 2.0 over HTTP
- **AgentCard**: `/.well-known/agent-card.json` 描述 agent 的能力、技能、认证方式
- **Task 生命周期**: `submitted → working → completed / failed / canceled`
- **消息模式**: sendMessage() 返回 Task（异步）或 Message（直接响应）
- **JS SDK**: `@a2a-js/sdk` 提供 `ClientFactory.createFromUrl()` 创建客户端
- 支持 blocking 模式、SSE 流式响应、artifact（结果产物）

### 当前架构
- **PetProfile** 定义 agent 配置（id, name, role, systemPrompt, toolNames, llm 等）
- **PetManager** 管理多 agent 生命周期（max 3 concurrent, 15min idle timeout）
- **delegate_task** 工具：Chief 通过 `pm.delegate(role, prompt)` 委派任务给 specialist
- 本地 specialist 是 ephemerl 的（任务完成后立即销毁）
- **TaskQueue**: FIFO, max depth 5, 5min timeout, 1 retry
- **Settings UI** ProfilesSection 已支持添加自定义 profile（role=custom）
- Profile 通过 `clawd-config.json` 持久化，运行时 merge built-in + user overrides

### 关键约束
- PetManager max concurrent = 3（含 Chief + 本地 specialists + 远程 agents）
- Chief 不能被禁用/删除
- delegate_task 验证 target_role 必须是已启用的 specialist profile
- 本地 specialist 任务完成后立即销毁

## Assumptions (temporary)

- 远程 agent 作为新的 `PetRole` 类型（如 `remote`）加入系统
- 远程 agent 不需要本地 LLM 调用——任务是发送到远程 server 执行的
- 远程 agent 的 "工具" 由远程 agent 自己管理，本地不需要知道
- A2A client 在 agent utility process 中运行（和 PetManager 同进程）
- 远程 agent 连接信息（URL、认证信息）存储在 PetProfile 的扩展字段中

## Open Questions

1. 远程 agent 的 profile 如何扩展？是在 PetProfile 上加 `a2a` 字段，还是新建 `RemoteAgentProfile` 类型？
2. 远程 agent 是否计入 PetManager 的 maxConcurrent=3 限制？
3. 远程 agent 失败/超时时的重试策略？
4. 认证方案：哪些认证方式需要支持？（API Key, OAuth, None）
5. 是否需要支持 A2A 的流式（SSE）响应？
6. 远程 agent 在 PetWindow 中如何展示？（是否有独立的宠物窗口？）

## Requirements (evolving)

### 核心需求
- 用户可以在 Settings > Profiles 中添加远程 agent
- 添加时输入远程 agent 的 base URL
- 系统自动拉取 AgentCard 获取 agent 信息
- 远程 agent 作为 team member 出现在 Chief 的 specialist 列表中
- Chief 可以通过 delegate_task 将任务委派给远程 agent
- 远程 agent 的执行结果返回给 Chief，流程和本地 specialist 一致

### UI 需求
- Settings Profiles 页面增加 "Add Remote Agent" 按钮
- 远程 agent 配置表单：URL、名称、认证信息
- AgentCard 信息预览（名称、描述、能力标签）
- 远程 agent 状态指示（在线/离线/错误）

## Acceptance Criteria (evolving)

- [ ] 能通过 Settings UI 添加远程 agent（输入 URL → 拉取 AgentCard → 保存配置）
- [ ] 远程 agent 出现在 Chief 的可委派 specialist 列表中
- [ ] Chief delegate_task 可以委派任务给远程 agent
- [ ] 远程 agent 执行结果正确返回给 Chief
- [ ] 远程 agent 在 PetWindow 中有对应的展示
- [ ] 断网/远程 agent 不可用时有合理的错误处理

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- 断网和超时场景已处理

## Out of Scope (explicit)

- 暂不实现 Clawd 自身作为 A2A server（只做 client）
- 暂不支持流式 SSE 响应（MVP 用 blocking 模式）
- 暂不支持 A2A push notification
- 暂不支持远程 agent 的文件上传/下载
- 暂不实现 OAuth 认证流程（MVP 只支持 API Key 或无认证）

## Technical Notes

### 关键文件
- `src/shared/types.ts` — PetProfile, PetRole 类型定义
- `src/agent/profiles.ts` — Profile 定义和 merge 逻辑
- `src/agent/pet-manager.ts` — Agent 生命周期管理
- `src/agent/runtime.ts` — Agent runtime 创建
- `src/agent/tools/delegate.ts` — delegate_task 工具
- `src/agent/task-queue.ts` — 任务队列
- `src/renderer/settings/SettingsWindow.tsx` — Settings UI
- `src/config/config-store.ts` — 配置持久化

### A2A JS SDK
- Package: `@a2a-js/sdk`
- `ClientFactory.createFromUrl(baseUrl)` → 自动拉取 AgentCard → 返回 client
- `client.sendMessage({ message, configuration })` → `Message | Task`
- Task states: submitted, working, completed, failed, canceled
- Task 有 `artifacts` 字段存放结果

### 实现方向
- 新增 `PetRole = 'remote'`
- 扩展 `PetProfile` 添加 `a2a?: { url, apiKey?, agentCard? }` 字段
- 在 PetManager 中，对 `role === 'remote'` 的 profile 创建 `RemoteAgentRuntime`（实现 AgentRuntime 接口，内部用 A2A client）
- delegate_task 无需修改——它只调 `pm.delegate(role, prompt)`，PetManager 根据角色类型分发
