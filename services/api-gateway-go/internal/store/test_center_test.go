package store

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMissingProgressReadDoesNotMaterializeRow(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	progress, found, err := store.GetLearnerTopicProgress(ctx, "learner-missing", "python-basics")
	if err != nil {
		t.Fatalf("get missing progress: %v", err)
	}
	if found || progress != (LearnerTopicProgress{}) {
		t.Fatalf("expected missing zero progress, got found=%v progress=%#v", found, progress)
	}

	progressRows, err := store.ListLearnerTopicProgress(ctx, "learner-missing")
	if err != nil {
		t.Fatalf("list missing progress: %v", err)
	}
	if len(progressRows) != 0 {
		t.Fatalf("expected no progress rows, got %#v", progressRows)
	}
	assertTableCount(t, store.db, "learner_topic_progress", 0)
}

func TestCreateTestQuestionInitializesZeroProgress(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	question, err := store.CreateTestQuestion(ctx, testQuestionInput("learner-create", "python-basics", 1))
	if err != nil {
		t.Fatalf("create test question: %v", err)
	}
	if question.ID == "" || question.Status != "answerable" || question.GeneratedAt.IsZero() {
		t.Fatalf("expected persisted answerable question, got %#v", question)
	}
	if _, err := uuid.Parse(question.ID); err != nil {
		t.Fatalf("expected question id to be a UUID, got %q: %v", question.ID, err)
	}

	progress, found, err := store.GetLearnerTopicProgress(ctx, question.LearnerID, question.TopicID)
	if err != nil {
		t.Fatalf("get initialized progress: %v", err)
	}
	if !found || progress.Score != 0 || progress.LastCompletedLevel != 0 || progress.LastQuestionID != question.ID {
		t.Fatalf("expected zero initialized progress linked to question, got found=%v progress=%#v", found, progress)
	}
	progressRows, err := store.ListLearnerTopicProgress(ctx, question.LearnerID)
	if err != nil {
		t.Fatalf("list initialized progress: %v", err)
	}
	if len(progressRows) != 1 || progressRows[0].TopicID != question.TopicID {
		t.Fatalf("expected one initialized topic, got %#v", progressRows)
	}
}

func TestCreateTestQuestionRejectsCompletedTopic(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	insertTestProgress(t, store, "learner-complete", "python-basics", 10)

	_, err := store.CreateTestQuestion(ctx, testQuestionInput("learner-complete", "python-basics", 10))
	if !errors.Is(err, ErrTestTopicCompleted) {
		t.Fatalf("expected ErrTestTopicCompleted, got %v", err)
	}
	assertTableCount(t, store.db, "test_questions", 0)
}

func TestCreateTestQuestionRejectsStaleLevel(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	_, err := store.CreateTestQuestion(ctx, testQuestionInput("learner-stale", "python-basics", 2))
	if !errors.Is(err, ErrTestLevelConflict) {
		t.Fatalf("expected ErrTestLevelConflict, got %v", err)
	}
	if _, found, err := store.GetLearnerTopicProgress(ctx, "learner-stale", "python-basics"); err != nil {
		t.Fatalf("get progress after rejected question: %v", err)
	} else if found {
		t.Fatal("rejected stale question must roll back progress initialization")
	}
	assertTableCount(t, store.db, "test_questions", 0)
}

func TestIncorrectAttemptGradesQuestionWithoutIncrement(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	question := mustCreateTestQuestion(t, store, "learner-incorrect", "python-basics", 1)

	result, err := store.RecordTestAttempt(ctx, testAttemptInput(question, false))
	if err != nil {
		t.Fatalf("record incorrect attempt: %v", err)
	}
	if result.Duplicate || result.Attempt.ID == "" {
		t.Fatalf("expected new persisted attempt, got %#v", result)
	}
	if result.Attempt.ProgressBefore != 0 || result.Attempt.ProgressIncrement != 0 || result.Attempt.ProgressAfter != 0 {
		t.Fatalf("incorrect attempt must not increment progress, got %#v", result.Attempt)
	}
	if result.Progress.Score != 0 || result.Progress.LastAttemptID != result.Attempt.ID {
		t.Fatalf("expected zero progress linked to attempt, got %#v", result.Progress)
	}

	persisted, found, err := store.GetTestAttemptByQuestion(ctx, question.ID)
	if err != nil {
		t.Fatalf("get attempt by question: %v", err)
	}
	if !found || persisted.Attempt.ID != result.Attempt.ID || persisted.Duplicate {
		t.Fatalf("expected persisted non-duplicate attempt, got found=%v result=%#v", found, persisted)
	}
	assertQuestionStatus(t, store, question.ID, "graded")
}

