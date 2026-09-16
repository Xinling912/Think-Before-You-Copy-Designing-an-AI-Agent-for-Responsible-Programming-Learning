package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const driverName = "sqlite"

var ErrSessionNotFound = errors.New("session not found")
var ErrHarnessCaseNotFound = errors.New("harness case not found")
var ErrHarnessCaseConflict = errors.New("harness case lifecycle conflict")
var ErrHarnessCaseInvalidFilter = errors.New("invalid harness case filter")

const schemaSQL = `
create table if not exists sessions (
  id text primary key,
  created_at text not null,
  scenario text not null,
  status text not null
);

create table if not exists participants (
  id text primary key,
  token_hash text not null unique,
  mode text not null,
  consented_at text not null default '',
  created_at text not null,
  last_seen_at text not null
);

create table if not exists participant_sessions (
  participant_id text not null,
  session_id text not null unique,
  created_at text not null,
  primary key (participant_id, session_id),
  foreign key (participant_id) references participants(id),
  foreign key (session_id) references sessions(id)
);

create index if not exists idx_participant_sessions_participant
  on participant_sessions (participant_id, created_at desc);

create table if not exists messages (
  id integer primary key autoincrement,
  session_id text not null,
  role text not null,
  content text not null,
  created_at text not null,
  foreign key (session_id) references sessions(id)
);

create table if not exists evidence_events (
  id integer primary key autoincrement,
  session_id text not null,
  student_message_id integer,
  agent_message_id integer,
  event_type text not null,
  payload_json text not null,
  created_at text not null,
  foreign key (session_id) references sessions(id)
);

create table if not exists skill_usage (
  id integer primary key autoincrement,
  session_id text not null,
  skill_id text not null,
  hint_level integer,
  direct_answer_given integer not null default 0,
  created_at text not null,
  foreign key (session_id) references sessions(id)
);

create table if not exists learner_memory (
  id integer primary key autoincrement,
  learner_id text not null,
  memory_type text not null,
  payload_json text not null,
  updated_at text not null
);

create table if not exists learner_memory_v2 (
  id integer primary key autoincrement,
  memory_id text not null unique,
  learner_id text not null,
  memory_type text not null,
  topic text not null,
  content text not null,
  concepts_json text not null default '[]',
  source_event_id integer,
  source_session_id text,
  operation_origin text,
  strength integer not null default 1,
  use_count integer not null default 0,
  effective_score real not null default 0,
  status text not null default 'active',
  valid_from text not null,
  valid_to text,
  last_used_at text,
  updated_at text not null,
  payload_json text not null default '{}'
);

create table if not exists memory_events (
  id integer primary key autoincrement,
  learner_id text not null,
  session_id text not null,
  message_id integer,
  operation text not null,
  target_memory_id text,
  candidate_json text not null default '{}',
  result_memory_id text,
  reason text not null,
  created_at text not null
);

create table if not exists topic_summaries (
  id integer primary key autoincrement,
  learner_id text not null,
  topic text not null,
  summary text not null,
  mastered_concepts_json text not null default '[]',
  weak_concepts_json text not null default '[]',
  next_teaching_action text,
  source_session_id text,
  source_memory_ids_json text not null default '[]',
  updated_at text not null,
  unique (learner_id, topic)
);

create table if not exists learning_episodes (
  id integer primary key autoincrement,
  learner_id text not null,
  session_id text,
  student_message_id integer,
  agent_message_id integer,
  topic text,
  skill_state text,
  created_at text not null,
  payload_json text not null default '{}'
);

create table if not exists learning_entities (
  id integer primary key autoincrement,
  entity_id text not null unique,
  learner_id text not null,
  entity_type text not null,
  label text not null,
  first_seen_episode_id integer,
  last_seen_episode_id integer,
  confidence real not null default 1,
  status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  payload_json text not null default '{}'
);

create table if not exists learning_facts (
  id integer primary key autoincrement,
  fact_id text not null unique,
  learner_id text not null,
  subject text not null,
  predicate text not null,
  object text not null,
  confidence real not null default 0,
  source_episode_id integer not null,
  valid_from text not null,
  valid_to text,
  status text not null default 'active',
  payload_json text not null default '{}'
);

create index if not exists idx_learning_entities_learner_type_status
  on learning_entities (learner_id, entity_type, status);

create index if not exists idx_learning_facts_temporal
  on learning_facts (learner_id, subject, predicate, object, status);

create table if not exists learner_profile (
  learner_id text primary key,
  profile_json text not null default '{}',
  updated_at text not null
);

create table if not exists kg_candidates (
  id integer primary key autoincrement,
  candidate_id text not null unique,
  source_chunk_id text not null,
  source_url text not null,
  subject text not null,
  predicate text not null,
  object text not null,
  confidence real not null default 0,
  evidence_text text not null,
  status text not null default 'pending',
  created_at text not null
);

create table if not exists kg_candidate_reviews (
  id integer primary key autoincrement,
  candidate_id text not null unique,
  status text not null check (status in ('approved', 'rejected')),
  reviewer_id text not null,
  reviewer_note text not null default '',
  reviewed_at text not null,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_kg_candidate_reviews_status_reviewed_at
  on kg_candidate_reviews (status, reviewed_at);

create table if not exists harness_cases (
  id integer primary key autoincrement,
  case_id text not null unique,
  suite_id text not null,
  scenario_id text not null default '',
  status text not null check (status in ('pending', 'confirmed', 'deleted')),
  natural_language_request text not null,
  case_json text not null,
  validator_errors_json text not null default '[]',
  model text not null default '',
  llm_used integer not null default 0,
  llm_fallback integer not null default 0,
  created_at text not null,
  confirmed_at text,
  deleted_at text
);

create index if not exists idx_harness_cases_suite_status
  on harness_cases (suite_id, status, created_at);

create table if not exists harness_case_events (
  id integer primary key autoincrement,
  case_id text not null,
  event_type text not null check (event_type in ('compiled', 'confirmed', 'deleted')),
  payload_json text not null default '{}',
  created_at text not null
);

create index if not exists idx_harness_case_events_case
  on harness_case_events (case_id, created_at);

create table if not exists token_budget (
  scope text primary key,
  daily_quota integer not null,
  used_tokens integer not null,
  reset_at text not null,
  updated_at text not null
);

create table if not exists conversation_events (
  id integer primary key autoincrement,
  event_id text not null unique,
  session_id text not null,
  client_turn_id text not null,
  ordinal integer not null,
  sequence integer not null,
  event_type text not null,
  payload_json text not null,
  created_at text not null,
  unique(session_id, client_turn_id, ordinal),
  unique(session_id, sequence)
);

create table if not exists conversation_projections (
  session_id text primary key,
  last_sequence integer not null,
  projection_json text not null,
  updated_at text not null
);

create table if not exists learner_topic_progress (
    learner_id text not null,
    topic_id text not null,
    score integer not null default 0 check(score between 0 and 10),
    last_completed_level integer not null default 0 check(last_completed_level between 0 and 10),
    last_question_id text,
    last_attempt_id text,
    created_at text not null,
    updated_at text not null,
    primary key (learner_id, topic_id)
);

create table if not exists test_questions (
    id text primary key,
    learner_id text not null,
    topic_id text not null,
    level integer not null check(level between 1 and 10),
    question_format text not null default '',
    question_text text not null default '',
    options_json text not null default '[]',
    expected_answer text not null default '',
    accepted_equivalents_json text not null default '[]',
    grading_rubric_json text not null default '[]',
    kg_grounding_json text not null default '{}',
    provider text not null default '',
    model text not null default '',
    prompt_tokens integer not null default 0 check(prompt_tokens >= 0),
    completion_tokens integer not null default 0 check(completion_tokens >= 0),
    total_tokens integer not null default 0 check(total_tokens >= 0),
    status text not null check(status in ('answerable','graded','generation_failed')),
    failure_code text not null default '',
    generated_at text not null
);

create index if not exists idx_test_questions_learner_topic_generated
on test_questions(learner_id, topic_id, generated_at desc);

create table if not exists test_attempts (
    id text primary key,
    question_id text not null unique,
    learner_id text not null,
    topic_id text not null,
    submitted_answer text not null,
    is_correct integer not null check(is_correct in (0,1)),
    score real not null check(score >= 0 and score <= 1),
    reason text not null,
    feedback text not null,
    progress_before integer not null check(progress_before between 0 and 10),
    progress_increment integer not null check(progress_increment in (0,1)),
    progress_after integer not null check(progress_after between 0 and 10),
    provider text not null default '',
    model text not null default '',
    prompt_tokens integer not null default 0 check(prompt_tokens >= 0),
    completion_tokens integer not null default 0 check(completion_tokens >= 0),
    total_tokens integer not null default 0 check(total_tokens >= 0),
    submitted_at text not null,
    foreign key(question_id) references test_questions(id)
);

create index if not exists idx_test_attempts_learner_topic_submitted
on test_attempts(learner_id, topic_id, submitted_at desc);

create table if not exists test_attempt_reservations (
    id text primary key,
    question_id text not null unique,
    learner_id text not null,
    submitted_answer text not null,
    reserved_at text not null,
    foreign key(question_id) references test_questions(id)
);

create index if not exists idx_test_attempt_reservations_reserved_at
on test_attempt_reservations(reserved_at);
`

