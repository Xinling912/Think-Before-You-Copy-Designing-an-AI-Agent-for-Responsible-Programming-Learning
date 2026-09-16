package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"responsible-edu-agent/services/api-gateway-go/internal/store"

	"github.com/zeromicro/go-zero/core/logx"
	"github.com/zeromicro/go-zero/rest/pathvar"
)

const defaultAICoreURL = "http://127.0.0.1:9000"
const aiCoreClientTimeout = 120 * time.Second

type Config struct {
	AICoreURL        string
	Store            SessionStore
	CorpusDir        string
	KGCandidatePath  string
	HarnessSuitePath string
	HarnessLogDir    string
	ProjectRoot      string
	AppMode          string
	AdminPassword    string
}

type SessionStore interface {
	CreateSession(ctx context.Context, scenario string) (store.Session, error)
	GetSession(ctx context.Context, sessionID string) (store.Session, error)
	ListSessions(ctx context.Context, status string) ([]store.SessionSummary, error)
	GetSessionDetail(ctx context.Context, sessionID string) (store.SessionDetail, error)
	GetSessionChatDetail(ctx context.Context, sessionID string) (store.SessionChatDetail, error)
	DeleteSession(ctx context.Context, sessionID string) (store.Session, error)
	SaveMessage(ctx context.Context, sessionID string, role string, content string) error
	SaveMessageWithID(ctx context.Context, sessionID string, role string, content string) (int64, error)
	SaveMessageAndEvidence(ctx context.Context, sessionID string, role string, content string, evidence map[string]any) error
	SaveMessageAndEvidenceWithID(ctx context.Context, sessionID string, role string, content string, evidence map[string]any) (int64, error)
	ListEvidenceEvents(ctx context.Context, sessionID string) ([]store.EvidenceEvent, error)
	ListRecentMessages(ctx context.Context, sessionID string, limit int) ([]store.Message, error)
	LatestEvidence(ctx context.Context, sessionID string) (map[string]any, error)
	ListLearnerMemory(ctx context.Context, learnerID string, limit int) ([]store.LearnerMemory, error)
	ListLearnerMemoryV2(ctx context.Context, learnerID string, limit int) ([]store.LearnerMemoryV2, error)
	ListTopicSummaries(ctx context.Context, learnerID string, limit int) ([]store.TopicSummary, error)
	ListLearningEpisodes(ctx context.Context, learnerID string, limit int) ([]store.LearningEpisode, error)
	ListLearningFacts(ctx context.Context, learnerID string) ([]store.LearningFact, error)
	ListLearningEntities(ctx context.Context, learnerID string) ([]store.LearningEntity, error)
	ListMemoryEvents(ctx context.Context, learnerID string, limit int) ([]store.MemoryEvent, error)
	ApplyMemoryUpdates(ctx context.Context, learnerID string, updates []map[string]any) error
	ApplyMemoryEvent(ctx context.Context, input store.MemoryEventInput) (store.LearnerMemoryV2, error)
	DecayAndCapMemories(ctx context.Context, learnerID string, now time.Time) error
	SaveLearningEpisode(ctx context.Context, input store.LearningEpisodeInput) (store.LearningEpisode, error)
	UpdateLearningEpisodeMessages(ctx context.Context, episodeID int64, input store.LearningEpisodeUpdate) error
	SaveLearningFact(ctx context.Context, input store.LearningFactInput) (store.LearningFact, error)
	UpsertTopicSummary(ctx context.Context, input store.TopicSummaryInput) (store.TopicSummary, error)
	PersistCompletedSessionTurn(ctx context.Context, input store.CompletedSessionTurnInput) (store.CompletedSessionTurnResult, error)
	GetConversationProjection(ctx context.Context, sessionID string) (store.ConversationProjectionRecord, error)
	ConversationTurnCommitted(ctx context.Context, sessionID, clientTurnID string) (bool, error)
	MarkLearningEpisodeFailed(ctx context.Context, episodeID int64, status string) error
	GetTokenBudget(ctx context.Context) (store.TokenBudget, error)
	RecordTokenUsage(ctx context.Context, totalTokens int) (store.TokenBudget, error)
	ResetTokenBudget(ctx context.Context) (store.TokenBudget, error)
	UpsertKGCandidateReview(ctx context.Context, input store.KGCandidateReviewInput) (store.KGCandidateReview, error)
	ListKGCandidateReviews(ctx context.Context) ([]store.KGCandidateReview, error)
	CreateHarnessCase(ctx context.Context, record store.HarnessCaseRecord) (store.HarnessCaseRecord, error)
	ListHarnessCases(ctx context.Context, filter store.HarnessCaseFilter) ([]store.HarnessCaseRecord, error)
	GetHarnessCase(ctx context.Context, caseID string) (store.HarnessCaseRecord, error)
	ConfirmHarnessCase(ctx context.Context, caseID string) (store.HarnessCaseRecord, error)
	DeleteHarnessCase(ctx context.Context, caseID string) (store.HarnessCaseRecord, error)
	AppendHarnessCaseEvent(ctx context.Context, event store.HarnessCaseEvent) error
	ListLearnerTopicProgress(ctx context.Context, learnerID string) ([]store.LearnerTopicProgress, error)
	GetLearnerTopicProgress(ctx context.Context, learnerID, topicID string) (store.LearnerTopicProgress, bool, error)
	ListRecentTestQuestions(ctx context.Context, learnerID, topicID string, limit int) ([]store.TestQuestion, error)
	CreateTestQuestion(ctx context.Context, input store.CreateTestQuestionInput) (store.TestQuestion, error)
	CreateFailedTestQuestion(ctx context.Context, input store.CreateFailedTestQuestionInput) (store.TestQuestion, error)
	GetTestQuestion(ctx context.Context, questionID string) (store.TestQuestion, error)
	GetTestAttemptByQuestion(ctx context.Context, questionID string) (store.TestAttemptResult, bool, error)
	ReserveTestAttempt(ctx context.Context, learnerID, questionID, submittedAnswer string) (store.TestAttemptReservation, error)
	ReleaseTestAttemptReservation(ctx context.Context, reservation store.TestAttemptReservation) error
	RecordTestAttempt(ctx context.Context, input store.RecordTestAttemptInput) (store.TestAttemptResult, error)
}

type Gateway struct {
	aiCoreURL        string
	client           *http.Client
	store            SessionStore
	corpusDir        string
	kgCandidatePath  string
	harnessSuitePath string
	harnessLogDir    string
	projectRoot      string
	appMode          string
	adminPassword    string
}

type Skill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MVP         bool   `json:"mvp"`
}

func NewGateway(config Config) *Gateway {
	aiCoreURL := strings.TrimRight(config.AICoreURL, "/")
	if aiCoreURL == "" {
		aiCoreURL = defaultAICoreURL
	}

	return &Gateway{
		aiCoreURL: aiCoreURL,
		client: &http.Client{
			Timeout: aiCoreClientTimeout,
		},
		store:            config.Store,
		corpusDir:        defaultCorpusDir(config.CorpusDir),
		kgCandidatePath:  defaultKGCandidatePath(config.KGCandidatePath),
		harnessSuitePath: defaultHarnessSuitePath(config.HarnessSuitePath),
		harnessLogDir:    defaultHarnessLogDir(config.HarnessLogDir),
		projectRoot:      defaultProjectRoot(config.ProjectRoot),
		appMode:          strings.ToLower(strings.TrimSpace(config.AppMode)),
		adminPassword:    config.AdminPassword,
	}
}

func defaultCorpusDir(configured string) string {
	if strings.TrimSpace(configured) != "" {
		return resolveCorpusDir(configured)
	}
	return resolveCorpusDir("data/processed")
}

func resolveCorpusDir(path string) string {
	candidates := []string{
		path,
		filepath.Join("..", "..", path),
		filepath.Join("..", "..", "..", path),
	}
	for _, candidate := range candidates {
		cleaned := filepath.Clean(candidate)
		if info, err := os.Stat(filepath.Join(cleaned, "chunks.jsonl")); err == nil && !info.IsDir() {
			return cleaned
		}
		if info, err := os.Stat(filepath.Join(cleaned, "python-docs-3.14.6", "chunks.jsonl")); err == nil && !info.IsDir() {
			return cleaned
		}
	}
	return filepath.Clean(path)
}

func defaultKGCandidatePath(configured string) string {
	if strings.TrimSpace(configured) != "" {
		return resolveKGCandidatePath(configured)
	}
	return resolveKGCandidatePath("kg/generated/candidates.jsonl")
}

func resolveKGCandidatePath(path string) string {
	candidates := []string{
		path,
		filepath.Join("..", "..", path),
		filepath.Join("..", "..", "..", path),
	}
	for _, candidate := range candidates {
		cleaned := filepath.Clean(candidate)
		if info, err := os.Stat(cleaned); err == nil && !info.IsDir() {
			return cleaned
		}
	}
	return filepath.Clean(path)
}

