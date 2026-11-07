# 开发与验证

## 检查命令

```sh
pnpm exec tsc --noEmit
node --experimental-strip-types --test scripts/sixu-writing.test.mjs
node --test scripts/sixu-vector.test.mjs
python scripts/sixu-conversation-integrity.test.py
pnpm build
```

SQLite 检查使用 Python 3 自带 sqlite3，在内存数据库里执行生产源码的 SQL，不访问个人数据库。向量后台行为检查通过受控依赖验证未配置/已配置两种情况，不调用付费模型。

Rust 流式接收器检查位于 `src-tauri/src/ai.rs`，覆盖中文和 emoji 在任意字节边界切分及逐字节接收，可在桌面构建环境运行：

```sh
cd src-tauri
cargo test --bin note-gen tests::
```

## 已取得的证据

- 前端类型检查和构建通过。
- 写作行为检查 4 项、后台索引检查 3 项、SQLite 一致性检查 4 项通过。
- 流式接收器原缺陷在新增检查中先失败，修改后 4 项通过；本地提取实际接收器代码进行 rustc --test 检查，并完成桌面构建。维护者还进行了真实中文回显检查。
- Windows 桌面程序实际启动并完成短篇创作、保存以及配置恢复检查。

这些结果不代表跨平台、并发同步、任意异常中断或全部上游功能均已验证。

## 会话完整性保护

会话入口恢复保持原有消息不变；存在会话删除标记时保守跳过恢复，目标消息有删除标记时也跳过。数据库触发器阻止悬空消息和单独删除仍有消息的会话。正常先删除消息再删除会话的流程保留。

保护可以阻止已知的不一致写入，但不会解释历史事件的所有成因。若遇到数据库拒绝操作，请先备份并保留错误信息，不要通过清空数据库解决。
