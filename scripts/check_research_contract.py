#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.corpus_sources import all_source_ids, source_by_id  # noqa: E402

MATRIX = ROOT / "docs/research/paper_to_implementation_matrix.md"
README = ROOT / "README.md"
REQUIRED_TERMS = [
    "Mem0 operations",
    "MemoryBank decay",
    "RMM topic reflection",
    "Zep temporal graph memory",
    "Educational KG extraction",
    "Progressive hints",
    "Cognitive forcing",
    "Metacognition",
    "Teach-back",
]

TASK1_CODE_PATHS = [
    ROOT / "services/ai-core-python/app/research_contract.py",
]
STRICT_CODE_PATHS = [
    *TASK1_CODE_PATHS,
    ROOT / "services/ai-core-python/app/memory.py",
    ROOT / "services/ai-core-python/app/pedagogy.py",
    ROOT / "services/ai-core-python/app/kg_extraction.py",
    ROOT / "scripts/merge_approved_kg.py",
    ROOT / "frontend/src/pages/KGReview/index.tsx",
    ROOT / "kg/generated/candidates.jsonl",
]
REQUIRED_CODE_MARKERS = {
    "services/ai-core-python/app/memory.py": [
        "def decide_memory_operations",
        "def memorybank_effective_score",
        "def build_prospective_memory_plan",
        "def retrospective_memory_use",
        "def generate_learning_facts",
    ],
    "services/ai-core-python/app/pedagogy.py": [
        "RETRIEVE_FIRST_SKILL_ID",
        "PROGRESSIVE_HINT_SKILL_ID",
        "STUCK_DIAGNOSIS_SKILL_ID",
        "CONFIDENCE_CALIBRATION_SKILL_ID",
        "TEACH_BACK_SKILL_ID",
    ],
    "services/api-gateway-go/internal/store/memory.go": [
        "func memoryEffectiveScore",
        'case "REINFORCE"',
        "decayAndCapMemoriesTx",
    ],
    "services/api-gateway-go/internal/store/learning_graph.go": [
        "learning_episodes",
        "learning_entities",
        "learning_facts",
        "invalidateContradictedLearningFacts",
    ],
    "frontend/src/pages/SessionDemo/index.tsx": [
        "setThinking(true)",
        "Shift+Enter",
        "buildOptimisticExchange",
    ],
    "scripts/merge_approved_kg.py": [
        "def merge_candidates",
        "def edge_from_candidate",
        "source_chunk_id",
        "reviewed_at",
    ],
}
KG_CANDIDATES = ROOT / "kg/generated/candidates.jsonl"
KG_CANDIDATE_REQUIRED_FIELDS = {
    "candidate_id",
    "source_id",
    "source_chunk_id",
    "source_url",
    "source_license_note",
    "subject",
    "predicate",
    "object",
    "confidence",
    "evidence_text",
    "status",
    "created_at",
}
USAGE = """Usage: python scripts/check_research_contract.py [--strict]

Default behavior validates the paper-to-implementation matrix and Task 1
research_contract.py module only.

Options:
  -h, --help  Show this help message and exit.
  --strict    Also require future research-grounded implementation modules.

Environment:
  RESEARCH_CONTRACT_STRICT=1  Enable the same checks as --strict.
"""


def help_requested(argv: list[str]) -> bool:
    return "-h" in argv or "--help" in argv


def strict_mode(argv: list[str]) -> bool:
    return "--strict" in argv or os.environ.get("RESEARCH_CONTRACT_STRICT") in {"1", "true", "TRUE"}


def check_matrix() -> None:
    if not MATRIX.exists():
        raise SystemExit(f"Research contract matrix missing: {MATRIX}")

    text = MATRIX.read_text(encoding="utf-8")
    missing = [term for term in REQUIRED_TERMS if term not in text]
    if missing:
        raise SystemExit(f"Research contract missing terms: {missing}")


def check_readme_model_contract() -> None:
    if not README.exists():
        raise SystemExit(f"README missing: {README}")

    text = README.read_text(encoding="utf-8")
    forbidden = ["qwen3.7-plus", "Qwen3.7 Plus"]
    found = [term for term in forbidden if term in text]
    if found:
        raise SystemExit(f"README still contains outdated model names: {found}")


def check_code_paths(paths: list[Path]) -> None:
    for path in paths:
        if not path.exists():
            raise SystemExit(f"Research-grounded module missing: {path}")


