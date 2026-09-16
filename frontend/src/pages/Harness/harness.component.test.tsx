import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { compileHarnessCase, confirmHarnessCase, deleteHarnessCase, runHarness } from '../../api/harness';
import HarnessPage from './index';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const fetchCalls: FetchCall[] = [];

const suite = {
  id: 'geval-case-compiler-suite',
  title: 'G-Eval natural language case compiler',
  scenario_id: 'python-list-indexerror',
  method_source: 'G-Eval 2023',
  metric_ids: ['task_success', 'process_compliance'],
  command: {
    label: 'python3 scripts/run_harness_case.py',
    allowlisted: true,
  },
  pass_criteria: ['exit_code == 0', 'evidence_rows >= 10'],
  cases: [
    {
      case_id: 'fixture-case-001',
      input: '为什么我的 list 报 IndexError？',
      expected_behavior: 'retrieve-first gate fires before direct answer',
      assertions: ['kg_path includes ErrorType:IndexError'],
    },
  ],
};

const secondSuite = {
  ...suite,
  id: 'ragas-grounding-suite',
  title: 'RAGAS context faithfulness relevance',
  scenario_id: 'python-rag-grounding',
  method_source: 'RAGAS 2024',
  pass_criteria: ['faithfulness >= 0.9'],
  cases: [],
};

function storedCase(status: 'pending' | 'confirmed' | 'deleted', overrides: Record<string, unknown> = {}) {
  return {
    case_id: `${status}-case-001`,
    suite_id: suite.id,
    scenario_id: suite.scenario_id,
    status,
    natural_language_request: `Compile ${status} behavior for list IndexError`,
    case_json: { expected_behavior: `${status} behavior` },
    validator_errors: [],
    model: 'gpt-5',
    llm_used: true,
    llm_fallback: false,
    created_at: '2026-07-09T08:00:00Z',
    ...overrides,
  };
}

function createResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

function installHarnessFetch(options?: {
  cases?: {
    pending?: ReturnType<typeof storedCase>[];
    confirmed?: ReturnType<typeof storedCase>[];
    deleted?: ReturnType<typeof storedCase>[];
  };
  compileCase?: ReturnType<typeof storedCase>;
  confirmCase?: ReturnType<typeof storedCase>;
  deleteCase?: ReturnType<typeof storedCase>;
}) {
  const cases = {
    pending: options?.cases?.pending ?? [],
    confirmed: options?.cases?.confirmed ?? [],
    deleted: options?.cases?.deleted ?? [],
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url === '/api/harness/suites') {
        return createResponse({
          suites: [suite],
          runs: [
            {
              id: 'run-001',
              suite_id: suite.id,
              status: 'passed',
              created_at_beijing: '2026-07-09T15:30:00+08:00',
              exit_code: 0,
              metrics: { task_success: 1 },
              log_path: 'eval/harness_logs/2026-07-09/run-001.json',
            },
          ],
        });
      }

      if (url === '/api/harness/cases/compile' && init?.method === 'POST') {
        return createResponse({
          case:
            options?.compileCase ??
            storedCase('pending', {
              case_id: 'pending-case-compiled',
              natural_language_request: 'Student asks why list[2] fails for length 2',
            }),
        });
      }

      if (url === '/api/harness/cases/pending-case-001/confirm' && init?.method === 'POST') {
        return createResponse({
          case:
            options?.confirmCase ??
            storedCase('confirmed', {
              case_id: 'pending-case-001',
              natural_language_request: 'Compile pending behavior for list IndexError',
              confirmed_at: '2026-07-09T09:00:00Z',
            }),
        });
      }

      if (
        (url === '/api/harness/cases/pending-case-001' || url === '/api/harness/cases/confirmed-case-001') &&
        init?.method === 'DELETE'
      ) {
        return createResponse({
          case:
            options?.deleteCase ??
            storedCase('deleted', {
              case_id: url.endsWith('confirmed-case-001') ? 'confirmed-case-001' : 'pending-case-001',
              natural_language_request: 'Deleted stored case',
              deleted_at: '2026-07-09T10:00:00Z',
            }),
        });
      }

      if (url.startsWith('/api/harness/cases?')) {
        const requestURL = new URL(url, 'http://localhost');
        const status = requestURL.searchParams.get('status') ?? 'active';
        if (status === 'pending') {
          return createResponse({ cases: cases.pending });
        }
        if (status === 'confirmed') {
          return createResponse({ cases: cases.confirmed });
        }
        if (status === 'deleted') {
          return createResponse({ cases: cases.deleted });
        }
        return createResponse({ cases: [...cases.pending, ...cases.confirmed] });
      }

      if (url === '/api/harness/run' && init?.method === 'POST') {
        return createResponse({
          run: {
            id: 'run-002',
            suite_id: suite.id,
            case_id: 'confirmed-case-001',
            status: 'passed',
            created_at_beijing: '2026-07-09T15:40:00+08:00',
            exit_code: 0,
            metrics: { task_success: 1 },
            log_path: 'eval/harness_logs/2026-07-09/run-002.json',
          },
        });
      }

      return createResponse({ error: `unexpected_url:${url}` }, false);
    }),
  );
}

