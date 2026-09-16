# ResponsibleEduAgent 论文方法实施方案

本文档定义论文方法如何进入 ResponsibleEduAgent 的工程实现、管理端界面、实验 Harness 和论文实验表。每一条规则都来自 `docs/research/dissertation_reference.md` 中的论文方法，不使用未标注来源的自创机制。

## 一、实施边界

| 项目 | 固定规则 |
| --- | --- |
| 论文对象 | 34 篇论文，来源见 `docs/research/dissertation_reference.md` |
| 第一场景 | Python `list index / IndexError` |
| 知识来源 | Python 官方教程、Think Python 2e、Python for Everybody、菜鸟教程 Python3 |
| 对比基线 | `no_rag`、`rag_only`、`rag_kg`、`rag_kg_skills`、`full_memory` |
| 学生端 | `/`，只显示学习对话 |
| 管理端 | `/om`，显示会话复盘、证据、记忆、知识库、KG、Harness |
| 数据落库 | SQLite 为唯一主存储；FAISS 为向量索引；JSONL 为可复现实验日志 |
| 运行环境 | Docker 内必须启动 Go API、Python AI Core、React 构建产物、Harness runner |

## 二、前端设计方向

**Context:** 管理端面向研究者和教师，核心任务是复盘学习过程、检查证据、运行实验和定位失败原因。

**Anchor:** Swiss。管理端是高密度研究控制台，使用纯白背景、Helvetica Neue / system sans、1px 规则线、左对齐信息网格和单一蓝色强调，避免装饰性视觉抢走证据阅读空间。

**Differentiator:** 所有管理页使用同一个“三段证据轨道”：左侧选择对象，中间显示时间线，右侧显示可审计 payload；点击任意会话轮次，RAG、KG、Skill、Memory、Harness 日志同步切换。

**System tokens:**

| Token | 值 |
| --- | --- |
| Surface | `#FFFFFF`、`#F7F7F8` |
| Text | `#111827`、`#4B5563` |
| Accent | `#002FA7` |
| Error | `#E4002B` |
| Rule | `1px solid #D7DCE3` |
| Font | `Helvetica Neue, Arial, system-ui, sans-serif` |
| Radius | `0px` 到 `4px`，只用于 Ant Design 表单控件默认边界 |
| Shadow | 禁用卡片阴影 |

## 三、论文方法到系统合同

### 3.1 HELM：场景、指标、标准化条件

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 先定义 scenario，再定义 metrics，再在统一条件下评估模型。 | `harness_suites` 每条记录必须包含 `scenario_id`、`metric_ids`、`run_setting_id`、`model_config_id`。 |
| 使用多指标，不只看 accuracy。 | 每个 suite 至少包含 3 个指标；`rag_grounding` 固定包含 `context_relevance`、`answer_faithfulness`、`answer_relevance`。 |
| 公开 prompts、completions 和原始结果。 | `harness_runs` 必须保存 `prompt_json`、`completion_json`、`stdout_tail`、`stderr_tail`、`raw_result_path`。 |
| 在标准化条件下比较模型。 | 同一 suite 的所有 baseline 使用同一个 `question_set_id`、`temperature`、`top_p`、`retrieval_top_k`、`rerank_top_k`。 |

**数据表字段：**

```sql
create table if not exists harness_suites (
  id text primary key,
  title text not null,
  scenario_id text not null,
  metric_ids_json text not null,
  run_setting_id text not null,
  command_json text not null,
  timeout_seconds integer not null,
  pass_criteria_json text not null
);

create table if not exists harness_runs (
  id text primary key,
  suite_id text not null,
  baseline_id text not null,
  model_config_id text not null,
  created_at_beijing text not null,
  git_commit text not null,
  docker_image text not null,
  prompt_json text not null,
  completion_json text not null,
  metrics_json text not null,
  exit_code integer not null,
  duration_ms integer not null,
  stdout_tail text not null,
  stderr_tail text not null,
  raw_result_path text not null
);
```

**验收命令：**

```bash
cd services/api-gateway-go && ../../.tools/go/bin/go test ./internal/harness -run TestHELMSuiteContract -count=1
```

期望输出包含：

```text
PASS
ok
```

### 3.2 RAGAS：Reference-free RAG 三维评估

