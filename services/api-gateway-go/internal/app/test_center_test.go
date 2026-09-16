package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"responsible-edu-agent/services/api-gateway-go/internal/store"

	"github.com/zeromicro/go-zero/rest/pathvar"
)

func TestTestAnswerReturnsStoredAttemptWithoutJudgeCall(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
		http.Error(response, "unexpected judge call", http.StatusInternalServerError)
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{
		testAttemptFound: true,
		testAttemptResult: store.TestAttemptResult{
			Attempt: store.TestAttempt{
				ID: "attempt-existing", QuestionID: "question-answer", LearnerID: "learner-answer",
				TopicID: "loops_iteration", IsCorrect: true, Feedback: "Good reasoning.", Reason: "Private judge reason",
			},
			Progress: store.LearnerTopicProgress{LearnerID: "learner-answer", TopicID: "loops_iteration", Score: 5},
		},
	}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "0 1 2",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	assertPublicTestAnswer(t, response.Body.Bytes(), "attempt-existing", "question-answer", true, "Good reasoning.", 5, true)
	if aiCalls.Load() != 0 || sessionStore.tokenBudgetLookups != 0 || sessionStore.testQuestionLookups != 0 || len(sessionStore.recordedTestAttempts) != 0 {
		t.Fatalf("duplicate reached later dependencies: ai=%d budget=%d question=%d recorded=%d", aiCalls.Load(), sessionStore.tokenBudgetLookups, sessionStore.testQuestionLookups, len(sessionStore.recordedTestAttempts))
	}
}

func TestTestAnswerMapsAttemptAndQuestionOwnershipToForbidden(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
	}))
	defer aiCore.Close()

	t.Run("existing attempt belongs to another learner", func(t *testing.T) {
		sessionStore := &fakeSessionStore{
			testAttemptFound: true,
			testAttemptResult: store.TestAttemptResult{Attempt: store.TestAttempt{
				ID: "attempt-other", QuestionID: "question-answer", LearnerID: "other-learner",
			}},
		}
		response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
			"learner_id": "learner-answer", "question_id": "question-answer", "answer": "answer",
		})

		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"error":"test_question_forbidden"`) {
			t.Fatalf("response = %d %s, want forbidden", response.Code, response.Body.String())
		}
		if sessionStore.testQuestionLookups != 0 || sessionStore.tokenBudgetLookups != 0 {
			t.Fatalf("attempt owner mismatch reached question/budget: %d/%d", sessionStore.testQuestionLookups, sessionStore.tokenBudgetLookups)
		}
	})

	t.Run("question belongs to another learner", func(t *testing.T) {
		sessionStore := &fakeSessionStore{testQuestion: privateAnswerableQuestion("other-learner")}
		response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
			"learner_id": "learner-answer", "question_id": "question-answer", "answer": "answer",
		})

		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"error":"test_question_forbidden"`) {
			t.Fatalf("response = %d %s, want forbidden", response.Code, response.Body.String())
		}
		if sessionStore.tokenBudgetLookups != 0 {
			t.Fatalf("question owner mismatch made %d budget lookups", sessionStore.tokenBudgetLookups)
		}
	})
	if aiCalls.Load() != 0 {
		t.Fatalf("ownership checks made %d AI calls", aiCalls.Load())
	}
}

func TestTestAnswerMapsUnknownAndNonAnswerableQuestions(t *testing.T) {
	tests := []struct {
		name       string
		question   store.TestQuestion
		lookupErr  error
		wantStatus int
		wantError  string
	}{
		{name: "unknown", lookupErr: store.ErrTestQuestionNotFound, wantStatus: http.StatusNotFound, wantError: "test_question_not_found"},
		{name: "graded", question: withQuestionStatus(privateAnswerableQuestion("learner-answer"), "graded"), wantStatus: http.StatusConflict, wantError: "test_question_not_answerable"},
		{name: "generation failed", question: withQuestionStatus(privateAnswerableQuestion("learner-answer"), "generation_failed"), wantStatus: http.StatusConflict, wantError: "test_question_not_answerable"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sessionStore := &fakeSessionStore{testQuestion: test.question, testQuestionErr: test.lookupErr}
			response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore}), map[string]any{
				"learner_id": "learner-answer", "question_id": "question-answer", "answer": "answer",
			})

			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), `"error":"`+test.wantError+`"`) {
				t.Fatalf("response = %d %s, want %d %s", response.Code, response.Body.String(), test.wantStatus, test.wantError)
			}
			if sessionStore.tokenBudgetLookups != 0 || len(sessionStore.recordedTestAttempts) != 0 {
				t.Fatalf("invalid question reached budget/record: %d/%d", sessionStore.tokenBudgetLookups, len(sessionStore.recordedTestAttempts))
			}
		})
	}
}

