package store

import (
	"context"
	"math"
	"strings"
	"testing"
	"time"
)

func TestApplyMemoryEventAddUpdateDeleteAndNoop(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	added, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-1",
		SessionID:       "session-1",
		MessageID:       1,
		Operation:       "ADD",
		MemoryType:      "misconception",
		Topic:           "list-index",
		Content:         "Student treats len(list) as the largest valid index.",
		Concepts:        []string{"index", "valid-index-range"},
		SourceEventID:   11,
		OperationOrigin: "unit-test",
		Candidate:       map[string]any{"source": "teacher_review"},
		Reason:          "new misconception",
	})
	if err != nil {
		t.Fatalf("add memory event: %v", err)
	}
	if added.MemoryID == "" {
		t.Fatal("expected generated memory id")
	}
	if added.Status != "active" {
		t.Fatalf("expected active memory, got %q", added.Status)
	}

	updated, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-1",
		SessionID:       "session-1",
		MessageID:       2,
		Operation:       "UPDATE",
		TargetMemoryID:  added.MemoryID,
		MemoryType:      "misconception",
		Topic:           "list-index",
		Content:         "Student still tries to access list[2] for a two-item list.",
		Concepts:        []string{"index", "valid-index-range", "zero-based-indexing"},
		OperationOrigin: "unit-test",
		Reason:          "reinforced misconception",
	})
	if err != nil {
		t.Fatalf("update memory event: %v", err)
	}
	if updated.MemoryID != added.MemoryID {
		t.Fatalf("expected update to preserve memory id %q, got %q", added.MemoryID, updated.MemoryID)
	}
	if updated.Strength <= added.Strength {
		t.Fatalf("expected update to reinforce strength, before %d after %d", added.Strength, updated.Strength)
	}
	if !strings.Contains(updated.Content, "list[2]") {
		t.Fatalf("expected updated content, got %q", updated.Content)
	}

	if _, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-1",
		SessionID:       "session-1",
		MessageID:       3,
		Operation:       "NOOP",
		OperationOrigin: "unit-test",
		Candidate:       map[string]any{"content": "not worth storing"},
		Reason:          "candidate below threshold",
	}); err != nil {
		t.Fatalf("noop memory event: %v", err)
	}

	deleted, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-1",
		SessionID:       "session-1",
		MessageID:       4,
		Operation:       "DELETE",
		TargetMemoryID:  added.MemoryID,
		OperationOrigin: "unit-test",
		Reason:          "obsolete",
	})
	if err != nil {
		t.Fatalf("delete memory event: %v", err)
	}
	if deleted.Status != "deleted" {
		t.Fatalf("expected deleted status, got %q", deleted.Status)
	}

	memories, err := store.ListLearnerMemoryV2(ctx, "learner-1", 10)
	if err != nil {
		t.Fatalf("list v2 memory: %v", err)
	}
	if len(memories) != 0 {
		t.Fatalf("expected no active memories after delete, got %#v", memories)
	}

	var eventCount int
	if err := store.db.QueryRow(`select count(*) from memory_events where learner_id = ?`, "learner-1").Scan(&eventCount); err != nil {
		t.Fatalf("count memory events: %v", err)
	}
	if eventCount != 4 {
		t.Fatalf("expected 4 memory events, got %d", eventCount)
	}

	events, err := store.ListMemoryEvents(ctx, "learner-1", 10)
	if err != nil {
		t.Fatalf("list memory events: %v", err)
	}
	if len(events) != 4 {
		t.Fatalf("expected 4 listed events, got %d", len(events))
	}
	if events[0].Operation != "DELETE" {
		t.Fatalf("expected newest event first, got %q", events[0].Operation)
	}
	if events[3].Operation != "ADD" {
		t.Fatalf("expected oldest event last, got %q", events[3].Operation)
	}
	if events[3].Candidate["content"] != "Student treats len(list) as the largest valid index." {
		t.Fatalf("expected ADD candidate content, got %#v", events[3].Candidate)
	}
	if events[3].Candidate["source"] != "teacher_review" {
		t.Fatalf("expected ADD candidate source, got %#v", events[3].Candidate)
	}
}

func TestDecayAndCapActiveMemories(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	for i := 0; i < 35; i++ {
		if _, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
			LearnerID:  "learner-cap",
			Operation:  "ADD",
			MemoryType: "task_summary",
			Topic:      "topic",
			Content:    "memory candidate",
			Concepts:   []string{"concept"},
		}); err != nil {
			t.Fatalf("add memory %d: %v", i, err)
		}
	}

	if err := store.DecayAndCapMemories(ctx, "learner-cap", time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("decay and cap: %v", err)
	}

	active, err := store.ListLearnerMemoryV2(ctx, "learner-cap", 100)
	if err != nil {
		t.Fatalf("list capped memories: %v", err)
	}
	if len(active) != 30 {
		t.Fatalf("expected exactly 30 active memories, got %d", len(active))
	}

	var decayed int
	if err := store.db.QueryRow(`select count(*) from learner_memory_v2 where learner_id = ? and status = 'decayed'`, "learner-cap").Scan(&decayed); err != nil {
		t.Fatalf("count decayed memories: %v", err)
	}
	if decayed == 0 {
		t.Fatal("expected some memories to be marked decayed")
	}
	if decayed != 5 {
		t.Fatalf("expected exactly 5 decayed memories, got %d", decayed)
	}
}

