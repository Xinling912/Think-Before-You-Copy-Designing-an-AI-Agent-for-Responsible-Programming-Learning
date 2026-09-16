package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"responsible-edu-agent/services/api-gateway-go/internal/store"

	"github.com/zeromicro/go-zero/rest/pathvar"
)

func TestHealthReturnsGatewayStatus(t *testing.T) {
	gateway := NewGateway(Config{})
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()

	gateway.Health(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("expected JSON body: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected ok status, got %q", body["status"])
	}
	if body["service"] != "api-gateway-go" {
		t.Fatalf("expected api-gateway-go service, got %q", body["service"])
	}
}

func TestPrepareTokenDebitRequiresDeliveredDirectAnswer(t *testing.T) {
	decision := tokenChargeDecision{
		Chargeable: true,
		ReasonCode: "direct_solution_request",
	}
	evidence := map[string]any{
		"direct_answer_given": false,
		"token_usage":         map[string]any{"total_tokens": 180},
	}

	debit, charged := prepareTokenDebit(decision, "participant-1", evidence)

	if debit != nil || charged != 0 {
		t.Fatalf("undelivered direct answer charged: %#v, %d", debit, charged)
	}
	stored, _ := evidence["token_charge_decision"].(map[string]any)
	if stored["delivery_status"] != "not_delivered" {
		t.Fatalf("delivery status = %#v, want not_delivered", stored["delivery_status"])
	}
}

func TestPrepareTokenDebitDebitsDeliveredDirectAnswer(t *testing.T) {
	decision := tokenChargeDecision{
		Chargeable: true,
		ReasonCode: "direct_solution_request",
	}
	evidence := map[string]any{
		"direct_answer_given":    true,
		"direct_answer_contract": map[string]any{"question_free": true},
		"token_usage":            map[string]any{"total_tokens": 180},
	}

	debit, charged := prepareTokenDebit(decision, "participant-1", evidence)

	if debit == nil || charged != 180 || debit.TotalTokens != 180 {
		t.Fatalf("delivered direct answer debit = %#v, %d", debit, charged)
	}
	stored, _ := evidence["token_charge_decision"].(map[string]any)
	if stored["delivery_status"] != "delivered" {
		t.Fatalf("delivery status = %#v, want delivered", stored["delivery_status"])
	}
}

func TestPrepareTokenDebitRejectsQuestionBearingPaidReply(t *testing.T) {
	decision := tokenChargeDecision{Chargeable: true, ReasonCode: "direct_solution_request"}
	evidence := map[string]any{
		"direct_answer_given":    true,
		"direct_answer_contract": map[string]any{"question_free": false},
		"token_usage":            map[string]any{"total_tokens": 180},
	}

	debit, charged := prepareTokenDebit(decision, "participant-1", evidence)
	if debit != nil || charged != 0 {
		t.Fatalf("question-bearing reply debit = %#v, %d", debit, charged)
	}
	stored := evidence["token_charge_decision"].(map[string]any)
	if stored["delivery_status"] != "not_delivered" {
		t.Fatalf("delivery status = %v", stored["delivery_status"])
	}
}

func TestClassifyTokenChargeUsesValidatedAIModelDecision(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/token-charge/decision" {
			t.Fatalf("unexpected path %s", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"chargeable": false, "reason_code": "ordinary_tutoring_request", "confidence": 0.96,
			"decision_source": "llm", "model": "qwen-test",
		})
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{AICoreURL: aiCore.URL})
	decision, err := gateway.classifyTokenCharge(
		context.Background(),
		"Give me the direct answer: why is list[4] invalid?",
		nil,
		store.ConversationProjectionRecord{},
		"",
	)

	if err != nil {
		t.Fatalf("classify token charge: %v", err)
	}
	if decision.Chargeable || decision.ReasonCode != "ordinary_tutoring_request" || decision.DecisionSource != "llm" {
		t.Fatalf("validated AI decision must remain authoritative: %#v", decision)
	}
}

func TestGatewayAIClientTimeoutAllowsModelBackedSessionSteps(t *testing.T) {
	gateway := NewGateway(Config{})

	if gateway.client.Timeout != 120*time.Second {
		t.Fatalf("AI Core client timeout = %s, want 120s for one-repair test generation", gateway.client.Timeout)
	}
}

func TestSkillsReturnsMVPFiveFirst(t *testing.T) {
	gateway := NewGateway(Config{})
	request := httptest.NewRequest(http.MethodGet, "/api/skills", nil)
	response := httptest.NewRecorder()

	gateway.Skills(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}

	var body struct {
		Skills []struct {
			ID  string `json:"id"`
			MVP bool   `json:"mvp"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("expected JSON body: %v", err)
	}

	want := []string{
		"student-learning/retrieve-first-gate",
		"student-learning/progressive-hint-ladder",
		"student-learning/stuck-and-error-diagnosis-coach",
		"student-learning/confidence-calibration-check",
		"student-learning/teach-back-evaluator",
	}
	if len(body.Skills) < len(want) {
		t.Fatalf("expected at least %d skills, got %d", len(want), len(body.Skills))
	}
	for index, skillID := range want {
		if body.Skills[index].ID != skillID {
			t.Fatalf("skill %d: expected %q, got %q", index, skillID, body.Skills[index].ID)
		}
		if !body.Skills[index].MVP {
			t.Fatalf("skill %q should be marked as MVP", skillID)
		}
	}
}

func TestKGPathForwardsToAICore(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/ai/kg/reason" {
			t.Fatalf("expected /ai/kg/reason, got %s", request.URL.Path)
		}
		if request.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", request.Method)
		}
		var body map[string]string
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("expected JSON request body: %v", err)
		}
		if body["target"] != "IndexError" {
			t.Fatalf("expected target IndexError, got %q", body["target"])
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"target": "IndexError",
			"path": []map[string]string{
				{"id": "Concept:list"},
				{"id": "Concept:index"},
				{"id": "Concept:zero_based_index"},
				{"id": "ErrorType:IndexError"},
			},
		})
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{AICoreURL: aiCore.URL})
	request := httptest.NewRequest(http.MethodGet, "/api/kg/path?target=IndexError", nil)
	response := httptest.NewRecorder()

	gateway.KGPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "ErrorType:IndexError") {
		t.Fatalf("expected KG path in response, got %s", response.Body.String())
	}
}

func TestKGOverviewForwardsToAICore(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/ai/kg/overview" {
			t.Fatalf("expected /ai/kg/overview, got %s", request.URL.Path)
		}
		if request.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", request.Method)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"version": "kg-test-version",
			"counts": map[string]int{
				"nodes":                           83,
				"categories":                      6,
				"curated_relation_triples":        364,
				"unique_relation_triples":         367,
				"visual_directed_pairs":           197,
				"internal_relation_triples":       312,
				"cross_category_relation_triples": 55,
				"paths":                           160,
				"raw_edge_records":                3500,
			},
			"integrity":    map[string]any{"valid": true},
			"categories":   []map[string]string{{"id": "collections-and-access"}},
			"nodes":        []map[string]string{{"node_id": "Concept:list"}},
			"relations":    []map[string]string{{"key": "Concept:list|contains|Concept:index"}},
			"visual_edges": []map[string]string{{"source": "Concept:list", "target": "Concept:index"}},
			"paths":        []map[string]any{{"path": []string{"Concept:list", "Concept:index"}}},
		})
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{AICoreURL: aiCore.URL})
	request := httptest.NewRequest(http.MethodGet, "/api/kg/overview", nil)
	response := httptest.NewRecorder()

	gateway.KGOverview(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, expected := range []string{`"unique_relation_triples":367`, `"visual_directed_pairs":197`, `"categories"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected %s in KG overview response, got %s", expected, body)
		}
	}
}

func TestSessionStartCreatesPersistentSession(t *testing.T) {
	sessionStore := &fakeSessionStore{
		session: store.Session{
			ID:       "session-demo",
			Scenario: "index-error",
			Status:   "active",
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/start",
		strings.NewReader(`{"scenario":"index-error"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionStart(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.createdScenario != "index-error" {
		t.Fatalf("expected store to create index-error session, got %q", sessionStore.createdScenario)
	}
	if !strings.Contains(response.Body.String(), "session-demo") {
		t.Fatalf("expected created session in response, got %s", response.Body.String())
	}
}

func TestCurrentSessionReturnsLatestActiveSessionWithMessages(t *testing.T) {
	sessionStore := &fakeSessionStore{
		sessions: []store.SessionSummary{
			{
				ID:              "session-empty-newer",
				Scenario:        "python-learning",
				Status:          "active",
				MessageCount:    0,
				LatestMessageAt: "2026-07-10T00:18:18Z",
			},
			{
				ID:              "session-recovered-20260709-list-indexerror",
				Scenario:        "python-list-indexerror-recovered",
				Status:          "active",
				MessageCount:    24,
				LatestMessageAt: "2026-07-09T14:37:40Z",
			},
		},
		detail: store.SessionDetail{
			Session: store.Session{
				ID:       "session-recovered-20260709-list-indexerror",
				Scenario: "python-list-indexerror-recovered",
				Status:   "active",
			},
			Messages: []store.Message{
				{ID: 1, SessionID: "session-recovered-20260709-list-indexerror", Role: "student", Content: "list[4]怎么不行？"},
			},
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/session/current", nil)
	response := httptest.NewRecorder()

	gateway.CurrentSession(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.listSessionsStatus != "active" {
		t.Fatalf("expected active session lookup, got %q", sessionStore.listSessionsStatus)
	}
	if sessionStore.detailSessionID != "session-recovered-20260709-list-indexerror" {
		t.Fatalf("expected recovered session detail, got %q", sessionStore.detailSessionID)
	}
	if sessionStore.createdScenario != "" {
		t.Fatalf("current session should reuse instead of create, created %q", sessionStore.createdScenario)
	}
	if !strings.Contains(response.Body.String(), "session-recovered-20260709-list-indexerror") {
		t.Fatalf("expected recovered session in response, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"reused":true`) {
		t.Fatalf("expected reused marker in response, got %s", response.Body.String())
	}
}

func TestCurrentSessionReturnsEmptyWhenNoActiveSessionsExist(t *testing.T) {
	sessionStore := &fakeSessionStore{}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/session/current", nil)
	response := httptest.NewRecorder()

	gateway.CurrentSession(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.createdScenario != "" {
		t.Fatalf("current session must not create fallback sessions, created %q", sessionStore.createdScenario)
	}
	if !strings.Contains(response.Body.String(), `"session":null`) {
		t.Fatalf("expected empty session in response, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"created":false`) {
		t.Fatalf("expected created=false marker in response, got %s", response.Body.String())
	}
}

func TestSessionMessageForwardsToAICore(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/ai/session/step" {
			t.Fatalf("expected /ai/session/step, got %s", request.URL.Path)
		}
		if request.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", request.Method)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("expected JSON request body: %v", err)
		}
		if body["message"] != "为什么我的 list 报 IndexError？" {
			t.Fatalf("unexpected message: %v", body["message"])
		}
		writeJSON(response, http.StatusOK, task6WithConversationState(map[string]any{
			"skill_id":                 "student-learning/retrieve-first-gate",
			"requires_student_attempt": true,
			"direct_answer_given":      false,
			"prompt":                   "先判断 list 的长度和访问索引。",
			"learning_trace": map[string]any{
				"query_understanding": map[string]any{
					"intent":          "error_debugging",
					"rewritten_query": "Python list IndexError valid range",
					"concept_hints":   []string{"Concept:list", "Concept:index"},
				},
				"kg_grounding": map[string]any{
					"selected_node_ids": []string{"Concept:list", "Concept:index", "ErrorType:IndexError"},
				},
				"rag_evidence": []map[string]any{
					{
						"rank":  1,
						"title": "Lists",
						"url":   "https://docs.python.org/3/tutorial/datastructures.html",
					},
				},
				"answer": "先判断 list 的长度和访问索引。",
			},
			"evidence": map[string]any{
				"cognitive_gate": "retrieval",
			},
		}, "demo", "client-turn-forward"))
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{AICoreURL: aiCore.URL})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"demo","client_turn_id":"client-turn-forward","message":"为什么我的 list 报 IndexError？"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "retrieve-first-gate") {
		t.Fatalf("expected skill response, got %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"direct_answer_given":true`) {
		t.Fatalf("gateway must not turn the first step into a direct answer: %s", response.Body.String())
	}
}

func TestSessionMessageEndpointsForwardFocusWithoutChangingRecentMessages(t *testing.T) {
	recentMessages := []any{
		map[string]any{"role": "student", "content": "Earlier we discussed Concept:set."},
		map[string]any{"role": "agent", "content": "Compare sets with lists."},
	}

	tests := []struct {
		name        string
		gatewayPath string
		aiCorePath  string
		stream      bool
	}{
		{
			name:        "non-streaming",
			gatewayPath: "/api/session/message",
			aiCorePath:  "/ai/session/step",
		},
		{
			name:        "streaming",
			gatewayPath: "/api/session/message/stream",
			aiCorePath:  "/ai/session/step/stream",
			stream:      true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var forwarded map[string]any
			aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path != test.aiCorePath {
					t.Errorf("expected %s, got %s", test.aiCorePath, request.URL.Path)
				}
				if err := json.NewDecoder(request.Body).Decode(&forwarded); err != nil {
					t.Errorf("expected JSON request body: %v", err)
				}
				fixture := task6WithConversationState(map[string]any{}, "session-demo", "client-turn-focus")
				if test.stream {
					response.Header().Set("Content-Type", "application/x-ndjson")
					_ = json.NewEncoder(response).Encode(map[string]any{"type": "trace_completed_payload", "response": fixture})
					return
				}
				writeJSON(response, http.StatusOK, fixture)
			}))
			defer aiCore.Close()

			requestBody, err := json.Marshal(map[string]any{
				"session_id":              "session-demo",
				"client_turn_id":          "client-turn-focus",
				"message":                 "Explain functions next.",
				"requested_focus_node_id": "Concept:function",
				"recent_messages":         recentMessages,
			})
			if err != nil {
				t.Fatalf("marshal request body: %v", err)
			}

			gateway := NewGateway(Config{AICoreURL: aiCore.URL})
			request := httptest.NewRequest(http.MethodPost, test.gatewayPath, bytes.NewReader(requestBody))
			response := httptest.NewRecorder()
			if test.stream {
				gateway.SessionMessageStream(response, request)
			} else {
				gateway.SessionMessage(response, request)
			}

			if forwarded["requested_focus_node_id"] != "Concept:function" {
				t.Fatalf("expected requested focus to pass through unchanged, got %#v", forwarded["requested_focus_node_id"])
			}
			if !reflect.DeepEqual(forwarded["recent_messages"], recentMessages) {
				t.Fatalf("expected recent messages to remain unchanged, got %#v want %#v", forwarded["recent_messages"], recentMessages)
			}
		})
	}
}

func TestSessionMessageEndpointsPreserveInvalidFocusResponse(t *testing.T) {
	const upstreamBody = `{"error":"invalid_focus_node_id"}`
	tests := []struct {
		name        string
		gatewayPath string
		stream      bool
	}{
		{name: "non-streaming", gatewayPath: "/api/session/message"},
		{name: "streaming", gatewayPath: "/api/session/message/stream", stream: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				response.WriteHeader(http.StatusUnprocessableEntity)
				_, _ = response.Write([]byte(upstreamBody))
			}))
			defer aiCore.Close()

			gateway := NewGateway(Config{AICoreURL: aiCore.URL})
			request := httptest.NewRequest(
				http.MethodPost,
				test.gatewayPath,
				strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-invalid-focus","message":"Explain functions next.","requested_focus_node_id":"Concept:not_exists"}`),
			)
			response := httptest.NewRecorder()
			if test.stream {
				gateway.SessionMessageStream(response, request)
			} else {
				gateway.SessionMessage(response, request)
			}

			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected status 422, got %d: %s", response.Code, response.Body.String())
			}
			if response.Body.String() != upstreamBody {
				t.Fatalf("expected unchanged upstream body %s, got %s", upstreamBody, response.Body.String())
			}
		})
	}
}

func TestSessionMessageForwardsClientTurnAndStoredProjection(t *testing.T) {
	forwarded, _, response := runConversationStateGatewayRequest(t, false, task6ConversationStateFixture())
	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if forwarded["client_turn_id"] != "client-turn-1" {
		t.Fatalf("client_turn_id = %#v, want client-turn-1", forwarded["client_turn_id"])
	}
	assertForwardedStoredProjection(t, forwarded)
}

func TestSessionMessageStreamForwardsClientTurnAndStoredProjection(t *testing.T) {
	forwarded, _, response := runConversationStateGatewayRequest(t, true, task6ConversationStateFixture())
	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if forwarded["client_turn_id"] != "client-turn-1" {
		t.Fatalf("client_turn_id = %#v, want client-turn-1", forwarded["client_turn_id"])
	}
	assertForwardedStoredProjection(t, forwarded)
}

func TestCallerProjectionCannotOverrideStoredProjection(t *testing.T) {
	forwarded, sessionStore, response := runConversationStateGatewayRequest(t, false, task6ConversationStateFixture())
	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	assertForwardedStoredProjection(t, forwarded)
	if !reflect.DeepEqual(sessionStore.projectionLookups, []string{"session-demo"}) {
		t.Fatalf("projection lookups = %#v, want session-demo", sessionStore.projectionLookups)
	}
}

func TestSessionMessageRejectsMissingClientTurnID(t *testing.T) {
	assertMissingClientTurnRejected(t, false)
}

func TestSessionMessageStreamRejectsMissingClientTurnID(t *testing.T) {
	assertMissingClientTurnRejected(t, true)
}

func TestSessionMessagePersistsReturnedConversationState(t *testing.T) {
	_, sessionStore, response := runConversationStateGatewayRequest(t, false, task6ConversationStateFixture())
	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	assertPersistedConversationState(t, sessionStore)
}

func TestSessionMessageStreamPersistsReturnedConversationState(t *testing.T) {
	fixture := task6ConversationStateFixture()
	_, nonStreamStore, nonStreamResponse := runConversationStateGatewayRequest(t, false, fixture)
	if nonStreamResponse.Code != http.StatusOK {
		t.Fatalf("non-stream status = %d: %s", nonStreamResponse.Code, nonStreamResponse.Body.String())
	}
	_, streamStore, streamResponse := runConversationStateGatewayRequest(t, true, fixture)
	if streamResponse.Code != http.StatusOK {
		t.Fatalf("stream status = %d: %s", streamResponse.Code, streamResponse.Body.String())
	}
	assertPersistedConversationState(t, streamStore)

	nonStreamEvents, err := json.Marshal(nonStreamStore.persistedCompletedTurns[0].ConversationEvents)
	if err != nil {
		t.Fatalf("marshal non-stream events: %v", err)
	}
	streamEvents, err := json.Marshal(streamStore.persistedCompletedTurns[0].ConversationEvents)
	if err != nil {
		t.Fatalf("marshal stream events: %v", err)
	}
	if !bytes.Equal(nonStreamEvents, streamEvents) {
		t.Fatalf("persisted event JSON differs: non-stream=%s stream=%s", nonStreamEvents, streamEvents)
	}
	nonStreamProjection, err := json.Marshal(nonStreamStore.persistedCompletedTurns[0].ConversationProjection)
	if err != nil {
		t.Fatalf("marshal non-stream projection: %v", err)
	}
	streamProjection, err := json.Marshal(streamStore.persistedCompletedTurns[0].ConversationProjection)
	if err != nil {
		t.Fatalf("marshal stream projection: %v", err)
	}
	if !bytes.Equal(nonStreamProjection, streamProjection) {
		t.Fatalf("persisted projection JSON differs: non-stream=%s stream=%s", nonStreamProjection, streamProjection)
	}
}