type SQLiteStore struct {
	db *sql.DB
}

type Session struct {
	ID        string `json:"id"`
	Scenario  string `json:"scenario"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

type SessionSummary struct {
	ID              string `json:"id"`
	Scenario        string `json:"scenario"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
	MessageCount    int    `json:"message_count"`
	LatestMessageAt string `json:"latest_message_at"`
}

type SessionDetail struct {
	Session        Session         `json:"session"`
	Messages       []Message       `json:"messages"`
	EvidenceEvents []EvidenceEvent `json:"evidence_events"`
}

type ChatEvidenceEvent struct {
	ID             int64          `json:"id"`
	AgentMessageID int64          `json:"agent_message_id"`
	Payload        map[string]any `json:"payload"`
}

type SessionChatDetail struct {
	Session        Session             `json:"session"`
	Messages       []Message           `json:"messages"`
	EvidenceEvents []ChatEvidenceEvent `json:"evidence_events"`
}

type EvidenceEvent struct {
	ID                    int64          `json:"id"`
	SessionID             string         `json:"session_id"`
	StudentMessageID      int64          `json:"student_message_id"`
	AgentMessageID        int64          `json:"agent_message_id"`
	StudentMessageContent string         `json:"student_message_content,omitempty"`
	AgentMessageContent   string         `json:"agent_message_content,omitempty"`
	EventType             string         `json:"event_type"`
	Payload               map[string]any `json:"payload"`
	CreatedAt             string         `json:"created_at"`
}