func (g *Gateway) Health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "api-gateway-go",
	})
}

func (g *Gateway) Skills(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"skills": mvpSkills(),
	})
}

func (g *Gateway) TokenBudget(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	participantID := ""
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		participantID = participant.ID
	}
	budget, err := g.getTokenBudget(request.Context(), participantID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_budget_lookup_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"token_budget": budget})
}

func (g *Gateway) ResetTokenBudget(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	budget, err := g.store.ResetTokenBudget(request.Context())
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_budget_reset_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"token_budget": budget})
}

func (g *Gateway) KGPath(response http.ResponseWriter, request *http.Request) {
	target := strings.TrimSpace(request.URL.Query().Get("target"))
	if target == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "target_required",
		})
		return
	}

	payload := map[string]string{"target": target}
	g.forwardJSON(response, request.Context(), http.MethodPost, "/ai/kg/reason", payload)
}

func (g *Gateway) KGOverview(response http.ResponseWriter, request *http.Request) {
	g.forwardJSON(response, request.Context(), http.MethodGet, "/ai/kg/overview", nil)
}

func (g *Gateway) SessionStart(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{
			"error": "storage_unavailable",
		})
		return
	}
	participantID := ""
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		participantID = participant.ID
	}
	defer request.Body.Close()

	var payload struct {
		Scenario string `json:"scenario"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil && err != io.EOF {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "invalid_json",
		})
		return
	}

	session, err := g.store.CreateSession(request.Context(), payload.Scenario)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "session_create_failed",
		})
		return
	}
	if participantID != "" {
		storage, _ := g.participantStorage()
		if err := storage.LinkParticipantSession(request.Context(), participantID, session.ID); err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "session_owner_link_failed"})
			return
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"session": session,
	})
}

func (g *Gateway) CurrentSession(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{
			"error": "storage_unavailable",
		})
		return
	}

	var sessions []store.SessionSummary
	var err error
	if g.participantModeEnabled() && !g.adminDataAccess(request) {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		storage, _ := g.participantStorage()
		sessions, err = storage.ListParticipantSessions(request.Context(), participant.ID, "active")
	} else {
		sessions, err = g.store.ListSessions(request.Context(), "active")
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "sessions_lookup_failed",
		})
		return
	}

	var selected *store.SessionSummary
	for index := range sessions {
		if sessions[index].MessageCount > 0 {
			selected = &sessions[index]
			break
		}
	}
	if selected == nil && len(sessions) > 0 {
		selected = &sessions[0]
	}

	if selected == nil {
		writeJSON(response, http.StatusOK, map[string]any{
			"session":         nil,
			"messages":        []store.Message{},
			"evidence_events": []store.EvidenceEvent{},
			"created":         false,
			"reused":          false,
		})
		return
	}

	detail, err := g.store.GetSessionDetail(request.Context(), selected.ID)
	if errors.Is(err, store.ErrSessionNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{
			"error": "session_not_found",
		})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "session_detail_lookup_failed",
		})
		return
	}

	writeJSON(response, http.StatusOK, map[string]any{
		"session":         detail.Session,
		"messages":        detail.Messages,
		"evidence_events": detail.EvidenceEvents,
		"created":         false,
		"reused":          true,
	})
}

func (g *Gateway) Sessions(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{
			"error": "storage_unavailable",
		})
		return
	}

	status := strings.ToLower(strings.TrimSpace(request.URL.Query().Get("status")))
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "all" && status != "deleted" {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "invalid_session_status",
		})
		return
	}

	var sessions []store.SessionSummary
	var err error
	if g.participantModeEnabled() && !g.adminDataAccess(request) {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		storage, _ := g.participantStorage()
		sessions, err = storage.ListParticipantSessions(request.Context(), participant.ID, status)
	} else {
		sessions, err = g.store.ListSessions(request.Context(), status)
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "sessions_lookup_failed",
		})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"sessions": sessions,
	})
}

func (g *Gateway) LearnerProfile(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{
			"error": "storage_unavailable",
		})
		return
	}

	learnerID := request.URL.Query().Get("learner_id")
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}

	memories, err := g.store.ListLearnerMemoryV2(request.Context(), learnerID, 30)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "learner_memory_lookup_failed",
		})
		return
	}
	summaries, err := g.store.ListTopicSummaries(request.Context(), learnerID, 20)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "topic_summary_lookup_failed",
		})
		return
	}
	episodes, err := g.store.ListLearningEpisodes(request.Context(), learnerID, 20)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "learning_episodes_lookup_failed",
		})
		return
	}
	shortTermMessages := []store.Message{}
	if latestSessionID := latestEpisodeSessionID(episodes); latestSessionID != "" {
		shortTermMessages, err = g.store.ListRecentMessages(request.Context(), latestSessionID, 12)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{
				"error": "short_term_messages_lookup_failed",
			})
			return
		}
	}
	facts, err := g.store.ListLearningFacts(request.Context(), learnerID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "learning_facts_lookup_failed",
		})
		return
	}
	entities, err := g.store.ListLearningEntities(request.Context(), learnerID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "learning_entities_lookup_failed",
		})
		return
	}
	events, err := g.store.ListMemoryEvents(request.Context(), learnerID, 30)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "memory_events_lookup_failed",
		})
		return
	}
	rmmReflections := learnerProfileRMMReflections(episodes)

	writeJSON(response, http.StatusOK, map[string]any{
		"learner_id":            learnerID,
		"research_methods":      learnerProfileResearchMethods(),
		"active_memory_count":   len(memories),
		"topic_summary_count":   len(summaries),
		"rmm_reflection_count":  len(rmmReflections),
		"learning_fact_count":   len(facts),
		"learning_entity_count": len(entities),
		"memory_event_count":    len(events),
		"short_term_messages":   learnerProfileShortTermMessages(shortTermMessages),
		"memories":              learnerProfileMemories(memories),
		"topic_summaries":       learnerProfileTopicSummaries(summaries),
		"learning_episodes":     learnerProfileLearningEpisodes(episodes),
		"rmm_reflections":       rmmReflections,
		"learning_facts":        learnerProfileFacts(facts),
		"learning_entities":     learnerProfileEntities(entities),
		"memory_events":         learnerProfileMemoryEvents(events),
	})
}

func (g *Gateway) SessionMessage(response http.ResponseWriter, request *http.Request) {
	defer request.Body.Close()

	var payload map[string]any
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "invalid_json",
		})
		return
	}

	sessionID, _ := payload["session_id"].(string)
	content, _ := payload["message"].(string)
	clientTurnID, _ := payload["client_turn_id"].(string)
	clientTurnID = strings.TrimSpace(clientTurnID)
	if clientTurnID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "client_turn_id_required"})
		return
	}
	payload["client_turn_id"] = clientTurnID
	delete(payload, "episode_id")
	learnerID, _ := payload["learner_id"].(string)
	participantID := ""
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		participantID = participant.ID
		learnerID = participant.ID
		payload["learner_id"] = participant.ID
		if sessionID != "" && !g.participantOwnsSession(response, request, participant.ID, sessionID) {
			return
		}
	}
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if _, ok := payload["baseline_mode"]; !ok {
		payload["baseline_mode"] = "full_memory"
	}
	storedConversationSequence, err := g.loadConversationRequestState(request.Context(), payload, sessionID, clientTurnID)
	if err != nil {
		writeConversationRequestError(response, err, clientTurnID)
		return
	}

	sessionScenario := "python-learning"
	if g.store != nil && sessionID != "" {
		session, err := g.store.GetSession(request.Context(), sessionID)
		if errors.Is(err, store.ErrSessionNotFound) {
			writeJSON(response, http.StatusNotFound, map[string]string{
				"error": "session_not_found",
			})
			return
		}
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{
				"error": "session_lookup_failed",
			})
			return
		}
		if session.Status == "deleted" {
			writeJSON(response, http.StatusConflict, map[string]string{
				"error": "session_deleted",
			})
			return
		}
		sessionScenario = stringWithDefault(session.Scenario, "python-learning")
	}

	var recentMessages []store.Message
	if g.store != nil && sessionID != "" {
		recentMessages, err = g.store.ListRecentMessages(request.Context(), sessionID, 8)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{
				"error": "recent_messages_lookup_failed",
			})
			return
		}
		lastEvidence, err := g.store.LatestEvidence(request.Context(), sessionID)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{
				"error": "latest_evidence_lookup_failed",
			})
			return
		}
		learnerMemory, err := g.store.ListLearnerMemoryV2(request.Context(), learnerID, 30)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{
				"error": "learner_memory_lookup_failed",
			})
			return
		}
		topicSummaries, err := g.store.ListTopicSummaries(request.Context(), learnerID, 10)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{
				"error": "topic_summary_lookup_failed",
			})
			return
		}
		payload["recent_messages"] = messagesForAI(recentMessages)
		payload["last_evidence"] = lastEvidence
		payload["learner_memory"] = memoriesV2ForAI(learnerMemory)
		payload["topic_summaries"] = topicSummariesForAI(topicSummaries)
		if _, ok := payload["task_state"]; !ok {
			payload["task_state"] = map[string]any{
				"scenario": sessionScenario,
			}
		}
	}
	tokenDecision := fallbackTokenChargeDecision(false, "deterministic_free_default")
	if g.store != nil {
		tokenDecision, err = g.classifyTokenCharge(
			request.Context(), content, recentMessages,
			tokenChargeProjectionFromPayload(payload, sessionID, storedConversationSequence),
			stringValueFromMap(payload, "requested_focus_node_id"),
		)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_charge_decision_failed"})
			return
		}
	}
	payload["token_charge_decision"] = tokenChargeDecisionMap(tokenDecision)
	if g.store != nil && tokenDecision.Chargeable {
		budget, err := g.getTokenBudget(request.Context(), participantID)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_budget_lookup_failed"})
			return
		}
		if budget.RemainingTokens <= 0 {
			writeTokenBudgetExhausted(response, budget, tokenDecision)
			return
		}
	}

	status, body, err := g.callAI(request.Context(), http.MethodPost, "/ai/session/step", payload)
	if err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{
			"error": "ai_core_unavailable",
		})
		return
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		writeRawJSON(response, status, body)
		return
	}

	var evidence map[string]any
	if err := json.Unmarshal(body, &evidence); err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "invalid_ai_core_response"})
		return
	}
	tokenDebit, _ := prepareTokenDebit(tokenDecision, participantID, evidence)
	conversationEvents, conversationProjection, err := conversationStateFromEvidence(evidence, sessionID, clientTurnID, storedConversationSequence)
	if err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "invalid_ai_core_response"})
		return
	}

	if g.store != nil {
		agentContent := ""
		if prompt, ok := evidence["prompt"].(string); ok {
			agentContent = strings.TrimSpace(prompt)
		}
		memoryEvents := memoryEventsFromEvidence(evidence, learnerID, sessionID, 0, 0)
		var topicSummary *store.TopicSummaryInput
		if parsedTopicSummary, ok := topicSummaryFromEvidence(evidence, learnerID, sessionID); ok {
			topicSummary = &parsedTopicSummary
		}
		result, err := g.store.PersistCompletedSessionTurn(request.Context(), store.CompletedSessionTurnInput{
			SessionID:      sessionID,
			LearnerID:      learnerID,
			StudentContent: content,
			AgentContent:   agentContent,
			Episode: &store.LearningEpisodeInput{
				LearnerID: learnerID, SessionID: sessionID, Topic: topicIDFromScenario(sessionScenario),
			},
			Evidence:               evidence,
			MemoryEvents:           memoryEvents,
			TopicSummary:           topicSummary,
			LearningFacts:          learningFactsFromEvidence(evidence, learnerID, 0),
			ConversationEvents:     conversationEvents,
			ConversationProjection: conversationProjection,
			TokenDebit:             tokenDebit,
		})
		if err != nil {
			if errors.Is(err, store.ErrTokenBudgetExhausted) {
				budget, budgetErr := g.getTokenBudget(request.Context(), participantID)
				if budgetErr != nil {
					writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_budget_lookup_failed"})
					return
				}
				writeTokenBudgetExhausted(response, budget, tokenDecision)
				return
			}
			writeCompletedTurnPersistenceError(response, err, clientTurnID)
			return
		}
		evidence["student_message_id"] = result.StudentMessageID
		evidence["agent_message_id"] = result.AgentMessageID
		if result.TokenBudget != nil {
			evidence["token_budget"] = *result.TokenBudget
		}
		body, err = json.Marshal(evidence)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{
				"error": "completed_turn_response_failed",
			})
			return
		}
	}

	writeRawJSON(response, status, body)
}

func (g *Gateway) SessionMessageStream(response http.ResponseWriter, request *http.Request) {
	defer request.Body.Close()

	var payload map[string]any
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "invalid_json",
		})
		return
	}

	sessionID, _ := payload["session_id"].(string)
	content, _ := payload["message"].(string)
	clientTurnID, _ := payload["client_turn_id"].(string)
	clientTurnID = strings.TrimSpace(clientTurnID)
	if clientTurnID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "client_turn_id_required"})
		return
	}
	payload["client_turn_id"] = clientTurnID
	delete(payload, "episode_id")
	learnerID, _ := payload["learner_id"].(string)
	participantID := ""
	if g.participantModeEnabled() {
		participant, ok := g.participantForRequest(response, request)
		if !ok {
			return
		}
		participantID = participant.ID
		learnerID = participant.ID
		payload["learner_id"] = participant.ID
		if sessionID != "" && !g.participantOwnsSession(response, request, participant.ID, sessionID) {
			return
		}
	}
	if learnerID == "" {
		learnerID = "anonymous-demo"
	}
	if _, ok := payload["baseline_mode"]; !ok {
		payload["baseline_mode"] = "full_memory"
	}
	storedConversationSequence, err := g.loadConversationRequestState(request.Context(), payload, sessionID, clientTurnID)
	if err != nil {
		writeConversationRequestError(response, err, clientTurnID)
		return
	}

	sessionScenario := "python-learning"
	if g.store != nil && sessionID != "" {
		session, err := g.store.GetSession(request.Context(), sessionID)
		if errors.Is(err, store.ErrSessionNotFound) {
			writeJSON(response, http.StatusNotFound, map[string]string{"error": "session_not_found"})
			return
		}
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "session_lookup_failed"})
			return
		}
		if session.Status == "deleted" {
			writeJSON(response, http.StatusConflict, map[string]string{"error": "session_deleted"})
			return
		}
		sessionScenario = stringWithDefault(session.Scenario, "python-learning")
	}

	var recentMessages []store.Message
	if g.store != nil && sessionID != "" {
		recentMessages, err = g.store.ListRecentMessages(request.Context(), sessionID, 8)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "recent_messages_lookup_failed"})
			return
		}
		lastEvidence, err := g.store.LatestEvidence(request.Context(), sessionID)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "latest_evidence_lookup_failed"})
			return
		}
		learnerMemory, err := g.store.ListLearnerMemoryV2(request.Context(), learnerID, 30)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "learner_memory_lookup_failed"})
			return
		}
		topicSummaries, err := g.store.ListTopicSummaries(request.Context(), learnerID, 10)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "topic_summary_lookup_failed"})
			return
		}
		payload["recent_messages"] = messagesForAI(recentMessages)
		payload["last_evidence"] = lastEvidence
		payload["learner_memory"] = memoriesV2ForAI(learnerMemory)
		payload["topic_summaries"] = topicSummariesForAI(topicSummaries)
		if _, ok := payload["task_state"]; !ok {
			payload["task_state"] = map[string]any{"scenario": sessionScenario}
		}
	}
	tokenDecision := fallbackTokenChargeDecision(false, "deterministic_free_default")
	if g.store != nil {
		tokenDecision, err = g.classifyTokenCharge(
			request.Context(), content, recentMessages,
			tokenChargeProjectionFromPayload(payload, sessionID, storedConversationSequence),
			stringValueFromMap(payload, "requested_focus_node_id"),
		)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_charge_decision_failed"})
			return
		}
	}
	payload["token_charge_decision"] = tokenChargeDecisionMap(tokenDecision)
	if g.store != nil && tokenDecision.Chargeable {
		budget, err := g.getTokenBudget(request.Context(), participantID)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_budget_lookup_failed"})
			return
		}
		if budget.RemainingTokens <= 0 {
			writeTokenBudgetExhaustedStream(response, sessionID, budget, tokenDecision)
			return
		}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	upstreamRequest, err := http.NewRequestWithContext(request.Context(), http.MethodPost, g.aiCoreURL+"/ai/session/step/stream", bytes.NewReader(body))
	if err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "ai_core_request_failed"})
		return
	}
	upstreamRequest.Header.Set("Content-Type", "application/json")
	upstreamRequest.Header.Set("Accept", "application/x-ndjson")
	upstream, err := g.client.Do(upstreamRequest)
	if err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "ai_core_unavailable"})
		return
	}
	defer upstream.Body.Close()
	if upstream.StatusCode < http.StatusOK || upstream.StatusCode >= http.StatusMultipleChoices {
		upstreamBody, _ := io.ReadAll(upstream.Body)
		writeRawJSON(response, upstream.StatusCode, upstreamBody)
		return
	}

	var finalEvidence map[string]any
	bufferedEvents := make([]map[string]any, 0)
	scanner := bufio.NewScanner(upstream.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal(line, &event); err != nil {
			writeJSON(response, http.StatusBadGateway, map[string]string{"error": "invalid_ai_core_response"})
			return
		}
		if event["type"] == "trace_completed_payload" {
			if responseMap, ok := event["response"].(map[string]any); ok {
				finalEvidence = responseMap
			}
			continue
		}
		bufferedEvents = append(bufferedEvents, event)
	}
	if err := scanner.Err(); err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "ai_core_stream_failed"})
		return
	}
	if finalEvidence == nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "invalid_ai_core_response"})
		return
	}
	tokenDebit, _ := prepareTokenDebit(tokenDecision, participantID, finalEvidence)

	agentContent := ""
	if prompt, ok := finalEvidence["prompt"].(string); ok {
		agentContent = strings.TrimSpace(prompt)
	}
	conversationEvents, conversationProjection, stateErr := conversationStateFromEvidence(finalEvidence, sessionID, clientTurnID, storedConversationSequence)
	if stateErr != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "invalid_ai_core_response"})
		return
	}
	agentMessageID := int64(0)
	episodeID := int64(0)
	if g.store != nil {
		memoryEvents := memoryEventsFromEvidence(finalEvidence, learnerID, sessionID, 0, 0)
		var topicSummary *store.TopicSummaryInput
		if parsedTopicSummary, ok := topicSummaryFromEvidence(finalEvidence, learnerID, sessionID); ok {
			topicSummary = &parsedTopicSummary
		}
		result, err := g.store.PersistCompletedSessionTurn(request.Context(), store.CompletedSessionTurnInput{
			SessionID:      sessionID,
			LearnerID:      learnerID,
			StudentContent: content,
			AgentContent:   agentContent,
			Episode: &store.LearningEpisodeInput{
				LearnerID: learnerID, SessionID: sessionID, Topic: topicIDFromScenario(sessionScenario),
			},
			Evidence:               finalEvidence,
			MemoryEvents:           memoryEvents,
			TopicSummary:           topicSummary,
			LearningFacts:          learningFactsFromEvidence(finalEvidence, learnerID, 0),
			ConversationEvents:     conversationEvents,
			ConversationProjection: conversationProjection,
			TokenDebit:             tokenDebit,
		})
		if err != nil {
			if errors.Is(err, store.ErrTokenBudgetExhausted) {
				budget, budgetErr := g.getTokenBudget(request.Context(), participantID)
				if budgetErr != nil {
					writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "token_budget_lookup_failed"})
					return
				}
				writeTokenBudgetExhaustedStream(response, sessionID, budget, tokenDecision)
				return
			}
			writeCompletedTurnPersistenceError(response, err, clientTurnID)
			return
		}
		agentMessageID = result.AgentMessageID
		episodeID = result.EpisodeID
		finalEvidence["student_message_id"] = result.StudentMessageID
		finalEvidence["agent_message_id"] = result.AgentMessageID
		if result.TokenBudget != nil {
			finalEvidence["token_budget"] = *result.TokenBudget
			bufferedEvents = append(bufferedEvents, map[string]any{
				"type":         "token_budget_updated",
				"token_budget": *result.TokenBudget,
				"timestamp":    beijingTimestamp(),
			})
		}
	}
	response.Header().Set("Content-Type", "application/x-ndjson")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
	flusher, _ := response.(http.Flusher)
	for _, event := range bufferedEvents {
		writeNDJSONEvent(response, event)
	}
	writeNDJSONEvent(response, map[string]any{
		"type":                         "trace_completed",
		"session_id":                   sessionID,
		"turn_id":                      completedTurnID(episodeID, clientTurnID),
		"student_message_id":           finalEvidence["student_message_id"],
		"agent_message_id":             agentMessageID,
		"prompt":                       finalEvidence["prompt"],
		"turn_resolution":              finalEvidence["turn_resolution"],
		"response_contract":            finalEvidence["response_contract"],
		"next_conversation_projection": finalEvidence["next_conversation_projection"],
		"conversation_events":          finalEvidence["conversation_events"],
		"learning_trace":               finalEvidence["learning_trace"],
		"timestamp":                    beijingTimestamp(),
	})
	if flusher != nil {
		flusher.Flush()
	}
}

func (g *Gateway) loadConversationRequestState(ctx context.Context, payload map[string]any, sessionID, clientTurnID string) (int64, error) {
	delete(payload, "conversation_projection")
	if g.store == nil {
		payload["conversation_projection"] = map[string]any{
			"schema_version": 1, "last_sequence": int64(0), "active_topic_id": nil,
			"back_stack": []any{}, "topics": map[string]any{},
		}
		return 0, nil
	}
	projection, err := g.store.GetConversationProjection(ctx, sessionID)
	if err != nil {
		return 0, fmt.Errorf("load conversation projection: %w", err)
	}
	committed, err := g.store.ConversationTurnCommitted(ctx, sessionID, clientTurnID)
	if err != nil {
		return 0, fmt.Errorf("check conversation turn: %w", err)
	}
	if committed {
		return 0, fmt.Errorf("%w: %s", store.ErrConversationTurnAlreadyCommitted, clientTurnID)
	}
	payload["conversation_projection"] = projection.Projection
	return projection.LastSequence, nil
}

func completedTurnID(episodeID int64, clientTurnID string) string {
	if episodeID > 0 {
		return strconv.FormatInt(episodeID, 10)
	}
	return clientTurnID
}

func writeConversationRequestError(response http.ResponseWriter, err error, clientTurnID string) {
	if errors.Is(err, store.ErrConversationTurnAlreadyCommitted) {
		writeJSON(response, http.StatusConflict, map[string]string{
			"error": "duplicate_client_turn_id", "client_turn_id": clientTurnID,
		})
		return
	}
	writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "conversation_projection_lookup_failed"})
}

func writeCompletedTurnPersistenceError(response http.ResponseWriter, err error, clientTurnID string) {
	switch {
	case errors.Is(err, store.ErrConversationTurnAlreadyCommitted):
		writeJSON(response, http.StatusConflict, map[string]string{
			"error": "duplicate_client_turn_id", "client_turn_id": clientTurnID,
		})
	case errors.Is(err, store.ErrConversationProjectionSequenceMismatch):
		writeJSON(response, http.StatusConflict, map[string]string{"error": "conversation_state_conflict"})
	default:
		logx.Errorf("completed turn persistence failed (client_turn_id=%s): %v", clientTurnID, err)
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "completed_turn_persist_failed"})
	}
}

func conversationStateFromEvidence(evidence map[string]any, sessionID, clientTurnID string, storedLastSequence int64) ([]store.ConversationEventInput, *store.ConversationProjectionRecord, error) {
	rawEvents, hasEvents := evidence["conversation_events"]
	rawProjection, hasProjection := evidence["next_conversation_projection"]
	if !hasEvents || !hasProjection {
		return nil, nil, fmt.Errorf("conversation events and projection must be returned together")
	}
	eventJSON, err := json.Marshal(rawEvents)
	if err != nil {
		return nil, nil, fmt.Errorf("encode conversation events: %w", err)
	}
	var events []store.ConversationEventInput
	if err := json.Unmarshal(eventJSON, &events); err != nil {
		return nil, nil, fmt.Errorf("decode conversation events: %w", err)
	}
	if len(events) == 0 {
		return nil, nil, fmt.Errorf("conversation events cannot be empty")
	}
	projectionJSON, err := json.Marshal(rawProjection)
	if err != nil {
		return nil, nil, fmt.Errorf("encode conversation projection: %w", err)
	}
	var projection map[string]any
	if err := json.Unmarshal(projectionJSON, &projection); err != nil {
		return nil, nil, fmt.Errorf("decode conversation projection: %w", err)
	}
	lastSequence, ok := integerFromJSONValue(projection["last_sequence"])
	if !ok {
		return nil, nil, fmt.Errorf("projection last sequence must be an integer")
	}
	record := &store.ConversationProjectionRecord{
		SessionID: sessionID, LastSequence: lastSequence, Projection: projection,
	}
	if err := store.ValidateConversationEventBatch(sessionID, clientTurnID, storedLastSequence, events, record); err != nil {
		return nil, nil, fmt.Errorf("invalid conversation event batch: %w", err)
	}
	return events, record, nil
}

func integerFromJSONValue(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		if typed != math.Trunc(typed) {
			return 0, false
		}
		return int64(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func (g *Gateway) SessionDetail(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{
			"error": "storage_unavailable",
		})
		return
	}

	sessionID := pathvar.Vars(request)["id"]
	if sessionID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "session_id_required",
		})
		return
	}
	if g.participantModeEnabled() && !g.adminDataAccess(request) {
		participant, ok := g.participantForRequest(response, request)
		if !ok || !g.participantOwnsSession(response, request, participant.ID, sessionID) {
			return
		}
	}

	detail, err := g.store.GetSessionChatDetail(request.Context(), sessionID)
	if errors.Is(err, store.ErrSessionNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{
			"error": "session_not_found",
		})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "session_detail_lookup_failed",
		})
		return
	}
	if detail.Session.Status == "deleted" {
		writeJSON(response, http.StatusConflict, map[string]string{
			"error": "session_deleted",
		})
		return
	}

	writeJSON(response, http.StatusOK, detail)
}

func (g *Gateway) DeleteSession(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{
			"error": "storage_unavailable",
		})
		return
	}

	sessionID := pathvar.Vars(request)["id"]
	if sessionID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "session_id_required",
		})
		return
	}
	if g.participantModeEnabled() && !g.adminDataAccess(request) {
		participant, ok := g.participantForRequest(response, request)
		if !ok || !g.participantOwnsSession(response, request, participant.ID, sessionID) {
			return
		}
	}

	session, err := g.store.DeleteSession(request.Context(), sessionID)
	if errors.Is(err, store.ErrSessionNotFound) {
		writeJSON(response, http.StatusNotFound, map[string]string{
			"error": "session_not_found",
		})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "session_delete_failed",
		})
		return
	}

	writeJSON(response, http.StatusOK, map[string]any{
		"session": session,
	})
}

func messagesForAI(messages []store.Message) []map[string]string {
	result := make([]map[string]string, 0, len(messages))
	for _, message := range messages {
		result = append(result, map[string]string{
			"role":    message.Role,
			"content": message.Content,
		})
	}
	return result
}

func memoriesForAI(memories []store.LearnerMemory) []map[string]any {
	result := make([]map[string]any, 0, len(memories))
	for _, memory := range memories {
		if memory.Payload == nil {
			continue
		}
		result = append(result, memory.Payload)
	}
	return result
}

func memoriesV2ForAI(memories []store.LearnerMemoryV2) []map[string]any {
	result := make([]map[string]any, 0, len(memories))
	for _, memory := range memories {
		if memory.Status != "" && memory.Status != "active" {
			continue
		}
		payload := map[string]any{
			"memory_id":         memory.MemoryID,
			"learner_id":        memory.LearnerID,
			"memory_type":       memory.MemoryType,
			"topic":             memory.Topic,
			"content":           memory.Content,
			"concepts":          memory.Concepts,
			"source_event_id":   memory.SourceEventID,
			"source_session_id": memory.SourceSessionID,
			"operation_origin":  memory.OperationOrigin,
			"strength":          memory.Strength,
			"use_count":         memory.UseCount,
			"effective_score":   memory.EffectiveScore,
			"status":            stringWithDefault(memory.Status, "active"),
		}
		for key, value := range memory.Payload {
			if _, exists := payload[key]; !exists {
				payload[key] = value
			}
		}
		result = append(result, payload)
	}
	return result
}

func topicSummariesForAI(summaries []store.TopicSummary) []map[string]any {
	result := make([]map[string]any, 0, len(summaries))
	for _, summary := range summaries {
		result = append(result, map[string]any{
			"learner_id":           summary.LearnerID,
			"topic":                summary.Topic,
			"topic_summary":        summary.Summary,
			"weak_concepts":        summary.WeakConcepts,
			"mastered_concepts":    summary.MasteredConcepts,
			"next_teaching_action": summary.NextTeachingAction,
			"source_session_id":    summary.SourceSessionID,
			"source_memory_ids":    summary.SourceMemoryIDs,
		})
	}
	return result
}

func learnerProfileResearchMethods() []map[string]string {
	return []map[string]string{
		{
			"name":        "Mem0",
			"implemented": "salient memory operations: ADD / UPDATE / DELETE / NOOP",
		},
		{
			"name":        "MemoryBank",
			"implemented": "strength, use_count, last_used_at, effective_score and forgetting curve",
		},
		{
			"name":        "RMM",
			"implemented": "topic summary, prospective memory reading plan and retrospective memory-use record",
		},
		{
			"name":        "Zep temporal graph memory",
			"implemented": "learning episodes, entities, facts, status and temporal validity",
		},
	}
}

func learnerProfileMemories(memories []store.LearnerMemoryV2) []map[string]any {
	result := make([]map[string]any, 0, len(memories))
	for _, memory := range memories {
		result = append(result, map[string]any{
			"memory_id":         memory.MemoryID,
			"memory_type":       memory.MemoryType,
			"topic":             memory.Topic,
			"content":           memory.Content,
			"concepts":          memory.Concepts,
			"source_event_id":   memory.SourceEventID,
			"source_session_id": memory.SourceSessionID,
			"operation_origin":  memory.OperationOrigin,
			"strength":          memory.Strength,
			"use_count":         memory.UseCount,
			"effective_score":   memory.EffectiveScore,
			"status":            memory.Status,
			"valid_from":        timeOrNil(memory.ValidFrom),
			"valid_to":          timeOrNil(memory.ValidTo),
			"last_used_at":      timeOrNil(memory.LastUsedAt),
			"updated_at":        timeOrNil(memory.UpdatedAt),
			"payload":           memory.Payload,
		})
	}
	return result
}

func learnerProfileTopicSummaries(summaries []store.TopicSummary) []map[string]any {
	result := make([]map[string]any, 0, len(summaries))
	for _, summary := range summaries {
		result = append(result, map[string]any{
			"topic":                summary.Topic,
			"topic_summary":        summary.Summary,
			"mastered_concepts":    summary.MasteredConcepts,
			"weak_concepts":        summary.WeakConcepts,
			"next_teaching_action": summary.NextTeachingAction,
			"source_session_id":    summary.SourceSessionID,
			"source_memory_ids":    summary.SourceMemoryIDs,
			"updated_at":           timeOrNil(summary.UpdatedAt),
		})
	}
	return result
}

func learnerProfileRMMReflections(episodes []store.LearningEpisode) []map[string]any {
	result := make([]map[string]any, 0, len(episodes))
	for _, episode := range episodes {
		readingPlan := mapFromAny(episode.Payload["memory_reading_plan"])
		retrospective := mapFromAny(episode.Payload["retrospective_memory_use"])
		if len(readingPlan) == 0 && len(retrospective) == 0 {
			continue
		}
		reflection := map[string]any{
			"episode_id":                 episode.ID,
			"session_id":                 episode.SessionID,
			"topic":                      stringWithDefault(stringValueFromMap(readingPlan, "topic"), episode.Topic),
			"skill_state":                episode.SkillState,
			"created_at":                 timeOrNil(episode.CreatedAt),
			"selected_memory_ids":        stringSliceFromAny(readingPlan["selected_memory_ids"]),
			"used_memory_ids":            stringSliceFromAny(retrospective["used_memory_ids"]),
			"unused_selected_memory_ids": stringSliceFromAny(retrospective["unused_selected_memory_ids"]),
			"verification_reason":        stringValueFromMap(retrospective, "verification_reason"),
			"prospective_memory_plan":    stringValueFromMap(readingPlan, "prospective_memory_plan"),
			"retrospective_memory_use":   stringValueFromMap(retrospective, "retrospective_memory_use"),
			"retrieval_refinement":       stringValueFromMap(retrospective, "retrieval_refinement"),
			"selected_topic_summary":     mapFromAny(readingPlan["selected_topic_summary"]),
		}
		result = append(result, reflection)
	}
	return result
}

func learnerProfileLearningEpisodes(episodes []store.LearningEpisode) []map[string]any {
	result := make([]map[string]any, 0, len(episodes))
	for _, episode := range episodes {
		result = append(result, map[string]any{
			"episode_id":         episode.ID,
			"session_id":         episode.SessionID,
			"student_message_id": nullableInt64(episode.StudentMessageID),
			"agent_message_id":   nullableInt64(episode.AgentMessageID),
			"topic":              episode.Topic,
			"skill_state":        episode.SkillState,
			"created_at":         timeOrNil(episode.CreatedAt),
			"payload":            episode.Payload,
		})
	}
	return result
}

func latestEpisodeSessionID(episodes []store.LearningEpisode) string {
	for _, episode := range episodes {
		if episode.SessionID != "" {
			return episode.SessionID
		}
	}
	return ""
}

func learnerProfileShortTermMessages(messages []store.Message) []map[string]any {
	result := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		result = append(result, map[string]any{
			"id":         message.ID,
			"session_id": message.SessionID,
			"role":       message.Role,
			"content":    message.Content,
			"created_at": message.CreatedAt,
		})
	}
	return result
}

func learnerProfileFacts(facts []store.LearningFact) []map[string]any {
	result := make([]map[string]any, 0, len(facts))
	for _, fact := range facts {
		result = append(result, map[string]any{
			"fact_id":           fact.FactID,
			"subject":           fact.Subject,
			"predicate":         fact.Predicate,
			"object":            fact.Object,
			"confidence":        fact.Confidence,
			"source_episode_id": fact.SourceEpisodeID,
			"valid_from":        timeOrNil(fact.ValidFrom),
			"valid_to":          timeOrNil(fact.ValidTo),
			"status":            fact.Status,
			"payload":           fact.Payload,
		})
	}
	return result
}

func learnerProfileEntities(entities []store.LearningEntity) []map[string]any {
	result := make([]map[string]any, 0, len(entities))
	for _, entity := range entities {
		result = append(result, map[string]any{
			"entity_id":             entity.EntityID,
			"entity_type":           entity.EntityType,
			"label":                 entity.Label,
			"first_seen_episode_id": entity.FirstSeenEpisodeID,
			"last_seen_episode_id":  entity.LastSeenEpisodeID,
			"confidence":            entity.Confidence,
			"status":                entity.Status,
			"created_at":            timeOrNil(entity.CreatedAt),
			"updated_at":            timeOrNil(entity.UpdatedAt),
			"payload":               entity.Payload,
		})
	}
	return result
}

func learnerProfileMemoryEvents(events []store.MemoryEvent) []map[string]any {
	result := make([]map[string]any, 0, len(events))
	for _, event := range events {
		result = append(result, map[string]any{
			"id":               event.ID,
			"session_id":       event.SessionID,
			"message_id":       event.MessageID,
			"operation":        event.Operation,
			"target_memory_id": event.TargetMemoryID,
			"result_memory_id": event.ResultMemoryID,
			"reason":           event.Reason,
			"candidate":        event.Candidate,
			"created_at":       timeOrNil(event.CreatedAt),
		})
	}
	return result
}

func timeOrNil(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.Format(time.RFC3339Nano)
}

func nullableInt64(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}

func memoryUpdatesFromEvidence(evidence map[string]any) []map[string]any {
	rawUpdates, ok := evidence["memory_updates"]
	if !ok {
		return nil
	}
	switch updates := rawUpdates.(type) {
	case []map[string]any:
		return updates
	case []any:
		result := make([]map[string]any, 0, len(updates))
		for _, update := range updates {
			if mapped, ok := update.(map[string]any); ok {
				result = append(result, mapped)
			}
		}
		return result
	default:
		return nil
	}
}

func memoryEventsFromEvidence(evidence map[string]any, learnerID string, sessionID string, messageID int64, episodeID int64) []store.MemoryEventInput {
	events := make([]store.MemoryEventInput, 0)
	for _, update := range memoryUpdatesFromEvidence(evidence) {
		operation := strings.ToUpper(stringValueFromMap(update, "operation"))
		if operation == "" {
			operation = "NOOP"
		}
		events = append(events, store.MemoryEventInput{
			LearnerID:       learnerID,
			SessionID:       sessionID,
			MessageID:       messageID,
			Operation:       operation,
			TargetMemoryID:  stringValueFromMap(update, "target_memory_id"),
			MemoryType:      stringValueFromMap(update, "memory_type"),
			Topic:           stringValueFromMap(update, "topic"),
			Content:         stringValueFromMap(update, "content"),
			Concepts:        stringSliceFromAny(update["concepts"]),
			SourceEventID:   episodeID,
			SourceSessionID: sessionID,
			OperationOrigin: stringWithDefault(stringValueFromMap(update, "source"), "mem0_salient_memory"),
			Candidate:       cloneAnyMap(update),
			Reason:          stringValueFromMap(update, "reason"),
			Payload:         cloneAnyMap(update),
		})
	}
	for _, reinforcement := range memoryReinforcementsFromEvidence(evidence) {
		targetMemoryID := stringValueFromMap(reinforcement, "memory_id")
		if targetMemoryID == "" {
			targetMemoryID = stringValueFromMap(reinforcement, "target_memory_id")
		}
		events = append(events, store.MemoryEventInput{
			LearnerID:       learnerID,
			SessionID:       sessionID,
			MessageID:       messageID,
			Operation:       "REINFORCE",
			TargetMemoryID:  targetMemoryID,
			SourceEventID:   episodeID,
			SourceSessionID: sessionID,
			OperationOrigin: "rmm_prospective_selection",
			Candidate:       cloneAnyMap(reinforcement),
			Reason:          stringValueFromMap(reinforcement, "reason"),
			Payload:         cloneAnyMap(reinforcement),
		})
	}
	return events
}

func memoryReinforcementsFromEvidence(evidence map[string]any) []map[string]any {
	raw, ok := evidence["memory_reinforcement"]
	if !ok {
		return nil
	}
	switch items := raw.(type) {
	case []map[string]any:
		return items
	case []any:
		result := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if mapped, ok := item.(map[string]any); ok {
				result = append(result, mapped)
			}
		}
		return result
	default:
		return nil
	}
}

func topicSummaryFromEvidence(evidence map[string]any, learnerID string, sessionID string) (store.TopicSummaryInput, bool) {
	raw, ok := evidence["topic_summary_update"].(map[string]any)
	if !ok || len(raw) == 0 {
		return store.TopicSummaryInput{}, false
	}
	topic := stringValueFromMap(raw, "topic")
	if topic == "" {
		return store.TopicSummaryInput{}, false
	}
	return store.TopicSummaryInput{
		LearnerID:          learnerID,
		Topic:              topic,
		Summary:            stringValueFromMap(raw, "topic_summary"),
		WeakConcepts:       stringSliceFromAny(raw["weak_concepts"]),
		MasteredConcepts:   stringSliceFromAny(raw["mastered_concepts"]),
		NextTeachingAction: stringValueFromMap(raw, "next_teaching_action"),
		SourceSessionID:    sessionID,
		SourceMemoryIDs:    stringSliceFromAny(raw["source_memory_ids"]),
	}, true
}

func learningFactsFromEvidence(evidence map[string]any, learnerID string, episodeID int64) []store.LearningFactInput {
	rawFacts, ok := evidence["learning_facts"]
	if !ok {
		return nil
	}
	var items []any
	switch facts := rawFacts.(type) {
	case []any:
		items = facts
	case []map[string]any:
		items = make([]any, 0, len(facts))
		for _, fact := range facts {
			items = append(items, fact)
		}
	default:
		return nil
	}
	result := make([]store.LearningFactInput, 0, len(items))
	for _, item := range items {
		fact, ok := item.(map[string]any)
		if !ok {
			continue
		}
		input := store.LearningFactInput{
			FactID:          stringValueFromMap(fact, "fact_id"),
			LearnerID:       learnerID,
			Subject:         stringValueFromMap(fact, "subject"),
			Predicate:       stringValueFromMap(fact, "predicate"),
			Object:          stringValueFromMap(fact, "object"),
			Confidence:      floatValueFromAny(fact["confidence"], 0.8),
			SourceEpisodeID: episodeID,
			Status:          stringWithDefault(stringValueFromMap(fact, "status"), "active"),
			Payload:         mapFromAny(fact["payload"]),
		}
		if validFrom := stringValueFromMap(fact, "valid_from"); validFrom != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, validFrom); err == nil {
				input.ValidFrom = parsed
			}
		}
		if validTo := stringValueFromMap(fact, "valid_to"); validTo != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, validTo); err == nil {
				input.ValidTo = parsed
			}
		}
		result = append(result, input)
	}
	return result
}

func topicFromEvidence(evidence map[string]any) string {
	if state, ok := evidence["next_task_state"].(map[string]any); ok {
		if topic := stringValueFromMap(state, "topic"); topic != "" {
			return topic
		}
	}
	if summary, ok := evidence["topic_summary_update"].(map[string]any); ok {
		if topic := stringValueFromMap(summary, "topic"); topic != "" {
			return topic
		}
	}
	return "python_learning"
}

func topicIDFromScenario(scenario string) string {
	scenario = strings.ToLower(strings.TrimSpace(scenario))
	var builder strings.Builder
	lastUnderscore := false
	for _, char := range scenario {
		allowed := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_'
		if allowed {
			builder.WriteRune(char)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			builder.WriteRune('_')
			lastUnderscore = true
		}
	}
	topic := strings.Trim(builder.String(), "_")
	if topic == "" {
		return "python_learning"
	}
	return topic
}

func trimForTopicPayload(content string) string {
	content = strings.TrimSpace(content)
	if len([]rune(content)) <= 80 {
		return content
	}
	runes := []rune(content)
	return string(runes[:80])
}

func skillStateFromEvidence(evidence map[string]any) string {
	if state, ok := evidence["skill_state"].(map[string]any); ok {
		if value := stringValueFromMap(state, "state"); value != "" {
			return value
		}
	}
	if value := stringValueFromMap(evidence, "state"); value != "" {
		return value
	}
	return "unknown"
}

func learningEpisodePayload(evidence map[string]any) map[string]any {
	payload := cloneAnyMap(evidence)
	payload["stored_as"] = "learning_episode"
	return payload
}

func stringValueFromMap(values map[string]any, key string) string {
	if value, ok := values[key].(string); ok {
		return value
	}
	return ""
}

func stringSliceFromAny(value any) []string {
	switch items := value.(type) {
	case []string:
		return items
	case []any:
		result := make([]string, 0, len(items))
		for _, item := range items {
			if text, ok := item.(string); ok && text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func floatValueFromAny(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return fallback
	}
}

func mapFromAny(value any) map[string]any {
	if mapped, ok := value.(map[string]any); ok {
		return cloneAnyMap(mapped)
	}
	return map[string]any{}
}

func cloneAnyMap(source map[string]any) map[string]any {
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func stringWithDefault(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func (g *Gateway) SessionEvidence(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{
			"error": "storage_unavailable",
		})
		return
	}

	sessionID := pathvar.Vars(request)["id"]
	if sessionID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{
			"error": "session_id_required",
		})
		return
	}

	events, err := g.store.ListEvidenceEvents(request.Context(), sessionID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{
			"error": "evidence_lookup_failed",
		})
		return
	}

	writeJSON(response, http.StatusOK, map[string]any{
		"session_id": sessionID,
		"events":     events,
	})
}

type CorpusChunk struct {
	SourceID       string   `json:"source_id"`
	ChunkID        string   `json:"chunk_id"`
	DocID          string   `json:"doc_id"`
	SectionID      string   `json:"section_id"`
	SectionIndex   int      `json:"section_index"`
	ChunkIndex     int      `json:"chunk_index"`
	ChunkTotal     int      `json:"chunk_total"`
	Title          string   `json:"title"`
	HeadingPath    []string `json:"heading_path"`
	SourceURL      string   `json:"source_url"`
	Text           string   `json:"text"`
	CharCount      int      `json:"char_count"`
	CodeBlockCount int      `json:"code_block_count"`
	QualityFlags   []string `json:"quality_flags"`
	Version        string   `json:"version"`
	Source         string   `json:"source"`
	License        string   `json:"license"`
	LicenseNote    string   `json:"source_license_note"`
}

type KGCandidate struct {
	CandidateID   string  `json:"candidate_id"`
	SourceID      string  `json:"source_id"`
	SourceChunkID string  `json:"source_chunk_id"`
	SourceURL     string  `json:"source_url"`
	LicenseNote   string  `json:"source_license_note"`
	Subject       string  `json:"subject"`
	Predicate     string  `json:"predicate"`
	Object        string  `json:"object"`
	Confidence    float64 `json:"confidence"`
	EvidenceText  string  `json:"evidence_text"`
	Status        string  `json:"status"`
	CreatedAt     string  `json:"created_at"`
	ReviewStatus  string  `json:"review_status"`
	ReviewerID    string  `json:"reviewer_id"`
	ReviewerNote  string  `json:"reviewer_note"`
	ReviewedAt    string  `json:"reviewed_at"`
}

type GlossaryTerm struct {
	Term       string `json:"term"`
	TermID     string `json:"term_id"`
	Definition string `json:"definition"`
	SourceURL  string `json:"source_url"`
	Version    string `json:"version"`
	Source     string `json:"source"`
	License    string `json:"license"`
}

func (g *Gateway) CorpusSummary(response http.ResponseWriter, _ *http.Request) {
	chunks, terms, err := g.loadCorpus()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "corpus_load_failed"})
		return
	}

	noiseTitles := map[string]bool{
		"Previous topic":    true,
		"Next topic":        true,
		"This page":         true,
		"Navigation":        true,
		"Table of Contents": true,
	}
	noiseCount := 0
	overlongCount := 0
	codeCount := 0
	version := ""
	sourceCounts := map[string]int{}
	for _, chunk := range chunks {
		if version == "" {
			version = chunk.Version
		}
		sourceCounts[corpusSourceLabel(chunk)]++
		if noiseTitles[chunk.Title] {
			noiseCount++
		}
		if chunk.CharCount > 3200 {
			overlongCount++
		}
		if chunk.CodeBlockCount > 0 {
			codeCount++
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"version":              version,
		"chunk_count":          len(chunks),
		"glossary_term_count":  len(terms),
		"noise_chunk_count":    noiseCount,
		"overlong_chunk_count": overlongCount,
		"code_chunk_count":     codeCount,
		"source_count":         len(sourceCounts),
		"sources":              corpusSourceSummaries(sourceCounts),
	})
}

func (g *Gateway) CorpusChunks(response http.ResponseWriter, request *http.Request) {
	chunks, _, err := g.loadCorpus()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "corpus_load_failed"})
		return
	}

	query := strings.ToLower(strings.TrimSpace(request.URL.Query().Get("q")))
	docID := strings.TrimSpace(request.URL.Query().Get("doc_id"))
	qualityFlag := strings.TrimSpace(request.URL.Query().Get("quality_flag"))
	hasCode := request.URL.Query().Get("has_code") == "true"

	filtered := make([]CorpusChunk, 0, len(chunks))
	for _, chunk := range chunks {
		if docID != "" && chunk.DocID != docID {
			continue
		}
		if hasCode && chunk.CodeBlockCount == 0 {
			continue
		}
		if qualityFlag != "" && !containsString(chunk.QualityFlags, qualityFlag) {
			continue
		}
		if query != "" {
			haystack := strings.ToLower(chunk.Title + " " + chunk.Text + " " + chunk.SourceURL + " " + chunk.DocID)
			if !strings.Contains(haystack, query) {
				continue
			}
		}
		filtered = append(filtered, chunk)
	}

	writeJSON(response, http.StatusOK, map[string]any{
		"chunks": filtered,
	})
}

func (g *Gateway) CorpusChunkDetail(response http.ResponseWriter, request *http.Request) {
	chunkID := pathvar.Vars(request)["id"]
	if chunkID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "chunk_id_required"})
		return
	}
	chunks, _, err := g.loadCorpus()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "corpus_load_failed"})
		return
	}
	for _, chunk := range chunks {
		if chunk.ChunkID == chunkID {
			writeJSON(response, http.StatusOK, map[string]any{"chunk": chunk})
			return
		}
	}
	writeJSON(response, http.StatusNotFound, map[string]string{"error": "chunk_not_found"})
}

func (g *Gateway) CorpusGlossary(response http.ResponseWriter, _ *http.Request) {
	_, terms, err := g.loadCorpus()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "corpus_load_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"terms": terms})
}

func (g *Gateway) KGCandidates(response http.ResponseWriter, request *http.Request) {
	candidates, err := g.loadKGCandidates()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "kg_candidates_load_failed"})
		return
	}
	if err := g.mergeKGCandidateReviews(request.Context(), candidates); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "kg_candidate_reviews_lookup_failed"})
		return
	}

	status := strings.TrimSpace(request.URL.Query().Get("status"))
	query := strings.ToLower(strings.TrimSpace(request.URL.Query().Get("q")))
	subject := strings.TrimSpace(request.URL.Query().Get("subject"))
	object := strings.TrimSpace(request.URL.Query().Get("object"))
	minConfidence, err := parseOptionalConfidence(request.URL.Query().Get("min_confidence"))
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_min_confidence"})
		return
	}
	statusCounts := map[string]int{}
	for _, candidate := range candidates {
		statusCounts[candidate.Status]++
	}

	filtered := make([]KGCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if status != "" && candidate.Status != status {
			continue
		}
		if subject != "" && candidate.Subject != subject {
			continue
		}
		if object != "" && candidate.Object != object {
			continue
		}
		if minConfidence != nil && candidate.Confidence < *minConfidence {
			continue
		}
		if query != "" {
			haystack := strings.ToLower(strings.Join([]string{
				candidate.CandidateID,
				candidate.SourceID,
				candidate.SourceChunkID,
				candidate.SourceURL,
				candidate.LicenseNote,
				candidate.Subject,
				candidate.Predicate,
				candidate.Object,
				candidate.EvidenceText,
				candidate.Status,
			}, " "))
			if !strings.Contains(haystack, query) {
				continue
			}
		}
		filtered = append(filtered, candidate)
	}

	writeJSON(response, http.StatusOK, map[string]any{
		"candidate_count": len(candidates),
		"filtered_count":  len(filtered),
		"status_counts":   statusCounts,
		"candidates":      filtered,
	})
}

func (g *Gateway) KGCandidateReview(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	defer request.Body.Close()

	candidateID := strings.TrimSpace(pathvar.Vars(request)["id"])
	if candidateID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "candidate_id_required"})
		return
	}
	candidateExists, err := g.kgCandidateExists(candidateID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "kg_candidates_load_failed"})
		return
	}
	if !candidateExists {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "candidate_not_found"})
		return
	}

	var payload struct {
		Status       string `json:"status"`
		ReviewerID   string `json:"reviewer_id"`
		ReviewerNote string `json:"reviewer_note"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	status := strings.TrimSpace(payload.Status)
	if !store.IsValidKGCandidateReviewStatus(status) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_review_status"})
		return
	}
	reviewerID := strings.TrimSpace(payload.ReviewerID)
	if reviewerID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "reviewer_id_required"})
		return
	}

	review, err := g.store.UpsertKGCandidateReview(request.Context(), store.KGCandidateReviewInput{
		CandidateID:  candidateID,
		Status:       status,
		ReviewerID:   reviewerID,
		ReviewerNote: payload.ReviewerNote,
	})
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "kg_candidate_review_upsert_failed"})
		return
	}
	writeJSON(response, http.StatusOK, review)
}