def check_required_code_markers() -> None:
    missing_files: list[str] = []
    missing_by_file: list[tuple[str, str]] = []
    for relative_path, markers in REQUIRED_CODE_MARKERS.items():
        path = ROOT / relative_path
        if not path.exists():
            missing_files.append(relative_path)
            continue
        text = path.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                missing_by_file.append((relative_path, marker))

    if missing_files or missing_by_file:
        details = "\n".join(
            [f"- {relative_path}: missing marker file" for relative_path in missing_files]
            + [f"- {relative_path}: missing marker {marker!r}" for relative_path, marker in missing_by_file]
        )
        raise SystemExit(f"Strict research contract missing required code markers:\n{details}")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_multisource_chunks() -> dict[str, dict[str, dict]]:
    chunks_by_source: dict[str, dict[str, dict]] = {}
    for source_id in all_source_ids():
        chunks_path = ROOT / source_by_id(source_id).processed_dir / "chunks.jsonl"
        if not chunks_path.is_file():
            raise SystemExit(f"Processed chunks missing for KG candidate source {source_id}: {chunks_path}")
        rows = read_jsonl(chunks_path)
        chunks_by_source[source_id] = {row["chunk_id"]: row for row in rows}
    return chunks_by_source


def check_kg_candidate_contract() -> None:
    known_source_ids = set(all_source_ids())
    chunks_by_source = load_multisource_chunks()
    candidates = []
    for line_number, line in enumerate(KG_CANDIDATES.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"KG candidate JSONL line {line_number} is invalid JSON: {exc}") from exc
        missing = sorted(KG_CANDIDATE_REQUIRED_FIELDS - set(candidate))
        if missing:
            raise SystemExit(f"KG candidate line {line_number} missing fields: {missing}")
        if not str(candidate["candidate_id"]).startswith("kgcand_"):
            raise SystemExit(f"KG candidate line {line_number} has invalid candidate_id: {candidate['candidate_id']}")
        source_id = str(candidate["source_id"])
        if source_id not in known_source_ids:
            raise SystemExit(f"KG candidate line {line_number} has unknown source_id: {source_id}")
        source_chunk_id = str(candidate["source_chunk_id"])
        source_chunks = chunks_by_source[source_id]
        if source_chunk_id not in source_chunks:
            raise SystemExit(
                f"KG candidate line {line_number} source_chunk_id not found in {source_id}: {source_chunk_id}",
            )
        if not str(candidate["source_url"]).startswith("http"):
            raise SystemExit(f"KG candidate line {line_number} must cite a public source URL.")
        if not str(candidate["evidence_text"]).strip():
            raise SystemExit(f"KG candidate line {line_number} must include evidence_text.")
        if str(candidate["evidence_text"]) not in source_chunks[source_chunk_id]["text"]:
            raise SystemExit(
                f"KG candidate line {line_number} evidence_text is not present in source chunk: {source_chunk_id}",
            )
        if not str(candidate["source_license_note"]).strip():
            raise SystemExit(f"KG candidate line {line_number} must include source_license_note.")
        confidence = candidate["confidence"]
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            raise SystemExit(f"KG candidate line {line_number} confidence must be numeric.")
        if not 0 <= float(confidence) <= 1:
            raise SystemExit(f"KG candidate line {line_number} confidence out of range: {confidence}")
        if not str(candidate["status"]).strip():
            raise SystemExit(f"KG candidate line {line_number} must include status.")
        candidates.append(candidate)

    if not candidates:
        raise SystemExit("KG candidates file must contain at least one candidate.")
    candidate_sources = {str(candidate["source_id"]) for candidate in candidates}
    missing_sources = sorted(known_source_ids - candidate_sources)
    if missing_sources:
        raise SystemExit(f"KG candidates must cover every corpus source. Missing: {missing_sources}")
    linked_nodes = {str(candidate["subject"]) for candidate in candidates} | {str(candidate["object"]) for candidate in candidates}
    if not any(node.startswith("ErrorType:") for node in linked_nodes):
        raise SystemExit("KG candidates must include at least one ErrorType node from the catalog.")
    if len({node.split(":", 1)[0] for node in linked_nodes if ":" in node}) < 2:
        raise SystemExit("KG candidates must cover at least two catalog node namespaces.")
    if len(linked_nodes) < 10:
        raise SystemExit("KG candidates must cover at least ten distinct catalog nodes.")
    predicates = {str(candidate["predicate"]) for candidate in candidates}
    if len(predicates) < 3:
        raise SystemExit("KG candidates must cover at least three relationship predicates.")


def main(argv: list[str]) -> None:
    if help_requested(argv):
        print(USAGE, end="")
        return

    check_matrix()
    check_readme_model_contract()
    strict = strict_mode(argv)
    check_code_paths(STRICT_CODE_PATHS if strict else TASK1_CODE_PATHS)
    if strict:
        check_required_code_markers()
        check_kg_candidate_contract()
    print("Research contract checks passed.")


if __name__ == "__main__":
    main(sys.argv[1:])
