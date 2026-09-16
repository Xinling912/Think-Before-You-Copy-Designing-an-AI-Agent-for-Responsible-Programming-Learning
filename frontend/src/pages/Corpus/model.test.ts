import {
  buildCorpusOutline,
  buildSourceOptions,
  filterChunks,
  formatSummaryStats,
  type CorpusChunk,
  type CorpusSummary,
} from './model';

const chunks: CorpusChunk[] = [
  {
    chunk_id: 'chunk-list',
    doc_id: 'tutorial:datastructures',
    section_id: '5-1-more-on-lists',
    title: '5.1. More on Lists',
    heading_path: ['5. Data Structures', '5.1. More on Lists'],
    source_url: 'https://docs.python.org/3/tutorial/datastructures.html#5-1-more-on-lists',
    text: 'list.pop raises an IndexError. list.index returns zero-based index.',
    char_count: 67,
    code_block_count: 1,
    quality_flags: ['has_code', 'official_source'],
    source: 'Python official documentation',
  },
  {
    chunk_id: 'chunk-text',
    doc_id: 'tutorial:introduction',
    section_id: '3-1-2-text',
    title: '3.1.2. Text',
    heading_path: ['3. An Informal Introduction to Python', '3.1.2. Text'],
    source_url: 'https://docs.python.org/3/tutorial/introduction.html#3-1-2-text',
    text: 'Strings can be indexed and sliced.',
    char_count: 35,
    code_block_count: 0,
    quality_flags: ['official_source'],
    source: 'Python official documentation',
  },
];

test('formats compact corpus summary stats for the header strip', () => {
  const summary: CorpusSummary = {
    version: '3.14.6',
    source_count: 4,
    chunk_count: 142,
    glossary_term_count: 173,
    noise_chunk_count: 0,
    overlong_chunk_count: 0,
    code_chunk_count: 86,
  };

  expect(formatSummaryStats(summary)).toEqual([
    { label: 'Version', value: '3.14.6' },
    { label: 'Sources', value: '4' },
    { label: 'Chunks', value: '142' },
    { label: 'Code chunks', value: '86' },
    { label: 'Glossary terms', value: '173' },
  ]);
});

test('builds source options with total and code chunk counts', () => {
  const summary: CorpusSummary = {
    version: '3.14.6',
    source_count: 1,
    sources: [{ source: 'Python official documentation', count: 2 }],
    chunk_count: 2,
    glossary_term_count: 0,
    noise_chunk_count: 0,
    overlong_chunk_count: 0,
    code_chunk_count: 1,
  };

  expect(buildSourceOptions(chunks, summary)).toEqual([
    { name: 'Python official documentation', count: 2, codeCount: 1 },
  ]);
});

test('filters chunks by source, text, and code-block presence', () => {
  const result = filterChunks(chunks, {
    query: 'IndexError',
    source: 'Python official documentation',
    docId: '',
    hasCode: true,
    qualityFlag: '',
    outlinePath: [],
  });

  expect(result.map((chunk) => chunk.chunk_id)).toEqual(['chunk-list']);
});

test('filters chunks by doc id and quality flag', () => {
  const result = filterChunks(chunks, {
    query: '',
    source: '',
    docId: 'tutorial:introduction',
    hasCode: false,
    qualityFlag: 'official_source',
    outlinePath: [],
  });

  expect(result.map((chunk) => chunk.chunk_id)).toEqual(['chunk-text']);
});

test('builds a nested outline from chunk heading paths', () => {
  const outline = buildCorpusOutline(chunks);

  expect(outline).toEqual([
    {
      title: '5. Data Structures',
      key: '5. Data Structures',
      path: ['5. Data Structures'],
      children: [
        {
          title: '5.1. More on Lists',
          key: '5. Data Structures\u001f5.1. More on Lists',
          path: ['5. Data Structures', '5.1. More on Lists'],
          children: [],
        },
      ],
    },
    {
      title: '3. An Informal Introduction to Python',
      key: '3. An Informal Introduction to Python',
      path: ['3. An Informal Introduction to Python'],
      children: [
        {
          title: '3.1.2. Text',
          key: '3. An Informal Introduction to Python\u001f3.1.2. Text',
          path: ['3. An Informal Introduction to Python', '3.1.2. Text'],
          children: [],
        },
      ],
    },
  ]);
});

test('filters chunks by selected outline path', () => {
  const result = filterChunks(chunks, {
    query: '',
    source: '',
    docId: '',
    hasCode: false,
    qualityFlag: '',
    outlinePath: ['5. Data Structures'],
  });

  expect(result.map((chunk) => chunk.chunk_id)).toEqual(['chunk-list']);
});