func TestCorrectAttemptIncrementsExactlyOnce(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	question := mustCreateTestQuestion(t, store, "learner-correct", "python-basics", 1)

	result, err := store.RecordTestAttempt(ctx, testAttemptInput(question, true))
	if err != nil {
		t.Fatalf("record correct attempt: %v", err)
	}
	if result.Attempt.ProgressBefore != 0 || result.Attempt.ProgressIncrement != 1 || result.Attempt.ProgressAfter != 1 {
		t.Fatalf("correct attempt must increment once, got %#v", result.Attempt)
	}
	if result.Progress.Score != 1 || result.Progress.LastCompletedLevel != 1 || result.Progress.LastAttemptID != result.Attempt.ID {
		t.Fatalf("expected level-one progress, got %#v", result.Progress)
	}
	assertQuestionStatus(t, store, question.ID, "graded")
}

func TestDuplicateSubmissionReturnsSameAttemptID(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	question := mustCreateTestQuestion(t, store, "learner-duplicate", "python-basics", 1)
	input := testAttemptInput(question, true)

	first, err := store.RecordTestAttempt(ctx, input)
	if err != nil {
		t.Fatalf("record first attempt: %v", err)
	}
	second, err := store.RecordTestAttempt(ctx, input)
	if err != nil {
		t.Fatalf("record duplicate attempt: %v", err)
	}
	if second.Attempt.ID != first.Attempt.ID || !second.Duplicate {
		t.Fatalf("expected duplicate with same attempt id, first=%#v second=%#v", first, second)
	}
	if second.Attempt.ProgressIncrement != 0 {
		t.Fatalf("duplicate response must report no new increment, first=%#v second=%#v", first, second)
	}
	progress, found, err := store.GetLearnerTopicProgress(ctx, question.LearnerID, question.TopicID)
	if err != nil || !found {
		t.Fatalf("get progress after duplicate: found=%v err=%v", found, err)
	}
	if progress.Score != 1 {
		t.Fatalf("duplicate must not increment persisted progress twice, got %#v", progress)
	}
	assertTableCount(t, store.db, "test_attempts", 1)
}

func TestConcurrentSameQuestionIncrementsOnce(t *testing.T) {
	store := openTestStore(t)
	question := mustCreateTestQuestion(t, store, "learner-same", "python-basics", 1)
	input := testAttemptInput(question, true)

	results, errs := runConcurrentAttempts(store, input, input)
	for index, err := range errs {
		if err != nil {
			t.Fatalf("concurrent attempt %d: %v", index, err)
		}
	}
	if results[0].Attempt.ID == "" || results[0].Attempt.ID != results[1].Attempt.ID {
		t.Fatalf("same-question attempts must return the same attempt id, got %#v", results)
	}
	actualIncrement := persistedIncrementSum(results)
	if actualIncrement != 1 {
		t.Fatalf("same-question concurrent increment sum must be one, got %d from %#v", actualIncrement, results)
	}
	assertTableCount(t, store.db, "test_attempts", 1)
}

