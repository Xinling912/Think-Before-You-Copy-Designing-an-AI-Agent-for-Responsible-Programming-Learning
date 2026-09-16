import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import LearningTraceMessage from './LearningTraceMessage';
import SessionDemoPage from './index';
import type { LearningTrace, LearningTraceStreamEvent } from './model';

const historyPushMock = vi.hoisted(() => vi.fn());
const sessionCanvasProps = vi.hoisted(() => [] as Array<Record<string, any>>);

vi.mock('@umijs/max', () => ({
  history: {
    push: historyPushMock,
  },
}));

vi.mock('../../components/KGWorld/KGGraphCanvas', () => ({
  ROLE_STYLES: {
    normal: { size: 16 },
    upstream: { size: 18, fill: '#94A3B8', stroke: '#64748B', lineWidth: 2 },
    downstream: { size: 18, fill: '#4FA66E', stroke: '#2F7A4B', lineWidth: 2 },
    current: { size: 36, fill: '#F28C28', stroke: '#FFF7ED', lineWidth: 3 },
  },
  KGGraphCanvas: (props: Record<string, any>) => {
    sessionCanvasProps.push(props);
    return (
      <div aria-label={props['aria-label']} style={props.style} data-view-state={props.viewState}>
        {props.graph.nodes.map((node: { id: string }) => (
          <button
            aria-label={`Select KG node ${node.id}`}
            key={node.id}
            onClick={() => props.onNodeClick?.(node.id)}
            type="button"
          />
        ))}
      </div>
    );
  },
}));

const activeSessionID = 'session-recovered-20260709-list-indexerror';
const activeSessionLabel = 'session-re...rror';
const olderSessionID = 'session-older-python-loop';
const olderSessionLabel = 'session-ol...loop';
const composerPlaceholder = 'Type a Python learning question. Shift+Enter for a new line.';

const learningTrace = {
  turn_id: '2',
  query_understanding: {
    original_question: 'student list question',
    intent: 'error_debugging',
    rewritten_query: 'Python list IndexError valid range',
    concept_hints: ['Concept:list', 'Concept:index'],
  },
  kg_grounding: {
    selected_node_ids: ['Concept:list', 'Concept:index', 'ErrorType:IndexError'],
    knowledge_path_view: {
      upstream: [{ id: 'Concept:list', label: 'list', type: 'Concept' }],
      current: [{ id: 'Concept:index', label: 'index', type: 'Concept' }],
      downstream: [{ id: 'ErrorType:IndexError', label: 'IndexError', type: 'ErrorType' }],
      edges: [
        { from: 'Concept:list', to: 'Concept:index', segment: 'upstream_to_current' },
        { from: 'Concept:index', to: 'ErrorType:IndexError', segment: 'current_to_downstream' },
      ],
      focus_node_ids: ['Concept:index'],
    },
  },
  rag_evidence: [
    {
      rank: 1,
      title: 'Python tutorial lists',
      source: 'python-docs-3.14.6',
      heading_path: 'Data Structures > Lists',
      url: 'https://docs.python.org/3/tutorial/datastructures.html',
      score: 0.82,
      snippet: 'Lists can be indexed and sliced.',
    },
    {
      rank: 2,
      title: 'Think Python debugging',
      source: 'think-python-2e',
      heading_path: 'Strings > Debugging',
      url: 'https://greenteapress.com/thinkpython2/html/',
      score: 0.74,
      snippet: 'Index errors occur when an index is out of range.',
    },
    {
      rank: 3,
      title: 'Python for Everybody lists',
      source: 'py4e-html3',
      heading_path: 'Lists > Debugging',
      url: 'https://www.py4e.com/html3/08-lists',
      score: 0.71,
      snippet: 'Check the valid index range.',
    },
    {
      rank: 4,
      title: 'Hidden fourth source',
      source: 'runoob-python3',
      heading_path: 'Python3 list',
      url: 'https://www.runoob.com/python3/python3-list.html',
      score: 0.62,
      snippet: 'This item should not render in the top three trace.',
    },
  ],
  teaching_decision: {
    skill: 'student-learning/retrieve-first-gate',
    hint_level: 1,
    direct_answer: false,
  },
  answer: 'AI guided answer from backend trace.',
};

