export type AgentStep = {
  skill_id: string;
  baseline_mode?: string;
  requires_student_attempt: boolean;
  direct_answer_given: boolean;
  kg_path: string[];
  kg_algorithm?: string;
  intent?: string;
  rewritten_query?: string;
  concept_hints?: string[];
  chat_model?: string;
  llm_used?: boolean;
  llm_fallback?: boolean;
  fallback_reason?: string;
  teaching_strategy?: string;
  rag_retrieval_mode?: string;
  rag_kg_guided?: boolean;
  rag_index?: {
    backend?: string;
    embedding_provider?: string;
    embedding_model?: string;
  };
  rag_reranker?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    candidate_count?: number;
  };
  rag_sources: Array<{
    chunk_id: string;
    source_id?: string;
    source: string;
    source_license_note?: string;
    score?: number;
    embedding_score?: number;
    rerank_score?: number;
    source_url?: string;
    title?: string;
    heading_path?: string[] | string;
  }>;
  memory_used?: boolean;
  memory_context?: {
    short_term_count?: number;
    long_term_count?: number;
    mid_term_state_keys?: string[];
    retrieved_memory_ids?: string[];
    active_topics?: string[];
    rmm?: {
      prospective_memory_plan?: {
        selected_memory_ids?: string[];
        prospective_memory_plan?: string;
      };
    };
  };
  memory_reading_plan?: {
    selected_memory_ids?: string[];
    prospective_memory_plan?: string;
    selected_topic_summary?: {
      topic_summary?: string;
      weak_concepts?: string[];
      mastered_concepts?: string[];
      next_teaching_action?: string;
    } | null;
  } | null;
  memory_reinforcement?: Array<{
    operation?: string;
    memory_id?: string;
    reason?: string;
  }>;
  retrospective_memory_use?: {
    retrospective_memory_use?: string;
    retrieval_refinement?: string;
    used_memory_ids?: string[];
  } | null;
  topic_summary_update?: {
    topic?: string;
    topic_summary?: string;
    weak_concepts?: string[];
    mastered_concepts?: string[];
    next_teaching_action?: string;
    source_memory_ids?: string[];
  } | null;
  learning_facts?: Array<{
    fact_id?: string;
    subject?: string;
    predicate?: string;
    object?: string;
    confidence?: number;
  }>;
  next_task_state?: Record<string, unknown>;
  session_context?: {
    short_term_memory?: {
      policy?: string;
      max_messages?: number;
      message_count?: number;
      messages?: Array<{ role?: string; content?: string }>;
    };
    mid_term_memory?: {
      policy?: string;
      topic?: string;
      workflow_state?: string;
      task_state?: Record<string, unknown>;
    };
    long_term_memory?: {
      memory_policy?: string;
      selected_memory_ids?: string[];
      memory_update_count?: number;
      topic_summary_update?: AgentStep['topic_summary_update'];
      learning_fact_count?: number;
    };
  };
  memory_updates?: Array<{
    operation?: string;
    target_memory_id?: string;
    memory_id?: string;
    memory_type?: string;
    topic?: string;
    content?: string;
    reason?: string;
  }>;
  evidence: {
    baseline_mode?: string;
    cognitive_gate?: string;
    confidence_before?: string | number | null;
    confidence_after?: string | number | null;
    reflection?: string | null;
    teach_back?: string;
    memory_used?: boolean;
    memory_context?: AgentStep['memory_context'];
  };
};

export type KnowledgePathNode = {
  id: string;
  label: string;
  type?: string;
};

export type ConversationRelation =
  | 'start'
  | 'continue'
  | 'clarify_current'
  | 'switch_topic'
  | 'kg_explore'
  | 'resume_previous'
  | 'resume_named'
  | 'greeting'
  | 'off_topic'
  | 'unresolved';

export type SelectionUsage = 'used' | 'not_used' | 'absent';

export type WorkflowAction = 'initialize' | 'continue' | 'restore' | 'preserve_without_advance';

export type TopicTransition = {
  kind: 'switch' | 'resume';
  from_label: string;
  to_label: string;
};

