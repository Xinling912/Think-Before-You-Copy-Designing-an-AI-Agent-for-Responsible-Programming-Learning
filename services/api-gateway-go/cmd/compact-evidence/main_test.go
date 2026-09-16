package main

import (
	"bytes"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRunDryRunReportsOneChangeAndDoesNotWrite(t *testing.T) {
	path, original := compactEvidenceFixture(t)
	var output bytes.Buffer
	if err := run([]string{"-db", path, "-dry-run"}, &output); err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if !strings.Contains(output.String(), "scanned_rows=3") || !strings.Contains(output.String(), "changed_rows=1") {
		t.Fatalf("unexpected output: %s", output.String())
	}
	if got := readPayloads(t, path); strings.Join(got, "\n") != strings.Join(original, "\n") {
		t.Fatalf("dry run modified payloads: got %#v want %#v", got, original)
	}
}

func TestRunApplyChangesOnlyEqualDuplicate(t *testing.T) {
	path, original := compactEvidenceFixture(t)
	var output bytes.Buffer
	if err := run([]string{"-db", path, "-apply"}, &output); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !strings.Contains(output.String(), "changed_rows=1") {
		t.Fatalf("unexpected output: %s", output.String())
	}
	payloads := readPayloads(t, path)
	if strings.Contains(payloads[0], `"evidence":{"kg_grounding"`) || !strings.Contains(payloads[0], `"kg_grounding"`) {
		t.Fatalf("equal duplicate not compacted: %s", payloads[0])
	}
	if payloads[1] != original[1] || payloads[2] != original[2] {
		t.Fatalf("nonduplicate rows changed: got %#v want %#v", payloads, original)
	}
}

func compactEvidenceFixture(t *testing.T) (string, []string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "evidence.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`create table evidence_events (id integer primary key, payload_json text not null)`); err != nil {
		t.Fatal(err)
	}
	payloads := []string{
		`{"kg_grounding":{"nodes":["n1"]},"evidence":{"kg_grounding":{"nodes":["n1"]},"source":"a"}}`,
		`{"kg_grounding":{"nodes":["n1"]},"evidence":{"kg_grounding":{"nodes":["n2"]},"source":"b"}}`,
		`{"learning_trace":{"guided_response":"keep this"}}`,
	}
	for index, payload := range payloads {
		if _, err := db.Exec(`insert into evidence_events (id, payload_json) values (?, ?)`, index+1, payload); err != nil {
			t.Fatal(err)
		}
	}
	return path, payloads
}

func readPayloads(t *testing.T, path string) []string {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query(`select payload_json from evidence_events order by id asc`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	payloads := []string{}
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			t.Fatal(err)
		}
		payloads = append(payloads, payload)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return payloads
}
