package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"responsible-edu-agent/services/api-gateway-go/internal/store"
)

type directAnswerDialogueCase struct {
	name                  string
	recent                []store.Message
	message               string
	chargeable            bool
	startingRemaining     int
	expectedFullStepCalls int
	expectedPersistCalls  int
	expectedChargedTokens int
	expectedBudgetEvents  int
}

func TestDirectAnswerTokenDialogueAcceptance(t *testing.T) {
	directDiscussion := []store.Message{
		{Role: "student", Content: "请直接给我完整答案"},
		{Role: "agent", Content: "我会先通过提示帮助你完成练习。"},
	}
	tenDistinctMessages := []store.Message{
		{Role: "student", Content: "history-01: old direct-answer request"},
		{Role: "agent", Content: "history-02: old response"},
		{Role: "student", Content: "请直接给我完整答案"},
		{Role: "agent", Content: "history-04: list explanation"},
		{Role: "student", Content: "history-05: index topic"},
		{Role: "agent", Content: "history-06: index explanation"},
		{Role: "student", Content: "history-07: dictionary topic"},
		{Role: "agent", Content: "history-08: dictionary explanation"},
		{Role: "student", Content: "history-09: set topic"},
		{Role: "agent", Content: "history-10: set explanation"},
	}
	cases := []directAnswerDialogueCase{
		{
			name: "greeting at positive balance", message: "你好", startingRemaining: 1000,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "conceptual explanation at zero balance", message: "再解释一下 dictionary", startingRemaining: 0,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "hint request at zero balance", message: "给我一个提示", startingRemaining: 0,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "direct complete answer at positive balance",
			recent: []store.Message{
				{Role: "student", Content: "这道 Python 索引题我不会。"},
				{Role: "agent", Content: "先判断合法索引范围。"},
			},
			message: "请直接给我完整答案，不要再提示", chargeable: true, startingRemaining: 1000,
			expectedFullStepCalls: 1, expectedPersistCalls: 1, expectedChargedTokens: 180,
		},
		{
			name: "English final-answer request at positive balance", message: "Just give me the final answer.",
			chargeable: true, startingRemaining: 1000, expectedFullStepCalls: 1,
			expectedPersistCalls: 1, expectedChargedTokens: 180,
		},
		{
			name:    "completed-code request at positive balance",
			recent:  []store.Message{{Role: "agent", Content: "请先完成函数主体。"}},
			message: "把这个函数写完给我", chargeable: true, startingRemaining: 1000,
			expectedFullStepCalls: 1, expectedPersistCalls: 1, expectedChargedTokens: 180,
		},
		{
			name: "negated direct-answer request after earlier direct-answer discussion", recent: directDiscussion,
			message: "不要直接给答案，让我自己试", startingRemaining: 0,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "meta-question after earlier direct-answer discussion", recent: directDiscussion,
			message: "你会直接给答案吗？", startingRemaining: 0,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "quotation containing direct-answer wording", message: "老师说“直接给答案”是什么意思？", startingRemaining: 0,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "casual concise self-introduction request", message: "直接说你叫什么名字", startingRemaining: 0,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "unfinished Python exercise followed by context-resolved direct request",
			recent: []store.Message{
				{Role: "student", Content: "我还没完成这道 list 索引练习。"},
				{Role: "agent", Content: "长度为 4 时，先想想最大合法索引。"},
			},
			message: "那你直接说答案吧", chargeable: true, startingRemaining: 1000,
			expectedFullStepCalls: 1, expectedPersistCalls: 1, expectedChargedTokens: 180,
		},
		{
			name: "old direct-answer request followed by tuple topic switch", recent: tenDistinctMessages,
			message: "换成讲 tuple", startingRemaining: 0,
			expectedFullStepCalls: 1, expectedPersistCalls: 1,
		},
		{
			name: "chargeable request at zero balance", message: "直接给我这道 Python 题的正确答案",
			chargeable: true, startingRemaining: 0,
		},
		{
			name: "identical chargeable request through stream and non-stream transports",
			recent: []store.Message{
				{Role: "student", Content: "请帮我完成这个 Python 练习。"},
				{Role: "agent", Content: "先写出你的第一步。"},
			},
			message: "Just give me the final answer.", chargeable: true, startingRemaining: 1000,
			expectedFullStepCalls: 1, expectedPersistCalls: 1, expectedChargedTokens: 180,
			expectedBudgetEvents: 1,
		},
	}

	if len(cases) != 14 {
		t.Fatalf("dialogue case count = %d, want 14", len(cases))
	}
	for index, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if index == len(cases)-1 {
				nonStream := assertDirectAnswerDialogueTransport(t, testCase, false, 0)
				stream := assertDirectAnswerDialogueTransport(t, testCase, true, testCase.expectedBudgetEvents)
				if nonStream.decisionChargeable != stream.decisionChargeable ||
					nonStream.decisionReason != stream.decisionReason ||
					nonStream.chargedTokens != stream.chargedTokens {
					t.Fatalf("transport parity mismatch: non-stream=%+v stream=%+v", nonStream, stream)
				}
				return
			}
			assertDirectAnswerDialogueTransport(t, testCase, false, testCase.expectedBudgetEvents)
		})
	}
}