func TestTestAnswerZeroBudgetRemainsAvailableWithoutDebit(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
		writeJSON(response, http.StatusOK, successfulJudgmentPayload(true, 1, 321))
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{
		testQuestion: privateAnswerableQuestion("learner-answer"),
		tokenBudget:  store.TokenBudget{Scope: store.TokenBudgetScope, DailyQuota: 100, UsedTokens: 100, RemainingTokens: 0},
		testAttemptResult: store.TestAttemptResult{
			Attempt: store.TestAttempt{
				ID: "attempt-zero-budget", QuestionID: "question-answer", LearnerID: "learner-answer",
				TopicID: "loops_iteration", IsCorrect: true, Feedback: "Correct reasoning.", ProgressIncrement: 1,
			},
			Progress: store.LearnerTopicProgress{LearnerID: "learner-answer", TopicID: "loops_iteration", Score: 5},
		},
	}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "answer",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	if aiCalls.Load() != 1 || sessionStore.tokenBudgetLookups != 0 || sessionStore.recordedTokenUsage != 0 || len(sessionStore.recordedTestAttempts) != 1 {
		t.Fatalf("judge calls=%d budget reads=%d debited=%d recorded=%d, want 1/0/0/1", aiCalls.Load(), sessionStore.tokenBudgetLookups, sessionStore.recordedTokenUsage, len(sessionStore.recordedTestAttempts))
	}
	recorded := sessionStore.recordedTestAttempts[0]
	if recorded.Provider != "dashscope" || recorded.Model != "qwen-judge" || recorded.PromptTokens != 6 || recorded.CompletionTokens != 315 || recorded.TotalTokens != 321 {
		t.Fatalf("persisted judge usage = %#v", recorded)
	}
}

