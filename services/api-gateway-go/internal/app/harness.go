package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"responsible-edu-agent/services/api-gateway-go/internal/store"

	"github.com/zeromicro/go-zero/rest/pathvar"
)

const defaultHarnessTimeoutSeconds = 30

var beijingLocation = time.FixedZone("CST", 8*60*60)

type HarnessSuite struct {
	ID             string         `json:"id"`
	Title          string         `json:"title"`
	ScenarioID     string         `json:"scenario_id"`
	MethodSource   string         `json:"method_source"`
	MetricIDs      []string       `json:"metric_ids"`
	Command        HarnessCommand `json:"command"`
	TimeoutSeconds int            `json:"timeout_seconds"`
	PassCriteria   []string       `json:"pass_criteria"`
	Cases          []HarnessCase  `json:"cases"`
}

type HarnessCommand struct {
	Label       string   `json:"label"`
	Args        []string `json:"args"`
	Allowlisted bool     `json:"allowlisted"`
}

type HarnessCase struct {
	CaseID           string   `json:"case_id"`
	Input            string   `json:"input"`
	ExpectedBehavior string   `json:"expected_behavior"`
	Assertions       []string `json:"assertions"`
}

type HarnessRun struct {
	ID                     string         `json:"id"`
	SuiteID                string         `json:"suite_id"`
	CaseID                 string         `json:"case_id,omitempty"`
	NaturalLanguageRequest string         `json:"natural_language_request,omitempty"`
	CompiledCase           map[string]any `json:"compiled_case,omitempty"`
	Status                 string         `json:"status"`
	CreatedAtBeijing       string         `json:"created_at_beijing"`
	DurationMS             int64          `json:"duration_ms"`
	ExitCode               int            `json:"exit_code"`
	Metrics                map[string]any `json:"metrics"`
	LogPath                string         `json:"log_path"`
	StdoutTail             string         `json:"stdout_tail"`
	StderrTail             string         `json:"stderr_tail"`
}

func defaultHarnessSuitePath(configured string) string {
	if strings.TrimSpace(configured) != "" {
		return filepath.Clean(configured)
	}
	return resolveProjectFile("harness/suites.json")
}

func defaultHarnessLogDir(configured string) string {
	if strings.TrimSpace(configured) != "" {
		return filepath.Clean(configured)
	}
	return resolveProjectFile("eval/harness_logs")
}

func defaultProjectRoot(configured string) string {
	if strings.TrimSpace(configured) != "" {
		return filepath.Clean(configured)
	}
	return resolveProjectRoot()
}

func resolveProjectRoot() string {
	workingDir, err := os.Getwd()
	if err != nil {
		return "."
	}
	dir := workingDir
	for {
		if info, err := os.Stat(filepath.Join(dir, "check.sh")); err == nil && !info.IsDir() {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return workingDir
		}
		dir = parent
	}
}

func resolveProjectFile(relativePath string) string {
	root := resolveProjectRoot()
	return filepath.Join(root, filepath.FromSlash(relativePath))
}

func (g *Gateway) HarnessSuites(response http.ResponseWriter, _ *http.Request) {
	suites, err := g.loadHarnessSuites()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_suites_load_failed"})
		return
	}
	runs, err := g.loadHarnessRuns()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_runs_load_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"suites": suites,
		"runs":   runs,
	})
}

func (g *Gateway) HarnessCases(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	cases, err := g.store.ListHarnessCases(request.Context(), store.HarnessCaseFilter{
		SuiteID: strings.TrimSpace(request.URL.Query().Get("suite_id")),
		Status:  strings.TrimSpace(request.URL.Query().Get("status")),
	})
	if err != nil {
		if errors.Is(err, store.ErrHarnessCaseInvalidFilter) {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_harness_case_filter"})
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_cases_lookup_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"cases": cases})
}

