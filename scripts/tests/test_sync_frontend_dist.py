from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path


def _file_manifest(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def test_sync_frontend_dist_copies_an_identical_complete_file_set(tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    script_directory = repository / "scripts"
    source = repository / "frontend" / "dist"
    target = repository / "services" / "api-gateway-go" / "internal" / "web" / "dist"
    script_directory.mkdir(parents=True)
    source.joinpath("assets", "nested").mkdir(parents=True)
    target.mkdir(parents=True)

    source.joinpath("index.html").write_bytes(b"<main>ResponsibleEduAgent</main>")
    source.joinpath("umi.js").write_bytes(b"const app = true;")
    source.joinpath("assets", "nested", "font.woff2").write_bytes(b"font-bytes")
    target.joinpath("stale.js").write_bytes(b"stale")

    shutil.copy2(
        Path(__file__).parents[1] / "sync_frontend_dist.mjs",
        script_directory / "sync_frontend_dist.mjs",
    )

    completed = subprocess.run(
        ["node", str(script_directory / "sync_frontend_dist.mjs")],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert _file_manifest(target) == _file_manifest(source)
