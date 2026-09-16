import sqlite3
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from scripts import runtime_db_backup


def create_database(database_path: Path, rows: list[tuple[str, str]]) -> None:
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("create table sessions (id text primary key, status text not null)")
        connection.executemany("insert into sessions (id, status) values (?, ?)", rows)
        connection.commit()
    finally:
        connection.close()


def read_rows(database_path: Path) -> list[tuple[str, str]]:
    connection = sqlite3.connect(database_path)
    try:
        return connection.execute("select id, status from sessions order by id").fetchall()
    finally:
        connection.close()


def test_valid_database_creates_verified_snapshot(tmp_path: Path) -> None:
    database = tmp_path / "runtime.db"
    create_database(database, [("session-1", "active")])

    snapshot = runtime_db_backup.create_verified_backup(
        database, tmp_path / "backups", datetime(2026, 7, 27, tzinfo=UTC)
    )

    assert snapshot == tmp_path / "backups" / "responsible-edu-agent-20260727T000000Z.db"
    assert read_rows(snapshot) == [("session-1", "active")]
    runtime_db_backup.verify_database(snapshot)


def test_missing_database_returns_none_without_backup_directory(tmp_path: Path) -> None:
    assert runtime_db_backup.create_verified_backup(
        tmp_path / "missing.db", tmp_path / "backups", datetime(2026, 7, 27, tzinfo=UTC)
    ) is None
    assert not (tmp_path / "backups").exists()


def test_corrupt_database_keeps_existing_snapshot_byte_identical(tmp_path: Path) -> None:
    database = tmp_path / "runtime.db"
    database.write_bytes(b"not a sqlite database")
    backup_directory = tmp_path / "backups"
    backup_directory.mkdir()
    existing = backup_directory / "responsible-edu-agent-20260726T000000Z.db"
    existing.write_bytes(b"known-good")

    with pytest.raises(runtime_db_backup.DatabaseIntegrityError):
        runtime_db_backup.create_verified_backup(database, backup_directory, datetime(2026, 7, 27, tzinfo=UTC))

    assert existing.read_bytes() == b"known-good"
    assert list(backup_directory.iterdir()) == [existing]


def test_prune_keeps_newest_recognized_snapshots_and_manual_file(tmp_path: Path) -> None:
    backup_directory = tmp_path / "backups"
    backup_directory.mkdir()
    snapshots = [
        backup_directory / f"responsible-edu-agent-2026072{day}T000000Z.db"
        for day in range(1, 5)
    ]
    for snapshot in snapshots:
        snapshot.write_bytes(b"snapshot")
    manual = backup_directory / "manual-before-upgrade.db"
    manual.write_bytes(b"manual")

    removed = runtime_db_backup.prune_backups(backup_directory, retention=2)

    assert removed == snapshots[:2]
    assert manual.exists()
    assert sorted(path.name for path in backup_directory.iterdir()) == [
        "manual-before-upgrade.db",
        "responsible-edu-agent-20260723T000000Z.db",
        "responsible-edu-agent-20260724T000000Z.db",
    ]


def test_main_rejects_invalid_options() -> None:
    assert runtime_db_backup.main(
        ["--db", "db", "--backup-dir", "backups", "--once", "--watch-seconds", "60"]
    ) == 2
    assert runtime_db_backup.main(
        ["--db", "db", "--backup-dir", "backups", "--once", "--retention", "0"]
    ) == 2
    assert runtime_db_backup.main(
        ["--db", "db", "--backup-dir", "backups", "--watch-seconds", "59"]
    ) == 2


def test_once_mode_refuses_corrupt_database_with_exit_code_one(tmp_path: Path) -> None:
    database = tmp_path / "runtime.db"
    database.write_bytes(b"corrupt")

    result = subprocess.run(
        [
            sys.executable,
            "scripts/runtime_db_backup.py",
            "--db",
            str(database),
            "--backup-dir",
            str(tmp_path / "backups"),
            "--retention",
            "7",
            "--once",
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 1
    assert "integrity_check_failed:" in result.stderr
    assert not (tmp_path / "backups").exists()
