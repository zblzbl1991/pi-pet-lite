# P3.1 多 Workspace 隔离

## Goal

支持多个独立 workspace，各有自己的 agents、sessions、blackboard、config。不同项目/场景使用不同 workspace，数据完全隔离。

## Requirements

### R1: Workspace 概念
- 每个 workspace 是一个独立的数据目录
- 包含独立的：config.json、sessions.db、blackboard.db、plugins/
- 切换 workspace = 切换数据目录

### R2: Workspace 管理
- 创建、删除、重命名 workspace
- 列表展示所有 workspace
- 设置默认 workspace（启动时自动加载）
- 快速切换（系统托盘菜单或快捷键）

### R3: Workspace 隔离
- 各 workspace 的 agent 实例完全独立
- PetManager 按 workspace 实例化
- SessionStore / BlackboardStore 按 workspace 打开不同数据库

### R4: 跨 Workspace 迁移
- 导出整个 workspace 为压缩包
- 从压缩包导入为新 workspace
- 复制 session 到另一个 workspace
