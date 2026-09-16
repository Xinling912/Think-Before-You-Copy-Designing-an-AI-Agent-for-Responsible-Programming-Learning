package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"responsible-edu-agent/services/api-gateway-go/internal/store"

	"github.com/zeromicro/go-zero/rest/pathvar"
)

func TestHarnessCaseCompileCallsAICoreAndPersistsPending(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeHarnessAppSuite(t)

	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/ai/harness/compile-case" {
			t.Fatalf("expected /ai/harness/compile-case, got %s", request.URL.Path)
		}
		var payload map[string]string
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode AI request: %v", err)
		}
		if payload["suite_id"] != "test-harness-suite" || payload["scenario_id"] != "python-loop-termination" {
			t.Fatalf("unexpected AI request payload: %#v", payload)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"compiled_case": map[string]any{
				"schema_version":           "harness.case.v1",
				"case_id":                  "case-loop-termination",
				"suite_id":                 "test-harness-suite",
				"scenario_id":              "python-loop-termination",
				"title":                    "While loop termination explanation",
				"natural_language_request": payload["natural_language_request"],
				"turns":                    []map[string]string{{"role": "student", "content": "When does the loop stop?"}},
				"expected":                 map[string]any{"required_evidence": []string{"condition becomes false"}},
				"assertions":               []string{"response explains the stopping condition"},
			},
			"validator_errors": []string{},
			"model":            "qwen3.7-max",
			"llm_used":         true,
			"llm_fallback":     false,
		})
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sqliteStore, HarnessSuitePath: suitePath})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/harness/cases/compile",
		strings.NewReader(`{"suite_id":"test-harness-suite","scenario_id":"python-loop-termination","natural_language_request":"Explain when a while loop stops."}`),
	)
	response := httptest.NewRecorder()

	gateway.HarnessCaseCompile(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"status":"pending"`) || !strings.Contains(response.Body.String(), `"model":"qwen3.7-max"`) {
		t.Fatalf("expected pending qwen case response, got %s", response.Body.String())
	}
	persisted, err := sqliteStore.GetHarnessCase(context.Background(), "case-loop-termination")
	if err != nil {
		t.Fatalf("get persisted harness case: %v", err)
	}
	if persisted.Status != "pending" || persisted.NaturalLanguageRequest != "Explain when a while loop stops." {
		t.Fatalf("expected persisted pending case, got %#v", persisted)
	}
}

func TestHarnessCaseCompileReturnsSuiteLoadFailureForMalformedSuiteJSON(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeMalformedHarnessAppSuite(t)
	aiCoreCalled := false
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		aiCoreCalled = true
		writeJSON(response, http.StatusOK, map[string]any{})
	}))
	defer aiCore.Close()

	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sqliteStore, HarnessSuitePath: suitePath})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/harness/cases/compile",
		strings.NewReader(`{"suite_id":"test-harness-suite","scenario_id":"python-loop-termination","natural_language_request":"Explain when a while loop stops."}`),
	)
	response := httptest.NewRecorder()

	gateway.HarnessCaseCompile(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500 for malformed suites, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"harness_suites_load_failed"`) {
		t.Fatalf("expected harness_suites_load_failed error, got %s", response.Body.String())
	}
	if aiCoreCalled {
		t.Fatal("AI Core should not be called when suites cannot be loaded")
	}
}

func TestHarnessCaseCompileReturnsConflictForDuplicateAICaseID(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeHarnessAppSuite(t)
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"compiled_case": map[string]any{
				"schema_version":           "harness.case.v1",
				"case_id":                  "case-duplicate-ai",
				"suite_id":                 "test-harness-suite",
				"scenario_id":              "python-loop-termination",
				"natural_language_request": "Explain when a while loop stops.",
			},
			"validator_errors": []string{},
			"model":            "qwen3.7-max",
			"llm_used":         true,
			"llm_fallback":     false,
		})
	}))
	defer aiCore.Close()
	gateway := NewGateway(Config{AICoreURL: aiCore.URL, Store: sqliteStore, HarnessSuitePath: suitePath})
	body := `{"suite_id":"test-harness-suite","scenario_id":"python-loop-termination","natural_language_request":"Explain when a while loop stops."}`
	firstRequest := httptest.NewRequest(http.MethodPost, "/api/harness/cases/compile", strings.NewReader(body))
	firstResponse := httptest.NewRecorder()
	gateway.HarnessCaseCompile(firstResponse, firstRequest)
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("expected first compile status 200, got %d: %s", firstResponse.Code, firstResponse.Body.String())
	}
	secondRequest := httptest.NewRequest(http.MethodPost, "/api/harness/cases/compile", strings.NewReader(body))
	secondResponse := httptest.NewRecorder()

	gateway.HarnessCaseCompile(secondResponse, secondRequest)

	if secondResponse.Code != http.StatusConflict {
		t.Fatalf("expected duplicate case status 409, got %d: %s", secondResponse.Code, secondResponse.Body.String())
	}
	if !strings.Contains(secondResponse.Body.String(), `"error":"harness_case_lifecycle_conflict"`) {
		t.Fatalf("expected harness case conflict error, got %s", secondResponse.Body.String())
	}
}

