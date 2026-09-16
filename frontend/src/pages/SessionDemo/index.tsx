import { DeleteOutlined, ExperimentOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { Button, Input, Progress, Space, Tag, Typography } from 'antd';
import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getOrCreateLearnerID } from '../../utils/learner';
import LearningTraceMessage from './LearningTraceMessage';
import {
  appendStreamingAgentStarted,
  applyTraceStreamEvent,
  buildOptimisticExchange,
  composerIntent,
  type ChatMessage,
  type KnowledgePathNode,
  type LearningTrace,
  type LearningTraceStreamEvent,
  type SessionMessageRequest,
  type TokenBudget,
} from './model';

type SessionRecord = {
  id: string;
  scenario: string;
  status: 'active' | 'local' | string;
  message_count?: number;
  latest_message_at?: string;
};

type SessionMessageRecord = {
  id?: number | string;
  role?: string;
  content?: string;
};

type SessionEvidenceEventRecord = {
  agent_message_id?: number | string;
  payload?: {
    learning_trace?: LearningTrace;
  };
};

type SessionDetailResponse = {
  session?: SessionRecord;
  messages?: SessionMessageRecord[];
  evidence_events?: SessionEvidenceEventRecord[];
};

type SessionsResponse = {
  sessions?: SessionRecord[];
};

const defaultScenario = 'python-learning';
const defaultBaselineMode = 'full_memory';
const defaultTokenBudget: TokenBudget = {
  scope: 'global-demo',
  daily_quota: 24000,
  used_tokens: 0,
  remaining_tokens: 24000,
  remaining_percent: 100,
};

function compactID(id: string) {
  if (id.length <= 18) {
    return id;
  }
  return `${id.slice(0, 10)}...${id.slice(-4)}`;
}

function tokenBudgetColor(percent: number) {
  if (percent > 80) {
    return '#389e0d';
  }
  if (percent > 60) {
    return '#13a8a8';
  }
  if (percent > 40) {
    return '#d4b106';
  }
  if (percent > 20) {
    return '#d46b08';
  }
  return '#cf1322';
}

function sessionFromRecord(record: Partial<SessionRecord> | undefined): SessionRecord {
  return {
    id: record?.id ?? `local-${Date.now()}`,
    scenario: record?.scenario ?? defaultScenario,
    status: record?.status ?? 'active',
    message_count: record?.message_count,
    latest_message_at: record?.latest_message_at,
  };
}

function messagesToChatLog(messages: SessionMessageRecord[] | undefined, evidenceEvents: SessionEvidenceEventRecord[] | undefined): ChatMessage[] {
  const traceByAgentMessageID = new Map<string, LearningTrace>();
  for (const event of evidenceEvents ?? []) {
    if (event.agent_message_id !== undefined && event.payload?.learning_trace) {
      traceByAgentMessageID.set(String(event.agent_message_id), event.payload.learning_trace);
    }
  }
  return (messages ?? [])
    .filter((item) => item.role === 'student' || item.role === 'agent')
    .map((item, index) => ({
      id: String(item.id ?? `${item.role}-${index}`),
      role: item.role as ChatMessage['role'],
      content: item.content ?? '',
      trace: item.role === 'agent' && item.id !== undefined ? traceByAgentMessageID.get(String(item.id)) : undefined,
    }));
}

class SessionRequestError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function parseSessionRequestError(response: Response) {
  let errorMessage = 'session_request_failed';
  try {
    const data = await response.json();
    errorMessage = data?.error ?? errorMessage;
  } catch {
    // Keep the default error code when the response is not JSON.
  }
  return new SessionRequestError(errorMessage);
}

async function fetchSessionJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new SessionRequestError(data?.error ?? 'session_request_failed');
  }
  return data as T;
}

function requestedSessionID() {
  if (typeof window === 'undefined') {
    return '';
  }
  return new URLSearchParams(window.location.search).get('session_id')?.trim() ?? '';
}

async function readNDJSONStream(response: Response, onEvent: (event: LearningTraceStreamEvent) => void) {
  if (!response.body) {
    throw new Error('stream_body_missing');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        onEvent(JSON.parse(trimmed) as LearningTraceStreamEvent);
      }
    }
  }

  buffer += decoder.decode();
  const trimmed = buffer.trim();
  if (trimmed) {
    onEvent(JSON.parse(trimmed) as LearningTraceStreamEvent);
  }
}