func TestTestAnswerRejectsConcurrentSubmissionBeforeJudgeCall(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{
		testQuestion:          privateAnswerableQuestion("learner-answer"),
		reserveTestAttemptErr: store.ErrTestAttemptInProgress,
	}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "later answer",
	})

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"error":"test_attempt_in_progress"`) || !strings.Contains(response.Body.String(), `"retryable":true`) {
		t.Fatalf("response = %d %s, want retryable in-progress conflict", response.Code, response.Body.String())
	}
	if aiCalls.Load() != 0 || len(sessionStore.recordedTestAttempts) != 0 {
		t.Fatalf("reserved question reached judge/record: ai=%d recorded=%d", aiCalls.Load(), len(sessionStore.recordedTestAttempts))
	}
}

func TestTestAnswerUsesPersistedPrivateFields(t *testing.T) {
	var received map[string]any
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/tests/judge" || request.Method != http.MethodPost {
			t.Errorf("judge request = %s %s", request.Method, request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Errorf("decode judge request: %v", err)
		}
		writeJSON(response, http.StatusOK, successfulJudgmentPayload(false, 0.25, 14))
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{
		testQuestion: privateAnswerableQuestion("learner-answer"),
		testAttemptResult: store.TestAttemptResult{
			Attempt:  store.TestAttempt{ID: "attempt-new", QuestionID: "question-answer", LearnerID: "learner-answer", IsCorrect: false, Feedback: "Review how range stops before its endpoint."},
			Progress: store.LearnerTopicProgress{LearnerID: "learner-answer", TopicID: "loops_iteration", Score: 4},
		},
	}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "1 2 3",
		"expected_answer": "browser fake", "accepted_equivalents": []string{"browser fake"},
		"grading_rubric": []string{"browser fake"}, "is_correct": true, "score": 1, "reason": "browser fake",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	wantQuestion := privateAnswerableQuestion("learner-answer")
	if len(received) != 9 || received["topic_id"] != wantQuestion.TopicID || int(received["level"].(float64)) != wantQuestion.Level || received["question_format"] != wantQuestion.QuestionFormat || received["question_text"] != wantQuestion.QuestionText || received["expected_answer"] != wantQuestion.ExpectedAnswer || received["student_answer"] != "1 2 3" {
		t.Fatalf("judge request = %#v", received)
	}
	if strings.Contains(mustJSON(t, received), "browser fake") {
		t.Fatalf("judge request trusted browser private fields: %#v", received)
	}
	if len(sessionStore.recordedTestAttempts) != 1 {
		t.Fatalf("recorded attempts = %d, want 1", len(sessionStore.recordedTestAttempts))
	}
	recorded := sessionStore.recordedTestAttempts[0]
	if recorded.LearnerID != "learner-answer" || recorded.QuestionID != "question-answer" || recorded.ReservationID != "reservation-test" || recorded.SubmittedAnswer != "1 2 3" || recorded.IsCorrect || recorded.Score != 0.25 || recorded.Reason != "The expected output differs." || recorded.Feedback != "Review how range stops before its endpoint." || recorded.Provider != "dashscope" || recorded.Model != "qwen-judge" || recorded.TotalTokens != 14 {
		t.Fatalf("recorded judge result = %#v", recorded)
	}
	assertNoPrivateTestFields(t, response.Body.String())
}

func TestTestAnswerRetriesTransientJudgingFailure(t *testing.T) {
	var judgeCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if calls := judgeCalls.Add(1); calls == 1 {
			writeJSON(response, http.StatusBadGateway, map[string]any{"error": "judging_failed"})
			return
		}
		writeJSON(response, http.StatusOK, successfulJudgmentPayload(true, 1, 13))
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{
		testQuestion: privateAnswerableQuestion("learner-answer"),
		testAttemptResult: store.TestAttemptResult{
			Attempt:  store.TestAttempt{ID: "attempt-recovered", QuestionID: "question-answer", LearnerID: "learner-answer", IsCorrect: true, Feedback: "Correct reasoning."},
			Progress: store.LearnerTopicProgress{LearnerID: "learner-answer", TopicID: "loops_iteration", Score: 5},
		},
	}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "0 1 2",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	if judgeCalls.Load() != 2 || len(sessionStore.recordedTestAttempts) != 1 {
		t.Fatalf("judge calls=%d attempts=%d, want 2/1", judgeCalls.Load(), len(sessionStore.recordedTestAttempts))
	}
}

func TestTestAnswerTerminalJudgingFailureLeavesQuestionAnswerable(t *testing.T) {
	var judgeCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		judgeCalls.Add(1)
		writeJSON(response, http.StatusBadGateway, map[string]any{
			"error": "judging_failed", "provider": "dashscope", "model": "qwen-repair",
			"validation_errors": []string{"feedback must contain an ASCII letter"},
			"token_usage":       map[string]any{"prompt_tokens": 8, "completion_tokens": 5, "total_tokens": 13, "usage_unavailable": false},
		})
	}))
	defer aiCore.Close()
	question := privateAnswerableQuestion("learner-answer")
	sessionStore := &fakeSessionStore{testQuestion: question}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "1 2 3",
	})

	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), `"error":"answer_evaluation_unavailable"`) || !strings.Contains(response.Body.String(), `"retryable":true`) {
		t.Fatalf("response = %d %s, want retryable judging failure", response.Code, response.Body.String())
	}
	if judgeCalls.Load() != 2 || sessionStore.recordedTokenUsage != 0 || len(sessionStore.recordedTestAttempts) != 0 || sessionStore.testQuestion.Status != "answerable" || sessionStore.releasedTestReservations != 1 {
		t.Fatalf("calls=%d usage=%d recorded=%d status=%q releases=%d", judgeCalls.Load(), sessionStore.recordedTokenUsage, len(sessionStore.recordedTestAttempts), sessionStore.testQuestion.Status, sessionStore.releasedTestReservations)
	}
	assertNoPrivateTestFields(t, response.Body.String())
}

func TestTestAnswerRecordsUsageAndCorrectIncrement(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, successfulJudgmentPayload(true, 1, 21))
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{
		testQuestion: privateAnswerableQuestion("learner-answer"),
		testAttemptResult: store.TestAttemptResult{
			Attempt:  store.TestAttempt{ID: "attempt-correct", QuestionID: "question-answer", LearnerID: "learner-answer", IsCorrect: true, Feedback: "Correct reasoning.", ProgressIncrement: 1},
			Progress: store.LearnerTopicProgress{LearnerID: "learner-answer", TopicID: "loops_iteration", Score: 5},
		},
	}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "0 1 2", "progress_increment": 9,
	})

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	if sessionStore.recordedTokenUsage != 0 || len(sessionStore.recordedTestAttempts) != 1 || !sessionStore.recordedTestAttempts[0].IsCorrect {
		t.Fatalf("usage=%d attempts=%#v", sessionStore.recordedTokenUsage, sessionStore.recordedTestAttempts)
	}
	assertPublicTestAnswer(t, response.Body.Bytes(), "attempt-correct", "question-answer", true, "Correct reasoning.", 5, false)
}

func TestTestAnswerIncorrectIncrementIsZero(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, successfulJudgmentPayload(false, 0, 11))
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{
		testQuestion: privateAnswerableQuestion("learner-answer"),
		testAttemptResult: store.TestAttemptResult{
			Attempt:  store.TestAttempt{ID: "attempt-incorrect", QuestionID: "question-answer", LearnerID: "learner-answer", IsCorrect: false, Feedback: "Try tracing range again.", ProgressIncrement: 0},
			Progress: store.LearnerTopicProgress{LearnerID: "learner-answer", TopicID: "loops_iteration", Score: 4},
		},
	}

	response := performTestAnswerRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), map[string]any{
		"learner_id": "learner-answer", "question_id": "question-answer", "answer": "1 2 3", "is_correct": true,
	})

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	if len(sessionStore.recordedTestAttempts) != 1 || sessionStore.recordedTestAttempts[0].IsCorrect || sessionStore.testAttemptResult.Attempt.ProgressIncrement != 0 {
		t.Fatalf("incorrect attempt = %#v", sessionStore.recordedTestAttempts)
	}
	assertPublicTestAnswer(t, response.Body.Bytes(), "attempt-incorrect", "question-answer", false, "Try tracing range again.", 4, false)
}

func TestTestCenterRoutesAreRegisteredExactly(t *testing.T) {
	mainSource, err := os.ReadFile("../../cmd/responsible-api/main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	apiSource, err := os.ReadFile("../../responsible.api")
	if err != nil {
		t.Fatalf("read responsible.api: %v", err)
	}
	apiText := strings.ReplaceAll(string(apiSource), "\r\n", "\n")
	mainRoutes := []string{
		`{Method: http.MethodGet, Path: "/api/tests/topics", Handler: gateway.TestTopics}`,
		`{Method: http.MethodPost, Path: "/api/tests/question", Handler: gateway.TestQuestion}`,
		`{Method: http.MethodGet, Path: "/api/tests/question/:id", Handler: gateway.ReloadTestQuestion}`,
		`{Method: http.MethodPost, Path: "/api/tests/answer", Handler: gateway.TestAnswer}`,
	}
	apiRoutes := []string{
		"@handler testTopics\n\tget /api/tests/topics",
		"@handler testQuestion\n\tpost /api/tests/question",
		"@handler reloadTestQuestion\n\tget /api/tests/question/:id",
		"@handler testAnswer\n\tpost /api/tests/answer",
	}
	for index := range mainRoutes {
		if count := strings.Count(string(mainSource), mainRoutes[index]); count != 1 {
			t.Errorf("main route %q count = %d, want 1", mainRoutes[index], count)
		}
		if count := strings.Count(apiText, apiRoutes[index]); count != 1 {
			t.Errorf("api route %q count = %d, want 1", apiRoutes[index], count)
		}
	}
}

func performTestAnswerRequest(t *testing.T, gateway *Gateway, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode answer request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/tests/answer", bytes.NewReader(body))
	response := httptest.NewRecorder()
	gateway.TestAnswer(response, request)
	return response
}

func privateAnswerableQuestion(learnerID string) store.TestQuestion {
	return store.TestQuestion{
		ID: "question-answer", LearnerID: learnerID, TopicID: "loops_iteration", Level: 5,
		QuestionFormat: "output_prediction", QuestionText: "What does range(3) print?",
		Options: []string{"0 1 2", "1 2 3"}, ExpectedAnswer: "0 1 2",
		AcceptedEquivalents: []string{"0, 1, 2"}, GradingRubric: []string{"All three values in order"},
		Status: "answerable",
	}
}

func withQuestionStatus(question store.TestQuestion, status string) store.TestQuestion {
	question.Status = status
	return question
}

func successfulJudgmentPayload(correct bool, score float64, totalTokens int) map[string]any {
	promptTokens := 6
	if totalTokens < promptTokens {
		promptTokens = totalTokens
	}
	feedback := "Review how range stops before its endpoint."
	reason := "The expected output differs."
	if correct {
		feedback = "Correct reasoning."
		reason = "The answer matches the accepted output."
	}
	return map[string]any{
		"is_correct": correct, "score": score, "reason": reason, "feedback": feedback,
		"provider": "dashscope", "model": "qwen-judge",
		"token_usage": map[string]any{"prompt_tokens": promptTokens, "completion_tokens": totalTokens - promptTokens, "total_tokens": totalTokens, "usage_unavailable": false},
	}
}

func assertPublicTestAnswer(t *testing.T, raw []byte, attemptID, questionID string, correct bool, feedback string, score int, duplicate bool) {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decode public answer: %v", err)
	}
	if len(body) != 6 || body["attempt_id"] != attemptID || body["question_id"] != questionID || body["is_correct"] != correct || body["feedback"] != feedback || body["duplicate"] != duplicate {
		t.Fatalf("public answer = %#v", body)
	}
	progress, ok := body["progress"].(map[string]any)
	if !ok || int(progress["score"].(float64)) != score || int(progress["maximum"].(float64)) != 10 || int(progress["percent"].(float64)) != score*10 {
		t.Fatalf("public progress = %#v", body["progress"])
	}
	assertNoPrivateTestFields(t, string(raw))
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode JSON: %v", err)
	}
	return string(encoded)
}

func TestTestQuestionRejectsUnknownTopicWithoutAICall(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
		http.Error(response, "unexpected AI call", http.StatusInternalServerError)
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{}
	response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-one", "unknown-topic")

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"error":"test_topic_not_found"`) {
		t.Fatalf("response = %d %s, want test_topic_not_found", response.Code, response.Body.String())
	}
	if aiCalls.Load() != 0 || sessionStore.progressLookups != 0 || sessionStore.tokenBudgetLookups != 0 {
		t.Fatalf("unknown topic reached dependencies: ai=%d progress=%d budget=%d", aiCalls.Load(), sessionStore.progressLookups, sessionStore.tokenBudgetLookups)
	}
}