func TestSessionMessageDoesNotPersistFailedAIResponse(t *testing.T) {
	assertFailedAIResponsePersistsNothing(t, false)
	assertMissingConversationStatePersistsNothing(t, false)
	assertMismatchedReturnedProjectionPersistsNothing(t, false)
	assertSQLiteFailedTurnPersistsNothing(t, false, http.StatusBadGateway, map[string]any{"error": "upstream_failed"})
	assertSQLiteFailedTurnPersistsNothing(t, false, http.StatusOK, map[string]any{"prompt": "missing state"})
	assertSQLiteInvalidEventEnvelopeRollsBack(t, false)
}

func TestSessionMessageStreamDoesNotPersistFailedAIResponse(t *testing.T) {
	assertFailedAIResponsePersistsNothing(t, true)
	assertMissingConversationStatePersistsNothing(t, true)
	assertMismatchedReturnedProjectionPersistsNothing(t, true)
	assertSQLiteFailedTurnPersistsNothing(t, true, http.StatusBadGateway, map[string]any{"error": "upstream_failed"})
	assertSQLiteFailedTurnPersistsNothing(t, true, http.StatusOK, map[string]any{"prompt": "missing state"})
	assertSQLiteInvalidEventEnvelopeRollsBack(t, true)
}

func TestSessionMessageStreamCompletedPayloadMatchesNonStream(t *testing.T) {
	fixture := task6ConversationStateFixture()
	_, _, nonStreamResponse := runConversationStateGatewayRequest(t, false, fixture)
	if nonStreamResponse.Code != http.StatusOK {
		t.Fatalf("non-stream status = %d: %s", nonStreamResponse.Code, nonStreamResponse.Body.String())
	}
	_, _, streamResponse := runConversationStateGatewayRequest(t, true, fixture)
	if streamResponse.Code != http.StatusOK {
		t.Fatalf("stream status = %d: %s", streamResponse.Code, streamResponse.Body.String())
	}
	var nonStreamPayload map[string]any
	if err := json.Unmarshal(nonStreamResponse.Body.Bytes(), &nonStreamPayload); err != nil {
		t.Fatalf("decode non-stream payload: %v", err)
	}
	streamLines := strings.Split(strings.TrimSpace(streamResponse.Body.String()), "\n")
	var completed map[string]any
	for _, line := range streamLines {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("decode stream event: %v", err)
		}
		if event["type"] == "trace_completed" {
			completed = event
		}
	}
	if completed == nil {
		t.Fatalf("trace_completed missing from %s", streamResponse.Body.String())
	}
	for _, key := range []string{
		"prompt", "turn_resolution", "response_contract", "next_conversation_projection",
		"conversation_events", "student_message_id", "agent_message_id", "learning_trace",
	} {
		if !reflect.DeepEqual(completed[key], nonStreamPayload[key]) {
			t.Fatalf("trace_completed[%q] = %#v, want %#v", key, completed[key], nonStreamPayload[key])
		}
	}
}

func TestSessionMessageRejectsInvalidConversationEventEnvelopeBeforePersistence(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "blank event id", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["event_id"] = "" }},
		{name: "malformed event id", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["event_id"] = "not-a-uuid" }},
		{name: "non-v4 event id", mutate: func(fixture map[string]any) {
			task6FixtureEvents(fixture)[0]["event_id"] = "11111111-1111-1111-8111-111111111111"
		}},
		{name: "duplicate event id", mutate: func(fixture map[string]any) {
			task6FixtureEvents(fixture)[1]["event_id"] = task6FixtureEvents(fixture)[0]["event_id"]
		}},
		{name: "ordinal starts above one", mutate: func(fixture map[string]any) {
			task6FixtureEvents(fixture)[0]["ordinal"] = 2
			task6FixtureEvents(fixture)[1]["ordinal"] = 3
		}},
		{name: "ordinal gap", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[1]["ordinal"] = 3 }},
		{name: "ordinal duplicate", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[1]["ordinal"] = 1 }},
		{name: "sequence starts after stored next", mutate: func(fixture map[string]any) {
			task6FixtureEvents(fixture)[0]["sequence"] = int64(6)
			task6FixtureEvents(fixture)[1]["sequence"] = int64(7)
			task6FixtureProjection(fixture)["last_sequence"] = int64(7)
		}},
		{name: "sequence gap", mutate: func(fixture map[string]any) {
			task6FixtureEvents(fixture)[1]["sequence"] = int64(7)
			task6FixtureProjection(fixture)["last_sequence"] = int64(7)
		}},
		{name: "sequence duplicate", mutate: func(fixture map[string]any) {
			task6FixtureEvents(fixture)[1]["sequence"] = int64(5)
			task6FixtureProjection(fixture)["last_sequence"] = int64(5)
		}},
		{name: "blank event type", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["event_type"] = "" }},
		{name: "unsupported event type", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["event_type"] = "unsupported_event" }},
		{name: "missing payload", mutate: func(fixture map[string]any) { delete(task6FixtureEvents(fixture)[0], "payload") }},
		{name: "null payload", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["payload"] = nil }},
		{name: "non-object payload", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["payload"] = "not-an-object" }},
		{name: "mismatched session id", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["session_id"] = "another-session" }},
		{name: "mismatched client turn id", mutate: func(fixture map[string]any) { task6FixtureEvents(fixture)[0]["client_turn_id"] = "another-turn" }},
		{name: "projection final sequence mismatch", mutate: func(fixture map[string]any) { task6FixtureProjection(fixture)["last_sequence"] = int64(7) }},
	}

	for _, stream := range []bool{false, true} {
		mode := "non-stream"
		if stream {
			mode = "stream"
		}
		for _, test := range tests {
			t.Run(mode+"/"+test.name, func(t *testing.T) {
				fixture := task6ConversationStateFixture()
				test.mutate(fixture)
				_, sessionStore, response := runConversationStateGatewayRequest(t, stream, fixture)
				if response.Code != http.StatusBadGateway {
					t.Fatalf("status = %d, want 502: %s", response.Code, response.Body.String())
				}
				if strings.TrimSpace(response.Body.String()) != `{"error":"invalid_ai_core_response"}` {
					t.Fatalf("body = %s", response.Body.String())
				}
				if sessionStore.persistCompletedTurnCalls != 0 {
					t.Fatalf("completed-turn persistence calls = %d, want 0", sessionStore.persistCompletedTurnCalls)
				}
				if len(sessionStore.persistedCompletedTurns) != 0 || len(sessionStore.savedLearningEpisodes) != 0 {
					t.Fatalf("invalid envelope persisted artifacts: completed=%#v episodes=%#v", sessionStore.persistedCompletedTurns, sessionStore.savedLearningEpisodes)
				}
			})
		}
	}
}

func TestDuplicateClientTurnReturns409WithoutCallingAICore(t *testing.T) {
	for _, stream := range []bool{false, true} {
		name := "non-stream"
		if stream {
			name = "stream"
		}
		t.Run(name, func(t *testing.T) {
			aiCalls := 0
			aiCore := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				aiCalls++
			}))
			defer aiCore.Close()
			sessionStore := task6FakeStore()
			sessionStore.committedClientTurns = map[string]bool{"session-demo/client-turn-1": true}
			gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sessionStore})
			request := httptest.NewRequest(http.MethodPost, task6GatewayPath(stream), strings.NewReader(task6RequestJSON()))
			response := httptest.NewRecorder()
			invokeSessionMessage(gateway, response, request, stream)

			if response.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409: %s", response.Code, response.Body.String())
			}
			if strings.TrimSpace(response.Body.String()) != `{"client_turn_id":"client-turn-1","error":"duplicate_client_turn_id"}` {
				t.Fatalf("body = %s", response.Body.String())
			}
			if aiCalls != 0 {
				t.Fatalf("AI calls = %d, want 0", aiCalls)
			}
			if len(sessionStore.persistedCompletedTurns) != 0 || len(sessionStore.savedLearningEpisodes) != 0 {
				t.Fatalf("duplicate turn persisted artifacts: completed=%#v episodes=%#v", sessionStore.persistedCompletedTurns, sessionStore.savedLearningEpisodes)
			}
		})
	}

	t.Run("sqlite-non-stream", func(t *testing.T) {
		sqliteStore, session := task6SQLiteStoreWithSession(t)
		persistTask6ConversationTurn(t, sqliteStore, session.ID, "client-turn-1", 1, "33333333-3333-4333-8333-333333333333")
		aiCalls := 0
		aiCore := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { aiCalls++ }))
		defer aiCore.Close()
		gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sqliteStore})
		requestBody := strings.ReplaceAll(task6RequestJSON(), "session-demo", session.ID)
		request := httptest.NewRequest(http.MethodPost, "/api/session/message", strings.NewReader(requestBody))
		response := httptest.NewRecorder()
		gateway.SessionMessage(response, request)

		if response.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409: %s", response.Code, response.Body.String())
		}
		if aiCalls != 0 {
			t.Fatalf("AI calls = %d, want 0", aiCalls)
		}
		detail, err := sqliteStore.GetSessionDetail(context.Background(), session.ID)
		if err != nil {
			t.Fatalf("load session detail: %v", err)
		}
		if len(detail.Messages) != 2 || len(detail.EvidenceEvents) != 1 {
			t.Fatalf("duplicate changed stored artifacts: messages=%d evidence=%d", len(detail.Messages), len(detail.EvidenceEvents))
		}
	})
}

func TestStaleProjectionReturns409WithoutPartialPersistence(t *testing.T) {
	for _, stream := range []bool{false, true} {
		name := "non-stream"
		if stream {
			name = "stream"
		}
		t.Run(name, func(t *testing.T) {
			_, sessionStore, response := runConversationStateGatewayRequestWithStoreError(
				t,
				stream,
				task6ConversationStateFixture(),
				store.ErrConversationProjectionSequenceMismatch,
			)
			if response.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409: %s", response.Code, response.Body.String())
			}
			if strings.TrimSpace(response.Body.String()) != `{"error":"conversation_state_conflict"}` {
				t.Fatalf("body = %s", response.Body.String())
			}
			if len(sessionStore.persistedCompletedTurns) != 0 {
				t.Fatalf("stale turn persisted completed artifacts: %#v", sessionStore.persistedCompletedTurns)
			}
		})
	}

	for _, stream := range []bool{false, true} {
		name := "sqlite-non-stream"
		if stream {
			name = "sqlite-stream"
		}
		t.Run(name, func(t *testing.T) {
			sqliteStore, session := task6SQLiteStoreWithSession(t)
			fixture := task6ConversationStateFixtureFor(session.ID, "client-turn-1", 1)
			aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/internal/token-charge/decision" {
					writeTokenChargeDecision(response, false)
					return
				}
				persistTask6ConversationTurn(t, sqliteStore, session.ID, "concurrent-turn", 1, "44444444-4444-4444-8444-444444444444")
				if stream {
					response.Header().Set("Content-Type", "application/x-ndjson")
					if err := json.NewEncoder(response).Encode(map[string]any{"type": "trace_completed_payload", "response": fixture}); err != nil {
						t.Errorf("encode stream fixture: %v", err)
					}
					return
				}
				writeJSON(response, http.StatusOK, fixture)
			}))
			defer aiCore.Close()
			gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sqliteStore})
			requestBody := strings.ReplaceAll(task6RequestJSON(), "session-demo", session.ID)
			request := httptest.NewRequest(http.MethodPost, task6GatewayPath(stream), strings.NewReader(requestBody))
			response := httptest.NewRecorder()
			invokeSessionMessage(gateway, response, request, stream)

			if response.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409: %s", response.Code, response.Body.String())
			}
			if strings.TrimSpace(response.Body.String()) != `{"error":"conversation_state_conflict"}` {
				t.Fatalf("body = %s", response.Body.String())
			}
			detail, err := sqliteStore.GetSessionDetail(context.Background(), session.ID)
			if err != nil {
				t.Fatalf("load session detail: %v", err)
			}
			if len(detail.Messages) != 2 || len(detail.EvidenceEvents) != 1 {
				t.Fatalf("stale turn partially persisted: messages=%d evidence=%d", len(detail.Messages), len(detail.EvidenceEvents))
			}
			committed, err := sqliteStore.ConversationTurnCommitted(context.Background(), session.ID, "client-turn-1")
			if err != nil {
				t.Fatalf("check stale client turn: %v", err)
			}
			if committed {
				t.Fatal("stale client turn must not be committed")
			}
			projection, err := sqliteStore.GetConversationProjection(context.Background(), session.ID)
			if err != nil {
				t.Fatalf("load projection: %v", err)
			}
			if projection.LastSequence != 1 {
				t.Fatalf("projection sequence = %d, want concurrent sequence 1", projection.LastSequence)
			}
			episodes, err := sqliteStore.ListLearningEpisodes(context.Background(), "anonymous-demo", 20)
			if err != nil {
				t.Fatalf("list learning episodes: %v", err)
			}
			if len(episodes) != 0 {
				t.Fatalf("stale turn left learning episodes: %#v", episodes)
			}
		})
	}
}

func task6ConversationStateFixture() map[string]any {
	return task6ConversationStateFixtureFor("session-demo", "client-turn-1", 5)
}

func task6ConversationStateFixtureFor(sessionID, clientTurnID string, firstSequence int64) map[string]any {
	finalSequence := firstSequence + 1
	return map[string]any{
		"prompt": "Dictionary keys identify values.",
		"turn_resolution": map[string]any{
			"original_message": "What is a key?", "resolved_question": "What is a dictionary key?", "workflow_action": "continue",
		},
		"response_contract": map[string]any{
			"answer_body": "Dictionary keys identify values.", "answer_language": "English",
		},
		"learning_trace": map[string]any{"answer": "Dictionary keys identify values."},
		"conversation_events": []map[string]any{
			{
				"event_id": "11111111-1111-4111-8111-111111111111", "session_id": sessionID, "client_turn_id": clientTurnID,
				"ordinal": 1, "sequence": firstSequence, "event_type": "user_message_received", "payload": map[string]any{"message": "What is a key?"},
			},
			{
				"event_id": "22222222-2222-4222-8222-222222222222", "session_id": sessionID, "client_turn_id": clientTurnID,
				"ordinal": 2, "sequence": finalSequence, "event_type": "assistant_response_committed", "payload": map[string]any{"answer": "Dictionary keys identify values."},
			},
		},
		"next_conversation_projection": map[string]any{
			"schema_version": 1, "last_sequence": finalSequence, "active_topic_id": "topic-dictionary",
			"back_stack": []any{}, "topics": map[string]any{"topic-dictionary": map[string]any{"topic_id": "topic-dictionary"}},
		},
	}
}

func task6FixtureEvents(fixture map[string]any) []map[string]any {
	return fixture["conversation_events"].([]map[string]any)
}

func task6FixtureProjection(fixture map[string]any) map[string]any {
	return fixture["next_conversation_projection"].(map[string]any)
}

func task6WithConversationState(response map[string]any, sessionID, clientTurnID string) map[string]any {
	state := task6ConversationStateFixtureFor(sessionID, clientTurnID, 1)
	response["conversation_events"] = state["conversation_events"]
	response["next_conversation_projection"] = state["next_conversation_projection"]
	return response
}

func task6SQLiteStoreWithSession(t *testing.T) (*store.SQLiteStore, store.Session) {
	t.Helper()
	sqliteStore, err := store.OpenSQLite(filepath.Join(t.TempDir(), "gateway-task6.db"))
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	t.Cleanup(func() { _ = sqliteStore.Close() })
	session, err := sqliteStore.CreateSession(context.Background(), "python-learning")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	return sqliteStore, session
}

func persistTask6ConversationTurn(t *testing.T, sqliteStore *store.SQLiteStore, sessionID, clientTurnID string, sequence int64, eventID string) {
	t.Helper()
	_, err := sqliteStore.PersistCompletedSessionTurn(context.Background(), store.CompletedSessionTurnInput{
		SessionID:      sessionID,
		StudentContent: "stored student message",
		AgentContent:   "stored agent message",
		Evidence:       map[string]any{"prompt": "stored agent message"},
		ConversationEvents: []store.ConversationEventInput{{
			EventID: eventID, SessionID: sessionID, ClientTurnID: clientTurnID,
			Ordinal: 1, Sequence: sequence, EventType: "assistant_response_committed", Payload: map[string]any{"answer": "stored agent message"},
		}},
		ConversationProjection: &store.ConversationProjectionRecord{
			SessionID: sessionID, LastSequence: sequence,
			Projection: map[string]any{
				"schema_version": 1, "last_sequence": sequence, "active_topic_id": "topic-dictionary",
				"back_stack": []any{}, "topics": map[string]any{"topic-dictionary": map[string]any{"topic_id": "topic-dictionary"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("persist conversation turn: %v", err)
	}
}

func task6StoredProjection() store.ConversationProjectionRecord {
	return store.ConversationProjectionRecord{
		SessionID:    "session-demo",
		LastSequence: 4,
		Projection: map[string]any{
			"schema_version": 1, "last_sequence": int64(4), "active_topic_id": "topic-dictionary",
			"back_stack": []any{}, "topics": map[string]any{"topic-dictionary": map[string]any{"topic_id": "topic-dictionary"}},
		},
	}
}

func task6FakeStore() *fakeSessionStore {
	return &fakeSessionStore{
		session:                store.Session{ID: "session-demo", Scenario: "python-learning", Status: "active"},
		conversationProjection: task6StoredProjection(),
	}
}

func task6RequestJSON() string {
	return `{"session_id":"session-demo","client_turn_id":"client-turn-1","message":"What is a key?","conversation_projection":{"schema_version":99,"last_sequence":999}}`
}

func task6GatewayPath(stream bool) string {
	if stream {
		return "/api/session/message/stream"
	}
	return "/api/session/message"
}

func runConversationStateGatewayRequest(t *testing.T, stream bool, fixture map[string]any) (map[string]any, *fakeSessionStore, *httptest.ResponseRecorder) {
	t.Helper()
	return runConversationStateGatewayRequestWithStoreError(t, stream, fixture, nil)
}

func runConversationStateGatewayRequestWithStoreError(t *testing.T, stream bool, fixture map[string]any, persistErr error) (map[string]any, *fakeSessionStore, *httptest.ResponseRecorder) {
	t.Helper()
	forwarded := map[string]any{}
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&forwarded); err != nil {
			t.Errorf("decode forwarded payload: %v", err)
			return
		}
		if stream {
			response.Header().Set("Content-Type", "application/x-ndjson")
			if err := json.NewEncoder(response).Encode(map[string]any{"type": "trace_completed_payload", "response": fixture}); err != nil {
				t.Errorf("encode stream fixture: %v", err)
			}
			return
		}
		writeJSON(response, http.StatusOK, fixture)
	}))
	t.Cleanup(aiCore.Close)

	sessionStore := task6FakeStore()
	sessionStore.completedTurnErr = persistErr
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sessionStore})
	request := httptest.NewRequest(http.MethodPost, task6GatewayPath(stream), strings.NewReader(task6RequestJSON()))
	response := httptest.NewRecorder()
	invokeSessionMessage(gateway, response, request, stream)
	return forwarded, sessionStore, response
}

func invokeSessionMessage(gateway *Gateway, response http.ResponseWriter, request *http.Request, stream bool) {
	if stream {
		gateway.SessionMessageStream(response, request)
		return
	}
	gateway.SessionMessage(response, request)
}

func assertForwardedStoredProjection(t *testing.T, forwarded map[string]any) {
	t.Helper()
	projection, ok := forwarded["conversation_projection"].(map[string]any)
	if !ok {
		t.Fatalf("conversation_projection = %#v, want object", forwarded["conversation_projection"])
	}
	if projection["schema_version"] != float64(1) || projection["last_sequence"] != float64(4) {
		t.Fatalf("forwarded projection = %#v, want stored schema 1 sequence 4", projection)
	}
}

