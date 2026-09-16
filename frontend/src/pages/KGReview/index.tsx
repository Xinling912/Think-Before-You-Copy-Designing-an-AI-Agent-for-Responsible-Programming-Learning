import { LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Empty, Input, Pagination, Select, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

const pageSize = 5;

type KGCandidate = {
  candidate_id: string;
  source_chunk_id: string;
  source_url: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  evidence_text: string;
  status: string;
  review_status?: string;
  reviewer_id?: string;
  reviewer_note?: string;
  reviewed_at?: string;
  created_at: string;
};

type KGCandidateResponse = {
  candidate_count: number;
  filtered_count: number;
  status_counts: Record<string, number>;
  candidates: KGCandidate[];
};

export default function KGReviewPage() {
  const [data, setData] = useState<KGCandidateResponse | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('auto_extracted');
  const [minConfidence, setMinConfidence] = useState('0.75');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [reviewingID, setReviewingID] = useState('');
  const [error, setError] = useState('');

  async function loadCandidates() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (status) {
      params.set('status', status);
    }
    if (query.trim()) {
      params.set('q', query.trim());
    }
    if (minConfidence.trim()) {
      params.set('min_confidence', minConfidence.trim());
    }

    try {
      const response = await fetch(`/api/kg/candidates?${params.toString()}`);
      if (!response.ok) {
        throw new Error('KG 候选 API 请求失败 / KG candidate API request failed');
      }
      setData(await response.json());
      setPage(1);
    } catch (event) {
      setError(event instanceof Error ? event.message : 'KG 候选 API 请求失败 / KG candidate API request failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCandidates();
  }, []);

  async function submitReview(candidateID: string, status: 'approved' | 'rejected') {
    setReviewingID(`${candidateID}:${status}`);
    setError('');
    const reviewerNote =
      status === 'approved'
        ? 'Evidence matches Python official docs.'
        : 'Candidate needs manual correction before joining KG.';
    try {
      const response = await fetch(`/api/kg/candidates/${encodeURIComponent(candidateID)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          reviewer_id: 'local-reviewer',
          reviewer_note: reviewerNote,
        }),
      });
      if (!response.ok) {
        throw new Error('KG 审核提交失败 / KG review submit failed');
      }
      await response.json();
      await loadCandidates();
    } catch (event) {
      setError(event instanceof Error ? event.message : 'KG 审核提交失败 / KG review submit failed');
    } finally {
      setReviewingID('');
    }
  }

  const candidates = data?.candidates ?? [];
  const visibleCandidates = candidates.slice((page - 1) * pageSize, page * pageSize);
  const metrics = useMemo(
    () => [
      { label: 'All / 全部', value: String(data?.candidate_count ?? 0) },
      { label: 'Filtered / 当前', value: String(data?.filtered_count ?? 0) },
      { label: 'Auto extracted', value: String(data?.status_counts?.auto_extracted ?? 0) },
      { label: 'Min confidence / 最低置信度', value: minConfidence || 'none' },
    ],
    [data, minConfidence],
  );

  return (
    <main className="rea-page kg-review-page">
      <section className="rea-header kg-review-header">
        <div>
          <div className="rea-kicker">KG Review / 知识图谱候选审核</div>
          <h1 className="rea-title">Ain 2023 educational KG extraction</h1>
        </div>
        <div className="kg-review-header-actions">
          {metrics.map((metric) => (
            <div className="kg-review-mini-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
          <Button icon={<ReloadOutlined />} onClick={loadCandidates} loading={loading}>
            Reload / 刷新
          </Button>
        </div>
      </section>

      {error ? <section className="corpus-error">{error}</section> : null}

      <section className="kg-review-note">
        <strong>Research mechanism / 研究机制</strong>
        <span>
          These are auditable concept relation candidates with source chunks, URLs, evidence text, and confidence. They are not the final KG browser yet.
        </span>
      </section>

      <section className="kg-review-filters">
        <Input.Search
          allowClear
          placeholder="Search edge, evidence, URL / 搜索候选边、证据、URL"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onSearch={loadCandidates}
        />
        <Select
          value={status}
          options={[
            { value: '', label: 'All status / 全部状态' },
            { value: 'auto_extracted', label: 'auto_extracted' },
          ]}
          onChange={setStatus}
        />
        <Select
          value={minConfidence}
          options={[
            { value: '', label: 'No min confidence / 不限置信度' },
            { value: '0.75', label: '>= 0.75' },
            { value: '0.80', label: '>= 0.80' },
            { value: '0.85', label: '>= 0.85' },
            { value: '0.90', label: '>= 0.90' },
          ]}
          onChange={setMinConfidence}
        />
        <Button onClick={loadCandidates}>Apply / 应用</Button>
      </section>

      <section className="kg-review-board">
        <div className="kg-review-board-head">
          <h2 className="rea-panel-title">Candidate edges / 候选关系</h2>
          <Typography.Text type="secondary">
            Page {page} / {Math.max(1, Math.ceil(candidates.length / pageSize))} · {data?.filtered_count ?? 0} rows
          </Typography.Text>
        </div>

        <div className={`kg-review-card-list ${loading ? 'is-loading' : ''}`}>
          {visibleCandidates.length === 0 && !loading ? (
            <div className="kg-review-empty">
              <Empty description="No candidates / 暂无候选" />
            </div>
          ) : null}
          {visibleCandidates.map((candidate) => (
            <CandidateCard
              candidate={candidate}
              key={candidate.candidate_id}
              reviewingID={reviewingID}
              onReview={submitReview}
            />
          ))}
        </div>

        <div className="kg-review-pagination">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={candidates.length}
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      </section>
    </main>
  );
}

function CandidateCard(props: {
  candidate: KGCandidate;
  reviewingID: string;
  onReview: (candidateID: string, status: 'approved' | 'rejected') => void;
}) {
  const { candidate, reviewingID, onReview } = props;

  return (
    <article className="kg-review-card" aria-label={`KG candidate ${candidate.candidate_id}`}>
      <div className="kg-review-edge">
        <Typography.Text strong ellipsis>
          {candidate.candidate_id}
        </Typography.Text>
        <div className="kg-review-relation">
          <Tag color="blue">{candidate.subject}</Tag>
          <span>{candidate.predicate}</span>
          <Tag color="purple">{candidate.object}</Tag>
        </div>
      </div>

      <div className="kg-review-source">
        <Typography.Text strong ellipsis>
          {candidate.source_chunk_id}
        </Typography.Text>
        <a href={candidate.source_url} target="_blank" rel="noreferrer" title={candidate.source_url}>
          <LinkOutlined /> {candidate.source_url}
        </a>
      </div>

      <div className="kg-review-evidence-block">
        <span>Evidence / 证据</span>
        <p>{candidate.evidence_text}</p>
      </div>

      <div className="kg-review-decision">
        <div className="kg-review-score">
          <span>Confidence</span>
          <strong>{candidate.confidence.toFixed(2)}</strong>
        </div>
        <div className="kg-review-status">
          <Tag color={candidate.status === 'auto_extracted' ? 'blue' : 'default'}>{candidate.status}</Tag>
          <Tag color={reviewColor(candidate.review_status)}>{candidate.review_status || 'pending'}</Tag>
        </div>
        <div className="kg-review-actions">
          <Button
            size="small"
            type="primary"
            onClick={() => onReview(candidate.candidate_id, 'approved')}
            loading={reviewingID === `${candidate.candidate_id}:approved`}
          >
            Approve / 通过
          </Button>
          <Button
            size="small"
            danger
            onClick={() => onReview(candidate.candidate_id, 'rejected')}
            loading={reviewingID === `${candidate.candidate_id}:rejected`}
          >
            Reject / 驳回
          </Button>
        </div>
      </div>
    </article>
  );
}

function reviewColor(status?: string) {
  if (status === 'approved') {
    return 'green';
  }
  if (status === 'rejected') {
    return 'red';
  }
  return 'default';
}