const sessionKGOverview = {
  version: 'session-test-v1',
  categories: [
    {
      id: 'collections-and-access',
      label_zh: '集合与访问域',
      label_en: 'Collections and access',
      description_zh: '集合与访问知识区域。',
      description_en: 'Collections and access knowledge region.',
      color: '#606C38',
      surface_color: '#D4B895',
      anchor: { x: 0.5, y: 0.5 },
      order: 3,
      node_count: 4,
      internal_relation_count: 3,
      outgoing_relation_count: 0,
      incoming_relation_count: 0,
    },
  ],
  nodes: ['Concept:list', 'Concept:index', 'ErrorType:IndexError', 'Concept:tuple'].map((nodeID) => ({
    node_id: nodeID,
    label: nodeID.split(':')[1],
    node_type: nodeID.split(':')[0],
    origin: 'curated',
    aliases: [],
    source_ids: [],
    source_chunk_ids: [],
    source_urls: [],
    evidence_summary: '',
    confidence: 1,
    category_id: 'collections-and-access',
    unique_in_degree: 1,
    unique_out_degree: 1,
    unique_relation_degree: 2,
    path_ids: [],
  })),
  visual_edges: [
    ['Concept:list|Concept:index', 'Concept:list', 'Concept:index'],
    ['Concept:index|ErrorType:IndexError', 'Concept:index', 'ErrorType:IndexError'],
    ['Concept:list|Concept:tuple', 'Concept:list', 'Concept:tuple'],
  ].map(([key, source, target]) => ({
    key,
    source,
    target,
    source_category_id: 'collections-and-access',
    target_category_id: 'collections-and-access',
    is_cross_category: false,
    relation_types: ['related_to'],
    relation_count: 1,
    provenance_count: 1,
    origins: ['curated'],
    source_ids: [],
    source_chunk_ids: [],
    source_urls: [],
    evidence_texts: [],
  })),
};

function ndjsonResponse(events: LearningTraceStreamEvent[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
  return {
    ok: true,
    body,
  };
}

function sessionsResponse(sessions = defaultSessions()) {
  return {
    ok: true,
    json: async () => ({ sessions }),
  };
}

function defaultSessions() {
  return [
    {
      id: activeSessionID,
      scenario: 'python-list-indexerror-recovered',
      status: 'active',
      message_count: 2,
    },
    {
      id: olderSessionID,
      scenario: 'python-loop',
      status: 'active',
      message_count: 2,
    },
  ];
}

function sessionDetailResponse(sessionID = activeSessionID) {
  const isOlder = sessionID === olderSessionID;
  return {
    ok: true,
    json: async () => ({
      session: {
        id: sessionID,
        scenario: isOlder ? 'python-loop' : 'python-list-indexerror-recovered',
        status: 'active',
      },
      messages: [
        {
          id: isOlder ? 11 : 1,
          role: 'student',
          content: isOlder ? 'older session student message' : 'current student message',
        },
        {
          id: isOlder ? 12 : 2,
          role: 'agent',
          content: isOlder ? 'older session agent message' : 'current agent message',
        },
      ],
      evidence_events: isOlder
        ? []
        : [
            {
              agent_message_id: 2,
              payload: {
                learning_trace: learningTrace,
              },
            },
          ],
    }),
  };
}

function startSessionResponse() {
  return {
    ok: true,
    json: async () => ({
      session: {
        id: 'session-ui-test',
        scenario: 'python-learning',
        status: 'active',
      },
    }),
  };
}

function tokenBudgetResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      token_budget: {
        scope: 'global-demo',
        daily_quota: 24000,
        used_tokens: 6000,
        remaining_tokens: 18000,
        remaining_percent: 75,
        ...overrides,
      },
    }),
  };
}

function fullTraceEvents(): LearningTraceStreamEvent[] {
  return [
    { type: 'trace_started', session_id: activeSessionID, turn_id: '1' },
    {
      type: 'query_understanding_done',
      session_id: activeSessionID,
      turn_id: '1',
      query_understanding: learningTrace.query_understanding,
    },
    {
      type: 'kg_grounding_done',
      session_id: activeSessionID,
      turn_id: '1',
      kg_grounding: learningTrace.kg_grounding,
    },
    {
      type: 'rag_evidence_done',
      session_id: activeSessionID,
      turn_id: '1',
      rag_evidence: learningTrace.rag_evidence,
    },
    {
      type: 'guided_response_done',
      session_id: activeSessionID,
      turn_id: '1',
      answer: learningTrace.answer,
    },
    {
      type: 'trace_completed',
      session_id: activeSessionID,
      turn_id: '1',
      learning_trace: learningTrace,
    },
  ];
}

function requestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

function streamRequestBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([input]) => String(input) === '/api/session/message/stream')
    .map(([, init]) => requestBody(init as RequestInit | undefined));
}

function compactTenTurnSessionDetailResponse() {
  const messages = [] as Array<{ id: number; role: string; content: string }>;
  const evidenceEvents = [] as Array<{ agent_message_id: number; payload: { learning_trace: typeof learningTrace } }>;
  for (let index = 0; index < 10; index += 1) {
    const studentID = index * 2 + 1;
    const agentID = studentID + 1;
    messages.push({ id: studentID, role: 'student', content: `student turn ${index + 1}` });
    messages.push({ id: agentID, role: 'agent', content: `agent turn ${index + 1}` });
    evidenceEvents.push({
      agent_message_id: agentID,
      payload: { learning_trace: { ...learningTrace, answer: `compact guided response ${index + 1}` } },
    });
  }
  return {
    ok: true,
    json: async () => ({
      session: { id: activeSessionID, scenario: 'python-learning', status: 'active' },
      messages,
      evidence_events: evidenceEvents,
    }),
  };
}