func assertPersistedConversationState(t *testing.T, sessionStore *fakeSessionStore) {
	t.Helper()
	if len(sessionStore.persistedCompletedTurns) != 1 {
		t.Fatalf("completed turns = %d, want 1", len(sessionStore.persistedCompletedTurns))
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if len(completed.ConversationEvents) != 2 {
		t.Fatalf("conversation events = %#v, want 2", completed.ConversationEvents)
	}
	if completed.ConversationEvents[0].ClientTurnID != "client-turn-1" || completed.ConversationEvents[1].Sequence != 6 {
		t.Fatalf("conversation events = %#v", completed.ConversationEvents)
	}
	if completed.ConversationProjection == nil || completed.ConversationProjection.LastSequence != 6 {
		t.Fatalf("conversation projection = %#v, want sequence 6", completed.ConversationProjection)
	}
	if completed.ConversationProjection.SessionID != "session-demo" {
		t.Fatalf("projection session = %q, want session-demo", completed.ConversationProjection.SessionID)
	}
}

func assertMissingClientTurnRejected(t *testing.T, stream bool) {
	t.Helper()
	aiCalls := 0
	aiCore := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { aiCalls++ }))
	defer aiCore.Close()
	sessionStore := task6FakeStore()
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sessionStore})
	request := httptest.NewRequest(http.MethodPost, task6GatewayPath(stream), strings.NewReader(`{"session_id":"session-demo","message":"What is a key?"}`))
	response := httptest.NewRecorder()
	invokeSessionMessage(gateway, response, request, stream)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", response.Code, response.Body.String())
	}
	if strings.TrimSpace(response.Body.String()) != `{"error":"client_turn_id_required"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
	if aiCalls != 0 || len(sessionStore.persistedCompletedTurns) != 0 || len(sessionStore.savedLearningEpisodes) != 0 {
		t.Fatalf("missing ID reached side effects: ai=%d completed=%#v episodes=%#v", aiCalls, sessionStore.persistedCompletedTurns, sessionStore.savedLearningEpisodes)
	}
}

func assertFailedAIResponsePersistsNothing(t *testing.T, stream bool) {
	t.Helper()
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "upstream_failed"})
	}))
	defer aiCore.Close()
	sessionStore := task6FakeStore()
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sessionStore})
	request := httptest.NewRequest(http.MethodPost, task6GatewayPath(stream), strings.NewReader(task6RequestJSON()))
	response := httptest.NewRecorder()
	invokeSessionMessage(gateway, response, request, stream)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", response.Code, response.Body.String())
	}
	if len(sessionStore.persistedCompletedTurns) != 0 {
		t.Fatalf("failed AI response persisted completed turn: %#v", sessionStore.persistedCompletedTurns)
	}
	if len(sessionStore.savedLearningEpisodes) != 0 || len(sessionStore.markedFailedEpisodes) != 0 {
		t.Fatalf("failed AI response persisted episode artifacts: saved=%#v failed=%#v", sessionStore.savedLearningEpisodes, sessionStore.markedFailedEpisodes)
	}
}

func assertMissingConversationStatePersistsNothing(t *testing.T, stream bool) {
	t.Helper()
	fixture := map[string]any{"prompt": "AI success without conversation state"}
	_, sessionStore, response := runConversationStateGatewayRequest(t, stream, fixture)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("missing conversation state status = %d, want 502: %s", response.Code, response.Body.String())
	}
	if strings.TrimSpace(response.Body.String()) != `{"error":"invalid_ai_core_response"}` {
		t.Fatalf("missing conversation state body = %s", response.Body.String())
	}
	if len(sessionStore.persistedCompletedTurns) != 0 || len(sessionStore.savedLearningEpisodes) != 0 || len(sessionStore.markedFailedEpisodes) != 0 {
		t.Fatalf("missing conversation state persisted artifacts: completed=%#v saved=%#v failed=%#v", sessionStore.persistedCompletedTurns, sessionStore.savedLearningEpisodes, sessionStore.markedFailedEpisodes)
	}
}

func assertMismatchedReturnedProjectionPersistsNothing(t *testing.T, stream bool) {
	t.Helper()
	fixture := task6ConversationStateFixture()
	fixture["next_conversation_projection"].(map[string]any)["last_sequence"] = int64(7)
	_, sessionStore, response := runConversationStateGatewayRequest(t, stream, fixture)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("mismatched projection status = %d, want 502: %s", response.Code, response.Body.String())
	}
	if strings.TrimSpace(response.Body.String()) != `{"error":"invalid_ai_core_response"}` {
		t.Fatalf("mismatched projection body = %s", response.Body.String())
	}
	if len(sessionStore.persistedCompletedTurns) != 0 {
		t.Fatalf("mismatched projection persisted completed turn: %#v", sessionStore.persistedCompletedTurns)
	}
	if len(sessionStore.savedLearningEpisodes) != 0 || len(sessionStore.markedFailedEpisodes) != 0 {
		t.Fatalf("mismatched projection persisted episode artifacts: saved=%#v failed=%#v", sessionStore.savedLearningEpisodes, sessionStore.markedFailedEpisodes)
	}
}

func assertSQLiteFailedTurnPersistsNothing(t *testing.T, stream bool, upstreamStatus int, fixture map[string]any) {
	t.Helper()
	sqliteStore, session := task6SQLiteStoreWithSession(t)
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if stream && upstreamStatus == http.StatusOK {
			response.Header().Set("Content-Type", "application/x-ndjson")
			_ = json.NewEncoder(response).Encode(map[string]any{"type": "trace_completed_payload", "response": fixture})
			return
		}
		writeJSON(response, upstreamStatus, fixture)
	}))
	defer aiCore.Close()
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sqliteStore})
	requestBody := strings.ReplaceAll(task6RequestJSON(), "session-demo", session.ID)
	request := httptest.NewRequest(http.MethodPost, task6GatewayPath(stream), strings.NewReader(requestBody))
	response := httptest.NewRecorder()
	invokeSessionMessage(gateway, response, request, stream)
	if upstreamStatus == http.StatusOK {
		if response.Code != http.StatusBadGateway {
			t.Fatalf("invalid success status = %d, want 502: %s", response.Code, response.Body.String())
		}
	} else if response.Code != upstreamStatus {
		t.Fatalf("upstream failure status = %d, want %d: %s", response.Code, upstreamStatus, response.Body.String())
	}
	assertSQLiteSessionHasNoTurnArtifacts(t, sqliteStore, session.ID, "client-turn-1")
}

func assertSQLiteInvalidEventEnvelopeRollsBack(t *testing.T, stream bool) {
	t.Helper()
	sqliteStore, session := task6SQLiteStoreWithSession(t)
	fixture := task6ConversationStateFixtureFor(session.ID, "client-turn-1", 1)
	fixture["conversation_events"].([]map[string]any)[0]["ordinal"] = 2
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if stream {
			response.Header().Set("Content-Type", "application/x-ndjson")
			_ = json.NewEncoder(response).Encode(map[string]any{"type": "trace_completed_payload", "response": fixture})
			return
		}
		writeJSON(response, http.StatusOK, fixture)
	}))
	defer aiCore.Close()
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sqliteStore})
	requestBody := strings.ReplaceAll(task6RequestJSON(), "session-demo", session.ID)
	request := httptest.NewRequest(http.MethodPost, task6GatewayPath(stream), strings.NewReader(requestBody))
	response := httptest.NewRecorder()
	invokeSessionMessage(gateway, response, request, stream)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("invalid envelope status = %d, want 502: %s", response.Code, response.Body.String())
	}
	assertSQLiteSessionHasNoTurnArtifacts(t, sqliteStore, session.ID, "client-turn-1")
}

func assertSQLiteSessionHasNoTurnArtifacts(t *testing.T, sqliteStore *store.SQLiteStore, sessionID, clientTurnID string) {
	t.Helper()
	detail, err := sqliteStore.GetSessionDetail(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("load session detail: %v", err)
	}
	if len(detail.Messages) != 0 || len(detail.EvidenceEvents) != 0 {
		t.Fatalf("failed turn persisted messages/evidence: messages=%d evidence=%d", len(detail.Messages), len(detail.EvidenceEvents))
	}
	episodes, err := sqliteStore.ListLearningEpisodes(context.Background(), "anonymous-demo", 20)
	if err != nil {
		t.Fatalf("list learning episodes: %v", err)
	}
	if len(episodes) != 0 {
		t.Fatalf("failed turn persisted learning episodes: %#v", episodes)
	}
	committed, err := sqliteStore.ConversationTurnCommitted(context.Background(), sessionID, clientTurnID)
	if err != nil {
		t.Fatalf("check client turn: %v", err)
	}
	if committed {
		t.Fatalf("failed client turn %q was committed", clientTurnID)
	}
	projection, err := sqliteStore.GetConversationProjection(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("load conversation projection: %v", err)
	}
	if projection.LastSequence != 0 {
		t.Fatalf("failed turn advanced projection to %d", projection.LastSequence)
	}
}

func TestSessionMessagePersistsMessageAndEvidence(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, task6WithConversationState(map[string]any{
			"skill_id":                 "student-learning/retrieve-first-gate",
			"requires_student_attempt": true,
			"direct_answer_given":      false,
			"prompt":                   "先判断 list 的长度和访问索引。",
			"learning_trace": map[string]any{
				"query_understanding": map[string]any{
					"intent":          "error_debugging",
					"rewritten_query": "Python list IndexError valid range",
					"concept_hints":   []string{"Concept:list", "Concept:index"},
				},
				"kg_grounding": map[string]any{
					"selected_node_ids": []string{"Concept:list", "Concept:index", "ErrorType:IndexError"},
				},
				"rag_evidence": []map[string]any{
					{
						"rank":  1,
						"title": "Lists",
						"url":   "https://docs.python.org/3/tutorial/datastructures.html",
					},
				},
				"answer": "先判断 list 的长度和访问索引。",
			},
			"evidence": map[string]any{
				"cognitive_gate": "retrieval",
			},
		}, "session-demo", "client-turn-persist"))
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{}
	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-persist","message":"为什么我的 list 报 IndexError？"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if len(sessionStore.persistedCompletedTurns) != 1 {
		t.Fatalf("expected completed turn persistence, got %#v", sessionStore.persistedCompletedTurns)
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if completed.SessionID != "session-demo" {
		t.Fatalf("expected completed turn for session-demo, got %q", completed.SessionID)
	}
	if completed.StudentContent != "为什么我的 list 报 IndexError？" {
		t.Fatalf("unexpected student content: %q", completed.StudentContent)
	}
	if completed.Evidence["skill_id"] != "student-learning/retrieve-first-gate" {
		t.Fatalf("expected retrieve-first evidence, got %#v", completed.Evidence)
	}
	trace, ok := completed.Evidence["learning_trace"].(map[string]any)
	if !ok {
		t.Fatalf("expected persisted learning_trace map, got %#v", completed.Evidence["learning_trace"])
	}
	queryUnderstanding, ok := trace["query_understanding"].(map[string]any)
	if !ok || queryUnderstanding["rewritten_query"] != "Python list IndexError valid range" {
		t.Fatalf("expected nested rewritten query to survive persistence, got %#v", trace["query_understanding"])
	}
	var responseBody map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &responseBody); err != nil {
		t.Fatalf("expected JSON response body: %v", err)
	}
	responseTrace, ok := responseBody["learning_trace"].(map[string]any)
	if !ok {
		t.Fatalf("expected response learning_trace map, got %#v", responseBody["learning_trace"])
	}
	responseQueryUnderstanding, ok := responseTrace["query_understanding"].(map[string]any)
	if !ok || responseQueryUnderstanding["rewritten_query"] != "Python list IndexError valid range" {
		t.Fatalf("expected nested rewritten query to survive proxying, got %#v", responseTrace["query_understanding"])
	}
	if sessionStore.savedSessionID != "" || len(sessionStore.savedMessages) != 0 {
		t.Fatalf("gateway must not use split message/evidence persistence, got evidence=%q messages=%#v", sessionStore.savedSessionID, sessionStore.savedMessages)
	}
}

func TestSessionMessageStreamForwardsTraceEventsAndPersistsFinalTurn(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/internal/token-charge/decision" {
			writeTokenChargeDecision(response, true)
			return
		}
		if request.URL.Path != "/ai/session/step/stream" {
			t.Fatalf("expected /ai/session/step/stream, got %s", request.URL.Path)
		}
		if request.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", request.Method)
		}
		if request.Header.Get("Accept") != "application/x-ndjson" {
			t.Fatalf("expected NDJSON accept header, got %q", request.Header.Get("Accept"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("expected JSON request body: %v", err)
		}
		if body["message"] != "Why does list[4] fail when length is 4?" {
			t.Fatalf("unexpected message: %v", body["message"])
		}
		response.Header().Set("Content-Type", "application/x-ndjson")
		encoder := json.NewEncoder(response)
		events := []map[string]any{
			{
				"type":       "trace_started",
				"session_id": "session-demo",
				"turn_id":    "77",
			},
			{
				"type":       "query_understanding_done",
				"session_id": "session-demo",
				"turn_id":    "77",
				"query_understanding": map[string]any{
					"intent":          "error_debugging",
					"rewritten_query": "Python list IndexError valid range",
					"concept_hints":   []string{"Concept:list", "Concept:index"},
				},
			},
			{
				"type":       "kg_grounding_done",
				"session_id": "session-demo",
				"turn_id":    "77",
				"kg_grounding": map[string]any{
					"selected_node_ids": []string{"Concept:list", "Concept:index"},
					"knowledge_path_view": map[string]any{
						"upstream":       []map[string]string{{"id": "Concept:list", "label": "list"}},
						"current":        []map[string]string{{"id": "Concept:index", "label": "index"}},
						"downstream":     []map[string]string{{"id": "ErrorType:IndexError", "label": "IndexError"}},
						"focus_node_ids": []string{"Concept:index"},
					},
				},
			},
			{
				"type":       "rag_evidence_done",
				"session_id": "session-demo",
				"turn_id":    "77",
				"rag_evidence": []map[string]any{
					{
						"rank":  1,
						"title": "Lists",
						"url":   "https://docs.python.org/3/tutorial/datastructures.html",
					},
				},
			},
			{
				"type":       "guided_response_done",
				"session_id": "session-demo",
				"turn_id":    "77",
				"answer":     "Length 4 means valid indices are 0 through 3.",
			},
			{
				"type": "trace_completed_payload",
				"response": task6WithConversationState(map[string]any{
					"skill_id":                 "student-learning/retrieve-first-gate",
					"requires_student_attempt": true,
					"direct_answer_given":      false,
					"prompt":                   "Length 4 means valid indices are 0 through 3.",
					"learning_trace": map[string]any{
						"query_understanding": map[string]any{
							"intent":          "error_debugging",
							"rewritten_query": "Python list IndexError valid range",
						},
						"token_usage": map[string]any{
							"total_tokens": 180,
						},
						"answer": "Length 4 means valid indices are 0 through 3.",
					},
					"token_usage": map[string]any{
						"total_tokens": 180,
					},
					"evidence": map[string]any{
						"cognitive_gate": "retrieval",
					},
				}, "session-demo", "client-turn-stream"),
			},
		}
		for _, event := range events {
			if err := encoder.Encode(event); err != nil {
				t.Fatalf("encode stream event: %v", err)
			}
		}
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{nextEpisodeID: 77}
	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message/stream",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-stream","message":"Why does list[4] fail when length is 4?"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessageStream(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Header().Get("Content-Type"), "application/x-ndjson") {
		t.Fatalf("expected NDJSON content type, got %q", response.Header().Get("Content-Type"))
	}
	lines := strings.Split(strings.TrimSpace(response.Body.String()), "\n")
	var eventTypes []string
	for _, line := range lines {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("expected NDJSON event, got %q: %v", line, err)
		}
		eventType, _ := event["type"].(string)
		eventTypes = append(eventTypes, eventType)
		if eventType == "trace_completed_payload" {
			t.Fatalf("internal completion payload must not be forwarded: %s", response.Body.String())
		}
	}
	wantTypes := []string{
		"trace_started",
		"query_understanding_done",
		"kg_grounding_done",
		"rag_evidence_done",
		"guided_response_done",
		"trace_completed",
	}
	if !reflect.DeepEqual(eventTypes, wantTypes) {
		t.Fatalf("unexpected event order: got %#v want %#v", eventTypes, wantTypes)
	}
	if len(sessionStore.persistedCompletedTurns) != 1 {
		t.Fatalf("expected completed turn persistence, got %#v", sessionStore.persistedCompletedTurns)
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if completed.TokenDebit != nil {
		t.Fatalf("undelivered answer must not debit tokens: %#v", completed.TokenDebit)
	}
	if completed.SessionID != "session-demo" {
		t.Fatalf("expected completed turn for session-demo, got %q", completed.SessionID)
	}
	if completed.StudentContent != "Why does list[4] fail when length is 4?" {
		t.Fatalf("unexpected student content: %q", completed.StudentContent)
	}
	trace, ok := completed.Evidence["learning_trace"].(map[string]any)
	if !ok || trace["answer"] != "Length 4 means valid indices are 0 through 3." {
		t.Fatalf("expected persisted final learning trace, got %#v", completed.Evidence["learning_trace"])
	}
	var completedEvent map[string]any
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &completedEvent); err != nil {
		t.Fatalf("expected final completion event: %v", err)
	}
	if completedEvent["agent_message_id"] != float64(202) {
		t.Fatalf("expected persisted agent message id 202, got %#v", completedEvent["agent_message_id"])
	}
	if sessionStore.atomicTokenDebited != 0 || sessionStore.recordedTokenUsage != 0 {
		t.Fatalf("undelivered response must not debit tokens: atomic=%d legacy=%d", sessionStore.atomicTokenDebited, sessionStore.recordedTokenUsage)
	}
}

func TestSessionMessageStreamStopsWhenTokenBudgetExhausted(t *testing.T) {
	decisionCalled := false
	fullStepCalled := false
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/internal/token-charge/decision":
			decisionCalled = true
			writeTokenChargeDecision(response, true)
		case "/ai/session/step/stream":
			fullStepCalled = true
			response.WriteHeader(http.StatusInternalServerError)
		default:
			t.Fatalf("unexpected AI core request path %s", request.URL.Path)
		}
	}))
	defer aiCore.Close()

	sessionStore := &fakeSessionStore{
		tokenBudget: store.TokenBudget{
			Scope:            store.TokenBudgetScope,
			DailyQuota:       store.DefaultDailyTokenQuota,
			UsedTokens:       store.DefaultDailyTokenQuota,
			RemainingTokens:  0,
			RemainingPercent: 0,
			ResetAt:          "2026-07-13T00:00:00Z",
			UpdatedAt:        "2026-07-13T00:00:00Z",
		},
	}
	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message/stream",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-budget","message":"Why does list[4] fail when length is 4?"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessageStream(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !decisionCalled {
		t.Fatalf("token charge decision must run before rejecting an exhausted budget")
	}
	if fullStepCalled {
		t.Fatalf("full AI step must not run when token budget is exhausted")
	}
	var event map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(response.Body.Bytes()), &event); err != nil {
		t.Fatalf("expected one NDJSON trace_error event: %v", err)
	}
	if event["type"] != "trace_error" || event["failed_stage"] != "token_budget" {
		t.Fatalf("unexpected exhausted-budget event: %#v", event)
	}
}

type tokenChargeGatewayAI struct {
	t                 *testing.T
	chargeable        bool
	reasonCode        string
	decisionStatus    int
	fullStatus        int
	interruptStream   bool
	totalTokens       *int
	directAnswerGiven *bool
	decisionCalls     int
	fullStepCalls     int
	decisionRequests  []map[string]any
	fullStepRequests  []map[string]any
}

func writeTokenChargeDecision(response http.ResponseWriter, chargeable bool) {
	reasonCode := "ordinary_tutoring_request"
	if chargeable {
		reasonCode = "direct_solution_request"
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"chargeable": chargeable, "reason_code": reasonCode, "confidence": 0.96,
		"decision_source": "llm", "model": "qwen-test",
	})
}

func (a *tokenChargeGatewayAI) handler(response http.ResponseWriter, request *http.Request) {
	a.t.Helper()
	switch request.URL.Path {
	case "/internal/token-charge/decision":
		a.decisionCalls++
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			a.t.Fatalf("decode decision request: %v", err)
		}
		a.decisionRequests = append(a.decisionRequests, body)
		if a.decisionStatus != 0 && a.decisionStatus != http.StatusOK {
			writeJSON(response, a.decisionStatus, map[string]string{"error": "classifier_unavailable"})
			return
		}
		reasonCode := a.reasonCode
		if reasonCode == "" {
			if a.chargeable {
				reasonCode = "direct_solution_request"
			} else {
				reasonCode = "ordinary_tutoring_request"
			}
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"chargeable": a.chargeable, "reason_code": reasonCode, "confidence": 0.96,
			"decision_source": "llm", "model": "qwen-test",
		})
	case "/ai/session/step", "/ai/session/step/stream":
		a.fullStepCalls++
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			a.t.Fatalf("decode full-step request: %v", err)
		}
		a.fullStepRequests = append(a.fullStepRequests, body)
		status := a.fullStatus
		if status == 0 {
			status = http.StatusOK
		}
		if status != http.StatusOK {
			writeJSON(response, status, map[string]string{"error": "full_ai_failed"})
			return
		}
		clientTurnID, _ := body["client_turn_id"].(string)
		totalTokens := 180
		if a.totalTokens != nil {
			totalTokens = *a.totalTokens
		}
		directAnswerGiven := true
		if a.directAnswerGiven != nil {
			directAnswerGiven = *a.directAnswerGiven
		}
		fixture := map[string]any{
			"prompt":                 "A completed tutoring response.",
			"direct_answer_given":    directAnswerGiven,
			"direct_answer_contract": map[string]any{"question_free": true},
			"token_usage":            map[string]any{"total_tokens": totalTokens},
			"learning_trace":         map[string]any{"answer": "A completed tutoring response."},
		}
		firstSequence := int64(1)
		if projection, ok := body["conversation_projection"].(map[string]any); ok {
			if last, ok := integerFromJSONValue(projection["last_sequence"]); ok {
				firstSequence = last + 1
			}
		}
		state := task6ConversationStateFixtureFor("session-demo", clientTurnID, firstSequence)
		fixture["conversation_events"] = state["conversation_events"]
		fixture["next_conversation_projection"] = state["next_conversation_projection"]
		if request.URL.Path == "/ai/session/step" {
			writeJSON(response, http.StatusOK, fixture)
			return
		}
		response.Header().Set("Content-Type", "application/x-ndjson")
		if a.interruptStream {
			_, _ = response.Write([]byte("{\"type\":\"trace_started\"}\n{\"type\":"))
			return
		}
		encoder := json.NewEncoder(response)
		_ = encoder.Encode(map[string]any{"type": "trace_started", "session_id": "session-demo"})
		_ = encoder.Encode(map[string]any{"type": "trace_completed_payload", "response": fixture})
	default:
		a.t.Fatalf("unexpected AI core path %s", request.URL.Path)
	}
}

func tokenChargeTestBudget(remaining int) store.TokenBudget {
	quota := store.DefaultDailyTokenQuota
	used := quota - remaining
	if used < 0 {
		used = 0
	}
	percent := 0
	if quota > 0 {
		percent = int(math.Round(float64(remaining) * 100 / float64(quota)))
	}
	return store.TokenBudget{
		Scope: store.TokenBudgetScope, DailyQuota: quota, UsedTokens: used,
		RemainingTokens: remaining, RemainingPercent: percent,
		ResetAt: "2026-07-23T00:00:00+08:00", UpdatedAt: "2026-07-22T12:00:00+08:00",
	}
}

func runTokenChargeMessage(t *testing.T, stream bool, sessionStore *fakeSessionStore, ai *tokenChargeGatewayAI, message, clientTurnID string) *httptest.ResponseRecorder {
	t.Helper()
	aiCore := httptest.NewServer(http.HandlerFunc(ai.handler))
	t.Cleanup(aiCore.Close)
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sessionStore})
	payload, err := json.Marshal(map[string]any{
		"session_id": "session-demo", "client_turn_id": clientTurnID, "message": message,
		"requested_focus_node_id": "Concept:list",
	})
	if err != nil {
		t.Fatalf("marshal message request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/session/message", bytes.NewReader(payload))
	response := httptest.NewRecorder()
	if stream {
		gateway.SessionMessageStream(response, request)
	} else {
		gateway.SessionMessage(response, request)
	}
	return response
}

func TestSessionMessageFreeTurnSkipsBudgetLookupAtZero(t *testing.T) {
	sessionStore := &fakeSessionStore{
		tokenBudget:            tokenChargeTestBudget(0),
		recentMessages:         []store.Message{{Role: "student", Content: "How do dictionary keys work?"}},
		conversationProjection: task6StoredProjection(),
	}
	ai := &tokenChargeGatewayAI{t: t}
	response := runTokenChargeMessage(t, false, sessionStore, ai, "再解释一下 dictionary", "turn-free-zero")
	if response.Code != http.StatusOK {
		t.Fatalf("expected free turn at zero budget to succeed, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.tokenBudgetLookups != 0 {
		t.Fatalf("free turn must skip budget lookup, got %d", sessionStore.tokenBudgetLookups)
	}
	if sessionStore.recordedTokenUsage != 0 || sessionStore.atomicTokenDebited != 0 {
		t.Fatalf("free turn must not debit budget: legacy=%d atomic=%d", sessionStore.recordedTokenUsage, sessionStore.atomicTokenDebited)
	}
	if ai.decisionCalls != 1 || ai.fullStepCalls != 1 || sessionStore.persistCompletedTurnCalls != 1 {
		t.Fatalf("unexpected calls decision=%d full=%d persist=%d", ai.decisionCalls, ai.fullStepCalls, sessionStore.persistCompletedTurnCalls)
	}
	decision, _ := sessionStore.persistedCompletedTurns[0].Evidence["token_charge_decision"].(map[string]any)
	if decision["chargeable"] != false || decision["charged_tokens"] != 0 {
		t.Fatalf("unexpected persisted free decision: %#v", decision)
	}
}

func TestSessionMessageChargeableTurnStopsAtZero(t *testing.T) {
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(0), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	response := runTokenChargeMessage(t, false, sessionStore, ai, "直接给我完整答案", "turn-charge-zero")
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), `"error":"token_budget_exhausted"`) {
		t.Fatalf("expected exhausted response, got %d: %s", response.Code, response.Body.String())
	}
	if ai.fullStepCalls != 0 || sessionStore.persistCompletedTurnCalls != 0 || sessionStore.atomicTokenDebited != 0 {
		t.Fatalf("exhausted request reached full processing: full=%d persist=%d debit=%d", ai.fullStepCalls, sessionStore.persistCompletedTurnCalls, sessionStore.atomicTokenDebited)
	}
	if sessionStore.tokenBudgetLookups != 1 || !strings.Contains(response.Body.String(), `"reason_code":"direct_solution_request"`) {
		t.Fatalf("expected one lookup and structured decision: lookups=%d body=%s", sessionStore.tokenBudgetLookups, response.Body.String())
	}
}

func TestSessionMessageChargeableTurnPersistenceExhaustionReturnsDecisionWithoutDebit(t *testing.T) {
	sessionStore := &fakeSessionStore{
		tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(),
		completedTurnErr: store.ErrTokenBudgetExhausted,
	}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	response := runTokenChargeMessage(t, false, sessionStore, ai, "直接给我完整答案", "turn-charge-race")
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), `"reason_code":"direct_solution_request"`) {
		t.Fatalf("expected exhausted race response with decision, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.persistCompletedTurnCalls != 1 || len(sessionStore.persistedCompletedTurns) != 0 || sessionStore.atomicTokenDebited != 0 {
		t.Fatalf("exhausted transaction leaked artifacts/debit: calls=%d turns=%d debit=%d", sessionStore.persistCompletedTurnCalls, len(sessionStore.persistedCompletedTurns), sessionStore.atomicTokenDebited)
	}
}

func TestSessionMessageChargeableTurnUnavailableUsageCompletesWithoutDebit(t *testing.T) {
	zero := 0
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true, totalTokens: &zero}
	response := runTokenChargeMessage(t, false, sessionStore, ai, "直接给我完整答案", "turn-charge-zero-usage")
	if response.Code != http.StatusOK {
		t.Fatalf("expected zero-usage completion, got %d: %s", response.Code, response.Body.String())
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if completed.TokenDebit != nil || sessionStore.atomicTokenDebited != 0 || sessionStore.recordedTokenUsage != 0 {
		t.Fatalf("zero usage must not debit: input=%#v atomic=%d legacy=%d", completed.TokenDebit, sessionStore.atomicTokenDebited, sessionStore.recordedTokenUsage)
	}
	decision, _ := completed.Evidence["token_charge_decision"].(map[string]any)
	if decision["charged_tokens"] != 0 {
		t.Fatalf("expected charged_tokens=0, got %#v", decision)
	}
}

func TestSessionMessageChargeableFailureDoesNotPersistOrDebit(t *testing.T) {
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true, fullStatus: http.StatusBadGateway}
	response := runTokenChargeMessage(t, false, sessionStore, ai, "Just give me the final answer", "turn-charge-fail")
	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected full AI failure, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.persistCompletedTurnCalls != 0 || sessionStore.atomicTokenDebited != 0 || sessionStore.recordedTokenUsage != 0 {
		t.Fatalf("failed full AI must not persist/debit: persist=%d atomic=%d legacy=%d", sessionStore.persistCompletedTurnCalls, sessionStore.atomicTokenDebited, sessionStore.recordedTokenUsage)
	}
}

func TestSessionMessageDuplicateChargeDebitsOnce(t *testing.T) {
	sessionStore := &fakeSessionStore{
		tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(),
		autoCommitCompletedTurns: true,
	}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	first := runTokenChargeMessage(t, false, sessionStore, ai, "直接给我完整答案", "turn-charge-once")
	second := runTokenChargeMessage(t, false, sessionStore, ai, "直接给我完整答案", "turn-charge-once")
	if first.Code != http.StatusOK || second.Code != http.StatusConflict {
		t.Fatalf("expected success then duplicate conflict, got %d and %d", first.Code, second.Code)
	}
	if ai.decisionCalls != 1 || ai.fullStepCalls != 1 || sessionStore.atomicTokenDebited != 180 {
		t.Fatalf("duplicate caused extra work/debit: decision=%d full=%d debit=%d", ai.decisionCalls, ai.fullStepCalls, sessionStore.atomicTokenDebited)
	}
}

func TestSessionMessageTokenChargePassesContextAndActualUsage(t *testing.T) {
	sessionStore := &fakeSessionStore{
		tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(),
		recentMessages: []store.Message{{Role: "student", Content: "Please solve the list exercise."}, {Role: "agent", Content: "Try the index range first."}},
	}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true, reasonCode: "context_resolved_direct_request"}
	response := runTokenChargeMessage(t, false, sessionStore, ai, "那你直接说答案吧", "turn-context-usage")
	if response.Code != http.StatusOK {
		t.Fatalf("expected success, got %d: %s", response.Code, response.Body.String())
	}
	if len(ai.decisionRequests) != 1 || ai.decisionRequests[0]["active_topic"] != "topic-dictionary" || ai.decisionRequests[0]["selected_node_id"] != "Concept:list" {
		t.Fatalf("classifier did not receive topic/focus context: %#v", ai.decisionRequests)
	}
	if len(ai.fullStepRequests) != 1 {
		t.Fatalf("expected full-step request")
	}
	forwardedDecision, _ := ai.fullStepRequests[0]["token_charge_decision"].(map[string]any)
	if forwardedDecision["reason_code"] != "context_resolved_direct_request" {
		t.Fatalf("full step missing authoritative decision: %#v", forwardedDecision)
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if completed.TokenDebit == nil || completed.TokenDebit.TotalTokens != 180 || sessionStore.recordedTokenUsage != 0 {
		t.Fatalf("expected atomic actual-usage debit: input=%#v legacy=%d", completed.TokenDebit, sessionStore.recordedTokenUsage)
	}
	decision, _ := completed.Evidence["token_charge_decision"].(map[string]any)
	if decision["charged_tokens"] != 180 {
		t.Fatalf("expected charged_tokens=180, got %#v", decision)
	}
	if _, mutated := completed.Evidence["student_message_id"]; mutated {
		t.Fatalf("persisted evidence snapshot was mutated by response enrichment: %#v", completed.Evidence)
	}
}

func TestSessionMessageChargeableUndeliveredAnswerDoesNotDebitInEitherTransport(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "non_stream", true: "stream"}[stream], func(t *testing.T) {
			undelivered := false
			sessionStore := &fakeSessionStore{
				tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(),
			}
			ai := &tokenChargeGatewayAI{t: t, chargeable: true, directAnswerGiven: &undelivered}
			response := runTokenChargeMessage(t, stream, sessionStore, ai, "Just give me the final answer", "turn-undelivered")
			if response.Code != http.StatusOK {
				t.Fatalf("expected completed free turn, got %d: %s", response.Code, response.Body.String())
			}
			completed := sessionStore.persistedCompletedTurns[0]
			if completed.TokenDebit != nil || sessionStore.atomicTokenDebited != 0 {
				t.Fatalf("undelivered answer debited budget: input=%#v atomic=%d", completed.TokenDebit, sessionStore.atomicTokenDebited)
			}
			decision, _ := completed.Evidence["token_charge_decision"].(map[string]any)
			if decision["charged_tokens"] != 0 || decision["delivery_status"] != "not_delivered" {
				t.Fatalf("undelivered decision evidence = %#v", decision)
			}
			if stream && strings.Contains(response.Body.String(), `"type":"token_budget_updated"`) {
				t.Fatalf("undelivered stream must not emit a budget update: %s", response.Body.String())
			}
		})
	}
}

func TestSessionMessageTokenChargeProviderFailureIsAlwaysFree(t *testing.T) {
	tests := []struct {
		name           string
		message        string
		wantChargeable bool
		wantReason     string
		wantStatus     int
		wantFullCalls  int
	}{
		{
			name: "approved Chinese direct request with answer before verb", message: "别问我了，把这道题的正确答案告诉我",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "English direct request", message: "Just give me the final answer",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "English direct-answer wording with question context", message: "Give me the direct answer: why is list[4] invalid?",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "negated request", message: "不要直接给答案，让我自己试",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "meta question", message: "你会直接给答案吗？",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "simple Chinese negative give", message: "不要给我正确答案",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "simple Chinese negative tell", message: "别告诉我正确答案",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "Chinese capability question", message: "你能告诉我正确答案吗？",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
		{
			name: "plain English answer request", message: "give me the answer",
			wantChargeable: false, wantReason: "deterministic_free_default", wantStatus: http.StatusOK, wantFullCalls: 1,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(0), conversationProjection: task6StoredProjection()}
			ai := &tokenChargeGatewayAI{t: t, decisionStatus: http.StatusServiceUnavailable}
			response := runTokenChargeMessage(t, false, sessionStore, ai, test.message, "turn-fallback-"+strings.ReplaceAll(test.name, " ", "-"))
			if response.Code != test.wantStatus || ai.fullStepCalls != test.wantFullCalls {
				t.Fatalf("fallback result status/full = %d/%d, want %d/%d: %s", response.Code, ai.fullStepCalls, test.wantStatus, test.wantFullCalls, response.Body.String())
			}
			var decision map[string]any
			if test.wantChargeable {
				var payload map[string]any
				if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
					t.Fatalf("decode exhausted response: %v", err)
				}
				decision, _ = payload["token_charge_decision"].(map[string]any)
			} else {
				decision, _ = sessionStore.persistedCompletedTurns[0].Evidence["token_charge_decision"].(map[string]any)
			}
			if decision["chargeable"] != test.wantChargeable || decision["reason_code"] != test.wantReason || decision["decision_source"] != "deterministic_fallback" {
				t.Fatalf("fallback decision = %#v, want chargeable=%v reason=%s", decision, test.wantChargeable, test.wantReason)
			}
		})
	}
}

func TestSessionMessageChargeableTurnCapsFakeAtomicDebitAtRemainingBudget(t *testing.T) {
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(100), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	response := runTokenChargeMessage(t, false, sessionStore, ai, "Just give me the final answer", "turn-capped-debit")
	if response.Code != http.StatusOK {
		t.Fatalf("expected capped debit completion, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.atomicTokenDebited != 100 {
		t.Fatalf("fake atomic debit = %d, want actual capped delta 100", sessionStore.atomicTokenDebited)
	}
	if sessionStore.persistedCompletedTurns[0].Result.TokenBudget == nil || sessionStore.persistedCompletedTurns[0].Result.TokenBudget.RemainingTokens != 0 {
		t.Fatalf("fake committed budget did not reach zero: %#v", sessionStore.persistedCompletedTurns[0].Result.TokenBudget)
	}
}

func TestSessionMessageStreamFreeTurnOmitsBudgetUpdate(t *testing.T) {
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(0), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t}
	response := runTokenChargeMessage(t, true, sessionStore, ai, "给我一个提示", "turn-stream-free")
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "token_budget_updated") {
		t.Fatalf("free stream must succeed without budget event: %d %s", response.Code, response.Body.String())
	}
	if sessionStore.tokenBudgetLookups != 0 || sessionStore.atomicTokenDebited != 0 {
		t.Fatalf("free stream touched budget: lookups=%d debit=%d", sessionStore.tokenBudgetLookups, sessionStore.atomicTokenDebited)
	}
}

func TestSessionMessageStreamChargeableTurnStopsAtZero(t *testing.T) {
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(0), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	response := runTokenChargeMessage(t, true, sessionStore, ai, "直接给我完整答案", "turn-stream-charge-zero")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"failed_stage":"token_budget"`) || !strings.Contains(response.Body.String(), `"reason_code":"direct_solution_request"`) {
		t.Fatalf("expected stream exhausted decision event, got %d: %s", response.Code, response.Body.String())
	}
	if ai.fullStepCalls != 0 || sessionStore.persistCompletedTurnCalls != 0 || sessionStore.atomicTokenDebited != 0 {
		t.Fatalf("stream exhausted request reached full processing: full=%d persist=%d debit=%d", ai.fullStepCalls, sessionStore.persistCompletedTurnCalls, sessionStore.atomicTokenDebited)
	}
}

