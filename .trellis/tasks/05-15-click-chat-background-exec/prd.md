# 点击对话与后台执行模式

## Goal

点击宠物弹出独立聊天窗口，支持多轮对话、后台任务执行、多方式通知。

## Requirements

1. 点击宠物弹出独立聊天窗口（~400x600），显示完整对话历史
2. 支持多轮对话，消息列表可滚动
3. 关闭聊天窗口不中断 agent 执行，再次打开可看到完整历史
4. 后台任务完成后，按 Settings 配置通知（系统通知 / 宠物气泡 / 动画），至少保留一种
5. 流式输出在聊天窗口中正确显示（打字机效果 + 光标闪烁）
6. 工具执行状态内联显示在消息流中
7. 宠物窗口精简为：动画 + 微型气泡（最新消息一行摘要）
8. Settings 新增通知方式配置（三个独立开关，至少一个开启）

## Decision (ADR-lite)

### D1: 消息路由 — 主进程中继
```
Agent ←MessagePort→ Main Process ─IPC─→ ChatWindow (完整消息)
                                  └─IPC─→ PetWindow  (状态+摘要)
```
Agent 只跟主进程通信。主进程广播给两个窗口。关闭 ChatWindow 不影响 agent。

### D2: ChatWindow 生命周期 — 单例 + hide/show
- 首次点击创建，之后 hide/show 复用
- 对话历史保存在 React state，无需持久化
- 主进程维护环形缓冲区（最近 200 条），ChatWindow show 时一次性同步

### D3: PetWindow — 精简状态指示器
- 聊天窗口打开时：隐藏 ChatBubble，只显示宠物动画
- 聊天窗口关闭时：显示宠物动画 + 微型气泡（最新消息一行摘要）
- 点击宠物 → 重新打开聊天窗口

### D4: 工具确认 — 始终在聊天窗口
- 确认请求内联在消息流中（Allow/Deny 按钮）
- ChatWindow 隐藏时 → 自动 show 弹出

### D5: 聊天窗口位置 — 宠物旁偏右
- 默认宠物窗口右侧，垂直居中对齐
- 空间不够自动切左侧或居中
- 用户可拖动，记住位置

### D6: 通知设置 — 三开关 + 至少一个
- 系统通知（Windows toast）
- 宠物气泡（结果摘要）
- 宠物动画（SUCCESS/FAILED gif）
- 至少一个必须开启，全关时提示"任务完成后不会提醒"

## Acceptance Criteria

- [ ] 点击宠物弹出独立聊天窗口，显示所有历史消息
- [ ] 用户可以连续发送多条消息，看到完整对话流
- [ ] 关闭聊天窗口不中断 agent，再次打开可看到完整历史
- [ ] 后台任务完成后按 Settings 配置通知
- [ ] Settings 新增通知方式开关（至少一个必须开启）
- [ ] 流式输出在聊天窗口中正确显示
- [ ] 工具执行状态内联显示在消息流中
- [ ] 工具确认请求在聊天窗口内显示，ChatWindow 隐藏时自动弹出
- [ ] 宠物窗口仅显示动画 + 微型气泡摘要
- [ ] 聊天窗口默认出现在宠物旁，可拖动

## Definition of Done

- 所有 Acceptance Criteria 通过
- TypeScript 编译无错误
- 多显示器下正常工作

## Out of Scope

- 语音输入/输出
- 对话历史持久化（重启后恢复）
- 多会话管理

## Technical Notes

### 关键文件
- `src/main/main.ts` — 消息路由中继 + ChatWindow 管理
- `src/main/windows.ts` — 新增 createChatWindow
- `src/preload/preload.ts` — PetWindow preload 精简
- `src/preload/chat-preload.ts` — 新增 ChatWindow preload（共享 MessagePort IPC）
- `src/renderer/pet/PetWindow.tsx` — 精简为动画+微型气泡
- `src/renderer/chat/` — 新增聊天窗口（index.html, index.tsx, ChatPanel.tsx）
- `src/agent/runtime.ts` — 无需改动（消息协议不变）
- `src/renderer/settings/` — 新增通知配置 UI
- `src/config/config-store.ts` — 新增通知配置存储
- `src/shared/types.ts` — 新增通知配置类型

### 消息路由实现
- 现有 MessagePort 改为：port1 → 主进程（不是 renderer），port2 → agent
- 主进程监听 port1 消息，通过 ipcMain 广播给 PetWindow 和 ChatWindow
- 用户消息：ChatWindow/PetWindow → ipcRenderer → 主进程 → port2 → agent
- 主进程维护 messageBuffer: ChatMessage[]（环形，最大 200）

### ChatWindow 渲染器
- 独立入口：src/renderer/chat/index.html → index.tsx → ChatPanel.tsx
- 复用现有 shared/types.ts 中的消息类型
- 消息列表用虚拟滚动优化（如果消息多了）

### 通知实现
- 系统通知：electron Notification API
- 宠物气泡：PetWindow 的微型气泡组件
- 宠物动画：已有状态机，无需改动