async function expandTracePanel(label: string) {
  const panels = await screen.findAllByRole('button', { name: new RegExp(label) });
  for (const panel of panels) {
    if (panel.getAttribute('aria-expanded') !== 'true') {
      fireEvent.click(panel);
    }
  }
}

async function expandLearningTraceDetails() {
  await expandTracePanel('Question understanding');
  await expandTracePanel('KG nodes and path');
  await expandTracePanel('Top 3 sources');
}

async function selectIndexAndRequestFocus() {
  await screen.findByText('current student message');
  await expandTracePanel('KG nodes and path');
  const canvas = await screen.findByLabelText('Knowledge path force graph');
  fireEvent.click(within(canvas).getByRole('button', { name: 'Select KG node Concept:index' }));
  const nodeDetail = screen.getByRole('region', { name: 'Selected knowledge node' });
  fireEvent.click(within(nodeDetail).getByRole('button', { name: 'Ask about this node' }));
  expect(screen.getByLabelText('Remove knowledge node focus')).toBeInTheDocument();
}

async function selectNodeAndRequestFocus(nodeID: string, expectedLabel: string) {
  await expandTracePanel('KG nodes and path');
  const canvas = await screen.findByLabelText('Knowledge path force graph');
  fireEvent.click(within(canvas).getByRole('button', { name: `Select KG node ${nodeID}` }));
  const nodeDetail = screen.getByRole('region', { name: 'Selected knowledge node' });
  fireEvent.click(within(nodeDetail).getByRole('button', { name: 'Ask about this node' }));
  expect(screen.getByText(`Asking about ${expectedLabel}`)).toBeInTheDocument();
}

function installDefaultFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse();
      }
      if (url === `/api/session/${activeSessionID}`) {
        return sessionDetailResponse(activeSessionID);
      }
      if (url === `/api/session/${olderSessionID}`) {
        return sessionDetailResponse(olderSessionID);
      }
      if (url === '/api/session/start') {
        return startSessionResponse();
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      if (url === '/api/kg/overview') {
        return { ok: true, json: async () => sessionKGOverview };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    }),
  );
}

beforeEach(() => {
  sessionCanvasProps.length = 0;
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  historyPushMock.mockReset();
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
  installDefaultFetch();
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders exactly one Test button and preserves the active session when opening Test Center', async () => {
  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getByText('current student message')).toBeInTheDocument());
  const testButtons = screen.getAllByRole('button', { name: 'Test' });
  expect(testButtons).toHaveLength(1);

  fireEvent.click(testButtons[0]);

  expect(historyPushMock).toHaveBeenCalledTimes(1);
  expect(historyPushMock).toHaveBeenCalledWith(`/test?return_session_id=${encodeURIComponent(activeSessionID)}`);
}, 15_000);

test('opens Test Center with the automatically created first session', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse([]);
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      if (url === '/api/session/start') {
        return startSessionResponse();
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete session' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Test' }));

  expect(historyPushMock).toHaveBeenCalledWith('/test?return_session_id=session-ui-test');
});

test('restores an existing active session requested by the URL', async () => {
  window.history.replaceState({}, '', `/?session_id=${encodeURIComponent(olderSessionID)}`);

  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getByText('older session student message')).toBeInTheDocument());
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/session/${olderSessionID}`, undefined);
  expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(`/api/session/${activeSessionID}`, undefined);
});

test('falls back to the existing default selection when the requested session is missing', async () => {
  window.history.replaceState({}, '', '/?session_id=session-missing');

  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getByText('current student message')).toBeInTheDocument());
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/session/${activeSessionID}`, undefined);
  expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/session/session-missing', undefined);
});

test('falls back to the existing default selection when requested session detail is unavailable', async () => {
  window.history.replaceState({}, '', `/?session_id=${encodeURIComponent(olderSessionID)}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse();
      }
      if (url === `/api/session/${olderSessionID}`) {
        return {
          ok: false,
          json: async () => ({ error: 'session_deleted' }),
        };
      }
      if (url === `/api/session/${activeSessionID}`) {
        return sessionDetailResponse(activeSessionID);
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      return { ok: true, json: async () => ({}) };
    }),
  );

  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getByText('current student message')).toBeInTheDocument());
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/session/${olderSessionID}`, undefined);
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/session/${activeSessionID}`, undefined);
});

test('loads active sessions and uses English-only static labels on startup', async () => {
  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  expect(screen.getByText('Learning Chat')).toBeInTheDocument();
  expect(screen.getByText('Python Learning Helper')).toBeInTheDocument();
  expect(screen.getByText('Conversations')).toBeInTheDocument();
  expect(screen.getByText('Dialogue')).toBeInTheDocument();
  expect(screen.getByText('Ask a Python learning question')).toBeInTheDocument();
  expect(screen.getByText('current student message')).toBeInTheDocument();
  expect(screen.getByText('current agent message')).toBeInTheDocument();
  expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/sessions?status=active', undefined);
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/session/${activeSessionID}`, undefined);
  expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/token-budget');
  expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/session/current');
});