func TestConcurrentTestAttemptReservationsAcceptExactlyOneFirstSubmission(t *testing.T) {
	store := openTestStore(t)
	question := mustCreateTestQuestion(t, store, "learner-reserve", "python-basics", 1)
	answers := []string{"first candidate", "second candidate"}
	reservations := make([]TestAttemptReservation, len(answers))
	errs := make([]error, len(answers))
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	waitGroup.Add(len(answers))
	for index := range answers {
		index := index
		go func() {
			defer waitGroup.Done()
			<-start
			reservations[index], errs[index] = store.ReserveTestAttempt(
				context.Background(), question.LearnerID, question.ID, answers[index],
			)
		}()
	}
	close(start)
	waitGroup.Wait()

	winner := -1
	for index, err := range errs {
		switch {
		case err == nil:
			if winner != -1 {
				t.Fatalf("more than one reservation succeeded: %#v %#v", reservations, errs)
			}
			winner = index
		case errors.Is(err, ErrTestAttemptInProgress):
		default:
			t.Fatalf("reservation %d returned unexpected error: %v", index, err)
		}
	}
	if winner == -1 || reservations[winner].SubmittedAnswer != answers[winner] {
		t.Fatalf("missing winning reservation: winner=%d reservations=%#v", winner, reservations)
	}
	assertTableCount(t, store.db, "test_attempt_reservations", 1)
	assertQuestionStatus(t, store, question.ID, "answerable")
}

func TestReleaseTestAttemptReservationAllowsRetry(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	question := mustCreateTestQuestion(t, store, "learner-release", "python-basics", 1)
	first, err := store.ReserveTestAttempt(ctx, question.LearnerID, question.ID, "first answer")
	if err != nil {
		t.Fatalf("reserve first attempt: %v", err)
	}
	if _, err := store.ReserveTestAttempt(ctx, question.LearnerID, question.ID, "blocked answer"); !errors.Is(err, ErrTestAttemptInProgress) {
		t.Fatalf("expected in-progress error, got %v", err)
	}
	if err := store.ReleaseTestAttemptReservation(ctx, first); err != nil {
		t.Fatalf("release first reservation: %v", err)
	}
	second, err := store.ReserveTestAttempt(ctx, question.LearnerID, question.ID, "retry answer")
	if err != nil {
		t.Fatalf("reserve retry: %v", err)
	}
	if second.ID == first.ID || second.SubmittedAnswer != "retry answer" {
		t.Fatalf("unexpected retry reservation: first=%#v second=%#v", first, second)
	}
}

func TestExpiredTestAttemptReservationAllowsRetry(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	question := mustCreateTestQuestion(t, store, "learner-expired", "python-basics", 1)
	first, err := store.ReserveTestAttempt(ctx, question.LearnerID, question.ID, "abandoned answer")
	if err != nil {
		t.Fatalf("reserve abandoned attempt: %v", err)
	}
	if _, err := store.db.ExecContext(
		ctx,
		`update test_attempt_reservations set reserved_at=? where id=?`,
		formatStoreTime(time.Now().UTC().Add(-testAttemptReservationTTL-time.Second)),
		first.ID,
	); err != nil {
		t.Fatalf("expire reservation: %v", err)
	}

	second, err := store.ReserveTestAttempt(ctx, question.LearnerID, question.ID, "replacement answer")
	if err != nil {
		t.Fatalf("reserve after expiration: %v", err)
	}
	if second.ID == first.ID || second.SubmittedAnswer != "replacement answer" {
		t.Fatalf("unexpected replacement reservation: first=%#v second=%#v", first, second)
	}
	assertTableCount(t, store.db, "test_attempt_reservations", 1)
}

func TestReservedAttemptOnlyRecordsWinningSubmittedAnswer(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	question := mustCreateTestQuestion(t, store, "learner-winning-answer", "python-basics", 1)
	reservation, err := store.ReserveTestAttempt(ctx, question.LearnerID, question.ID, "3")
	if err != nil {
		t.Fatalf("reserve incorrect first answer: %v", err)
	}

	laterCorrect := testAttemptInput(question, true)
	laterCorrect.ReservationID = reservation.ID
	if _, err := store.RecordTestAttempt(ctx, laterCorrect); !errors.Is(err, ErrTestAttemptReservation) {
		t.Fatalf("expected mismatched submitted answer to be rejected, got %v", err)
	}

	firstIncorrect := testAttemptInput(question, false)
	firstIncorrect.ReservationID = reservation.ID
	result, err := store.RecordTestAttempt(ctx, firstIncorrect)
	if err != nil {
		t.Fatalf("record reserved first answer: %v", err)
	}
	if result.Attempt.SubmittedAnswer != "3" || result.Attempt.ProgressIncrement != 0 || result.Progress.Score != 0 {
		t.Fatalf("first reserved incorrect answer must win without progress: %#v", result)
	}
	assertTableCount(t, store.db, "test_attempt_reservations", 0)
}

