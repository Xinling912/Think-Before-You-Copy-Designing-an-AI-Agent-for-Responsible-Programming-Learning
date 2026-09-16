import { ReloadOutlined } from '@ant-design/icons';
import { Button, Empty, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

type SessionRecord = {
  id: string;
  scenario?: string;
  status?: string;
  updated_at?: string;
  created_at?: string;
  latest_message_at?: string;
  message_count?: number;
};

type ReviewMessage = {
  id?: string;
  role?: string;
  content?: string;
  created_at?: string;
};

type SessionDetail = {
  session?: SessionRecord;
  messages?: ReviewMessage[];
  evidence_events?: Array<{
    id?: number;
    event_type?: string;
    payload?: Record<string, unknown>;
    created_at?: string;
  }>;
  evidence?: Record<string, unknown> | Array<Record<string, unknown>>;
};

function getSessions(payload: unknown): SessionRecord[] {
  if (Array.isArray(payload)) {
    return payload as SessionRecord[];
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { sessions?: unknown }).sessions)) {
    return (payload as { sessions: SessionRecord[] }).sessions;
  }
  return [];
}

function formatEvidenceValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'none';
  }
  if (Array.isArray(value)) {
    return value.map(formatEvidenceValue).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export default function SessionReviewPage() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionID, setSelectedSessionID] = useState('');
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [resettingBudget, setResettingBudget] = useState(false);
  const [error, setError] = useState('');

  const evidencePayloads = useMemo(() => {
    if (detail?.evidence_events?.length) {
      return detail.evidence_events.map((event) => ({
        id: String(event.id ?? 'event'),
        eventType: event.event_type ?? 'ai_step',
        createdAt: event.created_at ?? '',
        payload: event.payload ?? {},
      }));
    }
    const evidence = detail?.evidence;
    if (!evidence) {
      return [];
    }
    if (Array.isArray(evidence)) {
      return evidence.map((payload, index) => ({
        id: String(index + 1),
        eventType: 'ai_step',
        createdAt: '',
        payload,
      }));
    }
    return [
      {
        id: 'latest',
        eventType: 'ai_step',
        createdAt: '',
        payload: evidence,
      },
    ];
  }, [detail]);

  async function loadSessions() {
    setLoadingSessions(true);
    setError('');
    try {
      const response = await fetch('/api/sessions', {
        headers: { 'X-REA-Admin-Access': '1' },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? '会话列表请求失败 / Session list request failed');
      }
      const loadedSessions = getSessions(data);
      setSessions(loadedSessions);
      if (!selectedSessionID && loadedSessions[0]?.id) {
        await loadSessionDetail(loadedSessions[0].id);
      }
    } catch (event) {
      setError(event instanceof Error ? event.message : '会话列表请求失败 / Session list request failed');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadSessionDetail(sessionID: string) {
    setSelectedSessionID(sessionID);
    setLoadingDetail(true);
    setError('');
    try {
      const [response, evidenceResponse] = await Promise.all([
        fetch(`/api/session/${encodeURIComponent(sessionID)}`, {
          headers: { 'X-REA-Admin-Access': '1' },
        }),
        fetch(`/api/session/${encodeURIComponent(sessionID)}/evidence`, {
          headers: { 'X-REA-Admin-Access': '1' },
        }),
      ]);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? '会话详情请求失败 / Session detail request failed');
      }
      const evidenceData = await evidenceResponse.json();
      if (!evidenceResponse.ok) {
        throw new Error(evidenceData?.error ?? 'evidence_lookup_failed');
      }
      setDetail({ ...data, evidence_events: evidenceData?.events ?? [] });
    } catch (event) {
      setError(event instanceof Error ? event.message : '会话详情请求失败 / Session detail request failed');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function resetTokenBudget() {
    setResettingBudget(true);
    setError('');
    try {
      const response = await fetch('/api/token-budget/reset', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Token budget reset failed');
      }
      message.success('Token budget reset');
    } catch (event) {
      setError(event instanceof Error ? event.message : 'Token budget reset failed');
    } finally {
      setResettingBudget(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  const sessionColumns: ColumnsType<SessionRecord> = [
    {
      title: 'Session / 会话',
      dataIndex: 'id',
      render: (value: string) => <Typography.Text strong={value === selectedSessionID}>{value}</Typography.Text>,
    },
    {
      title: 'Scenario / 场景',
      dataIndex: 'scenario',
      render: (value?: string) => value || 'none',
    },
    {
      title: 'Status / 状态',
      dataIndex: 'status',
      width: 128,
      render: (value?: string) => <Tag color={value === 'active' ? 'blue' : 'default'}>{value || 'unknown'}</Tag>,
    },
    {
      title: 'Updated / 更新',
      dataIndex: 'latest_message_at',
      width: 180,
      render: (_: unknown, row) => row.latest_message_at || row.updated_at || row.created_at || 'none',
    },
  ];

  return (
    <main className="rea-page session-review-page">
      <section className="rea-header session-review-header">
        <div>
          <div className="rea-kicker">Session Review / 会话复盘</div>
          <h1 className="rea-title">Read-only learning session review / 只读学习会话复盘</h1>
        </div>
        <Space>
          <Button onClick={resetTokenBudget} loading={resettingBudget}>
            Reset token budget
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadSessions} loading={loadingSessions}>
          Reload / 刷新
          </Button>
        </Space>
      </section>

      {error ? <section className="corpus-error">{error}</section> : null}

      <section className="session-review-shell">
        <section className="rea-panel session-review-list">
          <h2 className="rea-panel-title">Sessions / 会话列表</h2>
          <Table
            rowKey="id"
            size="small"
            loading={loadingSessions}
            dataSource={sessions}
            columns={sessionColumns}
            pagination={{ pageSize: 8 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No sessions / 暂无会话" /> }}
            onRow={(record) => ({
              onClick: () => void loadSessionDetail(record.id),
            })}
            rowClassName={(record) => (record.id === selectedSessionID ? 'session-review-selected-row' : '')}
          />
        </section>

        <section className="rea-panel session-review-detail">
          <div className="session-panel-heading">
            <h2 className="rea-panel-title">Messages / 对话记录</h2>
            <Tag color={loadingDetail ? 'processing' : 'default'}>{loadingDetail ? 'Loading / 加载中' : 'Read-only / 只读'}</Tag>
          </div>
          {(detail?.messages ?? []).length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a session / 请选择会话" />
          ) : (
            <div className="session-review-messages">
              {(detail?.messages ?? []).map((message, index) => (
                <article className={`rea-message session-message ${message.role === 'student' ? 'student' : 'agent'}`} key={message.id ?? `${message.role}-${index}`}>
                  <div className="rea-message-role">{message.role === 'student' ? 'Student / 学生' : 'AI / 助手'}</div>
                  <Typography.Paragraph>{message.content || 'none'}</Typography.Paragraph>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rea-panel session-review-evidence">
          <h2 className="rea-panel-title">Evidence / 证据</h2>
          {evidencePayloads.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="学生完成一次对话后，这里会出现 skill、RAG、KG 和记忆证据。"
            />
          ) : (
            <div className="session-review-evidence-stack">
              {evidencePayloads.map((event) => (
                <EvidenceEventReview event={event} key={`${event.id}-${event.createdAt}`} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function EvidenceEventReview(props: {
  event: { id: string; eventType: string; createdAt: string; payload: Record<string, unknown> };
}) {
  const payload = props.event.payload;
  return (
    <article className="session-review-evidence-event">
      <div className="session-review-event-heading">
        <Space wrap size={[6, 6]}>
          <Tag color="blue">{props.event.eventType}</Tag>
          <Typography.Text type="secondary">{props.event.createdAt || props.event.id}</Typography.Text>
        </Space>
      </div>

      <EvidenceSection title="Mem0 memory events / Mem0 记忆事件">
        <MemoryOperationList updates={arrayOfMaps(payload.memory_updates)} />
      </EvidenceSection>

      <EvidenceSection title="MemoryBank long-term memory / MemoryBank 长期记忆">
        <KeyValue label="Selected memory IDs / 召回记忆" value={joinValues(mapValue(payload.memory_reading_plan, 'selected_memory_ids'))} />
        <KeyValue label="Reinforcement / 强化" value={operationSummary(arrayOfMaps(payload.memory_reinforcement))} />
      </EvidenceSection>

      <EvidenceSection title="RMM reflection / RMM 反思">
        <KeyValue label="Prospective plan / 前瞻计划" value={stringValue(mapValue(payload.memory_reading_plan, 'prospective_memory_plan'))} />
        <KeyValue label="Topic summary / 主题总结" value={stringValue(mapValue(payload.topic_summary_update, 'topic_summary'))} />
        <KeyValue label="Next action / 下一步动作" value={stringValue(mapValue(payload.topic_summary_update, 'next_teaching_action'))} />
        <KeyValue label="Retrospective use / 回顾使用" value={stringValue(mapValue(payload.retrospective_memory_use, 'retrospective_memory_use'))} />
        <KeyValue label="Retrieval refinement / 检索修正" value={stringValue(mapValue(payload.retrospective_memory_use, 'retrieval_refinement'))} />
      </EvidenceSection>

      <EvidenceSection title="Zep-style temporal facts / Zep 时间事实">
        <TemporalFactList facts={arrayOfMaps(payload.learning_facts)} />
      </EvidenceSection>

      <EvidenceSection title="Pedagogical skills / 教学技能">
        <KeyValue label="Active skill / 当前技能" value={stringValue(payload.skill_id)} />
        <KeyValue label="Confidence before / 答前信心" value={stringValue(mapValue(payload.evidence, 'confidence_before'))} />
        <KeyValue label="Teach-back / 复述" value={stringValue(mapValue(payload.evidence, 'teach_back'))} />
        <WorkflowTrace trace={arrayOfMaps(payload.workflow_trace)} />
      </EvidenceSection>

      <EvidenceSection title="RAG + KG grounding / RAG 与知识图谱依据">
        <KeyValue label="KG path / 知识路径" value={joinValues(payload.kg_path, ' -> ')} />
        <RagSourceList sources={arrayOfMaps(payload.rag_sources)} />
      </EvidenceSection>
    </article>
  );
}

function EvidenceSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="session-review-evidence-section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function MemoryOperationList(props: { updates: Record<string, unknown>[] }) {
  if (props.updates.length === 0) {
    return <Typography.Text type="secondary">none</Typography.Text>;
  }
  return (
    <Space direction="vertical" size={4}>
      {props.updates.map((update, index) => (
        <Space wrap size={[6, 6]} key={`${stringValue(update.memory_id)}-${index}`}>
          <Tag color={operationColor(stringValue(update.operation))}>{stringValue(update.operation)}</Tag>
          <Typography.Text>{stringValue(update.memory_id || update.target_memory_id)}</Typography.Text>
          <Typography.Text type="secondary">{stringValue(update.memory_type)}</Typography.Text>
          <Typography.Text type="secondary">{stringValue(update.reason)}</Typography.Text>
        </Space>
      ))}
    </Space>
  );
}

function TemporalFactList(props: { facts: Record<string, unknown>[] }) {
  if (props.facts.length === 0) {
    return <Typography.Text type="secondary">none</Typography.Text>;
  }
  return (
    <Space direction="vertical" size={4}>
      {props.facts.map((fact, index) => (
        <div className="session-review-fact" key={`${stringValue(fact.subject)}-${index}`}>
          <Typography.Text>{`${stringValue(fact.subject)} ${stringValue(fact.predicate)} ${stringValue(fact.object)}`}</Typography.Text>
          <Typography.Text type="secondary">{`valid_from ${stringValue(fact.valid_from)}`}</Typography.Text>
        </div>
      ))}
    </Space>
  );
}

function WorkflowTrace(props: { trace: Record<string, unknown>[] }) {
  if (props.trace.length === 0) {
    return <Typography.Text type="secondary">Workflow trace / 技能链路：none</Typography.Text>;
  }
  return (
    <div className="session-review-workflow">
      <Typography.Text type="secondary">Workflow trace / 技能链路</Typography.Text>
      <Space wrap size={[6, 6]}>
        {props.trace.map((item, index) => (
          <Tag key={`${stringValue(item.skill_id)}-${index}`}>{`${stringValue(item.skill_id)}: ${stringValue(item.status)}`}</Tag>
        ))}
      </Space>
    </div>
  );
}

function RagSourceList(props: { sources: Record<string, unknown>[] }) {
  if (props.sources.length === 0) {
    return <Typography.Text type="secondary">none</Typography.Text>;
  }
  return (
    <Space direction="vertical" size={6}>
      {props.sources.map((source, index) => (
        <div className="session-review-rag-source" key={`${stringValue(source.chunk_id)}-${index}`}>
          <Typography.Link href={stringValue(source.source_url)} target="_blank">
            {stringValue(source.title || source.chunk_id)}
          </Typography.Link>
          <Typography.Text type="secondary">{`rerank ${stringValue(source.rerank_score)}`}</Typography.Text>
        </div>
      ))}
    </Space>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="session-review-kv">
      <span>{props.label}</span>
      <strong>{props.value || 'none'}</strong>
    </div>
  );
}

function arrayOfMaps(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function mapValue(source: unknown, key: string): unknown {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return undefined;
  }
  return (source as Record<string, unknown>)[key];
}

function joinValues(value: unknown, separator = ', ') {
  if (Array.isArray(value)) {
    return value.map(formatEvidenceValue).join(separator);
  }
  return formatEvidenceValue(value);
}

function stringValue(value: unknown) {
  return formatEvidenceValue(value);
}

function operationSummary(updates: Record<string, unknown>[]) {
  if (updates.length === 0) {
    return 'none';
  }
  return updates.map((item) => `${stringValue(item.operation)} ${stringValue(item.memory_id || item.target_memory_id)}`.trim()).join(', ');
}

function operationColor(operation: string) {
  if (operation === 'ADD') {
    return 'green';
  }
  if (operation === 'UPDATE' || operation === 'REINFORCE') {
    return 'blue';
  }
  if (operation === 'DELETE') {
    return 'red';
  }
  return 'default';
}