func TestTestQuestionRejectsCompletedTopicWithoutAICall(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{
		testProgress:      store.LearnerTopicProgress{Score: 10},
		testProgressFound: true,
	}
	response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-done", "loops_iteration")

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"error":"test_topic_completed"`) {
		t.Fatalf("response = %d %s, want test_topic_completed", response.Code, response.Body.String())
	}
	if aiCalls.Load() != 0 || sessionStore.tokenBudgetLookups != 0 || sessionStore.recentTestLimit != 0 {
		t.Fatalf("completed topic reached later dependencies: ai=%d budget=%d recent_limit=%d", aiCalls.Load(), sessionStore.tokenBudgetLookups, sessionStore.recentTestLimit)
	}
}

func TestTestQuestionZeroBudgetRemainsAvailableWithoutDebit(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
		payload := successfulGenerationPayload(321)
		payload["model"] = "qwen-max"
		writeJSON(response, http.StatusOK, payload)
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{tokenBudget: store.TokenBudget{
		Scope: store.TokenBudgetScope, DailyQuota: 100, UsedTokens: 100, RemainingTokens: 0,
	}}
	response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-budget", "loops_iteration")

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	if aiCalls.Load() != 1 || sessionStore.tokenBudgetLookups != 0 || sessionStore.recordedTokenUsage != 0 || len(sessionStore.createdTestQuestions) != 1 {
		t.Fatalf("generation calls=%d budget reads=%d debited=%d created=%d, want 1/0/0/1", aiCalls.Load(), sessionStore.tokenBudgetLookups, sessionStore.recordedTokenUsage, len(sessionStore.createdTestQuestions))
	}
	created := sessionStore.createdTestQuestions[0]
	if created.Provider != "dashscope" || created.Model != "qwen-max" || created.PromptTokens != 7 || created.CompletionTokens != 314 || created.TotalTokens != 321 {
		t.Fatalf("persisted question usage = %#v", created)
	}
}

func TestTestQuestionSendsFullCatalogSelectedSummaryPromptAndTenRecentQuestions(t *testing.T) {
	recent := make([]store.TestQuestion, 12)
	for index := range recent {
		recent[index] = store.TestQuestion{QuestionText: "Recent question " + string(rune('A'+index))}
	}
	var received struct {
		Catalog          []map[string]any `json:"catalog"`
		SelectedTopic    map[string]any   `json:"selected_topic"`
		CurrentProgress  int              `json:"current_progress"`
		Level            int              `json:"level"`
		DifficultyPrompt string           `json:"difficulty_prompt"`
		RecentQuestions  []string         `json:"recent_questions"`
	}
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/tests/question" || request.Method != http.MethodPost {
			t.Errorf("AI request = %s %s", request.Method, request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Errorf("decode AI request: %v", err)
		}
		payload := successfulGenerationPayload(12)
		payload["level"] = 5
		payload["question_format"] = "output_prediction"
		writeJSON(response, http.StatusOK, payload)
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{
		testProgress:        store.LearnerTopicProgress{Score: 4},
		testProgressFound:   true,
		recentTestQuestions: recent,
	}
	response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-request", "loops_iteration")

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	if len(received.Catalog) != 20 {
		t.Fatalf("catalog length = %d, want 20", len(received.Catalog))
	}
	for index, item := range received.Catalog {
		want := testTopics[index]
		if item["id"] != want.ID || item["label"] != want.Label || item["summary"] != want.Summary || item["icon"] != want.Icon {
			t.Fatalf("catalog[%d] = %#v, want %#v", index, item, want)
		}
	}
	selected, _ := testTopicByID("loops_iteration")
	if received.SelectedTopic["id"] != selected.ID || received.SelectedTopic["label"] != selected.Label || received.SelectedTopic["summary"] != selected.Summary || received.SelectedTopic["icon"] != selected.Icon {
		t.Fatalf("selected topic = %#v, want %#v", received.SelectedTopic, selected)
	}
	_, wantPrompt, _ := testDifficultyForScore(4)
	if received.CurrentProgress != 4 || received.Level != 5 || received.DifficultyPrompt != wantPrompt {
		t.Fatalf("difficulty = progress %d level %d prompt %q", received.CurrentProgress, received.Level, received.DifficultyPrompt)
	}
	if len(received.RecentQuestions) != 10 || received.RecentQuestions[0] != "Recent question A" || received.RecentQuestions[9] != "Recent question J" {
		t.Fatalf("recent questions = %#v, want first ten", received.RecentQuestions)
	}
	if sessionStore.recentTestLearner != "learner-request" || sessionStore.recentTestTopic != "loops_iteration" || sessionStore.recentTestLimit != 10 {
		t.Fatalf("recent query = learner %q topic %q limit %d", sessionStore.recentTestLearner, sessionStore.recentTestTopic, sessionStore.recentTestLimit)
	}
	if len(sessionStore.createdTestQuestions) != 1 {
		t.Fatalf("created questions = %d, want 1", len(sessionStore.createdTestQuestions))
	}
	created := sessionStore.createdTestQuestions[0]
	if created.ExpectedAnswer != "The loop prints 0, 1, and 2." || len(created.AcceptedEquivalents) != 1 || len(created.GradingRubric) != 1 || created.KGGrounding["kg_gap"] != false || created.Provider != "dashscope" || created.Model != "qwen-test" {
		t.Fatalf("private persisted question = %#v", created)
	}
}

func TestBuildTestQuestionAIRequestSerializesNoRecentQuestionsAsEmptyArray(t *testing.T) {
	selected, ok := testTopicByID("python_syntax_program_structure")
	if !ok {
		t.Fatal("expected test topic")
	}
	_, prompt, ok := testDifficultyForScore(0)
	if !ok {
		t.Fatal("expected level-one difficulty prompt")
	}

	payload, err := json.Marshal(buildTestQuestionAIRequest(selected, 0, 1, prompt, nil))
	if err != nil {
		t.Fatalf("marshal AI request: %v", err)
	}
	if !bytes.Contains(payload, []byte(`"recent_questions":[]`)) {
		t.Fatalf("AI request = %s, want recent_questions as an empty JSON array", payload)
	}
}

func TestBuildTestJudgeAIRequestSerializesEmptyCollectionsAsArrays(t *testing.T) {
	payload, err := json.Marshal(buildTestJudgeAIRequest(store.TestQuestion{
		TopicID:        "python_syntax_program_structure",
		Level:          1,
		QuestionFormat: "terminology",
		QuestionText:   "What is a Python statement?",
		ExpectedAnswer: "An instruction that Python can execute.",
	}, "I do not know."))
	if err != nil {
		t.Fatalf("marshal judge request: %v", err)
	}
	for _, field := range []string{"options", "accepted_equivalents", "grading_rubric"} {
		want := []byte(`"` + field + `":[]`)
		if !bytes.Contains(payload, want) {
			t.Fatalf("judge request = %s, want %s as an empty JSON array", payload, field)
		}
	}
}

func TestTestCenterOperationalUsageDoesNotDebitBudget(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			writeJSON(response, http.StatusOK, successfulGenerationPayload(17))
		}))
		defer aiCore.Close()
		sessionStore := &fakeSessionStore{}

		response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-success", "loops_iteration")

		if response.Code != http.StatusOK {
			t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
		}
		if sessionStore.tokenBudgetLookups != 0 || sessionStore.recordedTokenUsage != 0 || len(sessionStore.createdTestQuestions) != 1 {
			t.Fatalf("success budget reads=%d debited=%d created=%d, want 0/0/1", sessionStore.tokenBudgetLookups, sessionStore.recordedTokenUsage, len(sessionStore.createdTestQuestions))
		}
		created := sessionStore.createdTestQuestions[0]
		if created.PromptTokens != 7 || created.CompletionTokens != 10 || created.TotalTokens != 17 {
			t.Fatalf("persisted usage = %d/%d/%d", created.PromptTokens, created.CompletionTokens, created.TotalTokens)
		}
	})

	t.Run("failed repair", func(t *testing.T) {
		aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			writeJSON(response, http.StatusBadGateway, map[string]any{
				"error": "generation_failed", "provider": "dashscope", "model": "qwen-repair",
				"validation_errors": []string{"question_format must equal output_prediction for level 5"},
				"token_usage":       map[string]any{"prompt_tokens": 11, "completion_tokens": 8, "total_tokens": 19, "usage_unavailable": false},
			})
		}))
		defer aiCore.Close()
		sessionStore := &fakeSessionStore{testProgress: store.LearnerTopicProgress{Score: 4}, testProgressFound: true}

		response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-failure", "loops_iteration")

		if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), `"error":"generation_failed"`) {
			t.Fatalf("response = %d %s, want generation_failed", response.Code, response.Body.String())
		}
		if sessionStore.tokenBudgetLookups != 0 || sessionStore.recordedTokenUsage != 0 || len(sessionStore.failedTestQuestions) != 1 || len(sessionStore.createdTestQuestions) != 0 {
			t.Fatalf("failure budget reads=%d debited=%d failed=%d created=%d", sessionStore.tokenBudgetLookups, sessionStore.recordedTokenUsage, len(sessionStore.failedTestQuestions), len(sessionStore.createdTestQuestions))
		}
		failed := sessionStore.failedTestQuestions[0]
		if failed.FailureCode != "generation_failed" || failed.Provider != "dashscope" || failed.Model != "qwen-repair" || failed.PromptTokens != 11 || failed.CompletionTokens != 8 || failed.TotalTokens != 19 {
			t.Fatalf("failed audit record = %#v", failed)
		}
		for _, answerField := range []string{"question_id", "question_text", "options", "progress"} {
			if strings.Contains(response.Body.String(), answerField) {
				t.Fatalf("failed response exposed answer form field %q: %s", answerField, response.Body.String())
			}
		}
		assertNoPrivateTestFields(t, response.Body.String())
	})
}

func TestTestQuestionPublicResponseExcludesAllPrivateFields(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, successfulGenerationPayload(9))
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{}

	response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-private", "loops_iteration")

	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s, want 200", response.Code, response.Body.String())
	}
	assertNoPrivateTestFields(t, response.Body.String())
	for _, privateValue := range []string{"The loop prints 0, 1, and 2.", "0 1 2", "Recognizes range output", "selected_node_ids", "dashscope", "qwen-test", "token_usage"} {
		if strings.Contains(response.Body.String(), privateValue) {
			t.Fatalf("public body leaked private value %q: %s", privateValue, response.Body.String())
		}
	}
	var body testQuestionPublicResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode public response: %v", err)
	}
	if body.QuestionID != "question-created" || body.TopicID != "loops_iteration" || body.Progress.Score != 0 {
		t.Fatalf("public response = %#v", body)
	}
}

func TestTestQuestionMapsLevelConflictToConflict(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, successfulGenerationPayload(5))
	}))
	defer aiCore.Close()
	sessionStore := &fakeSessionStore{testQuestionErr: store.ErrTestLevelConflict}

	response := performTestQuestionRequest(t, NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL}), "learner-stale", "loops_iteration")

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"error":"test_level_changed"`) {
		t.Fatalf("response = %d %s, want test_level_changed", response.Code, response.Body.String())
	}
	if sessionStore.recordedTokenUsage != 0 || len(sessionStore.failedTestQuestions) != 0 {
		t.Fatalf("level conflict debit=%d failed=%d, want 0 and 0", sessionStore.recordedTokenUsage, len(sessionStore.failedTestQuestions))
	}
}