test('creates the first conversation automatically when a participant has no active sessions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse([]);
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      if (url === '/api/session/start') {
        return startSessionResponse();
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    }),
  );

  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getAllByText('session-ui-test').length).toBeGreaterThan(0));
  expect(fetch).toHaveBeenCalledWith('/api/session/start', expect.objectContaining({ method: 'POST' }));
  expect(screen.getByRole('button', { name: 'Delete session' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
});

test('hydrates persisted learning trace onto the matching agent message', async () => {
  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getByText('Query rewrite')).toBeInTheDocument());
  expect(screen.getByText('Knowledge path')).toBeInTheDocument();
  expect(screen.getByText('Retrieved evidence')).toBeInTheDocument();
  expect(screen.getByText('Guided response')).toBeInTheDocument();
  expect(screen.getByLabelText('Token budget')).toHaveTextContent('75%');
  expect(screen.getByLabelText('Token budget')).toHaveTextContent('6,000 / 24,000 used');
  await expandLearningTraceDetails();
  expect(screen.getAllByText('Python list IndexError valid range').length).toBeGreaterThan(0);
  expect(await screen.findByLabelText('Knowledge path force graph')).toHaveStyle({ height: '360px' });
  expect(screen.queryByText('Upstream Foundations')).not.toBeInTheDocument();
  expect(screen.queryByText('Current Focus')).not.toBeInTheDocument();
  expect(screen.queryByText('Downstream Extensions')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View in Knowledge World' })).toHaveAttribute(
    'href',
    '/knowledge-world?category=collections-and-access&focus=Concept%3Aindex&path=2',
  );
  expect(screen.getAllByText((_, element) => element?.textContent?.includes('Python tutorial lists') ?? false).length).toBeGreaterThan(0);
  expect(screen.queryByText('Hidden fourth source')).not.toBeInTheDocument();
});

test('keeps query, evidence, and guided response accessible when KG metadata fails', async () => {
  const defaultFetch = vi.mocked(fetch);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/kg/overview') {
        return { ok: false, json: async () => ({ error: 'kg_unavailable' }) };
      }
      return defaultFetch(input, init);
    }),
  );

  render(<SessionDemoPage />);

  await expandTracePanel('KG nodes and path');
  await waitFor(() => expect(screen.getByText('Failed to load knowledge path metadata.')).toBeInTheDocument());
  await expandLearningTraceDetails();
  expect(screen.getAllByText('Python list IndexError valid range').length).toBeGreaterThan(0);
  expect(screen.getAllByText((_, element) => element?.textContent?.includes('Python tutorial lists') ?? false).length).toBeGreaterThan(0);
  expect(screen.getByText('current agent message')).toBeInTheDocument();
});

test('selecting an older session loads only that session messages', async () => {
  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getByText('current student message')).toBeInTheDocument());

  await selectIndexAndRequestFocus();

  fireEvent.click(screen.getByText(olderSessionLabel));

  await waitFor(() => expect(screen.getByText('older session student message')).toBeInTheDocument());
  expect(screen.getByText('older session agent message')).toBeInTheDocument();
  expect(screen.queryByText('current student message')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Remove knowledge node focus')).not.toBeInTheDocument();
});

test('renders backend stream stages after sending a message and sends original_question', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') {
      return sessionsResponse();
    }
    if (url === `/api/session/${activeSessionID}`) {
      return sessionDetailResponse(activeSessionID);
    }
    if (url === '/api/session/message/stream') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body).toMatchObject({
        session_id: activeSessionID,
        message: 'student list question',
        original_question: 'student list question',
      });
      expect(body).not.toHaveProperty('requested_focus_node_id');
      return ndjsonResponse(fullTraceEvents());
    }
    if (url === '/api/token-budget') {
      return tokenBudgetResponse();
    }
    return {
      ok: true,
      json: async () => ({}),
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'student list question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(screen.getAllByText('Query rewrite').length).toBeGreaterThan(0));
  expect(screen.queryByText(/AI is reading/)).not.toBeInTheDocument();
  await expandLearningTraceDetails();
  expect(screen.getAllByText('Python list IndexError valid range').length).toBeGreaterThan(0);
  expect(screen.getByText('AI guided answer from backend trace.')).toBeInTheDocument();
});