export type TurnResolution = {
  schema_version: 1;
  original_message: string;
  resolved_question: string;
  resolved_intent: string;
  conversation_relation: ConversationRelation;
  active_topic_before?: string | null;
  active_topic_after?: string | null;
  target_topic_id?: string | null;
  context_source_event_ids: string[];
  selected_node: {
    node_id?: string | null;
    label?: string | null;
    usage: SelectionUsage;
    reason: string;
  };
  topic_transition?: TopicTransition | null;
  workflow_action: WorkflowAction;
  retrieval_query: string;
  resolution_confidence: number;
  ambiguity_reason?: string | null;
};

export type ResponseContract = {
  selected_node_label?: string | null;
  selected_node_usage: SelectionUsage;
  topic_transition?: TopicTransition | null;
  context_label?: 'Previous Context' | 'Resumed Context' | null;
  context_summary?: string | null;
  answer_language: 'Chinese' | 'English';
  answer_body: string;
  topic_summary_update?: string | null;
};

export type SessionMessageRequest = {
  client_turn_id: string;
  session_id: string;
  message: string;
  original_question: string;
  baseline_mode: string;
  learner_id: string;
  requested_focus_node_id?: string;
};

export type KnowledgePathEdge = {
  from: string;
  to: string;
  type?: string;
  relation?: string;
  traversal?: 'forward' | 'reverse';
  segment?: string;
};

export type KnowledgePathView = {
  path_id?: string;
  upstream?: KnowledgePathNode[];
  current?: KnowledgePathNode[];
  downstream?: KnowledgePathNode[];
  edges?: KnowledgePathEdge[];
  focus_node_ids?: string[];
};

export type LearningTrace = {
  session_id?: string;
  turn_id?: string;
  message_id?: string;
  query_understanding: {
    original_question?: string;
    intent?: string;
    rewritten_query?: string;
    concept_hints?: string[];
  };
  kg_grounding: {
    selected_node_ids?: string[];
    nodes?: Array<{
      id: string;
      label: string;
      type: string;
    }>;
    paths?: Array<{
      path_id?: string;
      nodes: string[];
      relations?: string[];
      label?: string;
    }>;
    upstream?: string[];
    current?: string[];
    downstream?: string[];
    knowledge_path_view?: KnowledgePathView;
  };
  rag_evidence: Array<{
    rank: number;
    title: string;
    source?: string;
    heading_path?: string;
    url?: string;
    score?: number;
    snippet?: string;
  }>;
  teaching_decision?: {
    skill?: string;
    hint_level?: number;
    direct_answer?: boolean;
  };
  turn_resolution?: TurnResolution;
  response_contract?: ResponseContract;
  answer: string;
};

export type TraceStageStatus = 'waiting' | 'running' | 'finish' | 'error';
export type TraceStageKey = 'query_understanding' | 'kg_grounding' | 'rag_evidence' | 'guided_response';
export type TraceStageStatusMap = Record<TraceStageKey, TraceStageStatus>;

export type TokenBudget = {
  scope?: string;
  daily_quota: number;
  used_tokens: number;
  remaining_tokens: number;
  remaining_percent: number;
  reset_at?: string;
  updated_at?: string;
};

export type LearningTraceStreamEvent =
  | {
      type: 'trace_started';
      session_id?: string;
      turn_id?: string;
      stage_status?: Partial<TraceStageStatusMap>;
    }
  | {
      type: 'query_understanding_done';
      session_id?: string;
      turn_id?: string;
      query_understanding: LearningTrace['query_understanding'];
      stage_status?: Partial<TraceStageStatusMap>;
    }
  | {
      type: 'kg_grounding_done';
      session_id?: string;
      turn_id?: string;
      kg_grounding: LearningTrace['kg_grounding'];
      stage_status?: Partial<TraceStageStatusMap>;
    }
  | {
      type: 'rag_evidence_done';
      session_id?: string;
      turn_id?: string;
      rag_evidence: LearningTrace['rag_evidence'];
      stage_status?: Partial<TraceStageStatusMap>;
    }
  | {
      type: 'guided_response_done';
      session_id?: string;
      turn_id?: string;
      answer: string;
      teaching_decision?: LearningTrace['teaching_decision'];
      stage_status?: Partial<TraceStageStatusMap>;
    }
  | {
      type: 'trace_completed';
      session_id?: string;
      turn_id?: string;
      agent_message_id?: number | string;
      prompt?: string;
      turn_resolution?: TurnResolution;
      response_contract?: ResponseContract;
      learning_trace?: LearningTrace;
      stage_status?: Partial<TraceStageStatusMap>;
    }
  | {
      type: 'token_budget_updated';
      token_budget: TokenBudget;
      timestamp?: string;
    }
  | {
      type: 'trace_error';
      session_id?: string;
      turn_id?: string;
      failed_stage?: TraceStageKey | string;
      error_message?: string;
      token_budget?: TokenBudget;
      stage_status?: Partial<TraceStageStatusMap>;
    };

