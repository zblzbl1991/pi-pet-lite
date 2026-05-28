# P3.3 分布式 Runtime

## Goal

将 A2A 协议从"调远程 agent"扩展到"整个 runtime 可分布式部署"，支持 agent 发现、负载均衡、跨机器 agent 协作。

## Requirements

### R1: Runtime 节点
- Clawd 实例可以作为 "runtime node" 暴露服务
- 声明本节点可提供的 agent（profile + 能力描述）
- 支持 agent 发现协议（基于 A2A AgentCard 扩展）

### R2: 跨节点委派
- Chief 委派任务时，可以路由到远程节点的 agent
- 远程 agent 执行结果通过 A2A 协议返回
- 传输层：HTTP/WebSocket

### R3: 负载均衡
- 多个节点提供相同 agent 时，选择负载最低的
- 健康检查：节点不可达时自动 failover
- 任务超时：远程节点无响应时本地重试或报错

### R4: 安全
- 节点间通信加密（TLS）
- 认证：API Key / mTLS
- 授权：声明哪些 agent 可以被远程调用

### R5: 服务发现
- 局域网自动发现（mDNS / Bonjour）
- 手动添加远程节点 URL
- 节点状态面板（在线/离线/延迟/负载）
