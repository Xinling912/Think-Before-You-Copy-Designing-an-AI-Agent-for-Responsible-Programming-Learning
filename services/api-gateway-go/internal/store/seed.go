package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const demoLearnerID = "anonymous-demo"
const demoSessionID = "session-demo-list-indexerror"

type DemoSeedResult struct {
	SessionID      string
	Messages       int
	EvidenceEvents int
	AlreadySeeded  bool
}

type demoTurn struct {
	SkillID       string
	Student       string
	Agent         string
	Diagnosis     string
	RAGChecker    string
	KGPath        []string
	MemoryContent string
}

func (s *SQLiteStore) SeedDemoData(ctx context.Context) (DemoSeedResult, error) {
	if exists, err := s.demoSessionExists(ctx); err != nil {
		return DemoSeedResult{}, err
	} else if exists {
		messages, evidence, err := s.demoSessionCounts(ctx)
		if err != nil {
			return DemoSeedResult{}, err
		}
		return DemoSeedResult{
			SessionID:      demoSessionID,
			Messages:       messages,
			EvidenceEvents: evidence,
			AlreadySeeded:  true,
		}, nil
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(
		ctx,
		`insert into sessions (id, created_at, scenario, status) values (?, ?, ?, ?)`,
		demoSessionID,
		formatStoreTime(now),
		"python-list-indexerror",
		"active",
	); err != nil {
		return DemoSeedResult{}, err
	}

	turns := demoIndexErrorTurns()
	for index, turn := range turns {
		turnNumber := index + 1
		episode, err := s.SaveLearningEpisode(ctx, LearningEpisodeInput{
			LearnerID:  demoLearnerID,
			SessionID:  demoSessionID,
			Topic:      "python_list_indexerror",
			SkillState: turn.SkillID,
			Payload: map[string]any{
				"seed_source": "demo_indexerror_learning_process",
				"turn_number": turnNumber,
			},
		})
		if err != nil {
			return DemoSeedResult{}, fmt.Errorf("seed learning episode %d: %w", turnNumber, err)
		}

		if _, err := s.PersistCompletedSessionTurn(ctx, CompletedSessionTurnInput{
			SessionID:      demoSessionID,
			LearnerID:      demoLearnerID,
			StudentContent: turn.Student,
			AgentContent:   turn.Agent,
			EpisodeID:      episode.ID,
			Evidence:       demoEvidencePayload(turnNumber, turn),
			MemoryEvents: []MemoryEventInput{
				{
					LearnerID:       demoLearnerID,
					SessionID:       demoSessionID,
					Operation:       "ADD",
					MemoryType:      "learning_process",
					Topic:           "python_list_indexerror",
					Content:         turn.MemoryContent,
					Concepts:        []string{"Concept:list", "Concept:index", "Concept:zero_based_index", "ErrorType:IndexError"},
					SourceEventID:   episode.ID,
					SourceSessionID: demoSessionID,
					OperationOrigin: "Mem0 ADD + MemoryBank strength initialization",
					Reason:          "seed_demo_turn_memory",
					Payload:         map[string]any{"paper_basis": []string{"Mem0", "MemoryBank", "Zep"}},
				},
			},
			TopicSummary: &TopicSummaryInput{
				LearnerID:          demoLearnerID,
				Topic:              "python_list_indexerror",
				Summary:            "学生围绕 Python list 的零基索引、有效索引范围和 IndexError 逐步完成 retrieve-first、提示、复述与反思。",
				MasteredConcepts:   []string{"list", "index", "zero_based_index"},
				WeakConcepts:       []string{"valid_index_range", "trace_error_location"},
				NextTeachingAction: "下一轮先让学生给出 len(list) 与最大合法索引，再提供分层提示。",
				SourceSessionID:    demoSessionID,
			},
		}); err != nil {
			return DemoSeedResult{}, fmt.Errorf("seed completed turn %d: %w", turnNumber, err)
		}
	}

	messages, evidence, err := s.demoSessionCounts(ctx)
	if err != nil {
		return DemoSeedResult{}, err
	}
	return DemoSeedResult{
		SessionID:      demoSessionID,
		Messages:       messages,
		EvidenceEvents: evidence,
		AlreadySeeded:  false,
	}, nil
}

func (s *SQLiteStore) demoSessionExists(ctx context.Context) (bool, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `select id from sessions where id = ?`, demoSessionID).Scan(&id)
	if err == nil {
		return true, nil
	}
	if err == ErrSessionNotFound {
		return false, nil
	}
	if isSQLNoRows(err) {
		return false, nil
	}
	return false, err
}

func (s *SQLiteStore) demoSessionCounts(ctx context.Context) (int, int, error) {
	var messages int
	if err := s.db.QueryRowContext(ctx, `select count(*) from messages where session_id = ?`, demoSessionID).Scan(&messages); err != nil {
		return 0, 0, err
	}
	var evidence int
	if err := s.db.QueryRowContext(ctx, `select count(*) from evidence_events where session_id = ?`, demoSessionID).Scan(&evidence); err != nil {
		return 0, 0, err
	}
	return messages, evidence, nil
}

func isSQLNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

func demoIndexErrorTurns() []demoTurn {
	return []demoTurn{
		{
			SkillID:       "student-learning/retrieve-first-gate",
			Student:       "为什么我的 list 报 IndexError？",
			Agent:         "先不要看答案。请先写出这个 list 的长度，以及你正在访问的索引。",
			Diagnosis:     "学生直接请求答案，系统触发 retrieve-first gate，先要求回忆 len(list) 与目标索引。",
			RAGChecker:    "retrieval_trigger",
			KGPath:        []string{"Concept:list", "Concept:index", "Concept:zero_based_index", "ErrorType:IndexError"},
			MemoryContent: "学生遇到 IndexError 时会先问原因，需要先被要求定位 list 长度和访问索引。",
		},
		{
			SkillID:       "student-learning/confidence-calibration-check",
			Student:       "我访问的是 list[2]，长度是 2，我觉得没毛病。",
			Agent:         "在继续前先给一个信心分：你有多确定长度为 2 的 list 可以访问索引 2？1 到 5 分。",
			Diagnosis:     "学生把长度和最大合法索引混在一起，系统记录答前信心并准备校准。",
			RAGChecker:    "claim_verification",
			KGPath:        []string{"Concept:len", "Concept:valid_index_range", "Concept:index"},
			MemoryContent: "学生可能把 len(list)=2 误解成可以访问 list[2]。",
		},
		{
			SkillID:       "student-learning/stuck-and-error-diagnosis-coach",
			Student:       "我不知道索引到底从哪开始。",
			Agent:         "先判断卡点：你是不确定索引从 0 开始，还是不确定最后一个元素的索引怎么算？",
			Diagnosis:     "学生表达卡住但没有定位原因，系统把错误诊断拆成起点和边界两个候选。",
			RAGChecker:    "failure_layer_classification",
			KGPath:        []string{"Concept:zero_based_index", "Concept:last_index", "Concept:valid_index_range"},
			MemoryContent: "学生对索引起点和最后一个索引的关系不稳定。",
		},
		{
			SkillID:       "student-learning/progressive-hint-ladder",
			Student:       "应该从 0 开始？那长度 2 是 0 和 1？",
			Agent:         "对。第一层提示：把元素位置写成两个格子，第一个格子下面标 0，第二个格子下面标 1。",
			Diagnosis:     "学生开始形成零基索引理解，系统只给第一层提示，避免直接替学生完成推理。",
			RAGChecker:    "hint_grounding",
			KGPath:        []string{"Concept:list", "Concept:zero_based_index", "Concept:valid_index_range"},
			MemoryContent: "学生接受可视化格子提示后能说出长度 2 的合法索引是 0 和 1。",
		},
		{
			SkillID:       "student-learning/progressive-hint-ladder",
			Student:       "所以 list[2] 是第三个位置？",
			Agent:         "第二层提示：索引 2 代表第三个元素。长度为 2 时只有两个元素，所以第三个元素不存在。",
			Diagnosis:     "系统升级到第二层提示，将索引值映射到人类序数位置。",
			RAGChecker:    "answer_support_check",
			KGPath:        []string{"Concept:index", "Concept:ordinal_position", "ErrorType:IndexError"},
			MemoryContent: "学生能把索引 2 对应到第三个元素，但需要提醒第三个元素不存在。",
		},
		{
			SkillID:       "student-learning/rag-source-grounding",
			Student:       "官网也是这么说的吗？",
			Agent:         "Python 官方教程的 list 示例使用零基索引访问元素；我们把回答绑定到 3.1.3 Lists 和 5.1 More on Lists 两个来源。",
			Diagnosis:     "学生请求外部依据，系统展示 RAG 来源而不是只凭模型记忆解释。",
			RAGChecker:    "retrieval_grounding",
			KGPath:        []string{"Source:python-docs-3.14.6", "Concept:list", "Concept:index"},
			MemoryContent: "学生在理解概念时会追问官方依据，展示来源能提升信任。",
		},
		{
			SkillID:       "student-learning/kg-path-explanation",
			Student:       "这和知识图谱有什么关系？",
			Agent:         "这条路径是 list -> index -> zero_based_index -> valid_index_range -> IndexError。你现在的问题卡在 valid_index_range。",
			Diagnosis:     "系统用 KG 路径定位当前学习断点，说明错误不是 list 本身，而是有效索引范围。",
			RAGChecker:    "knowledge_path_alignment",
			KGPath:        []string{"Concept:list", "Concept:index", "Concept:zero_based_index", "Concept:valid_index_range", "ErrorType:IndexError"},
			MemoryContent: "学生能接受 KG 路径解释，并把卡点定位到 valid_index_range。",
		},
		{
			SkillID:       "student-learning/teach-back-evaluator",
			Student:       "我来复述：长度是 2，索引只有 0 和 1，所以 2 越界。",
			Agent:         "复述通过。再补一句：一般长度为 n 的 list，最大合法索引是多少？",
			Diagnosis:     "学生完成 teach-back，系统验证是否能从具体例子迁移到一般规则。",
			RAGChecker:    "generation_faithfulness",
			KGPath:        []string{"Concept:len", "Concept:n_minus_one", "Concept:valid_index_range"},
			MemoryContent: "学生能复述长度 2 的边界规则，下一步要迁移到 n-1。",
		},
		{
			SkillID:       "student-learning/memory-update",
			Student:       "长度为 n，最大合法索引是 n-1。",
			Agent:         "很好。我会把这次掌握点记为：你已经能说出 n-1 规则，但还需要在真实代码里先查 len 再判断索引。",
			Diagnosis:     "系统执行记忆写入，把掌握点和后续薄弱点分开记录。",
			RAGChecker:    "memory_write_decision",
			KGPath:        []string{"Concept:valid_index_range", "Concept:n_minus_one", "Practice:trace_code"},
			MemoryContent: "学生掌握 n-1 规则，但需要练习在真实代码里先检查 len(list)。",
		},
		{
			SkillID:       "student-learning/reflection-and-transfer",
			Student:       "那我以后看到 IndexError 就先检查长度和索引。",
			Agent:         "本轮完成。你已经形成调试步骤：看报错位置、找 list 长度、找访问索引、判断索引是否在 0 到 len(list)-1。",
			Diagnosis:     "系统记录最终反思，把一次 IndexError 学习转成可复用调试流程。",
			RAGChecker:    "task_completion",
			KGPath:        []string{"DebugStep:error_location", "Concept:list", "Concept:len", "Concept:index", "ErrorType:IndexError"},
			MemoryContent: "学生形成 IndexError 调试流程：看位置、查长度、查索引、比对有效范围。",
		},
	}
}

