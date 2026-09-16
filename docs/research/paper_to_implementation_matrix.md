# 论文机制到项目实现矩阵

本文档只记录论文机制如何落地到 ResponsibleEduAgent。每一项都必须能回答四个问题：代码在哪里、数据存到哪里、前端哪里能看到、用什么测试证明。

## 0. 研究合同门禁

Task 1 已把 research contract 作为论文机制的严格门禁接入 `scripts/check_research_contract.py --strict`，并在 `check.sh --full`、`check.ps1 -Full` 中放到 Go / Python / frontend 测试之前执行。strict 模式除了检查矩阵、模型命名、研究模块和 KG candidate JSONL，还会逐文件检查关键论文机制 marker；缺失时必须输出具体文件和缺失 marker。

覆盖对象：

| 文件 | strict marker 覆盖 |
| --- | --- |
| `services/ai-core-python/app/memory.py` | Mem0 操作决策、MemoryBank effective score、RMM prospective plan、RMM retrospective use、learning facts 生成 |
| `services/ai-core-python/app/pedagogy.py` | retrieve-first、progressive hint、stuck diagnosis、confidence calibration、teach-back 五个教学技能 ID |
| `services/api-gateway-go/internal/store/memory.go` | Go 侧 MemoryBank 分数、`REINFORCE` 事件、decay/cap 事务 |
| `services/api-gateway-go/internal/store/learning_graph.go` | Zep-style episodes、entities、facts、contradicted fact invalidation |
| `frontend/src/pages/SessionDemo/index.tsx` | AI thinking、Shift+Enter 输入行为、optimistic chat exchange |

验证命令：

```bash
python3 scripts/check_research_contract.py --strict
./check.sh --full
```

```powershell
.\check.ps1 -Full
```

## 1. 已落地机制

