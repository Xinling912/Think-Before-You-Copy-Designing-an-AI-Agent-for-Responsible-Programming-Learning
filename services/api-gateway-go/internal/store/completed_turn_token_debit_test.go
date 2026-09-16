package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPersistCompletedSessionTurnCommitsTokenDebitWithArtifacts(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-commit")
	setTokenBudgetForTest(t, store, "learner-token-debit", DefaultDailyTokenQuota, 0)
	input.TokenDebit = &TokenDebitInput{Scope: "  learner-token-debit  ", TotalTokens: 180}

	result, err := store.PersistCompletedSessionTurn(ctx, input)
	if err != nil {
		t.Fatalf("persist completed turn: %v", err)
	}
	if result.TokenBudget == nil {
		t.Fatal("expected committed token budget")
	}
	if result.TokenBudget.Scope != "learner-token-debit" || result.TokenBudget.UsedTokens != 180 {
		t.Fatalf("unexpected committed budget: %#v", result.TokenBudget)
	}
	if result.TokenBudget.RemainingTokens != DefaultDailyTokenQuota-180 {
		t.Fatalf("remaining tokens = %d, want %d", result.TokenBudget.RemainingTokens, DefaultDailyTokenQuota-180)
	}
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 2, 1, 1, 1, 1)
}

func TestPersistCompletedSessionTurnRejectsExhaustedTokenDebitBeforeArtifacts(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-exhausted")
	setTokenBudgetForTest(t, store, "learner-exhausted", DefaultDailyTokenQuota, DefaultDailyTokenQuota)
	input.TokenDebit = &TokenDebitInput{Scope: "learner-exhausted", TotalTokens: 180}

	result, err := store.PersistCompletedSessionTurn(ctx, input)
	if !errors.Is(err, ErrTokenBudgetExhausted) {
		t.Fatalf("error = %v, want ErrTokenBudgetExhausted", err)
	}
	if result.TokenBudget != nil {
		t.Fatalf("rejected result budget = %#v, want nil", result.TokenBudget)
	}
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 0, 0, 0, 0, 0)
	assertTokenBudgetUsedTokens(t, store, "learner-exhausted", DefaultDailyTokenQuota)
}

func TestPersistCompletedSessionTurnRollsBackTokenDebitWhenLaterArtifactFails(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-rollback")
	setTokenBudgetForTest(t, store, "learner-rollback", DefaultDailyTokenQuota, 75)
	input.TokenDebit = &TokenDebitInput{Scope: "learner-rollback", TotalTokens: 180}
	input.LearningFacts = []LearningFactInput{{
		LearnerID: input.LearnerID,
		Subject:   "Learner:" + input.LearnerID,
		Predicate: "",
		Object:    "Concept:list",
	}}

	_, err := store.PersistCompletedSessionTurn(ctx, input)
	if err == nil {
		t.Fatal("expected invalid learning fact to fail completed turn transaction")
	}
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 0, 0, 0, 0, 0)
	assertTokenBudgetUsedTokens(t, store, "learner-rollback", 75)
}

func TestPersistCompletedSessionTurnZeroTokenDebitSkipsBudgetReadAndWrite(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-zero")
	input.TokenDebit = &TokenDebitInput{Scope: "learner-zero", TotalTokens: 0}

	result, err := store.PersistCompletedSessionTurn(ctx, input)
	if err != nil {
		t.Fatalf("persist completed turn: %v", err)
	}
	if result.TokenBudget != nil {
		t.Fatalf("zero debit returned budget: %#v", result.TokenBudget)
	}
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 2, 1, 1, 1, 1)
	assertTokenBudgetRowCount(t, store, "learner-zero", 0)
}

func TestPersistCompletedSessionTurnTokenDebitNilSkipsBudgetReadAndWrite(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-nil")
	setTokenBudgetForTest(t, store, "learner-nil", 12345, 678)
	before := readTokenBudgetRowSnapshot(t, store, "learner-nil")

	result, err := store.PersistCompletedSessionTurn(ctx, input)
	if err != nil {
		t.Fatalf("persist completed turn: %v", err)
	}
	if result.TokenBudget != nil {
		t.Fatalf("nil debit returned budget: %#v", result.TokenBudget)
	}
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 2, 1, 1, 1, 1)
	after := readTokenBudgetRowSnapshot(t, store, "learner-nil")
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("nil debit changed existing budget row: before=%#v after=%#v", before, after)
	}
}

func TestPersistCompletedSessionTurnTokenDebitValidationRejectsBlankScopeAndNegativeTotal(t *testing.T) {
	tests := []struct {
		name  string
		debit TokenDebitInput
	}{
		{name: "blank scope", debit: TokenDebitInput{Scope: "  ", TotalTokens: 1}},
		{name: "negative total", debit: TokenDebitInput{Scope: "learner-invalid", TotalTokens: -1}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := openTestStore(t)
			input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-invalid-"+uuid.NewString())
			input.TokenDebit = &test.debit

			_, err := store.PersistCompletedSessionTurn(context.Background(), input)
			if err == nil {
				t.Fatal("expected invalid token debit to fail")
			}
			assertCompletedTurnTokenDebitArtifacts(t, store, input, 0, 0, 0, 0, 0)
			assertTokenBudgetRowCount(t, store, test.debit.Scope, 0)
		})
	}
}

