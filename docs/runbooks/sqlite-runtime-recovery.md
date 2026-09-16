# SQLite Runtime Recovery

Use this procedure only after the container refuses startup with an `integrity_check_failed:` message or `pragma integrity_check;` reports a value other than `ok`.

```powershell
docker compose stop responsible-edu-agent
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
Move-Item -LiteralPath .\data\runtime\responsible-edu-agent.db -Destination ".\data\runtime\responsible-edu-agent.corrupt-$stamp.db"
$backup = Get-ChildItem .\data\runtime\backups\responsible-edu-agent-*.db | Sort-Object Name -Descending | Select-Object -First 1
& 'C:\Miniconda3\Library\bin\sqlite3.exe' $backup.FullName 'pragma integrity_check;'
Copy-Item -LiteralPath $backup.FullName -Destination .\data\runtime\responsible-edu-agent.db
& 'C:\Miniconda3\Library\bin\sqlite3.exe' .\data\runtime\responsible-edu-agent.db 'pragma integrity_check;'
docker compose up -d responsible-edu-agent
Invoke-WebRequest -UseBasicParsing http://localhost:18081/api/health
```

Both integrity commands must print exactly `ok`. Do not copy a snapshot that prints any other value. The timestamped corrupt file remains available for forensic recovery.

To roll back this restore, stop the service, replace `responsible-edu-agent.db` with the timestamped corrupt file, then start the service:

```powershell
docker compose stop responsible-edu-agent
Copy-Item -LiteralPath .\data\runtime\responsible-edu-agent.corrupt-YYYYMMDDTHHMMSS.db -Destination .\data\runtime\responsible-edu-agent.db -Force
docker compose up -d responsible-edu-agent
```
