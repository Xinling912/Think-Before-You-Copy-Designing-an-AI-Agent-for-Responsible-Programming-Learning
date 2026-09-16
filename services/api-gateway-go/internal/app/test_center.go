package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"responsible-edu-agent/services/api-gateway-go/internal/store"

	"github.com/zeromicro/go-zero/rest/pathvar"
)

const testTopicMaximum = 10

type testProgressPublicResponse struct {
	Score   int `json:"score"`
	Maximum int `json:"maximum"`
	Percent int `json:"percent"`
}

type testTopicPublicResponse struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Summary string `json:"summary"`
	Icon    string `json:"icon"`
	Score   int    `json:"score"`
	Maximum int    `json:"maximum"`
	Percent int    `json:"percent"`
}

type testQuestionPublicResponse struct {
	QuestionID     string                     `json:"question_id"`
	TopicID        string                     `json:"topic_id"`
	Level          int                        `json:"level"`
	QuestionFormat string                     `json:"question_format"`
	QuestionText   string                     `json:"question_text"`
	Options        []string                   `json:"options"`
	Progress       testProgressPublicResponse `json:"progress"`
}

type testQuestionRequest struct {
	LearnerID string `json:"learner_id"`
	TopicID   string `json:"topic_id"`
}

type testTopicAIRequest struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Summary string `json:"summary"`
	Icon    string `json:"icon"`
}

type testQuestionAIRequest struct {
	Catalog          []testTopicAIRequest `json:"catalog"`
	SelectedTopic    testTopicAIRequest   `json:"selected_topic"`
	CurrentProgress  int                  `json:"current_progress"`
	Level            int                  `json:"level"`
	DifficultyPrompt string               `json:"difficulty_prompt"`
	RecentQuestions  []string             `json:"recent_questions"`
}

type testTokenUsage struct {
	PromptTokens     int  `json:"prompt_tokens"`
	CompletionTokens int  `json:"completion_tokens"`
	TotalTokens      int  `json:"total_tokens"`
	UsageUnavailable bool `json:"usage_unavailable"`
}

type testQuestionAIResponse struct {
	TopicID             string         `json:"topic_id"`
	Level               int            `json:"level"`
	QuestionFormat      string         `json:"question_format"`
	QuestionText        string         `json:"question_text"`
	Options             []string       `json:"options"`
	ExpectedAnswer      string         `json:"expected_answer"`
	AcceptedEquivalents []string       `json:"accepted_equivalents"`
	GradingRubric       []string       `json:"grading_rubric"`
	BeginnerDifficulty  bool           `json:"beginner_difficulty"`
	KGGrounding         map[string]any `json:"kg_grounding"`
	Provider            string         `json:"provider"`
	Model               string         `json:"model"`
	TokenUsage          testTokenUsage `json:"token_usage"`
}

type testQuestionAIError struct {
	Error      string         `json:"error"`
	Provider   string         `json:"provider"`
	Model      string         `json:"model"`
	TokenUsage testTokenUsage `json:"token_usage"`
}

type testAnswerRequest struct {
	LearnerID  string `json:"learner_id"`
	QuestionID string `json:"question_id"`
	Answer     string `json:"answer"`
}

type testJudgeAIRequest struct {
	TopicID             string   `json:"topic_id"`
	Level               int      `json:"level"`
	QuestionFormat      string   `json:"question_format"`
	QuestionText        string   `json:"question_text"`
	Options             []string `json:"options"`
	ExpectedAnswer      string   `json:"expected_answer"`
	AcceptedEquivalents []string `json:"accepted_equivalents"`
	GradingRubric       []string `json:"grading_rubric"`
	StudentAnswer       string   `json:"student_answer"`
}

type testJudgeAIResponse struct {
	IsCorrect  bool           `json:"is_correct"`
	Score      float64        `json:"score"`
	Reason     string         `json:"reason"`
	Feedback   string         `json:"feedback"`
	Provider   string         `json:"provider"`
	Model      string         `json:"model"`
	TokenUsage testTokenUsage `json:"token_usage"`
}

type testAnswerPublicResponse struct {
	AttemptID  string                     `json:"attempt_id"`
	QuestionID string                     `json:"question_id"`
	IsCorrect  bool                       `json:"is_correct"`
	Feedback   string                     `json:"feedback"`
	Progress   testProgressPublicResponse `json:"progress"`
	Duplicate  bool                       `json:"duplicate"`
}