func (g *Gateway) mergeKGCandidateReviews(ctx context.Context, candidates []KGCandidate) error {
	for index := range candidates {
		candidates[index].ReviewStatus = "pending"
	}
	if g.store == nil {
		return nil
	}

	reviews, err := g.store.ListKGCandidateReviews(ctx)
	if err != nil {
		return err
	}
	reviewByCandidateID := make(map[string]store.KGCandidateReview, len(reviews))
	for _, review := range reviews {
		reviewByCandidateID[review.CandidateID] = review
	}
	for index := range candidates {
		review, ok := reviewByCandidateID[candidates[index].CandidateID]
		if !ok {
			continue
		}
		candidates[index].ReviewStatus = review.Status
		candidates[index].ReviewerID = review.ReviewerID
		candidates[index].ReviewerNote = review.ReviewerNote
		candidates[index].ReviewedAt = review.ReviewedAt.Format(time.RFC3339Nano)
	}
	return nil
}

func (g *Gateway) loadCorpus() ([]CorpusChunk, []GlossaryTerm, error) {
	sourceDirs := []string{g.corpusDir}
	if _, err := os.Stat(filepath.Join(g.corpusDir, "chunks.jsonl")); err != nil {
		sourceDirs = []string{
			filepath.Join(g.corpusDir, "python-docs-3.14.6"),
			filepath.Join(g.corpusDir, "think-python-2e"),
			filepath.Join(g.corpusDir, "py4e-html3"),
			filepath.Join(g.corpusDir, "runoob-python3"),
		}
	}

	var chunks []CorpusChunk
	var terms []GlossaryTerm
	for _, sourceDir := range sourceDirs {
		sourceChunks, err := readJSONL[CorpusChunk](filepath.Join(sourceDir, "chunks.jsonl"))
		if err != nil {
			return nil, nil, err
		}
		for index := range sourceChunks {
			sourceChunks[index] = enrichCorpusChunk(sourceChunks[index], sourceDir)
		}
		chunks = append(chunks, sourceChunks...)

		sourceTerms, err := readJSONL[GlossaryTerm](filepath.Join(sourceDir, "glossary_terms.jsonl"))
		if err == nil {
			terms = append(terms, sourceTerms...)
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, nil, err
		}
	}
	return chunks, terms, nil
}