func demoEvidencePayload(turnNumber int, turn demoTurn) map[string]any {
	return map[string]any{
		"turn_id":                  fmt.Sprintf("demo-turn-%02d", turnNumber),
		"skill_id":                 turn.SkillID,
		"teaching_strategy":        turn.SkillID,
		"diagnosis":                turn.Diagnosis,
		"direct_answer_given":      turnNumber >= 5,
		"student_attempt_required": turnNumber <= 8,
		"confidence_before":        confidenceBefore(turnNumber),
		"confidence_after":         confidenceAfter(turnNumber),
		"ragchecker_layer":         turn.RAGChecker,
		"kg_path":                  turn.KGPath,
		"kg_algorithm":             "weighted_multi_hop_path_search",
		"rag_retrieval":            "semantic-vector-rerank",
		"ragas": map[string]any{
			"context_precision":   float64(82+turnNumber) / 100,
			"context_recall":      float64(78+turnNumber) / 100,
			"faithfulness":        float64(84+turnNumber) / 100,
			"answer_relevance":    float64(80+turnNumber) / 100,
			"grounding_statement": "agent answer must be supported by selected Python tutorial chunks",
			"paper_metric_source": "RAGAS",
		},
		"evidence": map[string]any{
			"retrieve_first_applied": turnNumber == 1,
			"hint_level":             hintLevel(turnNumber),
			"teach_back_required":    turnNumber >= 8,
			"student_understanding":  understandingState(turnNumber),
			"privacy_check":          "no_social_identifier_no_ip",
		},
		"memory_reading_plan": map[string]any{
			"short_term":  "read last 6 messages in this session",
			"mid_term":    "read topic_summary for python_list_indexerror",
			"long_term":   "retrieve active learner_memory_v2 by effective_score",
			"paper_basis": []string{"Mem0", "MemoryBank", "RMM", "Zep"},
		},
		"memory_updates": []map[string]any{
			{
				"operation": "ADD",
				"topic":     "python_list_indexerror",
				"content":   turn.MemoryContent,
				"basis":     "Mem0 salient memory extraction",
			},
		},
		"rag_sources": []map[string]any{
			{
				"source_id": "python-docs-3.14.6-lists",
				"title":     "3.1.3. Lists",
				"url":       "https://docs.python.org/3/tutorial/introduction.html#lists",
				"score":     0.92,
			},
			{
				"source_id": "python-docs-3.14.6-more-on-lists",
				"title":     "5.1. More on Lists",
				"url":       "https://docs.python.org/3/tutorial/datastructures.html#more-on-lists",
				"score":     0.87,
			},
		},
	}
}

func confidenceBefore(turnNumber int) any {
	switch turnNumber {
	case 1, 3:
		return "pending"
	case 2:
		return 4
	default:
		return 2 + turnNumber%4
	}
}

func confidenceAfter(turnNumber int) any {
	if turnNumber < 8 {
		return "pending"
	}
	return 4
}

func hintLevel(turnNumber int) int {
	switch {
	case turnNumber <= 3:
		return 0
	case turnNumber <= 5:
		return turnNumber - 3
	default:
		return 2
	}
}

func understandingState(turnNumber int) string {
	switch {
	case turnNumber <= 3:
		return "uncertain"
	case turnNumber <= 7:
		return "building"
	default:
		return "can_teach_back"
	}
}
