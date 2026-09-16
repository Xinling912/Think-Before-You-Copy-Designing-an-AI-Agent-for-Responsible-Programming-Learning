import { CheckOutlined, DeleteOutlined, PlayCircleOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  compileHarnessCase,
  confirmHarnessCase,
  deleteHarnessCase,
  getHarnessCases,
  getHarnessSuites,
  HarnessRun,
  HarnessStoredCase,
  HarnessSuite,
  runHarness,
} from '../../api/harness';

type CaseTab = 'pending' | 'confirmed' | 'deleted';

type CaseBuckets = Record<CaseTab, HarnessStoredCase[]>;

const CASE_TABS: Array<{ id: CaseTab; label: string }> = [
  { id: 'pending', label: 'Pending / 待确认' },
  { id: 'confirmed', label: 'Confirmed cases / 已确认用例' },
  { id: 'deleted', label: 'Deleted / 已删除' },
];

const emptyCases: CaseBuckets = {
  pending: [],
  confirmed: [],
  deleted: [],
};

const emptyLoadedStatuses: Record<CaseTab, boolean> = {
  pending: false,
  confirmed: false,
  deleted: false,
};

export default function HarnessPage() {
  const [suites, setSuites] = useState<HarnessSuite[]>([]);
  const [runs, setRuns] = useState<HarnessRun[]>([]);
  const [casesByStatus, setCasesByStatus] = useState<CaseBuckets>(emptyCases);
  const [loadedStatuses, setLoadedStatuses] = useState<Record<CaseTab, boolean>>(emptyLoadedStatuses);
  const [selectedSuiteID, setSelectedSuiteID] = useState('');
  const [selectedCaseID, setSelectedCaseID] = useState('');
  const [caseTab, setCaseTab] = useState<CaseTab>('pending');
  const [requestText, setRequestText] = useState('');
  const [loading, setLoading] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const selectedSuiteIDRef = useRef('');

  const selectedSuite = useMemo(
    () => suites.find((suite) => suite.id === selectedSuiteID) ?? suites[0],
    [selectedSuiteID, suites],
  );
  const currentCases = casesByStatus[caseTab];
  const selectedCase = useMemo(
    () => currentCases.find((item) => item.case_id === selectedCaseID) ?? currentCases[0],
    [currentCases, selectedCaseID],
  );
  const selectedRuns = useMemo(
    () => runs.filter((run) => run.suite_id === selectedSuite?.id),
    [runs, selectedSuite?.id],
  );
  const canRunCase = selectedCase?.status === 'confirmed';
  const activeCaseCount = casesByStatus.pending.length + casesByStatus.confirmed.length;
  const latestRunStatus = selectedRuns[0]?.status ?? 'none';

  const resetCaseState = useCallback(() => {
    setCasesByStatus(emptyCases);
    setLoadedStatuses(emptyLoadedStatuses);
    setSelectedCaseID('');
    setCaseTab('pending');
  }, []);

  const loadCases = useCallback(
    async (suiteID: string, status: CaseTab, preferredCaseID = '', shouldSelect = true) => {
      if (!suiteID) {
        resetCaseState();
        return;
      }
      setCasesLoading(true);
      setError('');
      try {
        const data = await getHarnessCases({ suite_id: suiteID, status });
        if (selectedSuiteIDRef.current !== suiteID) {
          return;
        }
        const nextCases = Array.isArray(data.cases) ? data.cases : [];
        setCasesByStatus((current) => ({ ...current, [status]: nextCases }));
        setLoadedStatuses((current) => ({ ...current, [status]: true }));
        if (shouldSelect) {
          setSelectedCaseID((current) => {
            const preferred = preferredCaseID && nextCases.some((item) => item.case_id === preferredCaseID);
            if (preferred) {
              return preferredCaseID;
            }
            const existing = current && nextCases.some((item) => item.case_id === current);
            return existing ? current : nextCases[0]?.case_id ?? '';
          });
        }
      } catch (event) {
        if (selectedSuiteIDRef.current !== suiteID) {
          return;
        }
        setError(event instanceof Error ? event.message : 'harness_cases_lookup_failed');
      } finally {
        setCasesLoading(false);
      }
    },
    [resetCaseState],
  );

  const loadHarness = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getHarnessSuites();
      const nextSuites = Array.isArray(data.suites) ? data.suites : [];
      const currentSuiteID = selectedSuiteIDRef.current;
      const nextSuiteID = nextSuites.some((suite) => suite.id === currentSuiteID)
        ? currentSuiteID
        : nextSuites[0]?.id || '';
      setSuites(nextSuites);
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      if (nextSuiteID !== currentSuiteID) {
        resetCaseState();
      }
      selectedSuiteIDRef.current = nextSuiteID;
      setSelectedSuiteID(nextSuiteID);
    } catch (event) {
      setError(event instanceof Error ? event.message : 'harness_suites_lookup_failed');
    } finally {
      setLoading(false);
    }
  }, [resetCaseState]);

  useEffect(() => {
    void loadHarness();
  }, [loadHarness]);

  useEffect(() => {
    if (selectedSuite?.id) {
      if (caseTab === 'pending' && !loadedStatuses.confirmed) {
        void loadCases(selectedSuite.id, 'confirmed', '', false);
      }
      if (caseTab === 'confirmed' && !loadedStatuses.pending) {
        void loadCases(selectedSuite.id, 'pending', '', false);
      }
      if (!loadedStatuses[caseTab]) {
        void loadCases(selectedSuite.id, caseTab);
      }
    }
  }, [caseTab, loadCases, loadedStatuses, selectedSuite?.id]);

  async function compileCase() {
    if (!selectedSuite || !requestText.trim()) {
      return;
    }
    const suiteID = selectedSuite.id;
    setCompiling(true);
    setError('');
    try {
      const data = await compileHarnessCase({
        suite_id: suiteID,
        scenario_id: selectedSuite.scenario_id,
        natural_language_request: requestText.trim(),
      });
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      const nextCase = data.case;
      setCasesByStatus((current) => ({
        ...current,
        pending: upsertCase(current.pending, nextCase),
      }));
      setLoadedStatuses((current) => ({ ...current, pending: true }));
      setCaseTab('pending');
      setSelectedCaseID(nextCase.case_id);
      setRequestText('');
    } catch (event) {
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      setError(event instanceof Error ? event.message : 'harness_case_compile_failed');
    } finally {
      setCompiling(false);
    }
  }

  async function confirmCase() {
    if (!selectedCase || selectedCase.status !== 'pending') {
      return;
    }
    const suiteID = selectedSuite?.id ?? '';
    const caseID = selectedCase.case_id;
    setConfirming(true);
    setError('');
    try {
      const data = await confirmHarnessCase(caseID);
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      const nextCase = data.case;
      setCasesByStatus((current) => ({
        ...current,
        pending: current.pending.filter((item) => item.case_id !== caseID),
        confirmed: upsertCase(current.confirmed, nextCase),
      }));
      setLoadedStatuses((current) => ({ ...current, pending: true, confirmed: true }));
      setCaseTab('confirmed');
      setSelectedCaseID(nextCase.case_id);
    } catch (event) {
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      setError(event instanceof Error ? event.message : 'harness_case_confirm_failed');
    } finally {
      setConfirming(false);
    }
  }

  async function deleteCase() {
    if (!selectedSuite || !selectedCase) {
      return;
    }
    const suiteID = selectedSuite.id;
    const caseID = selectedCase.case_id;
    setDeleting(true);
    setError('');
    try {
      const data = await deleteHarnessCase(caseID);
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      const nextCase = data.case;
      setCasesByStatus((current) => ({
        pending: current.pending.filter((item) => item.case_id !== caseID),
        confirmed: current.confirmed.filter((item) => item.case_id !== caseID),
        deleted: upsertCase(current.deleted, nextCase),
      }));
      setLoadedStatuses((current) => ({ ...current, pending: true, confirmed: true, deleted: true }));
      setSelectedCaseID('');
    } catch (event) {
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      setError(event instanceof Error ? event.message : 'harness_case_delete_failed');
    } finally {
      setDeleting(false);
    }
  }

  async function runSelectedCase() {
    if (!selectedSuite || !selectedCase || selectedCase.status !== 'confirmed') {
      return;
    }
    const suiteID = selectedSuite.id;
    const caseID = selectedCase.case_id;
    setRunning(true);
    setError('');
    try {
      const data = await runHarness({ suite_id: suiteID, case_id: caseID });
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      if (data.run) {
        setRuns((current) => [data.run, ...current]);
      }
    } catch (event) {
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      setError(event instanceof Error ? event.message : 'harness_run_failed');
    } finally {
      setRunning(false);
    }
  }

  async function runSelectedSuite() {
    if (!selectedSuite) {
      return;
    }
    const suiteID = selectedSuite.id;
    setRunning(true);
    setError('');
    try {
      const data = await runHarness({ suite_id: suiteID });
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      if (data.run) {
        setRuns((current) => [data.run, ...current]);
      }
    } catch (event) {
      if (selectedSuiteIDRef.current !== suiteID) {
        return;
      }
      setError(event instanceof Error ? event.message : 'harness_run_failed');
    } finally {
      setRunning(false);
    }
  }

  function selectSuite(suiteID: string) {
    selectedSuiteIDRef.current = suiteID;
    setSelectedSuiteID(suiteID);
    resetCaseState();
  }

  return (
    <main className="rea-page harness-page harness-page-fixed">
      <section className="rea-header harness-header harness-compact-header">
        <div>
          <div className="rea-kicker">Harness / 实验评估</div>
          <h1 className="rea-title">Case management workbench / 用例管理工作台</h1>
          <div className="harness-header-meta">
            <span>{`Selected suite / 当前套件 ${selectedSuite?.id ?? 'none'}`}</span>
            <span>{`Selected case status / 当前用例状态 ${selectedCase?.status ?? 'none'}`}</span>
          </div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={loadHarness} loading={loading}>
            Reload / 刷新
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={runSelectedCase}
            loading={running}
            type="primary"
            disabled={!canRunCase}
          >
            Run confirmed case / 运行已确认用例
          </Button>
          <Button icon={<PlayCircleOutlined />} onClick={runSelectedSuite} loading={running}>
            Run suite / 运行套件
          </Button>
        </Space>
      </section>

      <section className="harness-metric-strip">
        <div className="harness-metric">
          <span>Suites / 套件数</span>
          <strong>{suites.length}</strong>
        </div>
        <div className="harness-metric">
          <span>Active cases / 活跃用例</span>
          <strong>{activeCaseCount}</strong>
        </div>
        <div className="harness-metric">
          <span>Pending cases / 待确认用例</span>
          <strong>{casesByStatus.pending.length}</strong>
        </div>
        <div className="harness-metric">
          <span>Latest run / 最新运行</span>
          <strong>{latestRunStatus}</strong>
        </div>
      </section>

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <section className="harness-workbench">
        <section className="rea-panel harness-column harness-left-column harness-suite-list">
          <div className="harness-panel-heading">
            <h2 className="rea-panel-title">Suites and cases / 套件与用例</h2>
            <Tag color="blue">{suites.length}</Tag>
          </div>
          <div className="harness-scroll">
            <h3 className="harness-section-title">Suites / 套件</h3>
            {suites.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No harness suites / 暂无测试套件" />
            ) : (
              <div className="harness-suite-stack">
                {suites.map((suite) => (
                  <button
                    aria-current={suite.id === selectedSuite?.id ? 'true' : undefined}
                    className={`harness-suite-button ${suite.id === selectedSuite?.id ? 'selected' : ''}`}
                    key={suite.id}
                    onClick={() => selectSuite(suite.id)}
                    type="button"
                  >
                    <strong>{suite.title}</strong>
                    <span>{suite.id}</span>
                    <span>{suite.scenario_id}</span>
                    <Tag color="blue">{suite.method_source}</Tag>
                  </button>
                ))}
              </div>
            )}
            <StoredCases
              cases={currentCases}
              casesLoading={casesLoading}
              caseTab={caseTab}
              onSelectCase={setSelectedCaseID}
              onSelectTab={(nextTab) => {
                setCaseTab(nextTab);
                setSelectedCaseID('');
              }}
              selectedCase={selectedCase}
            />
          </div>
        </section>

        <section className="rea-panel harness-column harness-detail-column harness-case-room">
          <div className="harness-panel-heading">
            <h2 className="rea-panel-title">Selected suite and case / 当前套件与用例</h2>
            <Tag color={selectedSuite ? 'blue' : 'default'}>{selectedSuite?.id ?? 'none'}</Tag>
          </div>
          <div className="harness-scroll harness-case-scroll">
            {selectedSuite ? (
              <>
                <SuiteDetail suite={selectedSuite} />
                {selectedCase ? <CaseInspection item={selectedCase} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No stored case / 暂无托管用例" />}
                <div className="harness-action-row">
                  <Button
                    icon={<CheckOutlined />}
                    onClick={confirmCase}
                    loading={confirming}
                    disabled={selectedCase?.status !== 'pending'}
                  >
                    Confirm case / 确认用例
                  </Button>
                  <Button icon={<DeleteOutlined />} onClick={deleteCase} loading={deleting} disabled={!selectedCase} danger>
                    Delete case / 删除用例
                  </Button>
                </div>
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No suite selected / 未选择套件" />
            )}
          </div>
        </section>

        <section className="rea-panel harness-column harness-ops-column harness-run-log">
          <div className="harness-panel-heading">
            <h2 className="rea-panel-title">Compiler and run log / 编译与运行日志</h2>
            <Tag>{selectedCase?.status ?? 'none'}</Tag>
          </div>

          <div className="harness-scroll harness-ops-scroll">
            <section className="harness-compiler" aria-label="AI case compiler">
              <label className="harness-label" htmlFor="harness-compiler-request">
                Natural-language requirement / 自然语言要求
              </label>
              <textarea
                className="harness-textarea"
                id="harness-compiler-request"
                onChange={(event) => setRequestText(event.target.value)}
                rows={4}
                value={requestText}
              />
              <Button
                icon={<RobotOutlined />}
                loading={compiling}
                onClick={compileCase}
                type="primary"
                disabled={!requestText.trim()}
              >
                AI Compile / AI 编译
              </Button>
            </section>
            <section className="harness-detail-block harness-run-history">
              <h3>Run log / 运行日志</h3>
              {selectedRuns.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No runs for selected suite / 当前套件暂无日志" />
              ) : (
                <div className="harness-run-stack">
                  {selectedRuns.map((run) => (
                    <RunItem key={run.id} run={run} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

function StoredCases(props: {
  cases: HarnessStoredCase[];
  casesLoading: boolean;
  caseTab: CaseTab;
  onSelectCase: (caseID: string) => void;
  onSelectTab: (tab: CaseTab) => void;
  selectedCase?: HarnessStoredCase;
}) {
  return (
    <section className="harness-managed-cases" aria-label="AI-managed cases">
      <div className="harness-case-tabs" role="group" aria-label="Case lifecycle / 用例状态">
        {CASE_TABS.map((tab) => (
          <button
            aria-pressed={props.caseTab === tab.id}
            className={`harness-tab ${props.caseTab === tab.id ? 'selected' : ''}`}
            key={tab.id}
            onClick={() => props.onSelectTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {props.cases.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={props.casesLoading ? 'Loading cases / 正在加载用例' : 'No stored cases / 暂无托管用例'}
        />
      ) : (
        <div className="harness-case-stack">
          {props.cases.map((item) => (
            <button
              aria-current={item.case_id === props.selectedCase?.case_id ? 'true' : undefined}
              className={`harness-case-button ${item.case_id === props.selectedCase?.case_id ? 'selected' : ''}`}
              key={item.case_id}
              onClick={() => props.onSelectCase(item.case_id)}
              type="button"
            >
              <strong>{item.case_id}</strong>
              <span>{item.natural_language_request}</span>
              <span>{`Status / 状态 ${item.status}`}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SuiteDetail(props: { suite: HarnessSuite }) {
  const suite = props.suite;
  return (
    <div className="harness-detail-stack">
      <KeyValue label="Paper method / 论文方法" value={suite.method_source} />
      <KeyValue label="Scenario / 场景" value={suite.scenario_id} />
      <KeyValue label="Command / 命令" value={suite.command?.label ?? 'none'} />
      <KeyValue label="Allowlisted / 白名单" value={suite.command?.allowlisted ? 'true' : 'false'} />

      <section className="harness-detail-block">
        <h3>Pass criteria / 通过条件</h3>
        {(suite.pass_criteria ?? []).length === 0 ? (
          <Typography.Text type="secondary">No pass criteria / 暂无通过条件</Typography.Text>
        ) : (
          <div className="harness-criteria-stack">
            {(suite.pass_criteria ?? []).map((criterion) => (
              <Typography.Text key={criterion}>{criterion}</Typography.Text>
            ))}
          </div>
        )}
      </section>

      <section className="harness-detail-block">
        <h3>Source suite fixture cases / 源套件固定用例</h3>
        {(suite.cases ?? []).length === 0 ? (
          <Typography.Text type="secondary">No fixture cases / 暂无固定用例</Typography.Text>
        ) : (
          <div className="harness-fixture-stack">
            {(suite.cases ?? []).map((item) => (
              <article className="harness-case" key={item.case_id}>
                <Typography.Text strong>{item.case_id}</Typography.Text>
                <Typography.Text>{item.input}</Typography.Text>
                <Typography.Text type="secondary">{item.expected_behavior}</Typography.Text>
                <Space wrap size={[6, 6]}>
                  {(item.assertions ?? []).map((assertion) => (
                    <Tag key={assertion}>{assertion}</Tag>
                  ))}
                </Space>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CaseInspection(props: { item: HarnessStoredCase }) {
  const item = props.item;
  return (
    <section className="harness-detail-block harness-inspection">
      <h3>{item.case_id}</h3>
      <KeyValue label="Status / 状态" value={item.status} />
      <KeyValue label="Suite / 套件" value={item.suite_id} />
      <KeyValue label="Scenario / 场景" value={item.scenario_id} />
      <KeyValue label="Model / 模型" value={item.model || 'none'} />
      <KeyValue label="LLM used / 调用模型" value={item.llm_used ? 'true' : 'false'} />
      <KeyValue label="Fallback / 兜底" value={item.llm_fallback ? 'true' : 'false'} />
      <KeyValue label="Created / 创建时间" value={item.created_at} />
      {item.confirmed_at ? <KeyValue label="Confirmed / 确认时间" value={item.confirmed_at} /> : null}
      {item.deleted_at ? <KeyValue label="Deleted / 删除时间" value={item.deleted_at} /> : null}
      <div className="harness-json-block">
        <span>Natural-language request / 自然语言请求</span>
        <pre>{item.natural_language_request}</pre>
      </div>
      <div className="harness-json-block">
        <span>Compiled case JSON / 编译后 JSON</span>
        <pre>{JSON.stringify(item.case_json ?? {}, null, 2)}</pre>
      </div>
      {item.validator_errors?.length ? (
        <div className="harness-json-block">
          <span>Validator errors / 校验错误</span>
          <pre>{item.validator_errors.join('\n')}</pre>
        </div>
      ) : null}
    </section>
  );
}

function RunItem(props: { run: HarnessRun }) {
  const run = props.run;
  return (
    <article className="harness-run-item">
      <Space wrap size={[6, 6]}>
        <Tag color={run.status === 'passed' ? 'green' : run.status === 'failed' ? 'red' : 'blue'}>{run.status}</Tag>
        <Typography.Text strong>{run.id}</Typography.Text>
        <Typography.Text>{run.created_at_beijing}</Typography.Text>
        <Typography.Text>{`exit ${run.exit_code ?? 'none'}`}</Typography.Text>
      </Space>
      {run.case_id ? <Typography.Text type="secondary">{`case ${run.case_id}`}</Typography.Text> : null}
      <Typography.Text type="secondary">{run.log_path ?? 'no log path'}</Typography.Text>
      <Typography.Text type="secondary">{metricsSummary(run.metrics)}</Typography.Text>
    </article>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="harness-kv">
      <span>{props.label}</span>
      <strong>{props.value || 'none'}</strong>
    </div>
  );
}

function upsertCase(items: HarnessStoredCase[], nextCase: HarnessStoredCase) {
  return [nextCase, ...items.filter((item) => item.case_id !== nextCase.case_id)];
}

function metricsSummary(metrics?: Record<string, unknown>) {
  if (!metrics) {
    return 'no metrics';
  }
  return Object.entries(metrics)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' / ');
}