func TestConcurrentDifferentQuestionsAtSameLevelIncrementsOnce(t *testing.T) {
	store := openTestStore(t)
	firstQuestion := mustCreateTestQuestion(t, store, "learner-different", "python-basics", 1)
	secondQuestion := mustCreateTestQuestion(t, store, "learner-different", "python-basics", 1)

	results, errs := runConcurrentAttempts(
		store,
		testAttemptInput(firstQuestion, true),
		testAttemptInput(secondQuestion, true),
	)
	for index, err := range errs {
		if err != nil {
			t.Fatalf("concurrent attempt %d: %v", index, err)
		}
	}
	actualIncrement := persistedIncrementSum(results)
	if actualIncrement != 1 {
		t.Fatalf("same-level concurrent increment sum must be one, got %d from %#v", actualIncrement, results)
	}
	if results[0].Attempt.ID == results[1].Attempt.ID {
		t.Fatalf("different questions must persist different attempts, got %#v", results)
	}
	progress, found, err := store.GetLearnerTopicProgress(context.Background(), "learner-different", "python-basics")
	if err != nil || !found {
		t.Fatalf("get concurrent progress: found=%v err=%v", found, err)
	}
	if progress.Score != 1 {
		t.Fatalf("expected persisted progress one, got %#v", progress)
	}
}

func TestProgressStopsAtTen(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	insertTestProgress(t, store, "learner-ten", "python-basics", 9)
	firstQuestion := mustCreateTestQuestion(t, store, "learner-ten", "python-basics", 10)
	secondQuestion := mustCreateTestQuestion(t, store, "learner-ten", "python-basics", 10)

	first, err := store.RecordTestAttempt(ctx, testAttemptInput(firstQuestion, true))
	if err != nil {
		t.Fatalf("record first level-ten attempt: %v", err)
	}
	second, err := store.RecordTestAttempt(ctx, testAttemptInput(secondQuestion, true))
	if err != nil {
		t.Fatalf("record second level-ten attempt: %v", err)
	}
	if first.Attempt.ProgressIncrement+second.Attempt.ProgressIncrement != 1 {
		t.Fatalf("level ten must be awarded once, first=%#v second=%#v", first, second)
	}
	progress, found, err := store.GetLearnerTopicProgress(ctx, "learner-ten", "python-basics")
	if err != nil || !found {
		t.Fatalf("get completed progress: found=%v err=%v", found, err)
	}
	if progress.Score != 10 || progress.LastCompletedLevel != 10 {
		t.Fatalf("expected progress capped at ten, got %#v", progress)
	}
	if _, err := store.CreateTestQuestion(ctx, testQuestionInput("learner-ten", "python-basics", 10)); !errors.Is(err, ErrTestTopicCompleted) {
		t.Fatalf("expected completed topic to reject more questions, got %v", err)
	}
}

func TestPrivateQuestionFieldsRoundTripOnlyThroughStore(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := testQuestionInput("learner-private", "python-basics", 1)

	created, err := store.CreateTestQuestion(ctx, input)
	if err != nil {
		t.Fatalf("create private-field question: %v", err)
	}
	persisted, err := store.GetTestQuestion(ctx, created.ID)
	if err != nil {
		t.Fatalf("get private-field question: %v", err)
	}
	assertPrivateQuestionFields(t, persisted, input)

	recent, err := store.ListRecentTestQuestions(ctx, input.LearnerID, input.TopicID, 10)
	if err != nil {
		t.Fatalf("list recent questions: %v", err)
	}
	if len(recent) != 1 || recent[0].ID != created.ID {
		t.Fatalf("expected created question in recent list, got %#v", recent)
	}
	assertPrivateQuestionFields(t, recent[0], input)
}