func TestSessionMessageStreamChargeableTurnEmitsCommittedBudget(t *testing.T) {
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	response := runTokenChargeMessage(t, true, sessionStore, ai, "直接给我完整答案", "turn-stream-charge")
	if response.Code != http.StatusOK {
		t.Fatalf("expected stream success, got %d: %s", response.Code, response.Body.String())
	}
	if strings.Count(response.Body.String(), `"type":"token_budget_updated"`) != 1 {
		t.Fatalf("expected exactly one committed budget event: %s", response.Body.String())
	}
	if sessionStore.atomicTokenDebited != 180 || sessionStore.recordedTokenUsage != 0 {
		t.Fatalf("unexpected debit atomic=%d legacy=%d", sessionStore.atomicTokenDebited, sessionStore.recordedTokenUsage)
	}
}

func TestSessionMessageStreamChargeableTurnPersistenceFailureDoesNotEmitCompletionOrDebit(t *testing.T) {
	sessionStore := &fakeSessionStore{
		tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(),
		completedTurnErr: errors.New("persistence failed"),
	}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	response := runTokenChargeMessage(t, true, sessionStore, ai, "直接给我完整答案", "turn-stream-persist-fail")
	if response.Code != http.StatusInternalServerError || strings.Contains(response.Body.String(), "trace_completed") {
		t.Fatalf("expected persistence failure without completion, got %d: %s", response.Code, response.Body.String())
	}
	if len(sessionStore.persistedCompletedTurns) != 0 || sessionStore.atomicTokenDebited != 0 || sessionStore.recordedTokenUsage != 0 {
		t.Fatalf("persistence failure leaked artifacts/debit: turns=%d atomic=%d legacy=%d", len(sessionStore.persistedCompletedTurns), sessionStore.atomicTokenDebited, sessionStore.recordedTokenUsage)
	}
}

