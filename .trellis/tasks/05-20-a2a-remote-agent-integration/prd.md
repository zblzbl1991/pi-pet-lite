# A2A Remote Agent Integration

## Goal

让 Clawd 宠物团队能通过 Google A2A（Agent-to-Agent）协议接入远程 agent，将其作为团队成员使用。Chief 可以像委派本地 specialist 一样，将任务委派给远程 agent，用户通过 Settings UI 管理远程 agent 连接。

## Requirements

### 核心功能
1. **远程 agent 注册**: 用户通过 Settings > Profiles 添加远程 agent，输入 URL → 自动拉取 AgentCard → 预览信息 → 保存
2. **团队整合**: 远程 agent 作为 team member 出现在 Chief 的 specialist 列表中（标注 `remote`），Chief 可通过 `delegate_task` 委派任务
3. **执行与返回**: 远程 agent 执行结果通过 A2A 协议返回，只提取 text parts，流程对 Chief 和本地 specialist 一致
4. **宠物展示**: 远程 agent 有完整的 PetWindow 展示（cyan 色 + 默认 clawd GIF）
5. **错误处理**: 网络不可达、超时、远程 agent 返回异常时有明确错误信息
6. **超时**: 默认 3 分钟（可配置），快速到中等时长场景（1-5 分钟）
7. **取消**: AbortController 中断本地 HTTP 等待，不通知远程 agent

### UI 需求
- Settings Profiles 页面增加 "Add Remote Agent" 按钮（区别于 "Add Custom Profile"）
- 添加流程：输入 URL → fetch AgentCard（必须成功）→ 展示预览（名称、描述、能力标签）→ 填写 API Key（可选）→ 保存
- 远程 agent 卡片显示连接状态指示器（在线/离线/错误）
- 远程 agent 可编辑（名称、URL、API Key、超时时间）
- 远程 agent 可删除
- AgentCard 手动 Refresh 按钮（用户触发刷新缓存）

### 认证
- 支持 None（无认证，公开 agent）
- 支持 API Key / Bearer Token（明文存储在 clawd-config.json，和现有 LLM API Key 一致）

## Decision (ADR-lite)

### D1: Profile 类型设计
**Context**: 远程 agent 需要存储 A2A 连接信息（URL、API Key、AgentCard），需要决定数据模型方案。
**Decision**: 在现有 `PetProfile` 上新增 `a2a` 可选字段，新增 `PetRole = 'remote'`。
**Consequences**: PetManager 和 delegate_task 几乎不需要改动，通过 `profile.a2a` 的有无来判断是否为远程 agent。

### D2: 并发限制
**Context**: PetManager 当前 maxConcurrent=3，远程 agent 是否计入此限制。
**Decision**: 远程 agent 和本地 specialist 共享 3 个 slot。
**Consequences**: 简单一致，避免远程 agent 占满后本地 specialist 无法启动。必要时可通过 LRU eviction 释放空闲 agent。

### D3: 超时策略
**Context**: 本地 delegation 超时 5 分钟，远程 agent 经过网络可能需要更长时间。
**Decision**: 默认超时 3 分钟（可配置 `a2a.timeoutMs`），定位为快速到中等时长场景（1-5 分钟）。
**Consequences**: 超时即失败，不等待。用户可根据远程 agent 的实际情况调整。

### D4: 宠物展示
**Context**: 远程 agent 是否在桌面展示宠物窗口。
**Decision**: 完整的 PetWindow 展示，使用 cyan 色（`#06b6d4`）标识远程身份，默认 clawd GIF（用户可通过 profile.gifPrefix 覆盖）。
**Consequences**: 远程 agent 和本地 agent 视觉体验一致，cyan 色一眼区分远程 vs 本地。

### D5: 认证方式
**Context**: MVP 阶段支持哪些 A2A 认证方式。
**Decision**: 支持 None + API Key（Bearer Token），明文存储。
**Consequences**: 和现有 LLM API Key 存储方式一致。OAuth 留待未来扩展。

### D6: Chief 感知远程 agent
**Context**: 用户添加远程 agent 后 Chief 如何知道。
**Decision**: Settings 保存后 dispose 并重建 Chief runtime。Chief 的 specialist 列表中远程 agent 标注 `(remote)` 标签。
**Consequences**: Chief 知道哪些是远程 agent，可以做更智能的委派决策（如本地文件操作不发给远程）。代价是 Chief 重建丢失当前上下文，但 Chief 本身是无状态的。