func enrichCorpusChunk(chunk CorpusChunk, sourceDir string) CorpusChunk {
	sourceID := strings.TrimSpace(chunk.SourceID)
	if sourceID == "" {
		sourceID = filepath.Base(sourceDir)
	}
	chunk.SourceID = sourceID
	if strings.TrimSpace(chunk.Source) == "" {
		chunk.Source = corpusSourceName(sourceID)
	}
	if strings.TrimSpace(chunk.License) == "" {
		chunk.License = corpusLicenseName(sourceID, chunk.LicenseNote)
	}
	return chunk
}

func corpusSourceLabel(chunk CorpusChunk) string {
	if strings.TrimSpace(chunk.Source) != "" {
		return chunk.Source
	}
	return corpusSourceName(chunk.SourceID)
}

func corpusSourceName(sourceID string) string {
	switch sourceID {
	case "python-docs-3.14.6":
		return "Python official docs"
	case "think-python-2e":
		return "Think Python"
	case "py4e-html3":
		return "Python for Everybody"
	case "runoob-python3":
		return "Runoob Python3"
	default:
		if strings.TrimSpace(sourceID) == "" {
			return "Unknown source"
		}
		return sourceID
	}
}

func corpusLicenseName(sourceID string, licenseNote string) string {
	if strings.TrimSpace(licenseNote) != "" {
		return licenseNote
	}
	switch sourceID {
	case "python-docs-3.14.6":
		return "Python Software Foundation License"
	case "think-python-2e", "py4e-html3":
		return "Creative Commons source"
	case "runoob-python3":
		return "Private development source copy"
	default:
		return ""
	}
}

