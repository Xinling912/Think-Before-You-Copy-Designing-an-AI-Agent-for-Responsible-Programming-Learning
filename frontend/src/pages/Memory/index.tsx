import { QuestionCircleOutlined } from '@ant-design/icons';
import { Button, Empty, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

type ResearchMethod = {
  name: string;
  implemented: string;
};

type LearnerMemory = {
  memory_id: string;
  memory_type: string;
  topic: string;
  content: string;
  concepts: string[];
  strength: number;
  use_count: number;
  effective_score: number;
  status: string;
  last_used_at?: string;
  updated_at?: string;
};

type TopicSummary = {
  topic: string;
  topic_summary: string;
  mastered_concepts: string[];
  weak_concepts: string[];
  next_teaching_action: string;
  source_memory_ids: string[];
  updated_at?: string;
};

type RMMReflection = {
  episode_id: number;
  session_id: string;
  topic: string;
  skill_state: string;
  selected_memory_ids: string[];
  used_memory_ids: string[];
  unused_selected_memory_ids: string[];
  verification_reason: string;
  prospective_memory_plan: string;
  retrospective_memory_use: string;
  retrieval_refinement: string;
  created_at?: string;
};

type LearningEpisode = {
  episode_id: number;
  session_id?: string;
  student_message_id?: number;
  agent_message_id?: number;
  topic?: string;
  skill_state?: string;
  created_at?: string;
};

type LearningFact = {
  fact_id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: string;
  valid_from?: string;
  valid_to?: string;
};

type LearningEntity = {
  entity_id: string;
  entity_type: string;
  label: string;
  confidence: number;
  status: string;
  updated_at?: string;
};

type MemoryEvent = {
  id: number;
  session_id: string;
  operation: string;
  target_memory_id: string;
  result_memory_id: string;
  reason: string;
  created_at?: string;
};

type ShortTermMessage = {
  id: number;
  session_id?: string;
  role: string;
  content: string;
  created_at?: string;
};

type LearnerProfile = {
  learner_id: string;
  research_methods: ResearchMethod[];
  active_memory_count: number;
  topic_summary_count: number;
  rmm_reflection_count: number;
  learning_fact_count: number;
  learning_entity_count: number;
  memory_event_count: number;
  short_term_messages: ShortTermMessage[];
  memories: LearnerMemory[];
  topic_summaries: TopicSummary[];
  learning_episodes: LearningEpisode[];
  rmm_reflections: RMMReflection[];
  learning_facts: LearningFact[];
  learning_entities: LearningEntity[];
  memory_events: MemoryEvent[];
};

function learnerIDFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get('learner_id') || 'anonymous-demo';
}

