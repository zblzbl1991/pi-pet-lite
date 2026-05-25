# P1.2 任务调度升级

## Goal

将 TaskQueue 从简单 FIFO 升级为支持优先级、依赖关系、条件触发的调度器，使 Agent Runtime 能处理更复杂的多 agent 协作场景。

## Background

当前 `TaskQueue` 是纯 FIFO 队列（最大深度 5），所有任务平等对待。这意味着：
- 用户即时输入和后台定时任务同等优先级
- 无法表达"任务 B 必须等任务 A 完成后才能执行"
- 无法基于 Blackboard 状态变化触发新任务

## Requirements

### R1: 优先级调度
- 定义任务优先级：`critical` > `user` > `scheduled` > `background`
- `critical`: 用户直接输入的消息
- `user`: 用户发起的非即时操作（如 session export）
- `scheduled`: cron 定时任务
- `background`: 后台维护任务（prune、sync）
- 高优先级任务可以抢占低优先级队列位置

### R2: 任务依赖
- 任务可以声明 `dependsOn: string[]`（依赖的任务 ID 列表）
- 调度器自动检测依赖满足后执行
- 依赖任务失败时，当前任务可以选择 `skip` 或 `retry`
- 超时机制：依赖等待超过 N 秒后自动解除

### R3: 条件触发（Blackboard Watch）
- 注册 watcher：`watchBlackboard(namespace, key, callback)`
- 当 Blackboard 中指定 key 的值变化时，自动创建新任务
- 用例：Scout 写入 `research:topic-X:status = "done"` → 自动触发 Analyst 的总结任务
- 支持一次性和持久化 watcher

### R4: 调度器接口
```typescript
interface TaskScheduler {
  enqueue(task: ScheduledTask): TaskHandle;
  cancel(taskId: string): void;
  getStatus(taskId: string): TaskStatus;
  listPending(): ScheduledTask[];
  watchBlackboard(namespace: string, key: string, handler: WatchHandler): () => void;
}

interface ScheduledTask {
  id: string;
  petId: string;
  prompt: string;
  priority: TaskPriority;
  dependsOn?: string[];
  timeout?: number;
  metadata?: Record<string, unknown>;
}
```

### R5: 向后兼容
- PetManager 的 `delegate()` 方法保持现有签名不变
- 内部迁移到新调度器
- 默认优先级为 `user`

## Technical Approach

### 文件变更

1. **新增** `src/agent/task-scheduler.ts` — 替代 task-queue.ts 的新调度器
2. **修改** `src/agent/pet-manager.ts` — 使用 TaskScheduler 替换 TaskQueue
3. **修改** `src/storage/blackboard.ts` — 新增 watcher 通知机制
4. **修改** `src/agent/tools/scheduler.ts` — cron 任务使用 `scheduled` 优先级

### 调度器核心逻辑

```
enqueue(task) →
  检查 dependsOn →
    全部完成？→ 加入就绪队列（按优先级排序）
    有未完成？→ 加入等待队列
  检查优先级 →
    就绪队列头部优先级 > 当前执行中？→ 可选抢占
  执行 →
    完成后检查等待队列中是否有任务被解锁

blackboard.set() →
  检查 watchers →
    匹配 key？→ 创建新 ScheduledTask（priority: background）
```

## Decision (ADR-lite)

### D1: 抢占策略
**Context**: 高优先级任务到达时，是否中断正在执行的低优先级任务？
**Decision**: 不抢占。高优先级插入队列头部，当前任务完成后立即执行下一个高优先级任务。
**Consequences**: 简化实现，避免中断导致的状态不一致。对于桌面场景（并发量低），延迟可接受。

### D2: 依赖粒度
**Context**: 任务依赖是 task 级别还是 agent 级别？
**Decision**: task 级别。每个 enqueued task 有唯一 ID，依赖声明引用的是 task ID。
**Consequences**: 更灵活，支持跨 agent 的任务依赖链。

## Verification

1. 用户消息总是优先于定时任务执行
2. dependsOn 任务按正确顺序执行
3. Blackboard watcher 在 key 变化时触发回调
4. 队列满时按优先级淘汰（低优先级被丢弃）
5. 原有 delegate() 功能不受影响