type directAnswerDialogueObservation struct {
	decisionChargeable bool
	decisionReason     string
	chargedTokens      int
}

type directAnswerParticipantStore struct {
	*fakeSessionStore
	participant        store.Participant
	token              string
	budgetScopeLookups []string
	legacyScopeWrites  []string
}

func (s *directAnswerParticipantStore) CreateParticipant(_ context.Context, _ string, _ bool) (store.Participant, string, error) {
	return s.participant, s.token, nil
}

func (s *directAnswerParticipantStore) GetParticipantByToken(_ context.Context, token string) (store.Participant, error) {
	if token != s.token {
		return store.Participant{}, store.ErrParticipantNotFound
	}
	return s.participant, nil
}

func (s *directAnswerParticipantStore) LinkParticipantSession(_ context.Context, participantID, sessionID string) error {
	if participantID != s.participant.ID || sessionID != "session-demo" {
		return store.ErrParticipantNotFound
	}
	return nil
}

func (s *directAnswerParticipantStore) ParticipantOwnsSession(_ context.Context, participantID, sessionID string) (bool, error) {
	return participantID == s.participant.ID && sessionID == "session-demo", nil
}

func (s *directAnswerParticipantStore) ListParticipantSessions(_ context.Context, participantID, _ string) ([]store.SessionSummary, error) {
	if participantID != s.participant.ID {
		return nil, store.ErrParticipantNotFound
	}
	return nil, nil
}

func (s *directAnswerParticipantStore) GetTokenBudgetForScope(_ context.Context, scope string) (store.TokenBudget, error) {
	s.budgetScopeLookups = append(s.budgetScopeLookups, scope)
	return s.tokenBudget, nil
}

func (s *directAnswerParticipantStore) RecordTokenUsageForScope(_ context.Context, scope string, _ int) (store.TokenBudget, error) {
	s.legacyScopeWrites = append(s.legacyScopeWrites, scope)
	return s.tokenBudget, nil
}

func (s *directAnswerParticipantStore) ResetTokenBudgetForScope(_ context.Context, scope string) (store.TokenBudget, error) {
	s.legacyScopeWrites = append(s.legacyScopeWrites, scope)
	return s.tokenBudget, nil
}

func (s *directAnswerParticipantStore) ListRecentMessages(_ context.Context, sessionID string, limit int) ([]store.Message, error) {
	s.recentSessionID = sessionID
	messages := append([]store.Message(nil), s.recentMessages...)
	if limit > 0 && len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}
	return messages, nil
}

type directAnswerDialogueAI struct {
	t                *testing.T
	decisionCalls    int
	decisionRequests []map[string]any
	fullAI           tokenChargeGatewayAI
}