func TestCreateFailedTestQuestionDoesNotMaterializeProgress(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	question, err := store.CreateFailedTestQuestion(ctx, CreateFailedTestQuestionInput{
		LearnerID:        "learner-generation-failed",
		TopicID:          "python-basics",
		Level:            1,
		FailureCode:      "provider_timeout",
		Provider:         "test-provider",
		Model:            "test-model",
		PromptTokens:     5,
		CompletionTokens: 0,
		TotalTokens:      5,
	})
	if err != nil {
		t.Fatalf("create failed question: %v", err)
	}
	if question.Status != "generation_failed" || question.FailureCode != "provider_timeout" {
		t.Fatalf("expected generation failure metadata, got %#v", question)
	}
	if _, err := uuid.Parse(question.ID); err != nil {
		t.Fatalf("expected failed question id to be a UUID, got %q: %v", question.ID, err)
	}
	if question.QuestionText != "" || question.ExpectedAnswer != "" || len(question.Options) != 0 || len(question.KGGrounding) != 0 {
		t.Fatalf("failed question must have empty payload fields, got %#v", question)
	}
	if _, found, err := store.GetLearnerTopicProgress(ctx, question.LearnerID, question.TopicID); err != nil {
		t.Fatalf("get progress after failed generation: %v", err)
	} else if found {
		t.Fatal("failed generation must not materialize progress")
	}
}

func TestRecordTestAttemptDistinguishesMissingForbiddenAndNotAnswerable(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	ownedQuestion := mustCreateTestQuestion(t, store, "learner-owner", "python-basics", 1)

	forbiddenInput := testAttemptInput(ownedQuestion, true)
	forbiddenInput.LearnerID = "learner-intruder"
	if _, err := store.RecordTestAttempt(ctx, forbiddenInput); !errors.Is(err, ErrTestQuestionForbidden) {
		t.Fatalf("expected forbidden for another learner's question, got %v", err)
	}
	if _, err := store.RecordTestAttempt(ctx, RecordTestAttemptInput{
		LearnerID:  "learner-owner",
		QuestionID: "question-missing",
	}); !errors.Is(err, ErrTestQuestionNotFound) {
		t.Fatalf("expected not found for missing question, got %v", err)
	}

	failedQuestion, err := store.CreateFailedTestQuestion(ctx, CreateFailedTestQuestionInput{
		LearnerID:   "learner-owner",
		TopicID:     "python-basics",
		Level:       1,
		FailureCode: "generation_failed",
	})
	if err != nil {
		t.Fatalf("create failed question: %v", err)
	}
	notAnswerableInput := testAttemptInput(failedQuestion, false)
	if _, err := store.RecordTestAttempt(ctx, notAnswerableInput); !errors.Is(err, ErrTestQuestionNotAnswerable) {
		t.Fatalf("expected not answerable for failed question, got %v", err)
	}
	if _, err := store.GetTestQuestion(ctx, "question-missing"); !errors.Is(err, ErrTestQuestionNotFound) {
		t.Fatalf("expected missing question lookup to return not found, got %v", err)
	}
}

func TestDuplicateSubmissionRejectsMismatchedQuestionOwner(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	insertTestProgress(t, store, "learner-attempt-owner", "python-basics", 0)

	if _, err := store.db.Exec(`
		insert into test_questions (
			id, learner_id, topic_id, level, status, generated_at
		) values (
			'question-owned-by-other', 'learner-question-owner', 'python-basics', 1,
			'graded', '2026-07-14T00:00:00Z'
		)
	`); err != nil {
		t.Fatalf("insert mismatched-owner question: %v", err)
	}
	if _, err := store.db.Exec(`
		insert into test_attempts (
			id, question_id, learner_id, topic_id, submitted_answer, is_correct, score,
			reason, feedback, progress_before, progress_increment, progress_after, submitted_at
		) values (
			'attempt-owned-by-caller', 'question-owned-by-other', 'learner-attempt-owner',
			'python-basics', '2', 1, 1, 'correct', 'good', 0, 1, 1,
			'2026-07-14T00:01:00Z'
		)
	`); err != nil {
		t.Fatalf("insert mismatched-owner attempt: %v", err)
	}

	_, err := store.RecordTestAttempt(ctx, RecordTestAttemptInput{
		LearnerID:  "learner-attempt-owner",
		QuestionID: "question-owned-by-other",
	})
	if !errors.Is(err, ErrTestQuestionForbidden) {
		t.Fatalf("expected forbidden when question belongs to another learner, got %v", err)
	}
}

