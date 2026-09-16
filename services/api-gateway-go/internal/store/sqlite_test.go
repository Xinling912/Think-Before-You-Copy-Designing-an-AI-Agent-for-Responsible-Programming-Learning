package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestSQLiteMigrationCreatesCoreTables(t *testing.T) {
	store := openTestStore(t)

	tables := []string{
		"sessions",
		"messages",
		"evidence_events",
		"skill_usage",
		"learner_memory",
		"learner_memory_v2",
		"memory_events",
		"topic_summaries",
		"learning_episodes",
		"learning_facts",
		"learner_profile",
		"kg_candidates",
		"kg_candidate_reviews",
		"learner_topic_progress",
		"test_questions",
		"test_attempts",
		"test_attempt_reservations",
		"conversation_events",
		"conversation_projections",
	}

	for _, table := range tables {
		var name string
		err := store.db.QueryRow(
			`select name from sqlite_master where type = 'table' and name = ?`,
			table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("expected table %s to exist: %v", table, err)
		}
	}

	assertResearchGroundedColumnContracts(t, store.db)
	assertKGCandidateReviewColumnContracts(t, store.db)
}

func TestTestCenterMigrationStandaloneSchema(t *testing.T) {
	db, err := sql.Open(driverName, ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	migrationSQL, err := os.ReadFile("../../migrations/005_ai_tests.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := db.Exec(string(migrationSQL)); err != nil {
		t.Fatalf("execute migration: %v", err)
	}

	assertTestCenterSchemaContracts(t, db)
}

func TestTestCenterSchemaConstraints(t *testing.T) {
	store := openTestStore(t)

	if _, err := store.db.Exec(`
		insert into learner_topic_progress (
			learner_id, topic_id, score, last_completed_level, created_at, updated_at
		) values ('learner-score', 'python-basics', 11, 0, '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z')
	`); err == nil {
		t.Fatal("expected score=11 to violate learner progress constraint")
	}

	if _, err := store.db.Exec(`
		insert into test_questions (
			id, learner_id, topic_id, level, status, generated_at
		) values ('question-pending', 'learner-status', 'python-basics', 1, 'pending', '2026-07-14T00:00:00Z')
	`); err == nil {
		t.Fatal("expected status=pending to violate test question constraint")
	}

	if _, err := store.db.Exec(`
		insert into test_questions (
			id, learner_id, topic_id, level, status, generated_at
		) values ('question-unique-attempt', 'learner-attempt', 'python-basics', 1, 'answerable', '2026-07-14T00:00:00Z')
	`); err != nil {
		t.Fatalf("insert test question: %v", err)
	}
	insertAttempt := `
		insert into test_attempts (
			id, question_id, learner_id, topic_id, submitted_answer, is_correct, score,
			reason, feedback, progress_before, progress_increment, progress_after, submitted_at
		) values (?, 'question-unique-attempt', 'learner-attempt', 'python-basics', '42', 1, 1,
			'correct', 'good', 0, 1, 1, '2026-07-14T00:01:00Z')
	`
	if _, err := store.db.Exec(insertAttempt, "attempt-first"); err != nil {
		t.Fatalf("insert first test attempt: %v", err)
	}
	if _, err := store.db.Exec(insertAttempt, "attempt-second"); err == nil {
		t.Fatal("expected duplicate question_id to violate test attempt uniqueness")
	}
}

func TestTestCenterSchemaMatchesMigration(t *testing.T) {
	migrationSQL, err := os.ReadFile("../../migrations/005_ai_tests.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}

	const firstStatement = "create table if not exists learner_topic_progress"
	start := strings.Index(schemaSQL, firstStatement)
	if start < 0 {
		t.Fatalf("runtime schema missing %s", firstStatement)
	}
	runtimeTestCenterSQL := schemaSQL[start:]
	if strings.Join(strings.Fields(runtimeTestCenterSQL), " ") != strings.Join(strings.Fields(string(migrationSQL)), " ") {
		t.Fatal("runtime Test Center schema and 005_ai_tests.sql differ after whitespace normalization")
	}
}

func TestResearchGroundedMigrationStandaloneSchema(t *testing.T) {
	db, err := sql.Open(driverName, ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	migrationSQL, err := os.ReadFile("../../migrations/002_research_grounded_memory.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := db.Exec(string(migrationSQL)); err != nil {
		t.Fatalf("execute migration: %v", err)
	}

	assertResearchGroundedColumnContracts(t, db)
}

func TestKGCandidateReviewMigrationStandaloneSchema(t *testing.T) {
	db, err := sql.Open(driverName, ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	migrationSQL, err := os.ReadFile("../../migrations/003_kg_candidate_reviews.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := db.Exec(string(migrationSQL)); err != nil {
		t.Fatalf("execute migration: %v", err)
	}

	assertKGCandidateReviewColumnContracts(t, db)
}

func TestMigrateAddsEvidenceMessageIDColumnsToExistingDatabase(t *testing.T) {
	db, err := sql.Open(driverName, ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	if _, err := db.Exec(`
		create table sessions (
		  id text primary key,
		  created_at text not null,
		  scenario text not null,
		  status text not null
		);
		create table evidence_events (
		  id integer primary key autoincrement,
		  session_id text not null,
		  event_type text not null,
		  payload_json text not null,
		  created_at text not null
		);
	`); err != nil {
		t.Fatalf("create old schema: %v", err)
	}

	store := NewSQLiteStore(db)
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate old sqlite: %v", err)
	}

	assertColumn(t, db, "evidence_events", "student_message_id", "integer", false)
	assertColumn(t, db, "evidence_events", "agent_message_id", "integer", false)
}

func TestCreateSessionPersistsScenario(t *testing.T) {
	store := openTestStore(t)

	session, err := store.CreateSession(context.Background(), "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if session.ID == "" {
		t.Fatal("expected generated session id")
	}

	var scenario string
	var status string
	err = store.db.QueryRow(
		`select scenario, status from sessions where id = ?`,
		session.ID,
	).Scan(&scenario, &status)
	if err != nil {
		t.Fatalf("query session: %v", err)
	}
	if scenario != "index-error" {
		t.Fatalf("expected scenario index-error, got %q", scenario)
	}
	if status != "active" {
		t.Fatalf("expected active session, got %q", status)
	}
}

func TestListSessionsFiltersStatusAndIncludesMessageSummary(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	active, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create active session: %v", err)
	}
	deleted, err := store.CreateSession(ctx, "slice-error")
	if err != nil {
		t.Fatalf("create deleted session: %v", err)
	}
	if _, err := store.SaveMessageWithID(ctx, active.ID, "student", "为什么我的 list 报 IndexError？"); err != nil {
		t.Fatalf("save first active message: %v", err)
	}
	if _, err := store.SaveMessageWithID(ctx, active.ID, "agent", "请先判断最大合法索引。"); err != nil {
		t.Fatalf("save second active message: %v", err)
	}
	if _, err := store.SaveMessageWithID(ctx, deleted.ID, "student", "这个会话会被软删除"); err != nil {
		t.Fatalf("save deleted message: %v", err)
	}
	deletedSession, err := store.DeleteSession(ctx, deleted.ID)
	if err != nil {
		t.Fatalf("soft delete session: %v", err)
	}
	if deletedSession.Status != "deleted" {
		t.Fatalf("expected deleted status from soft delete, got %#v", deletedSession)
	}

	activeSessions, err := store.ListSessions(ctx, "active")
	if err != nil {
		t.Fatalf("list active sessions: %v", err)
	}
	if len(activeSessions) != 1 {
		t.Fatalf("expected one active session, got %#v", activeSessions)
	}
	if activeSessions[0].ID != active.ID || activeSessions[0].Status != "active" {
		t.Fatalf("expected active session summary, got %#v", activeSessions[0])
	}
	if activeSessions[0].MessageCount != 2 {
		t.Fatalf("expected active message count 2, got %d", activeSessions[0].MessageCount)
	}
	if activeSessions[0].LatestMessageAt == "" {
		t.Fatalf("expected latest_message_at for active session, got %#v", activeSessions[0])
	}

	allSessions, err := store.ListSessions(ctx, "all")
	if err != nil {
		t.Fatalf("list all sessions: %v", err)
	}
	if len(allSessions) != 2 {
		t.Fatalf("expected active and deleted sessions in all filter, got %#v", allSessions)
	}

	deletedSessions, err := store.ListSessions(ctx, "deleted")
	if err != nil {
		t.Fatalf("list deleted sessions: %v", err)
	}
	if len(deletedSessions) != 1 || deletedSessions[0].ID != deleted.ID {
		t.Fatalf("expected deleted session only, got %#v", deletedSessions)
	}
	if deletedSessions[0].MessageCount != 1 {
		t.Fatalf("expected deleted message count to be preserved, got %d", deletedSessions[0].MessageCount)
	}
}

func TestSessionDetailReturnsMessagesAndEvidencePayloads(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	studentID, err := store.SaveMessageWithID(ctx, session.ID, "student", "我访问 list[2]")
	if err != nil {
		t.Fatalf("save student message: %v", err)
	}
	agentID, err := store.SaveMessageWithID(ctx, session.ID, "agent", "长度为 2 的最大合法索引是多少？")
	if err != nil {
		t.Fatalf("save agent message: %v", err)
	}
	if _, err := insertEvidenceEventTx(ctx, store.db, session.ID, studentID, agentID, "ai_step", map[string]any{
		"skill_id": "student-learning/progressive-hint-ladder",
		"rag": map[string]any{
			"source": "python-docs",
		},
		"kg": map[string]any{
			"path": []string{"Concept:index", "ErrorType:IndexError"},
		},
		"memory": map[string]any{
			"selected_memory_ids": []string{"memory-index-range"},
		},
	}, "2026-07-07T00:00:00Z"); err != nil {
		t.Fatalf("insert evidence event: %v", err)
	}

	detail, err := store.GetSessionDetail(ctx, session.ID)
	if err != nil {
		t.Fatalf("get session detail: %v", err)
	}
	if detail.Session.ID != session.ID || detail.Session.Status != "active" {
		t.Fatalf("unexpected session in detail: %#v", detail.Session)
	}
	if len(detail.Messages) != 2 {
		t.Fatalf("expected two messages, got %#v", detail.Messages)
	}
	if detail.Messages[0].ID != studentID || detail.Messages[1].ID != agentID {
		t.Fatalf("expected chronological message ids %d/%d, got %#v", studentID, agentID, detail.Messages)
	}
	if len(detail.EvidenceEvents) != 1 {
		t.Fatalf("expected one evidence event, got %#v", detail.EvidenceEvents)
	}
	if detail.EvidenceEvents[0].StudentMessageContent != "我访问 list[2]" ||
		detail.EvidenceEvents[0].AgentMessageContent != "长度为 2 的最大合法索引是多少？" {
		t.Fatalf("expected evidence events to include linked message content, got %#v", detail.EvidenceEvents[0])
	}
	evidence := detail.EvidenceEvents[0].Payload
	if evidence["skill_id"] != "student-learning/progressive-hint-ladder" {
		t.Fatalf("expected skill payload, got %#v", evidence)
	}
	if evidence["rag"].(map[string]any)["source"] != "python-docs" {
		t.Fatalf("expected RAG payload to be preserved, got %#v", evidence)
	}
	if len(evidence["kg"].(map[string]any)["path"].([]any)) != 2 {
		t.Fatalf("expected KG path payload to be preserved, got %#v", evidence)
	}
	if evidence["memory"].(map[string]any)["selected_memory_ids"].([]any)[0] != "memory-index-range" {
		t.Fatalf("expected memory payload to be preserved, got %#v", evidence)
	}
}

func TestSeedDemoDataCreatesTenTurnEvidenceEvents(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	result, err := store.SeedDemoData(ctx)
	if err != nil {
		t.Fatalf("seed demo data: %v", err)
	}
	if result.SessionID == "" {
		t.Fatalf("expected seeded session id")
	}
	if result.EvidenceEvents != 10 || result.Messages != 20 {
		t.Fatalf("expected 10 evidence events and 20 messages, got %#v", result)
	}

	sessions, err := store.ListSessions(ctx, "all")
	if err != nil {
		t.Fatalf("list seeded sessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected one seeded session, got %#v", sessions)
	}
	if sessions[0].MessageCount != 20 {
		t.Fatalf("expected seeded session to have 20 messages, got %#v", sessions[0])
	}

	detail, err := store.GetSessionDetail(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("get seeded session detail: %v", err)
	}
	if len(detail.EvidenceEvents) != 10 {
		t.Fatalf("expected 10 turn-level evidence events, got %#v", detail.EvidenceEvents)
	}
	for _, event := range detail.EvidenceEvents {
		if event.StudentMessageID == 0 || event.AgentMessageID == 0 {
			t.Fatalf("evidence event must bind to student and agent messages: %#v", event)
		}
		payload := event.Payload
		for _, key := range []string{"diagnosis", "ragas", "ragchecker_layer", "kg_path", "skill_id", "evidence", "memory_reading_plan", "memory_updates", "rag_sources"} {
			if _, ok := payload[key]; !ok {
				t.Fatalf("seeded evidence event missing %s: %#v", key, payload)
			}
		}
		payloadText := strings.ToLower(mustMarshalMap(t, payload))
		forbiddenIdentifiers := []string{"open" + "id", "we" + "chat"}
		for _, forbiddenIdentifier := range forbiddenIdentifiers {
			if strings.Contains(payloadText, forbiddenIdentifier) {
				t.Fatalf("seeded evidence must not store social platform identifiers: %#v", payload)
			}
		}
	}

	again, err := store.SeedDemoData(ctx)
	if err != nil {
		t.Fatalf("seed demo data second time: %v", err)
	}
	if !again.AlreadySeeded {
		t.Fatalf("expected second seed call to be idempotent, got %#v", again)
	}
	assertTableCount(t, store.db, "evidence_events", 10)
	assertTableCount(t, store.db, "messages", 20)
}

func TestDeleteSessionSoftDeletesAndKeepsMessagesEvidenceAndMemory(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: "learner-delete-session",
		SessionID: session.ID,
		Payload:   map[string]any{"status": "started_before_ai_core"},
	})
	if err != nil {
		t.Fatalf("create episode: %v", err)
	}
	if _, err := store.PersistCompletedSessionTurn(ctx, CompletedSessionTurnInput{
		SessionID:      session.ID,
		LearnerID:      "learner-delete-session",
		StudentContent: "我访问 list[2]",
		AgentContent:   "最大合法索引是多少？",
		EpisodeID:      episode.ID,
		Evidence: map[string]any{
			"skill_id": "student-learning/retrieve-first-gate",
			"memory":   map[string]any{"operation": "ADD"},
		},
		MemoryEvents: []MemoryEventInput{
			{
				LearnerID: "learner-delete-session",
				SessionID: session.ID,
				Operation: "ADD",
				Topic:     "list_index_indexerror",
				Content:   "学生可能混淆 len(list) 与最大合法索引。",
				Reason:    "session_delete_retention_test",
			},
		},
	}); err != nil {
		t.Fatalf("persist completed turn: %v", err)
	}

	deletedSession, err := store.DeleteSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("soft delete session: %v", err)
	}
	if deletedSession.Status != "deleted" {
		t.Fatalf("expected deleted status from soft delete, got %#v", deletedSession)
	}

	detail, err := store.GetSessionDetail(ctx, session.ID)
	if err != nil {
		t.Fatalf("get deleted session detail: %v", err)
	}
	if detail.Session.Status != "deleted" {
		t.Fatalf("expected deleted session status, got %q", detail.Session.Status)
	}
	if len(detail.Messages) != 2 {
		t.Fatalf("soft delete must keep messages, got %#v", detail.Messages)
	}
	if len(detail.EvidenceEvents) != 1 {
		t.Fatalf("soft delete must keep evidence events, got %#v", detail.EvidenceEvents)
	}
	assertTableCount(t, store.db, "memory_events", 1)
	assertTableCount(t, store.db, "learner_memory_v2", 1)
}

