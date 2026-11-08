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
启动与数据安全检查：`node --test scripts/sixu-startup.test.mjs`、`node --test scripts/sixu-data-safety.test.mjs`。
桌面开发：安装 Rust 和 Windows C++ 构建工具后，`pnpm tauri dev`。
打包：`pnpm tauri build --bundles nsis`。

不要把 API Key 写入源码或提交记录。不要把普通浏览器中的静态页面当作桌面文件/数据库功能已验证。

## 数据安全

- 用户数据默认在 Tauri 应用数据目录（Windows 为 `%APPDATA%\com.sixu.desktop`）。如果从 MSIX 打包的工具环境启动，Windows 会把同一路径重定向到该包的 `LocalCache\Roaming`，形成另一份数据目录；这会让“正常启动”看起来像数据消失。
- 启动后如果历史对话和文章都为空，思序会扫描本机其它思序数据目录，在顶部提示来源、数量和更新时间，经确认后在下一次启动、数据库打开之前导入（导入前先备份当前目录）。
- 首次启动自动启用本地备份：目录 `文档\思序备份`，每天一次，保留 10 份；可在“设置 → 备份”修改或关闭。备份包含数据库一致性快照、`store.json`、文章和写作偏好，属于私人文件，不上传云端。
- `store.json` 无法解析时，启动阶段会在覆盖前保留 `store.json.corrupt-<时间戳>`，并在界面提示恢复入口。
- 不要把应用数据目录放在临时目录或会被清理工具扫到的位置；不要同时从两个不同启动环境长期写入同一应用。

## 尚待完成的思序需求

逐篇创作阶段的持久化与严格控制、写作样例的分析确认、逐处差异审阅实测、
PDF OCR 与页码来源整合、素材库关联、搜索、引用核对和备份恢复的完整验收。
本轮是定制基础，不宣称所有第一版需求已完成。