func (g *Gateway) HarnessCaseCompile(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	defer request.Body.Close()

	var payload struct {
		SuiteID                string `json:"suite_id"`
		ScenarioID             string `json:"scenario_id"`
		NaturalLanguageRequest string `json:"natural_language_request"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil && err != io.EOF {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	payload.SuiteID = strings.TrimSpace(payload.SuiteID)
	payload.ScenarioID = strings.TrimSpace(payload.ScenarioID)
	payload.NaturalLanguageRequest = strings.TrimSpace(payload.NaturalLanguageRequest)
	if payload.SuiteID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "suite_id_required"})
		return
	}
	if payload.NaturalLanguageRequest == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "natural_language_request_required"})
		return
	}
	if _, ok, err := g.findHarnessSuite(payload.SuiteID); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_suites_load_failed"})
		return
	} else if !ok {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "harness_suite_not_found"})
		return
	}

	status, body, err := g.callAI(request.Context(), http.MethodPost, "/ai/harness/compile-case", payload)
	if err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "ai_core_unavailable"})
		return
	}
	if status < 200 || status >= 300 {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "ai_core_bad_response"})
		return
	}

	var compiled struct {
		CompiledCase   map[string]any `json:"compiled_case"`
		ValidatorError []string       `json:"validator_errors"`
		Model          string         `json:"model"`
		LLMUsed        bool           `json:"llm_used"`
		LLMFallback    bool           `json:"llm_fallback"`
	}
	if err := json.Unmarshal(body, &compiled); err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "ai_core_bad_response"})
		return
	}
	caseID := stringFromAny(compiled.CompiledCase["case_id"])
	if caseID == "" {
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "ai_core_bad_response"})
		return
	}
	scenarioID := stringFromAny(compiled.CompiledCase["scenario_id"])
	if scenarioID == "" {
		scenarioID = payload.ScenarioID
	}
	naturalLanguageRequest := stringFromAny(compiled.CompiledCase["natural_language_request"])
	if naturalLanguageRequest == "" {
		naturalLanguageRequest = payload.NaturalLanguageRequest
	}

	record, err := g.store.CreateHarnessCase(request.Context(), store.HarnessCaseRecord{
		CaseID:                 caseID,
		SuiteID:                payload.SuiteID,
		ScenarioID:             scenarioID,
		Status:                 "pending",
		NaturalLanguageRequest: naturalLanguageRequest,
		CaseJSON:               compiled.CompiledCase,
		ValidatorErrors:        compiled.ValidatorError,
		Model:                  compiled.Model,
		LLMUsed:                compiled.LLMUsed,
		LLMFallback:            compiled.LLMFallback,
	})
	if err != nil {
		if errors.Is(err, store.ErrHarnessCaseConflict) {
			writeHarnessCaseStoreError(response, err, "harness_case_create_failed")
			return
		}
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_case_create_failed"})
		return
	}
	if err := g.store.AppendHarnessCaseEvent(request.Context(), store.HarnessCaseEvent{
		CaseID:    record.CaseID,
		EventType: "compiled",
		PayloadJSON: map[string]any{
			"compiled_case":    record.CaseJSON,
			"validator_errors": record.ValidatorErrors,
			"model":            record.Model,
			"llm_used":         record.LLMUsed,
			"llm_fallback":     record.LLMFallback,
		},
	}); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_case_event_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"case": record})
}

func (g *Gateway) HarnessCaseConfirm(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	caseID := strings.TrimSpace(pathvar.Vars(request)["case_id"])
	record, err := g.store.ConfirmHarnessCase(request.Context(), caseID)
	if err != nil {
		writeHarnessCaseStoreError(response, err, "harness_case_confirm_failed")
		return
	}
	if err := g.store.AppendHarnessCaseEvent(request.Context(), store.HarnessCaseEvent{
		CaseID:      record.CaseID,
		EventType:   "confirmed",
		PayloadJSON: map[string]any{"status": record.Status},
	}); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_case_event_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"case": record})
}

func (g *Gateway) HarnessCaseDelete(response http.ResponseWriter, request *http.Request) {
	if g.store == nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
		return
	}
	caseID := strings.TrimSpace(pathvar.Vars(request)["case_id"])
	record, err := g.store.DeleteHarnessCase(request.Context(), caseID)
	if err != nil {
		writeHarnessCaseStoreError(response, err, "harness_case_delete_failed")
		return
	}
	if err := g.store.AppendHarnessCaseEvent(request.Context(), store.HarnessCaseEvent{
		CaseID:      record.CaseID,
		EventType:   "deleted",
		PayloadJSON: map[string]any{"status": record.Status},
	}); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_case_event_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"case": record})
}

func (g *Gateway) HarnessRun(response http.ResponseWriter, request *http.Request) {
	defer request.Body.Close()

	var payload struct {
		SuiteID string `json:"suite_id"`
		CaseID  string `json:"case_id"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil && err != io.EOF {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	payload.SuiteID = strings.TrimSpace(payload.SuiteID)
	payload.CaseID = strings.TrimSpace(payload.CaseID)
	if payload.SuiteID == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "suite_id_required"})
		return
	}

	suite, ok, err := g.findHarnessSuite(payload.SuiteID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_suites_load_failed"})
		return
	}
	if !ok {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "harness_suite_not_found"})
		return
	}
	if !suite.Command.Allowlisted || len(suite.Command.Args) == 0 {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "harness_command_not_allowlisted"})
		return
	}

	var caseRecord *store.HarnessCaseRecord
	if payload.CaseID != "" {
		if g.store == nil {
			writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "storage_unavailable"})
			return
		}
		record, err := g.store.GetHarnessCase(request.Context(), payload.CaseID)
		if err != nil {
			writeHarnessCaseStoreError(response, err, "harness_case_lookup_failed")
			return
		}
		if record.SuiteID != payload.SuiteID {
			writeJSON(response, http.StatusConflict, map[string]string{"error": "harness_case_suite_mismatch"})
			return
		}
		if record.Status != "confirmed" {
			writeJSON(response, http.StatusConflict, map[string]string{"error": "harness_case_not_confirmed"})
			return
		}
		caseRecord = &record
	}

	run, err := g.executeHarnessSuite(request.Context(), suite, caseRecord)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "harness_run_persist_failed"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"run": run})
}