func (a *directAnswerDialogueAI) handler(response http.ResponseWriter, request *http.Request) {
	a.t.Helper()
	if request.URL.Path != "/internal/token-charge/decision" {
		a.fullAI.handler(response, request)
		return
	}
	a.decisionCalls++
	var body map[string]any
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		a.t.Fatalf("decode dialogue decision request: %v", err)
	}
	a.decisionRequests = append(a.decisionRequests, body)
	message, _ := body["message"].(string)
	decision := directAnswerSemanticTestDecision(message, directAnswerRecentFromJSON(a.t, body["recent_messages"]))
	writeJSON(response, http.StatusOK, decision)
}

func directAnswerSemanticTestDecision(message string, recent []map[string]string) tokenChargeDecision {
	normalized := strings.ToLower(strings.Join(strings.Fields(message), " "))
	decision := tokenChargeDecision{
		Confidence: 0.97, DecisionSource: "llm", Model: "dialogue-semantic-test-double",
	}
	switch {
	case strings.Contains(normalized, "不要直接给答案"):
		decision.ReasonCode = "negated_direct_request"
	case strings.Contains(normalized, "你会直接给答案吗") ||
		(strings.Contains(normalized, "直接给答案") && strings.Contains(normalized, "是什么意思")):
		decision.ReasonCode = "meta_direct_answer_question"
	case normalized == "直接说你叫什么名字" || normalized == "你好":
		decision.ReasonCode = "casual_or_off_topic"
	case strings.Contains(normalized, "把这个函数写完给我"):
		decision.Chargeable = true
		decision.ReasonCode = "direct_code_completion_request"
	case normalized == "那你直接说答案吧" && directAnswerRecentEstablishesExercise(recent):
		decision.Chargeable = true
		decision.ReasonCode = "context_resolved_direct_request"
	case strings.Contains(normalized, "直接给我完整答案") ||
		strings.Contains(normalized, "直接给我这道 python 题的正确答案") ||
		strings.Contains(normalized, "just give me the final answer"):
		decision.Chargeable = true
		decision.ReasonCode = "direct_solution_request"
	default:
		decision.ReasonCode = "ordinary_tutoring_request"
	}
	return decision
}

func directAnswerRecentEstablishesExercise(recent []map[string]string) bool {
	for _, message := range recent {
		content := message["content"]
		if strings.Contains(content, "没完成") || strings.Contains(content, "最大合法索引") {
			return true
		}
	}
	return false
}

func runDirectAnswerDialogueMessage(
	t *testing.T,
	stream bool,
	sessionStore *directAnswerParticipantStore,
	ai *directAnswerDialogueAI,
	message string,
	clientTurnID string,
) *httptest.ResponseRecorder {
	t.Helper()
	aiCore := httptest.NewServer(http.HandlerFunc(ai.handler))
	t.Cleanup(aiCore.Close)
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sessionStore, AppMode: "development"})
	payload, err := json.Marshal(map[string]any{
		"session_id": "session-demo", "client_turn_id": clientTurnID, "message": message,
		"requested_focus_node_id": "Concept:list",
	})
	if err != nil {
		t.Fatalf("marshal dialogue request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/session/message", bytes.NewReader(payload))
	request.AddCookie(&http.Cookie{Name: participantCookieName, Value: sessionStore.token})
	response := httptest.NewRecorder()
	if stream {
		gateway.SessionMessageStream(response, request)
	} else {
		gateway.SessionMessage(response, request)
	}
	return response
}

