package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
)

func TestHarnessMigrationCreatesCaseTables(t *testing.T) {
	store := openTestStore(t)

	for _, table := range []string{"harness_cases", "harness_case_events"} {
		var name string
		err := store.db.QueryRow(
			`select name from sqlite_master where type = 'table' and name = ?`,
			table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("expected table %s to exist: %v", table, err)
		}
	}
	assertHarnessCaseColumnContracts(t, store.db)
}

func TestHarnessCaseMigrationStandaloneSchema(t *testing.T) {
	db, err := sql.Open(driverName, ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = db.Close()
	})

	migrationSQL, err := os.ReadFile("../../migrations/004_harness_cases.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := db.Exec(string(migrationSQL)); err != nil {
		t.Fatalf("execute migration: %v", err)
	}

	assertHarnessCaseColumnContracts(t, db)
}

func TestHarnessCaseLifecycleCreateListConfirmDelete(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	created, err := store.CreateHarnessCase(ctx, HarnessCaseRecord{
		CaseID:                 "case-loop-termination",
		SuiteID:                "geval-case-compiler-suite",
		ScenarioID:             "python-loop-termination",
		NaturalLanguageRequest: "Explain when a while loop stops.",
		CaseJSON: map[string]any{
			"schema_version":           "harness.case.v1",
			"case_id":                  "case-loop-termination",
			"suite_id":                 "geval-case-compiler-suite",
			"scenario_id":              "python-loop-termination",
			"natural_language_request": "Explain when a while loop stops.",
			"assertions":               []any{"mentions false condition"},
			"expected":                 map[string]any{"required_evidence": []any{"condition becomes false"}},
		},
		ValidatorErrors: []string{"stripped forbidden field: command"},
		Model:           "qwen3.7-max",
		LLMUsed:         true,
	})
	if err != nil {
		t.Fatalf("create harness case: %v", err)
	}
	if created.Status != "pending" {
		t.Fatalf("expected default pending status, got %#v", created)
	}
	if created.CreatedAt == "" {
		t.Fatalf("expected created_at, got %#v", created)
	}

	if err := store.AppendHarnessCaseEvent(ctx, HarnessCaseEvent{
		CaseID:    created.CaseID,
		EventType: "compiled",
		PayloadJSON: map[string]any{
			"model": "qwen3.7-max",
		},
	}); err != nil {
		t.Fatalf("append compiled event: %v", err)
	}

	confirmed, err := store.ConfirmHarnessCase(ctx, created.CaseID)
	if err != nil {
		t.Fatalf("confirm harness case: %v", err)
	}
	if confirmed.Status != "confirmed" || confirmed.ConfirmedAt == nil || *confirmed.ConfirmedAt == "" {
		t.Fatalf("expected confirmed timestamp, got %#v", confirmed)
	}
	confirmedAgain, err := store.ConfirmHarnessCase(ctx, created.CaseID)
	if err != nil {
		t.Fatalf("confirm harness case idempotently: %v", err)
	}
	if confirmedAgain.ConfirmedAt == nil || *confirmedAgain.ConfirmedAt != *confirmed.ConfirmedAt {
		t.Fatalf("expected idempotent confirmed_at, got first %#v second %#v", confirmed, confirmedAgain)
	}

	activeCases, err := store.ListHarnessCases(ctx, HarnessCaseFilter{})
	if err != nil {
		t.Fatalf("list active harness cases: %v", err)
	}
	if len(activeCases) != 1 || activeCases[0].CaseID != created.CaseID {
		t.Fatalf("expected default active list to include confirmed case, got %#v", activeCases)
	}

	deleted, err := store.DeleteHarnessCase(ctx, created.CaseID)
	if err != nil {
		t.Fatalf("delete harness case: %v", err)
	}
	if deleted.Status != "deleted" || deleted.DeletedAt == nil || *deleted.DeletedAt == "" {
		t.Fatalf("expected deleted timestamp, got %#v", deleted)
	}
	deletedAgain, err := store.DeleteHarnessCase(ctx, created.CaseID)
	if err != nil {
		t.Fatalf("delete harness case idempotently: %v", err)
	}
	if deletedAgain.DeletedAt == nil || *deletedAgain.DeletedAt != *deleted.DeletedAt {
		t.Fatalf("expected idempotent deleted_at, got first %#v second %#v", deleted, deletedAgain)
	}

	activeCases, err = store.ListHarnessCases(ctx, HarnessCaseFilter{})
	if err != nil {
		t.Fatalf("list active after delete: %v", err)
	}
	if len(activeCases) != 0 {
		t.Fatalf("expected deleted case hidden from default list, got %#v", activeCases)
	}

	deletedCases, err := store.ListHarnessCases(ctx, HarnessCaseFilter{Status: "deleted"})
	if err != nil {
		t.Fatalf("list deleted harness cases: %v", err)
	}
	if len(deletedCases) != 1 || deletedCases[0].CaseID != created.CaseID {
		t.Fatalf("expected deleted case only, got %#v", deletedCases)
	}

	allCases, err := store.ListHarnessCases(ctx, HarnessCaseFilter{SuiteID: created.SuiteID, Status: "all"})
	if err != nil {
		t.Fatalf("list all harness cases: %v", err)
	}
	if len(allCases) != 1 || allCases[0].Status != "deleted" {
		t.Fatalf("expected all list to include deleted case, got %#v", allCases)
	}
}