func TestUpsertKGCandidateReviewUpdatesExistingCandidateDecision(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	approved, err := store.UpsertKGCandidateReview(ctx, KGCandidateReviewInput{
		CandidateID:  "kgcand-indexerror",
		Status:       "approved",
		ReviewerID:   "reviewer-a",
		ReviewerNote: "Evidence is grounded.",
	})
	if err != nil {
		t.Fatalf("upsert approved review: %v", err)
	}
	if approved.Status != "approved" {
		t.Fatalf("expected approved status, got %q", approved.Status)
	}
	if approved.ReviewedAt.IsZero() || approved.CreatedAt.IsZero() || approved.UpdatedAt.IsZero() {
		t.Fatalf("expected review timestamps, got %#v", approved)
	}

	rejected, err := store.UpsertKGCandidateReview(ctx, KGCandidateReviewInput{
		CandidateID:  "kgcand-indexerror",
		Status:       "rejected",
		ReviewerID:   "reviewer-b",
		ReviewerNote: "Predicate is too broad.",
	})
	if err != nil {
		t.Fatalf("upsert rejected review: %v", err)
	}

	if rejected.Status != "rejected" {
		t.Fatalf("expected rejected status after update, got %q", rejected.Status)
	}
	if rejected.ReviewerID != "reviewer-b" {
		t.Fatalf("expected updated reviewer, got %q", rejected.ReviewerID)
	}
	if rejected.ReviewerNote != "Predicate is too broad." {
		t.Fatalf("expected updated note, got %q", rejected.ReviewerNote)
	}

	latest, ok, err := store.LatestKGCandidateReview(ctx, "kgcand-indexerror")
	if err != nil {
		t.Fatalf("latest review: %v", err)
	}
	if !ok {
		t.Fatal("expected latest review to exist")
	}
	if latest.Status != "rejected" || latest.ReviewerID != "reviewer-b" {
		t.Fatalf("expected latest rejected review from reviewer-b, got %#v", latest)
	}

	reviews, err := store.ListKGCandidateReviews(ctx)
	if err != nil {
		t.Fatalf("list reviews: %v", err)
	}
	if len(reviews) != 1 {
		t.Fatalf("expected one upserted review row, got %d: %#v", len(reviews), reviews)
	}
}

