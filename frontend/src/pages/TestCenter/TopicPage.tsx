import { PageContainer, ProCard } from '@ant-design/pro-components';
import { history, useParams } from '@umijs/max';
import { Alert, Button, Input, Progress, Radio, Result, Spin, Typography } from 'antd';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { getOrCreateLearnerID } from '../../utils/learner';
import { fetchTestTopics, generateTestQuestion, reloadTestQuestion, submitTestAnswer } from './api';
import type { PublicTestQuestion, PublicTestResult, TestTopicProgress } from './model';
import { topicIconForKey } from './topicIcons';

type PracticeStatus =
  | 'loading-topic'
  | 'loading-question'
  | 'answering'
  | 'submitting'
  | 'correct'
  | 'incorrect'
  | 'generation-error'
  | 'judging-error'
  | 'topic-mismatch'
  | 'completed'
  | 'not-found';

type QuestionMode = 'generate' | 'reload';

type PracticeState = {
  status: PracticeStatus;
  topic: TestTopicProgress | null;
  question: PublicTestQuestion | null;
  result: PublicTestResult | null;
  answer: string;
  message: string;
  questionMode: QuestionMode;
  clearAnswerOnSuccess: boolean;
};

type PracticeAction =
  | { type: 'QUESTION_LOADING'; topic: TestTopicProgress; mode: QuestionMode; clearAnswer: boolean }
  | { type: 'QUESTION_READY'; question: PublicTestQuestion; clearAnswer: boolean }
  | { type: 'QUESTION_FAILED'; message: string }
  | { type: 'QUESTION_TOPIC_MISMATCH' }
  | { type: 'TOPIC_COMPLETED'; topic: TestTopicProgress }
  | { type: 'TOPIC_NOT_FOUND' }
  | { type: 'ANSWER_CHANGED'; answer: string }
  | { type: 'SUBMITTING' }
  | { type: 'JUDGED'; result: PublicTestResult }
  | { type: 'JUDGING_FAILED'; message: string };

const initialState: PracticeState = {
  status: 'loading-topic',
  topic: null,
  question: null,
  result: null,
  answer: '',
  message: '',
  questionMode: 'generate',
  clearAnswerOnSuccess: true,
};

function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  switch (action.type) {
    case 'QUESTION_LOADING':
      if (state.status === 'loading-question') {
        return state;
      }
      return {
        ...state,
        status: 'loading-question',
        topic: action.topic,
        message: '',
        questionMode: action.mode,
        clearAnswerOnSuccess: action.clearAnswer,
      };
    case 'QUESTION_READY':
      return {
        ...state,
        status: 'answering',
        question: action.question,
        result: null,
        answer: action.clearAnswer ? '' : state.answer,
        message: '',
        topic: state.topic
          ? {
              ...state.topic,
              score: action.question.progress.score,
              maximum: action.question.progress.maximum,
              percent: action.question.progress.percent,
            }
          : state.topic,
      };
    case 'QUESTION_FAILED':
      return { ...state, status: 'generation-error', message: action.message };
    case 'QUESTION_TOPIC_MISMATCH':
      return {
        ...state,
        status: 'topic-mismatch',
        question: null,
        result: null,
        answer: '',
        message: '',
      };
    case 'TOPIC_COMPLETED':
      return { ...state, status: 'completed', topic: action.topic, question: null, result: null };
    case 'TOPIC_NOT_FOUND':
      return { ...state, status: 'not-found', topic: null, question: null, result: null };
    case 'ANSWER_CHANGED':
      if (state.status !== 'answering' && state.status !== 'judging-error') {
        return state;
      }
      return { ...state, answer: action.answer };
    case 'SUBMITTING':
      if (
        (state.status !== 'answering' && state.status !== 'judging-error') ||
        !state.answer.trim() ||
        !state.question
      ) {
        return state;
      }
      return { ...state, status: 'submitting', message: '' };
    case 'JUDGED': {
      const status = action.result.is_correct ? 'correct' : 'incorrect';
      return {
        ...state,
        status,
        result: action.result,
        message: '',
        topic: state.topic
          ? {
              ...state.topic,
              score: action.result.progress.score,
              maximum: action.result.progress.maximum,
              percent: action.result.progress.percent,
            }
          : state.topic,
      };
    }
    case 'JUDGING_FAILED':
      return { ...state, status: 'judging-error', message: action.message };
    default:
      return state;
  }
}