| 论文依据 | 项目机制 | 已落地代码 | 持久化与证据 | 前端可见位置 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| Mem0 operations: salient memory + ADD/UPDATE/DELETE/NOOP | 每轮对话都抽取学习记忆候选；无显著候选也写 NOOP；teach-back 达标可 DELETE 旧 misconception | `services/ai-core-python/app/memory.py`, `services/ai-core-python/app/session.py`, `services/api-gateway-go/internal/store/memory.go` | `memory_events`, `learner_memories_v2`, `evidence_events.payload.memory_updates` | Session Demo 的 `Memory / 记忆状态`；Memory / Learner Model 页的 `Memory events / Mem0 操作历史` | `test_memory.py`, `test_memory_workflow.py`, `test_session_step.py`, `memory_test.go`, `memory.component.test.tsx` |
| MemoryBank decay: strength, use_count, last_used_at, forgetting curve | 长期学习记忆保存 strength/use_count/last_used_at/effective_score；使用 `R = exp(-days / strength)` 衰减；召回后强化 | `services/ai-core-python/app/memory.py`, `services/api-gateway-go/internal/store/memory.go` | `learner_memories_v2.strength/use_count/last_used_at/effective_score` | Session Demo 的 `Long-term / 长期`；Memory / Learner Model 页的 `MemoryBank / 记忆强度` | Python memory tests；Go memory tests；Memory page component test |
| RMM topic reflection: prospective reflection + retrospective refinement | 回复前生成 topic-based memory reading plan；回复后只记录可验证使用过的 memory ids；profile API 从 learning episode payload 中抽取 RMM reflections | `services/ai-core-python/app/memory.py`, `services/ai-core-python/app/session.py`, `services/api-gateway-go/internal/app/gateway.go` | `topic_summaries`, `learning_episodes.payload_json.memory_reading_plan`, `learning_episodes.payload_json.retrospective_memory_use`, `rmm_reflections` API 字段 | Session Demo 的 `RMM reading plan`；Memory / Learner Model 页的 `RMM reflections / RMM 反思记录` 和 `Topic summaries / 中期任务状态` | `test_memory_workflow.py`, `test_session_step.py`, `gateway_test.go`, `memory.component.test.tsx` |
| Zep temporal graph memory | 每轮学习生成 episode；抽取 learning facts；`has_misconception`、`resolved_misconception`、`has_mastery` 之间执行互斥失效，避免矛盾 active facts 并存 | `services/api-gateway-go/internal/store/learning_graph.go`, `services/api-gateway-go/internal/store/completed_turn.go`, `services/api-gateway-go/internal/app/gateway.go` | `learning_episodes`, `learning_entities`, `learning_facts.status/valid_from/valid_to` | Session Demo 的 `Learning facts`；Memory / Learner Model 页的 `Learning facts / Zep temporal facts` 和 `Learning entities / 学习实体` | `learning_graph_test.go`, `sqlite_test.go`, `gateway_test.go`, `memory.component.test.tsx` |
| Educational KG extraction | 从 Python 官方教材 chunk 中抽取概念候选、关系候选、证据片段和置信度；审核通过后可合并入 KG yaml，并保留 source chunk、official URL、evidence text、reviewer、reviewed_at | `services/ai-core-python/app/kg_extraction.py`, `scripts/extract_kg_candidates.py`, `scripts/merge_approved_kg.py`, `frontend/src/pages/KGReview/index.tsx` | `kg/generated/candidates.jsonl`, `kg/concepts.yaml`, `kg/edges.yaml`, `kg_candidate_reviews` | KG Review / 候选审核页显示 source chunk、官方 URL、evidence text、confidence；Knowledge Graph / KG 页面展示已审定路径；RAG 结果显示 `Concepts` | `test_kg_extraction.py`, `test_merge_approved_kg.py`, `kgReview.component.test.tsx`, `gateway_test.go`, `scripts/check_research_contract.py` |
| RAG / DocPrompting | Python 官方 3.14.6 文档 chunk -> DashScope embedding -> 本地 FAISS -> DashScope rerank -> Qwen 教学回复 | `services/ai-core-python/app/rag.py`, `services/ai-core-python/app/dashscope.py`, `services/ai-core-python/app/session.py` | `data/processed/python-docs-3.14.6`, `data/indexes/python-docs-3.14.6`, `evidence_events.payload.rag_sources` | RAG 页面；Session Demo 的 `RAG sources / 检索来源`、`RAG source`、`RAG scores`、`RAG URL` | `test_rag_search.py`, `test_session_step.py`, `scripts/eval_baselines.py` |
| Progressive hints / Hint Factory | 根据学生状态推进 hint level，先要求回忆和判断，再逐步给更具体提示 | `services/ai-core-python/app/pedagogy.py`, `services/ai-core-python/app/session.py` | `evidence_events.payload.next_task_state`, `evidence_events.payload.teaching_strategy` | Session Demo 的 `Skill workflow / 教学技能流程`、`Teaching strategy` | `test_pedagogy_workflow.py`, `test_session_step.py` |
| Cognitive forcing / retrieve-first gate | 默认不直接给最终答案；先要求学生写长度、索引或解释越界判断 | `services/ai-core-python/app/pedagogy.py`, `services/ai-core-python/app/session.py` | `evidence_events.payload.direct_answer_given=false`, `requires_student_attempt=true` | Session Demo 的 `Student attempt required`、`Direct answer given`、`Cognitive gate` | `test_pedagogy_workflow.py`, `test_session_step.py`, frontend component tests |
| Metacognition / confidence calibration | 记录 confidence before/after；把信心校准作为学习证据，而不是闲聊字段 | `services/ai-core-python/app/pedagogy.py`, `services/ai-core-python/app/session.py`, `frontend/src/pages/SessionDemo/model.ts` | `evidence_events.payload.evidence.confidence_before/confidence_after` | Session Demo 的 `Metacognition / 元认知校准` | `test_pedagogy_workflow.py`, `sessionDemo.component.test.tsx` |
| Teach-back | 要求学生复述索引规则；复述达标后可生成 mastery memory 并清理旧误区 | `services/ai-core-python/app/pedagogy.py`, `services/ai-core-python/app/memory.py`, `services/ai-core-python/app/session.py` | `memory_events`, `learner_memories_v2`, `evidence_events.payload.evidence.teach_back` | Session Demo 的 `Teach-back`、`Reflection`、`Memory updates` | `test_memory_workflow.py`, `test_pedagogy_workflow.py`, `test_session_step.py` |
| 真实对话体验 / latency evidence | 前端发送后立即追加学生消息和 AI thinking；后端慢不阻塞 UI；返回后替换 pending 回复 | `frontend/src/pages/SessionDemo/index.tsx`, `frontend/src/pages/SessionDemo/model.ts` | 前端状态；后端最终写 `messages` 和 `evidence_events.student_message_id/agent_message_id` | Session Demo 聊天区、右侧 evidence panel | `chat.test.ts`, `sessionDemo.component.test.tsx`, `gateway_test.go` |
| 原子证据落库 | 一轮学生消息、AI 回复、evidence、memory events、topic summary、learning facts 同事务写入；同轮 `DELETE/UPDATE` 优先于同 target `REINFORCE`，避免复活已解决误区或双倍强化；缺失 episode 时整轮回滚 | `services/api-gateway-go/internal/store/completed_turn.go`, `services/api-gateway-go/internal/store/learning_graph.go`, `services/api-gateway-go/internal/app/gateway.go` | `messages`, `evidence_events`, `skill_usage`, `learning_episodes`, `memory_events`, `topic_summaries`, `learning_facts` | Evidence / Session Demo；后续可做 audit trail 页面 | `sqlite_test.go`, `gateway_test.go`，质量审查覆盖 memory 冲突和 episode 缺失回滚 |