func TestSessionMessageStreamChargeableTurnUnavailableUsageOmitsBudgetUpdate(t *testing.T) {
	zero := 0
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true, totalTokens: &zero}
	response := runTokenChargeMessage(t, true, sessionStore, ai, "直接给我完整答案", "turn-stream-zero-usage")
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "token_budget_updated") {
		t.Fatalf("zero-usage stream must complete without budget event: %d %s", response.Code, response.Body.String())
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if completed.TokenDebit != nil || sessionStore.atomicTokenDebited != 0 {
		t.Fatalf("zero-usage stream debited budget: input=%#v debit=%d", completed.TokenDebit, sessionStore.atomicTokenDebited)
	}
}

func TestSessionMessageStreamInterruptedChargeDoesNotPersistOrDebit(t *testing.T) {
	sessionStore := &fakeSessionStore{tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection()}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true, interruptStream: true}
	response := runTokenChargeMessage(t, true, sessionStore, ai, "直接给我完整答案", "turn-stream-interrupt")
	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected interrupted stream failure, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.persistCompletedTurnCalls != 0 || sessionStore.atomicTokenDebited != 0 || sessionStore.recordedTokenUsage != 0 {
		t.Fatalf("interrupted stream persisted/debited: persist=%d atomic=%d legacy=%d", sessionStore.persistCompletedTurnCalls, sessionStore.atomicTokenDebited, sessionStore.recordedTokenUsage)
	}
}

func TestSessionMessageStreamTokenChargePassesSameContextAndActualUsage(t *testing.T) {
	sessionStore := &fakeSessionStore{
		tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(),
		recentMessages: []store.Message{{Role: "student", Content: "Solve the list exercise."}},
	}
	ai := &tokenChargeGatewayAI{t: t, chargeable: true}
	response := runTokenChargeMessage(t, true, sessionStore, ai, "Just give me the final answer", "turn-stream-context")
	if response.Code != http.StatusOK {
		t.Fatalf("expected stream success, got %d: %s", response.Code, response.Body.String())
	}
	if len(ai.decisionRequests) != 1 || ai.decisionRequests[0]["active_topic"] != "topic-dictionary" || ai.decisionRequests[0]["selected_node_id"] != "Concept:list" {
		t.Fatalf("stream classifier context mismatch: %#v", ai.decisionRequests)
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if completed.TokenDebit == nil || completed.TokenDebit.TotalTokens != 180 {
		t.Fatalf("stream persisted wrong debit: %#v", completed.TokenDebit)
	}
}

func TestSessionMessageTokenChargeTransportParity(t *testing.T) {
	recent := []store.Message{
		{Role: "student", Content: "Please solve the list exercise."},
		{Role: "agent", Content: "Try the index range first."},
	}
	stores := []*fakeSessionStore{
		{tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(), recentMessages: recent},
		{tokenBudget: tokenChargeTestBudget(1000), conversationProjection: task6StoredProjection(), recentMessages: recent},
	}
	ais := []*tokenChargeGatewayAI{{t: t, chargeable: true}, {t: t, chargeable: true}}
	nonStream := runTokenChargeMessage(t, false, stores[0], ais[0], "Just give me the final answer", "turn-parity-nonstream")
	stream := runTokenChargeMessage(t, true, stores[1], ais[1], "Just give me the final answer", "turn-parity-stream")
	if nonStream.Code != http.StatusOK || stream.Code != http.StatusOK {
		t.Fatalf("transport parity requests failed: nonstream=%d stream=%d", nonStream.Code, stream.Code)
	}
	if !reflect.DeepEqual(ais[0].decisionRequests, ais[1].decisionRequests) {
		t.Fatalf("classifier context differs by transport: nonstream=%#v stream=%#v", ais[0].decisionRequests, ais[1].decisionRequests)
	}
	leftDebit := stores[0].persistedCompletedTurns[0].TokenDebit
	rightDebit := stores[1].persistedCompletedTurns[0].TokenDebit
	if leftDebit == nil || rightDebit == nil || *leftDebit != *rightDebit {
		t.Fatalf("transport debit mismatch: nonstream=%#v stream=%#v", leftDebit, rightDebit)
	}
}

func TestLearnerProfileReturnsMemoryAndLearningGraph(t *testing.T) {
	now := time.Date(2026, 7, 4, 6, 0, 0, 0, time.UTC)
	sessionStore := &fakeSessionStore{
		v2Memories: []store.LearnerMemoryV2{
			{
				MemoryID:       "memory-index-range",
				LearnerID:      "learner-profile",
				MemoryType:     "misconception",
				Topic:          "list_index_indexerror",
				Content:        "学生认为长度为 2 的 list 可以访问 list[2]。",
				Concepts:       []string{"Concept:list", "Concept:index", "Concept:valid_index_range"},
				Strength:       2,
				UseCount:       3,
				EffectiveScore: 1.12,
				Status:         "active",
				ValidFrom:      now.Add(-2 * time.Hour),
				LastUsedAt:     now.Add(-30 * time.Minute),
				UpdatedAt:      now,
			},
		},
		topicSummaries: []store.TopicSummary{
			{
				LearnerID:          "learner-profile",
				Topic:              "list_index_indexerror",
				Summary:            "学生正在修正 list 索引边界理解。",
				WeakConcepts:       []string{"Concept:valid_index_range"},
				MasteredConcepts:   []string{"Concept:list"},
				NextTeachingAction: "ask_teach_back",
				SourceMemoryIDs:    []string{"memory-index-range"},
				UpdatedAt:          now,
			},
		},
		learningFacts: []store.LearningFact{
			{
				FactID:     "fact-misconception",
				LearnerID:  "learner-profile",
				Subject:    "Learner:learner-profile",
				Predicate:  "has_misconception",
				Object:     "Concept:valid_index_range",
				Confidence: 0.86,
				Status:     "active",
				ValidFrom:  now.Add(-time.Hour),
			},
		},
		learningEntities: []store.LearningEntity{
			{
				EntityID:   "entity-valid-index",
				LearnerID:  "learner-profile",
				EntityType: "concept",
				Label:      "Concept:valid_index_range",
				Confidence: 0.86,
				Status:     "active",
				UpdatedAt:  now,
			},
		},
		memoryEvents: []store.MemoryEvent{
			{
				ID:             1,
				LearnerID:      "learner-profile",
				SessionID:      "session-profile",
				Operation:      "ADD",
				ResultMemoryID: "memory-index-range",
				Reason:         "salient_misconception",
				CreatedAt:      now.Add(-time.Hour),
			},
			{
				ID:             2,
				LearnerID:      "learner-profile",
				SessionID:      "session-profile",
				Operation:      "REINFORCE",
				TargetMemoryID: "memory-index-range",
				ResultMemoryID: "memory-index-range",
				Reason:         "rmm_selected",
				CreatedAt:      now,
			},
		},
		learningEpisodes: []store.LearningEpisode{
			{
				ID:         9,
				LearnerID:  "learner-profile",
				SessionID:  "session-profile",
				Topic:      "list_index_indexerror",
				SkillState: "hint_ladder",
				CreatedAt:  now,
				Payload: map[string]any{
					"memory_reading_plan": map[string]any{
						"topic":                     "list_index_indexerror",
						"selected_memory_ids":       []any{"memory-index-range", "memory-unused-range"},
						"prospective_memory_plan":   "Use selected memories for Concept:index.",
						"selected_topic_summary":    map[string]any{"topic_summary": "学生需要巩固合法索引范围。"},
						"selected_memory_count":     2,
						"selected_topic_summary_id": "list_index_indexerror",
					},
					"retrospective_memory_use": map[string]any{
						"selected_memory_ids":          []any{"memory-index-range", "memory-unused-range"},
						"used_memory_ids":              []any{"memory-index-range"},
						"unused_selected_memory_ids":   []any{"memory-unused-range"},
						"verification_reason":          "model_reported_used_memory_ids",
						"retrospective_memory_use":     "Used 1 of 2 selected memories for list_index_indexerror.",
						"retrieval_refinement":         "Keep retrieval weighting for selected memories that were used.",
						"selected_memory_evidence_tag": "RMM",
					},
				},
			},
		},
		recentMessages: []store.Message{
			{ID: 101, SessionID: "session-profile", Role: "student", Content: "学生短期窗口：while 循环什么时候停？", CreatedAt: "2026-07-04T06:00:00Z"},
			{ID: 102, SessionID: "session-profile", Role: "agent", Content: "AI 短期窗口：先看循环条件何时变为 False。", CreatedAt: "2026-07-04T06:00:01Z"},
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/learner/profile?learner_id=learner-profile", nil)
	response := httptest.NewRecorder()

	gateway.LearnerProfile(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("expected JSON body: %v", err)
	}
	if body["learner_id"] != "learner-profile" {
		t.Fatalf("expected learner id in response, got %#v", body["learner_id"])
	}
	if int(body["active_memory_count"].(float64)) != 1 {
		t.Fatalf("expected active memory count, got %#v", body["active_memory_count"])
	}
	if int(body["memory_event_count"].(float64)) != 2 {
		t.Fatalf("expected memory event count, got %#v", body["memory_event_count"])
	}
	if int(body["rmm_reflection_count"].(float64)) != 1 {
		t.Fatalf("expected one RMM reflection, got %#v", body["rmm_reflection_count"])
	}
	if sessionStore.recentSessionID != "session-profile" {
		t.Fatalf("expected short-term lookup for latest episode session, got %q", sessionStore.recentSessionID)
	}
	shortTermMessages, ok := body["short_term_messages"].([]any)
	if !ok || len(shortTermMessages) != 2 {
		t.Fatalf("expected short-term messages in profile, got %#v", body["short_term_messages"])
	}
	if !strings.Contains(response.Body.String(), "学生短期窗口：while 循环什么时候停？") {
		t.Fatalf("expected student short-term message in profile, got %s", response.Body.String())
	}
	episodes, ok := body["learning_episodes"].([]any)
	if !ok || len(episodes) != 1 {
		t.Fatalf("expected one learning episode payload, got %#v", body["learning_episodes"])
	}
	episode, ok := episodes[0].(map[string]any)
	if !ok {
		t.Fatalf("expected learning episode object, got %#v", episodes[0])
	}
	if int(episode["episode_id"].(float64)) != 9 {
		t.Fatalf("expected episode id 9, got %#v", episode["episode_id"])
	}
	if episode["session_id"] != "session-profile" || episode["topic"] != "list_index_indexerror" || episode["skill_state"] != "hint_ladder" {
		t.Fatalf("unexpected learning episode payload: %#v", episode)
	}
	reflections, ok := body["rmm_reflections"].([]any)
	if !ok || len(reflections) != 1 {
		t.Fatalf("expected one RMM reflection payload, got %#v", body["rmm_reflections"])
	}
	reflection, ok := reflections[0].(map[string]any)
	if !ok {
		t.Fatalf("expected RMM reflection object, got %#v", reflections[0])
	}
	assertJSONStrings(t, reflection["selected_memory_ids"], []string{"memory-index-range", "memory-unused-range"})
	assertJSONStrings(t, reflection["used_memory_ids"], []string{"memory-index-range"})
	assertJSONStrings(t, reflection["unused_selected_memory_ids"], []string{"memory-unused-range"})
	if reflection["verification_reason"] != "model_reported_used_memory_ids" {
		t.Fatalf("unexpected RMM verification reason: %#v", reflection["verification_reason"])
	}
	if reflection["prospective_memory_plan"] != "Use selected memories for Concept:index." {
		t.Fatalf("unexpected RMM prospective plan: %#v", reflection["prospective_memory_plan"])
	}
	if reflection["retrospective_memory_use"] != "Used 1 of 2 selected memories for list_index_indexerror." {
		t.Fatalf("unexpected RMM retrospective use: %#v", reflection["retrospective_memory_use"])
	}
	if reflection["retrieval_refinement"] != "Keep retrieval weighting for selected memories that were used." {
		t.Fatalf("unexpected RMM retrieval refinement: %#v", reflection["retrieval_refinement"])
	}
	if !strings.Contains(response.Body.String(), "MemoryBank") {
		t.Fatalf("expected research grounding in response, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "Used 1 of 2 selected memories") {
		t.Fatalf("expected RMM retrospective evidence in response, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "Use selected memories for Concept:index") {
		t.Fatalf("expected RMM prospective plan in response, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "unused_selected_memory_ids") {
		t.Fatalf("expected RMM selected/unused ids in response, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "has_misconception") {
		t.Fatalf("expected learning fact in response, got %s", response.Body.String())
	}
}

func assertJSONStrings(t *testing.T, value any, expected []string) {
	t.Helper()

	items, ok := value.([]any)
	if !ok {
		t.Fatalf("expected JSON string array %v, got %#v", expected, value)
	}
	actual := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			t.Fatalf("expected JSON string array %v, got %#v", expected, value)
		}
		actual = append(actual, text)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("expected JSON strings %v, got %v", expected, actual)
	}
}

func TestSessionMessageSendsContextMemoryAndPersistsAIOutput(t *testing.T) {
	sessionStore := &fakeSessionStore{
		nextEpisodeID: 1,
		recentMessages: []store.Message{
			{Role: "student", Content: "为什么我的 list 报 IndexError？"},
			{Role: "agent", Content: "请先写出长度和索引。"},
		},
		latestEvidence: map[string]any{
			"confidence_before": 2,
			"skill_state": map[string]any{
				"state": "retrieve_first",
			},
		},
		v2Memories: []store.LearnerMemoryV2{
			{
				MemoryID:       "mem_index_001",
				LearnerID:      "anonymous-demo",
				MemoryType:     "misconception",
				Topic:          "list_index_indexerror",
				Content:        "学生可能把 len(list) 当成最大合法索引。",
				Concepts:       []string{"Concept:index", "Concept:valid_index_range"},
				Strength:       2,
				UseCount:       1,
				EffectiveScore: 2.5,
				Status:         "active",
				Payload:        map[string]any{"source": "prior_turn"},
			},
		},
		topicSummaries: []store.TopicSummary{
			{
				LearnerID:          "anonymous-demo",
				Topic:              "list_index_indexerror",
				Summary:            "学生还在混淆 len(list) 和最大合法索引。",
				WeakConcepts:       []string{"Concept:valid_index_range"},
				MasteredConcepts:   []string{"Concept:list"},
				NextTeachingAction: "先让学生写出合法索引范围。",
				SourceMemoryIDs:    []string{"mem_index_001"},
			},
		},
	}
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/internal/token-charge/decision" {
			writeTokenChargeDecision(response, false)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("expected JSON request body: %v", err)
		}
		if body["baseline_mode"] != "full_memory" {
			t.Fatalf("expected default full_memory baseline, got %#v", body["baseline_mode"])
		}
		if _, ok := body["episode_id"]; ok {
			t.Fatalf("gateway must not forward a provisional episode_id, got %#v", body["episode_id"])
		}
		recent, ok := body["recent_messages"].([]any)
		if !ok || len(recent) != 2 {
			t.Fatalf("expected recent messages in AI payload, got %#v", body["recent_messages"])
		}
		if recent[0].(map[string]any)["content"] != "为什么我的 list 报 IndexError？" || recent[1].(map[string]any)["role"] != "agent" {
			t.Fatalf("expected ordered short-term messages in AI payload, got %#v", recent)
		}
		lastEvidence, ok := body["last_evidence"].(map[string]any)
		if !ok || lastEvidence["confidence_before"].(float64) != 2 {
			t.Fatalf("expected last evidence in AI payload, got %#v", body["last_evidence"])
		}
		if lastEvidence["skill_state"].(map[string]any)["state"] != "retrieve_first" {
			t.Fatalf("expected prior skill state in AI payload, got %#v", body["last_evidence"])
		}
		memories, ok := body["learner_memory"].([]any)
		if !ok || len(memories) != 1 {
			t.Fatalf("expected learner memory in AI payload, got %#v", body["learner_memory"])
		}
		memory := memories[0].(map[string]any)
		if memory["memory_id"] != "mem_index_001" || memory["effective_score"].(float64) != 2.5 {
			t.Fatalf("expected active MemoryBank memory in AI payload, got %#v", memory)
		}
		topics, ok := body["topic_summaries"].([]any)
		if !ok || len(topics) != 1 {
			t.Fatalf("expected topic summaries in AI payload, got %#v", body["topic_summaries"])
		}
		topic := topics[0].(map[string]any)
		if topic["topic"] != "list_index_indexerror" ||
			topic["topic_summary"] != "学生还在混淆 len(list) 和最大合法索引。" ||
			topic["next_teaching_action"] != "先让学生写出合法索引范围。" {
			t.Fatalf("expected mid-term topic summary in AI payload, got %#v", topic)
		}
		taskState, ok := body["task_state"].(map[string]any)
		if !ok || taskState["scenario"] != "index-error" {
			t.Fatalf("expected gateway task_state fallback in AI payload, got %#v", body["task_state"])
		}

		writeJSON(response, http.StatusOK, task6WithConversationState(map[string]any{
			"prompt":   "请判断长度为 2 的 list 最大合法索引是多少？",
			"skill_id": "student-learning/retrieve-first-gate",
			"memory_updates": []map[string]any{
				{
					"operation":        "UPDATE",
					"target_memory_id": "mem_index_001",
					"memory_type":      "misconception",
					"content":          "学生仍在 list[2] 上卡住。",
				},
			},
		}, "session-demo", "client-turn-context"))
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-context","message":"我访问的是 list[2]，长度是 2"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.recentSessionID != "session-demo" {
		t.Fatalf("expected recent messages lookup for session-demo, got %q", sessionStore.recentSessionID)
	}
	if sessionStore.memoryLearnerID != "anonymous-demo" {
		t.Fatalf("expected anonymous-demo memory lookup, got %q", sessionStore.memoryLearnerID)
	}
	if len(sessionStore.persistedCompletedTurns) != 1 {
		t.Fatalf("expected one completed turn, got %#v", sessionStore.persistedCompletedTurns)
	}
	if len(sessionStore.persistedCompletedTurns[0].MemoryEvents) != 1 {
		t.Fatalf("expected one memory event in completed turn, got %#v", sessionStore.persistedCompletedTurns[0].MemoryEvents)
	}
	if sessionStore.persistedCompletedTurns[0].MemoryEvents[0].Operation != "UPDATE" {
		t.Fatalf("expected UPDATE memory event, got %#v", sessionStore.persistedCompletedTurns[0].MemoryEvents[0])
	}
	if sessionStore.persistedCompletedTurns[0].AgentContent != "请判断长度为 2 的 list 最大合法索引是多少？" {
		t.Fatalf("expected agent output in completed turn, got %#v", sessionStore.persistedCompletedTurns[0].AgentContent)
	}
}

func TestSessionMessagePersistsResearchGroundedEpisodeMemoryAndFacts(t *testing.T) {
	sessionStore := &fakeSessionStore{
		nextEpisodeID: 77,
		v2Memories: []store.LearnerMemoryV2{
			{
				MemoryID:       "mem_existing",
				LearnerID:      "learner-a",
				MemoryType:     "misconception",
				Topic:          "list_index_indexerror",
				Content:        "学生把 len(list) 当成最大合法索引。",
				Concepts:       []string{"Concept:index", "Concept:valid_index_range"},
				Strength:       2,
				UseCount:       1,
				EffectiveScore: 2.69,
				Status:         "active",
				Payload:        map[string]any{"source": "prior_turn"},
			},
		},
		topicSummaries: []store.TopicSummary{
			{
				LearnerID:          "learner-a",
				Topic:              "list_index_indexerror",
				Summary:            "Topic list_index_indexerror: weak concepts=[Concept:index].",
				WeakConcepts:       []string{"Concept:index"},
				MasteredConcepts:   []string{},
				NextTeachingAction: "Ask for max valid index first.",
				SourceMemoryIDs:    []string{"mem_existing"},
			},
		},
	}
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/internal/token-charge/decision" {
			writeTokenChargeDecision(response, false)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("expected JSON request body: %v", err)
		}
		if _, ok := body["episode_id"]; ok {
			t.Fatalf("gateway must not forward a provisional episode_id, got %#v", body["episode_id"])
		}
		memories, ok := body["learner_memory"].([]any)
		if !ok || len(memories) != 1 {
			t.Fatalf("expected one v2 learner memory, got %#v", body["learner_memory"])
		}
		memory := memories[0].(map[string]any)
		if memory["memory_id"] != "mem_existing" || memory["effective_score"].(float64) != 2.69 {
			t.Fatalf("expected v2 memory contract, got %#v", memory)
		}
		summaries, ok := body["topic_summaries"].([]any)
		if !ok || len(summaries) != 1 {
			t.Fatalf("expected one topic summary, got %#v", body["topic_summaries"])
		}

		writeJSON(response, http.StatusOK, task6WithConversationState(map[string]any{
			"prompt":   "先别急着要答案。长度为 2 时最大合法索引是多少？",
			"skill_id": "student-learning/progressive-hint-ladder",
			"skill_state": map[string]any{
				"state": "hint_ladder",
			},
			"next_task_state": map[string]any{
				"topic": "list_index_indexerror",
			},
			"memory_updates": []map[string]any{
				{
					"operation":   "ADD",
					"memory_type": "misconception",
					"topic":       "list_index_indexerror",
					"concepts":    []string{"Concept:index", "Concept:valid_index_range"},
					"content":     "学生仍认为长度为 2 的 list 可以访问 list[2]。",
					"reason":      "student_mentions_length_two_and_list_index_two",
					"confidence":  0.95,
				},
			},
			"memory_reinforcement": []map[string]any{
				{
					"operation":       "REINFORCE",
					"memory_id":       "mem_existing",
					"use_count_delta": 1,
					"strength_delta":  1,
					"reason":          "selected_by_rmm_prospective_plan",
				},
			},
			"topic_summary_update": map[string]any{
				"topic":                "list_index_indexerror",
				"topic_summary":        "Topic list_index_indexerror: weak concepts=[Concept:valid_index_range].",
				"weak_concepts":        []string{"Concept:valid_index_range"},
				"mastered_concepts":    []string{"Concept:index"},
				"next_teaching_action": "Use a transfer question after diagnostic feedback.",
				"source_memory_ids":    []string{"mem_existing"},
			},
			"learning_facts": []map[string]any{
				{
					"fact_id":           "fact_gateway_test",
					"learner_id":        "learner-a",
					"subject":           "Learner:learner-a",
					"predicate":         "has_misconception",
					"object":            "Misconception:list_index_indexerror",
					"confidence":        0.95,
					"source_episode_id": 999,
					"valid_from":        "2026-07-03T00:00:00Z",
					"status":            "active",
					"payload":           map[string]any{"source": "ai-core"},
				},
			},
		}, "session-demo", "client-turn-research"))
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-research","learner_id":"learner-a","message":"我访问的是 list[2]，长度是 2"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if len(sessionStore.savedLearningEpisodes) != 1 {
		t.Fatalf("expected one learning episode, got %#v", sessionStore.savedLearningEpisodes)
	}
	if len(sessionStore.persistedCompletedTurns) != 1 {
		t.Fatalf("expected completed turn persistence, got %#v", sessionStore.persistedCompletedTurns)
	}
	completed := sessionStore.persistedCompletedTurns[0]
	if completed.EpisodeID != 0 || completed.Episode == nil || completed.Result.EpisodeID != 77 {
		t.Fatalf("expected atomic episode creation to return episode 77 without a provisional id, got %#v", completed)
	}
	if completed.Result.StudentMessageID != 201 || completed.Result.AgentMessageID != 202 {
		t.Fatalf("fake store should bind evidence ids to completed turn result, got %#v", completed.Result)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if int64(body["student_message_id"].(float64)) != 201 || int64(body["agent_message_id"].(float64)) != 202 {
		t.Fatalf("gateway response must include completed turn message ids, got %#v", body)
	}
	if len(completed.MemoryEvents) != 2 {
		t.Fatalf("expected ADD and REINFORCE memory events, got %#v", completed.MemoryEvents)
	}
	if completed.MemoryEvents[0].Operation != "ADD" || completed.MemoryEvents[1].Operation != "REINFORCE" {
		t.Fatalf("unexpected memory operations: %#v", completed.MemoryEvents)
	}
	if len(sessionStore.appliedMemoryUpdates) != 0 {
		t.Fatalf("gateway main path must not use legacy ApplyMemoryUpdates, got %#v", sessionStore.appliedMemoryUpdates)
	}
	if completed.TopicSummary == nil {
		t.Fatalf("expected topic summary in completed turn, got %#v", completed)
	}
	if completed.TopicSummary.WeakConcepts[0] != "Concept:valid_index_range" {
		t.Fatalf("expected updated weak concept, got %#v", completed.TopicSummary)
	}
	if len(completed.LearningFacts) != 1 {
		t.Fatalf("expected one saved learning fact, got %#v", completed.LearningFacts)
	}
	if completed.LearningFacts[0].SourceEpisodeID != 77 {
		t.Fatalf("gateway must override AI source_episode_id with persisted episode id, got %d", completed.LearningFacts[0].SourceEpisodeID)
	}
	if sessionStore.decayedLearnerID != "" || len(sessionStore.appliedMemoryEvents) != 0 || len(sessionStore.upsertedTopicSummaries) != 0 || len(sessionStore.savedLearningFacts) != 0 {
		t.Fatalf("gateway must not use split persistence after completed turn: decay=%q memory=%#v topics=%#v facts=%#v", sessionStore.decayedLearnerID, sessionStore.appliedMemoryEvents, sessionStore.upsertedTopicSummaries, sessionStore.savedLearningFacts)
	}
}

func TestSessionMessageLeavesNoEpisodeWhenAICoreUnavailable(t *testing.T) {
	sessionStore := &fakeSessionStore{nextEpisodeID: 88}
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Error(response, "upstream down", http.StatusBadGateway)
	}))
	aiCore.Close()

	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-unavailable","learner_id":"learner-a","message":"为什么报错？"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d: %s", response.Code, response.Body.String())
	}
	if len(sessionStore.savedLearningEpisodes) != 0 || len(sessionStore.markedFailedEpisodes) != 0 {
		t.Fatalf("AI transport failure must leave zero episode artifacts: saved=%#v failed=%#v", sessionStore.savedLearningEpisodes, sessionStore.markedFailedEpisodes)
	}
	if len(sessionStore.persistedCompletedTurns) != 0 {
		t.Fatalf("must not persist completed turn when AI core fails, got %#v", sessionStore.persistedCompletedTurns)
	}
}

