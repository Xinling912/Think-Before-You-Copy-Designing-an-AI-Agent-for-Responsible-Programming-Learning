package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrTestQuestionNotFound = errors.New("test question not found")
var ErrTestQuestionForbidden = errors.New("test question forbidden")
var ErrTestQuestionNotAnswerable = errors.New("test question not answerable")
var ErrTestAttemptInProgress = errors.New("test attempt in progress")
var ErrTestAttemptReservation = errors.New("test attempt reservation mismatch")
var ErrTestTopicCompleted = errors.New("test topic completed")
var ErrTestLevelConflict = errors.New("test level conflict")

const testAttemptReservationTTL = 3 * time.Minute

type LearnerTopicProgress struct {
	LearnerID, TopicID            string
	Score, LastCompletedLevel     int
	LastQuestionID, LastAttemptID string
	CreatedAt, UpdatedAt          time.Time
}

type TestQuestion struct {
	ID, LearnerID, TopicID                      string
	Level                                       int
	QuestionFormat, QuestionText                string
	Options                                     []string
	ExpectedAnswer                              string
	AcceptedEquivalents, GradingRubric          []string
	KGGrounding                                 map[string]any
	Provider, Model                             string
	PromptTokens, CompletionTokens, TotalTokens int
	Status, FailureCode                         string
	GeneratedAt                                 time.Time
}

type CreateTestQuestionInput struct {
	LearnerID, TopicID                          string
	Level                                       int
	QuestionFormat, QuestionText                string
	Options                                     []string
	ExpectedAnswer                              string
	AcceptedEquivalents, GradingRubric          []string
	KGGrounding                                 map[string]any
	Provider, Model                             string
	PromptTokens, CompletionTokens, TotalTokens int
}

type CreateFailedTestQuestionInput struct {
	LearnerID, TopicID                          string
	Level                                       int
	FailureCode, Provider, Model                string
	PromptTokens, CompletionTokens, TotalTokens int
}

type RecordTestAttemptInput struct {
	LearnerID, QuestionID, ReservationID, SubmittedAnswer string
	IsCorrect                                             bool
	Score                                                 float64
	Reason, Feedback, Provider, Model                     string
	PromptTokens, CompletionTokens, TotalTokens           int
}

type TestAttemptReservation struct {
	ID, QuestionID, LearnerID, SubmittedAnswer string
	ReservedAt                                 time.Time
}

type TestAttempt struct {
	ID, QuestionID, LearnerID, TopicID, SubmittedAnswer string
	IsCorrect                                           bool
	Score                                               float64
	Reason, Feedback                                    string
	ProgressBefore, ProgressIncrement, ProgressAfter    int
	Provider, Model                                     string
	PromptTokens, CompletionTokens, TotalTokens         int
	SubmittedAt                                         time.Time
}

type TestAttemptResult struct {
	Attempt   TestAttempt
	Progress  LearnerTopicProgress
	Duplicate bool
}

const testQuestionColumns = `id, learner_id, topic_id, level,
       question_format, question_text, options_json, expected_answer,
       accepted_equivalents_json, grading_rubric_json, kg_grounding_json,
       provider, model, prompt_tokens, completion_tokens, total_tokens,
       status, failure_code, generated_at`

const testAttemptColumns = `id, question_id, learner_id, topic_id, submitted_answer,
       is_correct, score, reason, feedback,
       progress_before, progress_increment, progress_after,
       provider, model, prompt_tokens, completion_tokens, total_tokens, submitted_at`

