# PROJECT_STATE.md
> 上次更新：2026-03-19

## 🏗️ 当前进度
Profile 双层架构已实现：`generateProfile()` 现在从 Obsidian 主仓库读取近期内容，动态字段和稳定字段分开更新策略。

## 📁 关键文件
- `server/routes/archive.js` — 唯一修改文件，改动集中在 `generateProfile()` 函数

## ✅ 今天完成
- 新增常量 `OBSIDIAN_VAULT_DIR` 指向 `~/Documents/Obsidian Vault/workspace-j/`（主仓库，含独有的 knowledge/ 目录）
- 新增读取 4 类 Obsidian 内容：memory.md（全量）/ knowledge/（最新 10 篇）/ ideas/（近 30 天）/ daily-log/（近 14 天）
- System prompt 加入两层策略：currentFocus/habits/contradictions 优先近期数据，values/thinkingStyle 锚定现有档案
- userMessage 按时效性分层注入，从"最近→全量"排列

## 🔜 下一步（按优先级）
1. 重启服务器（`cd ~/Desktop/workspace\ j && npm start`），点击「更新档案」验证 currentFocus 是否反映近期内容
2. 检查 `~/Documents/Obsidian Vault/workspace-j/` 路径下各子目录是否有内容（knowledge/、voice-context/ideas/、voice-context/daily-log/）
3. 若路径为空，确认 Obsidian 写入路径（OBSIDIAN_DIR）与主仓库是否一致

## 🐛 已知问题
- [ ] 未实际验证 Obsidian 主仓库路径下有内容——路径不存在时静默跳过，不报错，但 profile 不会改善

## 💡 重要上下文
- 写入路径（OBSIDIAN_DIR）= `~/workplace memory/voice-context/`，读取路径（OBSIDIAN_VAULT_DIR）= 主仓库，两者不同，是有意为之
- 现有 profile 字段结构不变，前端无需改动
- `triggerProfileUpdate()` 触发机制不变，每次上传录音后自动调用