func (g *Gateway) findHarnessSuite(suiteID string) (HarnessSuite, bool, error) {
	suites, err := g.loadHarnessSuites()
	if err != nil {
		return HarnessSuite{}, false, err
	}
	for _, candidate := range suites {
		if candidate.ID == suiteID {
			return candidate, true, nil
		}
	}
	return HarnessSuite{}, false, nil
}

func (g *Gateway) loadHarnessSuites() ([]HarnessSuite, error) {
	data, err := os.ReadFile(g.harnessSuitePath)
	if err != nil {
		if os.IsNotExist(err) {
			return defaultHarnessSuites(), nil
		}
		return nil, err
	}
	var suites []HarnessSuite
	if err := json.Unmarshal(data, &suites); err != nil {
		return nil, err
	}
	if len(suites) == 0 {
		return defaultHarnessSuites(), nil
	}
	return normalizeHarnessSuites(suites), nil
}

func normalizeHarnessSuites(suites []HarnessSuite) []HarnessSuite {
	for index := range suites {
		if suites[index].TimeoutSeconds <= 0 {
			suites[index].TimeoutSeconds = defaultHarnessTimeoutSeconds
		}
		if suites[index].Command.Label == "" {
			suites[index].Command.Label = strings.Join(suites[index].Command.Args, " ")
		}
	}
	return suites
}

func (g *Gateway) loadHarnessRuns() ([]HarnessRun, error) {
	var runs []HarnessRun
	err := filepath.WalkDir(g.harnessLogDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".json" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var run HarnessRun
		if err := json.Unmarshal(data, &run); err != nil {
			return err
		}
		runs = append(runs, run)
		return nil
	})
	if os.IsNotExist(err) {
		return []HarnessRun{}, nil
	}
	if err != nil {
		return nil, err
	}
	sort.SliceStable(runs, func(left, right int) bool {
		if runs[left].CreatedAtBeijing == runs[right].CreatedAtBeijing {
			return runs[left].ID > runs[right].ID
		}
		return runs[left].CreatedAtBeijing > runs[right].CreatedAtBeijing
	})
	return runs, nil
}

func (g *Gateway) executeHarnessSuite(ctx context.Context, suite HarnessSuite, caseRecord *store.HarnessCaseRecord) (HarnessRun, error) {
	timeout := time.Duration(suite.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = defaultHarnessTimeoutSeconds * time.Second
	}
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()
	cmd := exec.CommandContext(commandCtx, suite.Command.Args[0], suite.Command.Args[1:]...)
	cmd.Dir = g.projectRoot
	caseID := ""
	if caseRecord != nil {
		caseID = caseRecord.CaseID
	}
	cmd.Env = harnessCommandEnv(suite.ID, caseID)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	duration := time.Since(started)

	exitCode := 0
	status := "passed"
	if err != nil {
		status = "failed"
		exitCode = 1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
		if commandCtx.Err() == context.DeadlineExceeded {
			status = "timeout"
		}
	}

	now := time.Now().In(beijingLocation)
	run := HarnessRun{
		ID:               "run-" + now.Format("20060102-150405.000000000"),
		SuiteID:          suite.ID,
		Status:           status,
		CreatedAtBeijing: now.Format(time.RFC3339Nano),
		DurationMS:       duration.Milliseconds(),
		ExitCode:         exitCode,
		Metrics: map[string]any{
			"task_success":          exitCode == 0,
			"process_compliance":    suite.Command.Allowlisted,
			"evidence_completeness": len(suite.Cases) > 0 && len(suite.PassCriteria) > 0,
		},
		StdoutTail: tailText(stdout.String(), 4000),
		StderrTail: tailText(stderr.String(), 4000),
	}
	if caseRecord != nil {
		run.CaseID = caseRecord.CaseID
		run.NaturalLanguageRequest = caseRecord.NaturalLanguageRequest
		run.CompiledCase = caseRecord.CaseJSON
	}
	run.LogPath = g.harnessRunLogPath(run)
	if _, err := g.writeHarnessRunLog(run); err != nil {
		return HarnessRun{}, err
	}
	return run, nil
}

func writeHarnessCaseStoreError(response http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrHarnessCaseNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "harness_case_not_found"})
	case errors.Is(err, store.ErrHarnessCaseConflict):
		writeJSON(response, http.StatusConflict, map[string]string{"error": "harness_case_lifecycle_conflict"})
	default:
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": fallback})
	}
}

