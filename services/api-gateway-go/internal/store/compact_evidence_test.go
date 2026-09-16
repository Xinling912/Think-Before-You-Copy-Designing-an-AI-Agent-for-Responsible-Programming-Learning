package store

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestGetSessionChatDetailReturnsTraceWithoutRawEvidence(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "python-learning")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	student, err := store.SaveMessageWithID(ctx, session.ID, "student", "why does this fail?")
	if err != nil {
		t.Fatalf("save student message: %v", err)
	}
	agent, err := store.SaveMessageWithID(ctx, session.ID, "agent", "check the valid indices")
	if err != nil {
		t.Fatalf("save agent message: %v", err)
	}
	largeKG := strings.Repeat("k", 2*1024*1024)
	if _, err := insertEvidenceEventTx(ctx, store.db, session.ID, student, agent, "ai_step", map[string]any{
		"learning_trace": map[string]any{"guided_response": "check indices"},
		"kg_grounding":   largeKG,
		"evidence":       map[string]any{"kg_grounding": largeKG},
	}, "2026-07-27T00:00:00Z"); err != nil {
		t.Fatalf("insert evidence: %v", err)
	}

	detail, err := store.GetSessionChatDetail(ctx, session.ID)
	if err != nil {
		t.Fatalf("get chat detail: %v", err)
	}
	if len(detail.EvidenceEvents) != 1 {
		t.Fatalf("evidence events = %d, want 1", len(detail.EvidenceEvents))
	}
	body, err := json.Marshal(detail.EvidenceEvents)
	if err != nil {
		t.Fatalf("marshal compact event: %v", err)
	}
	if len(body) > 16*1024 {
		t.Fatalf("compact event bytes = %d, want <= 16384", len(body))
	}
	if !bytes.Contains(body, []byte(`"learning_trace"`)) {
		t.Fatal("learning trace missing")
	}
	if bytes.Contains(body, []byte(`"kg_grounding"`)) {
		t.Fatal("raw kg grounding leaked")
	}
}

func TestCompactEvidenceForPersistenceRemovesOnlyEqualNestedKG(t *testing.T) {
	payload := map[string]any{
		"kg_grounding": map[string]any{"node_ids": []any{"n1", "n2"}},
		"evidence": map[string]any{
			"kg_grounding": map[string]any{"node_ids": []any{"n1", "n2"}},
			"sources":      []any{"source-a"},
		},
	}
	before, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal caller payload: %v", err)
	}

	compact, err := CompactEvidencePayload(payload)
	if err != nil {
		t.Fatalf("compact payload: %v", err)
	}
	after, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal caller payload after compaction: %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("compaction mutated caller payload")
	}
	if _, ok := compact["kg_grounding"]; !ok {
		t.Fatal("top-level kg grounding missing")
	}
	evidence := compact["evidence"].(map[string]any)
	if _, ok := evidence["kg_grounding"]; ok {
		t.Fatal("equal nested kg grounding was retained")
	}
	if evidence["sources"].([]any)[0] != "source-a" {
		t.Fatal("nonduplicate evidence field changed")
	}
}

func TestCompactEvidenceForPersistenceKeepsDifferentNestedKG(t *testing.T) {
	compact, err := CompactEvidencePayload(map[string]any{
		"kg_grounding": map[string]any{"node_ids": []any{"n1"}},
		"evidence":     map[string]any{"kg_grounding": map[string]any{"node_ids": []any{"n2"}}},
	})
	if err != nil {
		t.Fatalf("compact payload: %v", err)
	}
	evidence := compact["evidence"].(map[string]any)
	if _, ok := evidence["kg_grounding"]; !ok {
		t.Fatal("different nested kg grounding was removed")
	}
}