func TestHarnessCasesListsActiveCasesByDefault(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	ctx := context.Background()
	pending := createHarnessAppCase(t, sqliteStore, "case-pending", "pending")
	deleted := createHarnessAppCase(t, sqliteStore, "case-deleted", "pending")
	if _, err := sqliteStore.DeleteHarnessCase(ctx, deleted.CaseID); err != nil {
		t.Fatalf("delete harness case: %v", err)
	}

	gateway := NewGateway(Config{Store: sqliteStore})
	request := httptest.NewRequest(http.MethodGet, "/api/harness/cases", nil)
	response := httptest.NewRecorder()

	gateway.HarnessCases(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), pending.CaseID) {
		t.Fatalf("expected active case in response, got %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), deleted.CaseID) {
		t.Fatalf("expected deleted case hidden by default, got %s", response.Body.String())
	}
}

func TestHarnessCasesRejectsInvalidStatusFilter(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	gateway := NewGateway(Config{Store: sqliteStore})
	request := httptest.NewRequest(http.MethodGet, "/api/harness/cases?status=archived", nil)
	response := httptest.NewRecorder()

	gateway.HarnessCases(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for invalid status filter, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"invalid_harness_case_filter"`) {
		t.Fatalf("expected invalid_harness_case_filter error, got %s", response.Body.String())
	}
}

func TestHarnessCasesReturnsLookupFailureForStorageError(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	if err := sqliteStore.Close(); err != nil {
		t.Fatalf("close sqlite store: %v", err)
	}
	gateway := NewGateway(Config{Store: sqliteStore})
	request := httptest.NewRequest(http.MethodGet, "/api/harness/cases", nil)
	response := httptest.NewRecorder()

	gateway.HarnessCases(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500 for storage failure, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"harness_cases_lookup_failed"`) {
		t.Fatalf("expected harness_cases_lookup_failed error, got %s", response.Body.String())
	}
}

