# Hot-reload specialist list when profiles change

## Goal

当用户在 Settings 中添加/删除/修改 remote agent 配置后，Chief agent 能立即感知团队成员变化，无需重启应用。

## What I already know

* specialist 列表在 `createAgentRuntime()` 时注入 Chief 的 system prompt（`runtime.ts:179`）
* `delegate_task` 的 description 在模块加载时构建（`delegate.ts:144`），但 `getValidRoles()` 在每次 execute 时动态调用（`delegate.ts:120`）
* Settings 通过 IPC `settings:save-profiles` 保存 profiles，只写 config 文件，不通知 agent 进程
* agent 运行在 utility process，通过 `MessagePort` 与 main process 通信
* `PetManager.dispose(petId)` 可以安全销毁 agent，下次 `delegate()` 会自动通过 `ensure()` 重建

## Assumptions (temporary)

* 只需处理 Chief agent 的 system prompt 刷新即可（tool description 是次要的）
* dispose + lazy rebuild 足够，不需要热替换 system prompt
* Chief 正在执行任务时收到 profiles 更新，应等任务完成后再 dispose

## Open Questions

* (无阻塞问题 — 方案已明确)

## Requirements

* Settings 保存 profiles 后，通知 agent utility process
* Agent process 收到通知后，dispose Chief agent
* 下次用户发消息时，Chief 自动重建（`ensure()` 已有此逻辑），system prompt 包含最新 specialist 列表
* 如果 Chief 正在执行任务，延迟 dispose（等空闲后再刷新）

## Acceptance Criteria

* [ ] 添加新 remote agent 后，在 Chat 中问 Chief "团队有哪些成员"，能列出新增成员
* [ ] 删除 remote agent 后，Chief 不再列出已删除的成员
* [ ] Chief 正在执行长任务时收到 profiles 更新，任务不被中断
* [ ] Settings 保存 profiles 时，Chat 面板收到通知显示"团队配置已更新"

## Definition of Done

* 类型检查通过
* Lint 无新增错误
* 手动测试通过（添加/删除 remote agent 场景）

## Out of Scope

* `delegate_task` tool description 的实时刷新（per-invocation 的 role validation 已动态工作）
* 正在执行的 Chief 任务中途切换 specialist 列表
* 其他 agent（非 Chief）的 system prompt 刷新

## Technical Approach

### 消息流

```
Settings UI → IPC settings:save-profiles → main.ts
  → mainPort.postMessage({ type: 'profiles-updated' }) → agent-process.ts
  → PetManager.dispose(chiefId)  // Chief 空闲时立即 dispose
```

### 变更清单

1. **`shared/types.ts`** — `RendererToAgentMessage` 新增 `profiles-updated` 类型
2. **`main/main.ts`** — `settings:save-profiles` handler 中保存后发送 `profiles-updated` 到 agent port
3. **`agent/agent-process.ts`** — `handleRendererMessage` 处理 `profiles-updated`，dispose Chief

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/shared/types.ts` | `RendererToAgentMessage` 联合类型 |
| `src/main/main.ts:777` | `settings:save-profiles` IPC handler |
| `src/agent/agent-process.ts:252` | `handleRendererMessage` 消息分发 |
| `src/agent/pet-manager.ts:234` | `dispose()` 方法 |
| `src/agent/runtime.ts:178` | specialist list 注入 system prompt |

## Decision (ADR-lite)

**Context**: specialist 列表在 runtime 创建时固化，需要一种机制在 profiles 变更后刷新
**Decision**: 使用 dispose + lazy rebuild 策略，通过 MessagePort 发送 `profiles-updated` 消息
**Consequences**: 实现简单，但 Chief agent 会短暂 offline（ms 级），下次对话时自动重建