func TestSessionMessageLeavesNoEpisodeWhenAICoreReturnsInvalidJSON(t *testing.T) {
	sessionStore := &fakeSessionStore{nextEpisodeID: 89}
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte(`not-json`))
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-invalid-json","learner_id":"learner-a","message":"为什么报错？"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d: %s", response.Code, response.Body.String())
	}
	if len(sessionStore.savedLearningEpisodes) != 0 || len(sessionStore.markedFailedEpisodes) != 0 {
		t.Fatalf("invalid AI JSON must leave zero episode artifacts: saved=%#v failed=%#v", sessionStore.savedLearningEpisodes, sessionStore.markedFailedEpisodes)
	}
	if len(sessionStore.persistedCompletedTurns) != 0 {
		t.Fatalf("must not persist completed turn on invalid AI JSON, got %#v", sessionStore.persistedCompletedTurns)
	}
}

func TestSessionMessageLeavesNoEpisodeWhenCompletedTurnPersistenceFails(t *testing.T) {
	sessionStore := &fakeSessionStore{
		nextEpisodeID:    90,
		completedTurnErr: errors.New("sqlite is locked"),
	}
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, task6WithConversationState(map[string]any{
			"prompt":   "请先判断最大合法索引。",
			"skill_id": "student-learning/retrieve-first-gate",
		}, "session-demo", "client-turn-persist-fail"))
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"session-demo","client_turn_id":"client-turn-persist-fail","learner_id":"learner-a","message":"为什么报错？"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d: %s", response.Code, response.Body.String())
	}
	if len(sessionStore.savedLearningEpisodes) != 0 || len(sessionStore.markedFailedEpisodes) != 0 {
		t.Fatalf("failed atomic persistence must leave zero episode artifacts: saved=%#v failed=%#v", sessionStore.savedLearningEpisodes, sessionStore.markedFailedEpisodes)
	}
}