func TestHarnessCaseConfirmEndpointConfirmsCase(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	created := createHarnessAppCase(t, sqliteStore, "case-confirm", "pending")
	gateway := NewGateway(Config{Store: sqliteStore})
	request := httptest.NewRequest(http.MethodPost, "/api/harness/cases/case-confirm/confirm", nil)
	request = pathvar.WithVars(request, map[string]string{"case_id": created.CaseID})
	response := httptest.NewRecorder()

	gateway.HarnessCaseConfirm(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	persisted, err := sqliteStore.GetHarnessCase(context.Background(), created.CaseID)
	if err != nil {
		t.Fatalf("get confirmed case: %v", err)
	}
	if persisted.Status != "confirmed" {
		t.Fatalf("expected confirmed case, got %#v", persisted)
	}
}

func TestHarnessCaseDeleteEndpointSoftDeletesCase(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	created := createHarnessAppCase(t, sqliteStore, "case-delete", "pending")
	gateway := NewGateway(Config{Store: sqliteStore})
	request := httptest.NewRequest(http.MethodDelete, "/api/harness/cases/case-delete", nil)
	request = pathvar.WithVars(request, map[string]string{"case_id": created.CaseID})
	response := httptest.NewRecorder()

	gateway.HarnessCaseDelete(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	persisted, err := sqliteStore.GetHarnessCase(context.Background(), created.CaseID)
	if err != nil {
		t.Fatalf("get deleted case: %v", err)
	}
	if persisted.Status != "deleted" || persisted.DeletedAt == nil {
		t.Fatalf("expected soft-deleted case, got %#v", persisted)
	}
}

func TestHarnessRunRejectsPendingAndDeletedCases(t *testing.T) {
	for _, status := range []string{"pending", "deleted"} {
		t.Run(status, func(t *testing.T) {
			sqliteStore := openHarnessAppStore(t)
			suitePath := writeHarnessAppSuite(t)
			created := createHarnessAppCase(t, sqliteStore, "case-"+status, "pending")
			if status == "deleted" {
				if _, err := sqliteStore.DeleteHarnessCase(context.Background(), created.CaseID); err != nil {
					t.Fatalf("delete harness case: %v", err)
				}
			}
			gateway := NewGateway(Config{
				Store:            sqliteStore,
				HarnessSuitePath: suitePath,
				HarnessLogDir:    t.TempDir(),
				ProjectRoot:      t.TempDir(),
			})
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/harness/run",
				strings.NewReader(`{"suite_id":"test-harness-suite","case_id":"`+created.CaseID+`"}`),
			)
			response := httptest.NewRecorder()

			gateway.HarnessRun(response, request)

			if response.Code != http.StatusConflict {
				t.Fatalf("expected status 409 for %s case, got %d: %s", status, response.Code, response.Body.String())
			}
		})
	}
}

func TestHarnessRunReturnsSuiteLoadFailureForMalformedSuiteJSON(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeMalformedHarnessAppSuite(t)
	gateway := NewGateway(Config{
		Store:            sqliteStore,
		HarnessSuitePath: suitePath,
		HarnessLogDir:    t.TempDir(),
		ProjectRoot:      t.TempDir(),
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/harness/run",
		strings.NewReader(`{"suite_id":"test-harness-suite"}`),
	)
	response := httptest.NewRecorder()

	gateway.HarnessRun(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500 for malformed suites, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"harness_suites_load_failed"`) {
		t.Fatalf("expected harness_suites_load_failed error, got %s", response.Body.String())
	}
}

func TestHarnessRunRejectsUnknownCaseID(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeHarnessAppSuite(t)
	gateway := NewGateway(Config{
		Store:            sqliteStore,
		HarnessSuitePath: suitePath,
		HarnessLogDir:    t.TempDir(),
		ProjectRoot:      t.TempDir(),
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/harness/run",
		strings.NewReader(`{"suite_id":"test-harness-suite","case_id":"case-missing"}`),
	)
	response := httptest.NewRecorder()

	gateway.HarnessRun(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 for missing case, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"harness_case_not_found"`) {
		t.Fatalf("expected harness_case_not_found error, got %s", response.Body.String())
	}
}

func TestHarnessRunRejectsConfirmedCaseFromDifferentSuite(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeHarnessAppSuite(t)
	record, err := sqliteStore.CreateHarnessCase(context.Background(), store.HarnessCaseRecord{
		CaseID:                 "case-other-suite",
		SuiteID:                "other-harness-suite",
		ScenarioID:             "python-loop-termination",
		NaturalLanguageRequest: "Explain when a while loop stops.",
		CaseJSON: map[string]any{
			"schema_version":           "harness.case.v1",
			"case_id":                  "case-other-suite",
			"suite_id":                 "other-harness-suite",
			"scenario_id":              "python-loop-termination",
			"natural_language_request": "Explain when a while loop stops.",
		},
	})
	if err != nil {
		t.Fatalf("create other-suite harness case: %v", err)
	}
	if _, err := sqliteStore.ConfirmHarnessCase(context.Background(), record.CaseID); err != nil {
		t.Fatalf("confirm other-suite harness case: %v", err)
	}
	gateway := NewGateway(Config{
		Store:            sqliteStore,
		HarnessSuitePath: suitePath,
		HarnessLogDir:    t.TempDir(),
		ProjectRoot:      t.TempDir(),
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/harness/run",
		strings.NewReader(`{"suite_id":"test-harness-suite","case_id":"case-other-suite"}`),
	)
	response := httptest.NewRecorder()

	gateway.HarnessRun(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected status 409 for suite mismatch, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"error":"harness_case_suite_mismatch"`) {
		t.Fatalf("expected harness_case_suite_mismatch error, got %s", response.Body.String())
	}
}

func TestHarnessRunConfirmedCaseWritesCaseDetailsToLog(t *testing.T) {
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeHarnessAppSuite(t)
	created := createHarnessAppCase(t, sqliteStore, "case-confirmed-run", "pending")
	if _, err := sqliteStore.ConfirmHarnessCase(context.Background(), created.CaseID); err != nil {
		t.Fatalf("confirm harness case: %v", err)
	}
	logDir := t.TempDir()
	gateway := NewGateway(Config{
		Store:            sqliteStore,
		HarnessSuitePath: suitePath,
		HarnessLogDir:    logDir,
		ProjectRoot:      t.TempDir(),
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/harness/run",
		strings.NewReader(`{"suite_id":"test-harness-suite","case_id":"case-confirmed-run"}`),
	)
	response := httptest.NewRecorder()

	gateway.HarnessRun(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{`"case_id":"case-confirmed-run"`, `"natural_language_request":"Explain when a while loop stops."`, `"compiled_case":`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("expected %s in run response, got %s", expected, response.Body.String())
		}
	}
	runFiles, err := filepath.Glob(filepath.Join(logDir, "*", "*.json"))
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
	for _, expected := range []string{`"case_id": "case-confirmed-run"`, `"natural_language_request": "Explain when a while loop stops."`, `"compiled_case":`} {
		if !strings.Contains(string(logBody), expected) {
			t.Fatalf("expected %s in run log, got %s", expected, string(logBody))
		}
	}
}

func TestHarnessRunDoesNotExposeServerSecretEnvironment(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", "secret-from-server-env")
	sqliteStore := openHarnessAppStore(t)
	suitePath := writeHarnessAppSuiteWithCommand(t, harnessSecretPrintCommand())
	logDir := t.TempDir()
	gateway := NewGateway(Config{
		Store:            sqliteStore,
		HarnessSuitePath: suitePath,
		HarnessLogDir:    logDir,
		ProjectRoot:      t.TempDir(),
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/harness/run",
		strings.NewReader(`{"suite_id":"test-harness-suite"}`),
	)
	response := httptest.NewRecorder()

	gateway.HarnessRun(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "secret-from-server-env") {
		t.Fatalf("run response leaked server secret env: %s", response.Body.String())
	}
	runFiles, err := filepath.Glob(filepath.Join(logDir, "*", "*.json"))
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
	if strings.Contains(string(logBody), "secret-from-server-env") {
		t.Fatalf("run log leaked server secret env: %s", string(logBody))
	}
}

func openHarnessAppStore(t *testing.T) *store.SQLiteStore {
	t.Helper()
	sqliteStore, err := store.OpenSQLite(filepath.Join(t.TempDir(), "harness-test.db"))
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}
	t.Cleanup(func() {
		_ = sqliteStore.Close()
	})
	return sqliteStore
}

func createHarnessAppCase(t *testing.T, sqliteStore *store.SQLiteStore, caseID string, status string) store.HarnessCaseRecord {
	t.Helper()
	record, err := sqliteStore.CreateHarnessCase(context.Background(), store.HarnessCaseRecord{
		CaseID:                 caseID,
		SuiteID:                "test-harness-suite",
		ScenarioID:             "python-loop-termination",
		Status:                 status,
		NaturalLanguageRequest: "Explain when a while loop stops.",
		CaseJSON: map[string]any{
			"schema_version":           "harness.case.v1",
			"case_id":                  caseID,
			"suite_id":                 "test-harness-suite",
			"scenario_id":              "python-loop-termination",
			"natural_language_request": "Explain when a while loop stops.",
			"expected":                 map[string]any{"required_evidence": []string{"condition becomes false"}},
			"assertions":               []string{"response explains the stopping condition"},
		},
		Model:   "qwen3.7-max",
		LLMUsed: true,
	})
	if err != nil {
		t.Fatalf("create harness case: %v", err)
	}
	return record
}

func writeHarnessAppSuite(t *testing.T) string {
	t.Helper()
	return writeHarnessAppSuiteWithCommand(t, harnessOKCommand())
}

func writeHarnessAppSuiteWithCommand(t *testing.T, command []string) string {
	t.Helper()
	suitePath := filepath.Join(t.TempDir(), "suites.json")
	suiteJSON := `[
	  {
	    "id":"test-harness-suite",
	    "title":"Harness test suite",
	    "scenario_id":"python-loop-termination",
	    "method_source":"G-Eval 2023",
	    "metric_ids":["task_success","process_compliance","evidence_completeness"],
	    "command":{"label":"test command","args":` + mustMarshalStringSlice(t, command) + `,"allowlisted":true},
	    "timeout_seconds":5,
	    "pass_criteria":["exit_code == 0"],
	    "cases":[{"case_id":"fixture-case","input":"when does loop stop","expected_behavior":"runner writes log","assertions":["stdout contains harness-case-ok"]}]
	  }
	]`
	if err := os.WriteFile(suitePath, []byte(suiteJSON), 0o644); err != nil {
		t.Fatalf("write harness suite: %v", err)
	}
	return suitePath
}

func writeMalformedHarnessAppSuite(t *testing.T) string {
	t.Helper()
	suitePath := filepath.Join(t.TempDir(), "suites.json")
	if err := os.WriteFile(suitePath, []byte(`{"not": "a suite array"`), 0o644); err != nil {
		t.Fatalf("write malformed harness suite: %v", err)
	}
	return suitePath
}

func harnessOKCommand() []string {
	command := []string{"/bin/sh", "-c", "printf harness-case-ok"}
	if runtime.GOOS == "windows" {
		command = []string{"cmd", "/C", "echo harness-case-ok"}
	}
	return command
}

func harnessSecretPrintCommand() []string {
	command := []string{"/bin/sh", "-c", "printf %s \"$DASHSCOPE_API_KEY\""}
	if runtime.GOOS == "windows" {
		command = []string{"cmd", "/C", "echo %DASHSCOPE_API_KEY%"}
	}
	return command
}
