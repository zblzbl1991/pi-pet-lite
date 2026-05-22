# P2.1 Plugin/Tool 开放 API

## Goal

让社区和用户能通过标准接口贡献自定义 tool，这是 OpenClaw 最自然的参与入口。用户安装 plugin 后，agent 自动获得新能力。

## Background

当前所有 tool 都硬编码在 `src/agent/tools/registry.ts` 中，添加新 tool 需要修改源码并重新构建。对于 OpenClaw 的社区化演进，需要一个开放的 tool 加载机制。

## Requirements

### R1: ToolPlugin 接口
```typescript
interface ToolPlugin {
  name: string;                    // 唯一标识符，如 "web-scraper"
  displayName: string;             // 显示名 "Web Scraper"
  description: string;             // 给 LLM 的描述
  parameters: ToolParameter[];     // JSON Schema 参数定义
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
  version?: string;
  author?: string;
}

interface ToolParameter {
  name: string;
  type: string;                    // JSON Schema type
  description: string;
  required?: boolean;
}

interface ToolContext {
  petId: string;
  sessionId: string;
  blackboard: BlackboardAccess;    // 只读访问 blackboard
  eventBus: EventBusAccess;        // 发送事件
}

interface ToolResult {
  content: string;
  isError?: boolean;
}
```

### R2: Plugin 目录扫描
- 扫描 `~/.clawd/plugins/` 目录
- 每个 plugin 是一个独立目录：`plugins/web-scraper/index.js`
- plugin 导出符合 `ToolPlugin` 接口的对象
- 启动时扫描 + 热重载（文件变化时自动重新加载）

### R3: Plugin 注册集成
- `registry.ts` 的 `getAllTools()` 返回内置 tool + 已加载 plugin
- `getToolsForProfile(profile)` 自动包含 profile 允许的 plugin
- PetProfile 的 `toolNames` 支持 plugin 名：`["web_scraper", "file_read"]`

### R4: Plugin 管理 UI
- Settings 新增 "Plugins" 页面
- 列表显示已安装 plugin（名称、版本、作者、状态）
- 启用/禁用开关
- 安装：从本地路径加载 / 从 URL 下载
- 卸载：移除目录 + 清理注册

### R5: 安全沙箱
- Plugin 在受限环境中执行
- 文件系统访问限制在用户数据目录
- 网络请求需声明（manifest 中的 `permissions: ["network"]`）
- 执行超时（默认 30 秒）

### R6: Plugin Manifest
每个 plugin 目录包含 `plugin.json`：
```json
{
  "name": "web-scraper",
  "version": "1.0.0",
  "displayName": "Web Scraper",
  "description": "Scrape web pages and extract structured data",
  "author": "community",
  "permissions": ["network"],
  "timeout": 30000,
  "entry": "index.js"
}
```

## Technical Approach

### 文件变更

1. **新增** `src/agent/plugins/types.ts` — ToolPlugin 接口定义
2. **新增** `src/agent/plugins/loader.ts` — 目录扫描、加载、验证
3. **新增** `src/agent/plugins/sandbox.ts` — 执行沙箱
4. **修改** `src/agent/tools/registry.ts` — 集成 plugin tool
5. **修改** `src/shared/types.ts` — PetProfile 支持 plugin 名
6. **修改** Settings UI — 新增 Plugins 页面

## Decision (ADR-lite)

### D1: Plugin 格式
**Context**: CommonJS 还是 ESM？编译型还是解释型？
**Decision**: CommonJS（`require()` 加载），直接执行 JS。不引入编译步骤。
**Consequences**: 简单，和 Electron Node.js 环境一致。ESM plugin 可在未来支持。

### D2: 安全模型
**Context**: 完全信任还是沙箱执行？
**Decision**: MVP 阶段信任模型 + 声明式权限（manifest 中声明）。不引入 VM sandbox。
**Consequences**: 简单实现。用户需自行判断 plugin 安全性（类似 VS Code extension 模型）。

## Verification

1. 将一个 JS 文件放入 `~/.clawd/plugins/test/index.js` + `plugin.json`
2. 启动应用，Settings > Plugins 页面显示该 plugin
3. 启用 plugin 后，agent 可以使用该 tool
4. PetProfile 中添加 plugin name 后，只有该 profile 的 agent 可使用
5. 禁用 plugin 后，tool 从 registry 中移除
