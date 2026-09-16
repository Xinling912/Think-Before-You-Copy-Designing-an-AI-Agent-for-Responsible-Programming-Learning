import { SearchOutlined } from '@ant-design/icons';
import { Button, Input, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';

type RAGChunk = {
  chunk_id: string;
  title: string;
  source: string;
  source_url: string;
  heading_path: string[];
  score: number;
  embedding_score: number;
  rerank_score?: number;
  concepts: string[];
};

type RAGResponse = {
  query: string;
  retrieval_mode: string;
  kg_guided: boolean;
  concepts: string[];
  index: {
    backend: string;
    version: string;
    document_count: number;
    dimensions: number;
    path: string;
    docstore_path: string;
    manifest_path: string;
    embedding_provider: string;
    embedding_model: string;
  };
  reranker: {
    enabled: boolean;
    provider: string;
    model: string;
    candidate_count: number;
  };
  chunks: RAGChunk[];
};

type QueryRewriteResponse = {
  intent: string;
  raw_message: string;
  retrieval_query: string;
  concept_hints: string[];
  llm_used: boolean;
  llm_fallback: boolean;
  chat_model: string;
  fallback_reason?: string;
};

type MetricItem = {
  label: string;
  value: string | number;
  wide?: boolean;
};

export default function RAGPage() {
  const [query, setQuery] = useState('为什么我的 Python list 报 IndexError？');
  const [data, setData] = useState<RAGResponse | null>(null);
  const [rewrite, setRewrite] = useState<QueryRewriteResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function runSearch() {
    setLoading(true);
    try {
      const rewriteResponse = await fetch('/ai/query/understand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query }),
      });
      const rewriteData = await rewriteResponse.json();
      setRewrite(rewriteData);
      const response = await fetch('/ai/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: rewriteData.retrieval_query ?? query,
          concepts: rewriteData.concept_hints ?? [],
          top_k: 5,
        }),
      });
      setData(await response.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runSearch();
  }, []);

  const metrics = useMemo<MetricItem[]>(() => {
    if (!data) {
      return [];
    }
    return [
      ...(rewrite
        ? [
            { label: 'Intent', value: rewrite.intent },
            { label: 'Rewritten query', value: rewrite.retrieval_query, wide: true },
            { label: 'Query model', value: rewrite.chat_model },
            { label: 'Rewrite fallback', value: rewrite.llm_fallback ? rewrite.fallback_reason ?? 'Yes' : 'No' },
          ]
        : []),
      { label: 'Retrieval mode', value: data.retrieval_mode },
      { label: 'Index backend', value: data.index.backend },
      { label: 'Documents', value: data.index.document_count },
      { label: 'Embedding', value: `${data.index.embedding_provider} / ${data.index.embedding_model}`, wide: true },
      {
        label: 'Reranker',
        value: data.reranker.enabled ? `${data.reranker.provider} / ${data.reranker.model}` : 'disabled',
        wide: true,
      },
      { label: 'Index path', value: data.index.path, wide: true },
      { label: 'Rerank candidates', value: data.reranker.candidate_count },
    ];
  }, [data, rewrite]);

  const columns: ColumnsType<RAGChunk> = [
    {
      title: 'Chunk',
      dataIndex: 'chunk_id',
      width: 420,
      render: (_, row) => (
        <div className="rag-chunk-cell">
          <Typography.Text strong ellipsis>
            {row.title}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis>
            {row.chunk_id}
          </Typography.Text>
          <Typography.Link href={row.source_url} target="_blank" ellipsis>
            {row.source_url}
          </Typography.Link>
        </div>
      ),
    },
    {
      title: 'Scores',
      dataIndex: 'score',
      width: 210,
      render: (_, row) => (
        <div className="rag-score-row">
          <span>score {row.score.toFixed(4)}</span>
          <span>embed {row.embedding_score.toFixed(4)}</span>
          <span>rerank {typeof row.rerank_score === 'number' ? row.rerank_score.toFixed(4) : 'n/a'}</span>
        </div>
      ),
    },
    {
      title: 'Heading path',
      dataIndex: 'heading_path',
      ellipsis: true,
      render: (path: string[]) => <Typography.Text ellipsis>{path.join(' > ')}</Typography.Text>,
    },
    {
      title: 'Concepts',
      dataIndex: 'concepts',
      width: 220,
      render: (concepts: string[]) => (
        <div className="rag-concepts">
          {concepts.slice(0, 3).map((concept) => (
            <Tag key={concept}>{concept}</Tag>
          ))}
          {concepts.length > 3 ? <Tag>+{concepts.length - 3}</Tag> : null}
        </div>
      ),
    },
  ];

  return (
    <main className="rea-page rag-page-fixed">
      <section className="rea-header rag-header">
        <div className="rea-kicker">RAG</div>
        <h1 className="rea-title">KG-guided semantic retrieval and rerank</h1>
      </section>

      <section className="rea-panel rag-search-panel">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={runSearch}
          placeholder="Ask a Python learning question"
        />
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={runSearch}>
          Search
        </Button>
      </section>

      {data ? (
        <section className="rag-metric-grid">
          {metrics.map((item) => (
            <div className={`rag-metric ${item.wide ? 'is-wide' : ''}`} key={item.label}>
              <span>{item.label}</span>
              <strong title={String(item.value)}>{item.value}</strong>
            </div>
          ))}
        </section>
      ) : null}

      <section className="rag-results-panel">
        <div className="rag-results-head">
          <h2 className="rea-panel-title">Top 5 reranked chunks</h2>
          <Typography.Text type="secondary">{data?.chunks?.length ?? 0} results</Typography.Text>
        </div>
        <Table<RAGChunk>
          rowKey="chunk_id"
          dataSource={data?.chunks ?? []}
          loading={loading}
          pagination={false}
          columns={columns}
          size="small"
          tableLayout="fixed"
        />
      </section>
    </main>
  );
}
