import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import SessionReviewPage from './index';

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
      if (url === '/api/sessions') {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              {
                id: 'session-review-001',
                scenario: 'index-error',
                status: 'active',
                updated_at: '2026-07-07T08:00:00Z',
              },
            ],
          }),
        };
      }

      if (url === '/api/session/session-review-001') {
        return {
          ok: true,
          json: async () => ({
            session: {
              id: 'session-review-001',
              scenario: 'index-error',
              status: 'active',
            },
            messages: [
              { id: 'm1', role: 'student', content: '为什么 list[2] 会错？' },
              { id: 'm2', role: 'agent', content: '先看 list 的长度。' },
            ],
            evidence_events: [
              { id: 10, event_type: 'ai_step', payload: { learning_trace: { guided_response: 'check indices' } } },
            ],
          }),
        };
      }

      if (url === '/api/session/session-review-001/evidence') {
        return {
          ok: true,
          json: async () => ({
            events: [
              {
                id: 10,
                event_type: 'ai_step',
                payload: {
                  skill_id: 'student-learning/retrieve-first-gate',
                  workflow_trace: [
                    { skill_id: 'student-learning/retrieve-first-gate', status: 'active' },
                    { skill_id: 'student-learning/progressive-hint-ladder', status: 'queued' },
                    { skill_id: 'student-learning/stuck-and-error-diagnosis-coach', status: 'queued' },
                    { skill_id: 'student-learning/confidence-calibration-check', status: 'queued' },
                    { skill_id: 'student-learning/teach-back-evaluator', status: 'queued' },
                  ],
                  evidence: {
                    confidence_before: 3,
                    teach_back: 'required',
                    cognitive_gate: 'retrieval',
                  },
                  memory_updates: [
                    {
                      operation: 'ADD',
                      memory_id: 'memory-index-range',
                      memory_type: 'misconception',
                      topic: 'list_index_indexerror',
                      reason: 'salient_misconception',
                    },
                  ],
                  memory_reinforcement: [{ operation: 'REINFORCE', memory_id: 'memory-index-range' }],
                  memory_reading_plan: {
                    prospective_memory_plan: 'Use index misconception memory before hinting.',
                    selected_memory_ids: ['memory-index-range'],
                  },
                  retrospective_memory_use: {
                    retrospective_memory_use: 'Used 1 selected memory.',
                    retrieval_refinement: 'Keep this topic high priority.',
                    used_memory_ids: ['memory-index-range'],
                  },
                  topic_summary_update: {
                    topic: 'list_index_indexerror',
                    topic_summary: 'Student is working on valid index range.',
                    next_teaching_action: 'ask_teach_back',
                  },
                  learning_facts: [
                    {
                      subject: 'Learner:anonymous-demo',
                      predicate: 'has_misconception',
                      object: 'Concept:valid_index_range',
                      valid_from: '2026-07-07T08:00:00Z',
                    },
                  ],
                  rag_sources: [
                    {
                      title: '3.1.3. Lists',
                      chunk_id: 'python-docs-3.14.6-824a5cfe4526',
                      rerank_score: 0.455,
                      source_url: 'https://docs.python.org/3/tutorial/introduction.html#lists',
                    },
                  ],
                  kg_path: ['Concept:list', 'Concept:index', 'ErrorType:IndexError'],
                },
              },
            ],
          }),
        };
      }

      return { ok: false, json: async () => ({ error: 'unexpected_url' }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('lists sessions and opens a read-only message and evidence review', async () => {
  render(<SessionReviewPage />);

  await waitFor(() => expect(screen.getByText('session-review-001')).toBeInTheDocument());
  fireEvent.click(screen.getByText('session-review-001'));

  await waitFor(() => expect(screen.getByText('为什么 list[2] 会错？')).toBeInTheDocument());

  expect(screen.getByText('Session Review / 会话复盘')).toBeInTheDocument();
  expect(screen.getByText('Messages / 对话记录')).toBeInTheDocument();
  expect(screen.getByText('Evidence / 证据')).toBeInTheDocument();
  expect(screen.getByText('Mem0 memory events / Mem0 记忆事件')).toBeInTheDocument();
  expect(screen.getByText('MemoryBank long-term memory / MemoryBank 长期记忆')).toBeInTheDocument();
  expect(screen.getByText('RMM reflection / RMM 反思')).toBeInTheDocument();
  expect(screen.getByText('Zep-style temporal facts / Zep 时间事实')).toBeInTheDocument();
  expect(screen.getByText('Pedagogical skills / 教学技能')).toBeInTheDocument();
  expect(screen.getByText('RAG + KG grounding / RAG 与知识图谱依据')).toBeInTheDocument();
  expect(screen.getAllByText('student-learning/retrieve-first-gate').length).toBeGreaterThan(0);
  expect(screen.getByText('ADD')).toBeInTheDocument();
  expect(screen.getAllByText('memory-index-range').length).toBeGreaterThan(0);
  expect(screen.getByText('Use index misconception memory before hinting.')).toBeInTheDocument();
  expect(screen.getByText('Used 1 selected memory.')).toBeInTheDocument();
  expect(screen.getByText('Concept:list -> Concept:index -> ErrorType:IndexError')).toBeInTheDocument();
  expect(screen.getByText('3.1.3. Lists')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/sessions', {
    headers: { 'X-REA-Admin-Access': '1' },
  });
  expect(fetch).toHaveBeenCalledWith('/api/session/session-review-001', {
    headers: { 'X-REA-Admin-Access': '1' },
  });
  expect(fetch).toHaveBeenCalledWith('/api/session/session-review-001/evidence', {
    headers: { 'X-REA-Admin-Access': '1' },
  });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Send/i })).not.toBeInTheDocument();
});
