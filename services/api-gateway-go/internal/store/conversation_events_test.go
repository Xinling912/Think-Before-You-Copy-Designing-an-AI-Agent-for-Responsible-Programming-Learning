package store

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestConversationMigrationCreatesEventAndProjectionConstraints(t *testing.T) {
	store := openTestStore(t)

	assertConversationTableColumns(t, store, "conversation_events", []string{
		"id", "event_id", "session_id", "client_turn_id", "ordinal", "sequence",
		"event_type", "payload_json", "created_at",
	})
	assertConversationTableColumns(t, store, "conversation_projections", []string{
		"session_id", "last_sequence", "projection_json", "updated_at",
	})

	assertConversationUniqueConstraint(t, store,
		`insert into conversation_events (
			event_id, session_id, client_turn_id, ordinal, sequence, event_type, payload_json, created_at
		) values (?, ?, ?, ?, ?, ?, '{}', '2026-07-20T00:00:00Z')`,
		[]any{"event-1", "session-a", "turn-a", 1, 1, "user_message_received"},
		[]any{"event-1", "session-b", "turn-b", 1, 1, "user_message_received"},
	)
	assertConversationUniqueConstraint(t, store,
		`insert into conversation_events (
			event_id, session_id, client_turn_id, ordinal, sequence, event_type, payload_json, created_at
		) values (?, ?, ?, ?, ?, ?, '{}', '2026-07-20T00:00:00Z')`,
		[]any{"event-2", "session-c", "turn-c", 1, 1, "user_message_received"},
		[]any{"event-3", "session-c", "turn-c", 1, 2, "turn_resolved"},
	)
	assertConversationUniqueConstraint(t, store,
		`insert into conversation_events (
			event_id, session_id, client_turn_id, ordinal, sequence, event_type, payload_json, created_at
		) values (?, ?, ?, ?, ?, ?, '{}', '2026-07-20T00:00:00Z')`,
		[]any{"event-4", "session-d", "turn-d", 1, 1, "user_message_received"},
		[]any{"event-5", "session-d", "turn-e", 1, 1, "turn_resolved"},
	)
}

func TestGetConversationProjectionReturnsCanonicalEmptyProjection(t *testing.T) {
	store := openTestStore(t)

	record, err := store.GetConversationProjection(context.Background(), "session-without-projection")
	if err != nil {
		t.Fatalf("get absent projection: %v", err)
	}
	if record.SessionID != "session-without-projection" || record.LastSequence != 0 {
		t.Fatalf("unexpected empty projection record: %#v", record)
	}
	if got := record.Projection["schema_version"]; got != 1 {
		t.Fatalf("schema_version = %#v, want 1", got)
	}
	if got := record.Projection["last_sequence"]; got != int64(0) {
		t.Fatalf("last_sequence = %#v, want int64(0)", got)
	}
	if got := record.Projection["active_topic_id"]; got != nil {
		t.Fatalf("active_topic_id = %#v, want nil", got)
	}
	if got, ok := record.Projection["back_stack"].([]any); !ok || len(got) != 0 {
		t.Fatalf("back_stack = %#v, want empty []any", record.Projection["back_stack"])
	}
	if got, ok := record.Projection["topics"].(map[string]any); !ok || len(got) != 0 {
		t.Fatalf("topics = %#v, want empty map", record.Projection["topics"])
	}
}