beforeEach(() => {
  fetchCalls.length = 0;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders compiler textarea and AI Compile button after load', async () => {
  installHarnessFetch();

  const { container } = render(<HarnessPage />);

  expect(await screen.findByRole('textbox', { name: /Natural-language requirement/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /AI Compile/i })).toBeInTheDocument();
  expect(container.querySelector('.harness-page.harness-page-fixed')).toBeInTheDocument();
  expect(container.querySelector('.harness-workbench')).toBeInTheDocument();
});

test('renders header status and required metric strip above the workbench', async () => {
  installHarnessFetch({
    cases: {
      pending: [storedCase('pending')],
      confirmed: [storedCase('confirmed')],
      deleted: [],
    },
  });

  const { container } = render(<HarnessPage />);

  await screen.findAllByText('pending-case-001');

  const header = container.querySelector('.harness-compact-header');
  expect(header).toBeInTheDocument();
  expect(within(header as HTMLElement).getByText('Case management workbench / 用例管理工作台')).toBeInTheDocument();
  expect(within(header as HTMLElement).getByText(`Selected suite / 当前套件 ${suite.id}`)).toBeInTheDocument();
  expect(within(header as HTMLElement).getByText('Selected case status / 当前用例状态 pending')).toBeInTheDocument();
  expect(within(header as HTMLElement).getByRole('button', { name: /Run confirmed case/i })).toBeDisabled();
  expect(within(header as HTMLElement).getByRole('button', { name: /Run suite/i })).toBeInTheDocument();

  const metricStrip = container.querySelector('.harness-metric-strip');
  expect(metricStrip).toBeInTheDocument();
  const metricCells = Array.from(metricStrip?.querySelectorAll('.harness-metric') ?? []);
  expect(metricCells).toHaveLength(4);
  expect(within(metricCells[0] as HTMLElement).getByText('Suites / 套件数')).toBeInTheDocument();
  expect(within(metricCells[0] as HTMLElement).getByText('1')).toBeInTheDocument();
  expect(within(metricCells[1] as HTMLElement).getByText('Active cases / 活跃用例')).toBeInTheDocument();
  expect(within(metricCells[1] as HTMLElement).getByText('2')).toBeInTheDocument();
  expect(within(metricCells[2] as HTMLElement).getByText('Pending cases / 待确认用例')).toBeInTheDocument();
  expect(within(metricCells[2] as HTMLElement).getByText('1')).toBeInTheDocument();
  expect(within(metricCells[3] as HTMLElement).getByText('Latest run / 最新运行')).toBeInTheDocument();
  expect(within(metricCells[3] as HTMLElement).getByText('passed')).toBeInTheDocument();

  const children = Array.from(container.querySelector('.harness-page')?.children ?? []);
  expect(children[0]).toHaveClass('harness-compact-header');
  expect(children[1]).toHaveClass('harness-metric-strip');
  expect(children[2]).toHaveClass('harness-workbench');
});