func assertDirectAnswerDialogueTransport(
	t *testing.T,
	testCase directAnswerDialogueCase,
	stream bool,
	expectedBudgetEvents int,
) directAnswerDialogueObservation {
	t.Helper()
	startingBudget := tokenChargeTestBudget(testCase.startingRemaining)
	baseStore := &fakeSessionStore{
		tokenBudget:            startingBudget,
		recentMessages:         append([]store.Message(nil), testCase.recent...),
		conversationProjection: task6StoredProjection(),
	}
	sessionStore := &directAnswerParticipantStore{
		fakeSessionStore: baseStore,
		participant: store.Participant{
			ID: "participant-dialogue-001", Mode: "development", ConsentedAt: "2026-07-22T12:00:00+08:00",
		},
		token: "participant-dialogue-token",
	}
	reasonCode := directAnswerDialogueReason(testCase.name)
	ai := &directAnswerDialogueAI{t: t}
	ai.fullAI = tokenChargeGatewayAI{t: t}
	transport := "non-stream"
	if stream {
		transport = "stream"
	}
	response := runDirectAnswerDialogueMessage(
		t,
		stream,
		sessionStore,
		ai,
		testCase.message,
		"dialogue-"+strings.ReplaceAll(strings.ReplaceAll(testCase.name, " ", "-"), "/", "-")+"-"+transport,
	)

	if testCase.chargeable && testCase.startingRemaining == 0 {
		if stream {
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"failed_stage":"token_budget"`) {
				t.Fatalf("%s exhausted response = %d %s", transport, response.Code, response.Body.String())
			}
		} else if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), `"error":"token_budget_exhausted"`) {
			t.Fatalf("%s exhausted response = %d %s", transport, response.Code, response.Body.String())
		}
	} else if response.Code != http.StatusOK {
		t.Fatalf("%s response = %d %s", transport, response.Code, response.Body.String())
	}

	if ai.decisionCalls != 1 || len(ai.decisionRequests) != 1 {
		t.Fatalf("%s classifier calls = %d requests = %d, want 1 and 1", transport, ai.decisionCalls, len(ai.decisionRequests))
	}
	decisionRequest := ai.decisionRequests[0]
	if decisionRequest["message"] != testCase.message {
		t.Fatalf("%s classifier current message = %#v, want %q", transport, decisionRequest["message"], testCase.message)
	}
	expectedRecent := directAnswerExpectedRecent(testCase.name, testCase.recent)
	actualRecent := directAnswerRecentFromJSON(t, decisionRequest["recent_messages"])
	if len(actualRecent) > 8 || !reflect.DeepEqual(actualRecent, expectedRecent) {
		t.Fatalf("%s classifier recent context = %#v, want bounded %#v", transport, actualRecent, expectedRecent)
	}
	if decisionRequest["active_topic"] != "topic-dictionary" || decisionRequest["selected_node_id"] != "Concept:list" {
		t.Fatalf("%s classifier context metadata = active:%#v selected:%#v", transport, decisionRequest["active_topic"], decisionRequest["selected_node_id"])
	}

	if ai.fullAI.fullStepCalls != testCase.expectedFullStepCalls || len(ai.fullAI.fullStepRequests) != testCase.expectedFullStepCalls {
		t.Fatalf("%s full-step calls = %d requests = %d, want %d", transport, ai.fullAI.fullStepCalls, len(ai.fullAI.fullStepRequests), testCase.expectedFullStepCalls)
	}
	if baseStore.persistCompletedTurnCalls != testCase.expectedPersistCalls || len(baseStore.persistedCompletedTurns) != testCase.expectedPersistCalls {
		t.Fatalf("%s persistence calls = %d committed turns = %d, want %d", transport, baseStore.persistCompletedTurnCalls, len(baseStore.persistedCompletedTurns), testCase.expectedPersistCalls)
	}
	if ai.fullAI.fullStepCalls == 1 {
		fullRequest := ai.fullAI.fullStepRequests[0]
		if fullRequest["message"] != testCase.message {
			t.Fatalf("%s full-step current message = %#v, want %q", transport, fullRequest["message"], testCase.message)
		}
		if fullRecent := directAnswerRecentFromJSON(t, fullRequest["recent_messages"]); !reflect.DeepEqual(fullRecent, expectedRecent) {
			t.Fatalf("%s full-step recent context = %#v, want %#v", transport, fullRecent, expectedRecent)
		}
		assertDirectAnswerDecisionMap(t, transport+" forwarded decision", fullRequest["token_charge_decision"], testCase.chargeable, reasonCode, 0, false)
	}

	budgetEvents := strings.Count(response.Body.String(), `"type":"token_budget_updated"`)
	if budgetEvents != expectedBudgetEvents {
		t.Fatalf("%s token_budget_updated events = %d, want %d: %s", transport, budgetEvents, expectedBudgetEvents, response.Body.String())
	}
	if baseStore.tokenBudgetLookups != 0 {
		t.Fatalf("%s used global budget lookup %d times", transport, baseStore.tokenBudgetLookups)
	}
	if len(sessionStore.legacyScopeWrites) != 0 || baseStore.recordedTokenUsage != 0 {
		t.Fatalf("%s used legacy budget write: scoped=%#v global_tokens=%d", transport, sessionStore.legacyScopeWrites, baseStore.recordedTokenUsage)
	}
	if testCase.chargeable {
		if len(sessionStore.budgetScopeLookups) != 1 || sessionStore.budgetScopeLookups[0] != sessionStore.participant.ID {
			t.Fatalf("%s participant budget scopes = %#v, want [%q]", transport, sessionStore.budgetScopeLookups, sessionStore.participant.ID)
		}
	} else {
		if len(sessionStore.budgetScopeLookups) != 0 || baseStore.atomicTokenDebited != 0 {
			t.Fatalf("%s free turn touched participant budget: scopes=%#v debit=%d", transport, sessionStore.budgetScopeLookups, baseStore.atomicTokenDebited)
		}
	}
	if baseStore.atomicTokenDebited != testCase.expectedChargedTokens {
		t.Fatalf("%s charged tokens = %d, want %d", transport, baseStore.atomicTokenDebited, testCase.expectedChargedTokens)
	}
	if baseStore.tokenBudget.UsedTokens-startingBudget.UsedTokens != testCase.expectedChargedTokens {
		t.Fatalf("%s used_tokens delta = %d, want %d", transport, baseStore.tokenBudget.UsedTokens-startingBudget.UsedTokens, testCase.expectedChargedTokens)
	}

	if testCase.expectedPersistCalls == 0 {
		var exhausted map[string]any
		if stream {
			line := strings.TrimSpace(response.Body.String())
			if err := json.Unmarshal([]byte(line), &exhausted); err != nil {
				t.Fatalf("decode %s exhausted response: %v", transport, err)
			}
		} else if err := json.Unmarshal(response.Body.Bytes(), &exhausted); err != nil {
			t.Fatalf("decode %s exhausted response: %v", transport, err)
		}
		assertDirectAnswerDecisionMap(t, transport+" exhausted decision", exhausted["token_charge_decision"], testCase.chargeable, reasonCode, 0, false)
		return directAnswerObservationFromMap(t, exhausted["token_charge_decision"])
	}

	completed := baseStore.persistedCompletedTurns[0].CompletedSessionTurnInput
	if completed.StudentContent != testCase.message {
		t.Fatalf("%s persisted current message = %q, want %q", transport, completed.StudentContent, testCase.message)
	}
	assertDirectAnswerDecisionMap(
		t,
		transport+" persisted decision",
		completed.Evidence["token_charge_decision"],
		testCase.chargeable,
		reasonCode,
		testCase.expectedChargedTokens,
		true,
	)
	if testCase.expectedChargedTokens == 0 {
		if completed.TokenDebit != nil {
			t.Fatalf("%s free turn persisted debit %#v", transport, completed.TokenDebit)
		}
	} else {
		if completed.TokenDebit == nil || completed.TokenDebit.Scope != sessionStore.participant.ID || completed.TokenDebit.TotalTokens != 180 {
			t.Fatalf("%s persisted debit = %#v, want scope %q and 180", transport, completed.TokenDebit, sessionStore.participant.ID)
		}
	}
	return directAnswerObservationFromMap(t, completed.Evidence["token_charge_decision"])
}

func directAnswerDialogueReason(name string) string {
	switch name {
	case "greeting at positive balance", "casual concise self-introduction request":
		return "casual_or_off_topic"
	case "direct complete answer at positive balance", "English final-answer request at positive balance",
		"chargeable request at zero balance", "identical chargeable request through stream and non-stream transports":
		return "direct_solution_request"
	case "completed-code request at positive balance":
		return "direct_code_completion_request"
	case "negated direct-answer request after earlier direct-answer discussion":
		return "negated_direct_request"
	case "meta-question after earlier direct-answer discussion", "quotation containing direct-answer wording":
		return "meta_direct_answer_question"
	case "unfinished Python exercise followed by context-resolved direct request":
		return "context_resolved_direct_request"
	default:
		return "ordinary_tutoring_request"
	}
}

func directAnswerExpectedRecent(caseName string, messages []store.Message) []map[string]string {
	if caseName == "old direct-answer request followed by tuple topic switch" {
		return []map[string]string{
			{"role": "student", "content": "请直接给我完整答案"},
			{"role": "agent", "content": "history-04: list explanation"},
			{"role": "student", "content": "history-05: index topic"},
			{"role": "agent", "content": "history-06: index explanation"},
			{"role": "student", "content": "history-07: dictionary topic"},
			{"role": "agent", "content": "history-08: dictionary explanation"},
			{"role": "student", "content": "history-09: set topic"},
			{"role": "agent", "content": "history-10: set explanation"},
		}
	}
	result := make([]map[string]string, 0, len(messages))
	for _, message := range messages {
		role := strings.TrimSpace(message.Role)
		content := strings.TrimSpace(message.Content)
		if (role == "student" || role == "agent") && content != "" {
			result = append(result, map[string]string{"role": role, "content": content})
		}
	}
	return result
}

func directAnswerRecentFromJSON(t *testing.T, value any) []map[string]string {
	t.Helper()
	items, ok := value.([]any)
	if !ok {
		if value == nil {
			return []map[string]string{}
		}
		t.Fatalf("recent_messages type = %T, want []any", value)
	}
	result := make([]map[string]string, 0, len(items))
	for _, item := range items {
		fields, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("recent message type = %T, want map[string]any", item)
		}
		role, _ := fields["role"].(string)
		content, _ := fields["content"].(string)
		result = append(result, map[string]string{"role": role, "content": content})
	}
	return result
}

func directAnswerObservationFromMap(t *testing.T, value any) directAnswerDialogueObservation {
	t.Helper()
	decision, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("observed decision type = %T, want map[string]any", value)
	}
	chargeable, ok := decision["chargeable"].(bool)
	if !ok {
		t.Fatalf("observed chargeable = %#v, want bool", decision["chargeable"])
	}
	reason, ok := decision["reason_code"].(string)
	if !ok || strings.TrimSpace(reason) == "" {
		t.Fatalf("observed reason_code = %#v, want non-empty string", decision["reason_code"])
	}
	chargedTokens := 0
	if value, exists := decision["charged_tokens"]; exists {
		parsed, valid := integerFromJSONValue(value)
		if !valid {
			t.Fatalf("observed charged_tokens = %#v, want integer", value)
		}
		chargedTokens = int(parsed)
	}
	return directAnswerDialogueObservation{
		decisionChargeable: chargeable,
		decisionReason:     reason,
		chargedTokens:      chargedTokens,
	}
}

func assertDirectAnswerDecisionMap(
	t *testing.T,
	label string,
	value any,
	wantChargeable bool,
	wantReason string,
	wantChargedTokens int,
	expectChargedTokens bool,
) {
	t.Helper()
	decision, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s type = %T, want map[string]any", label, value)
	}
	if decision["chargeable"] != wantChargeable || decision["reason_code"] != wantReason {
		t.Fatalf("%s = %#v, want chargeable=%t reason=%q", label, decision, wantChargeable, wantReason)
	}
	if expectChargedTokens {
		chargedTokens, ok := integerFromJSONValue(decision["charged_tokens"])
		if !ok || chargedTokens != int64(wantChargedTokens) {
			t.Fatalf("%s charged_tokens = %#v, want %d", label, decision["charged_tokens"], wantChargedTokens)
		}
	}
}
