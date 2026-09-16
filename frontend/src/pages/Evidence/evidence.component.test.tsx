import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import EvidencePage from './index';

const evidenceEvents = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  session_id: 'session-evidence-001',
  student_message_id: 100 + index * 2 + 1,
  agent_message_id: 100 + index * 2 + 2,
  event_type: index % 2 === 0 ? 'rag_grounding' : 'skill_decision',
  created_at: `2026-07-07T0${index}:00:00Z`,
  payload: {
    learner_id: 'learner-evidence-001',
    skill_id: [
      'student-learning/retrieve-first-gate',
      'student-learning/progressive-hint-ladder',
      'student-learning/stuck-and-error-diagnosis-coach',
      'student-learning/confidence-calibration-check',
      'student-learning/teach-back-evaluator',
    ][index % 5],
    evidence: {
      confidence_before: index % 5,
      teach_back: index >= 7 ? 'passed' : 'required',
    },
    diagnosis: {
      retrieval: { status: 'pass', reason: `retrieval evidence ${index + 1}` },
      generation_grounding: { status: 'pass', reason: `grounding evidence ${index + 1}` },
      kg_path: { status: 'pass', reason: 'path includes list -> index -> IndexError' },
      skill_workflow: { status: 'pass', reason: 'skill decision recorded' },
      memory: { status: 'pass', reason: 'short-term and long-term memory read' },
    },
    ragas: {
      context_relevance: { score: 0.8 + index / 100, relevant_sentence_count: 2, retrieved_context_count: 3 },
      answer_faithfulness: { score: 0.7 + index / 100, claims: ['claim grounded in Python docs'] },
      answer_relevance: { score: 0.75 + index / 100, generated_check_questions: ['最大合法索引是多少？'] },
    },
    kg_path: ['Concept:list', 'Concept:index', 'Concept:valid_index_range', 'ErrorType:IndexError'],
    memory_reading_plan: {
      selected_memory_ids: [`memory-${index + 1}`],
      prospective_memory_plan: `Use memory ${index + 1} before hinting.`,
    },
    memory_updates: [
      {
        operation: index % 3 === 0 ? 'ADD' : 'UPDATE',
        memory_id: `memory-${index + 1}`,
        memory_type: 'misconception',
        topic: 'list_index_indexerror',
      },
    ],
    rag_sources: [
      {
        title: '3.1.3. Lists',
        chunk_id: `python-docs-3.14.6-${index + 1}`,
        source_url: 'https://docs.python.org/3/tutorial/introduction.html#lists',
        rerank_score: 0.4 + index / 100,
      },
    ],
  },
}));

const sessionDetail = {
  session: {
    id: 'session-evidence-001',
    scenario: 'python-list-indexerror',
    status: 'active',
  },
  messages: evidenceEvents.flatMap((event, index) => [
    {
      id: event.student_message_id,
      session_id: 'session-evidence-001',
      role: 'student',
      content: `学生第 ${index + 1} 轮问题：为什么这里会报错？`,
      created_at: event.created_at,
    },
    {
      id: event.agent_message_id,
      session_id: 'session-evidence-001',
      role: 'agent',
      content: `AI 第 ${index + 1} 轮回复：先定位本轮涉及的 Python 概念。`,
      created_at: event.created_at,
    },
  ]),
  evidence_events: evidenceEvents,
};

beforeEach(() => {
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

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/sessions?status=all') {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              {
                id: 'session-evidence-001',
                scenario: 'python-list-indexerror',
                status: 'active',
                message_count: 20,
                latest_message_at: '2026-07-07T09:00:00Z',
              },
            ],
          }),
        };
      }
      if (url === '/api/session/session-evidence-001/evidence') {
        return {
          ok: true,
          json: async () => ({
            session_id: 'session-evidence-001',
            events: evidenceEvents,
          }),
        };
      }
      if (url === '/api/session/session-evidence-001') {
        return {
          ok: true,
          json: async () => sessionDetail,
        };
      }
      return { ok: false, json: async () => ({ error: `unexpected_url:${url}` }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('loads real session-bound evidence and renders ten turn-level events with research layers', async () => {
  render(<EvidencePage />);

  await waitFor(() => expect(screen.getAllByText('session-evidence-001').length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getAllByText('10 events / 10 条证据').length).toBeGreaterThan(0));

  expect(screen.getByText('Learner / 学生')).toBeInTheDocument();
  expect(screen.getByText('learner-evidence-001')).toBeInTheDocument();
  expect(screen.getAllByText(/turn /i).length).toBeGreaterThanOrEqual(10);
  expect(screen.getAllByText(/student: 学生第 1 轮问题/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/AI: AI 第 1 轮回复/).length).toBeGreaterThan(0);
  expect(screen.getByText('学生第 1 轮问题：为什么这里会报错？')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/sessions?status=all', {
    headers: { 'X-REA-Admin-Access': '1' },
  });
  expect(fetch).toHaveBeenCalledWith('/api/session/session-evidence-001', {
    headers: { 'X-REA-Admin-Access': '1' },
  });
  expect(screen.getByText('AI 第 1 轮回复：先定位本轮涉及的 Python 概念。')).toBeInTheDocument();

  fireEvent.click(screen.getByText('turn 10'));

  expect(screen.getByText('学生第 10 轮问题：为什么这里会报错？')).toBeInTheDocument();
  expect(screen.getByText('AI 第 10 轮回复：先定位本轮涉及的 Python 概念。')).toBeInTheDocument();
  expect(screen.getByText('Retrieval / 检索')).toBeInTheDocument();
  expect(screen.getByText('Generation Grounding / 生成扎根性')).toBeInTheDocument();
  expect(screen.getByText('KG Path / 知识路径')).toBeInTheDocument();
  expect(screen.getByText('Skill Decision / 教学策略')).toBeInTheDocument();
  expect(screen.getByText('Memory Use / 记忆使用')).toBeInTheDocument();
  expect(screen.getByText('RAGAS')).toBeInTheDocument();
  expect(screen.getByText('Concept:list -> Concept:index -> Concept:valid_index_range -> ErrorType:IndexError')).toBeInTheDocument();
  expect(screen.getByText('Use memory 10 before hinting.')).toBeInTheDocument();
  expect(screen.getAllByText('3.1.3. Lists').length).toBeGreaterThan(0);
});
