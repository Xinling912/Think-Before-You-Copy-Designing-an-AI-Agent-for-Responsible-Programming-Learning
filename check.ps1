param(
  [switch]$Full,
  [switch]$E2E,
  [switch]$EvalBaselines
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
  }
}

Write-Host "ResponsibleEduAgent MVP checks"

$requiredFiles = @(
  "docs/architecture.md",
  "docs/mvp-design.md",
  "docs/construction-plan.md",
  "docs/education-agent-skills-inventory.md",
  "kg/concepts.yaml",
  "kg/edges.yaml",
  "skills/pedagogy/mvp-student-learning-skills.md",
  "services/api-gateway-go/migrations/001_init.sql"
)

foreach ($file in $requiredFiles) {
  if (!(Test-Path $file)) {
    throw "Missing required file: $file"
  }
}

$requiredDirs = @(
  "frontend",
  "services/api-gateway-go",
  "services/ai-core-python"
)

foreach ($dir in $requiredDirs) {
  if (!(Test-Path $dir)) {
    throw "Missing required directory: $dir"
  }
}

Invoke-Checked python scripts/check_service_contracts.py
Invoke-Checked python scripts/check_privacy_fields.py
Invoke-Checked python scripts/check_corpus.py
Invoke-Checked python scripts/check_multisource_corpus.py
Invoke-Checked python scripts/check_rag_index.py
Invoke-Checked python scripts/check_kg_candidates.py
Invoke-Checked python scripts/check_research_contract.py

if ($E2E) {
  Invoke-Checked python scripts/e2e_index_error_smoke.py
}
elseif ($EvalBaselines) {
  if ($env:DASHSCOPE_API_KEY) {
    $env:PYTHONPATH = "services/ai-core-python;."
    Invoke-Checked python scripts/eval_baselines.py --out eval/results/latest-baseline.jsonl
    Invoke-Checked python scripts/check_baseline_results.py eval/results/latest-baseline.summary.json
  }
  else {
    Write-Host "Skipping baseline evaluation because DASHSCOPE_API_KEY is not set."
  }
}
elseif ($Full) {
  Invoke-Checked python scripts/check_research_contract.py --strict

  Push-Location services/api-gateway-go
  try {
    Invoke-Checked go test ./...
  }
  finally {
    Pop-Location
  }

  $env:PYTHONPATH = "services/ai-core-python;."
  Invoke-Checked python -m pytest services/ai-core-python/tests -q
  Invoke-Checked python -m pytest scripts/tests -q
  if ($env:DASHSCOPE_API_KEY) {
    Invoke-Checked python scripts/eval_rag_retrieval.py
    Invoke-Checked python scripts/eval_session_orchestrator.py
  }
  else {
    Write-Host "Skipping external DashScope RAG and session orchestrator eval because DASHSCOPE_API_KEY is not set."
  }

  Push-Location frontend
  try {
    Invoke-Checked npm test
    Invoke-Checked npm run build
    Invoke-Checked npm run sync:go
  }
  finally {
    Pop-Location
  }
}

Write-Host "All MVP checks passed."
