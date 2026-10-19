# 阶段 1 架构

2026-10-19。与 `PLAN.md` 配套，记录已经实现的行为。

## 1. 数据流

```text
导入 DOCX / sdoc
  → ProjectStore 校验并保存原文件
  → DocxPackage 读取 ZIP 和 XML
  → StyleResolver + project_document 生成结构投影
  → 叠加项目的 Annotation
  → 前端阅读视图与对象检查

选择器 → domain.selectors.select → 命中 ID
格式草稿 → preview（只读）→ apply（检查 revision）
  → commit（保存原状态到历史）→ 原子保存 JSON

导出 DOCX：原文件 + 当前格式覆盖 → 定点修改 document.xml
导出 sdoc：原文件 + 完整项目 JSON → ZIP 项目包
```

文档内容不通过 Markdown、HTML 或富文本编辑器中转。首版不编辑文本结构。

## 2. 文件与模块

- `domain/models.py`：Pydantic 边界模型；字段白名单、单位与范围、选择器树、标注和历史快照。
- `domain/selectors.py`：唯一的筛选求值实现，供高亮、预览、提交共用。不可编辑对象永不参与操作。
- `domain/commands.py`：revision 校验、状态提交、撤销与重做；不做文件 I/O。
- `docx/package.py`：ZIP 限制、DOCX 验证、原包保留；支持常规 Transitional OOXML。
- `docx/xml.py`：命名空间、属性顺序、段落直属 run 定位，避免修改文本框内的嵌套段落。
- `docx/styles.py`：常见样式继承、直接格式与字符样式投影，以及保守的语义分类建议。
- `docx/reader.py`：段落对象、表格布局、复杂结构限制与提示。
- `docx/writer.py`：只写明确设置的属性，其他属性保留。
- `docx/sample.py`：确定性示例生成器；不依赖外部样例文件。
- `storage.py`：项目读写、语义覆盖、事务协调、最近项目、便携包导入导出。
- `api.py`：HTTP 路由、错误响应、本机来源限制、前端静态资源。
- `__main__.py`：本机服务启动与浏览器入口。
- `frontend/src/components/`：Sidebar、SelectorBuilder、DocumentCanvas、FormatPanel、ObjectInspector。
- `frontend/src/App.tsx`：工作区状态、请求串行化、预览失效、导入导出和快捷键。

## 3. 项目持久化

```text
data/<32 位项目 ID>/
  source.docx   原文件，只写一次
  project.json 项目状态，原子替换
```

JSON `version=1`；包含项目名、源文件 SHA-256、revision、更新时间、段落 annotations、undo/redo。每个 annotation 保存可选手工 role、tags、显式 format。未标注对象使用源文档投影。

`.sdoc` 是 ZIP，内含同名两个文件。重新导入时检查源文件散列；完全一致的源文件、标注和历史快照复用现有项目；不同状态校验所有段落 ID 后生成新项目 ID 与不重名的显示名称，避免覆盖现有项目。DOCX 字节完全相同时打开最近的已有项目。项目包包括最近 50 次历史，可在重新打开后撤销。

JSON 写入先落临时文件、flush/fsync，然后 os.replace。服务内部用 RLock 串行化项目状态操作；revision 阻止多个页面用过期状态互相覆盖。该锁针对单个服务进程，首版不要以多进程 worker 同时访问同一 data 目录。

浏览器 localStorage 只记住最后打开的项目 ID，不存文档内容；没有记录时先打开最近项目，只有没有本地项目才创建示例。最近项目列表最多显示 30 项，包含更新时间、修订和短 ID 以区分历史同名项目。下载不改变项目数量和修订。

## 4. 对象与选择器契约

段落 ID 是原 document.xml 主体中所有 `w:p` 的稳定遍历编号，如 `p3`。原文件结构在阶段 1 不变，故可以稳定回写。文本框不展开为可选对象；复杂包裹结构或修订内容只读。

role 与 Word pStyle 分离。自动识别以样式名、大纲级别、编号为依据，未知样式显示未分类。手工设置 role 不改 Word 的原样式，标签也是项目元数据。

选择器示例：

```json
{
  "mode": "all",
  "conditions": [
    {"field": "role", "op": "is", "value": "body"},
    {"field": "context", "op": "is_not", "value": "table"},
    {"field": "tag", "op": "is_not", "value": "保留原格式"}
  ]
}
```

`all` 是交集、`any` 是并集。role/tag/context 支持 is/is_not；text 另支持 contains/not_contains，文本匹配不区分大小写。标签匹配完整标签而非子串。空 all 选所有可编辑段落，空 any 无匹配。API 支持最多 5 层嵌套；当前 UI 使用单层分组。前端额外维护 selectionActive：清空条件/退出筛选进入未筛选，不发送筛选请求；只有显式「全部内容」用空 all 表达全选。空标签/文字条件在补全前不发请求。