func corpusSourceSummaries(sourceCounts map[string]int) []map[string]any {
	sources := make([]map[string]any, 0, len(sourceCounts))
	for source, count := range sourceCounts {
		sources = append(sources, map[string]any{
			"source": source,
			"count":  count,
		})
	}
	sort.Slice(sources, func(i, j int) bool {
		left := fmt.Sprint(sources[i]["source"])
		right := fmt.Sprint(sources[j]["source"])
		return left < right
	})
	return sources
}

func (g *Gateway) loadKGCandidates() ([]KGCandidate, error) {
	return readJSONL[KGCandidate](g.kgCandidatePath)
}

func (g *Gateway) kgCandidateExists(candidateID string) (bool, error) {
	candidates, err := g.loadKGCandidates()
	if err != nil {
		return false, err
	}
	for _, candidate := range candidates {
		if candidate.CandidateID == candidateID {
			return true, nil
		}
	}
	return false, nil
}

func parseOptionalConfidence(raw string) (*float64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil, err
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
		return nil, strconv.ErrRange
	}
	return &value, nil
}

func readJSONL[T any](path string) ([]T, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var records []T
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record T
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func (g *Gateway) forwardJSON(response http.ResponseWriter, ctx context.Context, method string, path string, payload any) {
	status, body, err := g.callAI(ctx, method, path, payload)
	if err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{
			"error": "ai_core_unavailable",
		})
		return
	}
	writeRawJSON(response, status, body)
}