test('selecting a graph node only opens details and ordinary send omits focus', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') return ndjsonResponse(fullTraceEvents());
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await screen.findByText('current student message');
  await expandTracePanel('KG nodes and path');
  fireEvent.click(await screen.findByRole('button', { name: 'Select KG node Concept:index' }));
  expect(screen.getByRole('region', { name: 'Selected knowledge node' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Remove knowledge node focus')).not.toBeInTheDocument();

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'question without explicit focus' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(1));
  expect(streamRequestBodies(fetchMock)[0]).not.toHaveProperty('requested_focus_node_id');
});

test('removing the pending focus chip keeps the composer usable and omits focus', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') return ndjsonResponse(fullTraceEvents());
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectIndexAndRequestFocus();
  expect(screen.getByText('Asking about index')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Remove knowledge node focus'));

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  expect(composer).toBeEnabled();
  fireEvent.change(composer, { target: { value: 'question after removing focus' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(1));
  expect(streamRequestBodies(fetchMock)[0]).not.toHaveProperty('requested_focus_node_id');
});

test('successful send includes pending focus once and consumes the chip', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') return ndjsonResponse(fullTraceEvents());
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectIndexAndRequestFocus();
  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'focused question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(screen.queryByLabelText('Remove knowledge node focus')).not.toBeInTheDocument());
  expect(streamRequestBodies(fetchMock)[0]).toHaveProperty('requested_focus_node_id', 'Concept:index');
  await waitFor(() => expect(composer).toBeEnabled());

  fireEvent.change(composer, { target: { value: 'next ordinary question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(2));
  expect(streamRequestBodies(fetchMock)[1]).not.toHaveProperty('requested_focus_node_id');
});

test('latest A to B to C selection wins while an in-flight D selection survives and is consumed once', async () => {
  let resolveFirstStream: ((response: ReturnType<typeof ndjsonResponse>) => void) | undefined;
  let streamAttempt = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') {
      streamAttempt += 1;
      if (streamAttempt === 1) {
        return new Promise<ReturnType<typeof ndjsonResponse>>((resolve) => {
          resolveFirstStream = resolve;
        });
      }
      return ndjsonResponse(fullTraceEvents());
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectNodeAndRequestFocus('Concept:list', 'list');
  await selectNodeAndRequestFocus('Concept:index', 'index');
  await selectNodeAndRequestFocus('ErrorType:IndexError', 'IndexError');

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: '这是啥意思？' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(1));
  const firstRequest = streamRequestBodies(fetchMock)[0];
  expect(firstRequest).toHaveProperty('requested_focus_node_id', 'ErrorType:IndexError');
  expect(JSON.stringify(firstRequest)).not.toContain('Concept:list');
  expect(JSON.stringify(firstRequest)).not.toContain('Concept:index');

  await selectNodeAndRequestFocus('Concept:tuple', 'tuple');
  await selectNodeAndRequestFocus('Concept:tuple', 'tuple');
  resolveFirstStream?.(ndjsonResponse(fullTraceEvents()));

  await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());
  expect(screen.getByText('Asking about tuple')).toBeInTheDocument();

  fireEvent.change(composer, { target: { value: '再解释一下' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(2));
  const secondRequest = streamRequestBodies(fetchMock)[1];
  expect(secondRequest).toHaveProperty('requested_focus_node_id', 'Concept:tuple');
  expect(JSON.stringify(secondRequest)).not.toContain('Concept:list');
  expect(JSON.stringify(secondRequest)).not.toContain('Concept:index');
  expect(JSON.stringify(secondRequest)).not.toContain('ErrorType:IndexError');
  await waitFor(() => expect(screen.queryByLabelText('Remove knowledge node focus')).not.toBeInTheDocument());
  await waitFor(() => expect(composer).toBeEnabled());

  fireEvent.change(composer, { target: { value: '普通追问' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(3));
  expect(streamRequestBodies(fetchMock)[2]).not.toHaveProperty('requested_focus_node_id');
}, 15_000);

test('successful send clears only the selection submitted by that turn', async () => {
  let resolveStream: ((response: ReturnType<typeof ndjsonResponse>) => void) | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') {
      return new Promise<ReturnType<typeof ndjsonResponse>>((resolve) => {
        resolveStream = resolve;
      });
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectIndexAndRequestFocus();
  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'focused question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Select KG node Concept:list' }));
  const nodeDetail = screen.getByRole('region', { name: 'Selected knowledge node' });
  fireEvent.click(within(nodeDetail).getByRole('button', { name: 'Ask about this node' }));
  expect(screen.getByText('Asking about list')).toBeInTheDocument();

  resolveStream?.(ndjsonResponse(fullTraceEvents()));

  await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());
  expect(screen.getByText('Asking about list')).toBeInTheDocument();
  expect(streamRequestBodies(fetchMock)[0]).toHaveProperty('requested_focus_node_id', 'Concept:index');
});

test('successful send preserves a newer in-flight reselect of the same node', async () => {
  let resolveStream: ((response: ReturnType<typeof ndjsonResponse>) => void) | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') {
      return new Promise<ReturnType<typeof ndjsonResponse>>((resolve) => {
        resolveStream = resolve;
      });
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectIndexAndRequestFocus();
  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'focused question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(1));
  const nodeDetail = screen.getByRole('region', { name: 'Selected knowledge node' });
  fireEvent.click(within(nodeDetail).getByRole('button', { name: 'Ask about this node' }));
  expect(screen.getByText('Asking about index')).toBeInTheDocument();

  resolveStream?.(ndjsonResponse(fullTraceEvents()));

  await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());
  expect(screen.getByText('Asking about index')).toBeInTheDocument();
  expect(streamRequestBodies(fetchMock)[0]).toHaveProperty('requested_focus_node_id', 'Concept:index');
});

test('failed send retains pending focus for retry', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') {
      return { ok: false, json: async () => ({ error: 'temporary_failure' }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectIndexAndRequestFocus();
  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'retryable focused question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(screen.getByText('Request failed: temporary_failure')).toBeInTheDocument());
  expect(streamRequestBodies(fetchMock)[0]).toHaveProperty('requested_focus_node_id', 'Concept:index');
  expect(screen.getByLabelText('Remove knowledge node focus')).toBeInTheDocument();
  await waitFor(() => expect(composer).toBeEnabled());
});

test('failed streamed turn restores the message and reuses its client turn ID for retry', async () => {
  const randomUUID = vi.fn()
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
  vi.stubGlobal('crypto', { randomUUID });
  let streamAttempt = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') {
      streamAttempt += 1;
      if (streamAttempt === 1) {
        return ndjsonResponse([
          { type: 'trace_started', session_id: activeSessionID, turn_id: 'retry-turn' },
          {
            type: 'trace_error',
            session_id: activeSessionID,
            turn_id: 'retry-turn',
            failed_stage: 'guided_response',
            error_message: 'stream failed before commit',
          },
        ]);
      }
      return ndjsonResponse(fullTraceEvents());
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectIndexAndRequestFocus();
  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: '这是啥意思？' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(screen.getByText('stream failed before commit')).toBeInTheDocument());
  expect(composer).toHaveValue('这是啥意思？');
  expect(screen.getByLabelText('Remove knowledge node focus')).toBeInTheDocument();

  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(2));
  const [first, retry] = streamRequestBodies(fetchMock);
  expect(first).toMatchObject({
    client_turn_id: '11111111-1111-4111-8111-111111111111',
    requested_focus_node_id: 'Concept:index',
  });
  expect(retry).toMatchObject({
    client_turn_id: '11111111-1111-4111-8111-111111111111',
    requested_focus_node_id: 'Concept:index',
  });
  await waitFor(() => expect(screen.queryByLabelText('Remove knowledge node focus')).not.toBeInTheDocument());

  fireEvent.change(composer, { target: { value: '继续' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(streamRequestBodies(fetchMock)).toHaveLength(3));
  expect(streamRequestBodies(fetchMock)[2]).toMatchObject({
    client_turn_id: '22222222-2222-4222-8222-222222222222',
  });
  expect(streamRequestBodies(fetchMock)[2]).not.toHaveProperty('requested_focus_node_id');
  expect(randomUUID).toHaveBeenCalledTimes(2);
});

test('stream without a committed completion retains the pending message and selection', async () => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '33333333-3333-4333-8333-333333333333') });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') return sessionsResponse();
    if (url === `/api/session/${activeSessionID}`) return sessionDetailResponse(activeSessionID);
    if (url === '/api/token-budget') return tokenBudgetResponse();
    if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
    if (url === '/api/session/message/stream') {
      return ndjsonResponse([
        { type: 'trace_started', session_id: activeSessionID, turn_id: 'incomplete-turn' },
        {
          type: 'guided_response_done',
          session_id: activeSessionID,
          turn_id: 'incomplete-turn',
          answer: 'uncommitted answer',
        },
      ]);
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<SessionDemoPage />);

  await selectIndexAndRequestFocus();
  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'incomplete focused question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(composer).toBeEnabled());
  expect(composer).toHaveValue('incomplete focused question');
  expect(screen.getByLabelText('Remove knowledge node focus')).toBeInTheDocument();
  expect(streamRequestBodies(fetchMock)[0]).toHaveProperty(
    'client_turn_id',
    '33333333-3333-4333-8333-333333333333',
  );
});