export default function MemoryPage() {
  const [learnerId] = useState(learnerIDFromLocation);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadProfile() {
    setLoading(true);
    try {
      const response = await fetch(`/api/learner/profile?learner_id=${encodeURIComponent(learnerId)}`);
      setProfile(await response.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  const metrics = useMemo(
    () => [
      { label: 'Learner / 学生', value: profile?.learner_id ?? learnerId },
      { label: 'Active memories / 活跃长期记忆', value: String(profile?.active_memory_count ?? 0) },
      { label: 'Topic summaries / 主题总结', value: String(profile?.topic_summary_count ?? 0) },
      { label: 'RMM reflections / RMM 反思', value: String(profile?.rmm_reflection_count ?? 0) },
      { label: 'Learning facts / 学习事实', value: String(profile?.learning_fact_count ?? 0) },
      { label: 'Learning entities / 学习实体', value: String(profile?.learning_entity_count ?? 0) },
      { label: 'Memory events / 记忆事件', value: String(profile?.memory_event_count ?? 0) },
    ],
    [profile],
  );

  return (
    <main className="rea-page memory-page">
      <section className="rea-header">
        <div className="rea-panel-toolbar">
          <div>
            <div className="rea-kicker">Memory / Learner Model</div>
            <h1 className="rea-title">Short-, mid-, and long-term learning evidence / 学习记忆与学生画像</h1>
          </div>
          <Button onClick={loadProfile} loading={loading}>
            Reload / 重新加载
          </Button>
        </div>
      </section>

      <section className="rea-metric-grid memory-metric-grid">
        {metrics.map((metric) => (
          <div className="rea-metric" key={metric.label}>
            <div>{metric.label}</div>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </section>

      <section className="rea-panel">
        <h2 className="rea-panel-title">Research mechanisms / 论文机制</h2>
        {profile?.research_methods?.length ? (
          <div className="memory-method-grid">
            {profile.research_methods.map((method) => (
              <div className="memory-method" key={method.name}>
                <strong>{method.name}</strong>
                <span>{method.implemented}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No mechanism data / 暂无机制数据" />
        )}
      </section>

      <section className="rea-panel">
        <h2 className="rea-panel-title">Memory update timing / 记忆更新时间</h2>
        <div className="memory-update-guide">
          <MemoryUpdateGuideItem
            label="Short-term / 短期"
            ariaLabel="短期记忆更新时间说明"
            text="Short-term / 短期：每次学生或 AI 产生消息后更新当前会话窗口。"
            tooltip="短期记忆是当前 session 最近 N 轮消息，主要用于让下一轮回答知道刚刚聊过什么。"
          />
          <MemoryUpdateGuideItem
            label="Mid-term / 中期"
            ariaLabel="中期记忆更新时间说明"
            text="Mid-term / 中期：每轮教学动作完成后更新主题总结、误区和下一步动作。"
            tooltip="中期记忆由 RMM 风格 topic summary 承担，记录当前 Python 学习主题、弱概念和下一步教学动作。"
          />
          <MemoryUpdateGuideItem
            label="Long-term / 长期"
            ariaLabel="长期记忆更新时间说明"
            text="Long-term / 长期：每轮完成后抽取显著学习事实，再执行 Mem0 写入和 MemoryBank 强化/衰减。"
            tooltip="长期记忆保存跨 session 的学习画像，包括反复误区、已掌握概念、偏好，并带 strength/use_count/effective_score。"
          />
        </div>
      </section>

      <section className="rea-panel">
        <h2 className="rea-panel-title">Short-term window / 短期会话窗口</h2>
        <Table
          rowKey={(row) => `${row.session_id || 'session'}-${row.id}`}
          dataSource={profile?.short_term_messages ?? []}
          loading={loading}
          pagination={false}
          columns={[
            {
              title: 'Role / 角色',
              dataIndex: 'role',
              width: 130,
              render: (value: string) => <Tag color={value === 'agent' ? 'blue' : 'green'}>{value}</Tag>,
            },
            {
              title: 'Message / 消息',
              dataIndex: 'content',
              render: (value: string, row) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{value}</Typography.Text>
                  <Typography.Text type="secondary">{row.session_id || 'no session'}</Typography.Text>
                </Space>
              ),
            },
            {
              title: 'Created / 时间',
              dataIndex: 'created_at',
              width: 180,
              render: (value?: string) => formatTime(value),
            },
          ]}
        />
      </section>

      <section className="rea-panel">
        <h2 className="rea-panel-title">Learning episodes / Zep 学习事件</h2>
        <Table
          rowKey="episode_id"
          dataSource={profile?.learning_episodes ?? []}
          loading={loading}
          pagination={{ pageSize: 5 }}
          columns={[
            {
              title: 'Episode / 事件',
              width: 200,
              render: (_, row) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>episode {row.episode_id}</Typography.Text>
                  <Typography.Text type="secondary">{row.session_id || 'no session'}</Typography.Text>
                </Space>
              ),
            },
            {
              title: 'Topic / 主题',
              dataIndex: 'topic',
              render: (value?: string) => value || 'none',
            },
            {
              title: 'Skill state / 技能状态',
              dataIndex: 'skill_state',
              render: (value?: string) => <Tag>{value || 'unknown'}</Tag>,
            },
            {
              title: 'Message links / 消息关联',
              width: 190,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>student {row.student_message_id ?? 'none'}</Typography.Text>
                  <Typography.Text>agent {row.agent_message_id ?? 'none'}</Typography.Text>
                </Space>
              ),
            },
            {
              title: 'Created / 时间',
              dataIndex: 'created_at',
              width: 180,
              render: (value?: string) => formatTime(value),
            },
          ]}
        />
      </section>

      <section className="rea-panel">
        <h2 className="rea-panel-title">RMM reflections / RMM 反思记录</h2>
        <Table
          rowKey="episode_id"
          dataSource={profile?.rmm_reflections ?? []}
          loading={loading}
          pagination={{ pageSize: 4 }}
          columns={[
            {
              title: 'Episode / 回合',
              width: 190,
              render: (_, row) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{row.topic || 'unknown topic'}</Typography.Text>
                  <Typography.Text type="secondary">{row.session_id || 'no session'}</Typography.Text>
                  <Tag>{row.skill_state || 'unknown state'}</Tag>
                </Space>
              ),
            },
            {
              title: 'Prospective plan / 前瞻计划',
              dataIndex: 'prospective_memory_plan',
              render: (value: string) => value || 'none',
            },
            {
              title: 'Selected / Used / Unused',
              width: 260,
              render: (_, row) => (
                <Space direction="vertical" size={4}>
                  <MemoryIdTags label="selected" values={row.selected_memory_ids} />
                  <MemoryIdTags label="used" values={row.used_memory_ids} />
                  <MemoryIdTags label="unused" values={row.unused_selected_memory_ids} />
                </Space>
              ),
            },
            {
              title: 'Retrospective / 回顾反思',
              render: (_, row) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{row.retrospective_memory_use || 'none'}</Typography.Text>
                  <Typography.Text type="secondary">{row.retrieval_refinement || 'none'}</Typography.Text>
                  <Tag>{row.verification_reason || 'unverified'}</Tag>
                </Space>
              ),
            },
          ]}
        />
      </section>

      <section className="rea-panel">
        <h2 className="rea-panel-title">Long-term memories / 长期记忆</h2>
        <Table
          rowKey="memory_id"
          dataSource={profile?.memories ?? []}
          loading={loading}
          pagination={{ pageSize: 6 }}
          columns={[
            {
              title: 'Memory / 记忆',
              dataIndex: 'content',
              render: (_, row) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{row.content}</Typography.Text>
                  <Typography.Text type="secondary">{row.memory_id}</Typography.Text>
                  <Space wrap size={[4, 4]}>
                    <Tag color={row.memory_type === 'misconception' ? 'orange' : 'blue'}>{row.memory_type}</Tag>
                    <Tag>{row.topic}</Tag>
                    <Tag>{row.status}</Tag>
                  </Space>
                </Space>
              ),
            },
            {
              title: 'MemoryBank / 记忆强度',
              width: 180,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>strength {row.strength}</Typography.Text>
                  <Typography.Text>use_count {row.use_count}</Typography.Text>
                  <Typography.Text>last_used_at {formatTime(row.last_used_at)}</Typography.Text>
                  <Typography.Text>score {formatNumber(row.effective_score)}</Typography.Text>
                </Space>
              ),
            },
            {
              title: 'Concepts / 概念',
              dataIndex: 'concepts',
              render: (concepts: string[]) => concepts.map((concept) => <Tag key={concept}>{concept}</Tag>),
            },
            {
              title: 'Updated / 更新时间',
              dataIndex: 'updated_at',
              width: 180,
              render: (value?: string) => formatTime(value),
            },
          ]}
        />
      </section>

      <section className="rea-grid two">
        <section className="rea-panel">
          <h2 className="rea-panel-title">Topic summaries / 中期任务状态</h2>
          <Table
            rowKey="topic"
            dataSource={profile?.topic_summaries ?? []}
            loading={loading}
            pagination={false}
            columns={[
              {
                title: 'Topic / 主题',
                dataIndex: 'topic',
                width: 180,
              },
              {
                title: 'Summary / 总结',
                dataIndex: 'topic_summary',
                render: (_, row) => (
                  <Space direction="vertical" size={4}>
                    <Typography.Text>{row.topic_summary}</Typography.Text>
                    <Typography.Text type="secondary">{row.next_teaching_action}</Typography.Text>
                    <Space wrap size={[4, 4]}>
                      {row.weak_concepts.map((concept) => (
                        <Tag color="orange" key={`weak-${concept}`}>
                          weak {concept}
                        </Tag>
                      ))}
                      {row.mastered_concepts.map((concept) => (
                        <Tag color="green" key={`mastered-${concept}`}>
                          mastered {concept}
                        </Tag>
                      ))}
                    </Space>
                  </Space>
                ),
              },
            ]}
          />
        </section>

        <section className="rea-panel">
          <h2 className="rea-panel-title">Memory events / Mem0 操作历史</h2>
          <Table
            rowKey="id"
            dataSource={profile?.memory_events ?? []}
            loading={loading}
            pagination={false}
            columns={[
              { title: 'Operation', dataIndex: 'operation', render: (value) => <Tag>{value}</Tag> },
              { title: 'Result memory', dataIndex: 'result_memory_id', render: (value) => value || 'none' },
              { title: 'Reason', dataIndex: 'reason' },
              { title: 'Created', dataIndex: 'created_at', render: (value?: string) => formatTime(value) },
            ]}
          />
        </section>
      </section>

      <section className="rea-grid two">
        <section className="rea-panel">
          <h2 className="rea-panel-title">Learning facts / Zep temporal facts</h2>
          <Table
            rowKey="fact_id"
            dataSource={profile?.learning_facts ?? []}
            loading={loading}
            pagination={false}
            columns={[
              { title: 'Predicate', dataIndex: 'predicate', render: (value) => <Tag>{value}</Tag> },
              { title: 'Object', dataIndex: 'object' },
              { title: 'Confidence', dataIndex: 'confidence', render: (value: number) => formatNumber(value) },
              { title: 'Status', dataIndex: 'status' },
            ]}
          />
        </section>

        <section className="rea-panel">
          <h2 className="rea-panel-title">Learning entities / 学习实体</h2>
          <Table
            rowKey="entity_id"
            dataSource={profile?.learning_entities ?? []}
            loading={loading}
            pagination={false}
            columns={[
              { title: 'Label', dataIndex: 'label' },
              { title: 'Type', dataIndex: 'entity_type', render: (value) => <Tag>{value}</Tag> },
              { title: 'Confidence', dataIndex: 'confidence', render: (value: number) => formatNumber(value) },
              { title: 'Status', dataIndex: 'status' },
            ]}
          />
        </section>
      </section>
    </main>
  );
}

function MemoryUpdateGuideItem(props: { label: string; ariaLabel: string; text: string; tooltip: string }) {
  return (
    <div className="memory-update-guide-item">
      <div className="memory-update-guide-heading">
        <strong>{props.label}</strong>
        <Tooltip title={props.tooltip}>
          <button aria-label={props.ariaLabel} className="memory-help-button" type="button">
            <QuestionCircleOutlined />
          </button>
        </Tooltip>
      </div>
      <Typography.Text>{props.text}</Typography.Text>
    </div>
  );
}

function MemoryIdTags({ label, values }: { label: string; values?: string[] }) {
  const safeValues = values ?? [];
  if (safeValues.length === 0) {
    return (
      <Typography.Text type="secondary">
        {label}: none
      </Typography.Text>
    );
  }
  return (
    <Space wrap size={[4, 4]}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      {safeValues.map((value) => (
        <Tag key={`${label}-${value}`}>{value}</Tag>
      ))}
    </Space>
  );
}

function formatNumber(value?: number) {
  if (typeof value !== 'number') {
    return 'n/a';
  }
  return value.toFixed(3);
}

function formatTime(value?: string) {
  if (!value) {
    return 'none';
  }
  return value.replace('T', ' ').replace('Z', ' UTC');
}
