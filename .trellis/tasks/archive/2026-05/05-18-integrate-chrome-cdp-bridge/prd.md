# Integrate Chrome CDP Bridge Configuration

## Goal

将现有的浏览器 CDP 连接（Playwright）从硬编码改为可配置，让用户可以在 Settings 中指定 Chrome 路径和调试端口，方便后续自动化操作直接复用用户的浏览器会话。

## What I already know

- 项目已有 `src/agent/tools/browser.ts` 使用 Playwright CDP 连接
- `src/agent/tools/browser-launch.ts` 自动检测 Chrome/Edge 安装路径
- 当前端口硬编码为 9222，Chrome 路径通过文件系统搜索
- 配置系统在 `src/config/config-store.ts`，JSON 文件 `{userData}/clawd-config.json`
- 类型定义在 `src/shared/types.ts`
- Settings UI 在 `src/renderer/settings/`

## Assumptions (temporary)

- 用户主要在 Windows 上使用，Chrome 和 Edge 是主要浏览器
- 配置改动后不需要重启浏览器，只需重新连接
- 配置放在已有的 AppConfig 体系中，不需要单独的配置文件

## Open Questions

(none)

## Requirements

- 在 AppConfig 中新增 `browser` 配置段，包含 `chromePath` 和 `cdpPort`
- `chromePath` 默认值为空（自动检测），可手动指定
- `cdpPort` 默认值为 9222，可手动指定
- `browser-launch.ts` 优先使用配置中的路径，fallback 到自动检测
- `browser.ts` 使用配置中的端口
- Settings UI 添加浏览器配置区域
- Settings UI 添加"测试连接"按钮，点击后尝试连接 CDP 端口并反馈结果

## Acceptance Criteria

- [ ] 可以在 Settings 中看到浏览器配置区域（Chrome 路径 + 端口）
- [ ] 默认自动检测 Chrome 路径和端口 9222，无需手动配置即可使用
- [ ] 手动指定路径后，browser-launch 使用手动指定的路径
- [ ] 修改端口后，browser 使用新端口连接
- [ ] 点击"测试连接"按钮能验证 CDP 端口是否可达，显示成功/失败

## Definition of Done

- TypeScript 编译通过
- 手动测试：默认配置可用 + 手动指定配置可用

## Out of Scope

- 不改变现有 browser_action 工具的行为
- 不支持 Firefox/Safari 等其他浏览器
- 不处理浏览器自动启动（用户需要自己启动 Chrome 带 --remote-debugging-port）

## Technical Notes

- 相关文件：`src/shared/types.ts`, `src/shared/constants.ts`, `src/config/config-store.ts`, `src/agent/tools/browser.ts`, `src/agent/tools/browser-launch.ts`, `src/main/main.ts`, `src/renderer/settings/`
- 配置需要在 agent utility process 中也可读（通过 CLAWD_USER_DATA 环境变量）