test('uses left navigator, center inspection, and right compiler/run log layout hooks', async () => {
  installHarnessFetch({ cases: { pending: [storedCase('pending')], confirmed: [], deleted: [] } });

  const { container } = render(<HarnessPage />);

  await screen.findAllByText('pending-case-001');

  const left = container.querySelector('.harness-left-column');
  const center = container.querySelector('.harness-detail-column');
  const right = container.querySelector('.harness-ops-column');

  expect(left).toBeInTheDocument();
  expect(center).toBeInTheDocument();
  expect(right).toBeInTheDocument();

  expect(within(left as HTMLElement).getByText('Suites / 套件')).toBeInTheDocument();
  expect(within(left as HTMLElement).getByRole('button', { name: 'Pending / 待确认' })).toBeInTheDocument();
  expect(within(left as HTMLElement).getAllByText('pending-case-001').length).toBeGreaterThan(0);
  expect(within(left as HTMLElement).getByRole('button', { name: /G-Eval natural language case compiler/i })).toHaveAttribute(
    'aria-current',
    'true',
  );
  expect(within(left as HTMLElement).getByRole('button', { name: /pending-case-001/i })).toHaveAttribute(
    'aria-current',
    'true',
  );
  expect(within(left as HTMLElement).queryByRole('textbox', { name: /Natural-language requirement/i })).not.toBeInTheDocument();

  expect(within(center as HTMLElement).getByText('Selected suite and case / 当前套件与用例')).toBeInTheDocument();
  expect(within(center as HTMLElement).getByText('Pass criteria / 通过条件')).toBeInTheDocument();
  expect(within(center as HTMLElement).getByText('evidence_rows >= 10')).toBeInTheDocument();
  expect(within(center as HTMLElement).getByText('Compiled case JSON / 编译后 JSON')).toBeInTheDocument();
  expect(within(center as HTMLElement).queryByRole('textbox', { name: /Natural-language requirement/i })).not.toBeInTheDocument();

  expect(within(right as HTMLElement).getByRole('textbox', { name: /Natural-language requirement/i })).toBeInTheDocument();
  expect(within(right as HTMLElement).getByText('Run log / 运行日志')).toBeInTheDocument();
  expect(within(right as HTMLElement).queryByRole('button', { name: /^Pending/i })).not.toBeInTheDocument();
});

test('ignores delayed case responses from a previously selected suite', async () => {
  let resolveOldPending: (response: Response) => void = () => undefined;
  const oldPendingResponse = new Promise<Response>((resolve) => {
    resolveOldPending = resolve;
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push({ url });

      if (url === '/api/harness/suites') {
        return createResponse({ suites: [suite, secondSuite], runs: [] });
      }

      if (url.startsWith('/api/harness/cases?')) {
        const requestURL = new URL(url, 'http://localhost');
        const suiteID = requestURL.searchParams.get('suite_id');
        const status = requestURL.searchParams.get('status');

        if (suiteID === suite.id && status === 'pending') {
          return oldPendingResponse;
        }
        if (suiteID === secondSuite.id && status === 'pending') {
          return createResponse({
            cases: [
              storedCase('pending', {
                case_id: 'suite-b-pending-case',
                suite_id: secondSuite.id,
                scenario_id: secondSuite.scenario_id,
                natural_language_request: 'Suite B active case',
              }),
            ],
          });
        }
        return createResponse({ cases: [] });
      }

      return createResponse({ error: `unexpected_url:${url}` }, false);
    }),
  );

  render(<HarnessPage />);

  fireEvent.click(await screen.findByRole('button', { name: /RAGAS context faithfulness relevance/i }));
  await screen.findAllByText('suite-b-pending-case');

  resolveOldPending(
    createResponse({
      cases: [
        storedCase('pending', {
          case_id: 'suite-a-stale-case',
          suite_id: suite.id,
          natural_language_request: 'Suite A stale case',
        }),
      ],
    }),
  );

  await waitFor(() => expect(screen.getByText(`Selected suite / 当前套件 ${secondSuite.id}`)).toBeInTheDocument());
  expect(screen.getAllByText('suite-b-pending-case').length).toBeGreaterThan(0);
  expect(screen.queryByText('suite-a-stale-case')).not.toBeInTheDocument();
});

