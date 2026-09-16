package store

import (
	"context"
	"strings"
	"testing"
)

func TestParticipantTokenIsOpaqueAndTimestampsUseBeijingOffset(t *testing.T) {
	store := openTestStore(t)
	participant, token, err := store.CreateParticipant(context.Background(), "study", true)
	if err != nil {
		t.Fatalf("create participant: %v", err)
	}
	if participant.ID == "" || len(token) < 32 {
		t.Fatalf("expected generated participant and opaque token, got %#v token length %d", participant, len(token))
	}
	if !strings.HasSuffix(participant.CreatedAt, "+08:00") || !strings.HasSuffix(participant.ConsentedAt, "+08:00") {
		t.Fatalf("expected Beijing timestamps, got %#v", participant)
	}

	var storedHash string
	if err := store.db.QueryRow(`select token_hash from participants where id = ?`, participant.ID).Scan(&storedHash); err != nil {
		t.Fatalf("read stored token hash: %v", err)
	}
	if storedHash == token || strings.Contains(storedHash, token) {
		t.Fatal("raw participant token must not be stored")
	}
	resolved, err := store.GetParticipantByToken(context.Background(), token)
	if err != nil || resolved.ID != participant.ID {
		t.Fatalf("resolve participant token: %#v, %v", resolved, err)
	}
}

func TestParticipantSessionsAndMessagesAreIsolated(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	first, _, err := store.CreateParticipant(ctx, "study", true)
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := store.CreateParticipant(ctx, "study", true)
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.CreateSession(ctx, "python-learning")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.LinkParticipantSession(ctx, first.ID, session.ID); err != nil {
		t.Fatalf("link session: %v", err)
	}
	if _, err := store.SaveMessageWithID(ctx, session.ID, "student", "How do Python loops work?"); err != nil {
		t.Fatalf("save student message: %v", err)
	}
	if _, err := store.SaveMessageWithID(ctx, session.ID, "agent", "Start by tracing one iteration."); err != nil {
		t.Fatalf("save agent message: %v", err)
	}

	firstSessions, err := store.ListParticipantSessions(ctx, first.ID, "active")
	if err != nil || len(firstSessions) != 1 || firstSessions[0].MessageCount != 2 {
		t.Fatalf("first participant sessions = %#v, %v", firstSessions, err)
	}
	secondSessions, err := store.ListParticipantSessions(ctx, second.ID, "active")
	if err != nil || len(secondSessions) != 0 {
		t.Fatalf("second participant must not see first sessions: %#v, %v", secondSessions, err)
	}
	owned, err := store.ParticipantOwnsSession(ctx, first.ID, session.ID)
	if err != nil || !owned {
		t.Fatalf("first participant ownership = %v, %v", owned, err)
	}
	owned, err = store.ParticipantOwnsSession(ctx, second.ID, session.ID)
	if err != nil || owned {
		t.Fatalf("second participant ownership = %v, %v", owned, err)
	}
}

func TestTokenBudgetIsIndependentPerParticipant(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	first, _, _ := store.CreateParticipant(ctx, "study", true)
	second, _, _ := store.CreateParticipant(ctx, "study", true)

	firstBudget, err := store.RecordTokenUsageForScope(ctx, first.ID, 1200)
	if err != nil {
		t.Fatal(err)
	}
	secondBudget, err := store.GetTokenBudgetForScope(ctx, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if firstBudget.UsedTokens != 1200 || firstBudget.RemainingTokens != 22800 {
		t.Fatalf("unexpected first budget: %#v", firstBudget)
	}
	if secondBudget.UsedTokens != 0 || secondBudget.RemainingTokens != DefaultDailyTokenQuota {
		t.Fatalf("unexpected second budget: %#v", secondBudget)
	}
	if !strings.HasSuffix(firstBudget.UpdatedAt, "+08:00") || !strings.HasSuffix(secondBudget.ResetAt, "+08:00") {
		t.Fatalf("expected Beijing budget timestamps: %#v %#v", firstBudget, secondBudget)
	}
}
