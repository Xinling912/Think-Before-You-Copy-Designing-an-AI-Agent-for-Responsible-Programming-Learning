import { buildEvidenceItems } from './model';

test('builds the learning evidence panel from an agent step', () => {
  const items = buildEvidenceItems({
    skill_id: 'student-learning/retrieve-first-gate',
    baseline_mode: 'full_memory',
    requires_student_attempt: true,
    direct_answer_given: false,
    kg_path: ['Concept:list', 'Concept:index', 'Concept:zero_based_index', 'Concept:valid_index_range', 'ErrorType:IndexError'],
    kg_algorithm: 'weighted-multi-hop-graph-search',
    rag_retrieval_mode: 'local-vector',
    rag_kg_guided: true,
    intent: 'concept_question',
    rewritten_query: 'Python list index zero-based indexing valid index range',
    chat_model: 'qwen3.7-max',
    llm_used: true,
    llm_fallback: false,
    fallback_reason: undefined,
    teaching_strategy: 'retrieve-first-with-evidence',
    rag_index: {
      embedding_model: 'text-embedding-v4',
      embedding_provider: 'dashscope',
      backend: 'faiss-flat-ip',
    },
    rag_reranker: {
      enabled: true,
      model: 'qwen3-rerank',
      provider: 'dashscope',
      candidate_count: 20,
    },
    memory_used: true,
    memory_context: {
      short_term_count: 4,
      long_term_count: 1,
      mid_term_state_keys: ['current_concept', 'hint_level'],
      retrieved_memory_ids: ['mem_index_001'],
      active_topics: ['list_index_indexerror'],
    },
    memory_updates: [
      {
        operation: 'UPDATE',
        target_memory_id: 'mem_index_001',
        memory_type: 'misconception',
        content: 'The learner is still stuck on list[2].',
      },
    ],
    rag_sources: [
      {
        chunk_id: 'python-docs-3.14.6-abc',
        source: 'python-official-docs',
        score: 0.731,
        embedding_score: 0.612,
        rerank_score: 0.731,
        source_url: 'https://docs.python.org/3/tutorial/datastructures.html#more-on-lists',
      },
    ],
    evidence: {
      cognitive_gate: 'retrieval',
      confidence_before: 'pending',
      teach_back: 'required',
    },
  });

  expect(items).toEqual(
    expect.arrayContaining([
      { label: 'Skill', value: 'student-learning/retrieve-first-gate' },
      { label: 'Baseline mode', value: 'full_memory' },
      { label: 'Direct answer given', value: 'No' },
      { label: 'Memory used', value: 'Yes' },
      { label: 'Short-term memory', value: '4 messages' },
      { label: 'Long-term memory', value: '1 memories' },
      { label: 'Memory updates', value: 'UPDATE' },
      { label: 'Selected memory IDs', value: 'mem_index_001' },
      { label: 'Active topics', value: 'list_index_indexerror' },
      {
        label: 'KG path',
        value: 'Concept:list -> Concept:index -> Concept:zero_based_index -> Concept:valid_index_range -> ErrorType:IndexError',
      },
      { label: 'KG algorithm', value: 'weighted-multi-hop-graph-search' },
      { label: 'Intent', value: 'concept_question' },
      { label: 'Rewritten query', value: 'Python list index zero-based indexing valid index range' },
      { label: 'Chat model', value: 'qwen3.7-max' },
      { label: 'LLM used', value: 'Yes' },
      { label: 'LLM fallback', value: 'No' },
      { label: 'Teaching strategy', value: 'retrieve-first-with-evidence' },
      { label: 'RAG retrieval', value: 'local-vector' },
      { label: 'KG-guided RAG', value: 'Yes' },
      { label: 'Embedding model', value: 'dashscope / text-embedding-v4 / faiss-flat-ip' },
      { label: 'Reranker', value: 'dashscope / qwen3-rerank / top 20 candidates' },
      { label: 'RAG source', value: 'python-official-docs / python-docs-3.14.6-abc / score 0.731' },
      { label: 'RAG scores', value: 'embedding 0.612 / rerank 0.731' },
      { label: 'RAG URL', value: 'https://docs.python.org/3/tutorial/datastructures.html#more-on-lists' },
      { label: 'Teach-back', value: 'required' },
    ]),
  );
});