test('ignores delayed compile response after switching suites', async () => {
  let resolveCompile: (response: Response) => void = () => undefined;
  const compileResponse = new Promise<Response>((resolve) => {
    resolveCompile = resolve;
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url === '/api/harness/suites') {
        return createResponse({ suites: [suite, secondSuite], runs: [] });
      }

      if (url === '/api/harness/cases/compile' && init?.method === 'POST') {
        return compileResponse;
      }

      if (url.startsWith('/api/harness/cases?')) {
        return createResponse({ cases: [] });
      }

      return createResponse({ error: `unexpected_url:${url}` }, false);
    }),
  );

  render(<HarnessPage />);

  const request = await screen.findByRole('textbox', { name: /Natural-language requirement/i });
  fireEvent.change(request, { target: { value: 'Compile suite A stale behavior' } });
  fireEvent.click(screen.getByRole('button', { name: /AI Compile/i }));
  fireEvent.click(await screen.findByRole('button', { name: /RAGAS context faithfulness relevance/i }));

  resolveCompile(
    createResponse({
      case: storedCase('pending', {
        case_id: 'suite-a-compiled-stale',
        suite_id: suite.id,
        natural_language_request: 'Suite A compiled stale response',
      }),
    }),
  );

  await waitFor(() => expect(screen.getByText(`Selected suite / 当前套件 ${secondSuite.id}`)).toBeInTheDocument());
  expect(screen.queryByText('suite-a-compiled-stale')).not.toBeInTheDocument();
});

test('ignores delayed compile errors after switching suites', async () => {
  let resolveCompile: (response: Response) => void = () => undefined;
  const compileResponse = new Promise<Response>((resolve) => {
    resolveCompile = resolve;
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url === '/api/harness/suites') {
        return createResponse({ suites: [suite, secondSuite], runs: [] });
      }

      if (url === '/api/harness/cases/compile' && init?.method === 'POST') {
        return compileResponse;
      }

      if (url.startsWith('/api/harness/cases?')) {
        return createResponse({ cases: [] });
      }

      return createResponse({ error: `unexpected_url:${url}` }, false);
    }),
  );

  render(<HarnessPage />);

  const request = await screen.findByRole('textbox', { name: /Natural-language requirement/i });
  fireEvent.change(request, { target: { value: 'Compile suite A failing behavior' } });
  fireEvent.click(screen.getByRole('button', { name: /AI Compile/i }));
  fireEvent.click(await screen.findByRole('button', { name: /RAGAS context faithfulness relevance/i }));

  resolveCompile(createResponse({ error: 'old_compile_failed' }, false));

  await waitFor(() => expect(screen.getByText(`Selected suite / 当前套件 ${secondSuite.id}`)).toBeInTheDocument());
  expect(screen.queryByText('old_compile_failed')).not.toBeInTheDocument();
});

