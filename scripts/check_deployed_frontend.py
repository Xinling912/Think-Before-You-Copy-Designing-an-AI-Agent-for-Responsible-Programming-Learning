#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen


@dataclass(frozen=True)
class FileMismatch:
    relative_path: str
    local_sha256: str
    remote_sha256: str | None
    http_status: int | None = None
    error: str | None = None


@dataclass(frozen=True)
class DeliveryCheckResult:
    checked_files: int
    mismatches: tuple[FileMismatch, ...]
    required_text_found: bool


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def compare_deployed_frontend(base_url: str, dist: Path, required_text: str) -> DeliveryCheckResult:
    mismatches: list[FileMismatch] = []
    checked_files = 0
    required_text_bytes = required_text.encode("utf-8")
    required_text_found = False

    for local_path in sorted(dist.rglob("*")):
        if not local_path.is_file() or local_path.name == ".DS_Store":
            continue

        checked_files += 1
        relative_path = local_path.relative_to(dist)
        relative_path_text = relative_path.as_posix()
        local_bytes = local_path.read_bytes()
        local_sha256 = _sha256(local_bytes)
        url = base_url.rstrip("/") + "/" + quote(relative_path_text, safe="/")

        try:
            with urlopen(url, timeout=10) as response:
                remote_bytes = response.read()
        except HTTPError as exc:
            mismatches.append(
                FileMismatch(
                    relative_path=relative_path_text,
                    local_sha256=local_sha256,
                    remote_sha256=None,
                    http_status=exc.code,
                )
            )
            continue
        except URLError as exc:
            mismatches.append(
                FileMismatch(
                    relative_path=relative_path_text,
                    local_sha256=local_sha256,
                    remote_sha256=None,
                    error=str(exc.reason),
                )
            )
            continue

        remote_sha256 = _sha256(remote_bytes)
        if remote_sha256 != local_sha256:
            mismatches.append(
                FileMismatch(
                    relative_path=relative_path_text,
                    local_sha256=local_sha256,
                    remote_sha256=remote_sha256,
                )
            )
        if relative_path.suffix == ".js" and required_text_bytes in remote_bytes:
            required_text_found = True

    return DeliveryCheckResult(
        checked_files=checked_files,
        mismatches=tuple(mismatches),
        required_text_found=required_text_found,
    )


def _print_result(result: DeliveryCheckResult) -> None:
    for mismatch in result.mismatches:
        parts = [
            f"mismatch path={mismatch.relative_path}",
            f"local_sha256={mismatch.local_sha256}",
            f"remote_sha256={mismatch.remote_sha256 or 'unavailable'}",
        ]
        if mismatch.http_status is not None:
            parts.append(f"status=HTTP {mismatch.http_status}")
        if mismatch.error is not None:
            parts.append(f"error={mismatch.error}")
        print(" ".join(parts))

    print(
        f"checked={result.checked_files} "
        f"mismatches={len(result.mismatches)} "
        f"required_text_found={str(result.required_text_found).lower()}"
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare deployed frontend bytes with the embedded dist")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--dist", required=True, type=Path)
    parser.add_argument("--require-text", required=True)
    args = parser.parse_args(argv)

    result = compare_deployed_frontend(args.base_url, args.dist, args.require_text)
    _print_result(result)
    return int(not (result.checked_files > 0 and not result.mismatches and result.required_text_found))


if __name__ == "__main__":
    raise SystemExit(main())