export default function SessionDemoPage() {
  const learnerIDRef = useRef(getOrCreateLearnerID());
  const retryableTurnRef = useRef<{
    clientTurnID: string;
    sessionID: string;
    content: string;
    requestedFocusNodeID?: string;
  } | null>(null);
  const pendingFocusRevisionRef = useRef(0);
  const [message, setMessage] = useState('');
  const [thinking, setThinking] = useState(false);
  const [sessionStarting, setSessionStarting] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [log, setLog] = useState<ChatMessage[]>([]);
  const [pendingFocus, setPendingFocus] = useState<KnowledgePathNode | null>(null);
  const [tokenBudget, setTokenBudget] = useState<TokenBudget>(defaultTokenBudget);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tokenExhausted = tokenBudget.remaining_tokens <= 0;

  const replacePendingFocus = useCallback((nextFocus: KnowledgePathNode | null) => {
    pendingFocusRevisionRef.current += 1;
    setPendingFocus(nextFocus);
  }, []);

  useEffect(() => {
    void loadSessionsAndSelectDefault();
    void loadTokenBudget();
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const lastMessage = log[log.length - 1];
    if (lastMessage?.role === 'agent' && lastMessage.trace && !lastMessage.streaming) {
      window.requestAnimationFrame(() => {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      });
      return;
    }
    if (lastMessage?.role === 'agent' && lastMessage.streaming) {
      window.requestAnimationFrame(() => {
        const target = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(lastMessage.id)}"]`);
        if (target) {
          scroller.scrollTo({ top: Math.max(0, target.offsetTop - scroller.offsetTop - 8), behavior: 'smooth' });
        }
      });
      return;
    }
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  }, [log, thinking]);

  async function loadSessionsAndSelectDefault() {
    replacePendingFocus(null);
    retryableTurnRef.current = null;
    setSessionStarting(true);
    try {
      const data = await fetchSessionJSON<SessionsResponse>('/api/sessions?status=active');
      const nextSessions = (data.sessions ?? []).map((session) => sessionFromRecord(session));
      setSessions(nextSessions);
      if (nextSessions.length === 0) {
        setActiveSession(null);
        setLog([]);
        setMessage('');
        await startSession(false);
        return null;
      }
      const fallbackSession = nextSessions.find((session) => (session.message_count ?? 0) > 0) ?? nextSessions[0];
      const requestedID = requestedSessionID();
      const requestedSession = requestedID ? nextSessions.find((session) => session.id === requestedID) : undefined;
      const next = requestedSession ?? fallbackSession;
      try {
        await loadSessionDetail(next.id, next);
        return next;
      } catch (error) {
        const requestedUnavailable =
          requestedSession &&
          requestedSession.id !== fallbackSession.id &&
          error instanceof SessionRequestError &&
          (error.code === 'session_not_found' || error.code === 'session_deleted');
        if (!requestedUnavailable) {
          throw error;
        }
        await loadSessionDetail(fallbackSession.id, fallbackSession);
        return fallbackSession;
      }
    } catch {
      setActiveSession(null);
      setLog([]);
      return null;
    } finally {
      setSessionStarting(false);
    }
  }

  async function loadSessionDetail(sessionID: string, fallbackRecord?: SessionRecord) {
    const data = await fetchSessionJSON<SessionDetailResponse>(`/api/session/${encodeURIComponent(sessionID)}`);
    const next = sessionFromRecord(data.session ?? fallbackRecord ?? { id: sessionID });
    setActiveSession(next);
    setLog(messagesToChatLog(data.messages, data.evidence_events));
    return next;
  }

  async function selectSession(session: SessionRecord) {
    replacePendingFocus(null);
    retryableTurnRef.current = null;
    try {
      await loadSessionDetail(session.id, session);
    } catch {
      setLog((current) => [
        ...current,
        {
          id: `session-error-${Date.now()}`,
          role: 'agent',
          content: 'Request failed: the selected session no longer exists. Please choose another conversation or create a new one.',
          error: true,
        },
      ]);
    }
  }

  async function loadTokenBudget() {
    try {
      const response = await fetch('/api/token-budget');
      const data = await response.json();
      if (!response.ok || !data?.token_budget) {
        throw new Error(data?.error ?? 'token_budget_lookup_failed');
      }
      setTokenBudget(data.token_budget);
    } catch {
      setTokenBudget(defaultTokenBudget);
    }
  }

  async function startSession(resetLog: boolean) {
    replacePendingFocus(null);
    retryableTurnRef.current = null;
    setSessionStarting(true);
    try {
      const data = await fetchSessionJSON<{ session?: SessionRecord }>('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: defaultScenario }),
      });
      const next = sessionFromRecord(data.session);
      setActiveSession(next);
      setSessions((current) => [next, ...current.filter((session) => session.id !== next.id)].slice(0, 6));
      if (resetLog) {
        setLog([]);
        setMessage('');
      }
    } catch (error) {
      setLog((current) => [
        ...current,
        {
          id: `session-start-error-${Date.now()}`,
          role: 'agent',
          content: `Request failed: ${error instanceof Error ? error.message : 'session_start_failed'}`,
          error: true,
        },
      ]);
    } finally {
      setSessionStarting(false);
    }
  }

  async function deleteActiveSession() {
    if (!activeSession) {
      return;
    }
    replacePendingFocus(null);
    retryableTurnRef.current = null;
    const sessionID = activeSession.id;
    setDeletingSession(true);
    try {
      await fetchSessionJSON(`/api/session/${encodeURIComponent(sessionID)}`, {
        method: 'DELETE',
      });
      const remaining = sessions.filter((session) => session.id !== sessionID);
      setSessions(remaining);
      if (remaining.length > 0) {
        await loadSessionDetail(remaining[0].id, remaining[0]);
      } else {
        setActiveSession(null);
        setLog([]);
      }
      setMessage('');
    } finally {
      setDeletingSession(false);
    }
  }

  async function postMessageStream(
    sessionID: string,
    clientTurnID: string,
    content: string,
    timestamp: number,
    requestedFocusNodeID?: string,
  ) {
    const request: SessionMessageRequest = {
      client_turn_id: clientTurnID,
      session_id: sessionID,
      message: content,
      original_question: content,
      baseline_mode: defaultBaselineMode,
      learner_id: learnerIDRef.current,
      ...(requestedFocusNodeID ? { requested_focus_node_id: requestedFocusNodeID } : {}),
    };
    const response = await fetch('/api/session/message/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw await parseSessionRequestError(response);
    }
    let completedSuccessfully = false;
    await readNDJSONStream(response, (event) => {
      if (event.type === 'token_budget_updated') {
        setTokenBudget(event.token_budget);
        return;
      }
      if (event.type === 'trace_error' && event.token_budget) {
        setTokenBudget(event.token_budget);
      }
      if (event.type === 'trace_error') {
        completedSuccessfully = false;
      }
      if (event.type === 'trace_completed') {
        completedSuccessfully = true;
      }
      setLog((current) => applyTraceStreamEvent(current, event, timestamp));
    });
    return completedSuccessfully;
  }

  async function sendMessage() {
    const trimmed = message.trim();
    if (!trimmed || thinking || !activeSession) {
      return;
    }

    const timestamp = Date.now();
    const focusForTurn = pendingFocus;
    const focusRevisionForTurn = pendingFocusRevisionRef.current;
    const retryable = retryableTurnRef.current;
    const isRetry = retryable !== null
      && retryable.sessionID === activeSession.id
      && retryable.content === trimmed
      && retryable.requestedFocusNodeID === focusForTurn?.id;
    const clientTurnID = isRetry ? retryable.clientTurnID : crypto.randomUUID();
    retryableTurnRef.current = {
      clientTurnID,
      sessionID: activeSession.id,
      content: trimmed,
      ...(focusForTurn ? { requestedFocusNodeID: focusForTurn.id } : {}),
    };
    setMessage('');
    setThinking(true);
    setLog((current) => appendStreamingAgentStarted(buildOptimisticExchange(current, trimmed, timestamp), timestamp));

    try {
      const completedSuccessfully = await postMessageStream(
        activeSession.id,
        clientTurnID,
        trimmed,
        timestamp,
        focusForTurn?.id,
      );
      if (completedSuccessfully) {
        retryableTurnRef.current = null;
        setPendingFocus((current) => (
          pendingFocusRevisionRef.current === focusRevisionForTurn ? null : current
        ));
      } else {
        setMessage((current) => current || trimmed);
      }
    } catch (error) {
      setMessage((current) => current || trimmed);
      const errorMessage =
        error instanceof SessionRequestError && (error.code === 'session_not_found' || error.code === 'session_deleted')
          ? 'Request failed: the selected session no longer exists. Please choose another conversation or create a new one.'
          : `Request failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      setLog((current) =>
        applyTraceStreamEvent(
          current,
          {
            type: 'trace_error',
            failed_stage: 'guided_response',
            error_message: errorMessage,
          },
          timestamp,
        ),
      );
      if (error instanceof SessionRequestError && (error.code === 'session_not_found' || error.code === 'session_deleted')) {
        void loadSessionsAndSelectDefault();
      }
    } finally {
      setThinking(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (composerIntent({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing }) === 'submit') {
      event.preventDefault();
      void sendMessage();
    }
  }

  function openTestCenter() {
    const returnSessionID = activeSession?.id;
    history.push(returnSessionID ? `/test?return_session_id=${encodeURIComponent(returnSessionID)}` : '/test');
  }

  return (
    <main className="rea-page session-page student-session-page">
      <section className="rea-header session-header student-session-header">
        <div>
          <div className="rea-kicker">Learning Chat</div>
          <h1 className="rea-title">Python Learning Helper</h1>
        </div>
        <Space>
          <Tag color={thinking ? 'processing' : 'blue'}>{thinking ? 'Thinking' : 'Ready'}</Tag>
          <Button icon={<ExperimentOutlined />} onClick={openTestCenter} aria-label="Test">
            Test
          </Button>
        </Space>
      </section>

      <section className="student-session-shell">
        <aside className="rea-panel session-sidebar student-session-sidebar">
          <div className="session-panel-heading">
            <h2 className="rea-panel-title">Conversations</h2>
            <Button size="small" icon={<PlusOutlined />} loading={sessionStarting} onClick={() => startSession(true)}>
              New
            </Button>
          </div>
          <div className="session-list" aria-label="Conversation list">
            {sessions.map((session) => (
              <button
                className={`session-list-item ${session.id === activeSession?.id ? 'active' : ''}`}
                key={session.id}
                type="button"
                onClick={() => void selectSession(session)}
              >
                <span>{compactID(session.id)}</span>
                <small>{session.scenario}</small>
              </button>
            ))}
          </div>
          <Button danger icon={<DeleteOutlined />} loading={deletingSession} disabled={!activeSession} onClick={deleteActiveSession} aria-label="Delete session">
            Delete
          </Button>
          <div className="session-token-budget" aria-label="Token budget">
            <div className="session-token-budget-header">
              <span>Token budget</span>
              <strong>{tokenBudget.remaining_percent}%</strong>
            </div>
            <Progress
              percent={tokenBudget.remaining_percent}
              showInfo={false}
              strokeColor={tokenBudgetColor(tokenBudget.remaining_percent)}
              trailColor="#eef2f7"
            />
            <Typography.Text type="secondary">
              {tokenBudget.used_tokens.toLocaleString()} / {tokenBudget.daily_quota.toLocaleString()} used
            </Typography.Text>
            {tokenExhausted ? (
              <Typography.Text type="danger">
                Direct-answer requests are unavailable until the token budget resets. Ordinary chat and Test remain available.
              </Typography.Text>
            ) : null}
          </div>
        </aside>

        <section className="rea-panel session-chat-panel student-chat-panel">
          <div className="session-panel-heading">
            <h2 className="rea-panel-title">Dialogue</h2>
            <Typography.Text type="secondary">Ask a Python learning question</Typography.Text>
          </div>

          <div className="session-chat-scroll" ref={scrollRef}>
            {log.length === 0 ? (
              <div className="student-empty-state">
                <strong>Start with your question</strong>
                <span>Describe where you are stuck.</span>
              </div>
            ) : (
              log.map((item) => (
                <article
                  className={`rea-message session-message ${item.role} ${item.trace || item.streaming ? 'with-trace' : ''} ${item.error ? 'error' : ''}`}
                  data-message-id={item.id}
                  key={item.id}
                >
                  <div className="rea-message-role">{item.role === 'student' ? 'Student' : 'AI'}</div>
                  {item.role === 'agent' && (item.trace || item.streaming || item.partial_trace || item.stage_status) ? (
                    <LearningTraceMessage
                      answer={item.content}
                      partialTrace={item.partial_trace}
                      stageStatus={item.stage_status}
                      trace={item.trace}
                      onRequestFocus={replacePendingFocus}
                    />
                  ) : (
                    <Typography.Paragraph>{item.content}</Typography.Paragraph>
                  )}
                </article>
              ))
            )}
          </div>

          <div className="session-composer">
            {pendingFocus ? (
              <div className="session-focus-chip" role="status">
                <span>Asking about {pendingFocus.label}</span>
                <button type="button" onClick={() => replacePendingFocus(null)} aria-label="Remove knowledge node focus">
                  ×
                </button>
              </div>
            ) : null}
            <Input.TextArea
              value={message}
              disabled={thinking || !activeSession}
              placeholder="Type a Python learning question. Shift+Enter for a new line."
              autoSize={{ minRows: 1, maxRows: 5 }}
              onChange={(event) => {
                const nextMessage = event.target.value;
                setMessage(nextMessage);
                if (retryableTurnRef.current && nextMessage.trim() !== retryableTurnRef.current.content) {
                  retryableTurnRef.current = null;
                }
              }}
              onKeyDown={handleComposerKeyDown}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={sendMessage} disabled={thinking || !activeSession || !message.trim()} aria-label="Send" />
          </div>
        </section>
      </section>
    </main>
  );
}
