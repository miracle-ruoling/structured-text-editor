# copyQ 参考调研

日期：2026-10-19。路径：`C:\Users\20979\RP_Projects\copyQ`。仅阅读，未修改或复制代码。

阅读：`pyproject.toml`、`clipfmt/convert.py`、`clipfmt/docstyle.py`、`clipfmt/cellalign.py`、`tests/test_docstyle.py`、`deskpad/README.md`、`deskpad/pyproject.toml`。

## 可借鉴

- 转换层基于 Pandoc，DOCX 生成后通过 OOXML 修补字体、表格、列表等细节。
- `Normal` 不等于所有正文；Pandoc 还使用 `BodyText`、`FirstParagraph`。
- 列表与表格可共用 `Compact`，仅按样式修改会造成连带影响。新项目必须查询结构上下文。
- 字体有 eastAsia/ascii/hAnsi/cs 与主题属性；明确设字体时要消除对应主题引用。
- 字号为半磅；段落间距等常用 twips，字符缩进使用百分之一字符。单位必须明确。
- OOXML 属性有顺序，保留原树时不能随意追加到未知位置。
- 上游用最小 XML 测试有价值，但新项目还需要 ZIP 项保留、表格内外隔离、超链接与公式等复杂对象不被波及的测试。

## 不直接复用的部分

- 不引入剪贴板、热键、托盘、Qt 界面或其耦合配置。
- 不使用 Markdown 作为已有 DOCX 的中转，否则无法实现本阶段的原包保留目标。
- 不复制基于非嵌套表格假设的正则 XML 替换；本项目使用 lxml 与祖先检查处理嵌套结构。
- 不继承「所有某样式对象一起改」的产品限制。分类与 Word 样式分离，标签只服务本项目语义。

copyQ 提供的是兼容性经验，架构由本项目的对象模型与操作边界独立决定。