| 论文做法 | 系统照搬方式 |
| --- | --- |
| Answer relevance 衡量回答是否回应原问题。 | 每轮回答生成 `answer_relevance`，输入为学生问题、AI 回答、模型生成的检查问题集合。 |
| Context relevance 衡量检索上下文是否聚焦。 | 对 top-k chunk 逐句抽取能回答问题的句子，记录 `relevant_sentence_count` 和 `context_relevance_score`。 |
| Faithfulness 衡量回答是否忠实于检索来源。 | 将 AI 回答拆成 claims，逐条检查 claim 是否能由 RAG source 支撑。 |
| 不依赖人工参考答案。 | RAGAS 指标运行时只读取 `question`、`retrieved_contexts`、`answer`。 |

**Evidence payload 固定字段：**

```json
{
  "ragas": {
    "context_relevance": {
      "score": 0.0,
      "relevant_sentence_count": 0,
      "retrieved_context_count": 0
    },
    "answer_faithfulness": {
      "score": 0.0,
      "claims": []
    },
    "answer_relevance": {
      "score": 0.0,
      "generated_check_questions": []
    }
  }
}
```

**验收命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests/test_rag_metrics.py -q
```

期望输出：

```text
passed
```

### 3.3 ARES：合成 judge + 小规模人工校准

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 用合成训练数据训练轻量 judge。 | `eval/judges/rag_judge_training.jsonl` 存合成训练样本，每行包含 `question`、`context`、`answer`、`label_type`、`label`。 |
| 用人工验证集做 prediction-powered inference。 | `eval/calibration/rag_human_validation.jsonl` 少于 150 条时，系统将 `ppi_calibrated` 固定为 `false`。 |
| 评估 context relevance、answer faithfulness、answer relevance。 | 三个字段进入 `harness_runs.metrics_json.ares`。 |

**人工验证集 schema：**

```json
{
  "id": "hv_0001",
  "question": "为什么 list[2] 对长度为 2 的列表会报 IndexError？",
  "context_chunk_ids": ["python-docs-3.14.6-824a5cfe4526"],
  "answer": "Python 列表索引从 0 开始，长度为 2 时最大合法索引是 1。",
  "context_relevance": 1,
  "answer_faithfulness": 1,
  "answer_relevance": 1,
  "annotator": "researcher",
  "created_at_beijing": "2026-07-07T00:00:00+08:00"
}
```

**验收命令：**

```bash
python3 scripts/check_ares_calibration.py --min-human-labels 150
```

期望输出在人工验证集不足 150 条时固定为：

```text
ARES calibration incomplete: 0/150 human labels
```

该输出不是测试失败；它阻止论文结果表把 ARES 写成已校准指标。

### 3.4 RAGChecker：细粒度 RAG 故障定位

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 将 RAG 质量拆成检索侧和生成侧诊断。 | Evidence 详情固定分为 Retrieval、Generation Grounding、KG Path、Skill Decision、Memory Use 五个区块。 |
| 诊断失败来源。 | Harness 失败必须输出 `failure_layer`，枚举为 `retrieval`、`generation_grounding`、`kg_path`、`skill_workflow`、`memory`、`runner`。 |
| 不把总分当作唯一结论。 | `/om/evidence` 不显示单一总分；显示每层 pass/fail 和原始 payload。 |

**Evidence API 返回字段：**

```json
{
  "diagnosis": {
    "retrieval": {"status": "pass", "reason": "top source covers list index"},
    "generation_grounding": {"status": "pass", "reason": "all claims grounded"},
    "kg_path": {"status": "pass", "reason": "path includes list, index, IndexError"},
    "skill_workflow": {"status": "pass", "reason": "retrieve-first triggered"},
    "memory": {"status": "pass", "reason": "short-term message recalled"}
  }
}
```

**验收命令：**

```bash
cd frontend && npm test -- --run src/pages/Evidence/evidence.component.test.tsx
```

期望输出：

```text
✓ renders Retrieval
✓ renders Generation Grounding
✓ renders KG Path
✓ renders Skill Decision
✓ renders Memory Use
```

### 3.5 AgentBench：多轮 Agent 轨迹评估

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 把 LLM 当作 Agent，在交互环境中评估。 | Harness case 固定包含 `turns`，每个 turn 包含学生输入、期望状态、证据断言。 |
| 记录 agent 行为轨迹。 | `harness_runs.metrics_json.agent_trajectory` 保存每轮 `input`、`action`、`observation`、`state`。 |
| 按任务完成和过程质量判定。 | 每个 case 同时检查 `task_success` 和 `process_compliance`。 |

**Case schema：**

```json
{
  "case_id": "index-error-retrieve-first-001",
  "scenario_id": "python-list-indexerror",
  "turns": [
    {
      "student_message": "为什么我的 list 报 IndexError？",
      "expected_state": {
        "skill_id": "student-learning/retrieve-first-gate",
        "direct_answer_given": false
      },
      "evidence_assertions": [
        {"path": "kg_path", "contains": "ErrorType:IndexError"},
        {"path": "rag_sources", "min_length": 1}
      ]
    }
  ]
}
```

**验收命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 scripts/run_harness_case.py --case harness/cases/index-error-retrieve-first-001.json
```

