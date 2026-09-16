package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type LearningEpisodeInput struct {
	LearnerID        string
	SessionID        string
	StudentMessageID int64
	AgentMessageID   int64
	Topic            string
	SkillState       string
	Payload          map[string]any
}

type LearningEpisodeUpdate struct {
	StudentMessageID int64
	AgentMessageID   int64
	Topic            string
	SkillState       string
	Payload          map[string]any
}

type LearningEpisode struct {
	ID               int64
	LearnerID        string
	SessionID        string
	StudentMessageID int64
	AgentMessageID   int64
	Topic            string
	SkillState       string
	CreatedAt        time.Time
	Payload          map[string]any
}

type LearningFactInput struct {
	FactID          string
	LearnerID       string
	Subject         string
	Predicate       string
	Object          string
	Confidence      float64
	SourceEpisodeID int64
	ValidFrom       time.Time
	ValidTo         time.Time
	Status          string
	Payload         map[string]any
}

type LearningFact struct {
	ID              int64
	FactID          string
	LearnerID       string
	Subject         string
	Predicate       string
	Object          string
	Confidence      float64
	SourceEpisodeID int64
	ValidFrom       time.Time
	ValidTo         time.Time
	Status          string
	Payload         map[string]any
}

type LearningEntity struct {
	ID                 int64
	EntityID           string
	LearnerID          string
	EntityType         string
	Label              string
	FirstSeenEpisodeID int64
	LastSeenEpisodeID  int64
	Confidence         float64
	Status             string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	Payload            map[string]any
}