test('reload replacing the selected suite clears stale cases and loads the new suite', async () => {
  let suitesRequestCount = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push({ url });

      if (url === '/api/harness/suites') {
        suitesRequestCount += 1;
        if (suitesRequestCount === 1) {
          return createResponse({ suites: [suite], runs: [] });
        }
        return createResponse({ suites: [secondSuite], runs: [] });
      }

      if (url.startsWith('/api/harness/cases?')) {
        const requestURL = new URL(url, 'http://localhost');
        const suiteID = requestURL.searchParams.get('suite_id');
        const status = requestURL.searchParams.get('status');
        if (suiteID === suite.id && status === 'pending') {
          return createResponse({
            cases: [
              storedCase('pending', {
                case_id: 'suite-a-before-reload',
                suite_id: suite.id,
                natural_language_request: 'Suite A case before reload',
              }),
            ],
          });
        }
        if (suiteID === secondSuite.id && status === 'pending') {
          return createResponse({
            cases: [
              storedCase('pending', {
                case_id: 'suite-b-after-reload',
                suite_id: secondSuite.id,
                scenario_id: secondSuite.scenario_id,
                natural_language_request: 'Suite B case after reload',
              }),
            ],
          });
        }
        return createResponse({ cases: [] });
      }

      return createResponse({ error: `unexpected_url:${url}` }, false);
    }),
  );

  render(<HarnessPage />);

  await screen.findAllByText('suite-a-before-reload');
  fireEvent.click(screen.getByRole('button', { name: /Reload \/ 刷新/i }));

  await waitFor(() => expect(screen.getByText(`Selected suite / 当前套件 ${secondSuite.id}`)).toBeInTheDocument());
  await screen.findAllByText('suite-b-after-reload');
  expect(screen.queryByText('suite-a-before-reload')).not.toBeInTheDocument();
});

test('API helpers reject malformed success payloads', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/harness/cases/compile') {
        return createResponse({});
      }
      if (url === '/api/harness/cases/malformed-case/confirm') {
        return createResponse({});
      }
      if (url === '/api/harness/cases/malformed-case') {
        return createResponse({});
      }
      if (url === '/api/harness/run') {
        return createResponse({});
      }
      return createResponse({ error: `unexpected_url:${url}` }, false);
    }),
  );

  await expect(
    compileHarnessCase({
      suite_id: suite.id,
      scenario_id: suite.scenario_id,
      natural_language_request: 'Compile missing case response',
    }),
  ).rejects.toThrow('harness_case_compile_failed');
  await expect(confirmHarnessCase('malformed-case')).rejects.toThrow('harness_case_confirm_failed');
  await expect(deleteHarnessCase('malformed-case')).rejects.toThrow('harness_case_delete_failed');
  await expect(runHarness({ suite_id: suite.id, case_id: 'confirmed-case-001' })).rejects.toThrow('harness_run_failed');
});

test('API helpers reject malformed inner case and run payloads', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/harness/cases/compile') {
        return createResponse({ case: {} });
      }
      if (url === '/api/harness/cases/malformed-case/confirm') {
        return createResponse({ case: {} });
      }
      if (url === '/api/harness/cases/malformed-case') {
        return createResponse({ case: {} });
      }
      if (url === '/api/harness/run') {
        return createResponse({ run: {} });
      }
      return createResponse({ error: `unexpected_url:${url}` }, false);
    }),
  );

  await expect(
    compileHarnessCase({
      suite_id: suite.id,
      scenario_id: suite.scenario_id,
      natural_language_request: 'Compile malformed inner case',
    }),
  ).rejects.toThrow('harness_case_compile_failed');
  await expect(confirmHarnessCase('malformed-case')).rejects.toThrow('harness_case_confirm_failed');
  await expect(deleteHarnessCase('malformed-case')).rejects.toThrow('harness_case_delete_failed');
  await expect(runHarness({ suite_id: suite.id, case_id: 'confirmed-case-001' })).rejects.toThrow('harness_run_failed');
});