## 2. 实验 baseline 对应关系

| Baseline | 打开的能力 | 关闭的能力 | 论文目的 |
| --- | --- | --- | --- |
| `no_rag` | Qwen 教学回复 | RAG、KG 引导、记忆 | 验证没有外部知识时回答是否更容易泛化或直接给答案 |
| `rag_only` | Python 官方文档 RAG + rerank | KG、skill workflow、memory | 验证官方文档 grounding 的贡献 |
| `rag_kg` | RAG + KG concept hints/path | skill workflow、memory | 验证知识路径对检索和解释可追溯性的贡献 |
| `rag_kg_skills` | RAG + KG + retrieve-first/hint/teach-back | memory | 验证教学技能是否减少直接答案依赖 |
| `full_memory` | RAG + KG + skill workflow + short/mid/long memory | 无 | 本项目完整方法 |

## 3. 当前仍需加强的机制

| 机制 | 当前状态 | 下一步必须做到 |
| --- | --- | --- |
| 自动 KG 全量生成 | 已有从 chunk 抽取候选、Go API、KG Review 候选审核页和 approved candidate 合并脚本；第一版 KG 主干仍保留人工审定 yaml | 下一步把 approved merge 融入 Harness，并增加更细的关系抽取质量评估 |
| 记忆可视化后台 | 已有 Memory / Learner Model 页面，能按 learner 查看 active memories、MemoryBank 指标、topic summaries、learning facts/entities、ADD/UPDATE/DELETE/NOOP 历史 | 下一步增加按 topic/status/operation 筛选、CSV 导出和纵向变化图 |
| RMM retrospective 质量评估 | 已过滤不可验证 used_memory_ids，并在 Memory / Learner Model 页展示 selected/used/unused ids、verification_reason、retrieval_refinement | 在 baseline evaluation 中增加 memory-use precision 指标 |
| 学生画像 | 已有 learner-level memory、topic summaries、facts/entities，并在 Memory / Learner Model 页面形成初版学习者画像 | 下一步把 weak/mastered concepts、记忆衰减和 skill 状态合成 longitudinal learner profile |
| VIS 论文可视化 | 当前是工程 evidence panel | 后续把 KG path、RAG source、memory lifecycle、skill state machine 做成交互式分析视图 |

## 4. 下一轮必须落地的 Harness / Evidence 机制

下表列出的内容尚未写入代码。实现前不能在论文正文中声称“系统已支持”，只能写为设计计划或未来工作。实现完成后，把对应条目移动到“已落地机制”。

