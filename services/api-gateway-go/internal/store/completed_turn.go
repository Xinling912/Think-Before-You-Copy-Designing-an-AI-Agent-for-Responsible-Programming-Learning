package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrTokenBudgetExhausted = errors.New("token budget exhausted")

type TokenDebitInput struct {
	Scope       string
	TotalTokens int
}

type CompletedSessionTurnInput struct {
	SessionID              string
	LearnerID              string
	StudentContent         string
	AgentContent           string
	EpisodeID              int64
	Episode                *LearningEpisodeInput
	Evidence               map[string]any
	MemoryEvents           []MemoryEventInput
	TopicSummary           *TopicSummaryInput
	LearningFacts          []LearningFactInput
	ConversationEvents     []ConversationEventInput
	ConversationProjection *ConversationProjectionRecord
	TokenDebit             *TokenDebitInput
}

type CompletedSessionTurnResult struct {
	StudentMessageID int64
	AgentMessageID   int64
	EvidenceEventID  int64
	EpisodeID        int64
	TokenBudget      *TokenBudget
}

func (s *SQLiteStore) ConversationTurnCommitted(ctx context.Context, sessionID, clientTurnID string) (bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	clientTurnID = strings.TrimSpace(clientTurnID)
	if sessionID == "" {
		return false, fmt.Errorf("session id is required")
	}
	if clientTurnID == "" {
		return false, fmt.Errorf("client turn id is required")
	}
	var eventID string
	err := s.db.QueryRowContext(
		ctx,
		`select event_id from conversation_events where session_id = ? and client_turn_id = ? limit 1`,
		sessionID,
		clientTurnID,
	).Scan(&eventID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *SQLiteStore) PersistCompletedSessionTurn(ctx context.Context, input CompletedSessionTurnInput) (CompletedSessionTurnResult, error) {
	if input.SessionID == "" {
		return CompletedSessionTurnResult{}, fmt.Errorf("session id is required")
	}
	if input.LearnerID == "" {
		input.LearnerID = "anonymous-demo"
	}
	if input.TokenDebit != nil {
		debit := *input.TokenDebit
		debit.Scope = strings.TrimSpace(debit.Scope)
		if debit.Scope == "" {
			return CompletedSessionTurnResult{}, fmt.Errorf("token debit scope is required")
		}
		if debit.TotalTokens < 0 {
			return CompletedSessionTurnResult{}, fmt.Errorf("token debit total tokens cannot be negative")
		}
		input.TokenDebit = &debit
	}

	nowTime := time.Now().UTC()
	budgetNow := nowBeijing()
	now := formatStoreTime(nowTime)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CompletedSessionTurnResult{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := preflightConversationStateTx(
		ctx,
		tx,
		input.SessionID,
		input.ConversationEvents,
		input.ConversationProjection,
	); err != nil {
		return CompletedSessionTurnResult{}, err
	}

	var debitBudget *TokenBudget
	if input.TokenDebit != nil && input.TokenDebit.TotalTokens > 0 {
		budget, err := ensureTokenBudgetTx(ctx, tx, input.TokenDebit.Scope, budgetNow)
		if err != nil {
			return CompletedSessionTurnResult{}, err
		}
		if budget.RemainingTokens == 0 {
			return CompletedSessionTurnResult{}, ErrTokenBudgetExhausted
		}
		debitBudget = &budget
	}

	studentRes, err := insertMessageTx(ctx, tx, input.SessionID, "student", input.StudentContent, now)
	if err != nil {
		return CompletedSessionTurnResult{}, err
	}
	studentMessageID, err := studentRes.LastInsertId()
	if err != nil {
		return CompletedSessionTurnResult{}, err
	}

	var agentMessageID int64
	if strings.TrimSpace(input.AgentContent) != "" {
		agentRes, err := insertMessageTx(ctx, tx, input.SessionID, "agent", input.AgentContent, now)
		if err != nil {
			return CompletedSessionTurnResult{}, err
		}
		agentMessageID, err = agentRes.LastInsertId()
		if err != nil {
			return CompletedSessionTurnResult{}, err
		}
	}

	evidence := cloneMap(input.Evidence)
	evidence["student_message_id"] = studentMessageID
	evidence["agent_message_id"] = agentMessageID
	evidenceRes, err := insertEvidenceEventTx(ctx, tx, input.SessionID, studentMessageID, agentMessageID, "ai_step", evidence, now)
	if err != nil {
		return CompletedSessionTurnResult{}, err
	}
	evidenceEventID, err := evidenceRes.LastInsertId()
	if err != nil {
		return CompletedSessionTurnResult{}, err
	}
	if err := insertSkillUsageTx(ctx, tx, input.SessionID, evidence, now); err != nil {
		return CompletedSessionTurnResult{}, err
	}

	episodeID := input.EpisodeID
	if input.Episode != nil {
		if episodeID != 0 {
			return CompletedSessionTurnResult{}, fmt.Errorf("completed turn cannot create and update an episode simultaneously")
		}
		episode := *input.Episode
		episode.LearnerID = input.LearnerID
		episode.SessionID = input.SessionID
		episode.StudentMessageID = studentMessageID
		episode.AgentMessageID = agentMessageID
		episode.Topic = completedTurnTopic(evidence)
		episode.SkillState = completedTurnSkillState(evidence)
		episode.Payload = completedTurnEpisodePayload(evidence)
		episodeID, err = insertLearningEpisodeTx(ctx, tx, episode, now)
		if err != nil {
			return CompletedSessionTurnResult{}, err
		}
	} else if episodeID != 0 {
		if err := updateLearningEpisodeMessagesTx(ctx, tx, episodeID, LearningEpisodeUpdate{
			StudentMessageID: studentMessageID,
			AgentMessageID:   agentMessageID,
			Topic:            completedTurnTopic(evidence),
			SkillState:       completedTurnSkillState(evidence),
			Payload:          completedTurnEpisodePayload(evidence),
		}); err != nil {
			return CompletedSessionTurnResult{}, err
		}
	}

	for _, event := range filterCompletedTurnMemoryEvents(input.MemoryEvents) {
		if event.LearnerID == "" {
			event.LearnerID = input.LearnerID
		}
		if event.SessionID == "" {
			event.SessionID = input.SessionID
		}
		event.MessageID = studentMessageID
		if event.SourceEventID == 0 {
			event.SourceEventID = episodeID
		}
		if event.SourceSessionID == "" {
			event.SourceSessionID = input.SessionID
		}
		if _, err := applyMemoryEventTx(ctx, tx, event, nowTime); err != nil {
			return CompletedSessionTurnResult{}, err
		}
	}
	if len(input.MemoryEvents) > 0 {
		if err := decayAndCapMemoriesTx(ctx, tx, input.LearnerID, nowTime); err != nil {
			return CompletedSessionTurnResult{}, err
		}
	}

	if input.TopicSummary != nil {
		summary := *input.TopicSummary
		if summary.LearnerID == "" {
			summary.LearnerID = input.LearnerID
		}
		if summary.SourceSessionID == "" {
			summary.SourceSessionID = input.SessionID
		}
		if err := upsertTopicSummaryTx(ctx, tx, summary, nowTime); err != nil {
			return CompletedSessionTurnResult{}, err
		}
	}

	for _, fact := range input.LearningFacts {
		if fact.LearnerID == "" {
			fact.LearnerID = input.LearnerID
		}
		fact.SourceEpisodeID = episodeID
		if _, err := saveLearningFactTx(ctx, tx, fact, nowTime); err != nil {
			return CompletedSessionTurnResult{}, err
		}
	}

	if err := persistConversationStateTx(
		ctx,
		tx,
		input.SessionID,
		input.ConversationEvents,
		input.ConversationProjection,
		now,
	); err != nil {
		return CompletedSessionTurnResult{}, err
	}

	if debitBudget != nil {
		budget, err := debitTokenBudgetTx(ctx, tx, *debitBudget, input.TokenDebit.TotalTokens, budgetNow)
		if err != nil {
			return CompletedSessionTurnResult{}, err
		}
		debitBudget = &budget
	}

	if err := tx.Commit(); err != nil {
		return CompletedSessionTurnResult{}, err
	}
	return CompletedSessionTurnResult{
		StudentMessageID: studentMessageID,
		AgentMessageID:   agentMessageID,
		EvidenceEventID:  evidenceEventID,
		EpisodeID:        episodeID,
		TokenBudget:      debitBudget,
	}, nil
}

func preflightConversationStateTx(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	events []ConversationEventInput,
	projection *ConversationProjectionRecord,
) error {
	if len(events) == 0 && projection == nil {
		return nil
	}
	if len(events) == 0 || projection == nil {
		return ErrConversationProjectionSequenceMismatch
	}
	if projection.SessionID != "" && projection.SessionID != sessionID {
		return ErrConversationProjectionSequenceMismatch
	}

	clientTurnID := strings.TrimSpace(events[0].ClientTurnID)
	committed, err := conversationTurnExistsTx(ctx, tx, sessionID, clientTurnID)
	if err != nil {
		return err
	}
	if committed {
		return fmt.Errorf("%w: %s", ErrConversationTurnAlreadyCommitted, clientTurnID)
	}
	storedLastSequence, err := storedConversationSequenceTx(ctx, tx, sessionID)
	if err != nil {
		return err
	}
	return ValidateConversationEventBatch(sessionID, clientTurnID, storedLastSequence, events, projection)
}

func ensureTokenBudgetTx(ctx context.Context, tx *sql.Tx, scope string, now time.Time) (TokenBudget, error) {
	var storedScope string
	var dailyQuota int
	var usedTokens int
	var resetAtRaw string
	var updatedAtRaw string
	err := tx.QueryRowContext(
		ctx,
		`select scope, daily_quota, used_tokens, reset_at, updated_at
		 from token_budget
		 where scope = ?`,
		scope,
	).Scan(&storedScope, &dailyQuota, &usedTokens, &resetAtRaw, &updatedAtRaw)
	if err != nil && err != sql.ErrNoRows {
		return TokenBudget{}, err
	}

	formattedNow := formatStoreTime(now)
	if err == sql.ErrNoRows {
		if _, err := tx.ExecContext(
			ctx,
			`insert into token_budget (scope, daily_quota, used_tokens, reset_at, updated_at)
			 values (?, ?, 0, ?, ?)`,
			scope,
			DefaultDailyTokenQuota,
			formattedNow,
			formattedNow,
		); err != nil {
			return TokenBudget{}, err
		}
		return normalizeTokenBudget(scope, DefaultDailyTokenQuota, 0, formattedNow, formattedNow), nil
	}

	resetAt, err := parseStoreTime(resetAtRaw)
	if err != nil {
		return TokenBudget{}, err
	}
	if dailyQuota <= 0 || now.Sub(resetAt) >= 24*time.Hour {
		if _, err := tx.ExecContext(
			ctx,
			`update token_budget
			 set daily_quota = ?, used_tokens = 0, reset_at = ?, updated_at = ?
			 where scope = ?`,
			DefaultDailyTokenQuota,
			formattedNow,
			formattedNow,
			scope,
		); err != nil {
			return TokenBudget{}, err
		}
		return normalizeTokenBudget(scope, DefaultDailyTokenQuota, 0, formattedNow, formattedNow), nil
	}

	return normalizeTokenBudget(storedScope, dailyQuota, usedTokens, resetAtRaw, updatedAtRaw), nil
}

func debitTokenBudgetTx(ctx context.Context, tx *sql.Tx, current TokenBudget, totalTokens int, now time.Time) (TokenBudget, error) {
	updatedAt := formatStoreTime(now)
	if _, err := tx.ExecContext(
		ctx,
		`update token_budget
		 set used_tokens = min(daily_quota, used_tokens + ?), updated_at = ?
		 where scope = ?`,
		totalTokens,
		updatedAt,
		current.Scope,
	); err != nil {
		return TokenBudget{}, err
	}
	var scope string
	var dailyQuota int
	var usedTokens int
	var resetAt string
	var storedUpdatedAt string
	if err := tx.QueryRowContext(
		ctx,
		`select scope, daily_quota, used_tokens, reset_at, updated_at
		 from token_budget
		 where scope = ?`,
		current.Scope,
	).Scan(&scope, &dailyQuota, &usedTokens, &resetAt, &storedUpdatedAt); err != nil {
		return TokenBudget{}, err
	}
	return normalizeTokenBudget(scope, dailyQuota, usedTokens, resetAt, storedUpdatedAt), nil
}

func insertLearningEpisodeTx(ctx context.Context, tx *sql.Tx, input LearningEpisodeInput, now string) (int64, error) {
	payloadJSON, err := json.Marshal(cloneMap(input.Payload))
	if err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(
		ctx,
		`insert into learning_episodes
		   (learner_id, session_id, student_message_id, agent_message_id, topic, skill_state, created_at, payload_json)
		 values (?, ?, ?, ?, ?, ?, ?, ?)`,
		input.LearnerID,
		emptyToNil(input.SessionID),
		zeroIntToNil(input.StudentMessageID),
		zeroIntToNil(input.AgentMessageID),
		emptyToNil(input.Topic),
		emptyToNil(input.SkillState),
		now,
		string(payloadJSON),
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func filterCompletedTurnMemoryEvents(events []MemoryEventInput) []MemoryEventInput {
	blockedReinforcementTargets := map[string]bool{}
	for _, event := range events {
		operation := strings.ToUpper(strings.TrimSpace(event.Operation))
		if operation == "DELETE" || operation == "UPDATE" {
			target := strings.TrimSpace(event.TargetMemoryID)
			if target != "" {
				blockedReinforcementTargets[target] = true
			}
		}
	}

	filtered := make([]MemoryEventInput, 0, len(events))
	for _, event := range events {
		operation := strings.ToUpper(strings.TrimSpace(event.Operation))
		target := strings.TrimSpace(event.TargetMemoryID)
		if operation == "REINFORCE" && target != "" && blockedReinforcementTargets[target] {
			continue
		}
		filtered = append(filtered, event)
	}
	return filtered
}

func completedTurnTopic(evidence map[string]any) string {
	if state, ok := evidence["next_task_state"].(map[string]any); ok {
		if topic, ok := state["topic"].(string); ok && topic != "" {
			return topic
		}
	}
	if summary, ok := evidence["topic_summary_update"].(map[string]any); ok {
		if topic, ok := summary["topic"].(string); ok && topic != "" {
			return topic
		}
	}
	return "python_learning"
}

func completedTurnSkillState(evidence map[string]any) string {
	if state, ok := evidence["skill_state"].(map[string]any); ok {
		if value, ok := state["state"].(string); ok && value != "" {
			return value
		}
	}
	if value, ok := evidence["state"].(string); ok && value != "" {
		return value
	}
	return "completed"
}

func completedTurnEpisodePayload(evidence map[string]any) map[string]any {
	payload := cloneMap(evidence)
	payload["stored_as"] = "learning_episode"
	payload["status"] = "completed"
	return payload
}