export type ChatMessage = {
  id: string;
  role: 'student' | 'agent';
  content: string;
  pending?: boolean;
  error?: boolean;
  streaming?: boolean;
  stage_status?: TraceStageStatusMap;
  partial_trace?: Partial<LearningTrace>;
  trace?: LearningTrace;
};

export type ComposerKeyIntentInput = {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
};

export type EvidenceItem = {
  label: string;
  value: string;
};

export type EvidenceSection = {
  id: string;
  title: string;
  items: EvidenceItem[];
};

export function composerIntent(event: ComposerKeyIntentInput): 'submit' | 'newline' | 'ignore' {
  if (event.isComposing) {
    return 'ignore';
  }
  if (event.key !== 'Enter') {
    return 'ignore';
  }
  return event.shiftKey ? 'newline' : 'submit';
}

export function buildOptimisticExchange(current: ChatMessage[], content: string, timestamp: number): ChatMessage[] {
  return [
    ...current,
    {
      id: `student-${timestamp}`,
      role: 'student',
      content,
    },
  ];
}

export function replacePendingAgent(current: ChatMessage[], content: string, error = false, trace?: LearningTrace): ChatMessage[] {
  return current.map((item) =>
    item.pending || item.streaming
      ? {
          ...item,
          content,
          pending: false,
          streaming: false,
          error,
          trace,
        }
      : item,
  );
}

export function initialTraceStageStatus(): TraceStageStatusMap {
  return {
    query_understanding: 'running',
    kg_grounding: 'waiting',
    rag_evidence: 'waiting',
    guided_response: 'waiting',
  };
}

export function appendStreamingAgentStarted(current: ChatMessage[], timestamp: number): ChatMessage[] {
  return [
    ...current,
    {
      id: `agent-stream-${timestamp}`,
      role: 'agent',
      content: '',
      streaming: true,
      pending: false,
      stage_status: initialTraceStageStatus(),
      partial_trace: {},
    },
  ];
}

function mergeStageStatus(base: TraceStageStatusMap | undefined, patch?: Partial<TraceStageStatusMap>): TraceStageStatusMap {
  return {
    ...initialTraceStageStatus(),
    ...(base ?? {}),
    ...(patch ?? {}),
  };
}

function stageStatusForEvent(event: LearningTraceStreamEvent, current?: TraceStageStatusMap): TraceStageStatusMap {
  if (event.type === 'trace_started') {
    return mergeStageStatus(current, {
      query_understanding: 'running',
      kg_grounding: 'waiting',
      rag_evidence: 'waiting',
      guided_response: 'waiting',
      ...event.stage_status,
    });
  }
  if (event.type === 'query_understanding_done') {
    return mergeStageStatus(current, {
      query_understanding: 'finish',
      kg_grounding: 'running',
      rag_evidence: 'waiting',
      guided_response: 'waiting',
      ...event.stage_status,
    });
  }
  if (event.type === 'kg_grounding_done') {
    return mergeStageStatus(current, {
      query_understanding: 'finish',
      kg_grounding: 'finish',
      rag_evidence: 'running',
      guided_response: 'waiting',
      ...event.stage_status,
    });
  }
  if (event.type === 'rag_evidence_done') {
    return mergeStageStatus(current, {
      query_understanding: 'finish',
      kg_grounding: 'finish',
      rag_evidence: 'finish',
      guided_response: 'running',
      ...event.stage_status,
    });
  }
  if (event.type === 'guided_response_done' || event.type === 'trace_completed') {
    return mergeStageStatus(current, {
      query_understanding: 'finish',
      kg_grounding: 'finish',
      rag_evidence: 'finish',
      guided_response: 'finish',
      ...event.stage_status,
    });
  }
  if (event.type === 'token_budget_updated') {
    return mergeStageStatus(current);
  }
  const failedStage = event.failed_stage as TraceStageKey | undefined;
  return mergeStageStatus(current, {
    [failedStage && failedStage in initialTraceStageStatus() ? failedStage : 'guided_response']: 'error',
    ...event.stage_status,
  });
}

