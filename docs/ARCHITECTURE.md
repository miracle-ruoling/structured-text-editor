# 文序架构（截至阶段 2B）

2026-10-20。与 `PLAN.md` 配套，记录已经实现的行为。

## 1. 数据流

```text
导入 DOCX / sdoc
  → ProjectStore 校验并保存原文件
  → DocxPackage 读取 ZIP 和 XML
  → StyleResolver + project_document 生成结构投影
  → 叠加语义标注 → 有序规则 → 局部格式覆盖
  → 前端阅读视图与对象检查

选择器 → domain.selectors.select → 命中 ID
格式草稿 → preview（只读）→ apply（检查 revision）
  → commit（保存原状态到历史）→ 原子保存 JSON

导出 DOCX：原文件 + 规则与局部覆盖的有效补丁 → 定点修改 document.xml
导出 sdoc：原文件 + 完整项目 JSON → ZIP 项目包
```

文档内容不通过 Markdown、HTML 或富文本编辑器中转。首版不编辑文本结构。

## 2. 文件与模块

- `domain/models.py`：Pydantic 边界模型；字段白名单、单位与范围、选择器树、标注和历史快照。
- `domain/selectors.py`：唯一的筛选求值实现，供高亮、预览、提交共用。不可编辑对象永不参与操作。
- `domain/rules.py`：纯格式投影、规则变更验证、逐属性来源与统计；不读文件、不拼 XML。
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

JSON `version=3`；包含项目名、源文件 SHA-256、revision、更新时间、段落 annotations、命名筛选 saved_selectors、有序 rules、undo/redo。每个 annotation 保存可选手工 role、tags、局部 format。规则不固化为 annotation。兼容读入 v1/v2，项目 JSON 下一次保存才写为 v3；旧状态/快照缺少的集合默认为空。新包需要当前版本读取，源 DOCX 永不覆盖。

`.sdoc` 是 ZIP，内含同名两个文件。重新导入时检查源文件散列；完全一致的源文件、标注、命名筛选、规则和历史快照复用现有项目；不同状态校验标注段落 ID 后生成新项目 ID 与不重名的显示名称，避免覆盖现有项目。DOCX 字节完全相同时打开最近的已有项目。项目包包括最近 50 次历史，可在重新打开后撤销。

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

`all` 是交集、`any` 是并集。role/tag/context/ids 支持 is/is_not；text 另支持 contains/not_contains，文本匹配不区分大小写。标签匹配完整标签而非子串。空 all 选所有可编辑段落，空 any 无匹配。API 保留最多 5 层嵌套；UI 使用条件列表和高级表达式，命名筛选不接受嵌套 JSON 分组。前端以 selectionSession 管理当前条件、启用状态及上次退出的恢复快照：简单模式清空条件/退出筛选进入未筛选，不发送筛选请求；只有显式「全部内容」用空 all 表达全选。空标签/文字/框选/表达式在补全前不发请求。

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
| POST | /api/projects/{id}/selections/save、delete | 保存/删除命名筛选，带 revision，可撤销 |
| POST | /api/projects/{id}/rules/preview、apply | 持续规则预览与变更，带 revision |
| POST | /api/projects/{id}/overrides/clear | 清除项目局部格式覆盖，可撤销 |
| POST | /api/projects/{id}/annotations/bulk | 按筛选一次性增删标签、设置/恢复类别 |
| GET | /api/projects/{id}/export/docx、project | 下载结果 |

预览、提交、标注与历史操作带 revision。冲突返回 409，前端重新加载最新状态并提示重新预览。用户输入非法返回 400/422。文件路径不由请求参数直接决定。

## 7. 后续扩展边界

- 阶段 2B 持续规则已建立在当前选择器之上，有独立优先级、冲突解释、覆盖与清除语义；2C 继续完善 Word 继承、相对字号和差异报告。
- 阶段 3 的原生编辑模型需要持久节点 ID 和内容事务；当前原包定位方案仅适用于结构未变的 DOCX 修改。
- 将来的原生导出与当前保留式导出使用不同适配路径，明确记录支持/降级的属性。
- 当前 .sdoc version=3 是工作项目格式，兼容读取 v1/v2，并非最终通用文档格式。


## 8. 验收后交互修复

