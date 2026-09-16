import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ConversationMetadata } from './conversationMetadata';
import type { ResponseContract, TurnResolution } from './model';

const resolution: TurnResolution = {
  schema_version: 1,
  original_message: '这是啥意思？',
  resolved_question: 'Python 的 len 是什么意思？',
  resolved_intent: 'concept_question',
  conversation_relation: 'kg_explore',
  active_topic_before: 'topic-dictionary',
  active_topic_after: 'topic-len',
  target_topic_id: 'topic-len',
  context_source_event_ids: ['event-1'],
  selected_node: {
    node_id: 'Concept:len',
    label: 'len',
    usage: 'used',
    reason: 'current_message_is_referential',
  },
  topic_transition: {
    kind: 'switch',
    from_label: 'dictionary',
    to_label: 'len',
  },
  workflow_action: 'initialize',
  retrieval_query: 'Python len function meaning usage',
  resolution_confidence: 1,
  ambiguity_reason: null,
};

function responseContract(overrides: Partial<ResponseContract> = {}): ResponseContract {
  return {
    selected_node_label: 'len',
    selected_node_usage: 'used',
    topic_transition: null,
    context_label: null,
    context_summary: null,
    answer_language: 'Chinese',
    answer_body: '在 Python 中，len 返回容器中元素的数量。',
    topic_summary_update: null,
    ...overrides,
  };
}

describe('ConversationMetadata', () => {
  test('renders a used selected node exactly once before the structured answer body', () => {
    render(
      <ConversationMetadata
        turnResolution={resolution}
        responseContract={responseContract()}
        legacyAnswer={'Selected Node: len\n\n这是不得重复的完整 prompt。'}
      />,
    );

    expect(screen.getByText('Selected Node: len')).toBeInTheDocument();
    expect(screen.getAllByText(/Selected Node: len/)).toHaveLength(1);
    expect(screen.getByText('在 Python 中，len 返回容器中元素的数量。')).toBeInTheDocument();
    expect(screen.queryByText('这是不得重复的完整 prompt。')).not.toBeInTheDocument();
  });

  test('renders the exact not-used marker once', () => {
    render(
      <ConversationMetadata
        turnResolution={{
          ...resolution,
          selected_node: { ...resolution.selected_node, usage: 'not_used' },
        }}
        responseContract={responseContract({ selected_node_usage: 'not_used' })}
        legacyAnswer="legacy"
      />,
    );

    expect(screen.getByText('Selected Node: len · Not used for this response')).toBeInTheDocument();
    expect(screen.getAllByText(/Selected Node:/)).toHaveLength(1);
  });

  test('renders no selected-node line when selection usage is absent', () => {
    render(
      <ConversationMetadata
        turnResolution={{
          ...resolution,
          selected_node: { node_id: null, label: null, usage: 'absent', reason: 'no_selection' },
        }}
        responseContract={responseContract({ selected_node_label: null, selected_node_usage: 'absent' })}
        legacyAnswer="legacy"
      />,
    );

    expect(screen.queryByText(/Selected Node:/)).not.toBeInTheDocument();
    expect(screen.getByText('在 Python 中，len 返回容器中元素的数量。')).toBeInTheDocument();
  });

  test('renders switch transition and previous summary in the required order', () => {
    render(
      <ConversationMetadata
        turnResolution={resolution}
        responseContract={responseContract({
          topic_transition: { kind: 'switch', from_label: 'dictionary', to_label: 'len' },
          context_label: 'Previous Context',
          context_summary: '学生正在学习 dictionary 的键值对。',
        })}
        legacyAnswer="legacy"
      />,
    );

    const metadata = screen.getByTestId('conversation-metadata');
    expect(metadata.textContent).toBe(
      'Selected Node: lenTopic Transition: dictionary → lenPrevious Context: 学生正在学习 dictionary 的键值对。',
    );
  });

  test('renders resume transition and resumed summary with exact labels', () => {
    render(
      <ConversationMetadata
        turnResolution={{
          ...resolution,
          conversation_relation: 'resume_previous',
          workflow_action: 'restore',
          topic_transition: { kind: 'resume', from_label: 'function', to_label: 'dictionary' },
        }}
        responseContract={responseContract({
          selected_node_label: null,
          selected_node_usage: 'absent',
          topic_transition: { kind: 'resume', from_label: 'function', to_label: 'dictionary' },
          context_label: 'Resumed Context',
          context_summary: '上次留下的 dictionary 问题。',
        })}
        legacyAnswer="legacy"
      />,
    );

    const metadata = screen.getByTestId('conversation-metadata');
    expect(metadata.textContent).toBe(
      'Topic Transition: function → dictionaryResumed Context: 上次留下的 dictionary 问题。',
    );
  });

  test('falls back to the legacy answer only when structured response fields are absent', () => {
    render(<ConversationMetadata legacyAnswer="Legacy answer is unchanged." />);

    expect(screen.getByText('Legacy answer is unchanged.')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-metadata')).not.toBeInTheDocument();
  });
});