func TestPersistCompletedSessionTurnRejectsInvalidEventEnvelopeDefenseInDepth(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*CompletedSessionTurnInput)
	}{
		{name: "malformed event id", mutate: func(input *CompletedSessionTurnInput) { input.ConversationEvents[0].EventID = "not-a-uuid" }},
		{name: "unsupported event type", mutate: func(input *CompletedSessionTurnInput) { input.ConversationEvents[0].EventType = "unsupported_event" }},
		{name: "missing payload object", mutate: func(input *CompletedSessionTurnInput) { input.ConversationEvents[0].Payload = nil }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := openTestStore(t)
			ctx := context.Background()
			session, err := store.CreateSession(ctx, "conversation-defense")
			if err != nil {
				t.Fatalf("create session: %v", err)
			}
			input := conversationCompletedTurnInput(session.ID, "turn-invalid-envelope", 1, 1)
			test.mutate(&input)

			_, err = store.PersistCompletedSessionTurn(ctx, input)
			if !errors.Is(err, ErrConversationEventEnvelopeInvalid) {
				t.Fatalf("error = %v, want ErrConversationEventEnvelopeInvalid", err)
			}
			assertConversationArtifactCounts(t, store, session.ID, 0, 0, 0, 0)
		})
	}
}

func TestPersistCompletedSessionTurnRollsBackAllArtifactsOnProjectionSequenceError(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "conversation-rollback")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	_, err = store.PersistCompletedSessionTurn(ctx, conversationCompletedTurnInput(session.ID, "turn-retry", 1, 2))
	if !errors.Is(err, ErrConversationProjectionSequenceMismatch) {
		t.Fatalf("error = %v, want ErrConversationProjectionSequenceMismatch", err)
	}
	assertConversationArtifactCounts(t, store, session.ID, 0, 0, 0, 0)

	input := conversationCompletedTurnInput(session.ID, "turn-retry", 1, 1)
	if _, err := store.PersistCompletedSessionTurn(ctx, input); err != nil {
		t.Fatalf("retry same client_turn_id after rollback: %v", err)
	}
	assertConversationArtifactCounts(t, store, session.ID, 2, 1, 1, 1)
}

func TestPersistCompletedSessionTurnRejectsMismatchedConversationEventSessionWithoutArtifacts(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "conversation-session-mismatch")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	input := conversationCompletedTurnInput(session.ID, "turn-session-mismatch", 1, 1)
	input.ConversationEvents[0].SessionID = "session-from-different-request"

	_, err = store.PersistCompletedSessionTurn(ctx, input)
	if !errors.Is(err, ErrConversationEventSessionMismatch) {
		t.Fatalf("error = %v, want ErrConversationEventSessionMismatch", err)
	}
	assertConversationArtifactCounts(t, store, session.ID, 0, 0, 0, 0)
}

func TestPersistCompletedSessionTurnRejectsDuplicateCommittedClientTurn(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "conversation-idempotency")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	input := conversationCompletedTurnInput(session.ID, "turn-duplicate", 1, 1)
	if _, err := store.PersistCompletedSessionTurn(ctx, input); err != nil {
		t.Fatalf("persist first turn: %v", err)
	}

	input.ConversationEvents[0].EventID = uuid.NewString()
	_, err = store.PersistCompletedSessionTurn(ctx, input)
	if !errors.Is(err, ErrConversationTurnAlreadyCommitted) {
		t.Fatalf("error = %v, want ErrConversationTurnAlreadyCommitted", err)
	}
	assertConversationArtifactCounts(t, store, session.ID, 2, 1, 1, 1)
}

