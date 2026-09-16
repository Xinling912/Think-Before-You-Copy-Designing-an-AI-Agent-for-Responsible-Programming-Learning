import { LinkOutlined } from '@ant-design/icons';
import { Button, Checkbox, Empty, Input, Select, Space, Table, Tag, Tree, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import {
  buildCorpusOutline,
  buildSourceOptions,
  filterChunks,
  formatSummaryStats,
  uniqueSorted,
  type CorpusChunk,
  type CorpusFilter,
  type CorpusOutlineNode,
  type CorpusSummary,
} from './model';

const defaultFilter: CorpusFilter = {
  query: '',
  source: '',
  docId: '',
  hasCode: false,
  qualityFlag: '',
  outlinePath: [],
};

function renderChunkText(text: string) {
  const parts = text.split(/(IndexError|zero-based index|list|index)/gi);
  return parts.map((part, index) => {
    if (/^(IndexError|zero-based index|list|index)$/i.test(part)) {
      return <mark key={`${part}-${index}`}>{part}</mark>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function sourceOf(chunk: CorpusChunk) {
  return chunk.source || chunk.source_id || 'Unknown source';
}

export default function CorpusPage() {
  const [summary, setSummary] = useState<CorpusSummary | null>(null);
  const [chunks, setChunks] = useState<CorpusChunk[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<CorpusChunk | null>(null);
  const [filter, setFilter] = useState<CorpusFilter>(defaultFilter);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadCorpus() {
    setLoading(true);
    setError('');
    try {
      const [summaryResponse, chunksResponse] = await Promise.all([
        fetch('/api/corpus/summary'),
        fetch('/api/corpus/chunks'),
      ]);
      if (!summaryResponse.ok || !chunksResponse.ok) {
        throw new Error('Corpus API request failed');
      }
      const summaryData = await summaryResponse.json();
      const chunksData = await chunksResponse.json();
      const loadedChunks = chunksData.chunks ?? [];
      const firstSource = loadedChunks[0] ? sourceOf(loadedChunks[0]) : '';
      setSummary(summaryData);
      setChunks(loadedChunks);
      setSelectedChunk(loadedChunks[0] ?? null);
      setFilter((current) => ({ ...current, source: current.source || firstSource }));
    } catch (event) {
      setError(event instanceof Error ? event.message : 'Corpus API request failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadChunkDetail(chunkID: string) {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/corpus/chunks/${encodeURIComponent(chunkID)}`);
      if (!response.ok) {
        throw new Error('Chunk detail request failed');
      }
      const data = await response.json();
      setSelectedChunk(data.chunk);
    } catch (event) {
      setError(event instanceof Error ? event.message : 'Chunk detail request failed');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadCorpus();
  }, []);

  const sourceOptions = useMemo(() => buildSourceOptions(chunks, summary), [chunks, summary]);
  const activeSource = filter.source || sourceOptions[0]?.name || '';
  const activeSourceChunks = useMemo(
    () => chunks.filter((chunk) => sourceOf(chunk) === activeSource),
    [chunks, activeSource],
  );
  const filteredChunks = useMemo(
    () => filterChunks(chunks, { ...filter, source: activeSource }),
    [chunks, filter, activeSource],
  );
  const outline = useMemo(() => buildCorpusOutline(activeSourceChunks), [activeSourceChunks]);
  const docIds = useMemo(() => uniqueSorted(activeSourceChunks.map((chunk) => chunk.doc_id)), [activeSourceChunks]);
  const qualityFlags = useMemo(
    () => uniqueSorted(activeSourceChunks.flatMap((chunk) => chunk.quality_flags)),
    [activeSourceChunks],
  );
  const summaryStats = useMemo(() => (summary ? formatSummaryStats(summary) : []), [summary]);

  useEffect(() => {
    if (!filteredChunks.length) {
      setSelectedChunk(null);
      return;
    }
    if (!selectedChunk || !filteredChunks.some((chunk) => chunk.chunk_id === selectedChunk.chunk_id)) {
      setSelectedChunk(filteredChunks[0]);
    }
  }, [filteredChunks, selectedChunk]);

  const columns: ColumnsType<CorpusChunk> = [
    {
      title: 'Title',
      dataIndex: 'title',
      width: 245,
      render: (_, chunk) => (
        <div>
          <Typography.Text strong ellipsis>
            {chunk.title}
          </Typography.Text>
          <div className="corpus-row-meta">{chunk.doc_id}</div>
        </div>
      ),
    },
    {
      title: 'Chars',
      dataIndex: 'char_count',
      width: 78,
      sorter: (a, b) => a.char_count - b.char_count,
    },
    {
      title: 'Code',
      dataIndex: 'code_block_count',
      width: 68,
      sorter: (a, b) => a.code_block_count - b.code_block_count,
    },
  ];

  return (
    <main className="rea-page corpus-page corpus-page-fixed">
      <section className="rea-header corpus-header">
        <div>
          <div className="rea-kicker">Corpus</div>
          <h1 className="rea-title">Python learning corpus</h1>
        </div>
        <div className="corpus-summary-strip">
          {summaryStats.map((item) => (
            <span key={item.label}>
              {item.label}: <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </section>

      {error ? <section className="corpus-error">{error}</section> : null}

      <section className="corpus-source-grid" aria-label="Corpus sources">
        {sourceOptions.map((source) => (
          <button
            className={`corpus-source-card ${source.name === activeSource ? 'is-active' : ''}`}
            key={source.name}
            type="button"
            onClick={() =>
              setFilter((current) => ({
                ...current,
                source: source.name,
                docId: '',
                qualityFlag: '',
                outlinePath: [],
              }))
            }
          >
            <span className="corpus-source-name">{source.name}</span>
            <span className="corpus-source-meta">
              {source.count.toLocaleString()} chunks / {source.codeCount.toLocaleString()} code
            </span>
          </button>
        ))}
      </section>

      <section className="corpus-filterbar" aria-label="Corpus filters">
        <Input.Search
          allowClear
          placeholder="Search title, text, URL, flags"
          value={filter.query}
          onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
        />
        <Select
          allowClear
          showSearch
          placeholder="doc_id"
          value={filter.docId || undefined}
          options={docIds.map((docId) => ({ value: docId, label: docId }))}
          onChange={(value) => setFilter((current) => ({ ...current, docId: value ?? '' }))}
        />
        <Select
          allowClear
          showSearch
          placeholder="quality flag"
          value={filter.qualityFlag || undefined}
          options={qualityFlags.map((flag) => ({ value: flag, label: flag }))}
          onChange={(value) => setFilter((current) => ({ ...current, qualityFlag: value ?? '' }))}
        />
        <Checkbox
          checked={filter.hasCode}
          onChange={(event) => setFilter((current) => ({ ...current, hasCode: event.target.checked }))}
        >
          Has code
        </Checkbox>
        <Button onClick={() => setFilter({ ...defaultFilter, source: activeSource })}>Reset</Button>
      </section>

      <section className="corpus-workbench">
        <aside className="corpus-directory">
          <div className="corpus-panel-head">
            <h2 className="rea-panel-title">Directory</h2>
            <Typography.Text type="secondary">{outline.length} roots</Typography.Text>
          </div>
          <Tree<CorpusOutlineNode>
            className="corpus-outline"
            treeData={outline}
            fieldNames={{ title: 'title', key: 'key', children: 'children' }}
            selectedKeys={filter.outlinePath.length ? [filter.outlinePath.join('\u001f')] : []}
            onSelect={(_, info) => {
              const node = info.node as CorpusOutlineNode;
              setFilter((current) => ({ ...current, outlinePath: info.selected ? node.path : [] }));
            }}
          />
        </aside>

        <section className="corpus-table">
          <div className="corpus-panel-head">
            <h2 className="rea-panel-title">Chunks</h2>
            <Typography.Text type="secondary">
              {filteredChunks.length.toLocaleString()} / {activeSourceChunks.length.toLocaleString()}
            </Typography.Text>
          </div>
          <Table<CorpusChunk>
            rowKey="chunk_id"
            loading={loading}
            dataSource={filteredChunks}
            columns={columns}
            pagination={{ pageSize: 8, showSizeChanger: false, size: 'small' }}
            size="small"
            tableLayout="fixed"
            rowClassName={(chunk) => (chunk.chunk_id === selectedChunk?.chunk_id ? 'corpus-selected-row' : '')}
            onRow={(chunk) => ({
              onClick: () => loadChunkDetail(chunk.chunk_id),
            })}
          />
        </section>

        <aside className="corpus-detail">
          <div className="corpus-panel-head">
            <h2 className="rea-panel-title">Chunk detail</h2>
            {detailLoading ? <Typography.Text type="secondary">Loading...</Typography.Text> : null}
          </div>
          {selectedChunk ? (
            <div className="corpus-detail-body" aria-busy={detailLoading}>
              <Typography.Title level={4}>{selectedChunk.title}</Typography.Title>
              <div className="corpus-detail-meta">
                <span>{selectedChunk.chunk_id}</span>
                <span>{sourceOf(selectedChunk)}</span>
                <span>{selectedChunk.char_count.toLocaleString()} chars</span>
                <span>{selectedChunk.code_block_count} code blocks</span>
              </div>
              <div className="corpus-heading-path">{selectedChunk.heading_path.join(' > ')}</div>
              <Space size={[4, 4]} wrap className="corpus-tags">
                {selectedChunk.quality_flags.map((flag) => (
                  <Tag color={flag === 'official_source' ? 'geekblue' : 'default'} key={flag}>
                    {flag}
                  </Tag>
                ))}
              </Space>
              <a className="corpus-source-link" href={selectedChunk.source_url} target="_blank" rel="noreferrer">
                <LinkOutlined /> {selectedChunk.source_url}
              </a>
              <pre className="corpus-text">{renderChunkText(selectedChunk.text)}</pre>
            </div>
          ) : (
            <Empty description="No chunk selected" />
          )}
        </aside>
      </section>
    </main>
  );
}