func TestUpsertKGCandidateReviewRejectsEmptyReviewerID(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	_, err := store.UpsertKGCandidateReview(ctx, KGCandidateReviewInput{
		CandidateID:  "kgcand-indexerror",
		Status:       "approved",
		ReviewerID:   "   ",
		ReviewerNote: "missing reviewer",
	})
	if err == nil {
		t.Fatal("expected reviewer id validation error")
	}
	if err.Error() != "reviewer id is required" {
		t.Fatalf("expected reviewer id is required, got %q", err.Error())
	}
}

func TestSaveMessageAndEvidencePersistsLearningEvidence(t *testing.T) {
	store := openTestStore(t)
	session, err := store.CreateSession(context.Background(), "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	evidence := map[string]any{
		"skill_id":            "student-learning/retrieve-first-gate",
		"direct_answer_given": false,
		"evidence": map[string]any{
			"cognitive_gate": "retrieval",
		},
	}

	err = store.SaveMessageAndEvidence(
		context.Background(),
		session.ID,
		"student",
		"为什么我的 list 报 IndexError？",
		evidence,
	)
	if err != nil {
		t.Fatalf("save message and evidence: %v", err)
	}

	var messageCount int
	if err := store.db.QueryRow(`select count(*) from messages where session_id = ?`, session.ID).Scan(&messageCount); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if messageCount != 1 {
		t.Fatalf("expected 1 message, got %d", messageCount)
	}

	var payload string
	if err := store.db.QueryRow(`select payload_json from evidence_events where session_id = ?`, session.ID).Scan(&payload); err != nil {
		t.Fatalf("query evidence: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatalf("evidence payload should be JSON: %v", err)
	}
	if decoded["skill_id"] != "student-learning/retrieve-first-gate" {
		t.Fatalf("expected retrieve-first skill evidence, got %#v", decoded["skill_id"])
	}
}

func TestSaveMessageAndEvidenceWithIDReturnsStudentMessageID(t *testing.T) {
	store := openTestStore(t)
	session, err := store.CreateSession(context.Background(), "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	messageID, err := store.SaveMessageAndEvidenceWithID(
		context.Background(),
		session.ID,
		"student",
		"我访问的是 list[2]，长度是 2",
		map[string]any{"skill_id": "student-learning/progressive-hint-ladder"},
	)
	if err != nil {
		t.Fatalf("save message and evidence with id: %v", err)
	}
	if messageID == 0 {
		t.Fatal("expected non-zero message id")
	}

	var role string
	var content string
	if err := store.db.QueryRow(`select role, content from messages where id = ?`, messageID).Scan(&role, &content); err != nil {
		t.Fatalf("query saved message: %v", err)
	}
	if role != "student" || content != "我访问的是 list[2]，长度是 2" {
		t.Fatalf("unexpected saved message: role=%q content=%q", role, content)
	}
}

func TestListEvidenceEventsReturnsSavedPayloads(t *testing.T) {
	store := openTestStore(t)
	session, err := store.CreateSession(context.Background(), "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	err = store.SaveMessageAndEvidence(
		context.Background(),
		session.ID,
		"student",
		"为什么我的 list 报 IndexError？",
		map[string]any{"skill_id": "student-learning/retrieve-first-gate"},
	)
	if err != nil {
		t.Fatalf("save evidence: %v", err)
	}

	events, err := store.ListEvidenceEvents(context.Background(), session.ID)
	if err != nil {
		t.Fatalf("list evidence events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 evidence event, got %d", len(events))
	}
	if events[0].Payload["skill_id"] != "student-learning/retrieve-first-gate" {
		t.Fatalf("unexpected evidence payload: %#v", events[0].Payload)
	}
	if events[0].StudentMessageContent != "为什么我的 list 报 IndexError？" {
		t.Fatalf("expected student message content on evidence event, got %#v", events[0])
	}
}

func TestListRecentMessagesReturnsLastMessagesChronologically(t *testing.T) {
	store := openTestStore(t)
	session, err := store.CreateSession(context.Background(), "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	messages := []struct {
		role    string
		content string
	}{
		{"student", "第一句"},
		{"agent", "第二句"},
		{"student", "第三句"},
	}
	for _, message := range messages {
		if err := store.SaveMessage(context.Background(), session.ID, message.role, message.content); err != nil {
			t.Fatalf("save message: %v", err)
		}
	}

	recent, err := store.ListRecentMessages(context.Background(), session.ID, 2)
	if err != nil {
		t.Fatalf("list recent messages: %v", err)
	}
	if len(recent) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(recent))
	}
	if recent[0].Content != "第二句" || recent[1].Content != "第三句" {
		t.Fatalf("expected chronological last messages, got %#v", recent)
	}
}