func (s *SQLiteStore) SaveLearningEpisode(ctx context.Context, input LearningEpisodeInput) (LearningEpisode, error) {
	if input.LearnerID == "" {
		input.LearnerID = "anonymous-demo"
	}
	now := time.Now().UTC()
	payloadJSON, err := json.Marshal(cloneMap(input.Payload))
	if err != nil {
		return LearningEpisode{}, err
	}

	res, err := s.db.ExecContext(
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
		formatStoreTime(now),
		string(payloadJSON),
	)
	if err != nil {
		return LearningEpisode{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return LearningEpisode{}, err
	}

	return LearningEpisode{
		ID:               id,
		LearnerID:        input.LearnerID,
		SessionID:        input.SessionID,
		StudentMessageID: input.StudentMessageID,
		AgentMessageID:   input.AgentMessageID,
		Topic:            input.Topic,
		SkillState:       input.SkillState,
		CreatedAt:        now,
		Payload:          cloneMap(input.Payload),
	}, nil
}

func (s *SQLiteStore) ListLearningEpisodes(ctx context.Context, learnerID string, limit int) ([]LearningEpisode, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, learner_id, session_id, student_message_id, agent_message_id,
		        topic, skill_state, created_at, payload_json
		 from learning_episodes
		 where learner_id = ?
		 order by created_at desc, id desc
		 limit ?`,
		learnerID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	episodes := []LearningEpisode{}
	for rows.Next() {
		episode, err := scanLearningEpisode(rows)
		if err != nil {
			return nil, err
		}
		episodes = append(episodes, episode)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return episodes, nil
}

func (s *SQLiteStore) UpdateLearningEpisodeMessages(ctx context.Context, episodeID int64, input LearningEpisodeUpdate) error {
	if episodeID == 0 {
		return fmt.Errorf("episode id is required")
	}
	return updateLearningEpisodeMessagesTx(ctx, s.db, episodeID, input)
}

func updateLearningEpisodeMessagesTx(ctx context.Context, execer sqlExecer, episodeID int64, input LearningEpisodeUpdate) error {
	if episodeID == 0 {
		return fmt.Errorf("episode id is required")
	}
	payloadJSON, err := json.Marshal(cloneMap(input.Payload))
	if err != nil {
		return err
	}

	result, err := execer.ExecContext(
		ctx,
		`update learning_episodes
		 set student_message_id = ?,
		     agent_message_id = ?,
		     topic = coalesce(?, topic),
		     skill_state = coalesce(?, skill_state),
		     payload_json = ?
		 where id = ?`,
		zeroIntToNil(input.StudentMessageID),
		zeroIntToNil(input.AgentMessageID),
		emptyToNil(input.Topic),
		emptyToNil(input.SkillState),
		string(payloadJSON),
		episodeID,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("learning episode %d not found", episodeID)
	}
	return nil
}

func (s *SQLiteStore) SaveLearningFact(ctx context.Context, input LearningFactInput) (LearningFact, error) {
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LearningFact{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	fact, err := saveLearningFactTx(ctx, tx, input, now)
	if err != nil {
		return LearningFact{}, err
	}
	if err := tx.Commit(); err != nil {
		return LearningFact{}, err
	}
	return fact, nil
}

func saveLearningFactTx(ctx context.Context, tx *sql.Tx, input LearningFactInput, now time.Time) (LearningFact, error) {
	if input.LearnerID == "" {
		input.LearnerID = "anonymous-demo"
	}
	if input.SourceEpisodeID == 0 {
		return LearningFact{}, fmt.Errorf("source episode id is required")
	}
	if strings.TrimSpace(input.Subject) == "" {
		return LearningFact{}, fmt.Errorf("learning fact subject is required")
	}
	if strings.TrimSpace(input.Predicate) == "" {
		return LearningFact{}, fmt.Errorf("learning fact predicate is required")
	}
	if strings.TrimSpace(input.Object) == "" {
		return LearningFact{}, fmt.Errorf("learning fact object is required")
	}
	if input.FactID == "" {
		input.FactID = newID("fact")
	}
	if input.ValidFrom.IsZero() {
		input.ValidFrom = time.Now().UTC()
	}
	if input.Status == "" {
		input.Status = "active"
	}

	payloadJSON, err := json.Marshal(cloneMap(input.Payload))
	if err != nil {
		return LearningFact{}, err
	}

	var validTo any
	if !input.ValidTo.IsZero() {
		validTo = formatStoreTime(input.ValidTo)
	}

	if err = upsertLearningEntity(ctx, tx, input.LearnerID, input.Subject, input.SourceEpisodeID, input.Confidence, now); err != nil {
		return LearningFact{}, err
	}
	if err = upsertLearningEntity(ctx, tx, input.LearnerID, input.Object, input.SourceEpisodeID, input.Confidence, now); err != nil {
		return LearningFact{}, err
	}
	if input.Status == "active" {
		if err = invalidateContradictedLearningFacts(ctx, tx, input, now); err != nil {
			return LearningFact{}, err
		}
	}

	res, err := tx.ExecContext(
		ctx,
		`insert or ignore into learning_facts
		   (fact_id, learner_id, subject, predicate, object, confidence, source_episode_id,
		    valid_from, valid_to, status, payload_json)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.FactID,
		input.LearnerID,
		input.Subject,
		input.Predicate,
		input.Object,
		input.Confidence,
		input.SourceEpisodeID,
		formatStoreTime(input.ValidFrom),
		validTo,
		input.Status,
		string(payloadJSON),
	)
	if err != nil {
		return LearningFact{}, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return LearningFact{}, err
	}
	if affected == 0 {
		// The AI core derives fact_id from turn content, so an earlier turn may
		// already have persisted the same fact. Reusing the existing row keeps
		// completed-turn persistence idempotent instead of rolling back the
		// whole turn on a UNIQUE(fact_id) violation.
		existing, err := getLearningFactByFactIDTx(ctx, tx, input.FactID)
		if err != nil {
			return LearningFact{}, err
		}
		return existing, nil
	}
	id, err := res.LastInsertId()
	if err != nil {
		return LearningFact{}, err
	}

	return LearningFact{
		ID:              id,
		FactID:          input.FactID,
		LearnerID:       input.LearnerID,
		Subject:         input.Subject,
		Predicate:       input.Predicate,
		Object:          input.Object,
		Confidence:      input.Confidence,
		SourceEpisodeID: input.SourceEpisodeID,
		ValidFrom:       input.ValidFrom,
		ValidTo:         input.ValidTo,
		Status:          input.Status,
		Payload:         cloneMap(input.Payload),
	}, nil
}

func getLearningFactByFactIDTx(ctx context.Context, tx *sql.Tx, factID string) (LearningFact, error) {
	row := tx.QueryRowContext(
		ctx,
		`select id, fact_id, learner_id, subject, predicate, object, confidence,
		        source_episode_id, valid_from, valid_to, status, payload_json
		 from learning_facts
		 where fact_id = ?`,
		factID,
	)
	return scanLearningFact(row)
}

func (s *SQLiteStore) MarkLearningEpisodeFailed(ctx context.Context, episodeID int64, status string) error {
	if episodeID == 0 {
		return fmt.Errorf("episode id is required")
	}
	if strings.TrimSpace(status) == "" {
		status = "failed"
	}

	var payloadJSON string
	err := s.db.QueryRowContext(ctx, `select payload_json from learning_episodes where id = ?`, episodeID).Scan(&payloadJSON)
	if err != nil {
		return err
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return err
	}
	if payload == nil {
		payload = map[string]any{}
	}
	now := time.Now().UTC()
	payload["status"] = status
	payload["failed_at"] = formatStoreTime(now)
	payload["failure_reason"] = status
	updatedPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(
		ctx,
		`update learning_episodes set skill_state = ?, payload_json = ? where id = ?`,
		status,
		string(updatedPayload),
		episodeID,
	)
	return err
}