- `workspace.ts` 定义提交页签范围、应用后的草稿状态、选择器完整性、阅读用缩进计算，独立做纯逻辑测试。
- 预览冻结 selector、patch 和 revision，提交使用冻结请求；更改格式、页签或筛选时清除旧预览。取消保留草稿，成功应用默认清空全部，锁定时保留；明确勾选才能跨页签提交。
- `ChoiceInput` 采用原生 select + 显式自定义输入，候选项不按旧值过滤；选项使用内部索引，避免自定义值与特殊入口冲突。
- 对象标注改为立即提交。标签只更新 tags，不把原自动 role 无意改成手工确认。网络失败保留未添加标签；输入法组合期间 Enter 不提交。
- `DraftDialog` 只保护未提交草稿。浏览器离开有 beforeunload；对象切换只检查未添加标签，文档切换检查全部草稿，成功切换后清空。
- 对象焦点紫色，筛选绿色，预览蓝色。批量页隐藏已记忆对象的焦点，主动回对象页时恢复，退出筛选不切换页签；焦点从不参与查询。
- 只对预览命中的段落渲染两份文字，修改前/预览后上下排列。屏幕外顶层段落的内容区域与表格用 content-visibility，段落编号和焦点框留在绘制隔离区域之外，避免被裁切。变化清单分批展示；当前不是完整 DOM 虚拟化。提交期间两个退出预览入口均禁用。
- Word 的左右字符/磅缩进进入格式投影。屏幕显示将负首行缩进与左侧预留空间配对，并按容器百分比封顶，避免悬挂文字跑出阅读纸面。原始值仍保留在检查器与导出中，这一适配不是 Word 精确排版。

## 9. 阶段 2A：高级与持久选择范围

- `domain/expressions.py`：只解析 `$代号`、AND/OR/NOT 和括号；优先级 NOT > AND > OR。最多 2000 字符、256 token、32 层，缓存有限。无 eval。后端对失效引用/重复代号/空条件报错，错误不会降级为全选。
- `Selector(mode="expression")` 的 conditions 是带 key 的叶子列表，expression 保存关系。`domain/selectors.py` 统一编译为谓词，ID 范围先变为集合，避免逐段线性搜索长 ID 列表。匹配、预览、提交均排除只读对象。
- `frontend/src/lib/selection.ts`：给条件分配稳定代号；删行后其他代号不变，新条件不接管表达式尚在引用的缺失代号；显式范围复制为快照。前端仅做输入状态和引用提示，真值求值统一走后端。
- App 中 current 是检查焦点，marked 是复选框临时集合，selector 是实际批量范围。三者独立。“加入筛选条件”复制 ids 快照；已有快照无更新/字段切换入口，需要删除后重新加入；“仅调整此段”替换为一个 ID 条件并进入现有格式面板。
- 命名筛选最多 50 个，名称最多 60 字符且不重名，保存在当前项目。新增/删除使用相同 revision 与 commit/travel 历史，快照同时保存 annotations 与 saved_selectors。普通标注/格式事务也携带命名筛选状态，避免撤销时丢失。只保存条件，不含格式、不持续应用。
- `AnnotationRequest.reset_role` 清除手动覆盖，保留标签和格式；不能与新 role 同时提交。现有 confirmed 响应字段保留兼容，其含义仅为有手动覆盖，界面不再把它呈现为确认进度。
- 命名筛选只保存 UI 可编辑的单层条件列表或表达式；旧的嵌套 selector API 仍可用于查询/格式事务。框选 ID 属于原 DOCX，不能跨文档复用。


## 10. 2A 筛选交互收尾

- `emptySelectionSession/activateSelection/leaveSelection` 统一会话状态。首次进入与切换文件清空历史；退出清空实际条件，将上次范围深复制到 previous。恢复（包括全选空 AND）需要显式操作，删除最后一个简单条件不能隐式全选。高级失效引用留在编辑态报错。
- SelectorBuilder 在未启用时只渲染空闲容器，活动条件、表达式、保存栏和匹配摘要均不渲染。退出筛选清除匹配/预览/仅匹配视图，不修改工作页签或格式草稿。
- 高级表达式在条件列表与添加入口之后渲染；快照行只呈现类别、关系和计数，编号另占一整行折叠展示。快照范围不可原地更新，关系是/不是仍可改。
- 全局筛选暂缓：当前保存范围属于项目，未来与持续规则模板共用可跨文档的语义条件；含 ids 的快照不得直接跨文档使用。


