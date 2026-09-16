package store

import (
	"context"
	"testing"
)

func TestTokenBudgetInitializesRecordsAndResets(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	budget, err := store.GetTokenBudget(ctx)
	if err != nil {
		t.Fatalf("GetTokenBudget failed: %v", err)
	}
	if budget.Scope != TokenBudgetScope {
		t.Fatalf("scope = %q", budget.Scope)
	}
	if budget.DailyQuota != DefaultDailyTokenQuota {
		t.Fatalf("daily quota = %d", budget.DailyQuota)
	}
	if budget.UsedTokens != 0 || budget.RemainingTokens != DefaultDailyTokenQuota || budget.RemainingPercent != 100 {
		t.Fatalf("unexpected initial budget: %+v", budget)
	}

	budget, err = store.RecordTokenUsage(ctx, 150)
	if err != nil {
		t.Fatalf("RecordTokenUsage failed: %v", err)
	}
	if budget.UsedTokens != 150 {
		t.Fatalf("used tokens = %d", budget.UsedTokens)
	}
	if budget.RemainingTokens != DefaultDailyTokenQuota-150 {
		t.Fatalf("remaining tokens = %d", budget.RemainingTokens)
	}

	budget, err = store.ResetTokenBudget(ctx)
	if err != nil {
		t.Fatalf("ResetTokenBudget failed: %v", err)
	}
	if budget.UsedTokens != 0 || budget.RemainingTokens != DefaultDailyTokenQuota || budget.RemainingPercent != 100 {
		t.Fatalf("unexpected reset budget: %+v", budget)
	}
}

func TestTokenBudgetCapsUsageAtDailyQuota(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	budget, err := store.RecordTokenUsage(ctx, DefaultDailyTokenQuota+500)
	if err != nil {
		t.Fatalf("RecordTokenUsage failed: %v", err)
	}
	if budget.UsedTokens != DefaultDailyTokenQuota {
		t.Fatalf("used tokens = %d", budget.UsedTokens)
	}
	if budget.RemainingTokens != 0 || budget.RemainingPercent != 0 {
		t.Fatalf("unexpected exhausted budget: %+v", budget)
	}
}