func (g *Gateway) TestTopics(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	learnerID := strings.TrimSpace(request.URL.Query().Get("learner_id"))
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		learnerID = participant.ID
	}
	if learnerID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "learner_id_required"})
		return
	}

	storedProgress, err := g.store.ListLearnerTopicProgress(request.Context(), learnerID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_topics_lookup_failed"})
		return
	}
	progressByTopic := make(map[string]int, len(storedProgress))
	for _, progress := range storedProgress {
		progressByTopic[progress.TopicID] = progress.Score
	}

	topics := make([]testTopicPublicResponse, 0, len(testTopics))
	for _, topic := range testTopics {
		score := progressByTopic[topic.ID]
		topics = append(topics, testTopicPublicResponse{
			ID:      topic.ID,
			Label:   topic.Label,
			Summary: topic.Summary,
			Icon:    topic.Icon,
			Score:   score,
			Maximum: testTopicMaximum,
			Percent: score * 100 / testTopicMaximum,
		})
	}
	writeJSON(response, http.StatusOK, map[string]any{"topics": topics})
}

func (g *Gateway) TestQuestion(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	defer request.Body.Close()

	var input testQuestionRequest
	if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		input.LearnerID = participant.ID
	}
	input.LearnerID = strings.TrimSpace(input.LearnerID)
	input.TopicID = strings.TrimSpace(input.TopicID)
	if input.LearnerID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "learner_id_required"})
		return
	}
	if input.TopicID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "topic_id_required"})
		return
	}

	selected, ok := testTopicByID(input.TopicID)
	if !ok {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "test_topic_not_found"})
		return
	}
	progress, found, err := g.store.GetLearnerTopicProgress(request.Context(), input.LearnerID, selected.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_progress_lookup_failed"})
		return
	}
	score := 0
	if found {
		score = progress.Score
	}
	if score >= testTopicMaximum {
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_topic_completed"})
		return
	}
	level, difficultyPrompt, ok := testDifficultyForScore(score)
	if !ok {
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_topic_completed"})
		return
	}

	recent, err := g.store.ListRecentTestQuestions(request.Context(), input.LearnerID, selected.ID, 10)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_recent_questions_lookup_failed"})
		return
	}
	if len(recent) > 10 {
		recent = recent[:10]
	}
	recentTexts := make([]string, 0, len(recent))
	for _, question := range recent {
		if text := strings.TrimSpace(question.QuestionText); text != "" {
			recentTexts = append(recentTexts, text)
		}
	}

	status, body, err := g.callAI(
		request.Context(),
		http.MethodPost,
		"/internal/tests/question",
		buildTestQuestionAIRequest(selected, score, level, difficultyPrompt, recentTexts),
	)
	if err != nil {
		g.writeTestQuestionGenerationFailure(response, request, input, level, testQuestionAIError{Error: "ai_core_unavailable"})
		return
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		var failure testQuestionAIError
		if json.Unmarshal(body, &failure) != nil {
			failure.Error = "ai_core_bad_response"
		}
		if strings.TrimSpace(failure.Error) == "" {
			failure.Error = "generation_failed"
		}
		g.writeTestQuestionGenerationFailure(response, request, input, level, failure)
		return
	}

	var generated testQuestionAIResponse
	if err := json.Unmarshal(body, &generated); err != nil {
		g.writeTestQuestionGenerationFailure(response, request, input, level, testQuestionAIError{Error: "ai_core_bad_response"})
		return
	}
	created, err := g.store.CreateTestQuestion(request.Context(), store.CreateTestQuestionInput{
		LearnerID:           input.LearnerID,
		TopicID:             selected.ID,
		Level:               level,
		QuestionFormat:      generated.QuestionFormat,
		QuestionText:        generated.QuestionText,
		Options:             append([]string{}, generated.Options...),
		ExpectedAnswer:      generated.ExpectedAnswer,
		AcceptedEquivalents: append([]string{}, generated.AcceptedEquivalents...),
		GradingRubric:       append([]string{}, generated.GradingRubric...),
		KGGrounding:         generated.KGGrounding,
		Provider:            generated.Provider,
		Model:               generated.Model,
		PromptTokens:        generated.TokenUsage.PromptTokens,
		CompletionTokens:    generated.TokenUsage.CompletionTokens,
		TotalTokens:         generated.TokenUsage.TotalTokens,
	})
	if errors.Is(err, store.ErrTestLevelConflict) {
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_level_changed"})
		return
	}
	if errors.Is(err, store.ErrTestTopicCompleted) {
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_topic_completed"})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_question_create_failed"})
		return
	}
	writeJSON(response, http.StatusOK, publicTestQuestion(created, score))
}

func buildTestQuestionAIRequest(selected TestTopic, score, level int, difficultyPrompt string, recent []string) testQuestionAIRequest {
	catalog := make([]testTopicAIRequest, 0, len(testTopics))
	for _, topic := range testTopics {
		catalog = append(catalog, testTopicForAI(topic))
	}
	return testQuestionAIRequest{
		Catalog:          catalog,
		SelectedTopic:    testTopicForAI(selected),
		CurrentProgress:  score,
		Level:            level,
		DifficultyPrompt: difficultyPrompt,
		RecentQuestions:  append([]string{}, recent...),
	}
}