期望输出：

```json
{"status":"passed","case_id":"index-error-retrieve-first-001"}
```

### 3.6 SWE-bench：固定环境中的可执行测试

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 在真实仓库和真实测试环境中评估。 | `/om/harness` 只执行 `harness/suites.json` 白名单命令。 |
| 保存环境和执行结果。 | 每次运行保存 `git_commit`、`docker_image`、`command_json`、`exit_code`、`stdout_tail`、`stderr_tail`。 |
| 以测试是否通过为准。 | UI 不允许手动把 failed 改成 passed；人工备注进入 `review_note` 字段。 |

**白名单规则：**

```json
{
  "allowed_executables": ["python3", "go", "npm", "./check.sh", "powershell"],
  "forbidden_tokens": [";", "&&", "|", "`", "$(", ">", "<", "rm", "curl", "wget", "ssh", "scp"]
}
```

**验收命令：**

```bash
docker build --target harness -t responsible-edu-agent:harness .
docker run --rm -p 18081:8080 responsible-edu-agent:harness
```

浏览器访问：

```text
http://127.0.0.1:18081/om/harness
```

点击 `Run` 后，`eval/harness_logs/YYYY-MM-DD/` 生成 UTF-8 JSON。

### 3.7 EvalPlus：边界测试增强

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 用自动生成和 mutation 增强测试用例。 | 自然语言测试编译器输出 `positive_cases`、`boundary_cases`、`mutation_cases`、`forbidden_behaviors`。 |
| 用更多测试发现原用例遗漏的错误。 | 每个 Python 教学 case 至少包含 1 个正例、2 个边界例、1 个 mutation case、1 个禁止行为。 |
| 评估 functional correctness。 | 对代码类问题运行 Python 断言；对教学策略类问题运行 evidence assertion。 |

**AI 编译输出 schema：**

```json
{
  "case_id": "index-error-boundary-001",
  "natural_language_request": "测试长度为2时访问list[2]不能直接给答案",
  "positive_cases": [{"input": "list长度是2，最大合法索引是多少？", "expected": "1"}],
  "boundary_cases": [
    {"input": "长度为0访问list[0]", "expected_error": "IndexError"},
    {"input": "长度为1访问list[1]", "expected_error": "IndexError"}
  ],
  "mutation_cases": [
    {"mutation": "把 '< len(list)' 错写成 '<= len(list)'", "expected_detection": true}
  ],
  "forbidden_behaviors": [
    "first_agent_turn_gives_final_code",
    "missing_retrieve_first_question"
  ]
}
```

**验收命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests/test_harness_compiler.py -q
```

期望输出：

```text
passed
```

### 3.8 G-Eval：CoT + form-filling 评审

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 输入 Task Introduction 和 Evaluation Criteria。 | Judge prompt 固定包含 `task_introduction` 和 `evaluation_criteria`。 |
| 生成 Evaluation Steps。 | Judge 输出必须包含 `evaluation_steps` 数组。 |
| 用 form-filling 输出评分。 | Judge 输出只接受 JSON form，不接受自由文本结论。 |
| 承认 LLM judge 偏向。 | 每条 judge result 必须保存 `requires_human_review`，默认值为 `true`。 |

**Judge form：**

```json
{
  "task_introduction": "Evaluate whether the tutor response follows retrieve-first teaching for a Python IndexError case.",
  "evaluation_criteria": [
    "The response asks the student to reason before receiving the final answer.",
    "The response uses retrieved Python learning material.",
    "The response does not invent source evidence."
  ],
  "evaluation_steps": [
    "Identify whether the answer gives the final solution immediately.",
    "Check whether a RAG source is cited in evidence.",
    "Check whether a student action is requested."
  ],
  "score": 0,
  "reason": "",
  "requires_human_review": true
}
```

