import { ArrowLeftOutlined } from '@ant-design/icons';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Button, Progress, Result, Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { getOrCreateLearnerID } from '../../utils/learner';
import { fetchTestTopics } from './api';
import type { TestTopicProgress } from './model';
import { topicIconForKey } from './topicIcons';

function currentReturnSessionID(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return new URLSearchParams(window.location.search).get('return_session_id')?.trim() ?? '';
}

function topicHref(topicID: string, returnSessionID: string): string {
  const base = `/test/${encodeURIComponent(topicID)}`;
  return returnSessionID ? `${base}?return_session_id=${encodeURIComponent(returnSessionID)}` : base;
}

export default function TestCenterPage() {
  const [topics, setTopics] = useState<TestTopicProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const returnSessionID = useMemo(currentReturnSessionID, []);
  const backHref = returnSessionID ? `/?session_id=${encodeURIComponent(returnSessionID)}` : '/';

  useEffect(() => {
    let active = true;

    async function loadTopics() {
      setLoading(true);
      setError('');
      try {
        const nextTopics = await fetchTestTopics(getOrCreateLearnerID());
        nextTopics.forEach((topic) => topicIconForKey(topic.icon));
        if (active) {
          setTopics(nextTopics);
        }
      } catch (event) {
        if (active) {
          setError(event instanceof Error ? event.message : 'Unable to load test topics');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadTopics();
    return () => {
      active = false;
    };
  }, []);

  return (
    <PageContainer
      title="Python Test Center"
      subTitle="Ten mastery levels per topic"
      extra={[
        <Button key="back" href={backHref} icon={<ArrowLeftOutlined />} aria-label="Back to learning">
          Back to learning
        </Button>,
      ]}
    >
      <main className="test-center-page">
        {loading ? (
          <div className="test-center-loading" aria-label="Loading test topics">
            <Spin size="large" tip="Loading test topics">
              <div className="test-center-loading-space" />
            </Spin>
          </div>
        ) : error ? (
          <Result
            status="error"
            title="Unable to load Test Center"
            subTitle={error}
            extra={
              <Button href={backHref} aria-label="Back to learning">
                Back to learning
              </Button>
            }
          />
        ) : (
          <section className="test-topic-grid" aria-label="Python test topics">
            {topics.map((topic) => {
              const TopicIcon = topicIconForKey(topic.icon);
              return (
                <a
                  key={topic.id}
                  className="test-topic-link"
                  href={topicHref(topic.id, returnSessionID)}
                  aria-label={`Open ${topic.label} test`}
                >
                  <ProCard className="test-topic-card" bordered hoverable>
                    <div className="test-topic-heading">
                      <TopicIcon className="test-topic-icon" data-testid="test-topic-icon" aria-hidden="true" />
                      <Typography.Title level={3}>{topic.label}</Typography.Title>
                    </div>
                    <Typography.Paragraph className="test-topic-summary">{topic.summary}</Typography.Paragraph>
                    <div className="test-topic-progress-row">
                      <Progress
                        percent={topic.percent}
                        showInfo={false}
                        aria-label={`${topic.label} progress ${topic.score}/10`}
                      />
                      <Typography.Text strong>{topic.score}/10</Typography.Text>
                    </div>
                  </ProCard>
                </a>
              );
            })}
          </section>
        )}
      </main>
    </PageContainer>
  );
}
