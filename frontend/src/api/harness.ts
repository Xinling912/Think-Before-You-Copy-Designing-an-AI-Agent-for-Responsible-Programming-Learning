export type HarnessFixtureCase = {
  case_id: string;
  input?: string;
  expected_behavior?: string;
  assertions?: string[];
};

export type HarnessSuite = {
  id: string;
  title: string;
  scenario_id: string;
  method_source: string;
  metric_ids?: string[];
  command?: {
    label?: string;
    allowlisted?: boolean;
  };
  pass_criteria?: string[];
  cases?: HarnessFixtureCase[];
};

export type HarnessStoredCase = {
  case_id: string;
  suite_id: string;
  scenario_id: string;
  status: 'pending' | 'confirmed' | 'deleted' | string;
  natural_language_request: string;
  case_json: Record<string, unknown>;
  validator_errors: string[];
  model: string;
  llm_used: boolean;
  llm_fallback: boolean;
  created_at: string;
  confirmed_at?: string;
  deleted_at?: string;
};

export type HarnessRun = {
  id: string;
  suite_id: string;
  status: string;
  created_at_beijing: string;
  duration_ms?: number;
  exit_code?: number;
  metrics?: Record<string, unknown>;
  log_path?: string;
  stdout_tail?: string;
  stderr_tail?: string;
  case_id?: string;
  natural_language_request?: string;
  compiled_case?: Record<string, unknown>;
};

export type HarnessCaseStatus = 'active' | 'pending' | 'confirmed' | 'deleted' | 'all';

export type HarnessSuitesResponse = {
  suites: HarnessSuite[];
  runs: HarnessRun[];
};

export type HarnessCasesResponse = {
  cases: HarnessStoredCase[];
};

export type HarnessCaseResponse = {
  case: HarnessStoredCase;
};

export type HarnessRunResponse = {
  run: HarnessRun;
};

export async function getHarnessSuites(): Promise<HarnessSuitesResponse> {
  return requestJSON('/api/harness/suites', 'harness_suites_lookup_failed');
}

export async function getHarnessCases(params: {
  suite_id: string;
  status?: HarnessCaseStatus;
}): Promise<HarnessCasesResponse> {
  const search = new URLSearchParams({
    suite_id: params.suite_id,
    status: params.status ?? 'active',
  });
  return requestJSON(`/api/harness/cases?${search.toString()}`, 'harness_cases_lookup_failed');
}

export async function compileHarnessCase(payload: {
  suite_id: string;
  scenario_id: string;
  natural_language_request: string;
}): Promise<HarnessCaseResponse> {
  const data = await requestJSON<unknown>('/api/harness/cases/compile', 'harness_case_compile_failed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return requireCaseResponse(data, 'harness_case_compile_failed');
}

export async function confirmHarnessCase(caseId: string): Promise<HarnessCaseResponse> {
  const data = await requestJSON<unknown>(
    `/api/harness/cases/${encodeURIComponent(caseId)}/confirm`,
    'harness_case_confirm_failed',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
  return requireCaseResponse(data, 'harness_case_confirm_failed');
}

export async function deleteHarnessCase(caseId: string): Promise<HarnessCaseResponse> {
  const data = await requestJSON<unknown>(`/api/harness/cases/${encodeURIComponent(caseId)}`, 'harness_case_delete_failed', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  return requireCaseResponse(data, 'harness_case_delete_failed');
}

export async function runHarness(payload: { suite_id: string; case_id?: string }): Promise<HarnessRunResponse> {
  const data = await requestJSON<unknown>('/api/harness/run', 'harness_run_failed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return requireRunResponse(data, 'harness_run_failed');
}

async function requestJSON<T>(url: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readError(data, fallback));
  }
  return data as T;
}

function readError(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return fallback;
}

function requireCaseResponse(data: unknown, fallback: string): HarnessCaseResponse {
  if (!isRecord(data) || !isHarnessStoredCase(data.case)) {
    throw new Error(fallback);
  }
  return data as HarnessCaseResponse;
}

function requireRunResponse(data: unknown, fallback: string): HarnessRunResponse {
  if (!isRecord(data) || !isHarnessRun(data.run)) {
    throw new Error(fallback);
  }
  return data as HarnessRunResponse;
}

function isHarnessStoredCase(value: unknown): value is HarnessStoredCase {
  return (
    isRecord(value) &&
    typeof value.case_id === 'string' &&
    typeof value.suite_id === 'string' &&
    typeof value.scenario_id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.natural_language_request === 'string' &&
    isRecord(value.case_json) &&
    Array.isArray(value.validator_errors) &&
    typeof value.model === 'string' &&
    typeof value.llm_used === 'boolean' &&
    typeof value.llm_fallback === 'boolean' &&
    typeof value.created_at === 'string'
  );
}

function isHarnessRun(value: unknown): value is HarnessRun {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.suite_id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.created_at_beijing === 'string' &&
    (value.metrics === undefined || isRecord(value.metrics)) &&
    (value.case_id === undefined || typeof value.case_id === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
