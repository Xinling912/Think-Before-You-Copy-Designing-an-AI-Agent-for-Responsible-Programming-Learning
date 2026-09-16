package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type TopicSummaryInput struct {
	LearnerID          string
	Topic              string
	Summary            string
	MasteredConcepts   []string
	WeakConcepts       []string
	NextTeachingAction string
	SourceSessionID    string
	SourceMemoryIDs    []string
}

type TopicSummary struct {
	ID                 int64
	LearnerID          string         `json:"learner_id"`
	Topic              string         `json:"topic"`
	Summary            string         `json:"topic_summary"`
	MasteredConcepts   []string       `json:"mastered_concepts"`
	WeakConcepts       []string       `json:"weak_concepts"`
	NextTeachingAction string         `json:"next_teaching_action"`
	SourceSessionID    string         `json:"source_session_id"`
	SourceMemoryIDs    []string       `json:"source_memory_ids"`
	UpdatedAt          time.Time      `json:"updated_at"`
	Payload            map[string]any `json:"payload,omitempty"`
}

func (s *SQLiteStore) UpsertTopicSummary(ctx context.Context, input TopicSummaryInput) (TopicSummary, error) {
	if input.LearnerID == "" {
		input.LearnerID = "anonymous-demo"
	}
	now := time.Now().UTC()
	if err := upsertTopicSummaryTx(ctx, s.db, input, now); err != nil {
		return TopicSummary{}, err
	}
	return getTopicSummary(ctx, s.db, input.LearnerID, input.Topic)
}

func upsertTopicSummaryTx(ctx context.Context, execer sqlExecer, input TopicSummaryInput, now time.Time) error {
	if input.LearnerID == "" {
		input.LearnerID = "anonymous-demo"
	}
	masteredJSON, err := json.Marshal(input.MasteredConcepts)
	if err != nil {
		return err
	}
	weakJSON, err := json.Marshal(input.WeakConcepts)
	if err != nil {
		return err
	}
	sourceMemoryIDsJSON, err := json.Marshal(input.SourceMemoryIDs)
	if err != nil {
		return err
	}

	_, err = execer.ExecContext(
		ctx,
		`insert into topic_summaries
		   (learner_id, topic, summary, mastered_concepts_json, weak_concepts_json,
		    next_teaching_action, source_session_id, source_memory_ids_json, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 on conflict(learner_id, topic) do update set
		   summary = excluded.summary,
		   mastered_concepts_json = excluded.mastered_concepts_json,
		   weak_concepts_json = excluded.weak_concepts_json,
		   next_teaching_action = excluded.next_teaching_action,
		   source_session_id = excluded.source_session_id,
		   source_memory_ids_json = excluded.source_memory_ids_json,
		   updated_at = excluded.updated_at`,
		input.LearnerID,
		input.Topic,
		input.Summary,
		string(masteredJSON),
		string(weakJSON),
		emptyToNil(input.NextTeachingAction),
		emptyToNil(input.SourceSessionID),
		string(sourceMemoryIDsJSON),
		formatStoreTime(now),
	)
	return err
}

func (s *SQLiteStore) ListTopicSummaries(ctx context.Context, learnerID string, limit int) ([]TopicSummary, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, learner_id, topic, summary, mastered_concepts_json, weak_concepts_json,
		        next_teaching_action, source_session_id, source_memory_ids_json, updated_at
		 from topic_summaries
		 where learner_id = ?
		 order by updated_at desc, id desc
		 limit ?`,
		learnerID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summaries := []TopicSummary{}
	for rows.Next() {
		summary, err := scanTopicSummary(rows)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return summaries, nil
}

func getTopicSummary(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, learnerID, topic string) (TopicSummary, error) {
	row := queryer.QueryRowContext(
		ctx,
		`select id, learner_id, topic, summary, mastered_concepts_json, weak_concepts_json,
		        next_teaching_action, source_session_id, source_memory_ids_json, updated_at
		 from topic_summaries
		 where learner_id = ? and topic = ?`,
		learnerID,
		topic,
	)
	return scanTopicSummary(row)
}

type topicSummaryScanner interface {
	Scan(dest ...any) error
}

func scanTopicSummary(scanner topicSummaryScanner) (TopicSummary, error) {
	var summary TopicSummary
	var masteredJSON string
	var weakJSON string
	var nextAction sql.NullString
	var sourceSessionID sql.NullString
	var sourceMemoryIDsJSON string
	var updatedAt string

	if err := scanner.Scan(
		&summary.ID,
		&summary.LearnerID,
		&summary.Topic,
		&summary.Summary,
		&masteredJSON,
		&weakJSON,
		&nextAction,
		&sourceSessionID,
		&sourceMemoryIDsJSON,
		&updatedAt,
	); err != nil {
		return TopicSummary{}, err
	}
	if err := json.Unmarshal([]byte(masteredJSON), &summary.MasteredConcepts); err != nil {
		return TopicSummary{}, err
	}
	if err := json.Unmarshal([]byte(weakJSON), &summary.WeakConcepts); err != nil {
		return TopicSummary{}, err
	}
	if err := json.Unmarshal([]byte(sourceMemoryIDsJSON), &summary.SourceMemoryIDs); err != nil {
		return TopicSummary{}, err
	}
	if nextAction.Valid {
		summary.NextTeachingAction = nextAction.String
	}
	if sourceSessionID.Valid {
		summary.SourceSessionID = sourceSessionID.String
	}
	parsed, err := parseStoreTime(updatedAt)
	if err != nil {
		return TopicSummary{}, err
	}
	summary.UpdatedAt = parsed
	return summary, nil
}
