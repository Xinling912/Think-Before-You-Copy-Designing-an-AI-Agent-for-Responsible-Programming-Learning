import type { PublicTestQuestion, PublicTestResult, TestTopicProgress } from './model';

type TestTopicsResponse = {
  topics: TestTopicProgress[];
};

export class TestAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'TestAPIError';
    this.code = code;
    this.status = status;
  }
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new TestAPIError(data.error || fallback, response.status);
  }
  return data;
}

export async function fetchTestTopics(learnerID: string): Promise<TestTopicProgress[]> {
  const response = await fetch(`/api/tests/topics?learner_id=${encodeURIComponent(learnerID)}`);
  const data = await readResponse<Partial<TestTopicsResponse>>(response, 'Unable to load test topics');
  if (!Array.isArray(data.topics)) {
    throw new Error('Invalid test topics response');
  }

  return data.topics;
}

export async function generateTestQuestion(learnerID: string, topicID: string): Promise<PublicTestQuestion> {
  const response = await fetch('/api/tests/question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ learner_id: learnerID, topic_id: topicID }),
  });
  return readResponse<PublicTestQuestion>(response, 'Unable to generate test question');
}

export async function reloadTestQuestion(learnerID: string, questionID: string): Promise<PublicTestQuestion> {
  const response = await fetch(
    `/api/tests/question/${encodeURIComponent(questionID)}?learner_id=${encodeURIComponent(learnerID)}`,
  );
  return readResponse<PublicTestQuestion>(response, 'Unable to reload test question');
}

export async function submitTestAnswer(
  learnerID: string,
  questionID: string,
  answer: string,
): Promise<PublicTestResult> {
  const response = await fetch('/api/tests/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ learner_id: learnerID, question_id: questionID, answer }),
  });
  return readResponse<PublicTestResult>(response, 'Unable to submit test answer');
}
