import pytest

import scripts.check_research_contract as contract


def test_required_marker_check_reports_missing_file(monkeypatch, tmp_path):
    monkeypatch.setattr(contract, "ROOT", tmp_path)
    monkeypatch.setattr(
        contract,
        "REQUIRED_CODE_MARKERS",
        {"frontend/src/pages/SessionDemo/index.tsx": ["Shift+Enter"]},
    )

    with pytest.raises(SystemExit) as exc:
        contract.check_required_code_markers()

    message = str(exc.value)
    assert "missing marker file" in message
    assert "frontend/src/pages/SessionDemo/index.tsx" in message
