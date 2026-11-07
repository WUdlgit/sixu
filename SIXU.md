# 思序（Sixu）

个人长文章创作工具，基于 [NoteGen](https://github.com/codexu/note-gen) v0.39.2
（上游提交 `325e9940ed785576d9963088afdca66d6593a6bb`）定制。
上游作者与贡献者保留其版权，项目继续遵循根目录 GPLv3 LICENSE。
本定制版不是 NoteGen 官方发行版，勿将定制版问题直接报给上游。

## 本轮定制

- 独立应用标识 `com.sixu.desktop`，与试用版数据分离。
- 停用上游自动更新及 NoteGen 旧安装清理，避免覆盖定制版或操作原版。
- 创作台提供选题、近况采访、确认大纲、全文/逐节写作和配图提示入口；准备消息后由用户发送。
- 写作偏好通过确认保存到 `sixu-writing.json`，普通 Chat 和 Agent 每次请求都会加载。
- AI 默认先聊再写，联网需用户明确提出；文件修改沿用上游差异与权限机制。
- 不初始化上游赞助模型。通过原有模型设置配置自己的服务；尚未接入 ChatGPT Plus。

## 开发

前端：Node 24、pnpm，运行 `pnpm install --frozen-lockfile`、`pnpm exec tsc --noEmit`、`pnpm build`。
提示词行为检查：`node --experimental-strip-types --test scripts/sixu-writing.test.mjs`。
桌面开发：安装 Rust 和 Windows C++ 构建工具后，`pnpm tauri dev`。
打包：`pnpm tauri build --bundles nsis`。

不要把 API Key 写入源码或提交记录。不要把普通浏览器中的静态页面当作桌面文件/数据库功能已验证。

## 尚待完成的思序需求

逐篇创作阶段的持久化与严格控制、写作样例的分析确认、逐处差异审阅实测、
PDF OCR 与页码来源整合、素材库关联、搜索、引用核对和备份恢复的完整验收。
本轮是定制基础，不宣称所有第一版需求已完成。