type Message struct {
	ID        int64  `json:"id"`
	SessionID string `json:"session_id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type LearnerMemory struct {
	ID         int64          `json:"id"`
	LearnerID  string         `json:"learner_id"`
	MemoryType string         `json:"memory_type"`
	Payload    map[string]any `json:"payload"`
	UpdatedAt  string         `json:"updated_at"`
}

func OpenSQLite(dsn string) (*SQLiteStore, error) {
	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, err
	}

	store := NewSQLiteStore(db)
	if err := store.Migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func NewSQLiteStore(db *sql.DB) *SQLiteStore {
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return &SQLiteStore{db: db}
}

func (s *SQLiteStore) Migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, schemaSQL); err != nil {
		return err
	}
	return s.ensureEvidenceEventMessageColumns(ctx)
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

func (s *SQLiteStore) CreateSession(ctx context.Context, scenario string) (Session, error) {
	if scenario == "" {
		scenario = "python-learning"
	}

	now := nowBeijing().Format(time.RFC3339Nano)
	session := Session{
		ID:        newID("session"),
		Scenario:  scenario,
		Status:    "active",
		CreatedAt: now,
	}

	_, err := s.db.ExecContext(
		ctx,
		`insert into sessions (id, created_at, scenario, status) values (?, ?, ?, ?)`,
		session.ID,
		session.CreatedAt,
		session.Scenario,
		session.Status,
	)
	if err != nil {
		return Session{}, err
	}
	return session, nil
}

func (s *SQLiteStore) GetSession(ctx context.Context, sessionID string) (Session, error) {
	if strings.TrimSpace(sessionID) == "" {
		return Session{}, fmt.Errorf("session id is required")
	}

	var session Session
	err := s.db.QueryRowContext(
		ctx,
		`select id, scenario, status, created_at from sessions where id = ?`,
		sessionID,
	).Scan(&session.ID, &session.Scenario, &session.Status, &session.CreatedAt)
	if err == sql.ErrNoRows {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}
	return session, nil
}

func (s *SQLiteStore) ListSessions(ctx context.Context, status string) ([]SessionSummary, error) {
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "all" && status != "deleted" {
		return nil, fmt.Errorf("invalid session status filter: %s", status)
	}

	query := `select s.id, s.scenario, s.status, s.created_at,
	                count(m.id) as message_count,
	                coalesce(max(m.created_at), '') as latest_message_at
	          from sessions s
	          left join messages m on m.session_id = s.id`
	args := []any{}
	if status != "all" {
		query += ` where s.status = ?`
		args = append(args, status)
	}
	query += ` group by s.id, s.scenario, s.status, s.created_at
	           order by coalesce(max(m.created_at), s.created_at) desc, s.created_at desc`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []SessionSummary
	for rows.Next() {
		var session SessionSummary
		if err := rows.Scan(
			&session.ID,
			&session.Scenario,
			&session.Status,
			&session.CreatedAt,
			&session.MessageCount,
			&session.LatestMessageAt,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return sessions, nil
}

func (s *SQLiteStore) GetSessionDetail(ctx context.Context, sessionID string) (SessionDetail, error) {
	session, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return SessionDetail{}, err
	}
	messages, err := s.listSessionMessages(ctx, sessionID)
	if err != nil {
		return SessionDetail{}, err
	}
	events, err := s.ListEvidenceEvents(ctx, sessionID)
	if err != nil {
		return SessionDetail{}, err
	}
	return SessionDetail{
		Session:        session,
		Messages:       messages,
		EvidenceEvents: events,
	}, nil
}

func (s *SQLiteStore) GetSessionChatDetail(ctx context.Context, sessionID string) (SessionChatDetail, error) {
	session, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return SessionChatDetail{}, err
	}
	messages, err := s.listSessionMessages(ctx, sessionID)
	if err != nil {
		return SessionChatDetail{}, err
	}
	events, err := s.listSessionLearningTraces(ctx, sessionID)
	if err != nil {
		return SessionChatDetail{}, err
	}
	return SessionChatDetail{Session: session, Messages: messages, EvidenceEvents: events}, nil
}

func (s *SQLiteStore) DeleteSession(ctx context.Context, sessionID string) (Session, error) {
	if strings.TrimSpace(sessionID) == "" {
		return Session{}, fmt.Errorf("session id is required")
	}
	result, err := s.db.ExecContext(ctx, `update sessions set status = 'deleted' where id = ?`, sessionID)
	if err != nil {
		return Session{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Session{}, err
	}
	if affected == 0 {
		return Session{}, ErrSessionNotFound
	}
	return s.GetSession(ctx, sessionID)
}

func (s *SQLiteStore) SaveMessageAndEvidence(
	ctx context.Context,
	sessionID string,
	role string,
	content string,
	evidence map[string]any,
) error {
	_, err := s.SaveMessageAndEvidenceWithID(ctx, sessionID, role, content, evidence)
	return err
}

func (s *SQLiteStore) SaveMessageAndEvidenceWithID(
	ctx context.Context,
	sessionID string,
	role string,
	content string,
	evidence map[string]any,
) (int64, error) {
	if sessionID == "" {
		return 0, fmt.Errorf("session id is required")
	}
	if role == "" {
		role = "student"
	}

	now := nowBeijing().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	res, err := insertMessageTx(ctx, tx, sessionID, role, content, now)
	if err != nil {
		return 0, err
	}
	messageID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	studentMessageID := int64(0)
	if role == "student" {
		studentMessageID = messageID
	}
	agentMessageID := int64(0)
	if role == "agent" {
		agentMessageID = messageID
	}
	payload := cloneMap(evidence)
	if studentMessageID != 0 {
		payload["student_message_id"] = studentMessageID
	}
	if agentMessageID != 0 {
		payload["agent_message_id"] = agentMessageID
	}
	if _, err := insertEvidenceEventTx(ctx, tx, sessionID, studentMessageID, agentMessageID, "ai_step", payload, now); err != nil {
		return 0, err
	}

	if err := insertSkillUsageTx(ctx, tx, sessionID, evidence, now); err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return messageID, nil
}

func (s *SQLiteStore) SaveMessage(ctx context.Context, sessionID string, role string, content string) error {
	_, err := s.SaveMessageWithID(ctx, sessionID, role, content)
	return err
}

func (s *SQLiteStore) SaveMessageWithID(ctx context.Context, sessionID string, role string, content string) (int64, error) {
	if sessionID == "" {
		return 0, fmt.Errorf("session id is required")
	}
	if role == "" {
		role = "student"
	}
	now := nowBeijing().Format(time.RFC3339Nano)
	res, err := insertMessageTx(ctx, s.db, sessionID, role, content, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *SQLiteStore) ListRecentMessages(ctx context.Context, sessionID string, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 8
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select id, session_id, role, content, created_at
		 from (
		   select id, session_id, role, content, created_at
		   from messages
		   where session_id = ?
		   order by id desc
		   limit ?
		 )
		 order by id asc`,
		sessionID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.SessionID, &message.Role, &message.Content, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return messages, nil
}

