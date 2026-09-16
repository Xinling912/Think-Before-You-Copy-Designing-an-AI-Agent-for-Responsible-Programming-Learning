package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

var ErrConversationProjectionSequenceMismatch = errors.New("conversation projection sequence mismatch")
var ErrConversationTurnAlreadyCommitted = errors.New("conversation turn already committed")
var ErrConversationEventSessionMismatch = errors.New("conversation event session mismatch")
var ErrConversationEventEnvelopeInvalid = errors.New("conversation event envelope invalid")

var conversationEventTypes = map[string]struct{}{
	"user_message_received":        {},
	"kg_node_selected":             {},
	"turn_resolved":                {},
	"topic_created":                {},
	"topic_suspended":              {},
	"topic_resumed":                {},
	"retrieval_completed":          {},
	"pedagogy_advanced":            {},
	"assistant_response_committed": {},
}

type ConversationEventInput struct {
	EventID      string         `json:"event_id"`
	SessionID    string         `json:"session_id"`
	ClientTurnID string         `json:"client_turn_id"`
	Ordinal      int            `json:"ordinal"`
	Sequence     int64          `json:"sequence"`
	EventType    string         `json:"event_type"`
	Payload      map[string]any `json:"payload"`
}

type ConversationProjectionRecord struct {
	SessionID    string         `json:"session_id"`
	LastSequence int64          `json:"last_sequence"`
	Projection   map[string]any `json:"projection"`
}

func (s *SQLiteStore) GetConversationProjection(ctx context.Context, sessionID string) (ConversationProjectionRecord, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return ConversationProjectionRecord{}, fmt.Errorf("session id is required")
	}

	var record ConversationProjectionRecord
	var projectionJSON string
	err := s.db.QueryRowContext(
		ctx,
		`select session_id, last_sequence, projection_json
		 from conversation_projections
		 where session_id = ?`,
		sessionID,
	).Scan(&record.SessionID, &record.LastSequence, &projectionJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return emptyConversationProjection(sessionID), nil
	}
	if err != nil {
		return ConversationProjectionRecord{}, err
	}
	if err := json.Unmarshal([]byte(projectionJSON), &record.Projection); err != nil {
		return ConversationProjectionRecord{}, fmt.Errorf("decode conversation projection: %w", err)
	}
	return record, nil
}

func emptyConversationProjection(sessionID string) ConversationProjectionRecord {
	return ConversationProjectionRecord{
		SessionID:    sessionID,
		LastSequence: 0,
		Projection: map[string]any{
			"schema_version":  1,
			"last_sequence":   int64(0),
			"active_topic_id": nil,
			"back_stack":      []any{},
			"topics":          map[string]any{},
		},
	}
}

func persistConversationStateTx(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	events []ConversationEventInput,
	projection *ConversationProjectionRecord,
	now string,
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
	if err := ValidateConversationEventBatch(sessionID, clientTurnID, storedLastSequence, events, projection); err != nil {
		return err
	}

	for _, event := range events {
		payloadJSON, err := json.Marshal(event.Payload)
		if err != nil {
			return fmt.Errorf("encode conversation event payload: %w", err)
		}
		if _, err := tx.ExecContext(
			ctx,
			`insert into conversation_events (
				event_id, session_id, client_turn_id, ordinal, sequence,
				event_type, payload_json, created_at
			) values (?, ?, ?, ?, ?, ?, ?, ?)`,
			event.EventID,
			sessionID,
			event.ClientTurnID,
			event.Ordinal,
			event.Sequence,
			event.EventType,
			string(payloadJSON),
			now,
		); err != nil {
			return err
		}
	}

	projectionJSON, err := json.Marshal(projection.Projection)
	if err != nil {
		return fmt.Errorf("encode conversation projection: %w", err)
	}
	_, err = tx.ExecContext(
		ctx,
		`insert into conversation_projections (
			session_id, last_sequence, projection_json, updated_at
		) values (?, ?, ?, ?)
		on conflict(session_id) do update set
			last_sequence = excluded.last_sequence,
			projection_json = excluded.projection_json,
			updated_at = excluded.updated_at`,
		sessionID,
		projection.LastSequence,
		string(projectionJSON),
		now,
	)
	return err
}