func (s *SQLiteStore) ListLearnerTopicProgress(ctx context.Context, learnerID string) ([]LearnerTopicProgress, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`select learner_id, topic_id, score, last_completed_level,
		        coalesce(last_question_id, ''), coalesce(last_attempt_id, ''), created_at, updated_at
		 from learner_topic_progress
		 where learner_id = ?
		 order by updated_at desc, topic_id asc`,
		learnerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	progressRows := []LearnerTopicProgress{}
	for rows.Next() {
		progress, err := scanLearnerTopicProgress(rows)
		if err != nil {
			return nil, err
		}
		progressRows = append(progressRows, progress)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return progressRows, nil
}

func (s *SQLiteStore) GetLearnerTopicProgress(ctx context.Context, learnerID, topicID string) (LearnerTopicProgress, bool, error) {
	return getLearnerTopicProgress(ctx, s.db, learnerID, topicID)
}

func (s *SQLiteStore) ListRecentTestQuestions(ctx context.Context, learnerID, topicID string, limit int) ([]TestQuestion, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(
		ctx,
		`select `+testQuestionColumns+`
		 from test_questions
		 where learner_id = ? and topic_id = ?
		 order by generated_at desc, id desc
		 limit ?`,
		learnerID,
		topicID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	questions := []TestQuestion{}
	for rows.Next() {
		question, err := scanTestQuestion(rows)
		if err != nil {
			return nil, err
		}
		questions = append(questions, question)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return questions, nil
}

func (s *SQLiteStore) CreateTestQuestion(ctx context.Context, input CreateTestQuestionInput) (TestQuestion, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TestQuestion{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	now := time.Now().UTC()
	nowText := formatStoreTime(now)
	if _, err := tx.ExecContext(
		ctx,
		`insert into learner_topic_progress (
		   learner_id, topic_id, score, last_completed_level, created_at, updated_at
		 ) values (?, ?, 0, 0, ?, ?)
		 on conflict(learner_id, topic_id) do nothing`,
		input.LearnerID,
		input.TopicID,
		nowText,
		nowText,
	); err != nil {
		return TestQuestion{}, err
	}

	var score int
	if err := tx.QueryRowContext(
		ctx,
		`select score from learner_topic_progress where learner_id = ? and topic_id = ?`,
		input.LearnerID,
		input.TopicID,
	).Scan(&score); err != nil {
		return TestQuestion{}, err
	}
	if score == 10 {
		return TestQuestion{}, ErrTestTopicCompleted
	}
	if input.Level != score+1 {
		return TestQuestion{}, ErrTestLevelConflict
	}

	optionsJSON, err := marshalStringSlice(input.Options)
	if err != nil {
		return TestQuestion{}, err
	}
	acceptedEquivalentsJSON, err := marshalStringSlice(input.AcceptedEquivalents)
	if err != nil {
		return TestQuestion{}, err
	}
	gradingRubricJSON, err := marshalStringSlice(input.GradingRubric)
	if err != nil {
		return TestQuestion{}, err
	}
	kgGroundingJSON, err := marshalMap(input.KGGrounding)
	if err != nil {
		return TestQuestion{}, err
	}

	questionID := uuid.NewString()
	if _, err := tx.ExecContext(
		ctx,
		`insert into test_questions (
		   id, learner_id, topic_id, level,
		   question_format, question_text, options_json, expected_answer,
		   accepted_equivalents_json, grading_rubric_json, kg_grounding_json,
		   provider, model, prompt_tokens, completion_tokens, total_tokens,
		   status, failure_code, generated_at
		 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'answerable', '', ?)`,
		questionID,
		input.LearnerID,
		input.TopicID,
		input.Level,
		input.QuestionFormat,
		input.QuestionText,
		optionsJSON,
		input.ExpectedAnswer,
		acceptedEquivalentsJSON,
		gradingRubricJSON,
		kgGroundingJSON,
		input.Provider,
		input.Model,
		input.PromptTokens,
		input.CompletionTokens,
		input.TotalTokens,
		nowText,
	); err != nil {
		return TestQuestion{}, err
	}
	if _, err := tx.ExecContext(
		ctx,
		`update learner_topic_progress
		 set last_question_id = ?, updated_at = ?
		 where learner_id = ? and topic_id = ?`,
		questionID,
		nowText,
		input.LearnerID,
		input.TopicID,
	); err != nil {
		return TestQuestion{}, err
	}
	if err := tx.Commit(); err != nil {
		return TestQuestion{}, err
	}
	return s.GetTestQuestion(ctx, questionID)
}

func (s *SQLiteStore) CreateFailedTestQuestion(ctx context.Context, input CreateFailedTestQuestionInput) (TestQuestion, error) {
	questionID := uuid.NewString()
	now := formatStoreTime(time.Now())
	if _, err := s.db.ExecContext(
		ctx,
		`insert into test_questions (
		   id, learner_id, topic_id, level, provider, model,
		   prompt_tokens, completion_tokens, total_tokens,
		   status, failure_code, generated_at
		 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generation_failed', ?, ?)`,
		questionID,
		input.LearnerID,
		input.TopicID,
		input.Level,
		input.Provider,
		input.Model,
		input.PromptTokens,
		input.CompletionTokens,
		input.TotalTokens,
		input.FailureCode,
		now,
	); err != nil {
		return TestQuestion{}, err
	}
	return s.GetTestQuestion(ctx, questionID)
}

func (s *SQLiteStore) GetTestQuestion(ctx context.Context, questionID string) (TestQuestion, error) {
	question, found, err := getTestQuestion(ctx, s.db, questionID)
	if err != nil {
		return TestQuestion{}, err
	}
	if !found {
		return TestQuestion{}, ErrTestQuestionNotFound
	}
	return question, nil
}

func (s *SQLiteStore) GetTestAttemptByQuestion(ctx context.Context, questionID string) (TestAttemptResult, bool, error) {
	attempt, found, err := getTestAttemptByQuestion(ctx, s.db, questionID)
	if err != nil || !found {
		return TestAttemptResult{}, found, err
	}
	progress, progressFound, err := getLearnerTopicProgress(ctx, s.db, attempt.LearnerID, attempt.TopicID)
	if err != nil {
		return TestAttemptResult{}, false, err
	}
	if !progressFound {
		return TestAttemptResult{}, false, sql.ErrNoRows
	}
	return TestAttemptResult{Attempt: attempt, Progress: progress}, true, nil
}

func (s *SQLiteStore) ReserveTestAttempt(ctx context.Context, learnerID, questionID, submittedAnswer string) (TestAttemptReservation, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TestAttemptReservation{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	question, found, err := getTestQuestion(ctx, tx, questionID)
	if err != nil {
		return TestAttemptReservation{}, err
	}
	if !found {
		return TestAttemptReservation{}, ErrTestQuestionNotFound
	}
	if question.LearnerID != learnerID {
		return TestAttemptReservation{}, ErrTestQuestionForbidden
	}
	if question.Status != "answerable" {
		return TestAttemptReservation{}, ErrTestQuestionNotAnswerable
	}

	now := time.Now().UTC()
	if _, err := tx.ExecContext(
		ctx,
		`delete from test_attempt_reservations
		 where question_id=? and reserved_at<=?`,
		questionID,
		formatStoreTime(now.Add(-testAttemptReservationTTL)),
	); err != nil {
		return TestAttemptReservation{}, err
	}

	reservation := TestAttemptReservation{
		ID:              uuid.NewString(),
		QuestionID:      questionID,
		LearnerID:       learnerID,
		SubmittedAnswer: submittedAnswer,
		ReservedAt:      now,
	}
	result, err := tx.ExecContext(
		ctx,
		`insert into test_attempt_reservations (
		   id, question_id, learner_id, submitted_answer, reserved_at
		 ) values (?, ?, ?, ?, ?)
		 on conflict(question_id) do nothing`,
		reservation.ID,
		reservation.QuestionID,
		reservation.LearnerID,
		reservation.SubmittedAnswer,
		formatStoreTime(reservation.ReservedAt),
	)
	if err != nil {
		return TestAttemptReservation{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return TestAttemptReservation{}, err
	}
	if changed == 0 {
		return TestAttemptReservation{}, ErrTestAttemptInProgress
	}
	if err := tx.Commit(); err != nil {
		return TestAttemptReservation{}, err
	}
	return reservation, nil
}

func (s *SQLiteStore) ReleaseTestAttemptReservation(ctx context.Context, reservation TestAttemptReservation) error {
	_, err := s.db.ExecContext(
		ctx,
		`delete from test_attempt_reservations
		 where id=? and question_id=? and learner_id=?`,
		reservation.ID,
		reservation.QuestionID,
		reservation.LearnerID,
	)
	return err
}

func (s *SQLiteStore) RecordTestAttempt(ctx context.Context, input RecordTestAttemptInput) (TestAttemptResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TestAttemptResult{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if input.ReservationID != "" {
		var reservedAnswer string
		err := tx.QueryRowContext(
			ctx,
			`select submitted_answer from test_attempt_reservations
			 where id=? and question_id=? and learner_id=?`,
			input.ReservationID,
			input.QuestionID,
			input.LearnerID,
		).Scan(&reservedAnswer)
		if err == sql.ErrNoRows {
			return TestAttemptResult{}, ErrTestAttemptReservation
		}
		if err != nil {
			return TestAttemptResult{}, err
		}
		if reservedAnswer != input.SubmittedAnswer {
			return TestAttemptResult{}, ErrTestAttemptReservation
		}
	}

	statusResult, err := tx.ExecContext(
		ctx,
		`update test_questions set status='graded'
		 where id=? and learner_id=? and status='answerable'`,
		input.QuestionID,
		input.LearnerID,
	)
	if err != nil {
		return TestAttemptResult{}, err
	}
	changed, err := statusResult.RowsAffected()
	if err != nil {
		return TestAttemptResult{}, err
	}
	if changed == 0 {
		return existingOrRejectedAttempt(ctx, tx, input)
	}

	question, found, err := getTestQuestion(ctx, tx, input.QuestionID)
	if err != nil {
		return TestAttemptResult{}, err
	}
	if !found {
		return TestAttemptResult{}, ErrTestQuestionNotFound
	}
	progress, progressFound, err := getLearnerTopicProgress(ctx, tx, question.LearnerID, question.TopicID)
	if err != nil {
		return TestAttemptResult{}, err
	}
	if !progressFound {
		return TestAttemptResult{}, sql.ErrNoRows
	}

	now := time.Now().UTC()
	nowText := formatStoreTime(now)
	attemptID := newID("test-attempt")
	progressIncrement := 0
	if input.IsCorrect {
		progressResult, err := tx.ExecContext(
			ctx,
			`update learner_topic_progress
			 set score=score+1, last_completed_level=?, last_attempt_id=?, updated_at=?
			 where learner_id=? and topic_id=? and score=? and score<10`,
			question.Level,
			attemptID,
			nowText,
			question.LearnerID,
			question.TopicID,
			question.Level-1,
		)
		if err != nil {
			return TestAttemptResult{}, err
		}
		progressChanged, err := progressResult.RowsAffected()
		if err != nil {
			return TestAttemptResult{}, err
		}
		if progressChanged == 1 {
			progressIncrement = 1
		}
	} else {
		if _, err := tx.ExecContext(
			ctx,
			`update learner_topic_progress
			 set last_attempt_id=?, updated_at=?
			 where learner_id=? and topic_id=?`,
			attemptID,
			nowText,
			question.LearnerID,
			question.TopicID,
		); err != nil {
			return TestAttemptResult{}, err
		}
	}

	progressAfter := progress.Score + progressIncrement
	if _, err := tx.ExecContext(
		ctx,
		`insert into test_attempts (
		   id, question_id, learner_id, topic_id, submitted_answer,
		   is_correct, score, reason, feedback,
		   progress_before, progress_increment, progress_after,
		   provider, model, prompt_tokens, completion_tokens, total_tokens, submitted_at
		 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		attemptID,
		question.ID,
		question.LearnerID,
		question.TopicID,
		input.SubmittedAnswer,
		boolToInt(input.IsCorrect),
		input.Score,
		input.Reason,
		input.Feedback,
		progress.Score,
		progressIncrement,
		progressAfter,
		input.Provider,
		input.Model,
		input.PromptTokens,
		input.CompletionTokens,
		input.TotalTokens,
		nowText,
	); err != nil {
		return TestAttemptResult{}, err
	}
	if input.ReservationID != "" {
		result, err := tx.ExecContext(
			ctx,
			`delete from test_attempt_reservations
			 where id=? and question_id=? and learner_id=?`,
			input.ReservationID,
			input.QuestionID,
			input.LearnerID,
		)
		if err != nil {
			return TestAttemptResult{}, err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return TestAttemptResult{}, err
		}
		if changed != 1 {
			return TestAttemptResult{}, ErrTestAttemptReservation
		}
	}

	persistedProgress, found, err := getLearnerTopicProgress(ctx, tx, question.LearnerID, question.TopicID)
	if err != nil {
		return TestAttemptResult{}, err
	}
	if !found {
		return TestAttemptResult{}, sql.ErrNoRows
	}
	attempt := TestAttempt{
		ID:                attemptID,
		QuestionID:        question.ID,
		LearnerID:         question.LearnerID,
		TopicID:           question.TopicID,
		SubmittedAnswer:   input.SubmittedAnswer,
		IsCorrect:         input.IsCorrect,
		Score:             input.Score,
		Reason:            input.Reason,
		Feedback:          input.Feedback,
		ProgressBefore:    progress.Score,
		ProgressIncrement: progressIncrement,
		ProgressAfter:     progressAfter,
		Provider:          input.Provider,
		Model:             input.Model,
		PromptTokens:      input.PromptTokens,
		CompletionTokens:  input.CompletionTokens,
		TotalTokens:       input.TotalTokens,
		SubmittedAt:       now,
	}
	if err := tx.Commit(); err != nil {
		return TestAttemptResult{}, err
	}
	return TestAttemptResult{Attempt: attempt, Progress: persistedProgress}, nil
}

func existingOrRejectedAttempt(ctx context.Context, tx *sql.Tx, input RecordTestAttemptInput) (TestAttemptResult, error) {
	attempt, found, err := getTestAttemptByQuestion(ctx, tx, input.QuestionID)
	if err != nil {
		return TestAttemptResult{}, err
	}
	if found {
		if attempt.LearnerID != input.LearnerID {
			return TestAttemptResult{}, ErrTestQuestionForbidden
		}
		question, questionFound, err := getTestQuestion(ctx, tx, input.QuestionID)
		if err != nil {
			return TestAttemptResult{}, err
		}
		if !questionFound {
			return TestAttemptResult{}, ErrTestQuestionNotFound
		}
		if question.LearnerID != input.LearnerID {
			return TestAttemptResult{}, ErrTestQuestionForbidden
		}
		progress, progressFound, err := getLearnerTopicProgress(ctx, tx, attempt.LearnerID, attempt.TopicID)
		if err != nil {
			return TestAttemptResult{}, err
		}
		if !progressFound {
			return TestAttemptResult{}, sql.ErrNoRows
		}
		attempt.ProgressIncrement = 0
		return TestAttemptResult{Attempt: attempt, Progress: progress, Duplicate: true}, nil
	}

	question, found, err := getTestQuestion(ctx, tx, input.QuestionID)
	if err != nil {
		return TestAttemptResult{}, err
	}
	if !found {
		return TestAttemptResult{}, ErrTestQuestionNotFound
	}
	if question.LearnerID != input.LearnerID {
		return TestAttemptResult{}, ErrTestQuestionForbidden
	}
	return TestAttemptResult{}, ErrTestQuestionNotAnswerable
}

type testCenterScanner interface {
	Scan(dest ...any) error
}

type testCenterQueryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func getLearnerTopicProgress(ctx context.Context, queryer testCenterQueryer, learnerID, topicID string) (LearnerTopicProgress, bool, error) {
	progress, err := scanLearnerTopicProgress(queryer.QueryRowContext(
		ctx,
		`select learner_id, topic_id, score, last_completed_level,
		        coalesce(last_question_id, ''), coalesce(last_attempt_id, ''), created_at, updated_at
		 from learner_topic_progress
		 where learner_id = ? and topic_id = ?`,
		learnerID,
		topicID,
	))
	if err == sql.ErrNoRows {
		return LearnerTopicProgress{}, false, nil
	}
	if err != nil {
		return LearnerTopicProgress{}, false, err
	}
	return progress, true, nil
}

func getTestQuestion(ctx context.Context, queryer testCenterQueryer, questionID string) (TestQuestion, bool, error) {
	question, err := scanTestQuestion(queryer.QueryRowContext(
		ctx,
		`select `+testQuestionColumns+` from test_questions where id = ?`,
		questionID,
	))
	if err == sql.ErrNoRows {
		return TestQuestion{}, false, nil
	}
	if err != nil {
		return TestQuestion{}, false, err
	}
	return question, true, nil
}

func getTestAttemptByQuestion(ctx context.Context, queryer testCenterQueryer, questionID string) (TestAttempt, bool, error) {
	attempt, err := scanTestAttempt(queryer.QueryRowContext(
		ctx,
		`select `+testAttemptColumns+` from test_attempts where question_id = ?`,
		questionID,
	))
	if err == sql.ErrNoRows {
		return TestAttempt{}, false, nil
	}
	if err != nil {
		return TestAttempt{}, false, err
	}
	return attempt, true, nil
}

func scanLearnerTopicProgress(scanner testCenterScanner) (LearnerTopicProgress, error) {
	var progress LearnerTopicProgress
	var createdAt string
	var updatedAt string
	if err := scanner.Scan(
		&progress.LearnerID,
		&progress.TopicID,
		&progress.Score,
		&progress.LastCompletedLevel,
		&progress.LastQuestionID,
		&progress.LastAttemptID,
		&createdAt,
		&updatedAt,
	); err != nil {
		return LearnerTopicProgress{}, err
	}
	var err error
	progress.CreatedAt, err = parseStoreTime(createdAt)
	if err != nil {
		return LearnerTopicProgress{}, err
	}
	progress.UpdatedAt, err = parseStoreTime(updatedAt)
	if err != nil {
		return LearnerTopicProgress{}, err
	}
	return progress, nil
}

func scanTestQuestion(scanner testCenterScanner) (TestQuestion, error) {
	var question TestQuestion
	var optionsJSON string
	var acceptedEquivalentsJSON string
	var gradingRubricJSON string
	var kgGroundingJSON string
	var generatedAt string
	if err := scanner.Scan(
		&question.ID,
		&question.LearnerID,
		&question.TopicID,
		&question.Level,
		&question.QuestionFormat,
		&question.QuestionText,
		&optionsJSON,
		&question.ExpectedAnswer,
		&acceptedEquivalentsJSON,
		&gradingRubricJSON,
		&kgGroundingJSON,
		&question.Provider,
		&question.Model,
		&question.PromptTokens,
		&question.CompletionTokens,
		&question.TotalTokens,
		&question.Status,
		&question.FailureCode,
		&generatedAt,
	); err != nil {
		return TestQuestion{}, err
	}
	if err := json.Unmarshal([]byte(optionsJSON), &question.Options); err != nil {
		return TestQuestion{}, err
	}
	if err := json.Unmarshal([]byte(acceptedEquivalentsJSON), &question.AcceptedEquivalents); err != nil {
		return TestQuestion{}, err
	}
	if err := json.Unmarshal([]byte(gradingRubricJSON), &question.GradingRubric); err != nil {
		return TestQuestion{}, err
	}
	if err := json.Unmarshal([]byte(kgGroundingJSON), &question.KGGrounding); err != nil {
		return TestQuestion{}, err
	}
	var err error
	question.GeneratedAt, err = parseStoreTime(generatedAt)
	if err != nil {
		return TestQuestion{}, err
	}
	return question, nil
}

func scanTestAttempt(scanner testCenterScanner) (TestAttempt, error) {
	var attempt TestAttempt
	var isCorrect int
	var submittedAt string
	if err := scanner.Scan(
		&attempt.ID,
		&attempt.QuestionID,
		&attempt.LearnerID,
		&attempt.TopicID,
		&attempt.SubmittedAnswer,
		&isCorrect,
		&attempt.Score,
		&attempt.Reason,
		&attempt.Feedback,
		&attempt.ProgressBefore,
		&attempt.ProgressIncrement,
		&attempt.ProgressAfter,
		&attempt.Provider,
		&attempt.Model,
		&attempt.PromptTokens,
		&attempt.CompletionTokens,
		&attempt.TotalTokens,
		&submittedAt,
	); err != nil {
		return TestAttempt{}, err
	}
	attempt.IsCorrect = isCorrect != 0
	var err error
	attempt.SubmittedAt, err = parseStoreTime(submittedAt)
	if err != nil {
		return TestAttempt{}, err
	}
	return attempt, nil
}

func marshalStringSlice(values []string) (string, error) {
	if values == nil {
		values = []string{}
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func marshalMap(value map[string]any) (string, error) {
	if value == nil {
		value = map[string]any{}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