func testTopicForAI(topic TestTopic) testTopicAIRequest {
	return testTopicAIRequest{ID: topic.ID, Label: topic.Label, Summary: topic.Summary, Icon: topic.Icon}
}

func (g *Gateway) writeTestQuestionGenerationFailure(
	response http.ResponseWriter,
	request *http.Request,
	input testQuestionRequest,
	level int,
	failure testQuestionAIError,
) {
	_, err := g.store.CreateFailedTestQuestion(request.Context(), store.CreateFailedTestQuestionInput{
		LearnerID:        input.LearnerID,
		TopicID:          input.TopicID,
		Level:            level,
		FailureCode:      failure.Error,
		Provider:         failure.Provider,
		Model:            failure.Model,
		PromptTokens:     failure.TokenUsage.PromptTokens,
		CompletionTokens: failure.TokenUsage.CompletionTokens,
		TotalTokens:      failure.TokenUsage.TotalTokens,
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_question_failure_record_failed"})
		return
	}
	writeJSON(response, http.StatusBadGateway, map[string]string{"error": failure.Error})
}

func (g *Gateway) TestAnswer(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	defer request.Body.Close()

	var input testAnswerRequest
	if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		input.LearnerID = participant.ID
	}
	input.LearnerID = strings.TrimSpace(input.LearnerID)
	input.QuestionID = strings.TrimSpace(input.QuestionID)
	input.Answer = strings.TrimSpace(input.Answer)
	if input.LearnerID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "learner_id_required"})
		return
	}
	if input.QuestionID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "question_id_required"})
		return
	}
	if input.Answer == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "answer_required"})
		return
	}

	existing, found, err := g.store.GetTestAttemptByQuestion(request.Context(), input.QuestionID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_attempt_lookup_failed"})
		return
	}
	if found {
		if existing.Attempt.LearnerID != input.LearnerID {
			writeJSON(response, http.StatusForbidden, map[string]string{"error": "test_question_forbidden"})
			return
		}
		writeJSON(response, http.StatusOK, publicTestAnswer(existing, true))
		return
	}

	question, err := g.store.GetTestQuestion(request.Context(), input.QuestionID)
	if errors.Is(err, store.ErrTestQuestionNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "test_question_not_found"})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_question_lookup_failed"})
		return
	}
	if question.LearnerID != input.LearnerID {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "test_question_forbidden"})
		return
	}
	if question.Status != "answerable" {
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_question_not_answerable"})
		return
	}

	reservation, err := g.store.ReserveTestAttempt(request.Context(), input.LearnerID, question.ID, input.Answer)
	if errors.Is(err, store.ErrTestAttemptInProgress) {
		writeJSON(response, http.StatusConflict, map[string]any{"error": "test_attempt_in_progress", "retryable": true})
		return
	}
	if errors.Is(err, store.ErrTestQuestionNotAnswerable) {
		latest, latestFound, lookupErr := g.store.GetTestAttemptByQuestion(request.Context(), input.QuestionID)
		if lookupErr == nil && latestFound {
			if latest.Attempt.LearnerID != input.LearnerID {
				writeJSON(response, http.StatusForbidden, map[string]string{"error": "test_question_forbidden"})
				return
			}
			writeJSON(response, http.StatusOK, publicTestAnswer(latest, true))
			return
		}
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_question_not_answerable"})
		return
	}
	if errors.Is(err, store.ErrTestQuestionNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "test_question_not_found"})
		return
	}
	if errors.Is(err, store.ErrTestQuestionForbidden) {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "test_question_forbidden"})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_attempt_reservation_failed"})
		return
	}
	defer releaseTestAttemptReservation(g.store, reservation)

	judgment, failureCode := g.requestTestJudgment(request.Context(), question, input.Answer)
	if failureCode == "judging_failed" {
		judgment, failureCode = g.requestTestJudgment(request.Context(), question, input.Answer)
	}
	if failureCode != "" {
		writeJSON(response, http.StatusBadGateway, map[string]any{"error": "answer_evaluation_unavailable", "retryable": true})
		return
	}
	result, err := g.store.RecordTestAttempt(request.Context(), store.RecordTestAttemptInput{
		LearnerID:        input.LearnerID,
		QuestionID:       question.ID,
		ReservationID:    reservation.ID,
		SubmittedAnswer:  input.Answer,
		IsCorrect:        judgment.IsCorrect,
		Score:            judgment.Score,
		Reason:           judgment.Reason,
		Feedback:         judgment.Feedback,
		Provider:         judgment.Provider,
		Model:            judgment.Model,
		PromptTokens:     judgment.TokenUsage.PromptTokens,
		CompletionTokens: judgment.TokenUsage.CompletionTokens,
		TotalTokens:      judgment.TokenUsage.TotalTokens,
	})
	if errors.Is(err, store.ErrTestQuestionNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "test_question_not_found"})
		return
	}
	if errors.Is(err, store.ErrTestQuestionForbidden) {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "test_question_forbidden"})
		return
	}
	if errors.Is(err, store.ErrTestQuestionNotAnswerable) {
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_question_not_answerable"})
		return
	}
	if errors.Is(err, store.ErrTestAttemptReservation) {
		writeJSON(response, http.StatusConflict, map[string]any{"error": "test_attempt_reservation_lost", "retryable": true})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_attempt_record_failed"})
		return
	}
	writeJSON(response, http.StatusOK, publicTestAnswer(result, result.Duplicate))
}

