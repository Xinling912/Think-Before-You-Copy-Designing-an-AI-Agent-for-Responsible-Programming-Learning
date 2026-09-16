from __future__ import annotations

import hashlib
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable, Iterator

import pytest

from scripts.check_deployed_frontend import compare_deployed_frontend, main


REQUIRED_TEXT = "colorEdgesBySourceRole"


class _QuietRequestHandler(SimpleHTTPRequestHandler):
    requested_paths: list[str]

    def do_GET(self) -> None:
        self.requested_paths.append(self.path)
        super().do_GET()

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def deployed_frontend_server() -> Iterator[Callable[[Path], tuple[str, list[str]]]]:
    servers: list[tuple[ThreadingHTTPServer, threading.Thread]] = []

    def start(root: Path) -> tuple[str, list[str]]:
        requested_paths: list[str] = []
        recording_handler = type(
            "RecordingRequestHandler",
            (_QuietRequestHandler,),
            {"requested_paths": requested_paths},
        )
        handler = partial(recording_handler, directory=str(root))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        servers.append((server, thread))
        return f"http://127.0.0.1:{server.server_port}", requested_paths

    yield start

    for server, thread in servers:
        server.shutdown()
        thread.join()
        server.server_close()


def _write_frontend(root: Path, javascript: bytes | None = None) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "index.html").write_bytes(b"<main>ResponsibleEduAgent</main>")
    (root / "app.js").write_bytes(javascript or f"const marker = '{REQUIRED_TEXT}';".encode())
    (root / "app.css").write_bytes(b"main { color: #123456; }")


def test_identical_html_javascript_and_css_return_zero(deployed_frontend_server, capsys):
    with TemporaryDirectory() as local_dir, TemporaryDirectory() as remote_dir:
        local = Path(local_dir)
        remote = Path(remote_dir)
        _write_frontend(local)
        _write_frontend(remote)
        base_url, _ = deployed_frontend_server(remote)

        status = main(["--base-url", base_url, "--dist", str(local), "--require-text", REQUIRED_TEXT])

    assert status == 0
    assert capsys.readouterr().out == "checked=3 mismatches=0 required_text_found=true\n"


def test_changed_javascript_byte_returns_one_and_prints_both_hashes(deployed_frontend_server, capsys):
    with TemporaryDirectory() as local_dir, TemporaryDirectory() as remote_dir:
        local = Path(local_dir)
        remote = Path(remote_dir)
        local_javascript = f"const marker = '{REQUIRED_TEXT}';".encode()
        remote_javascript = local_javascript[:-1] + b"!"
        _write_frontend(local, local_javascript)
        _write_frontend(remote, remote_javascript)
        base_url, _ = deployed_frontend_server(remote)

        status = main(["--base-url", base_url, "--dist", str(local), "--require-text", REQUIRED_TEXT])

    output = capsys.readouterr().out
    assert status == 1
    assert "app.js" in output
    assert hashlib.sha256(local_javascript).hexdigest() in output
    assert hashlib.sha256(remote_javascript).hexdigest() in output


def test_missing_remote_file_returns_one_and_prints_path_and_http_status(deployed_frontend_server, capsys):
    with TemporaryDirectory() as local_dir, TemporaryDirectory() as remote_dir:
        local = Path(local_dir)
        remote = Path(remote_dir)
        _write_frontend(local)
        _write_frontend(remote)
        (remote / "app.css").unlink()
        base_url, _ = deployed_frontend_server(remote)

        status = main(["--base-url", base_url, "--dist", str(local), "--require-text", REQUIRED_TEXT])

    output = capsys.readouterr().out
    assert status == 1
    assert "app.css" in output
    assert "HTTP 404" in output


def test_missing_required_text_marker_returns_one(deployed_frontend_server, capsys):
    with TemporaryDirectory() as local_dir, TemporaryDirectory() as remote_dir:
        local = Path(local_dir)
        remote = Path(remote_dir)
        javascript = b"const marker = 'different';"
        _write_frontend(local, javascript)
        _write_frontend(remote, javascript)
        base_url, _ = deployed_frontend_server(remote)

        status = main(["--base-url", base_url, "--dist", str(local), "--require-text", REQUIRED_TEXT])

    assert status == 1
    assert "required_text_found=false" in capsys.readouterr().out


def test_ds_store_is_excluded(deployed_frontend_server):
    with TemporaryDirectory() as local_dir, TemporaryDirectory() as remote_dir:
        local = Path(local_dir)
        remote = Path(remote_dir)
        _write_frontend(local)
        _write_frontend(remote)
        (local / ".DS_Store").write_bytes(b"local metadata")
        base_url, requested_paths = deployed_frontend_server(remote)

        result = compare_deployed_frontend(base_url, local, REQUIRED_TEXT)

    assert result.checked_files == 3
    assert "/.DS_Store" not in requested_paths


def test_nested_asset_paths_use_posix_separators(deployed_frontend_server):
    with TemporaryDirectory() as local_dir, TemporaryDirectory() as remote_dir:
        local = Path(local_dir)
        remote = Path(remote_dir)
        nested_path = Path("assets") / "nested chunk" / "app.js"
        for root in (local, remote):
            (root / nested_path).parent.mkdir(parents=True)
            (root / nested_path).write_text(REQUIRED_TEXT, encoding="utf-8")
        base_url, requested_paths = deployed_frontend_server(remote)

        result = compare_deployed_frontend(base_url, local, REQUIRED_TEXT)

    assert result.mismatches == ()
    assert requested_paths == ["/assets/nested%20chunk/app.js"]
    assert "\\" not in requested_paths[0]


def test_empty_dist_directory_returns_one(deployed_frontend_server, capsys):
    with TemporaryDirectory() as local_dir, TemporaryDirectory() as remote_dir:
        local = Path(local_dir)
        remote = Path(remote_dir)
        base_url, _ = deployed_frontend_server(remote)

        status = main(["--base-url", base_url, "--dist", str(local), "--require-text", REQUIRED_TEXT])

    assert status == 1
    assert capsys.readouterr().out == "checked=0 mismatches=0 required_text_found=false\n"
