# 复利库 — 有效模式
> 验证过好用的做法，直接复用

---

## 模板格式

```
### 模式名称
**适用场景**：什么时候用这个
**模式**：
\`\`\`
代码或操作模板
\`\`\`
**注意事项**：
**来源项目**：
```

---

## AI 调用

### Claude CLI 代理（claude -p）
**适用场景**：需要调用 Claude 能力但不想管理 API Key
**模式**：
```js
// server/services/claude.js
const child = spawn('claude', ['-p', '--output-format', 'stream-json'], {
  env: { ...process.env, CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined }
})
child.stdin.write(userMessage)
child.stdin.end()
```
**注意事项**：必须去掉 `CLAUDECODE` 和 `ANTHROPIC_API_KEY` 环境变量，强制走订阅认证；PreToolUse hook 保护此文件防止误改
**来源项目**：Workspace J

---

## 架构模式

### 事件总线跨模块通信
**适用场景**：多个独立模块需要传递数据（如档案馆 → 写作）
**模式**：
```js
// 发送
app.emit('archive:send-to-writing', { content })

// 接收
app.on('archive:send-to-writing', ({ content }) => { ... })
```
**注意事项**：命名规则 `模块:动作`，避免事件名冲突
**来源项目**：Workspace J

---

## 数据存储

### 平铺 JSON 文件（本地优先）
**适用场景**：单用户、读多写少、需要方便 debug 的本地存储
**模式**：每类数据一个 JSON 文件，直接 `fs.readFile` / `fs.writeFile`
**注意事项**：并发写入时需加锁或队列；ID 生成用 `Date.now() + index`
**来源项目**：Workspace J

---

## AI Prompt 设计

### 两层字段更新策略（动态 vs 稳定）
**适用场景**：用 AI 生成/更新结构化档案（profile、persona、用户画像），字段有不同迭代频率
**模式**：
在 system prompt 里明确两类字段的更新规则：
```
字段更新策略：
- 动态字段（currentFocus / habits / contradictions）：优先参考近期数据（最近 30 天），不被旧数据主导
- 稳定字段（values / thinkingStyle / communicationPrefs）：以现有档案为锚点，只在出现明显新特征时才改
- 身份字段（identity）：不变，除非用户明确说明
```
在 userMessage 里按时效性分层注入（最近的放最前）：
```
【现有档案（稳定锚点）】...
【近期笔记/数据（近 30 天）】...
【全量历史记录】...
```
**注意事项**：近期数据来源要明确标注时间范围；全量历史放最后防止稀释近期信号
**来源项目**：Workspace J（generateProfile 函数，2026-03-19）

---

## Claude Code 工作流

### 上下文太长时新开会话
**适用场景**：当前会话上下文过长，影响响应质量
**模式**：
1. 说 `/wrap-up` 更新 PROJECT_STATE.md 和复利库
2. 新开会话，`cd` 进项目目录
3. 第一句话：`请读取 PROJECT_STATE.md，继续上次的工作`
**注意事项**：wrap-up 前确认所有重要信息都记录了
**来源项目**：通用
