package store

import (
	"context"
	"database/sql"
	"math"
	"strings"
	"time"
)

const (
	TokenBudgetScope       = "global-demo"
	DefaultDailyTokenQuota = 24000
)

type TokenBudget struct {
	Scope            string `json:"scope"`
	DailyQuota       int    `json:"daily_quota"`
	UsedTokens       int    `json:"used_tokens"`
	RemainingTokens  int    `json:"remaining_tokens"`
	RemainingPercent int    `json:"remaining_percent"`
	ResetAt          string `json:"reset_at"`
	UpdatedAt        string `json:"updated_at"`
}

func (s *SQLiteStore) GetTokenBudget(ctx context.Context) (TokenBudget, error) {
	return s.GetTokenBudgetForScope(ctx, TokenBudgetScope)
}

func (s *SQLiteStore) RecordTokenUsage(ctx context.Context, totalTokens int) (TokenBudget, error) {
	return s.RecordTokenUsageForScope(ctx, TokenBudgetScope, totalTokens)
}

func (s *SQLiteStore) GetTokenBudgetForScope(ctx context.Context, scope string) (TokenBudget, error) {
	return s.ensureTokenBudget(ctx, normalizeBudgetScope(scope), nowBeijing())
}

func (s *SQLiteStore) RecordTokenUsageForScope(ctx context.Context, scope string, totalTokens int) (TokenBudget, error) {
	scope = normalizeBudgetScope(scope)
	if totalTokens <= 0 {
		return s.GetTokenBudgetForScope(ctx, scope)
	}
	now := nowBeijing()
	if _, err := s.ensureTokenBudget(ctx, scope, now); err != nil {
		return TokenBudget{}, err
	}
	_, err := s.db.ExecContext(
		ctx,
		`update token_budget
		 set used_tokens = min(daily_quota, used_tokens + ?), updated_at = ?
		 where scope = ?`,
		totalTokens,
		formatStoreTime(now),
		scope,
	)
	if err != nil {
		return TokenBudget{}, err
	}
	return s.GetTokenBudgetForScope(ctx, scope)
}

func (s *SQLiteStore) ResetTokenBudget(ctx context.Context) (TokenBudget, error) {
	return s.ResetTokenBudgetForScope(ctx, TokenBudgetScope)
}

func (s *SQLiteStore) ResetTokenBudgetForScope(ctx context.Context, scope string) (TokenBudget, error) {
	scope = normalizeBudgetScope(scope)
	now := nowBeijing()
	_, err := s.db.ExecContext(
		ctx,
		`insert into token_budget (scope, daily_quota, used_tokens, reset_at, updated_at)
		 values (?, ?, 0, ?, ?)
		 on conflict(scope) do update set
		   daily_quota = excluded.daily_quota,
		   used_tokens = 0,
		   reset_at = excluded.reset_at,
		   updated_at = excluded.updated_at`,
		scope,
		DefaultDailyTokenQuota,
		formatStoreTime(now),
		formatStoreTime(now),
	)
	if err != nil {
		return TokenBudget{}, err
	}
	return s.GetTokenBudgetForScope(ctx, scope)
}

func (s *SQLiteStore) ensureTokenBudget(ctx context.Context, scopeKey string, now time.Time) (TokenBudget, error) {
	var scope string
	var dailyQuota int
	var usedTokens int
	var resetAtRaw string
	var updatedAtRaw string
	err := s.db.QueryRowContext(
		ctx,
		`select scope, daily_quota, used_tokens, reset_at, updated_at
		 from token_budget
		 where scope = ?`,
		scopeKey,
	).Scan(&scope, &dailyQuota, &usedTokens, &resetAtRaw, &updatedAtRaw)
	if err != nil {
		if err == sql.ErrNoRows {
			return s.ResetTokenBudgetForScope(ctx, scopeKey)
		}
		return TokenBudget{}, err
	}
	if dailyQuota <= 0 {
		return s.ResetTokenBudgetForScope(ctx, scopeKey)
	}
	resetAt, err := parseStoreTime(resetAtRaw)
	if err != nil {
		return TokenBudget{}, err
	}
	if now.Sub(resetAt) >= 24*time.Hour {
		return s.ResetTokenBudgetForScope(ctx, scopeKey)
	}
	return normalizeTokenBudget(scope, dailyQuota, usedTokens, resetAtRaw, updatedAtRaw), nil
}

func normalizeBudgetScope(scope string) string {
	if strings.TrimSpace(scope) == "" {
		return TokenBudgetScope
	}
	return strings.TrimSpace(scope)
}

func normalizeTokenBudget(scope string, dailyQuota int, usedTokens int, resetAt string, updatedAt string) TokenBudget {
	if dailyQuota <= 0 {
		dailyQuota = DefaultDailyTokenQuota
	}
	if usedTokens < 0 {
		usedTokens = 0
	}
	if usedTokens > dailyQuota {
		usedTokens = dailyQuota
	}
	remaining := dailyQuota - usedTokens
	percent := int(math.Round(float64(remaining) * 100 / float64(dailyQuota)))
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	return TokenBudget{
		Scope:            scope,
		DailyQuota:       dailyQuota,
		UsedTokens:       usedTokens,
		RemainingTokens:  remaining,
		RemainingPercent: percent,
		ResetAt:          resetAt,
		UpdatedAt:        updatedAt,
	}
}