test('compile request posts correct payload and shows returned pending case', async () => {
  installHarnessFetch();

  render(<HarnessPage />);

  const request = await screen.findByRole('textbox', { name: /Natural-language requirement/i });
  fireEvent.change(request, { target: { value: 'Student asks why list[2] fails for length 2' } });
  fireEvent.click(screen.getByRole('button', { name: /AI Compile/i }));

  await waitFor(() => expect(screen.getAllByText('pending-case-compiled').length).toBeGreaterThan(0));
  expect(screen.getAllByText('Student asks why list[2] fails for length 2').length).toBeGreaterThan(0);

  const compileCall = fetchCalls.find((call) => call.url === '/api/harness/cases/compile');
  expect(compileCall?.init?.method).toBe('POST');
  expect(JSON.parse(String(compileCall?.init?.body))).toEqual({
    suite_id: suite.id,
    scenario_id: suite.scenario_id,
    natural_language_request: 'Student asks why list[2] fails for length 2',
  });
});

test('confirm action posts to confirm endpoint and selected case becomes confirmed', async () => {
  installHarnessFetch({ cases: { pending: [storedCase('pending')], confirmed: [], deleted: [] } });

  render(<HarnessPage />);

  await screen.findAllByText('pending-case-001');
  fireEvent.click(screen.getByRole('button', { name: /Confirm case/i }));

  await waitFor(() => {
    expect(fetchCalls.some((call) => call.url === '/api/harness/cases/pending-case-001/confirm')).toBe(true);
  });
  expect(screen.getByRole('button', { name: /^Confirmed cases/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('pending-case-001').length).toBeGreaterThan(0);
  expect(screen.getByText(/Status \/ 状态 confirmed/)).toBeInTheDocument();
});

test('delete action calls DELETE and moves deleted case out of active tabs while deleted tab can show it', async () => {
  installHarnessFetch({
    cases: {
      pending: [],
      confirmed: [storedCase('confirmed')],
      deleted: [
        storedCase('deleted', {
          case_id: 'confirmed-case-001',
          natural_language_request: 'Compile confirmed behavior for list IndexError',
        }),
      ],
    },
    deleteCase: storedCase('deleted', {
      case_id: 'confirmed-case-001',
      natural_language_request: 'Compile confirmed behavior for list IndexError',
    }),
  });

  render(<HarnessPage />);

  fireEvent.click(await screen.findByRole('button', { name: /^Confirmed cases/i }));
  await screen.findAllByText('confirmed-case-001');
  fireEvent.click(screen.getByRole('button', { name: /Delete case/i }));

  await waitFor(() => {
    expect(fetchCalls.some((call) => call.url === '/api/harness/cases/confirmed-case-001' && call.init?.method === 'DELETE')).toBe(true);
  });
  expect(screen.queryByText('confirmed-case-001')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Deleted / 已删除' }));

  await waitFor(() => expect(screen.getAllByText('confirmed-case-001').length).toBeGreaterThan(0));
  expect(screen.getByText(/Status \/ 状态 deleted/)).toBeInTheDocument();
});

test('run button is disabled for pending and deleted cases and posts suite_id plus case_id for confirmed', async () => {
  installHarnessFetch({
    cases: {
      pending: [storedCase('pending')],
      confirmed: [storedCase('confirmed')],
      deleted: [storedCase('deleted')],
    },
  });

  render(<HarnessPage />);

  await screen.findAllByText('pending-case-001');
  expect(screen.getByRole('button', { name: /Run confirmed case/i })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /^Confirmed cases/i }));
  await screen.findAllByText('confirmed-case-001');
  expect(screen.getByRole('button', { name: /Run confirmed case/i })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: /Run confirmed case/i }));

  await waitFor(() => expect(screen.getByText('run-002')).toBeInTheDocument());
  const runCall = fetchCalls.find((call) => call.url === '/api/harness/run' && call.init?.method === 'POST');
  expect(JSON.parse(String(runCall?.init?.body))).toEqual({
    suite_id: suite.id,
    case_id: 'confirmed-case-001',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Deleted / 已删除' }));
  const deletedPane = await screen.findByRole('region', { name: /AI-managed cases/i });
  await within(deletedPane).findByText('deleted-case-001');
  expect(screen.getByRole('button', { name: /Run confirmed case/i })).toBeDisabled();
});