function updateStreamingMessage(message: ChatMessage, event: LearningTraceStreamEvent): ChatMessage {
  const status = stageStatusForEvent(event, message.stage_status);
  const partial: Partial<LearningTrace> = { ...(message.partial_trace ?? {}) };

  if ('turn_id' in event && event.turn_id) {
    partial.turn_id = event.turn_id;
  }

  if (event.type === 'query_understanding_done') {
    partial.query_understanding = event.query_understanding;
  }
  if (event.type === 'kg_grounding_done') {
    partial.kg_grounding = event.kg_grounding;
  }
  if (event.type === 'rag_evidence_done') {
    partial.rag_evidence = event.rag_evidence;
  }
  if (event.type === 'guided_response_done') {
    partial.answer = event.answer;
    if (event.teaching_decision) {
      partial.teaching_decision = event.teaching_decision;
    }
  }
  if (event.type === 'trace_completed' && event.learning_trace) {
    const completedTrace: LearningTrace = {
      ...event.learning_trace,
      ...(event.turn_id && !event.learning_trace.turn_id ? { turn_id: event.turn_id } : {}),
      turn_resolution: event.learning_trace.turn_resolution ?? event.turn_resolution,
      response_contract: event.learning_trace.response_contract ?? event.response_contract,
    };
    return {
      ...message,
      id: event.agent_message_id !== undefined ? String(event.agent_message_id) : message.id,
      content: completedTrace.answer ?? message.content,
      streaming: false,
      pending: false,
      error: false,
      stage_status: status,
      partial_trace: undefined,
      trace: completedTrace,
    };
  }
  if (event.type === 'token_budget_updated') {
    return message;
  }
  if (event.type === 'trace_error') {
    return {
      ...message,
      content: event.error_message ?? 'The response failed. Please try again.',
      streaming: false,
      pending: false,
      error: true,
      stage_status: status,
      partial_trace: partial,
    };
  }
  return {
    ...message,
    content: event.type === 'guided_response_done' ? event.answer : message.content,
    streaming: true,
    pending: false,
    error: false,
    stage_status: status,
    partial_trace: partial,
  };
}

export function applyTraceStreamEvent(current: ChatMessage[], event: LearningTraceStreamEvent, timestamp = Date.now()): ChatMessage[] {
  const lastStreamingIndex = current.findLastIndex((item) => item.role === 'agent' && item.streaming);
  if (lastStreamingIndex === -1) {
    return appendStreamingAgentStarted(current, timestamp).map((item, index, all) =>
      index === all.length - 1 ? updateStreamingMessage(item, event) : item,
    );
  }
  return current.map((item, index) => (index === lastStreamingIndex ? updateStreamingMessage(item, event) : item));
}

export function buildEvidenceItems(step: AgentStep): EvidenceItem[] {
  return buildEvidenceSections(step).flatMap((section) => section.items);
}