test('requesting focus does not mutate the prior LearningTrace props', async () => {
  const priorTrace = structuredClone(learningTrace) as LearningTrace;
  const snapshot = structuredClone(priorTrace);
  const onRequestFocus = vi.fn();

  render(<LearningTraceMessage trace={priorTrace} onRequestFocus={onRequestFocus} />);
  await expandTracePanel('KG nodes and path');
  fireEvent.click(await screen.findByRole('button', { name: 'Select KG node Concept:index' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this node' }));

  expect(onRequestFocus).toHaveBeenCalledWith({ id: 'Concept:index', label: 'index', type: 'Concept' });
  expect(priorTrace).toEqual(snapshot);
}, 15_000);

test('keeps completed learning-trace evidence panels collapsed on first render', () => {
  render(<LearningTraceMessage trace={learningTrace as LearningTrace} onRequestFocus={vi.fn()} />);

  for (const name of ['Question understanding', 'KG nodes and path', 'Top 3 sources']) {
    expect(screen.getByRole('button', { name: new RegExp(name) })).toHaveAttribute('aria-expanded', 'false');
  }
});

test('restores ten compact traces and enables the composer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') return sessionsResponse([defaultSessions()[0]]);
      if (url === `/api/session/${activeSessionID}`) return compactTenTurnSessionDetailResponse();
      if (url === '/api/token-budget') return tokenBudgetResponse();
      if (url === '/api/kg/overview') return { ok: true, json: async () => sessionKGOverview };
      return { ok: true, json: async () => ({}) };
    }),
  );

  render(<SessionDemoPage />);

  await waitFor(() => expect(screen.getByText('agent turn 10')).toBeInTheDocument());
  expect(screen.getAllByText('Query rewrite')).toHaveLength(10);
  expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
});