func performTestQuestionRequest(t *testing.T, gateway *Gateway, learnerID, topicID string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"learner_id": learnerID, "topic_id": topicID})
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/tests/question", bytes.NewReader(body))
	response := httptest.NewRecorder()
	gateway.TestQuestion(response, request)
	return response
}

func successfulGenerationPayload(totalTokens int) map[string]any {
	promptTokens := 7
	if totalTokens < promptTokens {
		promptTokens = totalTokens
	}
	return map[string]any{
		"topic_id": "loops_iteration", "level": 1, "question_format": "multiple_choice",
		"question_text":        "What values does range(3) produce?",
		"options":              []string{"0, 1, 2", "1, 2, 3", "0, 1, 2, 3", "Only 3"},
		"expected_answer":      "The loop prints 0, 1, and 2.",
		"accepted_equivalents": []string{"0 1 2"},
		"grading_rubric":       []string{"Recognizes range output"},
		"beginner_difficulty":  true,
		"kg_grounding":         map[string]any{"selected_node_ids": []string{"Concept:loop"}, "kg_gap": false},
		"provider":             "dashscope", "model": "qwen-test",
		"token_usage": map[string]any{"prompt_tokens": promptTokens, "completion_tokens": totalTokens - promptTokens, "total_tokens": totalTokens, "usage_unavailable": false},
	}
}