func (g *Gateway) requestTestJudgment(
	ctx context.Context,
	question store.TestQuestion,
	studentAnswer string,
) (testJudgeAIResponse, string) {
	status, body, err := g.callAI(
		ctx,
		http.MethodPost,
		"/internal/tests/judge",
		buildTestJudgeAIRequest(question, studentAnswer),
	)
	if err != nil {
		return testJudgeAIResponse{}, "ai_core_unavailable"
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		var failure testQuestionAIError
		if json.Unmarshal(body, &failure) != nil || strings.TrimSpace(failure.Error) == "" {
			return testJudgeAIResponse{}, "ai_core_bad_response"
		}
		return testJudgeAIResponse{}, failure.Error
	}

	var judgment testJudgeAIResponse
	if json.Unmarshal(body, &judgment) != nil {
		return testJudgeAIResponse{}, "ai_core_bad_response"
	}
	return judgment, ""
}

func releaseTestAttemptReservation(sessionStore SessionStore, reservation store.TestAttemptReservation) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = sessionStore.ReleaseTestAttemptReservation(ctx, reservation)
}

func buildTestJudgeAIRequest(question store.TestQuestion, studentAnswer string) testJudgeAIRequest {
	return testJudgeAIRequest{
		TopicID:             question.TopicID,
		Level:               question.Level,
		QuestionFormat:      question.QuestionFormat,
		QuestionText:        question.QuestionText,
		Options:             append([]string{}, question.Options...),
		ExpectedAnswer:      question.ExpectedAnswer,
		AcceptedEquivalents: append([]string{}, question.AcceptedEquivalents...),
		GradingRubric:       append([]string{}, question.GradingRubric...),
		StudentAnswer:       studentAnswer,
	}
}

func publicTestAnswer(result store.TestAttemptResult, duplicate bool) testAnswerPublicResponse {
	score := result.Progress.Score
	return testAnswerPublicResponse{
		AttemptID:  result.Attempt.ID,
		QuestionID: result.Attempt.QuestionID,
		IsCorrect:  result.Attempt.IsCorrect,
		Feedback:   result.Attempt.Feedback,
		Progress: testProgressPublicResponse{
			Score:   score,
			Maximum: testTopicMaximum,
			Percent: score * 100 / testTopicMaximum,
		},
		Duplicate: duplicate,
	}
}

func (g *Gateway) ReloadTestQuestion(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	learnerID := strings.TrimSpace(request.URL.Query().Get("learner_id"))
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		learnerID = participant.ID
	}
	if learnerID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "learner_id_required"})
		return
	}
	questionID := strings.TrimSpace(pathvar.Vars(request)["id"])
	if questionID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "question_id_required"})
		return
	}

	question, err := g.store.GetTestQuestion(request.Context(), questionID)
	if errors.Is(err, store.ErrTestQuestionNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "test_question_not_found"})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_question_lookup_failed"})
		return
	}
	if question.LearnerID != learnerID {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "test_question_forbidden"})
		return
	}
	if question.Status != "answerable" {
		writeJSON(response, http.StatusConflict, map[string]string{"error": "test_question_not_answerable"})
		return
	}

	progress, found, err := g.store.GetLearnerTopicProgress(request.Context(), learnerID, question.TopicID)
	if err != nil || !found {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "test_progress_lookup_failed"})
		return
	}
	writeJSON(response, http.StatusOK, publicTestQuestion(question, progress.Score))
}

func publicTestQuestion(question store.TestQuestion, score int) testQuestionPublicResponse {
	options := append([]string(nil), question.Options...)
	return testQuestionPublicResponse{
		QuestionID:     question.ID,
		TopicID:        question.TopicID,
		Level:          question.Level,
		QuestionFormat: question.QuestionFormat,
		QuestionText:   question.QuestionText,
		Options:        options,
		Progress: testProgressPublicResponse{
			Score:   score,
			Maximum: testTopicMaximum,
			Percent: score * 100 / testTopicMaximum,
		},
	}
}
