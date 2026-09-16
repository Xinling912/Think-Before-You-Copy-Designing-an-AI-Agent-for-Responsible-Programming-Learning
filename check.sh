#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$ROOT_DIR/.tools/go/bin/go" ]]; then
  export PATH="$ROOT_DIR/.tools/go/bin:$PATH"
fi

echo "ResponsibleEduAgent MVP checks"

test -f docs/architecture.md
test -f docs/mvp-design.md
test -f docs/construction-plan.md
test -f docs/education-agent-skills-inventory.md
test -f kg/concepts.yaml
test -f kg/edges.yaml
test -f skills/pedagogy/mvp-student-learning-skills.md
test -d frontend
test -d services/api-gateway-go
test -d services/ai-core-python
test -f services/api-gateway-go/migrations/001_init.sql

grep -q "Go + go-zero" docs/construction-plan.md
grep -q "Python + FastAPI" docs/construction-plan.md
grep -q "FAISS" docs/construction-plan.md
grep -q "Umi Max" docs/construction-plan.md
grep -q "superpowers:test-driven-development" docs/construction-plan.md
grep -q "frontend-design" docs/construction-plan.md
grep -q "subagent-driven-development" docs/construction-plan.md
grep -q "端到端学习链路验收" docs/construction-plan.md
grep -q "Windows 11" docs/construction-plan.md
grep -q "PowerShell" docs/construction-plan.md
grep -q "mirrors.tuna.tsinghua.edu.cn" docs/construction-plan.md
grep -q "pypi.tuna.tsinghua.edu.cn" docs/construction-plan.md
grep -q "registry.npmmirror.com" docs/construction-plan.md
grep -q "GOPROXY" docs/construction-plan.md
grep -q "Docker Desktop" docs/construction-plan.md
grep -q "docker.m.daocloud.io" docs/construction-plan.md

grep -q "retrieve-first-gate" docs/education-agent-skills-inventory.md
grep -q "progressive-hint-ladder" docs/education-agent-skills-inventory.md
grep -q "stuck-and-error-diagnosis-coach" docs/education-agent-skills-inventory.md
grep -q "confidence-calibration-check" docs/education-agent-skills-inventory.md
grep -q "teach-back-evaluator" docs/education-agent-skills-inventory.md

grep -q "Concept:list" kg/concepts.yaml
grep -q "Concept:index" kg/concepts.yaml
grep -q "ErrorType:IndexError" kg/concepts.yaml

python3 scripts/check_service_contracts.py
python3 scripts/check_privacy_fields.py
python3 scripts/check_corpus.py
python3 scripts/check_multisource_corpus.py
python3 scripts/check_rag_index.py
python3 scripts/check_kg_candidates.py
python3 scripts/check_research_contract.py

if [[ "${1:-}" == "--e2e" ]]; then
  python3 scripts/check_deployed_frontend.py \
    --base-url "${REA_BASE_URL:-http://127.0.0.1:18081}" \
    --dist services/api-gateway-go/internal/web/dist \
    --require-text colorEdgesBySourceRole
  python3 scripts/e2e_index_error_smoke.py
  python3 scripts/e2e_test_center_smoke.py
elif [[ "${1:-}" == "--eval-baselines" ]]; then
  if [[ -n "${DASHSCOPE_API_KEY:-}" ]]; then
    PYTHONPATH=services/ai-core-python:. python3 scripts/eval_baselines.py --out eval/results/latest-baseline.jsonl
    python3 scripts/check_baseline_results.py eval/results/latest-baseline.summary.json
  else
    echo "Skipping baseline evaluation because DASHSCOPE_API_KEY is not set."
  fi
elif [[ "${1:-}" == "--full" ]]; then
  python3 scripts/check_research_contract.py --strict
  (
    cd services/api-gateway-go
    go test ./...
  )
  PYTHONPATH=services/ai-core-python:. python3 -m pytest services/ai-core-python/tests -q
  PYTHONPATH=services/ai-core-python:. python3 -m pytest scripts/tests -q
  if [[ -n "${DASHSCOPE_API_KEY:-}" ]]; then
    PYTHONPATH=services/ai-core-python:. python3 scripts/eval_rag_retrieval.py
    PYTHONPATH=services/ai-core-python:. python3 scripts/eval_session_orchestrator.py
  else
    echo "Skipping external DashScope RAG and session orchestrator eval because DASHSCOPE_API_KEY is not set."
  fi
  (
    cd frontend
    npm test
    npm run build
    npm run sync:go
  )
else
  echo "Full checks available: ./check.sh --full"
  echo "Baseline evaluation available: ./check.sh --eval-baselines"
fi

echo "All MVP structure checks passed."