func TestTestTopicsRequiresLearnerID(t *testing.T) {
	sessionStore := &fakeSessionStore{}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/tests/topics?learner_id=%20", nil)
	response := httptest.NewRecorder()

	gateway.TestTopics(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"learner_id_required"`) {
		t.Fatalf("body = %s, want learner_id_required", response.Body.String())
	}
	if sessionStore.listedProgressFor != "" {
		t.Fatalf("missing learner must not query progress, got %q", sessionStore.listedProgressFor)
	}
}

func TestTestTopicsReturnsTwentyCatalogEntriesInOrderWithoutCreatingProgress(t *testing.T) {
	sessionStore := &fakeSessionStore{}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/tests/topics?learner_id=learner-new", nil)
	response := httptest.NewRecorder()

	gateway.TestTopics(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
	}
	var body struct {
		Topics []testTopicPublicResponse `json:"topics"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Topics) != 20 {
		t.Fatalf("topics = %d, want 20", len(body.Topics))
	}
	for index, topic := range body.Topics {
		catalogTopic := testTopics[index]
		if topic.ID != catalogTopic.ID || topic.Label != catalogTopic.Label || topic.Summary != catalogTopic.Summary || topic.Icon != catalogTopic.Icon {
			t.Fatalf("topic %d = %#v, want catalog entry %#v", index, topic, catalogTopic)
		}
		if topic.Score != 0 || topic.Maximum != 10 || topic.Percent != 0 {
			t.Fatalf("topic %d progress = %d/%d (%d%%), want 0/10 (0%%)", index, topic.Score, topic.Maximum, topic.Percent)
		}
	}
	if sessionStore.listedProgressFor != "learner-new" {
		t.Fatalf("progress learner = %q, want learner-new", sessionStore.listedProgressFor)
	}
	if len(sessionStore.createdTestQuestions) != 0 || len(sessionStore.failedTestQuestions) != 0 || len(sessionStore.recordedTestAttempts) != 0 {
		t.Fatal("listing zero-score topics must not materialize storage rows")
	}
}

