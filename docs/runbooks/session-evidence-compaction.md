# Session Evidence Compaction

This procedure removes only nested `evidence.kg_grounding` values that are exactly equal to the canonical top-level `kg_grounding` in historical evidence rows. It does not delete sessions, messages, learning episodes, token budgets, or learner-memory records.

Run these commands from the repository root. Stop the service before the backup and keep the backup until post-compaction verification has completed.

The container creates verified runtime snapshots in `data/runtime/backups`. Do not run compaction when the live database or its selected snapshot does not return exactly `ok` from `pragma integrity_check;`.

```powershell
docker compose stop responsible-edu-agent
Copy-Item .\data\runtime\responsible-edu-agent.db .\data\runtime\responsible-edu-agent.before-evidence-compaction.db
go run ./services/api-gateway-go/cmd/compact-evidence -db .\data\runtime\responsible-edu-agent.db -dry-run
go run ./services/api-gateway-go/cmd/compact-evidence -db .\data\runtime\responsible-edu-agent.db -apply
& 'C:\Miniconda3\Library\bin\sqlite3.exe' .\data\runtime\responsible-edu-agent.db 'pragma integrity_check;'
docker compose up -d responsible-edu-agent
```

The integrity command must print exactly `ok`. The dry-run output must report `changed_rows` without modifying the database. Record the command output with the experiment notes.

To roll back, stop the service, replace `responsible-edu-agent.db` with `responsible-edu-agent.before-evidence-compaction.db`, then start the service:

```powershell
docker compose stop responsible-edu-agent
Copy-Item .\data\runtime\responsible-edu-agent.before-evidence-compaction.db .\data\runtime\responsible-edu-agent.db -Force
docker compose up -d responsible-edu-agent
```