### D7: 响应转换
**Context**: A2A 响应是结构化的（Message.parts / Task.artifacts），delegate_task 期望纯文本。
**Decision**: 只提取 `kind: 'text'` 的 parts 拼接成字符串返回。忽略 file/data parts。
**Consequences**: 和本地 agent 行为完全一致。

### D8: 取消机制
**Context**: 用户中途取消远程 agent 任务。
**Decision**: AbortController 中断本地 HTTP 等待，不通知远程 agent 停止。
**Consequences**: 远程 agent 可能继续执行，但 Clawd 不再等待结果。

### D9: AgentCard 管理
**Context**: AgentCard 缓存可能过时。
**Decision**: 添加时必须拉取成功才能保存；缓存后通过 Settings UI 的手动 Refresh 按钮刷新。
**Consequences**: 简单可控，用户主动权最大。

## Technical Approach

### 类型扩展

```typescript
// PetRole 新增
type PetRole = 'chief' | 'coder' | 'scout' | 'analyst' | 'custom' | 'remote';

// PetProfile 新增字段
interface PetProfile {
  // ... 现有字段不变
  a2a?: {
    url: string;           // 远程 agent base URL
    apiKey?: string;       // Bearer token / API key（明文存储）
    agentCard?: AgentCard; // 缓存的 AgentCard 信息
    timeoutMs?: number;    // 超时时间，默认 180000 (3 min)
  };
}
```

远程 agent 的 `systemPrompt` 留空（远程 agent 自带 prompt），`toolNames: []`（远程 agent 自管理工具）。

### RemoteAgentRuntime

新建 `src/agent/remote-runtime.ts`，实现 `AgentRuntime` 接口：

```typescript
class RemoteAgentRuntime implements AgentRuntime {
  private client: A2AClient;
  private abortController: AbortController | null = null;

  constructor(profile: PetProfile, onEvent: EventCallback) { ... }

  async prompt(text: string): Promise<string> {
    // 1. 创建 AbortController
    // 2. client.sendMessage({ message: text parts }, { blocking: true })
    // 3. 提取 text parts 拼接返回
    // 4. Task.failed → 抛错，Task.canceled → 抛错
    // 5. 超时由外层 PetManager delegate_task 的 withTimeout 处理
  }

  abort() {
    // AbortController.abort() 中断 HTTP 请求
  }

  setConfirmationHandler() { /* no-op, 远程 agent 不需要本地确认 */ }
  dispose() { this.client = null; }
}
```

### PetManager 修改

在 `ensureAgent()` 中增加分支：
- `profile.a2a` 存在 → 创建 `RemoteAgentRuntime`
- 否则 → 走现有 `createAgentRuntime()` 逻辑

其余逻辑（delegate、task queue、LRU eviction、status report）完全复用。

### delegate_task 修改

无需修改。`delegate_task` 只调 `pm.delegate(target_role, prompt)`，PetManager 内部自动分发。

### profiles.ts 修改

- `getEnabledSpecialistProfiles()` 已自动包含 `role=remote` 的 profiles
- Chief 的 specialist 列表注入需要格式化远程 agent 描述：
  - 本地: `"coder (Code writing, editing, file operations)"`
  - 远程: `"WeatherBot (remote) - Weather forecast and climate data"`

### Settings UI 修改

在 ProfilesSection 中：
- 新增 "Add Remote Agent" 按钮
- 添加流程：URL 输入 → "Connect" 按钮 → fetch AgentCard → 预览 → API Key（可选）→ 保存
- AgentCard 必须成功才能保存（失败显示错误信息）
- 远程 agent 卡片用 cyan 色标识
- 手动 Refresh 按钮（重新拉取 AgentCard）
- 远程 agent 可编辑 URL、API Key、Timeout
- 远程 agent 可删除（和 custom profile 一样）
- 保存后触发 Chief runtime 重建

### Chief runtime 重建机制

Settings 保存 profiles 后：
1. Main process 收到 profiles 更新
2. 通过 MessagePort 通知 agent process
3. Agent process 调用 `petManager.dispose('chief')`
4. 下次用户消息进来时 `petManager.delegate('chief', prompt)` 自动重建