func TestPersistCompletedSessionTurnEnforcesCrossTurnAndInternalSequenceContinuity(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "conversation-continuity")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if _, err := store.PersistCompletedSessionTurn(ctx, conversationCompletedTurnInput(session.ID, "turn-1", 1, 1)); err != nil {
		t.Fatalf("persist first turn: %v", err)
	}

	wrongStart := conversationCompletedTurnInput(session.ID, "turn-wrong-start", 3, 3)
	if _, err := store.PersistCompletedSessionTurn(ctx, wrongStart); !errors.Is(err, ErrConversationProjectionSequenceMismatch) {
		t.Fatalf("wrong-start error = %v, want sequence mismatch", err)
	}
	assertConversationArtifactCounts(t, store, session.ID, 2, 1, 1, 1)

	nonContiguous := conversationCompletedTurnInput(session.ID, "turn-gap", 2, 4)
	nonContiguous.ConversationEvents = append(nonContiguous.ConversationEvents, ConversationEventInput{
		EventID: uuid.NewString(), SessionID: session.ID, ClientTurnID: "turn-gap", Ordinal: 2,
		Sequence: 4, EventType: "turn_resolved", Payload: map[string]any{"resolved_intent": "concept_question"},
	})
	if _, err := store.PersistCompletedSessionTurn(ctx, nonContiguous); !errors.Is(err, ErrConversationProjectionSequenceMismatch) {
		t.Fatalf("internal-gap error = %v, want sequence mismatch", err)
	}
	assertConversationArtifactCounts(t, store, session.ID, 2, 1, 1, 1)

	valid := conversationCompletedTurnInput(session.ID, "turn-2", 2, 2)
	if _, err := store.PersistCompletedSessionTurn(ctx, valid); err != nil {
		t.Fatalf("persist contiguous second turn: %v", err)
	}
	projection, err := store.GetConversationProjection(ctx, session.ID)
	if err != nil {
		t.Fatalf("get stored projection: %v", err)
	}
	if projection.LastSequence != 2 || projection.Projection["last_sequence"] != float64(2) {
		t.Fatalf("unexpected stored projection: %#v", projection)
	}
}

func conversationCompletedTurnInput(sessionID, clientTurnID string, eventSequence, projectionSequence int64) CompletedSessionTurnInput {
	return CompletedSessionTurnInput{
		SessionID: sessionID, LearnerID: "learner-conversation",
		StudentContent: "What is len?", AgentContent: "len returns an object's length.",
		Evidence: map[string]any{"skill_id": "student-learning/retrieve-first-gate"},
		ConversationEvents: []ConversationEventInput{{
			EventID: uuid.NewString(), SessionID: sessionID, ClientTurnID: clientTurnID, Ordinal: 1,
			Sequence: eventSequence, EventType: "user_message_received", Payload: map[string]any{"original_message": "What is len?"},
		}},
		ConversationProjection: &ConversationProjectionRecord{
			SessionID: sessionID, LastSequence: projectionSequence,
			Projection: map[string]any{
				"schema_version": 1, "last_sequence": projectionSequence,
				"active_topic_id": "topic-len", "back_stack": []any{},
				"topics": map[string]any{"topic-len": map[string]any{"topic_label": "len"}},
			},
		},
	}
}

func assertConversationArtifactCounts(t *testing.T, store *SQLiteStore, sessionID string, messages, evidence, events, projections int) {
	t.Helper()
	checks := []struct {
		table string
		want  int
	}{
		{"messages", messages}, {"evidence_events", evidence},
		{"conversation_events", events}, {"conversation_projections", projections},
	}
	for _, check := range checks {
		var got int
		if err := store.db.QueryRow(`select count(*) from `+check.table+` where session_id = ?`, sessionID).Scan(&got); err != nil {
			t.Fatalf("count %s: %v", check.table, err)
		}
		if got != check.want {
			t.Fatalf("%s count = %d, want %d", check.table, got, check.want)
		}
	}
}

func assertConversationTableColumns(t *testing.T, store *SQLiteStore, table string, want []string) {
	t.Helper()
	rows, err := store.db.Query(`pragma table_info(` + table + `)`)
	if err != nil {
		t.Fatalf("table_info(%s): %v", table, err)
	}
	defer rows.Close()
	got := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatalf("scan table_info(%s): %v", table, err)
		}
		got[name] = true
	}
	for _, column := range want {
		if !got[column] {
			t.Errorf("table %s missing column %s", table, column)
		}
	}
}

func assertConversationUniqueConstraint(t *testing.T, store *SQLiteStore, query string, first, second []any) {
	t.Helper()
	if _, err := store.db.Exec(query, first...); err != nil {
		t.Fatalf("insert uniqueness fixture: %v", err)
	}
	if _, err := store.db.Exec(query, second...); err == nil {
		t.Fatal("expected unique constraint violation")
	}
}
