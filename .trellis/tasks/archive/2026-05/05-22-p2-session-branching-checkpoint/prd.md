# P2.2 Session 分支与 Checkpoint

## Goal

支持对话分叉、状态快照和跨设备迁移，让 session 成为可探索、可回溯、可移植的实体。

## Background

当前 SessionStore 只支持线性消息追加。无法从历史消息中的某个点分叉出新的对话路径，也无法保存 agent 的完整运行时状态（thinking context、pending tool calls 等）。

## Requirements

### R1: 对话分叉（Branching）
- 用户可以在 Chat UI 中点击历史消息，选择"从这里分叉"
- 创建新 branch：复制分叉点之前的消息到新 session，后续消息独立
- 原始 branch 不受影响
- Chat UI 支持在 branches 之间切换（类似 git branch）

### R2: Checkpoint/Resume
- 保存 agent 完整状态快照：messages + thinking context + pending tool calls + blackboard 引用
- 快照存储在 session_store 的 `checkpoints` 表
- 用户可以从任意 checkpoint 恢复 agent
- 用例：在关键决策点保存快照，如果后续路径不理想可以回退

### R3: 对话导出/导入
- 导出格式：JSON，包含 session 元数据 + 所有消息 + 可选的 checkpoint
- 导入：从 JSON 恢复 session
- 跨设备迁移：用户 A 导出 → 用户 B 导入
- 支持选择性导出（指定消息范围）

### R4: 数据模型扩展

```sql
-- 在 clawd-sessions.db 中新增
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;  -- 分叉来源
ALTER TABLE sessions ADD COLUMN branch_point_seq INTEGER; -- 分叉点的 seq

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  label TEXT,
  snapshot TEXT NOT NULL,       -- JSON: 完整状态快照
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_checkpoints_session ON checkpoints(session_id);
```

## Technical Approach

### 文件变更

1. **修改** `src/storage/session-store.ts` — 新增 branch、checkpoint、export/import 方法
2. **修改** `src/agent/runtime.ts` — checkpoint 保存/恢复逻辑
3. **修改** `src/agent/pet-manager.ts` — branch 创建流程
4. **修改** Chat UI — branch 切换、checkpoint 操作按钮
5. **新增** `src/shared/types.ts` — Branch/Checkpoint 类型

## Verification

1. 从第 5 条消息分叉，新 branch 从第 5 条开始，后续独立发展
2. 在第 3 条消息处创建 checkpoint，后续对话继续，从 checkpoint 恢复后 agent 回到第 3 条消息的状态
3. 导出 session 为 JSON 文件，在另一个 Clawd 实例导入，对话历史完整