后端返回命中 ID。前端条件变更后防抖 120ms 请求，过期响应忽略；格式预览和提交直接使用同一后端逻辑，避免两套选择器语义。

## 5. 格式覆盖及导出

| 项目字段 | 单位/语义 | DOCX 写入 |
|---|---|---|
| size_pt | 磅，步进 0.5 | run 与段落默认的 sz、szCs，乘 2 |
| font_east_asia | 字体名称 | rFonts/eastAsia，删除对应主题引用 |
| font_latin | 字体名称 | rFonts/ascii、hAnsi、cs，删除对应主题引用 |
| first_line_chars | 字符，可为 0 | firstLineChars 乘 100，清除直接悬挂缩进冲突 |
| line_spacing | 倍数 | line 乘 240、lineRule=auto、snapToGrid=0 |
| space_before_pt/space_after_pt | 磅 | before/after 乘 20，删除直接按行间距、关闭自动间距 |
| alignment | left/center/right/both | pPr/jc |

不改 styles.xml，不使用会影响未选中对象的样式批量替换。字体与字号写入所选段落的直属普通文字 run（包括超链接中的 run），不重建内容。数学对象保持原始 XML，首版不编辑数学字体/排版。

无格式覆盖时导出直接返回原 DOCX 字节。存在覆盖时仅重新序列化 document.xml；ZIP 内其他项的解压后内容保持逐字节一致。压缩容器字节和 document.xml 的序列化形式不承诺完全相同。修改字号等可能自然导致 Word 重新分页。

浏览器阅读视图读取常见样式、直接格式、字符样式和混合 run 属性。它不是完整 Word 排版引擎；主题字体解析、条件表格样式、编号布局、网格细节等后置。检查器会标出已知属性来源，未知值不伪造为确定值。

## 6. HTTP 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/health | 服务标识与版本 |
| GET | /api/projects | 最近项目 |
| POST | /api/projects/demo | 创建新示例 |
| POST | /api/projects/import | 导入 DOCX 或项目包 |
| GET | /api/projects/{id} | 项目投影 |
| POST | /api/projects/{id}/select | 统一筛选 |
| POST | /api/projects/{id}/preview | 只读预览 |
| POST | /api/projects/{id}/apply | 应用格式事务 |
| POST | /api/projects/{id}/annotate | 手工分类/标签事务 |
| POST | /api/projects/{id}/undo、redo | 状态历史 |
| GET | /api/projects/{id}/export/docx、project | 下载结果 |

预览、提交、标注与历史操作带 revision。冲突返回 409，前端重新加载最新状态并提示重新预览。用户输入非法返回 400/422。文件路径不由请求参数直接决定。

## 7. 后续扩展边界

- 阶段 2 的持续规则建立在当前选择器之上，必须单独定义优先级、冲突解释、覆盖与清除语义，不能直接堆叠在当前覆盖字典中。
- 阶段 3 的原生编辑模型需要持久节点 ID 和内容事务；当前原包定位方案仅适用于结构未变的 DOCX 修改。
- 将来的原生导出与当前保留式导出使用不同适配路径，明确记录支持/降级的属性。
- 当前 .sdoc version=1 是首版工作项目格式，并非最终通用文档格式。


## 8. 验收后交互修复

- `workspace.ts` 定义提交页签范围、应用后的草稿状态、选择器完整性、阅读用缩进计算，独立做纯逻辑测试。
- 预览冻结 selector、patch 和 revision，提交使用冻结请求；更改格式、页签或筛选时清除旧预览。取消保留草稿，成功应用默认清空全部，锁定时保留；明确勾选才能跨页签提交。
- `ChoiceInput` 采用原生 select + 显式自定义输入，候选项不按旧值过滤；选项使用内部索引，避免自定义值与特殊入口冲突。
- 对象标注改为立即提交。标签只更新 tags，不把原自动 role 无意改成手工确认。网络失败保留未添加标签；输入法组合期间 Enter 不提交。
- `DraftDialog` 只保护未提交草稿。浏览器离开有 beforeunload；对象切换只检查未添加标签，文档切换检查全部草稿，成功切换后清空。
- 对象焦点紫色，筛选绿色，预览蓝色。批量页隐藏已记忆对象的焦点，回对象页/退出筛选恢复，焦点从不参与查询。
- 只对预览命中的段落渲染两份文字，修改前/预览后上下排列。屏幕外顶层段落的内容区域与表格用 content-visibility，段落编号和焦点框留在绘制隔离区域之外，避免被裁切。变化清单分批展示；当前不是完整 DOM 虚拟化。提交期间两个退出预览入口均禁用。
- Word 的左右字符/磅缩进进入格式投影。屏幕显示将负首行缩进与左侧预留空间配对，并按容器百分比封顶，避免悬挂文字跑出阅读纸面。原始值仍保留在检查器与导出中，这一适配不是 Word 精确排版。
