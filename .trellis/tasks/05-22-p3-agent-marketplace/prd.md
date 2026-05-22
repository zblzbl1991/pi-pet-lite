# P3.2 Agent Marketplace

## Goal

社区共享 PetProfile + Tool 组合的平台。用户可以浏览、安装、发布 agent 配置和 tool plugin。

## Requirements

### R1: Agent 包格式
- 一个 agent 包 = PetProfile 配置 + 依赖的 tool plugin 列表 + README
- 打包为 `.clawd-agent` 格式（zip）
- 包含 manifest.json 声明元数据

### R2: 浏览与搜索
- 分类浏览：productivity、development、research、creative
- 搜索：按名称、标签、能力
- 排序：热门、最新、评分

### R3: 安装与更新
- 一键安装 agent 包（下载 profile + 依赖 plugin）
- 自动安装缺失的 tool plugin
- 版本检查与更新通知

### R4: 发布
- 打包当前 PetProfile 为 agent 包
- 填写描述、标签、截图
- 上传到 marketplace registry

### R5: 评价系统
- 1-5 星评分
- 文字评论
- 安装量统计
