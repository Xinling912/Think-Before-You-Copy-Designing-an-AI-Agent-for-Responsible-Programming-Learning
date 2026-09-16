package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

type MemoryEventInput struct {
	LearnerID       string
	SessionID       string
	MessageID       int64
	Operation       string
	TargetMemoryID  string
	MemoryType      string
	Topic           string
	Content         string
	Concepts        []string
	SourceEventID   int64
	SourceSessionID string
	OperationOrigin string
	Candidate       map[string]any
	Reason          string
	Payload         map[string]any
}

type LearnerMemoryV2 struct {
	ID              int64
	MemoryID        string
	LearnerID       string
	MemoryType      string
	Topic           string
	Content         string
	Concepts        []string
	SourceEventID   int64
	SourceSessionID string
	OperationOrigin string
	Strength        int
	UseCount        int
	EffectiveScore  float64
	Status          string
	ValidFrom       time.Time
	ValidTo         time.Time
	LastUsedAt      time.Time
	UpdatedAt       time.Time
	Payload         map[string]any
}

type MemoryEvent struct {
	ID             int64          `json:"id"`
	LearnerID      string         `json:"learner_id"`
	SessionID      string         `json:"session_id"`
	MessageID      int64          `json:"message_id"`
	Operation      string         `json:"operation"`
	TargetMemoryID string         `json:"target_memory_id"`
	Candidate      map[string]any `json:"candidate"`
	ResultMemoryID string         `json:"result_memory_id"`
	Reason         string         `json:"reason"`
	CreatedAt      time.Time      `json:"created_at"`
}