func TestPersistCompletedSessionTurnDoesNotDoubleDebitDuplicateClientTurn(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-duplicate")
	setTokenBudgetForTest(t, store, "learner-duplicate", DefaultDailyTokenQuota, 20)
	input.TokenDebit = &TokenDebitInput{Scope: "learner-duplicate", TotalTokens: 180}

	if _, err := store.PersistCompletedSessionTurn(ctx, input); err != nil {
		t.Fatalf("persist first completed turn: %v", err)
	}
	input.ConversationEvents[0].EventID = uuid.NewString()
	_, err := store.PersistCompletedSessionTurn(ctx, input)
	if !errors.Is(err, ErrConversationTurnAlreadyCommitted) {
		t.Fatalf("duplicate error = %v, want ErrConversationTurnAlreadyCommitted", err)
	}
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 2, 1, 1, 1, 1)
	assertTokenBudgetUsedTokens(t, store, "learner-duplicate", 200)
}

func TestPersistCompletedSessionTurnExhaustedDuplicateReturnsAlreadyCommitted(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-exhausted-duplicate")
	setTokenBudgetForTest(t, store, "learner-exhausted-duplicate", 180, 0)
	input.TokenDebit = &TokenDebitInput{Scope: "learner-exhausted-duplicate", TotalTokens: 180}

	firstResult, err := store.PersistCompletedSessionTurn(ctx, input)
	if err != nil {
		t.Fatalf("persist first completed turn: %v", err)
	}
	if firstResult.TokenBudget == nil || firstResult.TokenBudget.RemainingTokens != 0 {
		t.Fatalf("first turn budget = %#v, want exhausted", firstResult.TokenBudget)
	}
	budgetBeforeRetry := readTokenBudgetRowSnapshot(t, store, "learner-exhausted-duplicate")
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 2, 1, 1, 1, 1)

	input.ConversationEvents[0].EventID = uuid.NewString()
	_, err = store.PersistCompletedSessionTurn(ctx, input)
	if !errors.Is(err, ErrConversationTurnAlreadyCommitted) {
		t.Fatalf("duplicate error = %v, want ErrConversationTurnAlreadyCommitted", err)
	}
	assertCompletedTurnTokenDebitArtifacts(t, store, input, 2, 1, 1, 1, 1)
	budgetAfterRetry := readTokenBudgetRowSnapshot(t, store, "learner-exhausted-duplicate")
	if !reflect.DeepEqual(budgetAfterRetry, budgetBeforeRetry) {
		t.Fatalf("duplicate retry changed exhausted budget: before=%#v after=%#v", budgetBeforeRetry, budgetAfterRetry)
	}
}

func tokenDebitCompletedTurnInput(t *testing.T, store *SQLiteStore, clientTurnID string) CompletedSessionTurnInput {
	t.Helper()
	session, err := store.CreateSession(context.Background(), "token-debit")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	input := conversationCompletedTurnInput(session.ID, clientTurnID, 1, 1)
	input.LearnerID = "learner-token-debit"
	return input
}

func setTokenBudgetForTest(t *testing.T, store *SQLiteStore, scope string, dailyQuota, usedTokens int) {
	t.Helper()
	now := formatStoreTime(nowBeijing())
	if _, err := store.db.Exec(`
		insert into token_budget (scope, daily_quota, used_tokens, reset_at, updated_at)
		values (?, ?, ?, ?, ?)
	`, scope, dailyQuota, usedTokens, now, now); err != nil {
		t.Fatalf("insert token budget: %v", err)
	}
}

