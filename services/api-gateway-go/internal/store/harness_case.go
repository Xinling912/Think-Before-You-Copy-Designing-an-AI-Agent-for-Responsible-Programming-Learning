package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type HarnessCaseRecord struct {
	CaseID                 string         `json:"case_id"`
	SuiteID                string         `json:"suite_id"`
	ScenarioID             string         `json:"scenario_id"`
	Status                 string         `json:"status"`
	NaturalLanguageRequest string         `json:"natural_language_request"`
	CaseJSON               map[string]any `json:"case_json"`
	ValidatorErrors        []string       `json:"validator_errors"`
	Model                  string         `json:"model"`
	LLMUsed                bool           `json:"llm_used"`
	LLMFallback            bool           `json:"llm_fallback"`
	CreatedAt              string         `json:"created_at"`
	ConfirmedAt            *string        `json:"confirmed_at,omitempty"`
	DeletedAt              *string        `json:"deleted_at,omitempty"`
}

type HarnessCaseFilter struct {
	SuiteID string
	Status  string
}

type HarnessCaseEvent struct {
	CaseID      string         `json:"case_id"`
	EventType   string         `json:"event_type"`
	PayloadJSON map[string]any `json:"payload_json"`
}

func (s *SQLiteStore) CreateHarnessCase(ctx context.Context, record HarnessCaseRecord) (HarnessCaseRecord, error) {
	record.CaseID = strings.TrimSpace(record.CaseID)
	record.SuiteID = strings.TrimSpace(record.SuiteID)
	record.ScenarioID = strings.TrimSpace(record.ScenarioID)
	record.Status = strings.ToLower(strings.TrimSpace(record.Status))
	if record.Status == "" {
		record.Status = "pending"
	}
	if record.CaseID == "" {
		return HarnessCaseRecord{}, fmt.Errorf("case id is required")
	}
	if record.SuiteID == "" {
		return HarnessCaseRecord{}, fmt.Errorf("suite id is required")
	}
	if !validHarnessCaseStatus(record.Status) {
		return HarnessCaseRecord{}, fmt.Errorf("invalid harness case status: %s", record.Status)
	}
	if record.CaseJSON == nil {
		record.CaseJSON = map[string]any{}
	}
	if record.ValidatorErrors == nil {
		record.ValidatorErrors = []string{}
	}
	if strings.TrimSpace(record.CreatedAt) == "" {
		record.CreatedAt = formatStoreTime(time.Now())
	}

	caseJSON, err := json.Marshal(record.CaseJSON)
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	validatorErrorsJSON, err := json.Marshal(record.ValidatorErrors)
	if err != nil {
		return HarnessCaseRecord{}, err
	}

	_, err = s.db.ExecContext(
		ctx,
		`insert into harness_cases (
		   case_id, suite_id, scenario_id, status, natural_language_request,
		   case_json, validator_errors_json, model, llm_used, llm_fallback,
		   created_at, confirmed_at, deleted_at
		 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.CaseID,
		record.SuiteID,
		record.ScenarioID,
		record.Status,
		record.NaturalLanguageRequest,
		string(caseJSON),
		string(validatorErrorsJSON),
		record.Model,
		boolToInt(record.LLMUsed),
		boolToInt(record.LLMFallback),
		record.CreatedAt,
		stringPtrToNull(record.ConfirmedAt),
		stringPtrToNull(record.DeletedAt),
	)
	if err != nil {
		if isHarnessCaseDuplicateError(err) {
			return HarnessCaseRecord{}, ErrHarnessCaseConflict
		}
		return HarnessCaseRecord{}, err
	}
	return s.GetHarnessCase(ctx, record.CaseID)
}

func (s *SQLiteStore) ListHarnessCases(ctx context.Context, filter HarnessCaseFilter) ([]HarnessCaseRecord, error) {
	status := strings.ToLower(strings.TrimSpace(filter.Status))
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "pending" && status != "confirmed" && status != "deleted" && status != "all" {
		return nil, fmt.Errorf("%w: %s", ErrHarnessCaseInvalidFilter, status)
	}

	query := `select case_id, suite_id, scenario_id, status, natural_language_request,
	                 case_json, validator_errors_json, model, llm_used, llm_fallback,
	                 created_at, confirmed_at, deleted_at
	          from harness_cases`
	args := []any{}
	clauses := []string{}
	if strings.TrimSpace(filter.SuiteID) != "" {
		clauses = append(clauses, "suite_id = ?")
		args = append(args, strings.TrimSpace(filter.SuiteID))
	}
	switch status {
	case "active":
		clauses = append(clauses, "status in ('pending', 'confirmed')")
	case "pending", "confirmed", "deleted":
		clauses = append(clauses, "status = ?")
		args = append(args, status)
	}
	if len(clauses) > 0 {
		query += " where " + strings.Join(clauses, " and ")
	}
	query += " order by created_at desc, id desc"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []HarnessCaseRecord
	for rows.Next() {
		record, err := scanHarnessCase(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func (s *SQLiteStore) GetHarnessCase(ctx context.Context, caseID string) (HarnessCaseRecord, error) {
	if strings.TrimSpace(caseID) == "" {
		return HarnessCaseRecord{}, fmt.Errorf("case id is required")
	}
	row := s.db.QueryRowContext(
		ctx,
		`select case_id, suite_id, scenario_id, status, natural_language_request,
		        case_json, validator_errors_json, model, llm_used, llm_fallback,
		        created_at, confirmed_at, deleted_at
		   from harness_cases
		  where case_id = ?`,
		strings.TrimSpace(caseID),
	)
	record, err := scanHarnessCase(row)
	if err == sql.ErrNoRows {
		return HarnessCaseRecord{}, ErrHarnessCaseNotFound
	}
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	return record, nil
}

func (s *SQLiteStore) ConfirmHarnessCase(ctx context.Context, caseID string) (HarnessCaseRecord, error) {
	record, err := s.GetHarnessCase(ctx, caseID)
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	if record.Status == "deleted" {
		return HarnessCaseRecord{}, ErrHarnessCaseConflict
	}
	if record.Status == "confirmed" {
		return record, nil
	}
	now := formatStoreTime(time.Now())
	result, err := s.db.ExecContext(
		ctx,
		`update harness_cases
		    set status = 'confirmed', confirmed_at = coalesce(confirmed_at, ?)
		  where case_id = ? and status = 'pending'`,
		now,
		record.CaseID,
	)
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	if affected == 0 {
		return HarnessCaseRecord{}, ErrHarnessCaseConflict
	}
	return s.GetHarnessCase(ctx, record.CaseID)
}

func (s *SQLiteStore) DeleteHarnessCase(ctx context.Context, caseID string) (HarnessCaseRecord, error) {
	record, err := s.GetHarnessCase(ctx, caseID)
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	if record.Status == "deleted" {
		return record, nil
	}
	now := formatStoreTime(time.Now())
	result, err := s.db.ExecContext(
		ctx,
		`update harness_cases
		    set status = 'deleted', deleted_at = coalesce(deleted_at, ?)
		  where case_id = ? and status in ('pending', 'confirmed')`,
		now,
		record.CaseID,
	)
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return HarnessCaseRecord{}, err
	}
	if affected == 0 {
		return HarnessCaseRecord{}, ErrHarnessCaseConflict
	}
	return s.GetHarnessCase(ctx, record.CaseID)
}

func (s *SQLiteStore) AppendHarnessCaseEvent(ctx context.Context, event HarnessCaseEvent) error {
	event.CaseID = strings.TrimSpace(event.CaseID)
	event.EventType = strings.ToLower(strings.TrimSpace(event.EventType))
	if event.CaseID == "" {
		return fmt.Errorf("case id is required")
	}
	if event.EventType != "compiled" && event.EventType != "confirmed" && event.EventType != "deleted" {
		return fmt.Errorf("invalid harness case event type: %s", event.EventType)
	}
	if event.PayloadJSON == nil {
		event.PayloadJSON = map[string]any{}
	}
	payloadJSON, err := json.Marshal(event.PayloadJSON)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(
		ctx,
		`insert into harness_case_events (case_id, event_type, payload_json, created_at)
		 values (?, ?, ?, ?)`,
		event.CaseID,
		event.EventType,
		string(payloadJSON),
		formatStoreTime(time.Now()),
	)
	return err
}

type harnessCaseScanner interface {
	Scan(dest ...any) error
}

func scanHarnessCase(scanner harnessCaseScanner) (HarnessCaseRecord, error) {
	var record HarnessCaseRecord
	var caseJSON string
	var validatorErrorsJSON string
	var llmUsed int
	var llmFallback int
	var confirmedAt sql.NullString
	var deletedAt sql.NullString
	if err := scanner.Scan(
		&record.CaseID,
		&record.SuiteID,
		&record.ScenarioID,
		&record.Status,
		&record.NaturalLanguageRequest,
		&caseJSON,
		&validatorErrorsJSON,
		&record.Model,
		&llmUsed,
		&llmFallback,
		&record.CreatedAt,
		&confirmedAt,
		&deletedAt,
	); err != nil {
		return HarnessCaseRecord{}, err
	}
	if err := json.Unmarshal([]byte(caseJSON), &record.CaseJSON); err != nil {
		return HarnessCaseRecord{}, err
	}
	if record.CaseJSON == nil {
		record.CaseJSON = map[string]any{}
	}
	if err := json.Unmarshal([]byte(validatorErrorsJSON), &record.ValidatorErrors); err != nil {
		return HarnessCaseRecord{}, err
	}
	if record.ValidatorErrors == nil {
		record.ValidatorErrors = []string{}
	}
	record.LLMUsed = llmUsed != 0
	record.LLMFallback = llmFallback != 0
	if confirmedAt.Valid {
		record.ConfirmedAt = &confirmedAt.String
	}
	if deletedAt.Valid {
		record.DeletedAt = &deletedAt.String
	}
	return record, nil
}

func validHarnessCaseStatus(status string) bool {
	return status == "pending" || status == "confirmed" || status == "deleted"
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func stringPtrToNull(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func isHarnessCaseDuplicateError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "UNIQUE constraint failed: harness_cases.case_id")
}
