# 最小交接：文序

更新：2026-10-22。工作区 `C:\Users\20979\RP_Projects\structured_editor`，Windows / PowerShell。

## 恢复方式

先读 `AGENTS.md`、`docs/STATUS.md`。本文件只提供入口；不要通读 PLAN、ARCHITECTURE、ISSUES 或历史交接。仅检索当前任务章节，工具只输出相关片段、测试摘要与失败详情。

## 当前阶段与产品边界

- 用户已授权并完成 3D：本地回车/多段粘贴事务与后台串行保存，待验收；本轮结束，不自动开始下一阶段。
- 统一三栏工作台：新建直接写作，导入 DOCX 显式启用文字编辑；类别、标签、结构上下文独立，检查焦点、筛选与格式范围独立。对象属性只读，标注在操作页。不恢复独立 Tiptap 界面，不新增常驻操作教学。
- 新后端下回车/多段粘贴立即显示并聚焦新段；可立即选择类别、输入或再拆段。正文确认立即收菜单；其他类别入队保存，确认后数字属于正文，重新聚焦不重开已确认菜单。
- 保存期间侧栏 inert 不闪灰；导出、切换、格式提交等待完成。失败保留当前页队列与输入，可继续写作、重试、下载全文；未知网络结果不自动重放。
- 队列仅在当前页面，不是离线持久化；刷新/关闭会警告。段首合并/删除仍等待服务端。跨段选区、复杂节点/资源、真实 IME 与 Word 精确分页未全面验收。
- 图片/公式/域/超链接/修订/分节等复杂段落继续只读。普通表格文字可编辑，拆合不能跨单元格或复杂结构。原 DOCX 不覆盖。

## 实施入口（按需）

| 任务 | 文件 / 契约 |
| --- | --- |
| 本地结构投影、后台顺序、失败重试 | `frontend/src/lib/textQueue.ts`、`frontend/tests/textQueue.test.ts` |
| 工作台保存/历史/焦点 | `frontend/src/App.tsx`、`components/EditableParagraph.tsx` |
| 画布与稳定段落组件 | `frontend/src/components/DocumentCanvas.tsx` |
| 旧服务兼容 | `frontend/src/lib/compatibleTextEdit.ts`、`lib/api.ts` |
| 原子内容编辑与保留 | `backend/structured_editor/docx/editing.py` |
| 分配器、持久请求回执、统一历史 | `backend/structured_editor/storage.py`、`domain/models.py` |
| 现行队列契约 | `docs/ARCHITECTURE.md` 第 23 节；必要时补第 19–22 节 |

项目 v6：原 source.docx 不变；content 保存 XML + 稳定 pN ID；next_paragraph 单调递增，撤销不回退；统一 50 步历史。拆分按 Unicode 码点；XML 只在 DOCX 适配器处理。

新视图 `text_queue_version=1` 与 next_paragraph 启用本地队列；新段预留 pN ID，revision 冲突停止，不能自动重映射/覆盖。队列一次发送一个事务，确认后在服务器结果上重放队尾，保留后续输入。request_id 与最后一次请求/结果回执随内容原子保存，丢失响应重试不重复创建段落或历史。

旧服务不启用队列，保留同步路径；仅明确 422 拒绝 draft 时先 replace 再结构请求，并保存中间 revision。旧路径两步历史，新版携带 draft 单次原子历史。网络/409 不做兼容重放。

## 开发与验证

- 根目录：`.venv/Scripts/python.exe -m pytest -q`；`.venv/Scripts/ruff.exe check backend tests`。
- `frontend`：`npm.cmd run build`；`node --experimental-strip-types --test --test-reporter=dot tests/*.test.ts`。
- 本轮后端 158 项、前端 59 项、Ruff/构建通过；浏览器隔离 1.2 秒延迟连续结构操作、数字类别确认/续写、503 保留/重试、刷新与撤销/重做通过。不要求用户重跑历史回归。
- 用户 8765 服务未操作；新能力需重启 `Start.cmd` 加载后端后刷新。旧服务仍可使用原兼容路径。
- 隔离测试使用 `.artifacts/text-queue-data` 和 8766，测试服务已停止，不用用户项目。停止服务前现查端口与命令行，不复用旧 PID。
- 修改后更新 STATUS/ISSUES 与真实限制；里程碑提交一行概览加简要正文，不 amend、不 push。不修改 `../copyQ`，不提交 data、用户文档、依赖、构建、临时产物。