func TestMemoryEffectiveScorePenalizesStaleAndRewardsUse(t *testing.T) {
	now := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	stale := memoryEffectiveScore(1, 0, now.AddDate(0, -3, 0), now)
	reinforced := memoryEffectiveScore(4, 7, now.Add(-2*time.Hour), now)

	if stale >= reinforced {
		t.Fatalf("expected stale score %.4f to be lower than reinforced score %.4f", stale, reinforced)
	}
}

func TestMemoryEffectiveScoreUsesEbbinghausRetention(t *testing.T) {
	now := time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC)
	lastUsed := now.Add(-48 * time.Hour)
	score := memoryEffectiveScore(2, 0, lastUsed, now)
	if math.Abs(score-0.367879) > 0.00001 {
		t.Fatalf("expected exp(-2/2), got %.6f", score)
	}
	reinforced := memoryEffectiveScore(2, 4, lastUsed, now)
	if reinforced <= score {
		t.Fatalf("expected reinforced memory to score higher: %.6f <= %.6f", reinforced, score)
	}
}

func TestApplyMemoryEventReinforcesSelectedMemory(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	added, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-reinforce",
		SessionID:       "session-reinforce",
		MessageID:       1,
		Operation:       "ADD",
		MemoryType:      "misconception",
		Topic:           "list-index",
		Content:         "Student confuses list length with the largest valid index.",
		Concepts:        []string{"Concept:index", "Concept:valid_index_range"},
		OperationOrigin: "mem0",
		Reason:          "new misconception",
	})
	if err != nil {
		t.Fatalf("add memory: %v", err)
	}

	reinforced, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-reinforce",
		SessionID:       "session-reinforce",
		MessageID:       2,
		Operation:       "REINFORCE",
		TargetMemoryID:  added.MemoryID,
		OperationOrigin: "rmm_prospective_selection",
		Reason:          "selected_by_rmm_prospective_plan",
		Payload: map[string]any{
			"use_count_delta": 2,
			"strength_delta":  3,
		},
	})
	if err != nil {
		t.Fatalf("reinforce memory: %v", err)
	}
	if reinforced.MemoryID != added.MemoryID {
		t.Fatalf("expected same memory id, got %q", reinforced.MemoryID)
	}
	if reinforced.UseCount != added.UseCount+2 {
		t.Fatalf("expected use_count +2, before %d after %d", added.UseCount, reinforced.UseCount)
	}
	if reinforced.Strength != added.Strength+3 {
		t.Fatalf("expected strength +3, before %d after %d", added.Strength, reinforced.Strength)
	}
	if reinforced.EffectiveScore <= added.EffectiveScore {
		t.Fatalf("expected effective score to increase, before %.4f after %.4f", added.EffectiveScore, reinforced.EffectiveScore)
	}

	var op string
	if err := store.db.QueryRow(
		`select operation from memory_events where learner_id = ? order by id desc limit 1`,
		"learner-reinforce",
	).Scan(&op); err != nil {
		t.Fatalf("query reinforcement event: %v", err)
	}
	if op != "REINFORCE" {
		t.Fatalf("expected REINFORCE event, got %q", op)
	}
}

func TestFailedMemoryEventRollsBackEvent(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	if _, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-failed",
		SessionID:       "session-failed",
		MessageID:       1,
		Operation:       "UPDATE",
		TargetMemoryID:  "missing-memory",
		OperationOrigin: "unit-test",
		Reason:          "missing target",
	}); err == nil {
		t.Fatal("expected missing target update to fail")
	}

	if _, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:       "learner-failed",
		SessionID:       "session-failed",
		MessageID:       2,
		Operation:       "MERGE",
		OperationOrigin: "unit-test",
		Reason:          "unsupported operation",
	}); err == nil {
		t.Fatal("expected unsupported operation to fail")
	}

	var eventCount int
	if err := store.db.QueryRow(`select count(*) from memory_events where learner_id = ?`, "learner-failed").Scan(&eventCount); err != nil {
		t.Fatalf("count memory events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("expected failed operations to roll back events, got %d", eventCount)
	}
}

func TestInvalidMemoryTimestampReturnsError(t *testing.T) {
	store := openTestStore(t)

	_, err := store.db.Exec(
		`insert into learner_memory_v2
		   (memory_id, learner_id, memory_type, topic, content, concepts_json, source_event_id,
		    source_session_id, operation_origin, strength, use_count, effective_score, status,
		    valid_from, valid_to, last_used_at, updated_at, payload_json)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"memory-corrupt",
		"learner-corrupt",
		"task_summary",
		"topic",
		"content",
		"[]",
		1,
		"session-corrupt",
		"unit-test",
		1,
		0,
		1.0,
		"active",
		"not-a-time",
		nil,
		"2026-07-03T12:00:00Z",
		"2026-07-03T12:00:00Z",
		"{}",
	)
	if err != nil {
		t.Fatalf("insert corrupt memory: %v", err)
	}

	if _, err := store.ListLearnerMemoryV2(context.Background(), "learner-corrupt", 10); err == nil {
		t.Fatal("expected invalid timestamp to return an error")
	}
}