| 论文依据 | 必须落地的项目机制 | 持久化与证据 | 前端可见位置 | 验证方式 |
| --- | --- | --- | --- | --- |
| HELM: scenario + metric + run setting | Harness suite manifest 必须记录 suite id、场景、指标、命令、timeout、artifacts 和通过标准。 | `harness/suites.json`, `harness_runs.payload_json` | `/om/harness` 左侧 suite 列表和右侧 suite detail | `go test ./internal/harness -run TestManifest`；网页显示 suite detail |
| RAGAS / ARES: RAG 自动评估 | 每个 RAG case 必须记录 context relevance、answer faithfulness、answer relevance 和人工复核字段。 | `harness_runs.payload_json.rag_metrics`, `eval/harness_logs/YYYY-MM-DD/*.json` | `/om/harness` run detail；`/om/evidence` turn grounding | `scripts/run_harness_case.py` 输出 RAG metric JSON |
| RAGChecker: 细粒度故障定位 | Evidence 必须把 Retrieval、Generation Grounding、KG Path、Skill Decision、Memory Use 分区展示。 | `evidence_events.payload_json` | `/om/evidence?session_id=...&turn_id=...` | `evidence.component.test.tsx` 检查五个分区都来自 API payload |
| AgentBench: 多轮 Agent 环境 | Harness case 支持 `turns`、`expected_state` 和 `evidence_assertions`，运行时复盘整个多轮会话。 | `harness_cases.case_json`, `harness_runs.payload_json.turn_results` | `/om/harness` case detail 和 run log | `scripts/tests/test_run_harness_case.py` 验证多轮 case |
| SWE-bench: 可执行测试与固定环境 | Docker harness image 内可从网页触发白名单命令，记录 exit code、stdout/stderr tail、duration。 | `harness_runs`, `eval/harness_logs/YYYY-MM-DD/*.json` | `/om/harness` run panel | Docker 内运行 `python3 scripts/run_harness_case.py --case harness/cases/index-error-boundary.json` |
| EvalPlus: 边界用例增强 | 自然语言新增测试必须编译成正例、边界例和禁止行为，不允许单条自由文本直接进入 runner。 | `harness_cases.case_json` | `/om/harness` natural-language compiler panel | `test_harness_compiler.py` 验证 schema 必含 `boundary_cases` 和 `forbidden` |
| Reproducible LM Evaluation: 可复现日志 | 每条 run log 必须记录 Beijing time、git commit、Docker image、command、model、parameters、exit code。 | `harness_runs`, UTF-8 JSON log file | `/om/harness` latest runs table | `runner_test.go` 验证 `created_at_beijing`、UTF-8、log JSON |
| G-Eval: form-filling judge | AI 只负责把自然语言测试需求转成固定 JSON form；pending case 需要用户确认后才能运行。 | `harness_cases.status` | `/om/harness` pending case preview 和 confirm 按钮 | `harness.component.test.tsx` 验证 pending -> confirmed 流程 |

## 5. 本轮验证命令

```bash
python3 scripts/check_research_contract.py --strict
```

结果：strict research contract 已通过。负向验证中，临时移除 marker 或 marker 文件时，门禁会精确报告具体文件与缺失项。

```bash
PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests/test_memory.py services/ai-core-python/tests/test_memory_workflow.py services/ai-core-python/tests/test_pedagogy_workflow.py services/ai-core-python/tests/test_session_step.py services/ai-core-python/tests/test_query_understanding.py services/ai-core-python/tests/test_kg_extraction.py services/ai-core-python/tests/test_rag_search.py -q
```

结果：83 passed。

```bash
cd frontend && npm test -- --run src/pages/SessionDemo/chat.test.ts src/pages/SessionDemo/evidence.test.ts src/pages/SessionDemo/sessionDemo.component.test.tsx
```

结果：3 test files passed，6 tests passed。

```bash
cd frontend && npm run build && npm run sync:go
```

结果：Umi build compiled successfully，dist 已同步到 Go embed 目录。

```bash
cd services/api-gateway-go && ../../.tools/go/bin/gofmt -w internal/store/*.go internal/app/*.go && ../../.tools/go/bin/go test ./... -count=1
```

结果：`internal/app`、`internal/config`、`internal/store` 全部通过。