func memoryEffectiveScore(strength int, useCount int, lastUsedAt time.Time, now time.Time) float64 {
	if strength < 1 {
		strength = 1
	}
	if useCount < 0 {
		useCount = 0
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if lastUsedAt.IsZero() || lastUsedAt.After(now) {
		lastUsedAt = now
	}

	ageDays := now.Sub(lastUsedAt).Hours() / 24
	retention := math.Exp(-ageDays / float64(strength))
	reinforcement := 1 + math.Log1p(float64(useCount))*0.15
	return retention * reinforcement
}

func (s *SQLiteStore) ApplyMemoryEvent(ctx context.Context, input MemoryEventInput) (LearnerMemoryV2, error) {
	if input.LearnerID == "" {
		input.LearnerID = "anonymous-demo"
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	result, err := applyMemoryEventTx(ctx, tx, input, now)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	if err := tx.Commit(); err != nil {
		return LearnerMemoryV2{}, err
	}
	return result, nil
}

func (s *SQLiteStore) GetLearnerMemoryByID(ctx context.Context, learnerID, memoryID string) (LearnerMemoryV2, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	return getLearnerMemoryByID(ctx, s.db, learnerID, memoryID)
}

func (s *SQLiteStore) ListLearnerMemoryV2(ctx context.Context, learnerID string, limit int) ([]LearnerMemoryV2, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if limit <= 0 {
		limit = 30
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, memory_id, learner_id, memory_type, topic, content, concepts_json,
		        source_event_id, source_session_id, operation_origin, strength, use_count,
		        effective_score, status, valid_from, valid_to, last_used_at, updated_at, payload_json
		 from learner_memory_v2
		 where learner_id = ? and status = 'active'
		 order by effective_score desc, updated_at desc, id desc
		 limit ?`,
		learnerID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memories := []LearnerMemoryV2{}
	for rows.Next() {
		memory, err := scanLearnerMemoryV2(rows)
		if err != nil {
			return nil, err
		}
		memories = append(memories, memory)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return memories, nil
}

func (s *SQLiteStore) ListMemoryEvents(ctx context.Context, learnerID string, limit int) ([]MemoryEvent, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if limit <= 0 {
		limit = 30
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, learner_id, session_id, message_id, operation, target_memory_id,
		        candidate_json, result_memory_id, reason, created_at
		 from memory_events
		 where learner_id = ?
		 order by id desc
		 limit ?`,
		learnerID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []MemoryEvent{}
	for rows.Next() {
		event, err := scanMemoryEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (s *SQLiteStore) DecayAndCapMemories(ctx context.Context, learnerID string, now time.Time) error {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := decayAndCapMemoriesTx(ctx, tx, learnerID, now); err != nil {
		return err
	}
	return tx.Commit()
}

func applyMemoryEventTx(ctx context.Context, tx *sql.Tx, input MemoryEventInput, now time.Time) (LearnerMemoryV2, error) {
	if input.LearnerID == "" {
		input.LearnerID = "anonymous-demo"
	}
	operation := strings.ToUpper(strings.TrimSpace(input.Operation))
	if operation == "" {
		operation = "NOOP"
	}

	var result LearnerMemoryV2
	var resultMemoryID string
	var opErr error

	switch operation {
	case "ADD":
		result, opErr = insertLearnerMemoryV2(ctx, tx, input, now)
		resultMemoryID = result.MemoryID
	case "UPDATE":
		result, opErr = updateLearnerMemoryV2(ctx, tx, input, now)
		resultMemoryID = result.MemoryID
	case "REINFORCE":
		result, opErr = reinforceLearnerMemoryV2(ctx, tx, input, now)
		resultMemoryID = result.MemoryID
	case "DELETE":
		result, opErr = deleteLearnerMemoryV2(ctx, tx, input, now)
		resultMemoryID = result.MemoryID
	case "NOOP":
		result = LearnerMemoryV2{}
	default:
		opErr = fmt.Errorf("unsupported memory operation %q", input.Operation)
	}
	if opErr != nil {
		return LearnerMemoryV2{}, opErr
	}

	if err := insertMemoryEvent(ctx, tx, input, operation, resultMemoryID, now); err != nil {
		return LearnerMemoryV2{}, err
	}
	return result, nil
}

func decayAndCapMemoriesTx(ctx context.Context, tx *sql.Tx, learnerID string, now time.Time) error {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	rows, err := tx.QueryContext(
		ctx,
		`select id, memory_id, learner_id, memory_type, topic, content, concepts_json,
		        source_event_id, source_session_id, operation_origin, strength, use_count,
		        effective_score, status, valid_from, valid_to, last_used_at, updated_at, payload_json
		 from learner_memory_v2
		 where learner_id = ? and status = 'active'`,
		learnerID,
	)
	if err != nil {
		return err
	}

	memories := []LearnerMemoryV2{}
	for rows.Next() {
		memory, err := scanLearnerMemoryV2(rows)
		if err != nil {
			_ = rows.Close()
			return err
		}
		memory.EffectiveScore = memoryEffectiveScore(memory.Strength, memory.UseCount, memory.LastUsedAt, now)
		memories = append(memories, memory)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for _, memory := range memories {
		if _, err := tx.ExecContext(
			ctx,
			`update learner_memory_v2 set effective_score = ? where id = ?`,
			memory.EffectiveScore,
			memory.ID,
		); err != nil {
			return err
		}
	}

	rows, err = tx.QueryContext(
		ctx,
		`select id
		 from learner_memory_v2
		 where learner_id = ? and status = 'active'
		 order by effective_score desc, updated_at desc, id desc
		 limit -1 offset 30`,
		learnerID,
	)
	if err != nil {
		return err
	}

	idsToDecay := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return err
		}
		idsToDecay = append(idsToDecay, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	validTo := formatStoreTime(now)
	for _, id := range idsToDecay {
		if _, err := tx.ExecContext(
			ctx,
			`update learner_memory_v2 set status = 'decayed', valid_to = ?, updated_at = ? where id = ?`,
			validTo,
			validTo,
			id,
		); err != nil {
			return err
		}
	}
	return nil
}

func insertLearnerMemoryV2(ctx context.Context, tx *sql.Tx, input MemoryEventInput, now time.Time) (LearnerMemoryV2, error) {
	memory := LearnerMemoryV2{
		MemoryID:        newID("memory"),
		LearnerID:       input.LearnerID,
		MemoryType:      stringValue(input.MemoryType, "task_summary"),
		Topic:           input.Topic,
		Content:         input.Content,
		Concepts:        input.Concepts,
		SourceEventID:   input.SourceEventID,
		SourceSessionID: stringValue(input.SourceSessionID, input.SessionID),
		OperationOrigin: input.OperationOrigin,
		Strength:        1,
		UseCount:        0,
		Status:          "active",
		ValidFrom:       now,
		LastUsedAt:      now,
		UpdatedAt:       now,
		Payload:         cloneMap(input.Payload),
	}
	memory.EffectiveScore = memoryEffectiveScore(memory.Strength, memory.UseCount, memory.LastUsedAt, now)

	conceptsJSON, err := json.Marshal(memory.Concepts)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	payloadJSON, err := json.Marshal(memory.Payload)
	if err != nil {
		return LearnerMemoryV2{}, err
	}

	res, err := tx.ExecContext(
		ctx,
		`insert into learner_memory_v2
		   (memory_id, learner_id, memory_type, topic, content, concepts_json, source_event_id,
		    source_session_id, operation_origin, strength, use_count, effective_score, status,
		    valid_from, valid_to, last_used_at, updated_at, payload_json)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		memory.MemoryID,
		memory.LearnerID,
		memory.MemoryType,
		memory.Topic,
		memory.Content,
		string(conceptsJSON),
		zeroIntToNil(memory.SourceEventID),
		emptyToNil(memory.SourceSessionID),
		emptyToNil(memory.OperationOrigin),
		memory.Strength,
		memory.UseCount,
		memory.EffectiveScore,
		memory.Status,
		formatStoreTime(memory.ValidFrom),
		nil,
		formatStoreTime(memory.LastUsedAt),
		formatStoreTime(memory.UpdatedAt),
		string(payloadJSON),
	)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	memory.ID = id
	return memory, nil
}

func updateLearnerMemoryV2(ctx context.Context, tx *sql.Tx, input MemoryEventInput, now time.Time) (LearnerMemoryV2, error) {
	if input.TargetMemoryID == "" {
		return LearnerMemoryV2{}, fmt.Errorf("target memory id is required for UPDATE")
	}
	memory, err := getLearnerMemoryByID(ctx, tx, input.LearnerID, input.TargetMemoryID)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	if input.MemoryType != "" {
		memory.MemoryType = input.MemoryType
	}
	if input.Topic != "" {
		memory.Topic = input.Topic
	}
	if input.Content != "" {
		memory.Content = input.Content
	}
	if input.Concepts != nil {
		memory.Concepts = input.Concepts
	}
	if input.SourceEventID != 0 {
		memory.SourceEventID = input.SourceEventID
	}
	if input.SourceSessionID != "" {
		memory.SourceSessionID = input.SourceSessionID
	}
	if input.OperationOrigin != "" {
		memory.OperationOrigin = input.OperationOrigin
	}
	memory.Strength++
	memory.UseCount++
	memory.Status = "active"
	memory.LastUsedAt = now
	memory.UpdatedAt = now
	memory.EffectiveScore = memoryEffectiveScore(memory.Strength, memory.UseCount, memory.LastUsedAt, now)
	memory.Payload = mergeMaps(memory.Payload, input.Payload)

	if err := writeLearnerMemoryV2(ctx, tx, memory); err != nil {
		return LearnerMemoryV2{}, err
	}
	return memory, nil
}

func deleteLearnerMemoryV2(ctx context.Context, tx *sql.Tx, input MemoryEventInput, now time.Time) (LearnerMemoryV2, error) {
	if input.TargetMemoryID == "" {
		return LearnerMemoryV2{}, fmt.Errorf("target memory id is required for DELETE")
	}
	memory, err := getLearnerMemoryByID(ctx, tx, input.LearnerID, input.TargetMemoryID)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	memory.Status = "deleted"
	memory.ValidTo = now
	memory.UpdatedAt = now
	memory.EffectiveScore = memoryEffectiveScore(memory.Strength, memory.UseCount, memory.LastUsedAt, now)

	if err := writeLearnerMemoryV2(ctx, tx, memory); err != nil {
		return LearnerMemoryV2{}, err
	}
	return memory, nil
}

func reinforceLearnerMemoryV2(ctx context.Context, tx *sql.Tx, input MemoryEventInput, now time.Time) (LearnerMemoryV2, error) {
	if input.TargetMemoryID == "" {
		return LearnerMemoryV2{}, fmt.Errorf("target memory id is required for REINFORCE")
	}
	memory, err := getLearnerMemoryByID(ctx, tx, input.LearnerID, input.TargetMemoryID)
	if err != nil {
		return LearnerMemoryV2{}, err
	}

	useDelta := numericValue(input.Payload["use_count_delta"], 1)
	strengthDelta := numericValue(input.Payload["strength_delta"], 1)
	if useDelta < 0 {
		useDelta = 0
	}
	if strengthDelta < 0 {
		strengthDelta = 0
	}

	memory.UseCount += useDelta
	memory.Strength += strengthDelta
	memory.Status = "active"
	memory.LastUsedAt = now
	memory.UpdatedAt = now
	memory.EffectiveScore = memoryEffectiveScore(memory.Strength, memory.UseCount, memory.LastUsedAt, now)
	memory.Payload = mergeMaps(memory.Payload, map[string]any{
		"last_reinforcement_reason": input.Reason,
		"last_reinforced_at":        formatStoreTime(now),
		"use_count_delta":           useDelta,
		"strength_delta":            strengthDelta,
	})

	if err := writeLearnerMemoryV2(ctx, tx, memory); err != nil {
		return LearnerMemoryV2{}, err
	}
	return memory, nil
}

func writeLearnerMemoryV2(ctx context.Context, tx *sql.Tx, memory LearnerMemoryV2) error {
	conceptsJSON, err := json.Marshal(memory.Concepts)
	if err != nil {
		return err
	}
	payloadJSON, err := json.Marshal(memory.Payload)
	if err != nil {
		return err
	}

	var validTo any
	if !memory.ValidTo.IsZero() {
		validTo = formatStoreTime(memory.ValidTo)
	}

	_, err = tx.ExecContext(
		ctx,
		`update learner_memory_v2
		 set memory_type = ?, topic = ?, content = ?, concepts_json = ?, source_event_id = ?,
		     source_session_id = ?, operation_origin = ?, strength = ?, use_count = ?,
		     effective_score = ?, status = ?, valid_from = ?, valid_to = ?, last_used_at = ?,
		     updated_at = ?, payload_json = ?
		 where id = ?`,
		memory.MemoryType,
		memory.Topic,
		memory.Content,
		string(conceptsJSON),
		zeroIntToNil(memory.SourceEventID),
		emptyToNil(memory.SourceSessionID),
		emptyToNil(memory.OperationOrigin),
		memory.Strength,
		memory.UseCount,
		memory.EffectiveScore,
		memory.Status,
		formatStoreTime(memory.ValidFrom),
		validTo,
		emptyTimeToNil(memory.LastUsedAt),
		formatStoreTime(memory.UpdatedAt),
		string(payloadJSON),
		memory.ID,
	)
	return err
}

func insertMemoryEvent(ctx context.Context, tx *sql.Tx, input MemoryEventInput, operation, resultMemoryID string, now time.Time) error {
	candidateJSON, err := json.Marshal(memoryEventCandidate(input))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(
		ctx,
		`insert into memory_events
		   (learner_id, session_id, message_id, operation, target_memory_id, candidate_json,
		    result_memory_id, reason, created_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.LearnerID,
		input.SessionID,
		zeroIntToNil(input.MessageID),
		operation,
		emptyToNil(input.TargetMemoryID),
		string(candidateJSON),
		emptyToNil(resultMemoryID),
		input.Reason,
		formatStoreTime(now),
	)
	return err
}

func memoryEventCandidate(input MemoryEventInput) map[string]any {
	candidate := cloneMap(input.Candidate)
	if input.MemoryType != "" {
		candidate["memory_type"] = input.MemoryType
	}
	if input.Topic != "" {
		candidate["topic"] = input.Topic
	}
	if input.Content != "" {
		candidate["content"] = input.Content
	}
	if input.Concepts != nil {
		candidate["concepts"] = input.Concepts
	}
	if input.Payload != nil {
		candidate["payload"] = input.Payload
	}
	return candidate
}

type learnerMemoryScanner interface {
	Scan(dest ...any) error
}

type memoryEventScanner interface {
	Scan(dest ...any) error
}

func scanMemoryEvent(scanner memoryEventScanner) (MemoryEvent, error) {
	var event MemoryEvent
	var messageID sql.NullInt64
	var targetMemoryID sql.NullString
	var resultMemoryID sql.NullString
	var candidateJSON string
	var createdAt string

	if err := scanner.Scan(
		&event.ID,
		&event.LearnerID,
		&event.SessionID,
		&messageID,
		&event.Operation,
		&targetMemoryID,
		&candidateJSON,
		&resultMemoryID,
		&event.Reason,
		&createdAt,
	); err != nil {
		return MemoryEvent{}, err
	}
	if messageID.Valid {
		event.MessageID = messageID.Int64
	}
	if targetMemoryID.Valid {
		event.TargetMemoryID = targetMemoryID.String
	}
	if resultMemoryID.Valid {
		event.ResultMemoryID = resultMemoryID.String
	}
	if err := json.Unmarshal([]byte(candidateJSON), &event.Candidate); err != nil {
		return MemoryEvent{}, err
	}
	parsed, err := parseStoreTime(createdAt)
	if err != nil {
		return MemoryEvent{}, err
	}
	event.CreatedAt = parsed
	return event, nil
}

func getLearnerMemoryByID(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, learnerID, memoryID string) (LearnerMemoryV2, error) {
	row := queryer.QueryRowContext(
		ctx,
		`select id, memory_id, learner_id, memory_type, topic, content, concepts_json,
		        source_event_id, source_session_id, operation_origin, strength, use_count,
		        effective_score, status, valid_from, valid_to, last_used_at, updated_at, payload_json
		 from learner_memory_v2
		 where learner_id = ? and memory_id = ?`,
		learnerID,
		memoryID,
	)
	return scanLearnerMemoryV2(row)
}

func scanLearnerMemoryV2(scanner learnerMemoryScanner) (LearnerMemoryV2, error) {
	var memory LearnerMemoryV2
	var conceptsJSON string
	var sourceEventID sql.NullInt64
	var sourceSessionID sql.NullString
	var operationOrigin sql.NullString
	var validFrom string
	var validTo sql.NullString
	var lastUsedAt sql.NullString
	var updatedAt string
	var payloadJSON string

	if err := scanner.Scan(
		&memory.ID,
		&memory.MemoryID,
		&memory.LearnerID,
		&memory.MemoryType,
		&memory.Topic,
		&memory.Content,
		&conceptsJSON,
		&sourceEventID,
		&sourceSessionID,
		&operationOrigin,
		&memory.Strength,
		&memory.UseCount,
		&memory.EffectiveScore,
		&memory.Status,
		&validFrom,
		&validTo,
		&lastUsedAt,
		&updatedAt,
		&payloadJSON,
	); err != nil {
		return LearnerMemoryV2{}, err
	}

	if err := json.Unmarshal([]byte(conceptsJSON), &memory.Concepts); err != nil {
		return LearnerMemoryV2{}, err
	}
	if err := json.Unmarshal([]byte(payloadJSON), &memory.Payload); err != nil {
		return LearnerMemoryV2{}, err
	}
	if sourceEventID.Valid {
		memory.SourceEventID = sourceEventID.Int64
	}
	memory.SourceSessionID = sourceSessionID.String
	memory.OperationOrigin = operationOrigin.String
	parsed, err := parseStoreTime(validFrom)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	memory.ValidFrom = parsed
	if validTo.Valid {
		parsed, err := parseStoreTime(validTo.String)
		if err != nil {
			return LearnerMemoryV2{}, err
		}
		memory.ValidTo = parsed
	}
	if lastUsedAt.Valid {
		parsed, err := parseStoreTime(lastUsedAt.String)
		if err != nil {
			return LearnerMemoryV2{}, err
		}
		memory.LastUsedAt = parsed
	}
	parsed, err = parseStoreTime(updatedAt)
	if err != nil {
		return LearnerMemoryV2{}, err
	}
	memory.UpdatedAt = parsed
	return memory, nil
}

func formatStoreTime(value time.Time) string {
	return value.In(beijingLocation).Format(time.RFC3339Nano)
}

func parseStoreTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed, nil
}

func emptyToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func emptyTimeToNil(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return formatStoreTime(value)
}

func cloneMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func mergeMaps(base map[string]any, updates map[string]any) map[string]any {
	merged := cloneMap(base)
	for key, value := range updates {
		merged[key] = value
	}
	return merged
}