**验收命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests/test_geval_judge_form.py -q
```

期望输出：

```text
passed
```

### 3.9 Reproducible LM Evaluation：可复现日志

| 论文做法 | 系统照搬方式 |
| --- | --- |
| 记录模型、prompt、参数、版本、输出和失败原因。 | `harness_runs` 和 JSON log 同时保存全部字段。 |
| 保留原始运行材料。 | `eval/harness_logs/YYYY-MM-DD/*.json` 不覆盖旧文件。 |
| 比较条件透明。 | Baseline 结果表必须带 `model_config_id`、`retrieval_config_id`、`skill_config_id`、`memory_config_id`。 |

**日志最小字段：**

```json
{
  "created_at_beijing": "2026-07-07T15:30:00+08:00",
  "git_commit": "",
  "docker_image": "responsible-edu-agent:harness",
  "baseline_id": "full_memory",
  "model_config_id": "qwen-max-dashscope",
  "temperature": 0.2,
  "top_p": 0.8,
  "prompt_json": {},
  "completion_json": {},
  "metrics_json": {},
  "failure_reason": ""
}
```

**验收命令：**

```bash
python3 scripts/check_harness_logs.py --date "$(TZ=Asia/Shanghai date +%F)"
```

期望输出：

```text
Harness logs valid UTF-8 and schema-complete.
```

## 四、教育 Agent 方法合同

### 4.1 RAG 与 DocPrompting

| 论文依据 | 实施合同 |
| --- | --- |
| Lewis 2020 RAG | 每轮回答前检索外部语料；Evidence 保存 top-k chunk、URL、score、source_id。 |
| DocPrompting | 编程问题优先检索教程和官方文档；prompt 中注入检索到的原文片段。 |
| 教育 Q&A + Code Interpreter | Python 边界问题运行安全代码验证；执行结果进入 Evidence。 |
| RAG math QA trade-off | 学生端回答不直接粘贴长段原文；管理端 Evidence 保存完整来源。 |

**RAG prompt 输入字段：**

```json
{
  "student_message": "",
  "query_rewrite": "",
  "retrieved_chunks": [],
  "kg_path": [],
  "skill_decision": {},
  "memory_context": {}
}
```

### 4.2 教育知识图谱

| 论文依据 | 实施合同 |
| --- | --- |
| Ain 2023 Educational KG | 从 chunk 抽取概念、关系、证据文本、来源 URL、置信度。 |
| Zep temporal KG | 学习过程写 episode、entity、fact；事实有 `valid_from`、`valid_to`、`status`。 |

**KG candidate schema：**

```json
{
  "candidate_id": "",
  "source_id": "",
  "chunk_id": "",
  "url": "",
  "subject": "",
  "predicate": "",
  "object": "",
  "evidence_text": "",
  "confidence": 0.0,
  "review_status": "pending"
}
```

**验收命令：**

```bash
python3 scripts/check_kg_candidates.py
```

期望输出：

```text
KG candidate checks passed.
```

### 4.3 五个教学 Skill 工作流

| 论文依据 | 实施合同 |
| --- | --- |
| Hint Factory | 提示级别固定为 `concept_hint`、`localization_hint`、`worked_example_hint`、`minimal_code_hint`。 |
| Cognitive Forcing | 第一轮不直接给最终答案；先要求学生写出长度、索引或错误判断。 |
| Metacognition | 每个任务记录 `confidence_before` 和 `confidence_after`。 |
| Teach-back | 学生完成后必须复述规则；系统给出 `correct`、`partial`、`incorrect`。 |
| LLM tutor training | 每轮选择 `next_teaching_action`，目标是让学生完成下一步学习动作。 |

**workflow_trace 固定字段：**

```json
{
  "primary_skill": "retrieve-first-gate",
  "hint_level": "concept_hint",
  "student_attempt_required": true,
  "direct_answer_given": false,
  "confidence_before": "pending",
  "teach_back": "required",
  "next_teaching_action": "ask_for_length_and_index"
}
```

### 4.4 记忆与学习者画像

| 论文依据 | 实施合同 |
| --- | --- |
| Memory survey | 记忆分为 writing、management、reading 三阶段。 |
| Mem0 | 每轮写入 ADD、UPDATE、DELETE、NOOP 之一。 |
| MemoryBank | 记忆保存 `strength`、`use_count`、`last_used_at`、`effective_score`；召回后强化；长期上限 30。 |
| RMM | 回复前生成 prospective reading plan；回复后生成 retrospective memory use。 |
| Zep | 每轮保存 episode、entity、fact；冲突事实标记失效。 |

**memory operation schema：**

```json
{
  "operation": "ADD",
  "memory_type": "misconception",
  "topic_id": "python-list-indexerror",
  "content": "learner confuses len(list) with the maximum valid index",
  "source_turn_id": "",
  "confidence": 0.0,
  "target_memory_id": "",
  "reason": ""
}
```

**MemoryBank score：**

```text
retention = exp(-days_since_last_used / max(strength, 0.1))
effective_score = semantic_score * retention * (1 + log(1 + use_count))
```

**验收命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests/test_memory_workflow.py -q
cd services/api-gateway-go && ../../.tools/go/bin/go test ./internal/store -run TestMemory -count=1
```

期望输出：

```text
passed
PASS
```

## 五、管理端页面实施合同

| 页面 | 必须显示的数据 | 禁止显示的内容 |
| --- | --- | --- |
| `/om/learning-process` | learner list、session list、turn list、selected turn summary | 写死的 demo 证据 |
| `/om/session-review` | 只读对话、每轮 skill、每轮状态变化 | 可编辑学生消息 |
| `/om/evidence` | turn-level Retrieval、Generation Grounding、KG Path、Skill Decision、Memory Use | 单独脱离会话的孤立 evidence |
| `/om/memory` | learner memories、MemoryBank 分数、Mem0 操作、RMM summary、Zep facts | 社交平台标识符、网络地址 |
| `/om/harness` | suites、case、run button、run logs、AI compiler pending case | 任意 shell 输入框 |

## 六、实验表实施合同

| 表 | 行 | 列 | 数据来源 |
| --- | --- | --- | --- |
| Baseline comparison | 30 个 Python 初学问题 x 5 baseline | RAGAS、Skill compliance、Memory recall、Latency | `harness_runs.metrics_json` |
| RAG diagnosis | 每个 RAG turn | Retrieval、Grounding、Answer relevance | `evidence_events.payload.ragas` |
| Skill workflow | 每个教学 turn | skill、hint_level、direct_answer_given、teach_back | `evidence_events.payload.workflow_trace` |
| Memory lifecycle | 每个 memory operation | ADD、UPDATE、DELETE、NOOP、effective_score | `memory_events` |
| Harness reproducibility | 每次 run | git commit、Docker image、command、exit code、duration | `harness_runs` 与 JSON log |

## 七、工程任务顺序

### Task 1：补齐 Harness 与 Evidence 数据结构

**修改文件：**

```text
services/api-gateway-go/migrations/004_harness_evidence_contract.sql
services/api-gateway-go/internal/store/harness.go
services/api-gateway-go/internal/store/harness_test.go
services/api-gateway-go/internal/store/evidence.go
services/api-gateway-go/internal/store/evidence_test.go
```

**测试命令：**

```bash
cd services/api-gateway-go && ../../.tools/go/bin/go test ./internal/store -run 'TestHarness|TestEvidence' -count=1
```

**通过标准：**

```text
PASS
```

### Task 2：实现 RAGAS / ARES / G-Eval 指标服务

**修改文件：**

```text
services/ai-core-python/app/rag_metrics.py
services/ai-core-python/app/geval.py
services/ai-core-python/tests/test_rag_metrics.py
services/ai-core-python/tests/test_geval_judge_form.py
```

**测试命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests/test_rag_metrics.py services/ai-core-python/tests/test_geval_judge_form.py -q
```

**通过标准：**

```text
passed
```

### Task 3：实现自然语言 Harness case compiler

**修改文件：**

```text
services/ai-core-python/app/harness.py
services/ai-core-python/app/main.py
services/ai-core-python/tests/test_harness_compiler.py
harness/cases/index-error-retrieve-first-001.json
```

**测试命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests/test_harness_compiler.py -q
```

**通过标准：**

```text
passed
```

### Task 4：实现 Docker 内可执行 Harness runner

**修改文件：**

```text
services/api-gateway-go/internal/harness/manifest.go
services/api-gateway-go/internal/harness/runner.go
services/api-gateway-go/internal/harness/runner_test.go
harness/suites.json
Dockerfile
```

**测试命令：**

```bash
cd services/api-gateway-go && ../../.tools/go/bin/go test ./internal/harness -count=1
docker build --target harness -t responsible-edu-agent:harness .
```

**通过标准：**

```text
PASS
Successfully tagged responsible-edu-agent:harness
```

### Task 5：重做 Learning Process / Evidence / Harness 前端

**修改文件：**

```text
frontend/src/pages/LearningProcess/index.tsx
frontend/src/pages/SessionReview/index.tsx
frontend/src/pages/Evidence/index.tsx
frontend/src/pages/Harness/index.tsx
frontend/src/api/learningProcess.ts
frontend/src/api/harness.ts
frontend/src/routes.ts
```

**测试命令：**

```bash
cd frontend && npm test -- --run src/pages/LearningProcess/learningProcess.component.test.tsx src/pages/Evidence/evidence.component.test.tsx src/pages/Harness/harness.component.test.tsx
cd frontend && npm run build && npm run sync:go
```

**通过标准：**

```text
Test Files 3 passed
compiled successfully
```

### Task 6：实现五个 baseline 的实验 runner

**修改文件：**

```text
scripts/eval_baselines.py
scripts/tests/test_eval_baselines.py
eval/question_sets/python_indexerror_30.jsonl
```

**测试命令：**

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest scripts/tests/test_eval_baselines.py -q
PYTHONPATH=services/ai-core-python:. python3 scripts/eval_baselines.py --question-set eval/question_sets/python_indexerror_30.jsonl --baselines no_rag,rag_only,rag_kg,rag_kg_skills,full_memory
```

**通过标准：**

```text
30 questions x 5 baselines completed
```

### Task 7：实现论文机制门禁

**修改文件：**

```text
scripts/check_research_contract.py
scripts/tests/test_check_research_contract.py
docs/research/paper_to_implementation_matrix.md
check.sh
check.ps1
```

**测试命令：**

```bash
python3 scripts/check_research_contract.py --strict
python3 -m pytest scripts/tests/test_check_research_contract.py -q
./check.sh --full
```

**通过标准：**

```text
Research contract passed.
passed
All checks passed.
```

## 八、整体验收命令

macOS：

```bash
python3 scripts/check_research_contract.py --strict
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests -q
PYTHONPATH=services/ai-core-python:. python3 -m pytest scripts/tests -q
cd services/api-gateway-go && ../../.tools/go/bin/go test ./... -count=1
cd ../../frontend && npm test -- --run
npm run build
npm run sync:go
cd ..
docker build --target harness -t responsible-edu-agent:harness .
```

Windows 11 PowerShell：

```powershell
python scripts/check_research_contract.py --strict
$env:PYTHONPATH="services/ai-core-python;."
python -m pytest services/ai-core-python/tests -q
python -m pytest scripts/tests -q
Set-Location services/api-gateway-go
..\..\.tools\go\bin\go.exe test ./... -count=1
Set-Location ..\..\frontend
npm test -- --run
npm run build
npm run sync:go
Set-Location ..
docker build --target harness -t responsible-edu-agent:harness .
```

Docker 运行：

```bash
docker run --rm -p 18081:8080 -e DASHSCOPE_API_KEY="$DASHSCOPE_API_KEY" responsible-edu-agent:harness
```

打开：

```text
http://127.0.0.1:18081/
http://127.0.0.1:18081/om
http://127.0.0.1:18081/om/learning-process
http://127.0.0.1:18081/om/evidence
http://127.0.0.1:18081/om/harness
```

## 九、完成判定

| 条件 | 判定方式 |
| --- | --- |
| Harness 不是命令列表 | `/om/harness` 能显示 suite detail、case detail、run button、run log |
| Evidence 不是硬编码 | `/om/evidence` 的内容来自 `GET /api/session/:id/evidence` |
| Learning Process 先选用户 | 未选 learner 时 session review 和 evidence 不显示数据 |
| Evidence 精确到轮次 | URL 包含 `session_id` 和 `turn_id` 时只显示该轮证据 |
| 自然语言测试不执行 shell | AI compiler 输出 JSON case；pending case 确认后进入 suite |
| 日志可复现 | 每次 run 产生 UTF-8 北京时间 JSON，含 git commit、Docker image、command、exit code |
| 论文机制可追踪 | `paper_to_implementation_matrix.md` 每行都有代码位置、数据位置、前端位置、测试命令 |