func assertCompletedTurnTokenDebitArtifacts(
	t *testing.T,
	store *SQLiteStore,
	input CompletedSessionTurnInput,
	messages int,
	evidence int,
	skillUsage int,
	events int,
	projections int,
) {
	t.Helper()
	checks := []struct {
		table string
		want  int
	}{
		{table: "messages", want: messages},
		{table: "evidence_events", want: evidence},
		{table: "skill_usage", want: skillUsage},
		{table: "conversation_events", want: events},
		{table: "conversation_projections", want: projections},
	}
	for _, check := range checks {
		var got int
		if err := store.db.QueryRow(`select count(*) from `+check.table+` where session_id = ?`, input.SessionID).Scan(&got); err != nil {
			t.Fatalf("count %s: %v", check.table, err)
		}
		if got != check.want {
			t.Fatalf("%s count = %d, want %d", check.table, got, check.want)
		}
	}

	if projections == 1 {
		var storedLastSequence int64
		var storedProjectionJSON string
		if err := store.db.QueryRow(
			`select last_sequence, projection_json from conversation_projections where session_id = ?`,
			input.SessionID,
		).Scan(&storedLastSequence, &storedProjectionJSON); err != nil {
			t.Fatalf("read conversation projection: %v", err)
		}
		if input.ConversationProjection == nil {
			t.Fatal("fixture has no conversation projection")
		}
		if storedLastSequence != input.ConversationProjection.LastSequence {
			t.Fatalf("projection last_sequence = %d, want %d", storedLastSequence, input.ConversationProjection.LastSequence)
		}
		expectedProjectionJSON, err := json.Marshal(input.ConversationProjection.Projection)
		if err != nil {
			t.Fatalf("encode expected conversation projection: %v", err)
		}
		if storedProjectionJSON != string(expectedProjectionJSON) {
			t.Fatalf("projection_json = %s, want %s", storedProjectionJSON, expectedProjectionJSON)
		}
	}
}

type tokenBudgetRowSnapshot struct {
	Scope      string
	DailyQuota int
	UsedTokens int
	ResetAt    string
	UpdatedAt  string
}

func readTokenBudgetRowSnapshot(t *testing.T, store *SQLiteStore, scope string) tokenBudgetRowSnapshot {
	t.Helper()
	var snapshot tokenBudgetRowSnapshot
	if err := store.db.QueryRow(`
		select scope, daily_quota, used_tokens, reset_at, updated_at
		from token_budget
		where scope = ?
	`, scope).Scan(
		&snapshot.Scope,
		&snapshot.DailyQuota,
		&snapshot.UsedTokens,
		&snapshot.ResetAt,
		&snapshot.UpdatedAt,
	); err != nil {
		t.Fatalf("read token budget row snapshot: %v", err)
	}
	return snapshot
}

func assertTokenBudgetUsedTokens(t *testing.T, store *SQLiteStore, scope string, want int) {
	t.Helper()
	var got int
	if err := store.db.QueryRow(`select used_tokens from token_budget where scope = ?`, scope).Scan(&got); err != nil {
		t.Fatalf("read token budget: %v", err)
	}
	if got != want {
		t.Fatalf("used_tokens = %d, want %d", got, want)
	}
}

func assertTokenBudgetRowCount(t *testing.T, store *SQLiteStore, scope string, want int) {
	t.Helper()
	var got int
	if err := store.db.QueryRow(`select count(*) from token_budget where scope = ?`, scope).Scan(&got); err != nil {
		t.Fatalf("count token budget rows: %v", err)
	}
	if got != want {
		t.Fatalf("token budget row count = %d, want %d", got, want)
	}
}

func TestPersistCompletedSessionTurnTokenDebitResetsExpiredBudgetInsideTransaction(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-reset")
	expired := formatStoreTime(nowBeijing().Add(-25 * time.Hour))
	updated := formatStoreTime(nowBeijing().Add(-time.Hour))
	if _, err := store.db.Exec(`
		insert into token_budget (scope, daily_quota, used_tokens, reset_at, updated_at)
		values (?, ?, ?, ?, ?)
	`, "learner-expired", DefaultDailyTokenQuota, DefaultDailyTokenQuota, expired, updated); err != nil {
		t.Fatalf("insert expired token budget: %v", err)
	}
	input.TokenDebit = &TokenDebitInput{Scope: "learner-expired", TotalTokens: 180}

	result, err := store.PersistCompletedSessionTurn(ctx, input)
	if err != nil {
		t.Fatalf("persist completed turn with expired budget: %v", err)
	}
	if result.TokenBudget == nil || result.TokenBudget.UsedTokens != 180 {
		t.Fatalf("unexpected reset-and-debited budget: %#v", result.TokenBudget)
	}
}

func TestPersistCompletedSessionTurnTokenDebitCapsAtRemainingTokens(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := tokenDebitCompletedTurnInput(t, store, "turn-token-debit-cap")
	setTokenBudgetForTest(t, store, "learner-cap", DefaultDailyTokenQuota, DefaultDailyTokenQuota-100)
	input.TokenDebit = &TokenDebitInput{Scope: "learner-cap", TotalTokens: 180}

	result, err := store.PersistCompletedSessionTurn(ctx, input)
	if err != nil {
		t.Fatalf("persist completed turn: %v", err)
	}
	if result.TokenBudget == nil || result.TokenBudget.UsedTokens != DefaultDailyTokenQuota {
		t.Fatalf("unexpected capped budget: %#v", result.TokenBudget)
	}
	if result.TokenBudget.RemainingTokens != 0 {
		t.Fatalf("remaining tokens = %d, want 0", result.TokenBudget.RemainingTokens)
	}
	assertTokenBudgetUsedTokens(t, store, "learner-cap", DefaultDailyTokenQuota)
}