func testQuestionInput(learnerID, topicID string, level int) CreateTestQuestionInput {
	return CreateTestQuestionInput{
		LearnerID:           learnerID,
		TopicID:             topicID,
		Level:               level,
		QuestionFormat:      "multiple_choice",
		QuestionText:        "What is the value of len([1, 2])?",
		Options:             []string{"1", "2", "3"},
		ExpectedAnswer:      "2",
		AcceptedEquivalents: []string{"two"},
		GradingRubric:       []string{"Answer equals 2"},
		KGGrounding: map[string]any{
			"concept": "python-list-length",
			"paths":   []any{"Python", "List", "len"},
		},
		Provider:         "test-provider",
		Model:            "test-model",
		PromptTokens:     10,
		CompletionTokens: 20,
		TotalTokens:      30,
	}
}

func testAttemptInput(question TestQuestion, correct bool) RecordTestAttemptInput {
	score := 0.25
	answer := "3"
	reason := "answer is not the list length"
	feedback := "Review how len counts items."
	if correct {
		score = 1
		answer = "2"
		reason = "answer matches expected value"
		feedback = "Correct."
	}
	return RecordTestAttemptInput{
		LearnerID:        question.LearnerID,
		QuestionID:       question.ID,
		SubmittedAnswer:  answer,
		IsCorrect:        correct,
		Score:            score,
		Reason:           reason,
		Feedback:         feedback,
		Provider:         "grading-provider",
		Model:            "grading-model",
		PromptTokens:     4,
		CompletionTokens: 6,
		TotalTokens:      10,
	}
}

func mustCreateTestQuestion(t *testing.T, store *SQLiteStore, learnerID, topicID string, level int) TestQuestion {
	t.Helper()
	question, err := store.CreateTestQuestion(context.Background(), testQuestionInput(learnerID, topicID, level))
	if err != nil {
		t.Fatalf("create test question: %v", err)
	}
	return question
}

func insertTestProgress(t *testing.T, store *SQLiteStore, learnerID, topicID string, score int) {
	t.Helper()
	if _, err := store.db.Exec(`
		insert into learner_topic_progress (
			learner_id, topic_id, score, last_completed_level, created_at, updated_at
		) values (?, ?, ?, ?, '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z')
	`, learnerID, topicID, score, score); err != nil {
		t.Fatalf("insert progress: %v", err)
	}
}

func runConcurrentAttempts(store *SQLiteStore, inputs ...RecordTestAttemptInput) ([]TestAttemptResult, []error) {
	results := make([]TestAttemptResult, len(inputs))
	errs := make([]error, len(inputs))
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	waitGroup.Add(len(inputs))
	for index := range inputs {
		index := index
		go func() {
			defer waitGroup.Done()
			<-start
			results[index], errs[index] = store.RecordTestAttempt(context.Background(), inputs[index])
		}()
	}
	close(start)
	waitGroup.Wait()
	return results, errs
}

func persistedIncrementSum(results []TestAttemptResult) int {
	total := 0
	for _, result := range results {
		total += result.Attempt.ProgressIncrement
	}
	return total
}

func assertQuestionStatus(t *testing.T, store *SQLiteStore, questionID, expected string) {
	t.Helper()
	var actual string
	if err := store.db.QueryRow(`select status from test_questions where id = ?`, questionID).Scan(&actual); err != nil {
		t.Fatalf("query question status: %v", err)
	}
	if actual != expected {
		t.Fatalf("expected question status %q, got %q", expected, actual)
	}
}

func assertPrivateQuestionFields(t *testing.T, actual TestQuestion, expected CreateTestQuestionInput) {
	t.Helper()
	if actual.QuestionFormat != expected.QuestionFormat || actual.QuestionText != expected.QuestionText ||
		actual.ExpectedAnswer != expected.ExpectedAnswer || !reflect.DeepEqual(actual.Options, expected.Options) ||
		!reflect.DeepEqual(actual.AcceptedEquivalents, expected.AcceptedEquivalents) ||
		!reflect.DeepEqual(actual.GradingRubric, expected.GradingRubric) ||
		!reflect.DeepEqual(actual.KGGrounding, expected.KGGrounding) {
		t.Fatalf("private question fields did not round trip: actual=%#v expected=%#v", actual, expected)
	}
}