func TestSessionEvidenceReturnsSavedEvidence(t *testing.T) {
	sessionStore := &fakeSessionStore{
		events: []store.EvidenceEvent{
			{
				EventType: "ai_step",
				Payload: map[string]any{
					"skill_id": "student-learning/retrieve-first-gate",
				},
			},
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/session/session-demo/evidence", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "session-demo"})
	response := httptest.NewRecorder()

	gateway.SessionEvidence(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.evidenceSessionID != "session-demo" {
		t.Fatalf("expected evidence lookup for session-demo, got %q", sessionStore.evidenceSessionID)
	}
	if !strings.Contains(response.Body.String(), "retrieve-first-gate") {
		t.Fatalf("expected evidence payload, got %s", response.Body.String())
	}
}

func TestSessionsReturnsFilteredSummaries(t *testing.T) {
	sessionStore := &fakeSessionStore{
		sessions: []store.SessionSummary{
			{
				ID:              "session-active",
				Scenario:        "index-error",
				Status:          "active",
				CreatedAt:       "2026-07-07T00:00:00Z",
				MessageCount:    2,
				LatestMessageAt: "2026-07-07T00:01:00Z",
			},
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/sessions?status=active", nil)
	response := httptest.NewRecorder()

	gateway.Sessions(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.listSessionsStatus != "active" {
		t.Fatalf("expected active status filter, got %q", sessionStore.listSessionsStatus)
	}
	for _, expected := range []string{
		`"sessions"`,
		`"id":"session-active"`,
		`"scenario":"index-error"`,
		`"status":"active"`,
		`"message_count":2`,
		`"latest_message_at":"2026-07-07T00:01:00Z"`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("expected %s in response, got %s", expected, response.Body.String())
		}
	}
}

func TestHarnessSuitesReturnsTenPaperGroundedSuites(t *testing.T) {
	gateway := NewGateway(Config{})
	request := httptest.NewRequest(http.MethodGet, "/api/harness/suites", nil)
	response := httptest.NewRecorder()

	gateway.HarnessSuites(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		Suites []struct {
			ID           string   `json:"id"`
			Title        string   `json:"title"`
			ScenarioID   string   `json:"scenario_id"`
			MethodSource string   `json:"method_source"`
			MetricIDs    []string `json:"metric_ids"`
			PassCriteria []string `json:"pass_criteria"`
		} `json:"suites"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode harness suites: %v", err)
	}
	if len(body.Suites) < 10 {
		t.Fatalf("expected at least 10 harness suites, got %#v", body.Suites)
	}
	requiredMethods := []string{
		"HELM 2023",
		"RAGAS 2024",
		"RAGChecker 2024",
		"ARES 2024",
		"AgentBench 2024",
		"SWE-bench 2024",
		"EvalPlus 2023",
		"Reproducible LM Evaluation 2024",
		"G-Eval 2023",
	}
	for _, method := range requiredMethods {
		if !strings.Contains(response.Body.String(), method) {
			t.Fatalf("expected method %q in harness suites, got %s", method, response.Body.String())
		}
	}
	for _, suite := range body.Suites[:10] {
		if suite.ScenarioID == "" || suite.Title == "" || suite.MethodSource == "" {
			t.Fatalf("suite must expose title, scenario and method source: %#v", suite)
		}
		if len(suite.MetricIDs) < 3 {
			t.Fatalf("suite %s must expose at least 3 metrics, got %#v", suite.ID, suite.MetricIDs)
		}
		if len(suite.PassCriteria) == 0 {
			t.Fatalf("suite %s must expose pass criteria", suite.ID)
		}
	}
}

func TestHarnessRunExecutesAllowlistedCommandAndWritesBeijingLog(t *testing.T) {
	command := []string{"/bin/sh", "-c", "printf harness-ok"}
	if runtime.GOOS == "windows" {
		command = []string{"cmd", "/C", "echo harness-ok"}
	}
	suitePath := filepath.Join(t.TempDir(), "suites.json")
	suiteJSON := `[
	  {
	    "id":"test-harness-suite",
	    "title":"Harness test suite",
	    "scenario_id":"python-list-indexerror",
	    "method_source":"HELM 2023",
	    "metric_ids":["task_success","process_compliance","evidence_completeness"],
	    "command":{"label":"echo harness-ok","args":` + mustMarshalStringSlice(t, command) + `,"allowlisted":true},
	    "timeout_seconds":5,
	    "pass_criteria":["exit_code == 0"],
	    "cases":[{"case_id":"case-001","input":"why indexerror","expected_behavior":"runner writes log","assertions":["stdout contains harness-ok"]}]
	  }
	]`
	if err := os.WriteFile(suitePath, []byte(suiteJSON), 0o644); err != nil {
		t.Fatalf("write harness suite: %v", err)
	}
	logDir := t.TempDir()
	gateway := NewGateway(Config{HarnessSuitePath: suitePath, HarnessLogDir: logDir, ProjectRoot: t.TempDir()})
	request := httptest.NewRequest(http.MethodPost, "/api/harness/run", strings.NewReader(`{"suite_id":"test-harness-suite"}`))
	response := httptest.NewRecorder()

	gateway.HarnessRun(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, expected := range []string{
		`"suite_id":"test-harness-suite"`,
		`"status":"passed"`,
		`"exit_code":0`,
		`"created_at_beijing":`,
		`+08:00`,
		`"stdout_tail":"harness-ok"`,
		`"log_path":`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected %s in harness run response, got %s", expected, body)
		}
	}
	entries, err := os.ReadDir(logDir)
	if err != nil {
		t.Fatalf("read harness log dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected one Beijing date log directory, got %#v", entries)
	}
	runFiles, err := filepath.Glob(filepath.Join(logDir, entries[0].Name(), "*.json"))
	if err != nil {
		t.Fatalf("glob harness logs: %v", err)
	}
	if len(runFiles) != 1 {
		t.Fatalf("expected one harness log json, got %#v", runFiles)
	}
	logBody, err := os.ReadFile(runFiles[0])
	if err != nil {
		t.Fatalf("read harness log: %v", err)
	}
	if !strings.Contains(string(logBody), "harness-ok") || !strings.Contains(string(logBody), "test-harness-suite") {
		t.Fatalf("expected run details in log file, got %s", string(logBody))
	}
}

func mustMarshalStringSlice(t *testing.T, values []string) string {
	t.Helper()
	data, err := json.Marshal(values)
	if err != nil {
		t.Fatalf("marshal string slice: %v", err)
	}
	return string(data)
}

func TestSessionDetailReturnsSessionMessagesAndCompactEvidenceEvents(t *testing.T) {
	sessionStore := &fakeSessionStore{
		detail: store.SessionDetail{
			Session: store.Session{
				ID:        "session-demo",
				Scenario:  "index-error",
				Status:    "active",
				CreatedAt: "2026-07-07T00:00:00Z",
			},
			Messages: []store.Message{
				{ID: 201, SessionID: "session-demo", Role: "student", Content: "我访问 list[2]", CreatedAt: "2026-07-07T00:01:00Z"},
				{ID: 202, SessionID: "session-demo", Role: "agent", Content: "最大合法索引是多少？", CreatedAt: "2026-07-07T00:01:01Z"},
			},
			EvidenceEvents: []store.EvidenceEvent{
				{
					ID:               303,
					SessionID:        "session-demo",
					StudentMessageID: 201,
					AgentMessageID:   202,
					EventType:        "ai_step",
					Payload: map[string]any{
						"learning_trace": map[string]any{"guided_response": "check the valid indices"},
						"skill_id":       "student-learning/progressive-hint-ladder",
						"rag":            map[string]any{"source": "python-docs"},
						"kg":             map[string]any{"path": []string{"Concept:index"}},
						"memory":         map[string]any{"selected_memory_ids": []string{"memory-index-range"}},
					},
					CreatedAt: "2026-07-07T00:01:02Z",
				},
			},
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/session/session-demo", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "session-demo"})
	response := httptest.NewRecorder()

	gateway.SessionDetail(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.detailSessionID != "session-demo" {
		t.Fatalf("expected detail lookup for session-demo, got %q", sessionStore.detailSessionID)
	}
	for _, expected := range []string{
		`"session":{"id":"session-demo"`,
		`"messages":[`,
		`"evidence_events":[`,
		`"agent_message_id":202`,
		`"guided_response":"check the valid indices"`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("expected %s in detail response, got %s", expected, response.Body.String())
		}
	}
	for _, forbidden := range []string{"student_message_id", "skill_id", "python-docs", "selected_memory_ids"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("unexpected raw evidence field %q in detail response: %s", forbidden, response.Body.String())
		}
	}
}

func TestSessionDetailStaysWithinParticipantPayloadBudget(t *testing.T) {
	largeKG := strings.Repeat("k", 2*1024*1024)
	detail := store.SessionDetail{Session: store.Session{ID: "session-large", Status: "active"}}
	for index := 0; index < 10; index++ {
		studentID := int64(index*2 + 1)
		agentID := studentID + 1
		detail.Messages = append(detail.Messages,
			store.Message{ID: studentID, SessionID: "session-large", Role: "student", Content: "question"},
			store.Message{ID: agentID, SessionID: "session-large", Role: "agent", Content: "answer"},
		)
		detail.EvidenceEvents = append(detail.EvidenceEvents, store.EvidenceEvent{
			ID: agentID, AgentMessageID: agentID,
			Payload: map[string]any{
				"learning_trace": map[string]any{"guided_response": fmt.Sprintf("trace-%d", index)},
				"kg_grounding":   largeKG,
				"evidence":       map[string]any{"kg_grounding": largeKG},
			},
		})
	}
	gateway := NewGateway(Config{Store: &fakeSessionStore{detail: detail}})
	request := httptest.NewRequest(http.MethodGet, "/api/session/session-large", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "session-large"})
	response := httptest.NewRecorder()

	gateway.SessionDetail(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if response.Body.Len() > 256*1024 {
		t.Fatalf("participant payload bytes = %d, want <= %d", response.Body.Len(), 256*1024)
	}
	if strings.Contains(response.Body.String(), "kg_grounding") {
		t.Fatalf("participant payload leaked raw KG: %s", response.Body.String())
	}
	for index := 0; index < 10; index++ {
		if !strings.Contains(response.Body.String(), fmt.Sprintf("trace-%d", index)) {
			t.Fatalf("participant payload missed trace-%d", index)
		}
	}
}

func TestSessionDetailRejectsDeletedSession(t *testing.T) {
	sessionStore := &fakeSessionStore{
		detail: store.SessionDetail{
			Session: store.Session{
				ID:       "session-deleted",
				Scenario: "python-learning",
				Status:   "deleted",
			},
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodGet, "/api/session/session-deleted", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "session-deleted"})
	response := httptest.NewRecorder()

	gateway.SessionDetail(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "session_deleted") {
		t.Fatalf("expected session_deleted response, got %s", response.Body.String())
	}
}

func TestDeleteSessionSoftDeletesSession(t *testing.T) {
	sessionStore := &fakeSessionStore{
		deletedSession: store.Session{
			ID:        "session-demo",
			Scenario:  "index-error",
			Status:    "deleted",
			CreatedAt: "2026-07-07T00:00:00Z",
		},
	}
	gateway := NewGateway(Config{Store: sessionStore})
	request := httptest.NewRequest(http.MethodDelete, "/api/session/session-demo", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "session-demo"})
	response := httptest.NewRecorder()

	gateway.DeleteSession(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if sessionStore.deletedSessionID != "session-demo" {
		t.Fatalf("expected delete lookup for session-demo, got %q", sessionStore.deletedSessionID)
	}
	if !strings.Contains(response.Body.String(), `"status":"deleted"`) {
		t.Fatalf("expected deleted session response, got %s", response.Body.String())
	}
}

func TestSessionMessageRejectsDeletedSessionBeforeCallingAICore(t *testing.T) {
	sessionStore := &fakeSessionStore{
		session: store.Session{
			ID:       "session-deleted",
			Scenario: "index-error",
			Status:   "deleted",
		},
	}
	aiCoreCalled := false
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCoreCalled = true
		writeJSON(response, http.StatusOK, map[string]any{
			"skill_id": "student-learning/retrieve-first-gate",
		})
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{
		AICoreURL: aiCore.URL,
		Store:     sessionStore,
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/session/message",
		strings.NewReader(`{"session_id":"session-deleted","client_turn_id":"client-turn-deleted","message":"还能继续吗？"}`),
	)
	response := httptest.NewRecorder()

	gateway.SessionMessage(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"session_deleted"`) {
		t.Fatalf("expected session_deleted error, got %s", response.Body.String())
	}
	if aiCoreCalled {
		t.Fatal("deleted session must be rejected before calling AI Core")
	}
	if len(sessionStore.savedLearningEpisodes) != 0 || len(sessionStore.persistedCompletedTurns) != 0 {
		t.Fatalf("deleted session must not write messages or episodes, got episodes=%#v turns=%#v", sessionStore.savedLearningEpisodes, sessionStore.persistedCompletedTurns)
	}
}

func TestCorpusSummaryReadsProcessedCorpus(t *testing.T) {
	corpusDir := writeTestCorpus(t)
	gateway := NewGateway(Config{CorpusDir: corpusDir})
	request := httptest.NewRequest(http.MethodGet, "/api/corpus/summary", nil)
	response := httptest.NewRecorder()

	gateway.CorpusSummary(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"chunk_count":2`) {
		t.Fatalf("expected chunk count, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"glossary_term_count":1`) {
		t.Fatalf("expected glossary count, got %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"noise_chunk_count":0`) {
		t.Fatalf("expected no noise chunks, got %s", response.Body.String())
	}
}

func TestCorpusChunksFiltersAndReturnsChunkDetail(t *testing.T) {
	corpusDir := writeTestCorpus(t)
	gateway := NewGateway(Config{CorpusDir: corpusDir})
	request := httptest.NewRequest(http.MethodGet, "/api/corpus/chunks?q=IndexError&has_code=true", nil)
	response := httptest.NewRecorder()

	gateway.CorpusChunks(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"chunk_id":"chunk-list"`) {
		t.Fatalf("expected list chunk, got %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"chunk_id":"chunk-text"`) {
		t.Fatalf("did not expect text chunk in filtered results: %s", response.Body.String())
	}
}

func TestCorpusChunkDetailReturnsOneChunk(t *testing.T) {
	corpusDir := writeTestCorpus(t)
	gateway := NewGateway(Config{CorpusDir: corpusDir})
	request := httptest.NewRequest(http.MethodGet, "/api/corpus/chunks/chunk-list", nil)
	request = pathvar.WithVars(request, map[string]string{"id": "chunk-list"})
	response := httptest.NewRecorder()

	gateway.CorpusChunkDetail(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "zero-based index") {
		t.Fatalf("expected chunk detail text, got %s", response.Body.String())
	}
}

func TestKGCandidatesReturnsSourceEvidenceForReview(t *testing.T) {
	candidatePath := writeTestKGCandidates(t)
	gateway := NewGateway(Config{KGCandidatePath: candidatePath})
	request := httptest.NewRequest(http.MethodGet, "/api/kg/candidates?status=auto_extracted&q=IndexError&min_confidence=0.8", nil)
	response := httptest.NewRecorder()

	gateway.KGCandidates(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, expected := range []string{
		`"candidate_count":2`,
		`"filtered_count":1`,
		`"auto_extracted":2`,
		`"candidate_id":"kgcand-indexerror"`,
		`"source_id":"python-docs-3.14.6"`,
		`"source_chunk_id":"chunk-list"`,
		`"source_url":"https://docs.python.org/3/tutorial/datastructures.html#more-on-lists"`,
		`"source_license_note":"python-software-foundation-documentation-license"`,
		`"subject":"Concept:valid_index_range"`,
		`"predicate":"prevents"`,
		`"object":"ErrorType:IndexError"`,
		`"evidence_text":"It raises an IndexError if the list is empty or the index is outside the list range"`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected %s in KG candidates response, got %s", expected, body)
		}
	}
	if strings.Contains(body, `"candidate_id":"kgcand-slice"`) {
		t.Fatalf("status/query/confidence filter should exclude slice candidate: %s", body)
	}
}

func TestKGCandidateReviewPostThenCandidatesIncludesReviewFields(t *testing.T) {
	candidatePath := writeTestKGCandidates(t)
	sqliteStore, err := store.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}
	t.Cleanup(func() {
		_ = sqliteStore.Close()
	})
	gateway := NewGateway(Config{KGCandidatePath: candidatePath, Store: sqliteStore})

	reviewRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/kg/candidates/kgcand-indexerror/review",
		strings.NewReader(`{"status":"approved","reviewer_id":"reviewer-a","reviewer_note":"Grounded enough for the KG."}`),
	)
	reviewRequest = pathvar.WithVars(reviewRequest, map[string]string{"id": "kgcand-indexerror"})
	reviewResponse := httptest.NewRecorder()

	gateway.KGCandidateReview(reviewResponse, reviewRequest)

	if reviewResponse.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", reviewResponse.Code, reviewResponse.Body.String())
	}
	for _, expected := range []string{
		`"candidate_id":"kgcand-indexerror"`,
		`"status":"approved"`,
		`"reviewer_id":"reviewer-a"`,
		`"reviewer_note":"Grounded enough for the KG."`,
		`"reviewed_at":`,
	} {
		if !strings.Contains(reviewResponse.Body.String(), expected) {
			t.Fatalf("expected %s in review response, got %s", expected, reviewResponse.Body.String())
		}
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/kg/candidates?status=auto_extracted&q=IndexError", nil)
	listResponse := httptest.NewRecorder()

	gateway.KGCandidates(listResponse, listRequest)

	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", listResponse.Code, listResponse.Body.String())
	}
	body := listResponse.Body.String()
	for _, expected := range []string{
		`"candidate_id":"kgcand-indexerror"`,
		`"review_status":"approved"`,
		`"reviewer_id":"reviewer-a"`,
		`"reviewer_note":"Grounded enough for the KG."`,
		`"reviewed_at":`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected %s in KG candidates response, got %s", expected, body)
		}
	}
}

func TestKGCandidateReviewRejectsInvalidStatus(t *testing.T) {
	candidatePath := writeTestKGCandidates(t)
	sqliteStore, err := store.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}
	t.Cleanup(func() {
		_ = sqliteStore.Close()
	})
	gateway := NewGateway(Config{KGCandidatePath: candidatePath, Store: sqliteStore})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/kg/candidates/kgcand-indexerror/review",
		strings.NewReader(`{"status":"maybe","reviewer_id":"reviewer-a","reviewer_note":"not sure"}`),
	)
	request = pathvar.WithVars(request, map[string]string{"id": "kgcand-indexerror"})
	response := httptest.NewRecorder()

	gateway.KGCandidateReview(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"invalid_review_status"`) {
		t.Fatalf("expected invalid_review_status error, got %s", response.Body.String())
	}
}

func TestKGCandidateReviewRejectsUnknownCandidate(t *testing.T) {
	candidatePath := writeTestKGCandidates(t)
	sqliteStore, err := store.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}
	t.Cleanup(func() {
		_ = sqliteStore.Close()
	})
	gateway := NewGateway(Config{KGCandidatePath: candidatePath, Store: sqliteStore})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/kg/candidates/kgcand-missing/review",
		strings.NewReader(`{"status":"approved","reviewer_id":"reviewer-a","reviewer_note":"not in source candidates"}`),
	)
	request = pathvar.WithVars(request, map[string]string{"id": "kgcand-missing"})
	response := httptest.NewRecorder()

	gateway.KGCandidateReview(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"candidate_not_found"`) {
		t.Fatalf("expected candidate_not_found error, got %s", response.Body.String())
	}
}

func TestKGCandidateReviewRejectsEmptyReviewerID(t *testing.T) {
	candidatePath := writeTestKGCandidates(t)
	sqliteStore, err := store.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}
	t.Cleanup(func() {
		_ = sqliteStore.Close()
	})
	gateway := NewGateway(Config{KGCandidatePath: candidatePath, Store: sqliteStore})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/kg/candidates/kgcand-indexerror/review",
		strings.NewReader(`{"status":"approved","reviewer_id":"   ","reviewer_note":"missing reviewer"}`),
	)
	request = pathvar.WithVars(request, map[string]string{"id": "kgcand-indexerror"})
	response := httptest.NewRecorder()

	gateway.KGCandidateReview(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"reviewer_id_required"`) {
		t.Fatalf("expected reviewer_id_required error, got %s", response.Body.String())
	}
}

func TestKGCandidatesRejectsInvalidMinConfidence(t *testing.T) {
	candidatePath := writeTestKGCandidates(t)
	gateway := NewGateway(Config{KGCandidatePath: candidatePath})

	for _, raw := range []string{"abc", "-0.1", "1.1", "NaN", "+Inf"} {
		request := httptest.NewRequest(http.MethodGet, "/api/kg/candidates?min_confidence="+raw, nil)
		response := httptest.NewRecorder()

		gateway.KGCandidates(response, request)

		if response.Code != http.StatusBadRequest {
			t.Fatalf("min_confidence=%s: expected status 400, got %d: %s", raw, response.Code, response.Body.String())
		}
		if !strings.Contains(response.Body.String(), `"error":"invalid_min_confidence"`) {
			t.Fatalf("min_confidence=%s: expected invalid_min_confidence error, got %s", raw, response.Body.String())
		}
	}
}

type fakeSessionStore struct {
	session  store.Session
	sessions []store.SessionSummary
	detail   store.SessionDetail

	createdScenario         string
	listSessionsStatus      string
	detailSessionID         string
	deletedSessionID        string
	deletedSession          store.Session
	savedSessionID          string
	savedRole               string
	savedContent            string
	savedEvidence           map[string]any
	evidenceSessionID       string
	events                  []store.EvidenceEvent
	recentSessionID         string
	recentMessages          []store.Message
	latestEvidence          map[string]any
	memoryLearnerID         string
	memories                []store.LearnerMemory
	v2Memories              []store.LearnerMemoryV2
	topicSummaries          []store.TopicSummary
	learningEpisodes        []store.LearningEpisode
	learningFacts           []store.LearningFact
	learningEntities        []store.LearningEntity
	memoryEvents            []store.MemoryEvent
	appliedLearnerID        string
	appliedMemoryUpdates    []map[string]any
	appliedMemoryEvents     []store.MemoryEventInput
	nextEpisodeID           int64
	savedLearningEpisodes   []store.LearningEpisodeInput
	updatedLearningEpisodes []struct {
		episodeID int64
		update    store.LearningEpisodeUpdate
	}
	upsertedTopicSummaries    []store.TopicSummaryInput
	savedLearningFacts        []store.LearningFactInput
	kgCandidateReviews        []store.KGCandidateReview
	decayedLearnerID          string
	completedTurnErr          error
	persistCompletedTurnCalls int
	conversationProjection    store.ConversationProjectionRecord
	projectionLookups         []string
	committedClientTurns      map[string]bool
	committedTurnLookups      []string
	autoCommitCompletedTurns  bool
	savedMessages             []struct {
		sessionID string
		role      string
		content   string
	}
	persistedCompletedTurns []struct {
		store.CompletedSessionTurnInput
		Result store.CompletedSessionTurnResult
	}
	markedFailedEpisodes []struct {
		episodeID int64
		status    string
	}
	tokenBudget              store.TokenBudget
	recordedTokenUsage       int
	atomicTokenDebited       int
	resetTokenBudget         bool
	harnessCases             []store.HarnessCaseRecord
	createdHarnessCase       store.HarnessCaseRecord
	confirmedHarnessCase     store.HarnessCaseRecord
	deletedHarnessCase       store.HarnessCaseRecord
	harnessCaseEvents        []store.HarnessCaseEvent
	testTopicProgress        []store.LearnerTopicProgress
	testProgress             store.LearnerTopicProgress
	testProgressFound        bool
	testProgressLearner      string
	testProgressTopic        string
	testQuestion             store.TestQuestion
	testQuestionErr          error
	recentTestQuestions      []store.TestQuestion
	recentTestLearner        string
	recentTestTopic          string
	recentTestLimit          int
	testAttemptResult        store.TestAttemptResult
	testAttemptFound         bool
	testAttemptErr           error
	testAttemptLookups       int
	testAttemptQuestion      string
	testAttemptReservation   store.TestAttemptReservation
	reserveTestAttemptErr    error
	releaseTestAttemptErr    error
	reservedTestAnswers      []string
	releasedTestReservations int
	recordTestAttemptErr     error
	listedProgressFor        string
	progressLookups          int
	testQuestionLookups      int
	tokenBudgetLookups       int
	createdTestQuestions     []store.CreateTestQuestionInput
	failedTestQuestions      []store.CreateFailedTestQuestionInput
	recordedTestAttempts     []store.RecordTestAttemptInput
}

func (f *fakeSessionStore) GetConversationProjection(_ context.Context, sessionID string) (store.ConversationProjectionRecord, error) {
	f.projectionLookups = append(f.projectionLookups, sessionID)
	if f.conversationProjection.Projection == nil {
		return store.ConversationProjectionRecord{
			SessionID: sessionID,
			Projection: map[string]any{
				"schema_version": 1, "last_sequence": int64(0), "active_topic_id": nil,
				"back_stack": []any{}, "topics": map[string]any{},
			},
		}, nil
	}
	return f.conversationProjection, nil
}

func (f *fakeSessionStore) ConversationTurnCommitted(_ context.Context, sessionID, clientTurnID string) (bool, error) {
	key := sessionID + "/" + clientTurnID
	f.committedTurnLookups = append(f.committedTurnLookups, key)
	return f.committedClientTurns[key], nil
}

func (f *fakeSessionStore) CreateSession(_ context.Context, scenario string) (store.Session, error) {
	f.createdScenario = scenario
	if f.session.ID == "" {
		f.session = store.Session{ID: "session-demo", Scenario: scenario, Status: "active"}
	}
	return f.session, nil
}

func (f *fakeSessionStore) GetSession(_ context.Context, sessionID string) (store.Session, error) {
	if f.session.ID == "" {
		return store.Session{ID: sessionID, Scenario: "index-error", Status: "active"}, nil
	}
	return f.session, nil
}

func (f *fakeSessionStore) ListSessions(_ context.Context, status string) ([]store.SessionSummary, error) {
	f.listSessionsStatus = status
	return f.sessions, nil
}

func (f *fakeSessionStore) GetSessionDetail(_ context.Context, sessionID string) (store.SessionDetail, error) {
	f.detailSessionID = sessionID
	return f.detail, nil
}

func (f *fakeSessionStore) GetSessionChatDetail(_ context.Context, sessionID string) (store.SessionChatDetail, error) {
	f.detailSessionID = sessionID
	detail := store.SessionChatDetail{Session: f.detail.Session, Messages: f.detail.Messages}
	for _, event := range f.detail.EvidenceEvents {
		payload := map[string]any{}
		if trace, ok := event.Payload["learning_trace"]; ok {
			payload["learning_trace"] = trace
		}
		detail.EvidenceEvents = append(detail.EvidenceEvents, store.ChatEvidenceEvent{
			ID: event.ID, AgentMessageID: event.AgentMessageID, Payload: payload,
		})
	}
	return detail, nil
}

func (f *fakeSessionStore) DeleteSession(_ context.Context, sessionID string) (store.Session, error) {
	f.deletedSessionID = sessionID
	if f.deletedSession.ID != "" {
		return f.deletedSession, nil
	}
	return store.Session{ID: sessionID, Scenario: "index-error", Status: "deleted"}, nil
}

func (f *fakeSessionStore) SaveMessageAndEvidence(_ context.Context, sessionID string, role string, content string, evidence map[string]any) error {
	f.savedSessionID = sessionID
	f.savedRole = role
	f.savedContent = content
	f.savedEvidence = evidence
	return nil
}

func (f *fakeSessionStore) SaveMessageAndEvidenceWithID(ctx context.Context, sessionID string, role string, content string, evidence map[string]any) (int64, error) {
	if err := f.SaveMessageAndEvidence(ctx, sessionID, role, content, evidence); err != nil {
		return 0, err
	}
	return 201, nil
}

func (f *fakeSessionStore) ListEvidenceEvents(_ context.Context, sessionID string) ([]store.EvidenceEvent, error) {
	f.evidenceSessionID = sessionID
	return f.events, nil
}

func (f *fakeSessionStore) SaveMessage(_ context.Context, sessionID string, role string, content string) error {
	f.savedMessages = append(f.savedMessages, struct {
		sessionID string
		role      string
		content   string
	}{sessionID: sessionID, role: role, content: content})
	return nil
}

func (f *fakeSessionStore) SaveMessageWithID(ctx context.Context, sessionID string, role string, content string) (int64, error) {
	if err := f.SaveMessage(ctx, sessionID, role, content); err != nil {
		return 0, err
	}
	if role == "agent" {
		return 202, nil
	}
	return 201, nil
}

func (f *fakeSessionStore) ListRecentMessages(_ context.Context, sessionID string, _ int) ([]store.Message, error) {
	f.recentSessionID = sessionID
	return f.recentMessages, nil
}

func (f *fakeSessionStore) LatestEvidence(_ context.Context, _ string) (map[string]any, error) {
	if f.latestEvidence == nil {
		return map[string]any{}, nil
	}
	return f.latestEvidence, nil
}

func (f *fakeSessionStore) ListLearnerMemory(_ context.Context, learnerID string, _ int) ([]store.LearnerMemory, error) {
	f.memoryLearnerID = learnerID
	return f.memories, nil
}

func (f *fakeSessionStore) ListLearnerMemoryV2(_ context.Context, learnerID string, _ int) ([]store.LearnerMemoryV2, error) {
	f.memoryLearnerID = learnerID
	if len(f.v2Memories) > 0 {
		return f.v2Memories, nil
	}
	converted := make([]store.LearnerMemoryV2, 0, len(f.memories))
	for _, memory := range f.memories {
		payload := memory.Payload
		converted = append(converted, store.LearnerMemoryV2{
			MemoryID:       stringValueFromMap(payload, "memory_id"),
			LearnerID:      learnerID,
			MemoryType:     stringValueFromMap(payload, "memory_type"),
			Topic:          stringValueFromMap(payload, "topic"),
			Content:        stringValueFromMap(payload, "content"),
			Concepts:       []string{},
			Strength:       1,
			UseCount:       0,
			EffectiveScore: 1,
			Status:         "active",
			Payload:        payload,
		})
	}
	return converted, nil
}

func (f *fakeSessionStore) ListTopicSummaries(_ context.Context, _ string, _ int) ([]store.TopicSummary, error) {
	return f.topicSummaries, nil
}

func (f *fakeSessionStore) ListLearningEpisodes(_ context.Context, _ string, _ int) ([]store.LearningEpisode, error) {
	return f.learningEpisodes, nil
}

func (f *fakeSessionStore) ListLearningFacts(_ context.Context, _ string) ([]store.LearningFact, error) {
	return f.learningFacts, nil
}

func (f *fakeSessionStore) ListLearningEntities(_ context.Context, _ string) ([]store.LearningEntity, error) {
	return f.learningEntities, nil
}

func (f *fakeSessionStore) ListMemoryEvents(_ context.Context, _ string, _ int) ([]store.MemoryEvent, error) {
	return f.memoryEvents, nil
}

func (f *fakeSessionStore) ApplyMemoryUpdates(_ context.Context, learnerID string, updates []map[string]any) error {
	f.appliedLearnerID = learnerID
	f.appliedMemoryUpdates = updates
	return nil
}

func (f *fakeSessionStore) ApplyMemoryEvent(_ context.Context, input store.MemoryEventInput) (store.LearnerMemoryV2, error) {
	f.appliedMemoryEvents = append(f.appliedMemoryEvents, input)
	return store.LearnerMemoryV2{MemoryID: input.TargetMemoryID, LearnerID: input.LearnerID}, nil
}

func (f *fakeSessionStore) SaveLearningEpisode(_ context.Context, input store.LearningEpisodeInput) (store.LearningEpisode, error) {
	f.savedLearningEpisodes = append(f.savedLearningEpisodes, input)
	id := f.nextEpisodeID
	if id == 0 {
		id = 1
	}
	return store.LearningEpisode{
		ID:         id,
		LearnerID:  input.LearnerID,
		SessionID:  input.SessionID,
		Topic:      input.Topic,
		SkillState: input.SkillState,
		Payload:    input.Payload,
	}, nil
}

func (f *fakeSessionStore) UpdateLearningEpisodeMessages(_ context.Context, episodeID int64, update store.LearningEpisodeUpdate) error {
	f.updatedLearningEpisodes = append(f.updatedLearningEpisodes, struct {
		episodeID int64
		update    store.LearningEpisodeUpdate
	}{episodeID: episodeID, update: update})
	return nil
}

func (f *fakeSessionStore) UpsertTopicSummary(_ context.Context, input store.TopicSummaryInput) (store.TopicSummary, error) {
	f.upsertedTopicSummaries = append(f.upsertedTopicSummaries, input)
	return store.TopicSummary{
		LearnerID:          input.LearnerID,
		Topic:              input.Topic,
		Summary:            input.Summary,
		WeakConcepts:       input.WeakConcepts,
		MasteredConcepts:   input.MasteredConcepts,
		NextTeachingAction: input.NextTeachingAction,
		SourceMemoryIDs:    input.SourceMemoryIDs,
	}, nil
}

func (f *fakeSessionStore) SaveLearningFact(_ context.Context, input store.LearningFactInput) (store.LearningFact, error) {
	f.savedLearningFacts = append(f.savedLearningFacts, input)
	return store.LearningFact{
		FactID:          input.FactID,
		LearnerID:       input.LearnerID,
		Subject:         input.Subject,
		Predicate:       input.Predicate,
		Object:          input.Object,
		Confidence:      input.Confidence,
		SourceEpisodeID: input.SourceEpisodeID,
		Status:          input.Status,
		Payload:         input.Payload,
	}, nil
}

func (f *fakeSessionStore) DecayAndCapMemories(_ context.Context, learnerID string, _ time.Time) error {
	f.decayedLearnerID = learnerID
	return nil
}

func (f *fakeSessionStore) PersistCompletedSessionTurn(_ context.Context, input store.CompletedSessionTurnInput) (store.CompletedSessionTurnResult, error) {
	f.persistCompletedTurnCalls++
	if f.completedTurnErr != nil {
		if errors.Is(f.completedTurnErr, store.ErrTokenBudgetExhausted) {
			f.tokenBudget.UsedTokens = f.tokenBudget.DailyQuota
			f.tokenBudget.RemainingTokens = 0
			f.tokenBudget.RemainingPercent = 0
		}
		return store.CompletedSessionTurnResult{}, f.completedTurnErr
	}
	episodeID := input.EpisodeID
	if input.Episode != nil {
		f.savedLearningEpisodes = append(f.savedLearningEpisodes, *input.Episode)
		episodeID = f.nextEpisodeID
		if episodeID == 0 {
			episodeID = 1
		}
	}
	result := store.CompletedSessionTurnResult{
		StudentMessageID: 201,
		AgentMessageID:   202,
		EvidenceEventID:  303,
		EpisodeID:        episodeID,
	}
	if input.TokenDebit != nil && input.TokenDebit.TotalTokens > 0 {
		budget := f.tokenBudget
		actualDebit := input.TokenDebit.TotalTokens
		if actualDebit > budget.RemainingTokens {
			actualDebit = budget.RemainingTokens
		}
		f.atomicTokenDebited += actualDebit
		budget.UsedTokens += actualDebit
		budget.RemainingTokens = budget.DailyQuota - budget.UsedTokens
		budget.RemainingPercent = int(math.Round(float64(budget.RemainingTokens) * 100 / float64(budget.DailyQuota)))
		f.tokenBudget = budget
		result.TokenBudget = &budget
	}
	for index := range input.MemoryEvents {
		input.MemoryEvents[index].MessageID = result.StudentMessageID
		if input.MemoryEvents[index].SourceEventID == 0 {
			input.MemoryEvents[index].SourceEventID = episodeID
		}
	}
	for index := range input.LearningFacts {
		input.LearningFacts[index].SourceEpisodeID = episodeID
	}
	input.Evidence = cloneGatewayTestMap(input.Evidence)
	f.persistedCompletedTurns = append(f.persistedCompletedTurns, struct {
		store.CompletedSessionTurnInput
		Result store.CompletedSessionTurnResult
	}{CompletedSessionTurnInput: input, Result: result})
	if f.autoCommitCompletedTurns {
		for _, event := range input.ConversationEvents {
			if strings.TrimSpace(event.ClientTurnID) != "" {
				if f.committedClientTurns == nil {
					f.committedClientTurns = map[string]bool{}
				}
				f.committedClientTurns[input.SessionID+"/"+event.ClientTurnID] = true
				break
			}
		}
	}
	return result, nil
}

func cloneGatewayTestMap(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = cloneGatewayTestValue(value)
	}
	return cloned
}

func cloneGatewayTestValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneGatewayTestMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for index, item := range typed {
			cloned[index] = cloneGatewayTestValue(item)
		}
		return cloned
	case []map[string]any:
		cloned := make([]map[string]any, len(typed))
		for index, item := range typed {
			cloned[index] = cloneGatewayTestMap(item)
		}
		return cloned
	case []string:
		return append([]string(nil), typed...)
	case map[string]string:
		cloned := make(map[string]string, len(typed))
		for key, item := range typed {
			cloned[key] = item
		}
		return cloned
	default:
		return typed
	}
}

func (f *fakeSessionStore) MarkLearningEpisodeFailed(_ context.Context, episodeID int64, status string) error {
	f.markedFailedEpisodes = append(f.markedFailedEpisodes, struct {
		episodeID int64
		status    string
	}{episodeID: episodeID, status: status})
	return nil
}

func (f *fakeSessionStore) GetTokenBudget(_ context.Context) (store.TokenBudget, error) {
	f.tokenBudgetLookups++
	if f.tokenBudget.Scope == "" {
		f.tokenBudget = store.TokenBudget{
			Scope:            store.TokenBudgetScope,
			DailyQuota:       store.DefaultDailyTokenQuota,
			UsedTokens:       0,
			RemainingTokens:  store.DefaultDailyTokenQuota,
			RemainingPercent: 100,
			ResetAt:          "2026-07-13T00:00:00Z",
			UpdatedAt:        "2026-07-13T00:00:00Z",
		}
	}
	return f.tokenBudget, nil
}

func (f *fakeSessionStore) ListLearnerTopicProgress(_ context.Context, learnerID string) ([]store.LearnerTopicProgress, error) {
	f.listedProgressFor = learnerID
	return f.testTopicProgress, nil
}

func (f *fakeSessionStore) GetLearnerTopicProgress(_ context.Context, learnerID, topicID string) (store.LearnerTopicProgress, bool, error) {
	f.progressLookups++
	f.testProgressLearner = learnerID
	f.testProgressTopic = topicID
	return f.testProgress, f.testProgressFound, nil
}

func (f *fakeSessionStore) ListRecentTestQuestions(_ context.Context, learnerID, topicID string, limit int) ([]store.TestQuestion, error) {
	f.recentTestLearner = learnerID
	f.recentTestTopic = topicID
	f.recentTestLimit = limit
	return f.recentTestQuestions, nil
}

func (f *fakeSessionStore) CreateTestQuestion(_ context.Context, input store.CreateTestQuestionInput) (store.TestQuestion, error) {
	f.createdTestQuestions = append(f.createdTestQuestions, input)
	if f.testQuestionErr != nil {
		return store.TestQuestion{}, f.testQuestionErr
	}
	if f.testQuestion.ID != "" {
		return f.testQuestion, nil
	}
	return store.TestQuestion{
		ID:                  "question-created",
		LearnerID:           input.LearnerID,
		TopicID:             input.TopicID,
		Level:               input.Level,
		QuestionFormat:      input.QuestionFormat,
		QuestionText:        input.QuestionText,
		Options:             append([]string(nil), input.Options...),
		ExpectedAnswer:      input.ExpectedAnswer,
		AcceptedEquivalents: append([]string(nil), input.AcceptedEquivalents...),
		GradingRubric:       append([]string(nil), input.GradingRubric...),
		KGGrounding:         input.KGGrounding,
		Provider:            input.Provider,
		Model:               input.Model,
		PromptTokens:        input.PromptTokens,
		CompletionTokens:    input.CompletionTokens,
		TotalTokens:         input.TotalTokens,
		Status:              "answerable",
	}, nil
}

func (f *fakeSessionStore) CreateFailedTestQuestion(_ context.Context, input store.CreateFailedTestQuestionInput) (store.TestQuestion, error) {
	f.failedTestQuestions = append(f.failedTestQuestions, input)
	if f.testQuestionErr != nil {
		return store.TestQuestion{}, f.testQuestionErr
	}
	return store.TestQuestion{
		ID:               "question-failed",
		LearnerID:        input.LearnerID,
		TopicID:          input.TopicID,
		Level:            input.Level,
		FailureCode:      input.FailureCode,
		Provider:         input.Provider,
		Model:            input.Model,
		PromptTokens:     input.PromptTokens,
		CompletionTokens: input.CompletionTokens,
		TotalTokens:      input.TotalTokens,
		Status:           "generation_failed",
	}, nil
}

func (f *fakeSessionStore) GetTestQuestion(_ context.Context, questionID string) (store.TestQuestion, error) {
	f.testQuestionLookups++
	if f.testQuestionErr != nil {
		return store.TestQuestion{}, f.testQuestionErr
	}
	if f.testQuestion.ID == "" {
		return store.TestQuestion{}, store.ErrTestQuestionNotFound
	}
	if questionID != f.testQuestion.ID {
		return store.TestQuestion{}, store.ErrTestQuestionNotFound
	}
	return f.testQuestion, nil
}

func (f *fakeSessionStore) GetTestAttemptByQuestion(_ context.Context, questionID string) (store.TestAttemptResult, bool, error) {
	f.testAttemptLookups++
	f.testAttemptQuestion = questionID
	return f.testAttemptResult, f.testAttemptFound, f.testAttemptErr
}

func (f *fakeSessionStore) ReserveTestAttempt(_ context.Context, learnerID, questionID, submittedAnswer string) (store.TestAttemptReservation, error) {
	f.reservedTestAnswers = append(f.reservedTestAnswers, submittedAnswer)
	if f.reserveTestAttemptErr != nil {
		return store.TestAttemptReservation{}, f.reserveTestAttemptErr
	}
	if f.testAttemptReservation.ID != "" {
		return f.testAttemptReservation, nil
	}
	return store.TestAttemptReservation{
		ID: "reservation-test", QuestionID: questionID, LearnerID: learnerID, SubmittedAnswer: submittedAnswer,
	}, nil
}

func (f *fakeSessionStore) ReleaseTestAttemptReservation(_ context.Context, _ store.TestAttemptReservation) error {
	f.releasedTestReservations++
	return f.releaseTestAttemptErr
}

func (f *fakeSessionStore) RecordTestAttempt(_ context.Context, input store.RecordTestAttemptInput) (store.TestAttemptResult, error) {
	f.recordedTestAttempts = append(f.recordedTestAttempts, input)
	return f.testAttemptResult, f.recordTestAttemptErr
}

func (f *fakeSessionStore) RecordTokenUsage(_ context.Context, totalTokens int) (store.TokenBudget, error) {
	f.recordedTokenUsage += totalTokens
	budget, _ := f.GetTokenBudget(context.Background())
	budget.UsedTokens += totalTokens
	if budget.UsedTokens > budget.DailyQuota {
		budget.UsedTokens = budget.DailyQuota
	}
	budget.RemainingTokens = budget.DailyQuota - budget.UsedTokens
	budget.RemainingPercent = int(math.Round(float64(budget.RemainingTokens) * 100 / float64(budget.DailyQuota)))
	f.tokenBudget = budget
	return budget, nil
}

func (f *fakeSessionStore) ResetTokenBudget(ctx context.Context) (store.TokenBudget, error) {
	f.resetTokenBudget = true
	f.tokenBudget = store.TokenBudget{}
	return f.GetTokenBudget(ctx)
}

func (f *fakeSessionStore) UpsertKGCandidateReview(_ context.Context, input store.KGCandidateReviewInput) (store.KGCandidateReview, error) {
	now := time.Now().UTC()
	review := store.KGCandidateReview{
		CandidateID:  input.CandidateID,
		Status:       input.Status,
		ReviewerID:   input.ReviewerID,
		ReviewerNote: input.ReviewerNote,
		ReviewedAt:   now,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	for index := range f.kgCandidateReviews {
		if f.kgCandidateReviews[index].CandidateID == input.CandidateID {
			review.ID = f.kgCandidateReviews[index].ID
			review.CreatedAt = f.kgCandidateReviews[index].CreatedAt
			f.kgCandidateReviews[index] = review
			return review, nil
		}
	}
	review.ID = int64(len(f.kgCandidateReviews) + 1)
	f.kgCandidateReviews = append(f.kgCandidateReviews, review)
	return review, nil
}

func (f *fakeSessionStore) ListKGCandidateReviews(_ context.Context) ([]store.KGCandidateReview, error) {
	return f.kgCandidateReviews, nil
}

func (f *fakeSessionStore) CreateHarnessCase(_ context.Context, record store.HarnessCaseRecord) (store.HarnessCaseRecord, error) {
	f.createdHarnessCase = record
	if record.Status == "" {
		record.Status = "pending"
	}
	if record.CreatedAt == "" {
		record.CreatedAt = "2026-07-09T00:00:00Z"
	}
	f.harnessCases = append(f.harnessCases, record)
	return record, nil
}

func (f *fakeSessionStore) ListHarnessCases(_ context.Context, _ store.HarnessCaseFilter) ([]store.HarnessCaseRecord, error) {
	return f.harnessCases, nil
}

func (f *fakeSessionStore) GetHarnessCase(_ context.Context, caseID string) (store.HarnessCaseRecord, error) {
	for _, record := range f.harnessCases {
		if record.CaseID == caseID {
			return record, nil
		}
	}
	return store.HarnessCaseRecord{}, store.ErrHarnessCaseNotFound
}

func (f *fakeSessionStore) ConfirmHarnessCase(_ context.Context, caseID string) (store.HarnessCaseRecord, error) {
	if f.confirmedHarnessCase.CaseID != "" {
		return f.confirmedHarnessCase, nil
	}
	record, err := f.GetHarnessCase(context.Background(), caseID)
	if err != nil {
		return store.HarnessCaseRecord{}, err
	}
	if record.Status == "deleted" {
		return store.HarnessCaseRecord{}, store.ErrHarnessCaseConflict
	}
	record.Status = "confirmed"
	return record, nil
}

func (f *fakeSessionStore) DeleteHarnessCase(_ context.Context, caseID string) (store.HarnessCaseRecord, error) {
	if f.deletedHarnessCase.CaseID != "" {
		return f.deletedHarnessCase, nil
	}
	record, err := f.GetHarnessCase(context.Background(), caseID)
	if err != nil {
		return store.HarnessCaseRecord{}, err
	}
	record.Status = "deleted"
	return record, nil
}

func (f *fakeSessionStore) AppendHarnessCaseEvent(_ context.Context, event store.HarnessCaseEvent) error {
	f.harnessCaseEvents = append(f.harnessCaseEvents, event)
	return nil
}

func writeTestCorpus(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	chunks := strings.Join([]string{
		`{"chunk_id":"chunk-list","doc_id":"tutorial:datastructures","section_id":"5-1-more-on-lists","title":"5.1. More on Lists","heading_path":["5. Data Structures","5.1. More on Lists"],"source_url":"https://docs.python.org/3/tutorial/datastructures.html#5-1-more-on-lists","text":"list.pop raises an IndexError if the list is empty or the index is outside the list range. list.index returns zero-based index.","char_count":128,"code_block_count":1,"quality_flags":["has_code","official_source"],"version":"3.14.6","source":"Python official documentation","license":"Python Software Foundation License"}`,
		`{"chunk_id":"chunk-text","doc_id":"tutorial:introduction","section_id":"3-1-2-text","title":"3.1.2. Text","heading_path":["3. An Informal Introduction to Python","3.1.2. Text"],"source_url":"https://docs.python.org/3/tutorial/introduction.html#3-1-2-text","text":"Strings can be indexed and sliced.","char_count":35,"code_block_count":0,"quality_flags":["official_source"],"version":"3.14.6","source":"Python official documentation","license":"Python Software Foundation License"}`,
	}, "\n") + "\n"
	glossary := `{"term":"list","term_id":"term-list","definition":"A built-in Python sequence.","source_url":"https://docs.python.org/3/glossary.html#term-list","version":"3.14.6","source":"Python official documentation","license":"Python Software Foundation License"}` + "\n"
	manifest := `{"version":"3.14.6","counts":{"chunks":2,"glossary_terms":1}}` + "\n"

	if err := os.WriteFile(filepath.Join(dir, "chunks.jsonl"), []byte(chunks), 0o644); err != nil {
		t.Fatalf("write chunks: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "glossary_terms.jsonl"), []byte(glossary), 0o644); err != nil {
		t.Fatalf("write glossary: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "source_manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	return dir
}

func writeTestKGCandidates(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "candidates.jsonl")
	candidates := strings.Join([]string{
		`{"candidate_id":"kgcand-indexerror","source_id":"python-docs-3.14.6","source_chunk_id":"chunk-list","source_url":"https://docs.python.org/3/tutorial/datastructures.html#more-on-lists","source_license_note":"python-software-foundation-documentation-license","subject":"Concept:valid_index_range","predicate":"prevents","object":"ErrorType:IndexError","confidence":0.88,"evidence_text":"It raises an IndexError if the list is empty or the index is outside the list range","status":"auto_extracted","created_at":"2026-07-03T00:00:00Z"}`,
		`{"candidate_id":"kgcand-slice","source_id":"python-docs-3.14.6","source_chunk_id":"chunk-text","source_url":"https://docs.python.org/3/tutorial/introduction.html#lists","source_license_note":"python-software-foundation-documentation-license","subject":"Concept:list","predicate":"supports_operation","object":"Concept:slice","confidence":0.72,"evidence_text":"Lists can be sliced.","status":"auto_extracted","created_at":"2026-07-03T00:00:00Z"}`,
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(candidates), 0o644); err != nil {
		t.Fatalf("write candidates: %v", err)
	}
	return path
}
