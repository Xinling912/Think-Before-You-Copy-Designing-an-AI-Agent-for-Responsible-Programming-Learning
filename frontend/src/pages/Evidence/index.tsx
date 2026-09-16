import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

type SessionRecord = {
  id: string;
  scenario?: string;
  status?: string;
  message_count?: number;
  latest_message_at?: string;
  updated_at?: string;
  created_at?: string;
};

type EvidenceEvent = {
  id: number;
  session_id?: string;
  student_message_id?: number;
  agent_message_id?: number;
  student_message_content?: string;
  agent_message_content?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

type MessageRecord = {
  id: number;
  session_id?: string;
  role?: string;
  content?: string;
  created_at?: string;
};

type SessionDetail = {
  session?: SessionRecord;
  messages?: MessageRecord[];
  evidence_events?: EvidenceEvent[];
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

function getEvents(payload: unknown): EvidenceEvent[] {
  if (Array.isArray(payload)) {
    return payload as EvidenceEvent[];
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { events?: unknown }).events)) {
    return (payload as { events: EvidenceEvent[] }).events;
  }
  return [];
}

export default function EvidencePage() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionID, setSelectedSessionID] = useState('');
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const [selectedEventID, setSelectedEventID] = useState<number | null>(null);
  const [messagesByID, setMessagesByID] = useState<Record<number, MessageRecord>>({});
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [error, setError] = useState('');

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionID) ?? sessions[0],
    [selectedSessionID, sessions],
  );
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventID) ?? events[0],
    [events, selectedEventID],
  );
  const learnerLabel = useMemo(
    () => stringValue(selectedEvent?.payload?.learner_id || selectedEvent?.payload?.learner) || 'not recorded',
    [selectedEvent],
  );

  async function loadSessions() {
    setLoadingSessions(true);
    setError('');
    try {
      const response = await fetch('/api/sessions?status=all', {
        headers: { 'X-REA-Admin-Access': '1' },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'sessions_lookup_failed');
      }
      const nextSessions = getSessions(data);
      setSessions(nextSessions);
      if (nextSessions.length > 0) {
        await loadEvidence(nextSessions[0].id);
      } else {
        setEvents([]);
        setSelectedSessionID('');
        setSelectedEventID(null);
      }
    } catch (event) {
      setError(event instanceof Error ? event.message : 'sessions_lookup_failed');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadEvidence(sessionID: string) {
    setSelectedSessionID(sessionID);
    setLoadingEvidence(true);
    setError('');
    try {
      const [evidenceResponse, detailResponse] = await Promise.all([
        fetch(`/api/session/${encodeURIComponent(sessionID)}/evidence`, {
          headers: { 'X-REA-Admin-Access': '1' },
        }),
        fetch(`/api/session/${encodeURIComponent(sessionID)}`, {
          headers: { 'X-REA-Admin-Access': '1' },
        }),
      ]);
      const evidenceData = await evidenceResponse.json();
      const detailData = await detailResponse.json();
      if (!evidenceResponse.ok) {
        throw new Error(evidenceData?.error ?? 'evidence_lookup_failed');
      }
      if (!detailResponse.ok) {
        throw new Error(detailData?.error ?? 'session_detail_lookup_failed');
      }
      const detail = detailData as SessionDetail;
      const messages = Array.isArray(detail.messages) ? detail.messages : [];
      setMessagesByID(Object.fromEntries(messages.map((message) => [message.id, message])));
      const nextEvents = getEvents(evidenceData);
      setEvents(nextEvents);
      setSelectedEventID(nextEvents[0]?.id ?? null);
    } catch (event) {
      setError(event instanceof Error ? event.message : 'evidence_lookup_failed');
    } finally {
      setLoadingEvidence(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  return (
    <main className="rea-page evidence-page">
      <section className="rea-header evidence-header">
        <div>
          <div className="rea-kicker">Evidence / 学习证据</div>
          <h1 className="rea-title">Session-bound learning evidence / 会话绑定学习证据</h1>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadSessions} loading={loadingSessions || loadingEvidence}>
          Reload / 刷新
        </Button>
      </section>

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <section className="rea-metric-grid evidence-metrics">
        <div className="rea-metric">
          <div>Learner / 学生</div>
          <strong>{learnerLabel}</strong>
        </div>
        <div className="rea-metric">
          <div>Session / 会话</div>
          <strong>{selectedSession?.id ?? 'none'}</strong>
        </div>
        <div className="rea-metric">
          <div>Evidence / 证据</div>
          <strong>{events.length} events / {events.length} 条证据</strong>
        </div>
        <div className="rea-metric">
          <div>Scenario / 场景</div>
          <strong>{selectedSession?.scenario ?? 'none'}</strong>
        </div>
      </section>

      <section className="evidence-workbench">
        <aside className="rea-panel evidence-selector">
          <h2 className="rea-panel-title">Sessions / 会话</h2>
          {sessions.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No sessions / 暂无会话" />
          ) : (
            <div className="evidence-session-list">
              {sessions.map((session) => (
                <button
                  className={`evidence-session-button ${session.id === selectedSessionID ? 'selected' : ''}`}
                  key={session.id}
                  onClick={() => void loadEvidence(session.id)}
                  type="button"
                >
                  <strong>{session.id}</strong>
                  <span>{session.scenario ?? 'unknown'}</span>
                  <span>{session.message_count ?? 0} messages / 条消息</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="rea-panel evidence-event-list">
          <div className="evidence-panel-heading">
            <h2 className="rea-panel-title">Turn evidence / 轮次证据</h2>
            <Tag color={loadingEvidence ? 'processing' : 'blue'}>{events.length} events / {events.length} 条证据</Tag>
          </div>
          {events.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a session with evidence / 请选择有证据的会话" />
          ) : (
            <div className="evidence-turn-list">
              {events.map((event, index) => (
                <button
                  className={`evidence-turn-button ${event.id === selectedEvent?.id ? 'selected' : ''}`}
                  key={event.id}
                  onClick={() => setSelectedEventID(event.id)}
                  type="button"
                >
                  <strong>turn {index + 1}</strong>
                  <span>{event.event_type ?? 'ai_step'}</span>
                  <span>student: {messagePreview(event, messagesByID, 'student')}</span>
                  <span>AI: {messagePreview(event, messagesByID, 'agent')}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rea-panel evidence-detail">
          <h2 className="rea-panel-title">Evidence detail / 证据详情</h2>
          {selectedEvent ? (
            <EvidenceDetail event={selectedEvent} messagesByID={messagesByID} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No evidence selected / 未选择证据" />
          )}
        </section>
      </section>
    </main>
  );
}

function EvidenceDetail(props: { event: EvidenceEvent; messagesByID: Record<number, MessageRecord> }) {
  const payload = props.event.payload ?? {};
  const diagnosis = mapValue(payload.diagnosis);
  const ragas = mapValue(payload.ragas);
  const studentMessage = messageForEvent(props.event, props.messagesByID, 'student');
  const agentMessage = messageForEvent(props.event, props.messagesByID, 'agent');

  return (
    <div className="evidence-detail-stack">
      <Space wrap size={[6, 6]}>
        <Tag color="blue">{props.event.event_type ?? 'ai_step'}</Tag>
        <Tag>student_message_id {props.event.student_message_id ?? 'none'}</Tag>
        <Tag>agent_message_id {props.event.agent_message_id ?? 'none'}</Tag>
        <Tag>{props.event.created_at ?? `event ${props.event.id}`}</Tag>
      </Space>

      <EvidenceBlock title="Dialogue turn / 对话轮次">
        <div className="evidence-dialogue-pair">
          <MessageExcerpt role="STUDENT / 学生" content={studentMessage} />
          <MessageExcerpt role="AI / 助手" content={agentMessage} />
        </div>
      </EvidenceBlock>

      <EvidenceBlock title="Retrieval / 检索">
        <DiagnosisLine label="RAGChecker" value={mapValue(diagnosis.retrieval)} />
        <KeyValue label="RAG source / 检索来源" value={sourceTitles(arrayOfMaps(payload.rag_sources))} />
      </EvidenceBlock>

      <EvidenceBlock title="Generation Grounding / 生成扎根性">
        <DiagnosisLine label="RAGChecker" value={mapValue(diagnosis.generation_grounding)} />
        <KeyValue label="RAGAS" value={ragasSummary(ragas)} />
      </EvidenceBlock>

      <EvidenceBlock title="KG Path / 知识路径">
        <DiagnosisLine label="RAGChecker" value={mapValue(diagnosis.kg_path)} />
        <KeyValue label="Path / 路径" value={joinValues(payload.kg_path, ' -> ')} />
      </EvidenceBlock>

      <EvidenceBlock title="Skill Decision / 教学策略">
        <DiagnosisLine label="RAGChecker" value={mapValue(diagnosis.skill_workflow)} />
        <KeyValue label="Skill / 技能" value={stringValue(payload.skill_id)} />
        <KeyValue label="Confidence before / 答前信心" value={stringValue(mapValue(payload.evidence).confidence_before)} />
        <KeyValue label="Teach-back / 复述" value={stringValue(mapValue(payload.evidence).teach_back)} />
      </EvidenceBlock>

      <EvidenceBlock title="Memory Use / 记忆使用">
        <DiagnosisLine label="RAGChecker" value={mapValue(diagnosis.memory)} />
        <KeyValue label="Prospective plan / 前瞻计划" value={stringValue(mapValue(payload.memory_reading_plan).prospective_memory_plan)} />
        <KeyValue label="Selected memory IDs / 召回记忆" value={joinValues(mapValue(payload.memory_reading_plan).selected_memory_ids)} />
        <KeyValue label="Mem0 operations / Mem0 操作" value={memoryOperations(arrayOfMaps(payload.memory_updates))} />
      </EvidenceBlock>

      <EvidenceBlock title="Sources / 来源">
        <div className="evidence-source-list">
          {arrayOfMaps(payload.rag_sources).map((source, index) => (
            <Typography.Link href={stringValue(source.source_url)} key={`${stringValue(source.chunk_id)}-${index}`} target="_blank">
              {stringValue(source.title || source.chunk_id)}
            </Typography.Link>
          ))}
        </div>
      </EvidenceBlock>
    </div>
  );
}

function MessageExcerpt(props: { role: string; content: string }) {
  return (
    <div className="evidence-message-excerpt">
      <span>{props.role}</span>
      <strong>{props.content || 'none'}</strong>
    </div>
  );
}

function EvidenceBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="evidence-block">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function DiagnosisLine(props: { label: string; value: Record<string, unknown> }) {
  return (
    <div className="evidence-kv">
      <span>{props.label}</span>
      <strong>{`${stringValue(props.value.status)} ${stringValue(props.value.reason)}`.trim() || 'none'}</strong>
    </div>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="evidence-kv">
      <span>{props.label}</span>
      <strong>{props.value || 'none'}</strong>
    </div>
  );
}

function mapValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function arrayOfMaps(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function joinValues(value: unknown, separator = ', ') {
  if (Array.isArray(value)) {
    return value.map(stringValue).join(separator);
  }
  return stringValue(value);
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function ragasSummary(value: Record<string, unknown>): string {
  const context = mapValue(value.context_relevance);
  const faithfulness = mapValue(value.answer_faithfulness);
  const relevance = mapValue(value.answer_relevance);
  return [
    `context ${stringValue(context.score)}`,
    `faithfulness ${stringValue(faithfulness.score)}`,
    `answer ${stringValue(relevance.score)}`,
  ].join(' / ');
}

function memoryOperations(updates: Record<string, unknown>[]) {
  if (updates.length === 0) {
    return 'none';
  }
  return updates
    .map((update) => `${stringValue(update.operation)} ${stringValue(update.memory_id || update.target_memory_id)}`.trim())
    .join(', ');
}

function sourceTitles(sources: Record<string, unknown>[]) {
  if (sources.length === 0) {
    return 'none';
  }
  return sources.map((source) => stringValue(source.title || source.chunk_id)).join(', ');
}

function messageForEvent(event: EvidenceEvent, messagesByID: Record<number, MessageRecord>, role: 'student' | 'agent'): string {
  const contentFromEvent = role === 'student' ? event.student_message_content : event.agent_message_content;
  if (contentFromEvent) {
    return contentFromEvent;
  }
  const messageID = role === 'student' ? event.student_message_id : event.agent_message_id;
  if (!messageID) {
    return '';
  }
  return messagesByID[messageID]?.content ?? '';
}

function messagePreview(event: EvidenceEvent, messagesByID: Record<number, MessageRecord>, role: 'student' | 'agent'): string {
  const content = messageForEvent(event, messagesByID, role);
  if (!content) {
    return 'none';
  }
  return content.length > 46 ? `${content.slice(0, 46)}...` : content;
}
