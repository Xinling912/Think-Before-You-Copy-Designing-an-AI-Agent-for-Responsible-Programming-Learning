# 老师反馈对齐说明

## 1. 老师反馈要点

老师反馈集中在四点：

1. 项目从用户体验角度切入是可行的；
2. 文档需要更详细，但总体思路可行；
3. GitHub 上的教育 skill 库与项目高度相关；
4. 重点必须是学习目的，不能过度使用 AI，不能只展示易用性或功能性。

此外，老师建议在 Agent 界面上加入可视化元素：

- 知识图谱；
- learning graph；
- 指标；
- 可视化表征；
- 结果显示位置和形式。

## 2. 对齐策略

ResponsibleEduAgent 的 MVP 直接回应这些反馈：

| 老师反馈 | MVP 对应设计 |
| --- | --- |
| 关注学习目的 | 采用 retrieve-first、hint ladder、teach-back，不直接给答案 |
| 控制过度使用 | 记录直接答案次数、提示等级、学生先尝试证据 |
| GitHub skill 相关 | 引入 education-agent-skills 清单，并选 5 个作为 MVP |
| 需要可视化 | 右侧学习证据面板展示 KG 路径、skill、信心、提示等级 |
| 需要详细文档 | `docs/architecture.md` 和 `docs/mvp-design.md` 作为总纲与 MVP 说明 |

## 3. 界面证据位置

当前 MVP 的可视化证据集中在 Ant Design Pro 后台：

| 页面 | 老师能看到什么 |
| --- | --- |
| `/dashboard` | MVP 范围、skill 数、KG 路径节点数和学习链路 |
| `/session-demo` | 学生问题、Agent retrieve-first 提示、右侧学习证据面板 |
| `/skills` | 165 个 skill 清单，MVP 5 个置顶 |
| `/kg` | `list -> index -> zero_based_index -> IndexError` |
| `/rag` | `python-official-docs / python-list-index-001` 来源 |
| `/evidence` | retrieve-first、confidence、KG、RAG、teach-back 证据事件 |
| `/harness` | check、Go test、Python test、frontend build、Docker smoke 命令 |

截图应优先截 `/session-demo`，因为它同时展示学习对话和证据面板。第二张截图截 `/skills`，证明项目不是随便挑 5 个 prompt，而是从 165 个候选 skill 中挑出 MVP 子集。

## 4. MVP 叙事

MVP 不展示“AI 帮我写代码”。MVP 展示：

> AI Agent 如何让学生先思考、再获得提示、再解释自己的理解，并把这个过程记录成学习证据。

这个叙事与责任型 AI 教育方向一致。系统强调学习过程、证据记录、过度依赖控制、知识结构和可验证性。

## 5. 交付证据

当前 MVP 已经有三层可验证证据：

1. **行为证据**：`scripts/e2e_index_error_smoke.py` 验证学生提问后第一步是 `retrieve-first-gate`，并验证 KG、RAG、hint ladder、teach-back、evidence API。
2. **工程证据**：`./check.sh --full` 验证 Go、Python、前端构建和隐私扫描。
3. **交付证据**：`docker build -t responsible-edu-agent .` 和 `docker run -p 8080:8080 responsible-edu-agent` 验证单端口 Docker 交付。