export function buildEvidenceSections(step: AgentStep): EvidenceSection[] {
  const firstSource = step.rag_sources[0];
  const index = step.rag_index;
  const reranker = step.rag_reranker;
  const memoryContext = step.memory_context ?? step.evidence.memory_context;
  const memoryUpdates = step.memory_updates ?? [];
  const reinforcement = step.memory_reinforcement ?? [];
  const facts = step.learning_facts ?? [];
  const summary = step.topic_summary_update;
  const readingPlan = step.memory_reading_plan;

  return [
    {
      id: 'skill-workflow',
      title: 'Skill workflow',
      items: [
        { label: 'Skill', value: step.skill_id },
        { label: 'Baseline mode', value: step.baseline_mode ?? step.evidence.baseline_mode ?? 'full_memory' },
        { label: 'Student attempt required', value: step.requires_student_attempt ? 'Yes' : 'No' },
        { label: 'Direct answer given', value: step.direct_answer_given ? 'Yes' : 'No' },
        { label: 'Cognitive gate', value: step.evidence.cognitive_gate ?? 'pending' },
        { label: 'Teaching strategy', value: step.teaching_strategy ?? 'pending' },
        { label: 'Intent', value: step.intent ?? 'pending' },
      ],
    },
    {
      id: 'metacognition',
      title: 'Metacognition',
      items: [
        { label: 'Confidence before', value: `${step.evidence.confidence_before ?? 'pending'}` },
        { label: 'Confidence after', value: `${step.evidence.confidence_after ?? 'pending'}` },
        { label: 'Teach-back', value: step.evidence.teach_back ?? 'pending' },
        { label: 'Reflection', value: step.evidence.reflection ?? 'pending' },
      ],
    },
    {
      id: 'memory',
      title: 'Memory',
      items: [
        { label: 'Memory used', value: step.memory_used ?? step.evidence.memory_used ? 'Yes' : 'No' },
        { label: 'Short-term memory', value: `${memoryContext?.short_term_count ?? 0} messages` },
        { label: 'Long-term memory', value: `${memoryContext?.long_term_count ?? 0} memories` },
        {
          label: 'Memory updates',
          value: memoryUpdates.length > 0 ? memoryUpdates.map((update) => update.operation ?? 'UNKNOWN').join(', ') : 'none',
        },
        {
          label: 'Memory reinforcement',
          value:
            reinforcement.length > 0
              ? reinforcement.map((item) => `${item.operation ?? 'REINFORCE'} ${item.memory_id ?? ''}`.trim()).join(', ')
              : 'none',
        },
        {
          label: 'Selected memory IDs',
          value: readingPlan?.selected_memory_ids?.join(', ') || memoryContext?.retrieved_memory_ids?.join(', ') || 'none',
        },
        { label: 'Active topics', value: memoryContext?.active_topics?.join(', ') || 'none' },
        {
          label: 'RMM reading plan',
          value: readingPlan?.prospective_memory_plan ?? memoryContext?.rmm?.prospective_memory_plan?.prospective_memory_plan ?? 'pending',
        },
        { label: 'Retrospective', value: step.retrospective_memory_use?.retrospective_memory_use ?? 'pending' },
        { label: 'Retrieval refinement', value: step.retrospective_memory_use?.retrieval_refinement ?? 'pending' },
        { label: 'Topic summary', value: summary?.topic_summary ?? readingPlan?.selected_topic_summary?.topic_summary ?? 'pending' },
      ],
    },
    {
      id: 'grounding',
      title: 'KG + RAG grounding',
      items: [
        { label: 'KG path', value: step.kg_path.join(' -> ') },
        { label: 'KG algorithm', value: step.kg_algorithm ?? 'pending' },
        { label: 'Rewritten query', value: step.rewritten_query ?? 'pending' },
        { label: 'Concept hints', value: step.concept_hints?.join(', ') ?? 'none' },
        { label: 'RAG retrieval', value: step.rag_retrieval_mode ?? 'pending' },
        { label: 'KG-guided RAG', value: step.rag_kg_guided ? 'Yes' : 'No' },
        {
          label: 'Embedding model',
          value: index ? `${index.embedding_provider ?? 'pending'} / ${index.embedding_model ?? 'pending'} / ${index.backend ?? 'pending'}` : 'pending',
        },
        {
          label: 'Reranker',
          value: reranker?.enabled ? `${reranker.provider ?? 'pending'} / ${reranker.model ?? 'pending'} / top ${reranker.candidate_count ?? 0} candidates` : 'disabled',
        },
        {
          label: 'RAG source',
          value: firstSource ? `${firstSource.source} / ${firstSource.chunk_id} / score ${firstSource.score?.toFixed(3) ?? 'n/a'}` : 'pending',
        },
        {
          label: 'RAG scores',
          value: firstSource ? `embedding ${firstSource.embedding_score?.toFixed(3) ?? 'n/a'} / rerank ${firstSource.rerank_score?.toFixed(3) ?? 'n/a'}` : 'pending',
        },
        { label: 'RAG URL', value: firstSource?.source_url ?? 'pending' },
        {
          label: 'Learning facts',
          value: facts.length > 0 ? facts.map((fact) => `${fact.predicate ?? 'fact'} -> ${fact.object ?? 'unknown'}`).join(', ') : 'none',
        },
      ],
    },
    {
      id: 'model',
      title: 'Model execution',
      items: [
        { label: 'Chat model', value: step.chat_model ?? 'pending' },
        { label: 'LLM used', value: step.llm_used ? 'Yes' : 'No' },
        { label: 'LLM fallback', value: step.llm_fallback ? 'Yes' : 'No' },
        { label: 'Fallback reason', value: step.fallback_reason ?? 'none' },
      ],
    },
  ];
}