func ValidateConversationEventBatch(
	sessionID string,
	clientTurnID string,
	storedLastSequence int64,
	events []ConversationEventInput,
	projection *ConversationProjectionRecord,
) error {
	if len(events) == 0 || projection == nil {
		return fmt.Errorf("%w: events and projection are required", ErrConversationEventEnvelopeInvalid)
	}
	if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(clientTurnID) == "" {
		return fmt.Errorf("%w: session and client turn identities are required", ErrConversationEventEnvelopeInvalid)
	}
	if projection.SessionID != sessionID {
		return fmt.Errorf("%w: projection session %q does not equal %q", ErrConversationEventEnvelopeInvalid, projection.SessionID, sessionID)
	}
	seenEventIDs := make(map[string]struct{}, len(events))
	for index, event := range events {
		eventID := strings.TrimSpace(event.EventID)
		if eventID == "" {
			return fmt.Errorf("%w: event id is required", ErrConversationEventEnvelopeInvalid)
		}
		parsedEventID, err := uuid.Parse(eventID)
		if eventID != event.EventID || err != nil || parsedEventID.Version() != 4 || parsedEventID.Variant() != uuid.RFC4122 || parsedEventID.String() != strings.ToLower(eventID) {
			return fmt.Errorf("%w: event id %q is not a canonical UUIDv4", ErrConversationEventEnvelopeInvalid, event.EventID)
		}
		if _, exists := seenEventIDs[eventID]; exists {
			return fmt.Errorf("%w: duplicate event id %q", ErrConversationEventEnvelopeInvalid, eventID)
		}
		seenEventIDs[eventID] = struct{}{}
		if event.SessionID != sessionID {
			return fmt.Errorf(
				"%w: event %q has session %q, expected %q",
				ErrConversationEventSessionMismatch,
				event.EventID,
				event.SessionID,
				sessionID,
			)
		}
		if event.ClientTurnID != clientTurnID {
			return fmt.Errorf("%w: event %q has client turn %q, expected %q", ErrConversationEventEnvelopeInvalid, eventID, event.ClientTurnID, clientTurnID)
		}
		expectedOrdinal := index + 1
		if event.Ordinal != expectedOrdinal {
			return fmt.Errorf("%w: event ordinal %d must equal %d", ErrConversationEventEnvelopeInvalid, event.Ordinal, expectedOrdinal)
		}
		expectedSequence := storedLastSequence + int64(index) + 1
		if event.Sequence != expectedSequence {
			return fmt.Errorf("%w: event sequence %d must equal %d", ErrConversationProjectionSequenceMismatch, event.Sequence, expectedSequence)
		}
		if _, allowed := conversationEventTypes[event.EventType]; !allowed {
			return fmt.Errorf("%w: event type %q is not allowed", ErrConversationEventEnvelopeInvalid, event.EventType)
		}
		if event.Payload == nil {
			return fmt.Errorf("%w: event %q payload must be an object", ErrConversationEventEnvelopeInvalid, eventID)
		}
	}
	lastEventSequence := events[len(events)-1].Sequence
	if projection.LastSequence != lastEventSequence || !projectionMapHasSequence(projection.Projection, lastEventSequence) {
		return ErrConversationProjectionSequenceMismatch
	}
	return nil
}

func conversationTurnExistsTx(ctx context.Context, tx *sql.Tx, sessionID, clientTurnID string) (bool, error) {
	var count int
	if err := tx.QueryRowContext(
		ctx,
		`select count(*) from conversation_events where session_id = ? and client_turn_id = ?`,
		sessionID,
		clientTurnID,
	).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func storedConversationSequenceTx(ctx context.Context, tx *sql.Tx, sessionID string) (int64, error) {
	var sequence int64
	err := tx.QueryRowContext(
		ctx,
		`select last_sequence from conversation_projections where session_id = ?`,
		sessionID,
	).Scan(&sequence)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return sequence, err
}

func projectionMapHasSequence(projection map[string]any, expected int64) bool {
	if projection == nil {
		return false
	}
	value, ok := projection["last_sequence"]
	if !ok {
		return false
	}
	switch sequence := value.(type) {
	case int:
		return int64(sequence) == expected
	case int64:
		return sequence == expected
	case float64:
		return sequence == float64(expected)
	case json.Number:
		parsed, err := sequence.Int64()
		return err == nil && parsed == expected
	default:
		return false
	}
}
