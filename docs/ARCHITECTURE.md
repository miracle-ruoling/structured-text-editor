# 文序架构（截至 2C 反馈 F1）

2026-10-21。与 PLAN.md 配套。第 8–14 节记录各阶段实现历史；F1 最新交互以第 15 节为准，旧的按页范围与锁定已移除。类别模板 F2 尚未实现。

## 1. 数据流

```text
导入 DOCX / sdoc
  → ProjectStore 校验并保存原文件
  → DocxPackage 读取 ZIP 和 XML
  → StyleResolver + project_document 生成结构投影
  → 叠加语义标注 → 重建章节 → 有序规则 → 局部格式及逐 run 字号覆盖
  → 前端阅读视图与对象检查

选择器 → domain.selectors.select → 命中 ID
格式草稿 → preview（只读）→ apply（检查 revision）
  → commit（保存原状态到历史）→ 原子保存 JSON

导出 DOCX：原文件 + 规则与局部覆盖的有效补丁 → 定点修改 document.xml → 实际输出保留审计
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
- `docx/writer.py`：只写明确设置的属性及逐 run 字号，其他属性保留。
- `domain/sizes.py`：相对字号纯计算、中文档位与局部字号投影。
- `domain/structure.py`：按语义角色与原大纲划分章节。
- `docx/inheritance.py`：主题字体及编号定义读取。
- `docx/audit.py`：实际输出的 ZIP、段落、文本、非格式结构保留检查。
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

JSON `version=4`；包含项目名、源文件 SHA-256、revision、更新时间、段落 annotations、命名筛选 saved_selectors、有序 rules、undo/redo。每个 annotation 保存可选手工 role、tags、局部 format 与 sizes（段落标记和逐 run 绝对字号）。规则不固化为 annotation。兼容读入 v1/v2/v3，项目 JSON 下一次保存才写为 v4；旧状态/快照缺少的集合默认为空。新包需要当前版本读取，源 DOCX 永不覆盖。

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

`all` 是交集、`any` 是并集。role/tag/context/ids/chapter/section 支持 is/is_not；text 另支持 contains/not_contains，文本匹配不区分大小写。标签匹配完整标签而非子串。空 all 选所有可编辑段落，空 any 无匹配。API 保留最多 5 层嵌套；UI 使用条件列表和高级表达式，命名筛选不接受嵌套 JSON 分组。前端以 selectionSession 管理当前条件、启用状态及上次退出的恢复快照：简单模式清空条件/退出筛选进入未筛选，不发送筛选请求；只有显式「全部内容」用空 all 表达全选。空标签/文字/框选/表达式在补全前不发请求。

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
| bold / italic | 不设置 / true / false | rPr/b、i，显式 1/0 |
| page_break_before / keep_next / keep_lines / widow_control | 不设置 / true / false | pPr/pageBreakBefore、keepNext、keepLines、widowControl，显式 1/0 |
| sizes | 每个源 run 与段落标记的绝对磅数 | 按索引写对应 rPr/sz、szCs |

不改 styles.xml，不使用会影响未选中对象的样式批量替换。字体与字号写入所选段落的直属普通文字 run（包括超链接中的 run），不重建内容。数学对象保持原始 XML，首版不编辑数学字体/排版。

无格式覆盖时导出直接返回原 DOCX 字节。存在覆盖时仅重新序列化 document.xml；ZIP 内其他项的解压后内容保持逐字节一致。压缩容器字节和 document.xml 的序列化形式不承诺完全相同。修改字号等可能自然导致 Word 重新分页。

浏览器阅读视图读取常见样式、直接格式、字符样式和混合 run 属性。它不是完整 Word 排版引擎；已支持常见主题字体、编号定义与级别段落属性；条件表格样式、完整编号序列/布局、网格细节仍未完整实现。检查器会标出已知属性来源，未知值不伪造为确定值。

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
| GET | /api/projects/{id}/export/docx、project | 下载结果（DOCX 自动保留检查） |
| GET | /api/projects/{id}/export/report | 只读生成实际 DOCX 差异与兼容性报告，不改修订 |

预览、提交、标注与历史操作带 revision。冲突返回 409，前端重新加载最新状态并提示重新预览。用户输入非法返回 400/422。文件路径不由请求参数直接决定。

## 7. 后续扩展边界

- 阶段 2B 持续规则已建立在当前选择器之上，有独立优先级、冲突解释、覆盖与清除语义；2C 已补常见继承、相对字号、结构范围和实际导出报告。
- 阶段 3 的原生编辑模型需要持久节点 ID 和内容事务；当前原包定位方案仅适用于结构未变的 DOCX 修改。
- 将来的原生导出与当前保留式导出使用不同适配路径，明确记录支持/降级的属性。
- 当前 .sdoc version=4 是工作项目格式，兼容读取 v1/v2/v3，并非最终通用文档格式。


## 8. 验收后交互修复

- 此节为早期交互记录：当时 workspace.ts 管理页签和锁定；F1 已改为 formatDraft.ts 统一草稿，workspace.ts 保留选择器完整性和屏幕缩进。
- 预览冻结 selector、patch、sizeChange 和 revision，提交使用冻结请求；更改格式、页签或筛选时清除旧预览。取消保留草稿，成功应用默认清空全部，锁定时保留；明确勾选才能跨页签提交。
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
- `DocumentCanvas` 对规则及单次预览均采用完整 after_blocks；仅变化段落增加前后副本。切换工作页签取消预览并保留草稿。
- `FormatSources` 解释当前属性来源及被覆盖层，提供局部单项/全部清除；只读对象无可用修改入口。
- `BulkAnnotations` 可折叠；动作、类别、标签草稿放在 App，跨页签不重置动作。按钮显示当前命中数，成功后清空标签输入。
- `ObjectQuickMenu` 在 body portal 中显示，尺寸定位受视口约束；外部点击/滚动/Esc 关闭。支持 Shift+F10、箭头切换按钮和键盘 focus，Esc 不穿透退出当前预览。检查对象不隐式加入筛选，框选仍需显式复制为条件。
- 静态组件测试在 .artifacts/ui-tests 下临时编译并渲染，复用已安装的 Vite/esbuild，不启动浏览器、不访问本机网页。它能检查 JSX 输出与完整预览结果，不能代替点击、焦点或视觉实测。


## 13. 阶段 2C：相对字号与 Word 继承

`FormatRequest.size_change` 是可选单次请求，mode 为 points/chinese_steps，amount 非零；不能与 patch.size_pt 同时指定。points 半磅步进且单次 ±100 磅；中文整数 ±15 级。计算结果必须在 1–200 磅且半磅步进。中文序列和非标准档位算法见 STAGE2C.md。

`ProjectStore.prepare_format` 校验 revision、匹配一次，基于当前规则/局部格式下每个可见 run 的有效值构造候选 `SizeOverrides`；任一未知/越界则整笔失败。sizes.paragraph_pt 为可选段落标记，sizes.runs 用源 own_runs 索引的字符串映射到绝对磅数，索引不因跳过无文本 run 而重新编号。空段落必须解析标记字号；非空段落的未知标记可留空。字号覆盖最后叠加于普通 patch，计入局部来源、混合属性和规则有效数。所有预览返回实际候选 after_blocks，与 apply 共用计算路径。

逐 run 字号跟随 Annotation 进入全部快照、项目包和去重；v4 导入校验当前/历史的段落和可见 run 索引。绝对 patch.size_pt 清除 sizes；相对操作移除旧局部统一字号；清除 size_pt 同时清除 sizes。持续规则只能是绝对 patch，不保存 size_change，因此规则重算不累加；用户再次显式应用才继续增减。

DOCX 关系解析只读包内主题、设置、编号，不访问外部 URL。ThemeFonts 处理 major/minor Latin、eastAsia 及常见语言 Hans/Hant/Jpan/Hang 补充字体；同层主题引用优先，后层直接字体可覆盖继承引用。StyleResolver 合并文档默认、编号段落格式、段落样式、段落直接属性；文字另加字符样式和 run 直接属性。样式粗斜体 true 为 toggle、false 不改变继承；run 直接 true/false 是绝对开关。编号字形 rPr 不污染正文 run。

原大纲、编号实例/级别/模板/起始覆盖、分节和分页属性用于解释。精确/最小行距读取 line_spacing_pt 与 line_spacing_rule，单次/规则改为倍数时清理旧类型。此阶段仍不完整解析条件表格样式、复杂脚本或编号计数，未引入 Word 排版引擎。

## 14. 结构范围与导出检查

`domain.structure.assign_chapters` 在语义 role/tags 更新之后、规则匹配之前执行。表格外小标题建立章节栈，原大纲 0–8 转成 1–9 级，无原级别按一级。每段 chapter_ids 包含当前章节与祖先；intro 是首个标题前的内容。章节 ID 为标题段落 ID，表格内标题不影响外层章节。物理分节在 DOCX reader 按 body 的 sectPr 划分，结束段落归前一节，ID 为 sec1 等。章节、分节、角色、标签独立。

`missing_scopes` 校验引用是否存在，包含否定条件。普通 select/preview/apply 抛错；持续规则保留定义并以 scope_warning 暂停匹配，撤销恢复结构后自动恢复。前端下拉明确显示失效项，不静默换成其他范围。章节与分节条件随项目保存，不允许直接跨文件复用。

`word_export` 合成普通有效 patch 和局部 sizes，writer 只改源 document.xml，再调用 `audit_export`。审计比较 ZIP 成员与数据、所有段落 XML、文字/域指令/数学文本，并在支持写入的格式节点归一化后比较其余 XML 结构（包括文档、表格、对象）。非预期段落/包文件/文本/结构变化会拒绝下载。此审计不是全部 OOXML 属性的语义验证，也不验证视觉分页。

报告包含 revision、project_id、源/输出散列、变化段落与格式/字号、变化和保留的 ZIP 项、保留检查结果、失效规则与已知限制。只读 GET 不增加项目或修订；未应用草稿不参与。顶部可选查看报告，直接 Word 导出也执行检查。ExportInspection 用原生 modal dialog，Esc 只关闭它；下载 JSON 使用正在显示的报告，状态更新后清除旧报告。变化列表按 30 段展开，章节导航按 40 项展开。


## 15. 2C 反馈 F1：自动预览与统一草稿

`FormatDraft={patch,sizeChange}` 是单次操作唯一草稿。formatDraft.ts 提供绝对输入（同时清除相对动作）、中文净级数累计（零为无修改）、字段有效值与请求签名。已填写绝对字号时 A 按钮改变该值；没有绝对值时以已保存各 run 为基础累计级数。响应中的字号只作显示，不自动反写统一输入，保留混合 run。旧 scopedPatch/scopedSizeChange/afterApply 的页签/锁定工具及过时测试移除。

`LatestPreview` 在 180ms 后调度，运行中只保留最新 pending，最多一个请求；后续变更递增 generation，旧响应或旧错误不得发布。取消清空 pending 并使旧请求失效；卸载 abort 客户端请求。由于服务器同步计算不可中途取消，普通 supersede 等待当前结束后只执行最新任务，避免网络取消后服务端还积压工作。

`useFormatPreview` 以 project id/revision/selector/完整草稿签名管理新鲜度，不占全局写操作 busy。输入/范围/版本变化在 render 时就使 ready 为 false，而非等待 effect 才禁用应用。仅相同范围与版本的上次 frame 可在更新时显示，并标注为旧效果；不同范围立即移除。非法数值不请求；服务错误保留输入可重试，409 提供同步状态入口。App 应用冻结请求与 revision，成功后清空全部草稿；取消/Esc 也清空，成功撤销/重做清空单次草稿以看清历史结果。工作页切换/退出筛选暂停预览但保留草稿，回来重新计算。

`FormatFields` 为文字/段落两个折叠组，不再有按页范围；每组显示待应用数。`FormatPanel` 汇总所有待应用属性，提供逐项移除、统一应用和取消，无草稿锁定开关。对单次字号默认绝对输入+A 增减；规则暂共用折叠控件，但仍保留显式预览/保存流程，待 F2 完整替换。

DocumentCanvas 的 livePreview 默认替换原位置文字，不创建双份节点；显式 compare 才显示前后对照。ParagraphText memo 保留未变化文字片段，现有 content-visibility 继续减少屏幕外绘制。无完整虚拟列表，5,000 段全选仍可见等待，不作逐帧响应承诺。

POST preview 可带 `?compact=true`，不改变计算路径与提交契约，仅省去 after_blocks 的来源追踪/语义元信息，返回 id、format、runs、mixed。原接口默认完整输出兼容旧调用。预览仍只读，不写历史。分页 warnings 由 domain/pagination.py 从候选 layout 中同容器相邻段落和有效格式计算；只报告本次范围触及的 keep_next / 后段 page_break_before 边界，各表格单元格独立。规则预览、Word 报告复用，不自动修正或拒绝合法的分页设置。

帮助提示支持鼠标悬停与键盘聚焦；错误及提交/范围状态常驻。导出弹窗新增标准解释，不改变既有审计算法。F1 无项目 schema 变化，v4 及旧包读取兼容。F2 将以类别一次性模板替换规则，同时设计旧规则/历史迁移，不能先删除数据或静默改变当前格式。
