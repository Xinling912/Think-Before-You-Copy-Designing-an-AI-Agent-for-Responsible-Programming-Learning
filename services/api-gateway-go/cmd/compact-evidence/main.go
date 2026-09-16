package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"responsible-edu-agent/services/api-gateway-go/internal/store"

	_ "modernc.org/sqlite"
)

type summary struct {
	ScannedRows int
	ChangedRows int
	BytesBefore int
	BytesAfter  int
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("compact-evidence", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	databasePath := flags.String("db", "", "SQLite database path")
	dryRun := flags.Bool("dry-run", false, "report changes without writing")
	apply := flags.Bool("apply", false, "write compacted payloads")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*databasePath) == "" || *dryRun == *apply || flags.NArg() != 0 {
		return fmt.Errorf("usage: compact-evidence -db <sqlite-path> (-dry-run | -apply)")
	}

	dsn := *databasePath
	if *dryRun {
		absolutePath, err := filepath.Abs(*databasePath)
		if err != nil {
			return err
		}
		dsn = "file:" + filepath.ToSlash(absolutePath) + "?mode=ro"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.PingContext(context.Background()); err != nil {
		return err
	}

	result, err := compact(context.Background(), db, *apply)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(output, "scanned_rows=%d\nchanged_rows=%d\nbytes_before=%d\nbytes_after=%d\nbytes_saved=%d\n", result.ScannedRows, result.ChangedRows, result.BytesBefore, result.BytesAfter, result.BytesBefore-result.BytesAfter)
	return err
}

func compact(ctx context.Context, db *sql.DB, apply bool) (summary, error) {
	rows, err := db.QueryContext(ctx, `select id, payload_json from evidence_events order by id asc`)
	if err != nil {
		return summary{}, err
	}
	defer rows.Close()

	type change struct {
		id      int64
		payload string
	}
	changes := []change{}
	result := summary{}
	for rows.Next() {
		var id int64
		var raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return summary{}, err
		}
		result.ScannedRows++
		result.BytesBefore += len(raw)
		var payload map[string]any
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			return summary{}, fmt.Errorf("evidence event %d: invalid payload JSON: %w", id, err)
		}
		compacted, err := store.CompactEvidencePayload(payload)
		if err != nil {
			return summary{}, fmt.Errorf("evidence event %d: %w", id, err)
		}
		encoded, err := json.Marshal(compacted)
		if err != nil {
			return summary{}, fmt.Errorf("evidence event %d: %w", id, err)
		}
		changed := nestedKGWasRemoved(payload, compacted)
		if changed {
			result.ChangedRows++
			result.BytesAfter += len(encoded)
			changes = append(changes, change{id: id, payload: string(encoded)})
		} else {
			result.BytesAfter += len(raw)
		}
	}
	if err := rows.Err(); err != nil {
		return summary{}, err
	}
	if err := rows.Close(); err != nil {
		return summary{}, err
	}
	if apply {
		for _, change := range changes {
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				return summary{}, err
			}
			if _, err := tx.ExecContext(ctx, `update evidence_events set payload_json = ? where id = ?`, change.payload, change.id); err != nil {
				_ = tx.Rollback()
				return summary{}, err
			}
			if err := tx.Commit(); err != nil {
				return summary{}, err
			}
		}
	}
	return result, nil
}

func nestedKGWasRemoved(before, after map[string]any) bool {
	beforeEvidence, beforeOK := before["evidence"].(map[string]any)
	afterEvidence, afterOK := after["evidence"].(map[string]any)
	if !beforeOK || !afterOK {
		return false
	}
	_, beforeHasNestedKG := beforeEvidence["kg_grounding"]
	_, afterHasNestedKG := afterEvidence["kg_grounding"]
	return beforeHasNestedKG && !afterHasNestedKG
}
