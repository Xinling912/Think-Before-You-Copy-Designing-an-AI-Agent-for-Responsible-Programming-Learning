# ResponsibleEduAgent MVP 设计

## 1. MVP 定义

MVP 展示一个完整但收敛的责任型教育 Agent 流程。系统围绕 Python `list index` / `IndexError` 场景构建，不追求覆盖所有 Python 概念。

MVP 的核心展示点：

1. 学生先产生认知证据；
2. Agent 不直接给最终答案；
3. 知识图谱解释“为什么查这些知识点”；
4. RAG 给出“回答依据来自哪里”；
5. 教学 skill 控制提示层级；
6. 学习证据面板可视化本轮学习过程；
7. Harness/check.sh 阻止不合规变更。

## 2. MVP 场景

学生输入：

```text
为什么我的 Python list 报 IndexError？
```

Agent 的流程：

1. 触发 `retrieve-first-gate`：要求学生先说出自己对错误原因的猜测。
2. 触发 `confidence-calibration-check`：记录学生答前信心。
3. 触发 `stuck-and-error-diagnosis-coach`：要求学生指出错误发生位置和错误类型。
4. 查询知识图谱：`list -> index -> zero_based_index -> IndexError`。
5. RAG 检索官方 Python 文档、课程资料或项目内资料 chunk。
6. 触发 `progressive-hint-ladder`：按提示等级逐步提供帮助。
7. 学生修正后触发 `teach-back-evaluator`：要求学生用自己的话解释错误原因。
8. 系统记录学习证据并更新短期/中期记忆。

## 3. MVP 知识图谱范围

第一版知识图谱只覆盖与 `list index` 相关的最小闭环：

- `variable`
- `object`
- `type`
- `list`
- `index`
- `zero_based_index`
- `slice`
- `len`
- `for_loop`
- `range`
- `enumerate`
- `IndexError`
- `TypeError`
- `assignment_vs_equality`
- `index_starts_at_one`

第一版不通篇抽取教材知识图谱。系统以官方章节目录和课程目录作为骨架，再围绕 MVP 场景抽取精确概念和关系。

## 4. MVP 可视化

MVP 页面包含两部分：

1. 左侧：学生与 Agent 的学习对话；
2. 右侧：学习证据面板。

学习证据面板显示：

- 当前知识点；
- 知识图谱路径；
- 使用的 pedagogical skill；
- 直接答案次数；
- 提示等级；
- 学生是否先尝试；
- 答前信心；
- 答后信心；
- teach-back 是否完成；
- RAG 来源；
- 过度依赖风险。

## 5. Skill 上限与 LRU

系统采用 skill 存储上限机制：

| Skill 类型 | 数量 | 淘汰策略 |
| --- | ---: | --- |
| 核心 skill | 8-10 | 固定保留 |
| 学生个性化 skill | 10-15 | LRU + 成功率淘汰 |
| 临时探索 skill | 5-10 | TTL / LRU 淘汰 |

总上限为 30 个。核心 skill 设置 `pinned: true`，永不淘汰。普通 skill 根据 `last_used_at`、`use_count`、`success_score` 和当前学习目标相关性排序淘汰。

## 6. MVP 验收标准

MVP 完成时必须满足：

- 能演示完整 `IndexError` 学习流程；
- 能显示知识图谱路径；
- 能显示 RAG 来源；
- 能显示学习证据面板；
- 能证明 Agent 没有直接代替学生完成学习；
- 能通过 `check.sh`；
- 能解释 5 个 MVP skill 与 165 个候选 skill 的关系。

## 7. 为什么这个 MVP 能证明教育价值

这个 MVP 的成立点不是“模型回答了 IndexError 是什么”，而是完整保留并展示学习过程：

1. **先提取学生认知证据**：`retrieve-first-gate` 要求学生先猜原因、说索引和长度，系统记录 `student_attempt_required`。
2. **控制答案强度**：`direct_answer_given=false` 和 `hint_ladder` 证明系统没有第一步直接给最终答案。
3. **把帮助绑定到知识结构**：KG path 明确显示帮助从 `list`、`index`、`zero_based_index` 走到 `IndexError`。
4. **把回答绑定到来源**：RAG source 显示依据来自 `python-official-docs / python-list-index-001`，不是无来源闲聊。
5. **用 teach-back 验证理解**：`teach_back=required` 要求学生复述，避免“看懂幻觉”。
6. **用 evidence API 留痕**：`GET /api/session/:id/evidence` 能读取本次学习证据，后台可展示给老师或研究者。

因此，MVP 展示的是“AI 如何促进学习并留下证据”，不是“AI 如何快速给答案”。

## 8. 当前可运行交付

Docker 是当前标准交付物：

```bash
docker build -t responsible-edu-agent .
docker run --rm -p 8080:8080 responsible-edu-agent
```

完整检查：

```bash
./check.sh --full
REA_BASE_URL=http://127.0.0.1:8080 ./check.sh --e2e
```

Windows 11 使用 Docker Desktop 后执行同等命令：

```powershell
docker build -t responsible-edu-agent .
docker run --rm -p 8080:8080 responsible-edu-agent
.\check.ps1 -Full
.\check.ps1 -E2E
```