func (g *Gateway) callAI(ctx context.Context, method string, path string, payload any) (int, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}

	request, err := http.NewRequestWithContext(ctx, method, g.aiCoreURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Content-Type", "application/json")

	upstream, err := g.client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer upstream.Body.Close()

	responseBody, err := io.ReadAll(upstream.Body)
	if err != nil {
		return 0, nil, err
	}
	return upstream.StatusCode, responseBody, nil
}

func writeRawJSON(response http.ResponseWriter, status int, body []byte) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_, _ = response.Write(body)
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(payload)
}

func tokenUsageTotalFromEvidence(evidence map[string]any) int {
	usage, ok := evidence["token_usage"].(map[string]any)
	if !ok {
		trace, traceOK := evidence["learning_trace"].(map[string]any)
		if !traceOK {
			return 0
		}
		usage, ok = trace["token_usage"].(map[string]any)
		if !ok {
			return 0
		}
	}
	switch value := usage["total_tokens"].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		parsed, err := value.Int64()
		if err == nil {
			return int(parsed)
		}
	}
	return 0
}

func writeNDJSONEvent(response http.ResponseWriter, payload any) {
	_ = json.NewEncoder(response).Encode(payload)
}

func mvpSkills() []Skill {
	return []Skill{
		{
			ID:          "student-learning/retrieve-first-gate",
			Name:        "Retrieve-first gate",
			Description: "先让学生回忆、预测或解释，再提供提示。",
			MVP:         true,
		},
		{
			ID:          "student-learning/progressive-hint-ladder",
			Name:        "Progressive hint ladder",
			Description: "按层级给提示，避免直接给最终答案。",
			MVP:         true,
		},
		{
			ID:          "student-learning/stuck-and-error-diagnosis-coach",
			Name:        "Stuck and error diagnosis coach",
			Description: "先定位卡点和错误类型，再进入调试。",
			MVP:         true,
		},
		{
			ID:          "student-learning/confidence-calibration-check",
			Name:        "Confidence calibration check",
			Description: "记录学生答前和答后信心，形成学习证据。",
			MVP:         true,
		},
		{
			ID:          "student-learning/teach-back-evaluator",
			Name:        "Teach-back evaluator",
			Description: "要求学生复述关键理解，验证不是看懂幻觉。",
			MVP:         true,
		},
	}
}