### 新增文件
- `src/agent/remote-runtime.ts` — RemoteAgentRuntime 实现

### 修改文件
- `src/shared/types.ts` — PetRole 新增 'remote'，PetProfile 新增 a2a 字段
- `src/agent/pet-manager.ts` — ensureAgent() 增加 remote 分支
- `src/agent/profiles.ts` — specialist 列表注入格式支持 (remote) 标签
- `src/agent/runtime.ts` — Chief 重建触发机制
- `src/renderer/settings/SettingsWindow.tsx` — 远程 agent UI（添加/编辑/删除/refresh）
- `src/main/pet-window-manager.ts` — 角色颜色映射新增 remote=cyan
- `src/shared/constants.ts` — 新增 REMOTE_DEFAULT_TIMEOUT_MS = 180000

## Acceptance Criteria

- [ ] 能通过 Settings UI 添加远程 agent（输入 URL → 拉取 AgentCard → 预览 → 保存配置）
- [ ] AgentCard 拉取失败时阻止保存并显示错误信息
- [ ] 远程 agent 出现在 Chief 的可委派 specialist 列表中（带 remote 标签）
- [ ] 保存远程 agent 后 Chief runtime 自动重建
- [ ] Chief `delegate_task` 可以委派任务给远程 agent，text 结果正确返回
- [ ] 远程 agent 在 PetWindow 中有 cyan 色宠物动画展示
- [ ] 远程 agent 状态变化正确反映（idle → busy → idle/error）
- [ ] 网络不可达时返回明确错误信息，不崩溃
- [ ] 3 分钟超时后正确取消并返回错误
- [ ] 用户中途取消时 HTTP 请求被中断
- [ ] 远程 agent 可删除，删除后不再出现在 specialist 列表中
- [ ] API Key 正确附加到 A2A 请求头
- [ ] 手动 Refresh 可更新 AgentCard 缓存
- [ ] typecheck 通过，无类型错误
- [ ] 不破坏现有本地 agent 委派流程

## Definition of Done

- 新增 RemoteAgentRuntime 有单元测试
- Settings UI 远程 agent 添加/编辑/删除流程完整
- typecheck / lint 通过
- 断网、超时、无效 URL 等错误场景已处理
- 不破坏现有本地 agent 委派流程

## Out of Scope

- Clawd 自身作为 A2A server（只做 client）
- 流式 SSE 响应（MVP 用 blocking 模式）
- A2A push notification
- 远程 agent 文件上传/下载
- OAuth 认证流程
- 远程 agent 的工具发现和使用（远程 agent 自管理工具）
- 多轮对话上下文保持（MVP 每次委派是独立的 sendMessage）
- AgentCard 自动定时刷新
- 远程 agent 健康检查 / 心跳

## Technical Notes

### 关键文件
- `src/shared/types.ts` — PetProfile, PetRole 类型定义
- `src/agent/profiles.ts` — Profile 定义和 merge 逻辑
- `src/agent/pet-manager.ts` — Agent 生命周期管理
- `src/agent/runtime.ts` — 本地 AgentRuntime 创建（参考实现）
- `src/agent/tools/delegate.ts` — delegate_task 工具
- `src/agent/task-queue.ts` — 任务队列
- `src/renderer/settings/SettingsWindow.tsx` — Settings UI
- `src/main/pet-window-manager.ts` — 宠物窗口管理
- `src/shared/constants.ts` — 常量定义

### A2A JS SDK
- Package: `@a2a-js/sdk`
- `ClientFactory.createFromUrl(baseUrl)` → 自动拉取 AgentCard → 返回 client
- `client.sendMessage({ message, configuration: { blocking: true } })` → `Message | Task`
- Task states: submitted, working, completed, failed, canceled
- Task.artifacts 包含执行结果
- 认证通过自定义 HTTP header 注入（Bearer token）
- 需要 AbortController 支持取消请求

### AgentCard 结构（参考）
```json
{
  "name": "Agent Name",
  "description": "What this agent does",
  "url": "https://...",
  "capabilities": { "streaming": false, "pushNotifications": false },
  "skills": [{ "id": "skill-1", "name": "Skill Name", "description": "..." }],
  "authentication": { "schemes": ["bearer"] }
}
```