func TestSaveMessageWithIDReturnsPersistedMessageID(t *testing.T) {
	store := openTestStore(t)
	session, err := store.CreateSession(context.Background(), "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	studentID, err := store.SaveMessageWithID(context.Background(), session.ID, "student", "为什么我的 list 报 IndexError？")
	if err != nil {
		t.Fatalf("save student message: %v", err)
	}
	agentID, err := store.SaveMessageWithID(context.Background(), session.ID, "agent", "请先判断最大合法索引。")
	if err != nil {
		t.Fatalf("save agent message: %v", err)
	}
	if studentID == 0 || agentID == 0 {
		t.Fatalf("expected non-zero message ids, got student=%d agent=%d", studentID, agentID)
	}
	if agentID <= studentID {
		t.Fatalf("expected later agent message id to be larger than student id, got student=%d agent=%d", studentID, agentID)
	}

	var role string
	var content string
	if err := store.db.QueryRow(`select role, content from messages where id = ?`, agentID).Scan(&role, &content); err != nil {
		t.Fatalf("query saved agent message: %v", err)
	}
	if role != "agent" || content != "请先判断最大合法索引。" {
		t.Fatalf("unexpected saved message role/content: %q %q", role, content)
	}
}

func TestPersistCompletedSessionTurnWritesMessagesEvidenceAndResearchStateAtomically(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	result, err := store.PersistCompletedSessionTurn(ctx, CompletedSessionTurnInput{
		SessionID:      session.ID,
		LearnerID:      "learner-a",
		StudentContent: "我访问的是 list[2]，长度是 2",
		AgentContent:   "长度为 2 时最大合法索引是多少？",
		Episode: &LearningEpisodeInput{
			LearnerID: "learner-a",
			SessionID: session.ID,
		},
		Evidence: map[string]any{
			"skill_id":            "student-learning/progressive-hint-ladder",
			"direct_answer_given": false,
		},
		MemoryEvents: []MemoryEventInput{
			{
				LearnerID:       "learner-a",
				SessionID:       session.ID,
				Operation:       "ADD",
				MemoryType:      "misconception",
				Topic:           "list_index_indexerror",
				Content:         "学生把 len(list) 当成最大合法索引。",
				Concepts:        []string{"Concept:index"},
				SourceEventID:   0,
				SourceSessionID: session.ID,
				Reason:          "student_used_out_of_range_index",
			},
		},
		TopicSummary: &TopicSummaryInput{
			LearnerID:          "learner-a",
			Topic:              "list_index_indexerror",
			Summary:            "学生正在学习 list 下标越界。",
			WeakConcepts:       []string{"Concept:valid_index_range"},
			MasteredConcepts:   []string{"Concept:list"},
			NextTeachingAction: "ask_transfer_question",
			SourceSessionID:    session.ID,
			SourceMemoryIDs:    []string{"mem_existing"},
		},
		LearningFacts: []LearningFactInput{
			{
				FactID:          "fact_completed_turn",
				LearnerID:       "learner-a",
				Subject:         "Learner:learner-a",
				Predicate:       "has_misconception",
				Object:          "Misconception:list_index_indexerror",
				Confidence:      0.91,
				SourceEpisodeID: 999,
				Status:          "active",
				Payload:         map[string]any{"source": "ai-core"},
			},
		},
		ConversationEvents: []ConversationEventInput{
			{
				EventID: uuid.NewString(), SessionID: session.ID, ClientTurnID: "turn-completed-atomic",
				Ordinal: 1, Sequence: 1, EventType: "assistant_response_committed", Payload: map[string]any{"answer": "长度为 2 时最大合法索引是多少？"},
			},
		},
		ConversationProjection: &ConversationProjectionRecord{
			SessionID: session.ID, LastSequence: 1,
			Projection: map[string]any{
				"schema_version": 1, "last_sequence": int64(1), "active_topic_id": "topic-list-index",
				"back_stack": []any{}, "topics": map[string]any{"topic-list-index": map[string]any{"topic_id": "topic-list-index"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("persist completed turn: %v", err)
	}
	if result.StudentMessageID == 0 || result.AgentMessageID == 0 || result.EvidenceEventID == 0 || result.EpisodeID == 0 {
		t.Fatalf("expected persisted ids, got %#v", result)
	}

	var messageCount int
	if err := store.db.QueryRow(`select count(*) from messages where session_id = ?`, session.ID).Scan(&messageCount); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if messageCount != 2 {
		t.Fatalf("expected 2 messages, got %d", messageCount)
	}

	var studentColumn sql.NullInt64
	var agentColumn sql.NullInt64
	var payloadJSON string
	if err := store.db.QueryRow(
		`select student_message_id, agent_message_id, payload_json from evidence_events where id = ?`,
		result.EvidenceEventID,
	).Scan(&studentColumn, &agentColumn, &payloadJSON); err != nil {
		t.Fatalf("query evidence event: %v", err)
	}
	if !studentColumn.Valid || studentColumn.Int64 != result.StudentMessageID {
		t.Fatalf("expected evidence student_message_id %d, got %#v", result.StudentMessageID, studentColumn)
	}
	if !agentColumn.Valid || agentColumn.Int64 != result.AgentMessageID {
		t.Fatalf("expected evidence agent_message_id %d, got %#v", result.AgentMessageID, agentColumn)
	}
	var evidence map[string]any
	if err := json.Unmarshal([]byte(payloadJSON), &evidence); err != nil {
		t.Fatalf("decode evidence payload: %v", err)
	}
	if int64(evidence["student_message_id"].(float64)) != result.StudentMessageID {
		t.Fatalf("payload student_message_id mismatch: %#v", evidence)
	}
	if int64(evidence["agent_message_id"].(float64)) != result.AgentMessageID {
		t.Fatalf("payload agent_message_id mismatch: %#v", evidence)
	}

	var memoryMessageID sql.NullInt64
	if err := store.db.QueryRow(`select message_id from memory_events where session_id = ?`, session.ID).Scan(&memoryMessageID); err != nil {
		t.Fatalf("query memory event: %v", err)
	}
	if !memoryMessageID.Valid || memoryMessageID.Int64 != result.StudentMessageID {
		t.Fatalf("expected memory_event.message_id to bind student id %d, got %#v", result.StudentMessageID, memoryMessageID)
	}

	var episodeStudentID sql.NullInt64
	var episodeAgentID sql.NullInt64
	var episodePayload string
	if err := store.db.QueryRow(
		`select student_message_id, agent_message_id, payload_json from learning_episodes where id = ?`,
		result.EpisodeID,
	).Scan(&episodeStudentID, &episodeAgentID, &episodePayload); err != nil {
		t.Fatalf("query episode: %v", err)
	}
	if !episodeStudentID.Valid || episodeStudentID.Int64 != result.StudentMessageID {
		t.Fatalf("episode student id mismatch: %#v", episodeStudentID)
	}
	if !episodeAgentID.Valid || episodeAgentID.Int64 != result.AgentMessageID {
		t.Fatalf("episode agent id mismatch: %#v", episodeAgentID)
	}
	if !strings.Contains(episodePayload, `"stored_as":"learning_episode"`) {
		t.Fatalf("expected learning episode payload marker, got %s", episodePayload)
	}

	summary, err := getTopicSummary(ctx, store.db, "learner-a", "list_index_indexerror")
	if err != nil {
		t.Fatalf("topic summary: %v", err)
	}
	if summary.NextTeachingAction != "ask_transfer_question" {
		t.Fatalf("unexpected topic summary: %#v", summary)
	}
	facts, err := store.ListLearningFacts(ctx, "learner-a")
	if err != nil {
		t.Fatalf("list facts: %v", err)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 learning fact, got %#v", facts)
	}
	if facts[0].SourceEpisodeID != result.EpisodeID {
		t.Fatalf("learning fact source_episode_id must be local episode id %d, got %d", result.EpisodeID, facts[0].SourceEpisodeID)
	}
	committed, err := store.ConversationTurnCommitted(ctx, session.ID, "turn-completed-atomic")
	if err != nil {
		t.Fatalf("check committed conversation turn: %v", err)
	}
	if !committed {
		t.Fatal("conversation event was not committed with the completed turn")
	}
	projection, err := store.GetConversationProjection(ctx, session.ID)
	if err != nil {
		t.Fatalf("load committed conversation projection: %v", err)
	}
	if projection.LastSequence != 1 {
		t.Fatalf("conversation projection sequence = %d, want 1", projection.LastSequence)
	}
}

func TestPersistCompletedSessionTurnRollsBackWhenLearningFactInvalid(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: "learner-a",
		SessionID: session.ID,
		Payload:   map[string]any{"status": "started_before_ai_core"},
	})
	if err != nil {
		t.Fatalf("create episode: %v", err)
	}

	_, err = store.PersistCompletedSessionTurn(ctx, CompletedSessionTurnInput{
		SessionID:      session.ID,
		LearnerID:      "learner-a",
		StudentContent: "学生消息",
		AgentContent:   "AI消息",
		EpisodeID:      episode.ID,
		Evidence:       map[string]any{"skill_id": "student-learning/retrieve-first-gate"},
		MemoryEvents: []MemoryEventInput{
			{
				LearnerID: "learner-a",
				SessionID: session.ID,
				Operation: "ADD",
				Topic:     "list_index_indexerror",
				Content:   "这条 memory 不能半写入。",
				Reason:    "rollback_test",
			},
		},
		TopicSummary: &TopicSummaryInput{
			LearnerID: "learner-a",
			Topic:     "list_index_indexerror",
			Summary:   "这条 summary 不能半写入。",
		},
		LearningFacts: []LearningFactInput{
			{
				LearnerID:       "learner-a",
				Subject:         "Learner:learner-a",
				Predicate:       "",
				Object:          "Misconception:list_index_indexerror",
				SourceEpisodeID: episode.ID,
			},
		},
	})
	if err == nil {
		t.Fatal("expected invalid learning fact to fail completed turn transaction")
	}

	assertTableCount(t, store.db, "messages", 0)
	assertTableCount(t, store.db, "evidence_events", 0)
	assertTableCount(t, store.db, "skill_usage", 0)
	assertTableCount(t, store.db, "memory_events", 0)
	assertTableCount(t, store.db, "learner_memory_v2", 0)
	assertTableCount(t, store.db, "topic_summaries", 0)
	assertTableCount(t, store.db, "learning_facts", 0)

	var studentMessageID sql.NullInt64
	var agentMessageID sql.NullInt64
	if err := store.db.QueryRow(
		`select student_message_id, agent_message_id from learning_episodes where id = ?`,
		episode.ID,
	).Scan(&studentMessageID, &agentMessageID); err != nil {
		t.Fatalf("query episode after rollback: %v", err)
	}
	if studentMessageID.Valid || agentMessageID.Valid {
		t.Fatalf("episode should not be linked after rollback, got student=%#v agent=%#v", studentMessageID, agentMessageID)
	}
}

func TestPersistCompletedSessionTurnDoesNotReviveDeletedMemoryWithSameTurnReinforcement(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID:  "learner-delete-reinforce",
		SessionID:  session.ID,
		Topic:      "list_index_indexerror",
		SkillState: "started",
	})
	if err != nil {
		t.Fatalf("create episode: %v", err)
	}
	added, err := store.ApplyMemoryEvent(ctx, MemoryEventInput{
		LearnerID:  "learner-delete-reinforce",
		SessionID:  session.ID,
		Operation:  "ADD",
		MemoryType: "misconception",
		Topic:      "list_index_indexerror",
		Content:    "学生认为长度为 2 的 list 可以访问 list[2]。",
		Concepts:   []string{"Concept:index"},
		Reason:     "seed_misconception",
	})
	if err != nil {
		t.Fatalf("add memory: %v", err)
	}

	_, err = store.PersistCompletedSessionTurn(ctx, CompletedSessionTurnInput{
		SessionID:      session.ID,
		LearnerID:      "learner-delete-reinforce",
		StudentContent: "长度为 2 时合法索引是 0 和 1。",
		AgentContent:   "请给一个信心分数。",
		EpisodeID:      episode.ID,
		Evidence:       map[string]any{"skill_id": "student-learning/teach-back-evaluator"},
		MemoryEvents: []MemoryEventInput{
			{
				LearnerID:      "learner-delete-reinforce",
				SessionID:      session.ID,
				Operation:      "DELETE",
				TargetMemoryID: added.MemoryID,
				MemoryType:     "mastery",
				Topic:          "list_index_indexerror",
				Content:        "学生能解释长度为 2 的 list 合法索引是 0 和 1。",
				Concepts:       []string{"Concept:index"},
				Reason:         "mastery_contradicts_active_misconception",
			},
			{
				LearnerID:      "learner-delete-reinforce",
				SessionID:      session.ID,
				Operation:      "REINFORCE",
				TargetMemoryID: added.MemoryID,
				Reason:         "selected_by_rmm_prospective_plan",
				Payload: map[string]any{
					"use_count_delta": 1,
					"strength_delta":  1,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("persist completed turn: %v", err)
	}

	var status string
	var useCount int
	if err := store.db.QueryRow(
		`select status, use_count from learner_memory_v2 where memory_id = ?`,
		added.MemoryID,
	).Scan(&status, &useCount); err != nil {
		t.Fatalf("query memory status: %v", err)
	}
	if status != "deleted" {
		t.Fatalf("expected DELETE to dominate same-turn REINFORCE, got status %q", status)
	}
	if useCount != added.UseCount {
		t.Fatalf("same-turn skipped REINFORCE must not increment use_count, before %d after %d", added.UseCount, useCount)
	}

	var eventCount int
	if err := store.db.QueryRow(
		`select count(*) from memory_events where learner_id = ? and operation = 'REINFORCE'`,
		"learner-delete-reinforce",
	).Scan(&eventCount); err != nil {
		t.Fatalf("count reinforce events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("expected same-turn reinforce event to be skipped, got %d", eventCount)
	}
}

func TestPersistCompletedSessionTurnRollsBackWhenEpisodeMissing(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	_, err = store.PersistCompletedSessionTurn(ctx, CompletedSessionTurnInput{
		SessionID:      session.ID,
		LearnerID:      "learner-missing-episode",
		StudentContent: "我访问的是 list[2]。",
		AgentContent:   "请先判断合法范围。",
		EpisodeID:      999999,
		Evidence:       map[string]any{"skill_id": "student-learning/progressive-hint-ladder"},
		MemoryEvents: []MemoryEventInput{
			{
				LearnerID:  "learner-missing-episode",
				SessionID:  session.ID,
				Operation:  "ADD",
				MemoryType: "misconception",
				Topic:      "list_index_indexerror",
				Content:    "这条 memory 不应半写入。",
				Reason:     "missing_episode_rollback",
			},
		},
	})
	if err == nil {
		t.Fatal("expected missing episode to fail completed turn transaction")
	}

	assertTableCount(t, store.db, "messages", 0)
	assertTableCount(t, store.db, "evidence_events", 0)
	assertTableCount(t, store.db, "skill_usage", 0)
	assertTableCount(t, store.db, "memory_events", 0)
	assertTableCount(t, store.db, "learner_memory_v2", 0)
}

func TestMarkLearningEpisodeFailedRecordsAICoreFailure(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: "learner-a",
		SessionID: session.ID,
		Payload:   map[string]any{"status": "started_before_ai_core"},
	})
	if err != nil {
		t.Fatalf("create episode: %v", err)
	}

	if err := store.MarkLearningEpisodeFailed(ctx, episode.ID, "failed_ai_core_unavailable"); err != nil {
		t.Fatalf("mark episode failed: %v", err)
	}

	var payloadJSON string
	if err := store.db.QueryRow(`select payload_json from learning_episodes where id = ?`, episode.ID).Scan(&payloadJSON); err != nil {
		t.Fatalf("query failed episode: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		t.Fatalf("decode episode payload: %v", err)
	}
	if payload["status"] != "failed_ai_core_unavailable" {
		t.Fatalf("expected failed_ai_core_unavailable status, got %#v", payload)
	}
}

func TestLatestEvidenceReturnsMostRecentPayload(t *testing.T) {
	store := openTestStore(t)
	session, err := store.CreateSession(context.Background(), "index-error")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	if err := store.SaveMessageAndEvidence(context.Background(), session.ID, "student", "one", map[string]any{"baseline_mode": "rag_only"}); err != nil {
		t.Fatalf("save first evidence: %v", err)
	}
	if err := store.SaveMessageAndEvidence(context.Background(), session.ID, "student", "two", map[string]any{"baseline_mode": "full_memory"}); err != nil {
		t.Fatalf("save second evidence: %v", err)
	}

	latest, err := store.LatestEvidence(context.Background(), session.ID)
	if err != nil {
		t.Fatalf("latest evidence: %v", err)
	}
	if latest["baseline_mode"] != "full_memory" {
		t.Fatalf("expected latest evidence, got %#v", latest)
	}
}

func TestApplyMemoryUpdatesAddsAndUpdatesLearnerMemory(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	err := store.ApplyMemoryUpdates(ctx, "anonymous-demo", []map[string]any{
		{
			"operation":   "ADD",
			"memory_type": "misconception",
			"topic":       "list_index_indexerror",
			"concepts":    []any{"Concept:index"},
			"content":     "学生把 len(list) 当成最大合法索引。",
		},
	})
	if err != nil {
		t.Fatalf("add memory: %v", err)
	}

	memories, err := store.ListLearnerMemory(ctx, "anonymous-demo", 10)
	if err != nil {
		t.Fatalf("list memory: %v", err)
	}
	if len(memories) != 1 {
		t.Fatalf("expected 1 memory, got %d", len(memories))
	}
	memoryID, _ := memories[0].Payload["memory_id"].(string)
	if memoryID == "" {
		t.Fatalf("expected generated memory_id, got %#v", memories[0].Payload)
	}

	err = store.ApplyMemoryUpdates(ctx, "anonymous-demo", []map[string]any{
		{
			"operation":        "UPDATE",
			"target_memory_id": memoryID,
			"memory_type":      "misconception",
			"topic":            "list_index_indexerror",
			"concepts":         []any{"Concept:index", "Concept:valid_index_range"},
			"content":          "学生还认为长度为 2 的 list 可以访问 list[2]。",
		},
	})
	if err != nil {
		t.Fatalf("update memory: %v", err)
	}

	memories, err = store.ListLearnerMemory(ctx, "anonymous-demo", 10)
	if err != nil {
		t.Fatalf("list updated memory: %v", err)
	}
	if len(memories) != 1 {
		t.Fatalf("expected 1 merged memory, got %d", len(memories))
	}
	if memories[0].Payload["memory_id"] != memoryID {
		t.Fatalf("expected same memory id after update, got %#v", memories[0].Payload["memory_id"])
	}
	if !strings.Contains(memories[0].Payload["content"].(string), "list[2]") {
		t.Fatalf("expected updated content, got %#v", memories[0].Payload)
	}
}

func openTestStore(t *testing.T) *SQLiteStore {
	t.Helper()

	db, err := sql.Open(driverName, ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)

	store := NewSQLiteStore(db)
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return store
}

func assertResearchGroundedColumnContracts(t *testing.T, db *sql.DB) {
	t.Helper()

	assertColumn(t, db, "learner_memory_v2", "source_event_id", "integer", false)
	assertColumn(t, db, "memory_events", "message_id", "integer", false)
	assertColumn(t, db, "memory_events", "session_id", "text", true)
	assertColumn(t, db, "memory_events", "reason", "text", true)
	assertColumn(t, db, "evidence_events", "student_message_id", "integer", false)
	assertColumn(t, db, "evidence_events", "agent_message_id", "integer", false)
	assertColumn(t, db, "learning_episodes", "student_message_id", "integer", false)
	assertColumn(t, db, "learning_episodes", "agent_message_id", "integer", false)
	assertColumn(t, db, "learning_facts", "source_episode_id", "integer", true)
	assertColumn(t, db, "kg_candidates", "source_chunk_id", "text", true)
	assertColumn(t, db, "kg_candidates", "source_url", "text", true)
	assertColumn(t, db, "kg_candidates", "evidence_text", "text", true)
}

func assertKGCandidateReviewColumnContracts(t *testing.T, db *sql.DB) {
	t.Helper()

	assertColumn(t, db, "kg_candidate_reviews", "candidate_id", "text", true)
	assertColumn(t, db, "kg_candidate_reviews", "status", "text", true)
	assertColumn(t, db, "kg_candidate_reviews", "reviewer_id", "text", true)
	assertColumn(t, db, "kg_candidate_reviews", "reviewer_note", "text", true)
	assertColumn(t, db, "kg_candidate_reviews", "reviewed_at", "text", true)
	assertColumn(t, db, "kg_candidate_reviews", "created_at", "text", true)
	assertColumn(t, db, "kg_candidate_reviews", "updated_at", "text", true)
}

func assertTestCenterSchemaContracts(t *testing.T, db *sql.DB) {
	t.Helper()

	for _, table := range []string{"learner_topic_progress", "test_questions", "test_attempts", "test_attempt_reservations"} {
		var name string
		if err := db.QueryRow(
			`select name from sqlite_master where type = 'table' and name = ?`,
			table,
		).Scan(&name); err != nil {
			t.Fatalf("expected table %s to exist: %v", table, err)
		}
	}
	for _, index := range []string{
		"idx_test_questions_learner_topic_generated",
		"idx_test_attempts_learner_topic_submitted",
		"idx_test_attempt_reservations_reserved_at",
	} {
		var name string
		if err := db.QueryRow(
			`select name from sqlite_master where type = 'index' and name = ?`,
			index,
		).Scan(&name); err != nil {
			t.Fatalf("expected index %s to exist: %v", index, err)
		}
	}
}

func assertTableCount(t *testing.T, db *sql.DB, table string, expected int) {
	t.Helper()

	var actual int
	if err := db.QueryRow(`select count(*) from ` + table).Scan(&actual); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	if actual != expected {
		t.Fatalf("expected %s count %d, got %d", table, expected, actual)
	}
}

func mustMarshalMap(t *testing.T, value map[string]any) string {
	t.Helper()

	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal map: %v", err)
	}
	return string(data)
}

func assertColumn(t *testing.T, db *sql.DB, table string, columnName string, columnType string, notNull bool) {
	t.Helper()

	rows, err := db.Query(`pragma table_info(` + table + `)`)
	if err != nil {
		t.Fatalf("pragma table_info(%s): %v", table, err)
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
			t.Fatalf("scan pragma row for %s: %v", table, err)
		}
		if name != columnName {
			continue
		}
		if strings.ToLower(typ) != columnType {
			t.Fatalf("expected %s.%s type %s, got %s", table, columnName, columnType, typ)
		}
		expectedNotNull := 0
		if notNull {
			expectedNotNull = 1
		}
		if notnull != expectedNotNull {
			t.Fatalf("expected %s.%s notnull %d, got %d", table, columnName, expectedNotNull, notnull)
		}
		return
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate pragma table_info(%s): %v", table, err)
	}
	t.Fatalf("expected column %s.%s to exist", table, columnName)
}
