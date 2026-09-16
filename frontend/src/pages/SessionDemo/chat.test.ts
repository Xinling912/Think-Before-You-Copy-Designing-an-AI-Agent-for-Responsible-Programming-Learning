import { applyTraceStreamEvent, appendStreamingAgentStarted, buildOptimisticExchange, composerIntent, replacePendingAgent } from './model';

test('composer Enter submits while Shift Enter keeps a newline', () => {
  expect(composerIntent({ key: 'Enter', shiftKey: false, isComposing: false })).toBe('submit');
  expect(composerIntent({ key: 'Enter', shiftKey: true, isComposing: false })).toBe('newline');
  expect(composerIntent({ key: 'Enter', shiftKey: false, isComposing: true })).toBe('ignore');
  expect(composerIntent({ key: 'a', shiftKey: false, isComposing: false })).toBe('ignore');
});

test('builds only an optimistic student turn without old pending AI prose', () => {
  const log = buildOptimisticExchange([], 'Why does list[4] fail?', 1720000000000);

  expect(log).toEqual([
    {
      id: 'student-1720000000000',
      role: 'student',
      content: 'Why does list[4] fail?',
    },
  ]);
});

test('appends a streaming AI trace shell with query rewrite running', () => {
  const log = appendStreamingAgentStarted(
    [{ id: 'student-1720000000000', role: 'student', content: 'Why does list[4] fail?' }],
    1720000000000,
  );

  expect(log[1]).toEqual(
    expect.objectContaining({
      id: 'agent-stream-1720000000000',
      role: 'agent',
      streaming: true,
      stage_status: {
        query_understanding: 'running',
        kg_grounding: 'waiting',
        rag_evidence: 'waiting',
        guided_response: 'waiting',
      },
    }),
  );
});

test('applies streaming trace events in order', () => {
  let log = appendStreamingAgentStarted(buildOptimisticExchange([], 'Why does list[4] fail?', 1720000000001), 1720000000001);

  log = applyTraceStreamEvent(log, {
    type: 'query_understanding_done',
    query_understanding: {
      intent: 'error_debugging',
      rewritten_query: 'Python list IndexError valid range',
      concept_hints: ['Concept:list'],
    },
  });
  expect(log[1].stage_status?.query_understanding).toBe('finish');
  expect(log[1].stage_status?.kg_grounding).toBe('running');
  expect(log[1].partial_trace?.query_understanding?.rewritten_query).toBe('Python list IndexError valid range');

  log = applyTraceStreamEvent(log, {
    type: 'guided_response_done',
    answer: 'Length 4 means valid indices are 0 through 3.',
  });
  expect(log[1].stage_status?.guided_response).toBe('finish');
  expect(log[1].content).toBe('Length 4 means valid indices are 0 through 3.');
});

test('retains the stream turn id for knowledge-world path deep links', () => {
  const log = appendStreamingAgentStarted(
    buildOptimisticExchange([], 'Why does list[4] fail?', 1720000000002),
    1720000000002,
  );
  const next = applyTraceStreamEvent(log, {
    type: 'kg_grounding_done',
    turn_id: 'turn-stream-2',
    kg_grounding: {
      knowledge_path_view: {
        current: [{ id: 'Concept:index', label: 'index', type: 'Concept' }],
      },
    },
  });

  expect(next[1].partial_trace?.turn_id).toBe('turn-stream-2');
});

test('retains the completion event turn id when the final trace omits it', () => {
  const log = appendStreamingAgentStarted(
    buildOptimisticExchange([], 'Why does list[4] fail?', 1720000000003),
    1720000000003,
  );
  const next = applyTraceStreamEvent(log, {
    type: 'trace_completed',
    turn_id: 'turn-complete-3',
    learning_trace: {
      query_understanding: {},
      kg_grounding: {},
      rag_evidence: [],
      answer: 'Check the valid index range.',
    },
  });

  expect(next[1].trace?.turn_id).toBe('turn-complete-3');
});

test('replaces only the streaming AI turn with the final answer', () => {
  const log = appendStreamingAgentStarted(
    [{ id: 'agent-old', role: 'agent', content: 'old answer' }, { id: 'student-1720000000001', role: 'student', content: 'Why out of range?' }],
    1720000000001,
  );

  const next = replacePendingAgent(log, 'Check the list length and valid index range first.');

  expect(next).toEqual([
    { id: 'agent-old', role: 'agent', content: 'old answer' },
    { id: 'student-1720000000001', role: 'student', content: 'Why out of range?' },
    {
      id: 'agent-stream-1720000000001',
      role: 'agent',
      content: 'Check the list length and valid index range first.',
      pending: false,
      streaming: false,
      error: false,
      stage_status: {
        query_understanding: 'running',
        kg_grounding: 'waiting',
        rag_evidence: 'waiting',
        guided_response: 'waiting',
      },
      partial_trace: {},
    },
  ]);
});