func stringFromAny(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func (g *Gateway) writeHarnessRunLog(run HarnessRun) (string, error) {
	path := g.harnessRunLogPath(run)
	dayDir := filepath.Dir(path)
	if err := os.MkdirAll(dayDir, 0o755); err != nil {
		return "", err
	}
	if run.LogPath == "" {
		run.LogPath = filepath.ToSlash(path)
	}
	data, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

func (g *Gateway) harnessRunLogPath(run HarnessRun) string {
	if run.LogPath != "" {
		return filepath.FromSlash(run.LogPath)
	}
	createdAt, err := time.Parse(time.RFC3339, run.CreatedAtBeijing)
	if err != nil {
		createdAt = time.Now().In(beijingLocation)
	}
	return filepath.Join(g.harnessLogDir, createdAt.Format("2006-01-02"), run.ID+".json")
}

func harnessCommandEnv(suiteID string, caseID string) []string {
	names := []string{"PATH", "HOME", "TMPDIR", "TEMP", "TMP"}
	if strings.EqualFold(os.Getenv("OS"), "Windows_NT") {
		names = append(names, "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE")
	}

	env := make([]string, 0, len(names)+2)
	seen := map[string]bool{}
	for _, name := range names {
		value, ok := lookupEnvCaseInsensitive(name)
		if !ok {
			continue
		}
		key := strings.ToUpper(name)
		if seen[key] {
			continue
		}
		seen[key] = true
		env = append(env, name+"="+value)
	}
	env = append(env, fmt.Sprintf("REA_HARNESS_SUITE_ID=%s", suiteID))
	if caseID != "" {
		env = append(env, fmt.Sprintf("REA_HARNESS_CASE_ID=%s", caseID))
	}
	return env
}

func lookupEnvCaseInsensitive(name string) (string, bool) {
	if value, ok := os.LookupEnv(name); ok {
		return value, true
	}
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok && strings.EqualFold(key, name) {
			return value, true
		}
	}
	return "", false
}

func tailText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}

func defaultHarnessSuites() []HarnessSuite {
	baseCommand := HarnessCommand{
		Label:       "python3 scripts/check_research_contract.py",
		Args:        []string{"python3", "scripts/check_research_contract.py"},
		Allowlisted: true,
	}
	return normalizeHarnessSuites([]HarnessSuite{
		harnessSuite("helm-standardized-suite", "HELM standardized scenario metrics", "HELM 2023", baseCommand),
		harnessSuite("ragas-grounding-suite", "RAGAS context faithfulness relevance", "RAGAS 2024", baseCommand),
		harnessSuite("ragchecker-failure-layer-suite", "RAGChecker retrieval-generation diagnosis", "RAGChecker 2024", baseCommand),
		harnessSuite("ares-calibration-suite", "ARES synthetic judge calibration", "ARES 2024", baseCommand),
		harnessSuite("agentbench-multiturn-suite", "AgentBench multi-turn trajectory", "AgentBench 2024", baseCommand),
		harnessSuite("swebench-docker-runner-suite", "SWE-bench docker executable runner", "SWE-bench 2024", baseCommand),
		harnessSuite("evalplus-boundary-suite", "EvalPlus boundary case expansion", "EvalPlus 2023", baseCommand),
		harnessSuite("reproducible-eval-log-suite", "Reproducible evaluation log contract", "Reproducible LM Evaluation 2024", baseCommand),
		harnessSuite("geval-case-compiler-suite", "G-Eval natural language case compiler", "G-Eval 2023", baseCommand),
		harnessSuite("privacy-safety-suite", "Privacy safety forbidden fields", "Questionnaire privacy rule", HarnessCommand{
			Label:       "python3 scripts/check_privacy_fields.py",
			Args:        []string{"python3", "scripts/check_privacy_fields.py"},
			Allowlisted: true,
		}),
	})
}

func harnessSuite(id string, title string, method string, command HarnessCommand) HarnessSuite {
	return HarnessSuite{
		ID:             id,
		Title:          title,
		ScenarioID:     "python-list-indexerror",
		MethodSource:   method,
		MetricIDs:      []string{"task_success", "process_compliance", "evidence_completeness"},
		Command:        command,
		TimeoutSeconds: defaultHarnessTimeoutSeconds,
		PassCriteria:   []string{"exit_code == 0", "evidence_rows >= 10", "failure_layer is recorded"},
		Cases: []HarnessCase{
			{
				CaseID:           id + "-case-001",
				Input:            "为什么我的 list 报 IndexError？",
				ExpectedBehavior: "retrieve-first gate fires before direct answer",
				Assertions:       []string{"kg_path includes ErrorType:IndexError", "rag_sources length >= 1"},
			},
		},
	}
}