test('keeps the prior KG graph mounted and unrendered when preparing a node question', async () => {
  render(<SessionDemoPage />);
  await screen.findByText('current student message');
  await expandTracePanel('KG nodes and path');
  const canvas = await screen.findByLabelText('Knowledge path force graph');
  fireEvent.click(within(canvas).getByRole('button', { name: 'Select KG node Concept:index' }));
  const nodeDetail = screen.getByRole('region', { name: 'Selected knowledge node' });
  const beforeAskRenderCount = sessionCanvasProps.length;
  const beforeAsk = sessionCanvasProps.at(-1)!;

  fireEvent.click(within(nodeDetail).getByRole('button', { name: 'Ask about this node' }));

  expect(screen.getByText('Asking about index')).toBeInTheDocument();
  expect(screen.getByLabelText('Knowledge path force graph')).toBe(canvas);
  expect(screen.getByRole('region', { name: 'Selected knowledge node' })).toHaveTextContent('index');
  expect(sessionCanvasProps).toHaveLength(beforeAskRenderCount);
  expect(sessionCanvasProps.at(-1)!.graph).toBe(beforeAsk.graph);
  expect(sessionCanvasProps.at(-1)!.ports).toBe(beforeAsk.ports);
});

test('shows the student turn and query rewrite spinner immediately while backend is pending', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse();
      }
      if (url === `/api/session/${activeSessionID}`) {
        return sessionDetailResponse(activeSessionID);
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      return new Promise(() => {});
    }),
  );

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'student list question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  expect(screen.getByText('student list question')).toBeInTheDocument();
  expect(screen.getAllByText('Query rewrite').length).toBeGreaterThan(0);
  expect(screen.getByText('Rewriting the student question...')).toBeInTheDocument();
  expect(screen.getByText('Thinking')).toBeInTheDocument();
});

test('keeps Shift Enter as multiline input and submits only on plain Enter', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse();
      }
      if (url === `/api/session/${activeSessionID}`) {
        return sessionDetailResponse(activeSessionID);
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      return new Promise(() => {});
    }),
  );

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'line one' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });

  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === '/api/kg/overview')).toHaveLength(0);
  expect(composer).toHaveValue('line one');
  expect(screen.queryByText('Thinking')).not.toBeInTheDocument();

  fireEvent.change(composer, { target: { value: 'line one\nline two' } });
  expect(composer).toHaveValue('line one\nline two');

  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  expect(screen.getByText(/line one\s+line two/)).toBeInTheDocument();
  expect(screen.getByText('Thinking')).toBeInTheDocument();
});

test('New creates one session and keeps older sessions visible', async () => {
  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  await selectIndexAndRequestFocus();

  fireEvent.click(screen.getByRole('button', { name: /New/ }));

  await waitFor(() =>
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/session/start',
      expect.objectContaining({
        method: 'POST',
      }),
    ),
  );
  expect(screen.getAllByText('session-ui-test').length).toBeGreaterThan(0);
  expect(screen.getByText(olderSessionLabel)).toBeInTheDocument();
  expect(screen.queryByLabelText('Remove knowledge node focus')).not.toBeInTheDocument();
}, 15_000);

