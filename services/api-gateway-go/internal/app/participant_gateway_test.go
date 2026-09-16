package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"responsible-edu-agent/services/api-gateway-go/internal/store"
)

func TestStudyConsentCreatesFourIsolatedParticipants(t *testing.T) {
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "study.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	gateway := NewGateway(Config{Store: db, AppMode: "study", AdminPassword: "admin-test-password"})

	status := httptest.NewRecorder()
	gateway.ParticipantStatus(status, httptest.NewRequest(http.MethodGet, "/api/participant/status", nil))
	if status.Code != http.StatusOK || !bytes.Contains(status.Body.Bytes(), []byte(`"consent_required":true`)) {
		t.Fatalf("initial participant status = %d %s", status.Code, status.Body.String())
	}

	participants := make([]*http.Cookie, 0, 4)
	for index := 0; index < 4; index++ {
		consent := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/participant/consent", bytes.NewBufferString(`{"accepted":true}`))
		gateway.ParticipantConsent(consent, request)
		if consent.Code != http.StatusOK || len(consent.Result().Cookies()) != 1 {
			t.Fatalf("participant %d consent = %d %s cookies=%#v", index, consent.Code, consent.Body.String(), consent.Result().Cookies())
		}
		if !consent.Result().Cookies()[0].Secure {
			t.Fatal("study participant cookie must be Secure")
		}
		participants = append(participants, consent.Result().Cookies()[0])

		start := httptest.NewRecorder()
		startRequest := httptest.NewRequest(http.MethodPost, "/api/session/start", bytes.NewBufferString(`{"scenario":"python-learning"}`))
		startRequest.AddCookie(participants[index])
		gateway.SessionStart(start, startRequest)
		if start.Code != http.StatusOK {
			t.Fatalf("participant %d start = %d %s", index, start.Code, start.Body.String())
		}
	}

	for index, cookie := range participants {
		list := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/sessions?status=active", nil)
		request.AddCookie(cookie)
		gateway.Sessions(list, request)
		var payload struct {
			Sessions []store.SessionSummary `json:"sessions"`
		}
		if err := json.Unmarshal(list.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if list.Code != http.StatusOK || len(payload.Sessions) != 1 {
			t.Fatalf("participant %d sessions = %d %#v", index, list.Code, payload.Sessions)
		}

		budget := httptest.NewRecorder()
		budgetRequest := httptest.NewRequest(http.MethodGet, "/api/token-budget", nil)
		budgetRequest.AddCookie(cookie)
		gateway.TokenBudget(budget, budgetRequest)
		if budget.Code != http.StatusOK || !bytes.Contains(budget.Body.Bytes(), []byte(`"remaining_tokens":24000`)) {
			t.Fatalf("participant %d budget = %d %s", index, budget.Code, budget.Body.String())
		}
	}

	first, err := db.GetParticipantByToken(context.Background(), participants[0].Value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.RecordTokenUsageForScope(context.Background(), first.ID, 500); err != nil {
		t.Fatal(err)
	}
	firstBudget := httptest.NewRecorder()
	firstBudgetRequest := httptest.NewRequest(http.MethodGet, "/api/token-budget", nil)
	firstBudgetRequest.AddCookie(participants[0])
	gateway.TokenBudget(firstBudget, firstBudgetRequest)
	if !bytes.Contains(firstBudget.Body.Bytes(), []byte(`"used_tokens":500`)) {
		t.Fatalf("first budget was not scoped: %s", firstBudget.Body.String())
	}
	secondBudget := httptest.NewRecorder()
	secondBudgetRequest := httptest.NewRequest(http.MethodGet, "/api/token-budget", nil)
	secondBudgetRequest.AddCookie(participants[1])
	gateway.TokenBudget(secondBudget, secondBudgetRequest)
	if !bytes.Contains(secondBudget.Body.Bytes(), []byte(`"used_tokens":0`)) {
		t.Fatalf("second budget changed with first: %s", secondBudget.Body.String())
	}

	question, err := db.CreateTestQuestion(context.Background(), store.CreateTestQuestionInput{
		LearnerID: first.ID, TopicID: "python_syntax_program_structure", Level: 1,
		QuestionFormat: "multiple_choice", QuestionText: "Which value is an integer?",
		Options: []string{"1", "one", "1.0", "True"}, ExpectedAnswer: "1",
	})
	if err != nil {
		t.Fatal(err)
	}
	reservation, err := db.ReserveTestAttempt(context.Background(), first.ID, question.ID, "1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.RecordTestAttempt(context.Background(), store.RecordTestAttemptInput{
		LearnerID: first.ID, QuestionID: question.ID, ReservationID: reservation.ID,
		SubmittedAnswer: "1", IsCorrect: true, Score: 1, Reason: "correct", Feedback: "Correct.",
	}); err != nil {
		t.Fatal(err)
	}
	for index, cookie := range participants[:2] {
		topics := httptest.NewRecorder()
		topicsRequest := httptest.NewRequest(http.MethodGet, "/api/tests/topics", nil)
		topicsRequest.AddCookie(cookie)
		gateway.TestTopics(topics, topicsRequest)
		want := `"score":0`
		if index == 0 {
			want = `"score":1`
		}
		if topics.Code != http.StatusOK || !bytes.Contains(topics.Body.Bytes(), []byte(want)) {
			t.Fatalf("participant %d topic progress = %d %s", index, topics.Code, topics.Body.String())
		}
	}
}

func TestStudyAdminRequiresConfiguredPassword(t *testing.T) {
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "admin.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	gateway := NewGateway(Config{Store: db, AppMode: "study", AdminPassword: "admin-test-password"})

	consent := httptest.NewRecorder()
	gateway.ParticipantConsent(consent, httptest.NewRequest(http.MethodPost, "/api/participant/consent", bytes.NewBufferString(`{"accepted":true}`)))
	participantCookie := consent.Result().Cookies()[0]
	start := httptest.NewRecorder()
	startRequest := httptest.NewRequest(http.MethodPost, "/api/session/start", bytes.NewBufferString(`{"scenario":"participant-session"}`))
	startRequest.AddCookie(participantCookie)
	gateway.SessionStart(start, startRequest)
	if start.Code != http.StatusOK {
		t.Fatalf("participant session start = %d %s", start.Code, start.Body.String())
	}
	if _, err := db.CreateSession(context.Background(), "other-participant-session"); err != nil {
		t.Fatal(err)
	}

	status := httptest.NewRecorder()
	gateway.AdminStatus(status, httptest.NewRequest(http.MethodGet, "/api/admin/status", nil))
	if status.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated admin status = %d %s", status.Code, status.Body.String())
	}

	wrong := httptest.NewRecorder()
	gateway.AdminLogin(wrong, httptest.NewRequest(http.MethodPost, "/api/admin/login", bytes.NewBufferString(`{"password":"wrong"}`)))
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password = %d %s", wrong.Code, wrong.Body.String())
	}

	login := httptest.NewRecorder()
	gateway.AdminLogin(login, httptest.NewRequest(http.MethodPost, "/api/admin/login", bytes.NewBufferString(`{"password":"admin-test-password"}`)))
	if login.Code != http.StatusOK || len(login.Result().Cookies()) != 1 {
		t.Fatalf("admin login = %d %s cookies=%#v", login.Code, login.Body.String(), login.Result().Cookies())
	}
	allowed := httptest.NewRecorder()
	allowedRequest := httptest.NewRequest(http.MethodGet, "/api/admin/status", nil)
	allowedRequest.AddCookie(login.Result().Cookies()[0])
	gateway.AdminStatus(allowed, allowedRequest)
	if allowed.Code != http.StatusOK {
		t.Fatalf("authenticated admin status = %d %s", allowed.Code, allowed.Body.String())
	}
	studentSessions := httptest.NewRecorder()
	studentSessionsRequest := httptest.NewRequest(http.MethodGet, "/api/sessions?status=active", nil)
	studentSessionsRequest.AddCookie(participantCookie)
	studentSessionsRequest.AddCookie(login.Result().Cookies()[0])
	gateway.Sessions(studentSessions, studentSessionsRequest)
	var studentPayload struct {
		Sessions []store.SessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(studentSessions.Body.Bytes(), &studentPayload); err != nil {
		t.Fatal(err)
	}
	if studentSessions.Code != http.StatusOK || len(studentPayload.Sessions) != 1 {
		t.Fatalf("student request with admin cookie leaked sessions = %d %#v", studentSessions.Code, studentPayload.Sessions)
	}
	adminSessions := httptest.NewRecorder()
	adminSessionsRequest := httptest.NewRequest(http.MethodGet, "/api/sessions?status=active", nil)
	adminSessionsRequest.AddCookie(login.Result().Cookies()[0])
	adminSessionsRequest.Header.Set("X-REA-Admin-Access", "1")
	gateway.Sessions(adminSessions, adminSessionsRequest)
	var adminPayload struct {
		Sessions []store.SessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(adminSessions.Body.Bytes(), &adminPayload); err != nil {
		t.Fatal(err)
	}
	if adminSessions.Code != http.StatusOK || len(adminPayload.Sessions) != 2 {
		t.Fatalf("admin session list = %d %#v", adminSessions.Code, adminPayload.Sessions)
	}
}
