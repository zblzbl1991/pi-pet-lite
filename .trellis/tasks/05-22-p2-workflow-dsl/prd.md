# P2.3 工作流编排 DSL

## Goal

定义声明式 DSL 描述多 agent 工作流，支持依赖关系、条件分支、并行执行，使复杂的多 agent 协作可配置化而非硬编码。

## Background

当前多 agent 协作完全依赖 Chief LLM 的 `delegate_task` 调用。LLM 每次都要重新决定如何分配任务，无法保证可重复的执行模式。对于已知的固定流程（如"研究→分析→实现"），应该用声明式配置而非 LLM 即时决策。

## Requirements

### R1: DSL 语法
使用 YAML 格式，简洁可读：

```yaml
name: research-and-implement
description: "Research a topic, analyze findings, then implement"
inputs:
  - name: topic
    type: string
    required: true

steps:
  - id: research
    agent: scout
    prompt: "Research the latest developments in {topic}"
    output_key: research_result

  - id: analyze
    agent: analyst
    prompt: "Analyze these findings and provide recommendations: {research.output}"
    depends_on: [research]
    output_key: analysis

  - id: implement
    agent: coder
    prompt: "Implement the recommended changes: {analysis.output}"
    depends_on: [analyze]
    output_key: code_changes
    condition: "analysis.output contains 'feasible'"

  - id: notify
    agent: chief
    prompt: "Summarize what was done: research={research.status}, implement={implement.status}"
    depends_on: [research, implement]
```

### R2: Workflow 引擎
- 解析 YAML → 构建 DAG（有向无环图）
- 并行执行无依赖的步骤
- 按依赖顺序串行执行有依赖的步骤
- 每个步骤是一个 ScheduledTask（P1.2 的优先级系统）
- 支持 `condition` 表达式（简单字符串匹配）

### R3: Workflow 生命周期
- `run` — 启动工作流
- `pause` — 暂停（当前步骤完成后停止）
- `resume` — 从暂停处继续
- `cancel` — 取消（终止所有进行中的步骤）
- `status` — 查看进度（每个步骤的 status）

### R4: UI 集成
- Settings 新增 "Workflows" 页面
- 列表显示可用 workflow（名称、描述、步骤数）
- 一键运行（弹出参数输入对话框）
- 运行状态展示（进度条、步骤状态）

### R5: Workflow 存储
- 存储在 `~/.clawd/workflows/` 目录
- 每个 workflow 一个 YAML 文件
- 运行历史记录在 SQLite

## Technical Approach

### 文件变更

1. **新增** `src/agent/workflow/types.ts` — Workflow 类型定义
2. **新增** `src/agent/workflow/parser.ts` — YAML 解析 + DAG 构建
3. **新增** `src/agent/workflow/engine.ts` — 工作流执行引擎
4. **新增** `src/agent/workflow/loader.ts` — 目录扫描 + 加载
5. **修改** `src/agent/pet-manager.ts` — 集成 workflow engine
6. **修改** Settings UI — Workflows 页面

### DAG 执行逻辑

```
parse(yaml) → DAG { nodes: Step[], edges: Dependency[] }
run(dag, inputs) →
  找到入度为 0 的节点 → 并行执行
  每个节点完成 → 更新出度依赖 → 解锁新节点
  所有节点完成 → workflow end
```

## Decision (ADR-lite)

### D1: 条件表达式复杂度
**Context**: condition 支持到什么程度？
**Decision**: MVP 只支持简单的 `contains` / `equals` / `not_empty`。不支持 JS 表达式或复杂逻辑。
**Consequences**: 安全（无代码注入），覆盖 80% 场景。

## Verification

1. 创建一个 3 步 workflow YAML 文件
2. 在 Settings 运行，输入参数
3. 步骤按依赖顺序执行，无依赖的步骤并行
4. 中途取消，进行中的步骤终止
5. 运行历史在 UI 中可见