func (s *SQLiteStore) listSessionMessages(ctx context.Context, sessionID string) ([]Message, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`select id, session_id, role, content, created_at
		 from messages
		 where session_id = ?
		 order by id asc`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.SessionID, &message.Role, &message.Content, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return messages, nil
}

func (s *SQLiteStore) ListEvidenceEvents(ctx context.Context, sessionID string) ([]EvidenceEvent, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`select e.id, e.session_id, e.student_message_id, e.agent_message_id,
		        sm.content, am.content, e.event_type, e.payload_json, e.created_at
		 from evidence_events e
		 left join messages sm on sm.id = e.student_message_id
		 left join messages am on am.id = e.agent_message_id
		 where e.session_id = ?
		 order by e.id asc`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []EvidenceEvent
	for rows.Next() {
		var event EvidenceEvent
		var studentMessageID sql.NullInt64
		var agentMessageID sql.NullInt64
		var studentMessageContent sql.NullString
		var agentMessageContent sql.NullString
		var payloadJSON string
		if err := rows.Scan(
			&event.ID,
			&event.SessionID,
			&studentMessageID,
			&agentMessageID,
			&studentMessageContent,
			&agentMessageContent,
			&event.EventType,
			&payloadJSON,
			&event.CreatedAt,
		); err != nil {
			return nil, err
		}
		if studentMessageID.Valid {
			event.StudentMessageID = studentMessageID.Int64
		}
		if agentMessageID.Valid {
			event.AgentMessageID = agentMessageID.Int64
		}
		if studentMessageContent.Valid {
			event.StudentMessageContent = studentMessageContent.String
		}
		if agentMessageContent.Valid {
			event.AgentMessageContent = agentMessageContent.String
		}
		if err := json.Unmarshal([]byte(payloadJSON), &event.Payload); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (s *SQLiteStore) listSessionLearningTraces(ctx context.Context, sessionID string) ([]ChatEvidenceEvent, error) {
	rows, err := s.db.QueryContext(ctx, `select e.id, e.agent_message_id, json_extract(e.payload_json, '$.learning_trace') from evidence_events e where e.session_id = ? order by e.id asc`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []ChatEvidenceEvent
	for rows.Next() {
		var event ChatEvidenceEvent
		var agentMessageID sql.NullInt64
		var traceJSON sql.NullString
		if err := rows.Scan(&event.ID, &agentMessageID, &traceJSON); err != nil {
			return nil, err
		}
		if agentMessageID.Valid {
			event.AgentMessageID = agentMessageID.Int64
		}
		event.Payload = map[string]any{}
		if traceJSON.Valid && traceJSON.String != "" {
			var trace any
			if err := json.Unmarshal([]byte(traceJSON.String), &trace); err != nil {
				return nil, err
			}
			event.Payload["learning_trace"] = trace
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *SQLiteStore) LatestEvidence(ctx context.Context, sessionID string) (map[string]any, error) {
	var payloadJSON string
	err := s.db.QueryRowContext(
		ctx,
		`select payload_json
		 from evidence_events
		 where session_id = ?
		 order by id desc
		 limit 1`,
		sessionID,
	).Scan(&payloadJSON)
	if err == sql.ErrNoRows {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (s *SQLiteStore) ListLearnerMemory(ctx context.Context, learnerID string, limit int) ([]LearnerMemory, error) {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if limit <= 0 {
		limit = 30
	}

	rows, err := s.db.QueryContext(
		ctx,
		`select id, learner_id, memory_type, payload_json, updated_at
		 from learner_memory
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

	var memories []LearnerMemory
	for rows.Next() {
		var memory LearnerMemory
		var payloadJSON string
		if err := rows.Scan(&memory.ID, &memory.LearnerID, &memory.MemoryType, &payloadJSON, &memory.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(payloadJSON), &memory.Payload); err != nil {
			return nil, err
		}
		if memory.Payload["status"] == "deleted" {
			continue
		}
		memories = append(memories, memory)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return memories, nil
}

func (s *SQLiteStore) ApplyMemoryUpdates(ctx context.Context, learnerID string, updates []map[string]any) error {
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if len(updates) == 0 {
		return nil
	}

	now := nowBeijing().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	for _, update := range updates {
		operation, _ := update["operation"].(string)
		switch strings.ToUpper(operation) {
		case "ADD":
			payload := memoryPayloadFromUpdate(learnerID, update, now)
			if payload["memory_id"] == nil || payload["memory_id"] == "" {
				payload["memory_id"] = newID("memory")
			}
			if payload["status"] == nil || payload["status"] == "" {
				payload["status"] = "active"
			}
			if payload["strength"] == nil {
				payload["strength"] = 1
			}
			if payload["use_count"] == nil {
				payload["use_count"] = 0
			}
			payloadJSON, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			memoryType := stringValue(payload["memory_type"], "task_summary")
			if _, err := tx.ExecContext(
				ctx,
				`insert into learner_memory (learner_id, memory_type, payload_json, updated_at) values (?, ?, ?, ?)`,
				learnerID,
				memoryType,
				string(payloadJSON),
				now,
			); err != nil {
				return err
			}
		case "UPDATE":
			targetID, _ := update["target_memory_id"].(string)
			if targetID == "" {
				continue
			}
			rowID, payload, err := findMemoryPayloadByID(ctx, tx, learnerID, targetID)
			if err != nil {
				return err
			}
			if rowID == 0 {
				payload := memoryPayloadFromUpdate(learnerID, update, now)
				payload["memory_id"] = targetID
				payload["status"] = "active"
				payloadJSON, err := json.Marshal(payload)
				if err != nil {
					return err
				}
				memoryType := stringValue(payload["memory_type"], "task_summary")
				if _, err := tx.ExecContext(
					ctx,
					`insert into learner_memory (learner_id, memory_type, payload_json, updated_at) values (?, ?, ?, ?)`,
					learnerID,
					memoryType,
					string(payloadJSON),
					now,
				); err != nil {
					return err
				}
				continue
			}
			mergeMemoryPayload(payload, update, now)
			payload["memory_id"] = targetID
			payload["strength"] = numericValue(payload["strength"], 1) + 1
			payload["use_count"] = numericValue(payload["use_count"], 0) + 1
			payloadJSON, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			memoryType := stringValue(payload["memory_type"], "task_summary")
			if _, err := tx.ExecContext(
				ctx,
				`update learner_memory set memory_type = ?, payload_json = ?, updated_at = ? where id = ?`,
				memoryType,
				string(payloadJSON),
				now,
				rowID,
			); err != nil {
				return err
			}
		case "DELETE":
			targetID, _ := update["target_memory_id"].(string)
			if targetID == "" {
				continue
			}
			rowID, payload, err := findMemoryPayloadByID(ctx, tx, learnerID, targetID)
			if err != nil {
				return err
			}
			if rowID == 0 {
				continue
			}
			payload["status"] = "deleted"
			payload["updated_at"] = now
			payloadJSON, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(
				ctx,
				`update learner_memory set payload_json = ?, updated_at = ? where id = ?`,
				string(payloadJSON),
				now,
				rowID,
			); err != nil {
				return err
			}
		case "NOOP", "":
			continue
		default:
			continue
		}
	}

	return tx.Commit()
}

type sqlExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func insertMessageTx(ctx context.Context, execer sqlExecer, sessionID string, role string, content string, now string) (sql.Result, error) {
	return execer.ExecContext(
		ctx,
		`insert into messages (session_id, role, content, created_at) values (?, ?, ?, ?)`,
		sessionID,
		role,
		content,
		now,
	)
}

func insertEvidenceEventTx(
	ctx context.Context,
	execer sqlExecer,
	sessionID string,
	studentMessageID int64,
	agentMessageID int64,
	eventType string,
	evidence map[string]any,
	now string,
) (sql.Result, error) {
	compactEvidence, err := CompactEvidencePayload(evidence)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(compactEvidence)
	if err != nil {
		return nil, err
	}
	return execer.ExecContext(
		ctx,
		`insert into evidence_events
		   (session_id, student_message_id, agent_message_id, event_type, payload_json, created_at)
		 values (?, ?, ?, ?, ?, ?)`,
		sessionID,
		zeroIntToNil(studentMessageID),
		zeroIntToNil(agentMessageID),
		eventType,
		string(payload),
		now,
	)
}

func insertSkillUsageTx(ctx context.Context, execer sqlExecer, sessionID string, evidence map[string]any, now string) error {
	skillID, ok := evidence["skill_id"].(string)
	if !ok || skillID == "" {
		return nil
	}
	directAnswer := 0
	if value, ok := evidence["direct_answer_given"].(bool); ok && value {
		directAnswer = 1
	}
	_, err := execer.ExecContext(
		ctx,
		`insert into skill_usage (session_id, skill_id, direct_answer_given, created_at) values (?, ?, ?, ?)`,
		sessionID,
		skillID,
		directAnswer,
		now,
	)
	return err
}

func (s *SQLiteStore) ensureEvidenceEventMessageColumns(ctx context.Context) error {
	required := map[string]string{
		"student_message_id": `alter table evidence_events add column student_message_id integer`,
		"agent_message_id":   `alter table evidence_events add column agent_message_id integer`,
	}
	rows, err := s.db.QueryContext(ctx, `pragma table_info(evidence_events)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var typ string
		var notnull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notnull, &defaultValue, &pk); err != nil {
			return err
		}
		delete(required, name)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, statement := range required {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func memoryPayloadFromUpdate(learnerID string, update map[string]any, now string) map[string]any {
	payload := map[string]any{
		"learner_id":   learnerID,
		"valid_from":   now,
		"updated_at":   now,
		"last_used_at": now,
	}
	mergeMemoryPayload(payload, update, now)
	return payload
}

func mergeMemoryPayload(payload map[string]any, update map[string]any, now string) {
	for key, value := range update {
		if key == "operation" || key == "target_memory_id" {
			continue
		}
		payload[key] = value
	}
	payload["updated_at"] = now
	payload["last_used_at"] = now
	if payload["status"] == nil || payload["status"] == "" {
		payload["status"] = "active"
	}
}

func findMemoryPayloadByID(ctx context.Context, tx *sql.Tx, learnerID string, memoryID string) (int64, map[string]any, error) {
	rows, err := tx.QueryContext(
		ctx,
		`select id, payload_json from learner_memory where learner_id = ? order by id desc`,
		learnerID,
	)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var rowID int64
		var payloadJSON string
		if err := rows.Scan(&rowID, &payloadJSON); err != nil {
			return 0, nil, err
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
			return 0, nil, err
		}
		if payload["memory_id"] == memoryID {
			return rowID, payload, nil
		}
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	return 0, nil, nil
}

func stringValue(value any, fallback string) string {
	if text, ok := value.(string); ok && text != "" {
		return text
	}
	return fallback
}

func numericValue(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return fallback
	}
}

func newID(prefix string) string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(bytes)
}
