import argparse
import re
import sqlite3
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Sequence


SNAPSHOT_NAME = re.compile(r"^responsible-edu-agent-\d{8}T\d{6}Z\.db$")


class DatabaseIntegrityError(RuntimeError):
    pass


def read_only_uri(database_path: Path) -> str:
    return f"{database_path.resolve().as_uri()}?mode=ro"


def verify_database(database_path: Path) -> None:
    try:
        source = sqlite3.connect(read_only_uri(database_path), uri=True)
        try:
            result = source.execute("pragma integrity_check(1)").fetchall()
        finally:
            source.close()
    except sqlite3.Error as error:
        raise DatabaseIntegrityError(f"integrity_check_failed:{error}") from error
    if result != [("ok",)]:
        detail = " | ".join(str(row[0]) for row in result)
        raise DatabaseIntegrityError(f"integrity_check_failed:{detail}")


def create_verified_backup(database_path: Path, backup_directory: Path, now: datetime) -> Path | None:
    if not database_path.exists():
        return None
    verify_database(database_path)
    backup_directory.mkdir(parents=True, exist_ok=True)
    destination = backup_directory / f"responsible-edu-agent-{now:%Y%m%dT%H%M%SZ}.db"
    temporary = destination.with_suffix(".db.tmp")
    source: sqlite3.Connection | None = None
    target: sqlite3.Connection | None = None
    try:
        source = sqlite3.connect(read_only_uri(database_path), uri=True)
        target = sqlite3.connect(temporary)
        try:
            source.backup(target)
        finally:
            if target is not None:
                target.close()
            if source is not None:
                source.close()
        verify_database(temporary)
        temporary.replace(destination)
    except sqlite3.Error as error:
        raise DatabaseIntegrityError(f"backup_failed:{error}") from error
    finally:
        if temporary.exists():
            temporary.unlink()
    return destination


def prune_backups(backup_directory: Path, retention: int) -> list[Path]:
    if not backup_directory.exists():
        return []
    snapshots = sorted(
        (path for path in backup_directory.iterdir() if path.is_file() and SNAPSHOT_NAME.fullmatch(path.name)),
        key=lambda path: path.name,
    )
    removed = snapshots[:-retention]
    for path in removed:
        path.unlink()
    return removed


def create_and_prune(database_path: Path, backup_directory: Path, retention: int) -> Path | None:
    snapshot = create_verified_backup(database_path, backup_directory, datetime.now(UTC))
    if snapshot is not None:
        prune_backups(backup_directory, retention)
        print(f"sqlite_backup_created={snapshot}", flush=True)
    return snapshot


def watch(database_path: Path, backup_directory: Path, retention: int, interval_seconds: int) -> int:
    while True:
        time.sleep(interval_seconds)
        try:
            create_and_prune(database_path, backup_directory, retention)
        except DatabaseIntegrityError as error:
            print(error, file=sys.stderr, flush=True)
            return 1


def bounded_integer(minimum: int, maximum: int):
    def parse(raw: str) -> int:
        try:
            value = int(raw)
        except ValueError as error:
            raise argparse.ArgumentTypeError(f"must be an integer from {minimum} through {maximum}") from error
        if value < minimum or value > maximum:
            raise argparse.ArgumentTypeError(f"must be an integer from {minimum} through {maximum}")
        return value

    return parse


def parse_arguments(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--backup-dir", required=True, type=Path)
    parser.add_argument("--retention", default=7, type=bounded_integer(1, 365))
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--watch-seconds", type=bounded_integer(60, 2592000))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = parse_arguments(list(argv) if argv is not None else sys.argv[1:])
    except SystemExit as error:
        return int(error.code)
    if arguments.once:
        try:
            create_and_prune(arguments.db, arguments.backup_dir, arguments.retention)
        except DatabaseIntegrityError as error:
            print(error, file=sys.stderr, flush=True)
            return 1
        return 0
    return watch(arguments.db, arguments.backup_dir, arguments.retention, arguments.watch_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