## 11. 阶段 2B：规则投影与事务

`FormatRule` 含 id、name、selector、patch、enabled，复用已有选择器和 FormatPatch 校验。规则条件是 UI 可编辑的单层条件/高级表达式。Project 和 Snapshot 同时记录 rules、annotations、saved_selectors；任何一种操作的撤销均恢复三者，旧项目读取不改写。

`domain.rules.resolve(original, project)` 深复制源投影，先写入语义 role/tags，再匹配每条启用规则，按列表顺序逐属性 overlay，最后叠加局部 Annotation.format。匹配只看语义而非格式，不存在格式循环；全部操作排除只读对象。first_line_chars/line_spacing 覆盖时清理对应磅属性，字体属性投影到各 run，只有被设置的混合属性才被消解。

每段返回 `effective_patch`（导出用）、`format_trace`（原来源、命中规则、局部覆盖，最后一层胜出）与本来的 `overrides`（仅局部）。每条规则附带 `matched_count`（含停用时的潜在命中）、`effective_count`（启用且至少有一项属性由它最终决定的段落数）。后者是归属统计，不等于与原文件视觉不同的段落数。

`RuleRequest` 动作 save/delete/toggle/move 的参数互斥，完整验证后 commit。新增/修改先 preview，再使用冻结请求和 revision 提交；列表启停/删除/移动直接提交，可撤销。preview 在候选项目上计算，比较段落 format/runs/mixed，返回变化段落的完整 `after_blocks`，不把“删除属性”误当成空补丁。零视觉变化也能保存有效定义。

`ProjectStore.export_annotations` 从有效补丁构造传给原 DOCX writer 的 Annotation 映射。所有规则计算仍在领域层；XML 只由适配器操作。没有有效补丁则 writer 返回源字节，因此撤回规则可完整恢复原始混合 run 格式，无需把当前显示值反写回原包。

`annotations/bulk` 先匹配一次，再构造所有候选标注并校验，最后原子 commit；添加标签不重复，移除不替换其他标签，类别与格式保持独立。30 标签上限等错误不会部分保存。`overrides/clear` 只删除指定局部键，恢复下层，不清除源 Word 的直接格式。

## 12. 2B 前端状态与组件

- 第三工作页 `RulePanel` 管理规则列表/草稿；`App.rule` 独立于单次 `patch`，`rulePreview` 独立于单次预览。`lib/rules.ts` 复制持久字段、剔除统计并检测未提交编辑。草稿和未添加的批量标签纳入离开文档保护。
- `FormatFields` 复用文字/段落输入。单次格式仍用 scopedPatch；规则完整保存两个页签的所有属性，界面明确显示完整摘要。不复用锁定/单页提交开关，以免产生隐式作用域。
- 规则条件从当前有效筛选复制，随后独立；修改通过载入批量筛选编辑再显式采用。规则页隐藏批量绿色高亮与仅匹配视图，避免把不相关的批量范围当成规则范围。
- `DocumentCanvas` 对规则预览采用完整 after_blocks，单次预览继续用统一补丁；仅变化段落增加前后副本。切换工作页签取消预览并保留草稿。
- `FormatSources` 解释当前属性来源及被覆盖层，提供局部单项/全部清除；只读对象无可用修改入口。
- `BulkAnnotations` 可折叠；动作、类别、标签草稿放在 App，跨页签不重置动作。按钮显示当前命中数，成功后清空标签输入。
- `ObjectQuickMenu` 在 body portal 中显示，尺寸定位受视口约束；外部点击/滚动/Esc 关闭。支持 Shift+F10、箭头切换按钮和键盘 focus，Esc 不穿透退出当前预览。检查对象不隐式加入筛选，框选仍需显式复制为条件。
- 静态组件测试在 .artifacts/ui-tests 下临时编译并渲染，复用已安装的 Vite/esbuild，不启动浏览器、不访问本机网页。它能检查 JSX 输出与完整预览结果，不能代替点击、焦点或视觉实测。