func (s *SQLiteStore) ListLearningFacts(ctx context.Context, learnerID string) ([]LearningFact, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, fact_id, learner_id, subject, predicate, object, confidence,
		        source_episode_id, valid_from, valid_to, status, payload_json
		 from learning_facts
		 where learner_id = ? and status = 'active'
		 order by valid_from desc, id desc`,
		learnerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	facts := []LearningFact{}
	for rows.Next() {
		fact, err := scanLearningFact(rows)
		if err != nil {
			return nil, err
		}
		facts = append(facts, fact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return facts, nil
}

func (s *SQLiteStore) ListAllLearningFactsForTest(ctx context.Context, learnerID string) ([]LearningFact, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, fact_id, learner_id, subject, predicate, object, confidence,
		        source_episode_id, valid_from, valid_to, status, payload_json
		 from learning_facts
		 where learner_id = ?
		 order by valid_from desc, id desc`,
		learnerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	facts := []LearningFact{}
	for rows.Next() {
		fact, err := scanLearningFact(rows)
		if err != nil {
			return nil, err
		}
		facts = append(facts, fact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return facts, nil
}

func (s *SQLiteStore) ListLearningEntities(ctx context.Context, learnerID string) ([]LearningEntity, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, entity_id, learner_id, entity_type, label, first_seen_episode_id,
		        last_seen_episode_id, confidence, status, created_at, updated_at, payload_json
		 from learning_entities
		 where learner_id = ?
		 order by entity_type, label, id`,
		learnerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entities := []LearningEntity{}
	for rows.Next() {
		entity, err := scanLearningEntity(rows)
		if err != nil {
			return nil, err
		}
		entities = append(entities, entity)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entities, nil
}

func upsertLearningEntity(ctx context.Context, tx *sql.Tx, learnerID string, label string, episodeID int64, confidence float64, now time.Time) error {
	entityConfidence := confidence
	if entityConfidence == 0 {
		entityConfidence = 1
	}
	_, err := tx.ExecContext(
		ctx,
		`insert into learning_entities
		   (entity_id, learner_id, entity_type, label, first_seen_episode_id, last_seen_episode_id,
		    confidence, status, created_at, updated_at, payload_json)
		 values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, '{}')
		 on conflict(entity_id) do update set
		   last_seen_episode_id = excluded.last_seen_episode_id,
		   confidence = max(learning_entities.confidence, excluded.confidence),
		   status = 'active',
		   updated_at = excluded.updated_at`,
		learningEntityID(learnerID, label),
		learnerID,
		learningEntityType(label),
		label,
		episodeID,
		episodeID,
		entityConfidence,
		formatStoreTime(now),
		formatStoreTime(now),
	)
	return err
}

func invalidateContradictedLearningFacts(ctx context.Context, tx *sql.Tx, input LearningFactInput, now time.Time) error {
	validTo := formatStoreTime(now)
	switch input.Predicate {
	case "resolved_misconception":
		_, err := tx.ExecContext(
			ctx,
			`update learning_facts
			 set status = 'invalidated', valid_to = ?
			 where learner_id = ? and subject = ? and predicate = 'has_misconception'
			   and object = ? and status = 'active'`,
			validTo,
			input.LearnerID,
			input.Subject,
			input.Object,
		)
		return err
	case "has_mastery":
		_, err := tx.ExecContext(
			ctx,
			`update learning_facts
			 set status = 'invalidated', valid_to = ?
			 where learner_id = ? and subject = ? and predicate = 'has_misconception'
			   and object = ? and status = 'active'`,
			validTo,
			input.LearnerID,
			input.Subject,
			masteryObjectToMisconception(input.Object),
		)
		return err
	case "has_misconception":
		if _, err := tx.ExecContext(
			ctx,
			`update learning_facts
			 set status = 'invalidated', valid_to = ?
			 where learner_id = ? and subject = ? and predicate = 'resolved_misconception'
			   and object = ? and status = 'active'`,
			validTo,
			input.LearnerID,
			input.Subject,
			input.Object,
		); err != nil {
			return err
		}
		_, err := tx.ExecContext(
			ctx,
			`update learning_facts
			 set status = 'invalidated', valid_to = ?
			 where learner_id = ? and subject = ? and predicate = 'has_mastery'
			   and object = ? and status = 'active'`,
			validTo,
			input.LearnerID,
			input.Subject,
			misconceptionObjectToMastery(input.Object),
		)
		return err
	default:
		return nil
	}
}

func learningEntityID(learnerID string, label string) string {
	sum := sha256.Sum256([]byte(learnerID + "|" + label))
	return "entity_" + hex.EncodeToString(sum[:])[:24]
}

func learningEntityType(label string) string {
	prefix, _, ok := strings.Cut(label, ":")
	if !ok || prefix == "" {
		return "Entity"
	}
	return prefix
}

func masteryObjectToMisconception(object string) string {
	suffix, ok := strings.CutPrefix(object, "Mastery:")
	if !ok {
		return object
	}
	return "Misconception:" + suffix
}

func misconceptionObjectToMastery(object string) string {
	suffix, ok := strings.CutPrefix(object, "Misconception:")
	if !ok {
		return object
	}
	return "Mastery:" + suffix
}

type learningEpisodeScanner interface {
	Scan(dest ...any) error
}

func scanLearningEpisode(scanner learningEpisodeScanner) (LearningEpisode, error) {
	var episode LearningEpisode
	var sessionID sql.NullString
	var studentMessageID sql.NullInt64
	var agentMessageID sql.NullInt64
	var topic sql.NullString
	var skillState sql.NullString
	var createdAt string
	var payloadJSON string

	if err := scanner.Scan(
		&episode.ID,
		&episode.LearnerID,
		&sessionID,
		&studentMessageID,
		&agentMessageID,
		&topic,
		&skillState,
		&createdAt,
		&payloadJSON,
	); err != nil {
		return LearningEpisode{}, err
	}

	if sessionID.Valid {
		episode.SessionID = sessionID.String
	}
	if studentMessageID.Valid {
		episode.StudentMessageID = studentMessageID.Int64
	}
	if agentMessageID.Valid {
		episode.AgentMessageID = agentMessageID.Int64
	}
	if topic.Valid {
		episode.Topic = topic.String
	}
	if skillState.Valid {
		episode.SkillState = skillState.String
	}
	parsedCreatedAt, err := parseStoreTime(createdAt)
	if err != nil {
		return LearningEpisode{}, err
	}
	episode.CreatedAt = parsedCreatedAt
	if err := json.Unmarshal([]byte(payloadJSON), &episode.Payload); err != nil {
		return LearningEpisode{}, err
	}
	return episode, nil
}

type learningFactScanner interface {
	Scan(dest ...any) error
}

func scanLearningFact(scanner learningFactScanner) (LearningFact, error) {
	var fact LearningFact
	var validFrom string
	var validTo sql.NullString
	var payloadJSON string

	if err := scanner.Scan(
		&fact.ID,
		&fact.FactID,
		&fact.LearnerID,
		&fact.Subject,
		&fact.Predicate,
		&fact.Object,
		&fact.Confidence,
		&fact.SourceEpisodeID,
		&validFrom,
		&validTo,
		&fact.Status,
		&payloadJSON,
	); err != nil {
		return LearningFact{}, err
	}

	parsed, err := parseStoreTime(validFrom)
	if err != nil {
		return LearningFact{}, err
	}
	fact.ValidFrom = parsed
	if validTo.Valid {
		parsed, err := parseStoreTime(validTo.String)
		if err != nil {
			return LearningFact{}, err
		}
		fact.ValidTo = parsed
	}
	if err := json.Unmarshal([]byte(payloadJSON), &fact.Payload); err != nil {
		return LearningFact{}, err
	}
	return fact, nil
}

func scanLearningEntity(scanner learningFactScanner) (LearningEntity, error) {
	var entity LearningEntity
	var firstSeenEpisodeID sql.NullInt64
	var lastSeenEpisodeID sql.NullInt64
	var createdAt string
	var updatedAt string
	var payloadJSON string

	if err := scanner.Scan(
		&entity.ID,
		&entity.EntityID,
		&entity.LearnerID,
		&entity.EntityType,
		&entity.Label,
		&firstSeenEpisodeID,
		&lastSeenEpisodeID,
		&entity.Confidence,
		&entity.Status,
		&createdAt,
		&updatedAt,
		&payloadJSON,
	); err != nil {
		return LearningEntity{}, err
	}
	if firstSeenEpisodeID.Valid {
		entity.FirstSeenEpisodeID = firstSeenEpisodeID.Int64
	}
	if lastSeenEpisodeID.Valid {
		entity.LastSeenEpisodeID = lastSeenEpisodeID.Int64
	}
	parsedCreatedAt, err := parseStoreTime(createdAt)
	if err != nil {
		return LearningEntity{}, err
	}
	entity.CreatedAt = parsedCreatedAt
	parsedUpdatedAt, err := parseStoreTime(updatedAt)
	if err != nil {
		return LearningEntity{}, err
	}
	entity.UpdatedAt = parsedUpdatedAt
	if err := json.Unmarshal([]byte(payloadJSON), &entity.Payload); err != nil {
		return LearningEntity{}, err
	}
	return entity, nil
}

func zeroIntToNil(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}