func TestHarnessCaseConfirmDeletedFails(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	created, err := store.CreateHarnessCase(ctx, HarnessCaseRecord{
		CaseID:                 "case-boundary",
		SuiteID:                "geval-case-compiler-suite",
		ScenarioID:             "python-boundary",
		NaturalLanguageRequest: "Check boundary conditions.",
		CaseJSON:               map[string]any{"schema_version": "harness.case.v1", "case_id": "case-boundary"},
	})
	if err != nil {
		t.Fatalf("create harness case: %v", err)
	}
	if _, err := store.DeleteHarnessCase(ctx, created.CaseID); err != nil {
		t.Fatalf("delete harness case: %v", err)
	}
	if _, err := store.ConfirmHarnessCase(ctx, created.CaseID); err == nil {
		t.Fatal("expected confirming a deleted harness case to fail")
	}
}

func TestHarnessCaseDuplicateCaseIDReturnsConflict(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	record := HarnessCaseRecord{
		CaseID:                 "case-duplicate",
		SuiteID:                "geval-case-compiler-suite",
		ScenarioID:             "python-loop-termination",
		NaturalLanguageRequest: "Explain loop termination.",
		CaseJSON:               map[string]any{"schema_version": "harness.case.v1", "case_id": "case-duplicate"},
	}
	if _, err := store.CreateHarnessCase(ctx, record); err != nil {
		t.Fatalf("create initial harness case: %v", err)
	}

	if _, err := store.CreateHarnessCase(ctx, record); !errors.Is(err, ErrHarnessCaseConflict) {
		t.Fatalf("expected duplicate harness case conflict, got %v", err)
	}
}

func assertHarnessCaseColumnContracts(t *testing.T, db *sql.DB) {
	t.Helper()

	assertColumn(t, db, "harness_cases", "case_id", "text", true)
	assertColumn(t, db, "harness_cases", "suite_id", "text", true)
	assertColumn(t, db, "harness_cases", "scenario_id", "text", true)
	assertColumn(t, db, "harness_cases", "status", "text", true)
	assertColumn(t, db, "harness_cases", "natural_language_request", "text", true)
	assertColumn(t, db, "harness_cases", "case_json", "text", true)
	assertColumn(t, db, "harness_cases", "validator_errors_json", "text", true)
	assertColumn(t, db, "harness_cases", "model", "text", true)
	assertColumn(t, db, "harness_cases", "llm_used", "integer", true)
	assertColumn(t, db, "harness_cases", "llm_fallback", "integer", true)
	assertColumn(t, db, "harness_cases", "created_at", "text", true)
	assertColumn(t, db, "harness_cases", "confirmed_at", "text", false)
	assertColumn(t, db, "harness_cases", "deleted_at", "text", false)
	assertColumn(t, db, "harness_case_events", "case_id", "text", true)
	assertColumn(t, db, "harness_case_events", "event_type", "text", true)
	assertColumn(t, db, "harness_case_events", "payload_json", "text", true)
	assertColumn(t, db, "harness_case_events", "created_at", "text", true)
}