function currentQueryValue(key: string): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return new URLSearchParams(window.location.search).get(key)?.trim() ?? '';
}

function practiceHref(topicID: string, returnSessionID: string, questionID = ''): string {
  const query: string[] = [];
  if (returnSessionID) {
    query.push(`return_session_id=${encodeURIComponent(returnSessionID)}`);
  }
  if (questionID) {
    query.push(`question_id=${encodeURIComponent(questionID)}`);
  }
  const suffix = query.length ? `?${query.join('&')}` : '';
  return `/test/${encodeURIComponent(topicID)}${suffix}`;
}

function testCenterHref(returnSessionID: string): string {
  return returnSessionID ? `/test?return_session_id=${encodeURIComponent(returnSessionID)}` : '/test';
}

function learningHref(returnSessionID: string): string {
  return returnSessionID ? `/?session_id=${encodeURIComponent(returnSessionID)}` : '/';
}

function displayError(event: unknown): string {
  const code =
    typeof event === 'object' && event !== null && 'code' in event && typeof event.code === 'string'
      ? event.code
      : event instanceof Error
        ? event.message
        : 'test_request_failed';
  if (code === 'token_budget_exhausted') {
    return 'Daily token quota exceeded. Please try again in 1 day.';
  }
  if (code === 'answer_evaluation_unavailable') {
    return 'We could not evaluate this answer yet. Your answer is still saved here; please retry.';
  }
  return code;
}

function TopicContext({ topic }: { topic: TestTopicProgress }) {
  const TopicIcon = topicIconForKey(topic.icon);
  return (
    <section className="test-topic-context" aria-label={`${topic.label} topic context`}>
      <ProCard className="test-topic-context-card" bordered>
        <div className="test-topic-context-heading">
          <TopicIcon
            className="test-topic-context-icon"
            data-testid="test-topic-context-icon"
            aria-hidden="true"
          />
          <div className="test-topic-context-copy">
            <Typography.Title level={2}>{topic.label}</Typography.Title>
            <Typography.Paragraph>{topic.summary}</Typography.Paragraph>
          </div>
        </div>
      </ProCard>
    </section>
  );
}