test('deleting a session selects the newest remaining session without calling current', async () => {
  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  await selectIndexAndRequestFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));

  await waitFor(() =>
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/session/${activeSessionID}`, {
      method: 'DELETE',
    }),
  );
  await waitFor(() => expect(screen.getByText('older session student message')).toBeInTheDocument());
  expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/session/current');
  expect(screen.queryByLabelText('Remove knowledge node focus')).not.toBeInTheDocument();
});

test('deleting the last session leaves empty state and does not call current', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse(defaultSessions().slice(0, 1));
      }
      if (url === `/api/session/${activeSessionID}`) {
        return sessionDetailResponse(activeSessionID);
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    }),
  );

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete session' })).toBeDisabled());
  expect(screen.queryByText('No active conversation')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete session' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/session/current');
}, 15_000);

test('session_not_found during send does not retry against another session', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') {
      return sessionsResponse();
    }
    if (url === `/api/session/${activeSessionID}`) {
      return sessionDetailResponse(activeSessionID);
    }
    if (url === '/api/token-budget') {
      return tokenBudgetResponse();
    }
    if (url === '/api/session/message/stream') {
      return {
        ok: false,
        json: async () => ({ error: 'session_not_found' }),
      };
    }
    return {
      ok: true,
      json: async () => ({}),
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'student list question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() =>
    expect(screen.getByText('Request failed: the selected session no longer exists. Please choose another conversation or create a new one.')).toBeInTheDocument(),
  );
  const streamCalls = fetchMock.mock.calls.filter(([input]) => String(input) === '/api/session/message/stream');
  expect(streamCalls).toHaveLength(1);
});

test('renders stream errors in English', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions?status=active') {
        return sessionsResponse();
      }
      if (url === `/api/session/${activeSessionID}`) {
        return sessionDetailResponse(activeSessionID);
      }
      if (url === '/api/token-budget') {
        return tokenBudgetResponse();
      }
      if (url === '/api/session/message/stream') {
        return ndjsonResponse([
          { type: 'trace_started', session_id: activeSessionID, turn_id: '1' },
          {
            type: 'trace_error',
            session_id: activeSessionID,
            turn_id: '1',
            failed_stage: 'guided_response',
            error_message: 'The response failed while processing guided_response. Please try again.',
          },
        ]);
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    }),
  );

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: 'student list question' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  await waitFor(() => expect(screen.getByText('The response failed while processing guided_response. Please try again.')).toBeInTheDocument());
});

test('keeps ordinary chat and Test usable at zero token budget', async () => {
  const defaultFetch = vi.mocked(fetch);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/token-budget') {
        return tokenBudgetResponse({
          used_tokens: 24000,
          remaining_tokens: 0,
          remaining_percent: 0,
        });
      }
      return defaultFetch(input, init);
    }),
  );

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const budget = screen.getByLabelText('Token budget');
  expect(budget).toBeInTheDocument();
  expect(within(budget).getByText('Token budget')).toBeVisible();
  expect(budget).toHaveTextContent(
    'Direct-answer requests are unavailable until the token budget resets. Ordinary chat and Test remain available.',
  );
  const composer = screen.getByPlaceholderText(composerPlaceholder);
  expect(composer).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();

  fireEvent.change(composer, { target: { value: '再解释一下 dictionary' } });

  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('does not declare the budget exhausted when positive tokens round to zero percent', async () => {
  const defaultFetch = vi.mocked(fetch);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/token-budget') {
        return tokenBudgetResponse({
          used_tokens: 23999,
          remaining_tokens: 1,
          remaining_percent: 0,
        });
      }
      return defaultFetch(input, init);
    }),
  );

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const budget = screen.getByLabelText('Token budget');
  expect(within(budget).getByText('Token budget')).toBeVisible();
  expect(budget).toHaveTextContent('0%');
  expect(
    within(budget).queryByText(
      'Direct-answer requests are unavailable until the token budget resets. Ordinary chat and Test remain available.',
    ),
  ).not.toBeInTheDocument();
});

test('keeps the composer usable after a direct-answer exhausted stream error', async () => {
  let streamRequestCount = 0;
  const exhaustedBudget = {
    scope: 'global-demo',
    daily_quota: 24000,
    used_tokens: 24000,
    remaining_tokens: 0,
    remaining_percent: 0,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions?status=active') {
      return sessionsResponse();
    }
    if (url === `/api/session/${activeSessionID}`) {
      return sessionDetailResponse(activeSessionID);
    }
    if (url === '/api/token-budget') {
      return tokenBudgetResponse(exhaustedBudget);
    }
    if (url === '/api/kg/overview') {
      return { ok: true, json: async () => sessionKGOverview };
    }
    if (url === '/api/session/message/stream') {
      streamRequestCount += 1;
      if (streamRequestCount === 1) {
        return ndjsonResponse([
          { type: 'trace_started', session_id: activeSessionID, turn_id: '1' },
          {
            type: 'trace_error',
            session_id: activeSessionID,
            turn_id: '1',
            failed_stage: 'token_budget',
            error_message: 'Direct-answer requests are unavailable until the token budget resets.',
            token_budget: exhaustedBudget,
          },
        ]);
      }
      return ndjsonResponse(fullTraceEvents());
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SessionDemoPage />);
  await waitFor(() => expect(screen.getAllByText(activeSessionLabel).length).toBeGreaterThan(0));

  const composer = screen.getByPlaceholderText(composerPlaceholder);
  fireEvent.change(composer, { target: { value: '请直接给我完整答案' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() =>
    expect(screen.getByText('Direct-answer requests are unavailable until the token budget resets.')).toBeInTheDocument(),
  );
  await waitFor(() => expect(composer).toBeEnabled());

  fireEvent.change(composer, { target: { value: '再解释一下 dictionary' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => expect(screen.getByText(learningTrace.answer)).toBeInTheDocument());
  const streamBodies = streamRequestBodies(fetchMock);
  expect(streamBodies).toHaveLength(2);
  expect(streamBodies[1]).toMatchObject({ message: '再解释一下 dictionary' });
  expect(screen.getByLabelText('Token budget')).toHaveTextContent('0%');
  expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
});