func TestTestTopicsMergesStoredProgressIntoCatalogOrder(t *testing.T) {
	sessionStore := &fakeSessionStore{testTopicProgress: []store.LearnerTopicProgress{
		{LearnerID: "learner-progress", TopicID: "loops_iteration", Score: 4},
		{LearnerID: "learner-progress", TopicID: "python_syntax_program_structure", Score: 10},
	}}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/tests/topics?learner_id=learner-progress", nil)
	response := httptest.NewRecorder()

	gateway.TestTopics(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
	}
	var body struct {
		Topics []testTopicPublicResponse `json:"topics"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got := body.Topics[0]; got.Score != 10 || got.Percent != 100 {
		t.Fatalf("first topic progress = %#v, want score 10 and 100 percent", got)
	}
	if got := body.Topics[9]; got.ID != "loops_iteration" || got.Score != 4 || got.Percent != 40 {
		t.Fatalf("loops topic = %#v, want score 4 and 40 percent", got)
	}
}

func TestReloadQuestionReturnsExistingPublicPayloadWithoutAIOrBudgetCall(t *testing.T) {
	var aiCalls atomic.Int32
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCalls.Add(1)
		http.Error(response, "unexpected AI call", http.StatusInternalServerError)
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{
		testQuestion: store.TestQuestion{
			ID:                  "question-owned",
			LearnerID:           "learner-owner",
			TopicID:             "loops_iteration",
			Level:               5,
			QuestionFormat:      "output_prediction",
			QuestionText:        "What does this loop print?",
			Options:             []string{"One", "Two"},
			ExpectedAnswer:      "Private answer",
			AcceptedEquivalents: []string{"Private equivalent"},
			GradingRubric:       []string{"Private rubric"},
			KGGrounding:         map[string]any{"private": "grounding"},
			Status:              "answerable",
		},
		testProgress:      store.LearnerTopicProgress{LearnerID: "learner-owner", TopicID: "loops_iteration", Score: 4},
		testProgressFound: true,
	}
	gateway := NewGateway(Config{Store: sessionStore, AICoreURL: aiCore.URL})
	request := httptest.NewRequest(http.MethodGet, "/api/tests/question/question-owned?learner_id=learner-owner", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "question-owned"})
	response := httptest.NewRecorder()

	gateway.ReloadTestQuestion(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
	}
	var body testQuestionPublicResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.QuestionID != "question-owned" || body.TopicID != "loops_iteration" || body.Level != 5 || body.QuestionFormat != "output_prediction" || body.QuestionText != "What does this loop print?" {
		t.Fatalf("public question = %#v", body)
	}
	if len(body.Options) != 2 || body.Progress.Score != 4 || body.Progress.Maximum != 10 || body.Progress.Percent != 40 {
		t.Fatalf("public options/progress = %#v", body)
	}
	assertNoPrivateTestFields(t, response.Body.String())
	if aiCalls.Load() != 0 {
		t.Fatalf("reload made %d AI calls, want 0", aiCalls.Load())
	}
	if sessionStore.tokenBudgetLookups != 0 {
		t.Fatalf("reload made %d budget lookups, want 0", sessionStore.tokenBudgetLookups)
	}
}

func TestReloadQuestionRequiresLearnerID(t *testing.T) {
	sessionStore := &fakeSessionStore{}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/tests/question/question-owned", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "question-owned"})
	response := httptest.NewRecorder()

	gateway.ReloadTestQuestion(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", response.Code, response.Body.String())
	}
	if sessionStore.testQuestionLookups != 0 {
		t.Fatalf("missing learner made %d question lookups, want 0", sessionStore.testQuestionLookups)
	}
}

func TestReloadQuestionMapsUnknownForbiddenAndNonAnswerableStates(t *testing.T) {
	tests := []struct {
		name       string
		question   store.TestQuestion
		lookupErr  error
		wantStatus int
		wantError  string
	}{
		{name: "unknown", lookupErr: store.ErrTestQuestionNotFound, wantStatus: http.StatusNotFound, wantError: "test_question_not_found"},
		{name: "forbidden", question: store.TestQuestion{ID: "question-state", LearnerID: "other-learner", Status: "answerable"}, wantStatus: http.StatusForbidden, wantError: "test_question_forbidden"},
		{name: "graded", question: store.TestQuestion{ID: "question-state", LearnerID: "learner-owner", Status: "graded"}, wantStatus: http.StatusConflict, wantError: "test_question_not_answerable"},
		{name: "failed", question: store.TestQuestion{ID: "question-state", LearnerID: "learner-owner", Status: "generation_failed"}, wantStatus: http.StatusConflict, wantError: "test_question_not_answerable"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sessionStore := &fakeSessionStore{testQuestion: test.question, testQuestionErr: test.lookupErr}
			gateway := NewGateway(Config{Store: sessionStore})
			request := httptest.NewRequest(http.MethodGet, "/api/tests/question/question-state?learner_id=learner-owner", nil)
			request = pathvar.WithVars(request, map[string]string{"id": "question-state"})
			response := httptest.NewRecorder()

			gateway.ReloadTestQuestion(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), `"error":"`+test.wantError+`"`) {
				t.Fatalf("body = %s, want %s", response.Body.String(), test.wantError)
			}
			assertNoPrivateTestFields(t, response.Body.String())
			if sessionStore.tokenBudgetLookups != 0 {
				t.Fatalf("state mapping made %d budget lookups, want 0", sessionStore.tokenBudgetLookups)
			}
		})
	}
}

func assertNoPrivateTestFields(t *testing.T, body string) {
	t.Helper()
	for _, privateField := range []string{"expected_answer", "accepted_equivalents", "grading_rubric", "reason"} {
		if strings.Contains(body, `"`+privateField+`"`) {
			t.Fatalf("public body leaked %q: %s", privateField, body)
		}
	}
}