export default function TopicPage() {
  const { topicId = '' } = useParams<{ topicId: string }>();
  const [state, dispatch] = useReducer(practiceReducer, initialState);
  const learnerID = useMemo(getOrCreateLearnerID, []);
  const returnSessionID = useMemo(() => currentQueryValue('return_session_id'), []);
  const initialQuestionID = useMemo(() => currentQueryValue('question_id'), []);
  const questionInFlight = useRef(false);
  const submissionInFlight = useRef(false);
  const backHref = testCenterHref(returnSessionID);
  const returnHref = learningHref(returnSessionID);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const topics = await fetchTestTopics(learnerID);
        const selected = topics.find((item) => item.id === topicId);
        if (!active) {
          return;
        }
        if (!selected) {
          dispatch({ type: 'TOPIC_NOT_FOUND' });
          return;
        }
        if (selected.score >= selected.maximum) {
          dispatch({ type: 'TOPIC_COMPLETED', topic: selected });
          return;
        }

        const mode: QuestionMode = initialQuestionID ? 'reload' : 'generate';
        dispatch({ type: 'QUESTION_LOADING', topic: selected, mode, clearAnswer: true });
        questionInFlight.current = true;
        try {
          const loaded = initialQuestionID
            ? await reloadTestQuestion(learnerID, initialQuestionID)
            : await generateTestQuestion(learnerID, selected.id);
          if (!active) {
            return;
          }
          if (initialQuestionID && loaded.topic_id !== selected.id) {
            dispatch({ type: 'QUESTION_TOPIC_MISMATCH' });
            return;
          }
          if (!initialQuestionID) {
            history.replace(practiceHref(selected.id, returnSessionID, loaded.question_id));
          }
          dispatch({ type: 'QUESTION_READY', question: loaded, clearAnswer: true });
        } catch (event) {
          if (active) {
            dispatch({ type: 'QUESTION_FAILED', message: displayError(event) });
          }
        } finally {
          questionInFlight.current = false;
        }
      } catch (event) {
        if (active) {
          dispatch({ type: 'QUESTION_FAILED', message: displayError(event) });
        }
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [initialQuestionID, learnerID, returnSessionID, topicId]);

  async function requestGeneratedQuestion(clearAnswer: boolean, removeOldQuestion: boolean) {
    if (!state.topic || questionInFlight.current || state.status === 'loading-question') {
      return;
    }
    questionInFlight.current = true;
    dispatch({ type: 'QUESTION_LOADING', topic: state.topic, mode: 'generate', clearAnswer });
    if (removeOldQuestion) {
      history.replace(practiceHref(state.topic.id, returnSessionID));
    }
    try {
      const loaded = await generateTestQuestion(learnerID, state.topic.id);
      history.replace(practiceHref(state.topic.id, returnSessionID, loaded.question_id));
      dispatch({ type: 'QUESTION_READY', question: loaded, clearAnswer });
    } catch (event) {
      dispatch({ type: 'QUESTION_FAILED', message: displayError(event) });
    } finally {
      questionInFlight.current = false;
    }
  }

  async function requestReloadedQuestion() {
    if (!state.topic || !initialQuestionID || questionInFlight.current || state.status === 'loading-question') {
      return;
    }
    questionInFlight.current = true;
    dispatch({ type: 'QUESTION_LOADING', topic: state.topic, mode: 'reload', clearAnswer: false });
    try {
      const loaded = await reloadTestQuestion(learnerID, initialQuestionID);
      if (loaded.topic_id !== state.topic.id) {
        dispatch({ type: 'QUESTION_TOPIC_MISMATCH' });
        return;
      }
      dispatch({ type: 'QUESTION_READY', question: loaded, clearAnswer: false });
    } catch (event) {
      dispatch({ type: 'QUESTION_FAILED', message: displayError(event) });
    } finally {
      questionInFlight.current = false;
    }
  }

  async function submitAnswer() {
    if (
      !state.question ||
      !state.answer.trim() ||
      submissionInFlight.current ||
      (state.status !== 'answering' && state.status !== 'judging-error')
    ) {
      return;
    }
    submissionInFlight.current = true;
    dispatch({ type: 'SUBMITTING' });
    try {
      const result = await submitTestAnswer(learnerID, state.question.question_id, state.answer);
      dispatch({ type: 'JUDGED', result });
    } catch (event) {
      dispatch({ type: 'JUDGING_FAILED', message: displayError(event) });
    } finally {
      submissionInFlight.current = false;
    }
  }

  const pageTitle = state.topic?.label ?? 'Python topic practice';
  const progress = state.result?.progress ?? state.question?.progress ?? state.topic;
  const progressText = progress ? `${progress.score}/${progress.maximum}` : '';
  const progressLabel = state.topic && progress ? `${state.topic.label} progress ${progressText}` : undefined;

  return (
    <PageContainer
      title={pageTitle}
      subTitle={state.question ? `Mastery level ${state.question.level} of 10` : 'Python topic practice'}
      extra={[
        <Button key="back" href={backHref} aria-label="Back to Test Center">
          Back to Test Center
        </Button>,
      ]}
    >
      <main className="test-topic-practice-page">
        {state.topic ? <TopicContext topic={state.topic} /> : null}

        {state.status === 'loading-topic' || state.status === 'loading-question' ? (
          <div className="test-topic-practice-loading" aria-label="Loading question">
            <Spin size="large" tip="Loading question">
              <div className="test-topic-practice-loading-space" />
            </Spin>
          </div>
        ) : null}

        {state.status === 'not-found' ? (
          <Result status="404" title="404" subTitle="Topic not found" />
        ) : null}

        {state.status === 'completed' && state.topic ? (
          <Result
            status="success"
            title="Topic completed"
            subTitle={`${state.topic.score}/${state.topic.maximum}`}
            extra={
              <Button href={returnHref} aria-label="Return to learning">
                Return to learning
              </Button>
            }
          />
        ) : null}

        {state.status === 'generation-error' ? (
          <ProCard className="test-practice-state-card" bordered>
            <Alert type="error" showIcon message={state.message} />
            {state.topic ? (
              <Button
                type="primary"
                onClick={() =>
                  state.questionMode === 'reload'
                    ? void requestReloadedQuestion()
                    : void requestGeneratedQuestion(state.clearAnswerOnSuccess, false)
                }
              >
                {state.questionMode === 'reload' ? 'Retry loading question' : 'Retry generation'}
              </Button>
            ) : null}
          </ProCard>
        ) : null}

        {state.status === 'topic-mismatch' && state.topic ? (
          <Result
            status="error"
            title="Question does not match this topic"
            subTitle="The saved question belongs to another topic and cannot be shown or submitted here."
            extra={[
              <Button
                key="selected-topic"
                type="primary"
                href={practiceHref(state.topic.id, returnSessionID)}
                aria-label="Open selected topic"
              >
                Open selected topic
              </Button>,
              <Button key="overview" href={backHref} aria-label="Back to topic overview">
                Back to topic overview
              </Button>,
            ]}
          />
        ) : null}

        {(state.status === 'answering' || state.status === 'submitting' || state.status === 'judging-error') &&
        state.topic &&
        state.question ? (
          <>
            <ProCard className="test-question-card" bordered>
              <div className="test-question-meta">
                <Typography.Text strong>Level {state.question.level}</Typography.Text>
                <Typography.Text type="secondary">{state.question.question_format}</Typography.Text>
                <Typography.Text strong>{progressText}</Typography.Text>
              </div>
              <Progress percent={progress?.percent ?? 0} showInfo={false} aria-label={progressLabel} />
              <pre className="test-question-text">{state.question.question_text}</pre>
              {state.question.question_format === 'multiple_choice' ? (
                <Radio.Group
                  aria-label="Answer options"
                  className="test-question-options"
                  value={state.answer}
                  onChange={(event) => dispatch({ type: 'ANSWER_CHANGED', answer: event.target.value })}
                  disabled={state.status === 'submitting'}
                >
                  {state.question.options.map((option) => (
                    <Radio key={option} value={option} className="test-question-option">
                      {option}
                    </Radio>
                  ))}
                </Radio.Group>
              ) : null}
            </ProCard>
            <ProCard className="test-answer-card" bordered>
              {state.status === 'judging-error' ? (
                <Alert type="error" showIcon message={state.message} />
              ) : null}
              {state.question.question_format === 'multiple_choice' ? null : (
                <Input.TextArea
                  aria-label="Your answer"
                  value={state.answer}
                  onChange={(event) => dispatch({ type: 'ANSWER_CHANGED', answer: event.target.value })}
                  placeholder="Enter your answer"
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  disabled={state.status === 'submitting'}
                />
              )}
              <Button
                type="primary"
                aria-label={state.status === 'judging-error' ? 'Retry submission' : 'Submit answer'}
                loading={state.status === 'submitting'}
                disabled={!state.answer.trim() || state.status === 'submitting'}
                onClick={() => void submitAnswer()}
              >
                {state.status === 'judging-error' ? 'Retry submission' : 'Submit answer'}
              </Button>
            </ProCard>
          </>
        ) : null}

        {state.status === 'incorrect' && state.result ? (
          <Result
            status="error"
            title="Answer needs revision"
            subTitle={
              <div className="test-result-copy">
                <Typography.Paragraph>{state.result.feedback}</Typography.Paragraph>
                <Typography.Text strong>
                  {state.result.progress.score}/{state.result.progress.maximum}
                </Typography.Text>
              </div>
            }
            extra={[
              <Button key="new-question" type="primary" onClick={() => void requestGeneratedQuestion(true, true)}>
                Try a new question
              </Button>,
              <Button key="return" href={returnHref} aria-label="Return to learning">
                Return to learning
              </Button>,
            ]}
          />
        ) : null}

        {state.status === 'correct' && state.result ? (
          state.result.progress.score >= state.result.progress.maximum ? (
            <Result
              status="success"
              title="Topic completed"
              subTitle={`${state.result.progress.score}/${state.result.progress.maximum}`}
              extra={
                <Button href={returnHref} aria-label="Return to learning">
                  Return to learning
                </Button>
              }
            />
          ) : (
            <Result
              status="success"
              title="Correct"
              subTitle={
                <div className="test-result-copy">
                  <Typography.Paragraph>{state.result.feedback}</Typography.Paragraph>
                  <Typography.Text strong>
                    {state.result.progress.score}/{state.result.progress.maximum}
                  </Typography.Text>
                </div>
              }
              extra={[
                <Button
                  key="next"
                  type="primary"
                  onClick={() => void requestGeneratedQuestion(true, true)}
                >
                  Next question
                </Button>,
                <Button key="return" href={returnHref} aria-label="Return to learning">
                  Return to learning
                </Button>,
              ]}
            />
          )
        ) : null}
      </main>
    </PageContainer>
  );
}
