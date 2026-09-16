import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import MemoryPage from './index';

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
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        learner_id: 'anonymous-demo',
        research_methods: [
          { name: 'Mem0', implemented: 'salient memory operations: ADD / UPDATE / DELETE / NOOP' },
          { name: 'MemoryBank', implemented: 'strength, use_count, last_used_at, effective_score and forgetting curve' },
          { name: 'RMM', implemented: 'topic summary and retrospective memory-use record' },
          { name: 'Zep temporal graph memory', implemented: 'learning episodes, entities, facts and temporal validity' },
        ],
        active_memory_count: 1,
        topic_summary_count: 1,
        rmm_reflection_count: 1,
        learning_fact_count: 1,
        learning_entity_count: 1,
        memory_event_count: 2,
        short_term_messages: [
          {
            id: 101,
            session_id: 'session-profile',
            role: 'student',
            content: '学生短期窗口：while 循环什么时候停？',
            created_at: '2026-07-04T06:00:01Z',
          },
          {
            id: 102,
            session_id: 'session-profile',
            role: 'agent',
            content: 'AI 短期窗口：先看循环条件何时变为 False。',
            created_at: '2026-07-04T06:00:02Z',
          },
        ],
        learning_episodes: [
          {
            episode_id: 9,
            session_id: 'session-profile',
            topic: 'list_index_indexerror',
            skill_state: 'hint_ladder',
            created_at: '2026-07-04T06:00:00Z',
          },
        ],
        memories: [
          {
            memory_id: 'memory-index-range',
            memory_type: 'misconception',
            topic: 'list_index_indexerror',
            content: '学生认为长度为 2 的 list 可以访问 list[2]。',
            concepts: ['Concept:list', 'Concept:index'],
            strength: 2,
            use_count: 3,
            effective_score: 1.12,
            status: 'active',
            last_used_at: '2026-07-04T05:30:00Z',
            updated_at: '2026-07-04T06:00:00Z',
          },
        ],
        topic_summaries: [
          {
            topic: 'list_index_indexerror',
            topic_summary: '学生正在修正 list 索引边界理解。',
            mastered_concepts: ['Concept:list'],
            weak_concepts: ['Concept:valid_index_range'],
            next_teaching_action: 'ask_teach_back',
            source_memory_ids: ['memory-index-range'],
          },
        ],
        rmm_reflections: [
          {
            episode_id: 9,
            session_id: 'session-profile',
            topic: 'list_index_indexerror',
            skill_state: 'hint_ladder',
            selected_memory_ids: ['rmm-selected-used-memory', 'rmm-selected-unused-memory'],
            used_memory_ids: ['rmm-selected-used-memory'],
            unused_selected_memory_ids: ['rmm-selected-unused-memory'],
            verification_reason: 'model_reported_used_memory_ids',
            prospective_memory_plan: 'Use selected memories for Concept:index.',
            retrospective_memory_use: 'Used 1 of 2 selected memories for list_index_indexerror.',
            retrieval_refinement: 'Keep retrieval weighting for selected memories that were used.',
            selected_topic_summary: {
              topic_summary: '学生需要巩固合法索引范围。',
            },
          },
        ],
        learning_facts: [
          {
            fact_id: 'fact-misconception',
            subject: 'Learner:anonymous-demo',
            predicate: 'has_misconception',
            object: 'Concept:valid_index_range',
            confidence: 0.86,
            status: 'active',
          },
        ],
        learning_entities: [
          {
            entity_id: 'entity-valid-index',
            entity_type: 'concept',
            label: 'Concept:valid_index_range',
            confidence: 0.86,
            status: 'active',
          },
        ],
        memory_events: [
          {
            id: 2,
            session_id: 'session-profile',
            operation: 'REINFORCE',
            result_memory_id: 'memory-index-range',
            reason: 'rmm_selected',
          },
          {
            id: 1,
            session_id: 'session-profile',
            operation: 'ADD',
            result_memory_id: 'memory-index-range',
            reason: 'salient_misconception',
          },
        ],
      }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders learner memory, research mechanisms, facts, and memory events', async () => {
  render(<MemoryPage />);

  await waitFor(() => expect(screen.getAllByText('memory-index-range').length).toBeGreaterThan(0));

  expect(screen.getByText('Mem0')).toBeInTheDocument();
  expect(screen.getByText('MemoryBank')).toBeInTheDocument();
  expect(screen.getByText('RMM')).toBeInTheDocument();
  expect(screen.getByText('Zep temporal graph memory')).toBeInTheDocument();
  expect(screen.getByLabelText('短期记忆更新时间说明')).toBeInTheDocument();
  expect(screen.getByLabelText('中期记忆更新时间说明')).toBeInTheDocument();
  expect(screen.getByLabelText('长期记忆更新时间说明')).toBeInTheDocument();
  expect(screen.getByText('Short-term / 短期：每次学生或 AI 产生消息后更新当前会话窗口。')).toBeInTheDocument();
  expect(screen.getByText('Short-term window / 短期会话窗口')).toBeInTheDocument();
  expect(screen.getByText('学生短期窗口：while 循环什么时候停？')).toBeInTheDocument();
  expect(screen.getByText('AI 短期窗口：先看循环条件何时变为 False。')).toBeInTheDocument();
  expect(screen.getByText('Mid-term / 中期：每轮教学动作完成后更新主题总结、误区和下一步动作。')).toBeInTheDocument();
  expect(screen.getByText('Long-term / 长期：每轮完成后抽取显著学习事实，再执行 Mem0 写入和 MemoryBank 强化/衰减。')).toBeInTheDocument();
  expect(screen.getByText('RMM reflections / RMM 反思记录')).toBeInTheDocument();
  expect(screen.getByText('Learning episodes / Zep 学习事件')).toBeInTheDocument();
  expect(screen.getAllByText('episode 9').length).toBeGreaterThan(0);
  expect(screen.getAllByText('session-profile').length).toBeGreaterThan(0);
  expect(screen.getByText('last_used_at 2026-07-04 05:30:00 UTC')).toBeInTheDocument();
  expect(screen.getByText('Use selected memories for Concept:index.')).toBeInTheDocument();
  expect(screen.getByText('Used 1 of 2 selected memories for list_index_indexerror.')).toBeInTheDocument();
  expect(screen.getByText('Keep retrieval weighting for selected memories that were used.')).toBeInTheDocument();
  expect(screen.getAllByText('rmm-selected-used-memory').length).toBeGreaterThan(0);
  expect(screen.getAllByText('rmm-selected-unused-memory').length).toBeGreaterThan(0);
  expect(screen.getByText('model_reported_used_memory_ids')).toBeInTheDocument();
  expect(screen.getByText('学生正在修正 list 索引边界理解。')).toBeInTheDocument();
  expect(screen.getByText('has_misconception')).toBeInTheDocument();
  expect(screen.getByText('REINFORCE')).toBeInTheDocument();
  expect(screen.getAllByText('Concept:valid_index_range').length).toBeGreaterThan(0);
});
