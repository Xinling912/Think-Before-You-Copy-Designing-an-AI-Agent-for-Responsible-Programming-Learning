package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrParticipantNotFound = errors.New("participant not found")

var beijingLocation = time.FixedZone("UTC+8", 8*60*60)

func nowBeijing() time.Time {
	return time.Now().In(beijingLocation)
}

type Participant struct {
	ID          string `json:"id"`
	Mode        string `json:"mode"`
	ConsentedAt string `json:"consented_at"`
	CreatedAt   string `json:"created_at"`
	LastSeenAt  string `json:"last_seen_at"`
}

func (s *SQLiteStore) CreateParticipant(ctx context.Context, mode string, consented bool) (Participant, string, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "study" {
		mode = "development"
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Participant{}, "", err
	}
	token := hex.EncodeToString(raw)
	now := nowBeijing().Format(time.RFC3339Nano)
	consentedAt := ""
	if consented {
		consentedAt = now
	}
	participant := Participant{
		ID: newID("participant"), Mode: mode, ConsentedAt: consentedAt,
		CreatedAt: now, LastSeenAt: now,
	}
	_, err := s.db.ExecContext(ctx, `insert into participants
		(id, token_hash, mode, consented_at, created_at, last_seen_at)
		values (?, ?, ?, ?, ?, ?)`,
		participant.ID, hashParticipantToken(token), participant.Mode,
		participant.ConsentedAt, participant.CreatedAt, participant.LastSeenAt)
	if err != nil {
		return Participant{}, "", err
	}
	return participant, token, nil
}

func (s *SQLiteStore) GetParticipantByToken(ctx context.Context, token string) (Participant, error) {
	if strings.TrimSpace(token) == "" {
		return Participant{}, ErrParticipantNotFound
	}
	var participant Participant
	err := s.db.QueryRowContext(ctx, `select id, mode, consented_at, created_at, last_seen_at
		from participants where token_hash = ?`, hashParticipantToken(token)).Scan(
		&participant.ID, &participant.Mode, &participant.ConsentedAt,
		&participant.CreatedAt, &participant.LastSeenAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Participant{}, ErrParticipantNotFound
	}
	if err != nil {
		return Participant{}, err
	}
	participant.LastSeenAt = nowBeijing().Format(time.RFC3339Nano)
	_, _ = s.db.ExecContext(ctx, `update participants set last_seen_at = ? where id = ?`, participant.LastSeenAt, participant.ID)
	return participant, nil
}

func hashParticipantToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *SQLiteStore) LinkParticipantSession(ctx context.Context, participantID, sessionID string) error {
	if strings.TrimSpace(participantID) == "" || strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("participant id and session id are required")
	}
	_, err := s.db.ExecContext(ctx, `insert into participant_sessions
		(participant_id, session_id, created_at) values (?, ?, ?)`,
		participantID, sessionID, nowBeijing().Format(time.RFC3339Nano))
	return err
}

func (s *SQLiteStore) ParticipantOwnsSession(ctx context.Context, participantID, sessionID string) (bool, error) {
	var found int
	err := s.db.QueryRowContext(ctx, `select 1 from participant_sessions
		where participant_id = ? and session_id = ?`, participantID, sessionID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *SQLiteStore) ListParticipantSessions(ctx context.Context, participantID, status string) ([]SessionSummary, error) {
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "all" && status != "deleted" {
		return nil, fmt.Errorf("invalid session status filter: %s", status)
	}
	query := `select s.id, s.scenario, s.status, s.created_at,
		count(m.id), coalesce(max(m.created_at), '')
		from sessions s
		join participant_sessions ps on ps.session_id = s.id
		left join messages m on m.session_id = s.id
		where ps.participant_id = ?`
	args := []any{participantID}
	if status != "all" {
		query += ` and s.status = ?`
		args = append(args, status)
	}
	query += ` group by s.id, s.scenario, s.status, s.created_at
		order by coalesce(max(m.created_at), s.created_at) desc, s.created_at desc`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []SessionSummary{}
	for rows.Next() {
		var item SessionSummary
		if err := rows.Scan(&item.ID, &item.Scenario, &item.Status, &item.CreatedAt, &item.MessageCount, &item.LatestMessageAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
