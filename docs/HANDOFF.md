# 最小交接：文序

更新：2026-10-22。工作区 `C:\Users\20979\RP_Projects\structured_editor`，Windows / PowerShell。

## 恢复方式

先读 `AGENTS.md`、精简后的 `docs/STATUS.md`。本文件提供下一阶段所需入口；读过或已粘贴进对话就不重复读。不要通读 PLAN、ARCHITECTURE、ISSUES、历史交接或旧 3A 文档；只检索当前任务对应章节。工具仅输出相关片段、测试摘要与失败详情，小任务不做全项目探索。

## 当前产品与不可退回的决策

- React/TypeScript/Vite + Python/FastAPI/Pydantic/lxml。本机运行；同一三栏工作台兼容导入 DOCX 和新建写作，不恢复旧独立 Tiptap 界面。
- 空文档可写；已有 DOCX 先点「启用文字编辑」。文字、格式、模板共用持久撤销/重做。编辑模式导出不做原文字未变审计；原 DOCX 与未修改部件始终保留。
- 回车新段默认正文，旁边类别菜单支持数字/左右键选择、回车确认；确认正文立即收菜单，其他类别后台保存且不阻断输入。确认后数字是正文，重新聚焦不能重开已确认菜单。标记默认显示，可关闭。
- 单行粘贴本地立即显示，约 650ms 停顿保存；多行粘贴建立独立正文段落。侧栏保存期间 inert 锁定但不闪灰。失败保留本地文字，可重试/下载；不得用旧响应覆盖继续输入或抢光标。
- 类别、标签、结构上下文独立；检查焦点、筛选范围、格式提交范围独立。对象属性只读检查，标注入口在操作页。不要新增常驻操作教学。

## 下一阶段边界

最新修复 `226cd0f` 已提交，尚无用户明确验收；用户已确认粘贴、回车打开类别菜单正常。本次仅整理交接，不代表授权开始实现下一阶段。后续若用户明确要求继续，则直接推进，不重复索要已给授权。

当前最接近用户诉求的未完成项是：**新建段落/多段粘贴仍等待服务端，尚非完整本地即时编辑**。建议下一期先做本地结构事务及后台串行保存，明确临时 ID 到持久 ID、待保存操作顺序、失败保留/重试、焦点和统一历史，再扩展跨段选区。此为建议，未获用户选定；PLAN 阶段 3 仍列跨段选区、复杂节点/资源为后续方向，不一次包揽。

图片/公式/域/超链接/修订/分节等复杂段落继续只读，不降级纯文本；普通表格文字可编辑，但拆合不能跨单元格或复杂结构。真实 IME、Word 精确分页、长文档端到端性能未全面验收。阶段完成停下，不能把后续能力写成已完成。

## 实施时只读这些入口

| 任务 | 文件 / 必要契约 |
| --- | --- |
| 编辑状态、串行请求、焦点 | `frontend/src/App.tsx`、`components/EditableParagraph.tsx`、`lib/textEditing.ts` |
| 画布、稳定段落组件 | `frontend/src/components/DocumentCanvas.tsx` |
| 旧服务兼容 | `frontend/src/lib/compatibleTextEdit.ts`、`lib/api.ts` |
| 内容动作、保留、导出 | `backend/structured_editor/docx/editing.py` |
| 项目、历史、原子存储 | `backend/structured_editor/domain/models.py`、`domain/commands.py`、`storage.py` |
| 详细契约（仅相关节） | `docs/ARCHITECTURE.md` 第 19–22 节；多段粘贴查 `STAGE3C.md` |

项目 v6：原 source.docx 不变，content 保存 XML + 稳定 pN ID；next_paragraph 单调递增，不随撤销回退。当前/历史内容与标注等一起恢复，50 步历史。拆分偏移按 Unicode 码点。XML 只在 DOCX 适配器处理，领域层不依赖 HTTP。

split/paste 可带 draft，将未保存正文和结构一次提交。仅当旧服务明确以 422 拒绝 draft 时，前端兼容为 replace + 结构请求，并保留中间成功 revision；网络错误/409 不能盲目重放。旧路径两步历史，新版单次历史。类别请求独立排队，后续结构动作必须等类别成功。

## 开发与验证

- 根目录：`.venv/Scripts/python.exe -m pytest -q`；`.venv/Scripts/ruff.exe check backend tests`。
- `frontend` 目录：`npm.cmd run build`；`node --experimental-strip-types --test --test-reporter=dot tests/*.test.ts`。PowerShell 使用 npm.cmd。
- 重点回归：`tests/test_text_editing.py`、`frontend/tests/textEditing.test.ts`、`compatibleTextEdit.test.ts`；按实际变更补保存失败、历史/ID、原文保留和选择器检查，浏览器只验本轮交互，不让用户重跑历史清单。
- 隔离服务：`.venv/Scripts/python.exe -m structured_editor --port 8766 --data-dir .artifacts/<task> --no-browser`；不要用用户项目测试。停止前现查端口及进程命令行，不能复用旧 PID。
- 用户服务通常 8765。最近只读 OpenAPI 确认其仍是旧后端，不支持 draft；现状可能变化，按需重新检查。刷新只更新前端；后端更新需重启 `Start.cmd`，不要无故停用户服务。
- 修改后更新 STATUS/ISSUES 与真实限制；独立里程碑提交，不 amend、不 push。不修改 `../copyQ`，不提交 data、用户文档、依赖、构建或临时产物。环境问题只做一次针对性重试。
