import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { PublicTestQuestion, PublicTestResult, TestTopicProgress } from './model';
import TopicPage from './TopicPage';

const routeParams = vi.hoisted(() => ({ current: { topicId: 'loops_iteration' } }));
const historyReplaceMock = vi.hoisted(() => vi.fn());
const fetchTestTopicsMock = vi.hoisted(() => vi.fn());
const generateTestQuestionMock = vi.hoisted(() => vi.fn());
const reloadTestQuestionMock = vi.hoisted(() => vi.fn());
const submitTestAnswerMock = vi.hoisted(() => vi.fn());
const getOrCreateLearnerIDMock = vi.hoisted(() => vi.fn(() => 'learner / one'));

vi.mock('@umijs/max', () => ({
  history: { replace: historyReplaceMock },
  useParams: () => routeParams.current,
}));

vi.mock('./api', () => ({
  fetchTestTopics: fetchTestTopicsMock,
  generateTestQuestion: generateTestQuestionMock,
  reloadTestQuestion: reloadTestQuestionMock,
  submitTestAnswer: submitTestAnswerMock,
}));

vi.mock('../../utils/learner', () => ({
  getOrCreateLearnerID: getOrCreateLearnerIDMock,
}));

const topic: TestTopicProgress = {
  id: 'loops_iteration',
  label: 'Loops and Iteration',
  summary: 'Practice for and while loops, ranges, and termination conditions.',
  icon: 'ReloadOutlined',
  score: 3,
  maximum: 10,
  percent: 30,
};

const question: PublicTestQuestion = {
  question_id: 'question-1',
  topic_id: topic.id,
  level: 4,
  question_format: 'output_prediction',
  question_text: 'What does this code print?\nfor value in range(2):\n    print(value)',
  options: ['0 then 1', '1 then 2'],
  progress: { score: 3, maximum: 10, percent: 30 },
};

const correctResult: PublicTestResult = {
  attempt_id: 'attempt-1',
  question_id: question.question_id,
  is_correct: true,
  feedback: 'Correct reasoning.',
  progress: { score: 4, maximum: 10, percent: 40 },
  duplicate: false,
};

const incorrectResult: PublicTestResult = {
  attempt_id: 'attempt-2',
  question_id: question.question_id,
  is_correct: false,
  feedback: 'Review how range stops before its endpoint.',
  progress: { score: 3, maximum: 10, percent: 30 },
  duplicate: false,
};

async function expectQuestionText(text: string) {
  await waitFor(() => expect(document.querySelector('.test-question-text')?.textContent).toBe(text));
}

function expectTopicContext() {
  const context = screen.getByRole('region', { name: `${topic.label} topic context` });
  expect(within(context).getByText(topic.label)).toBeInTheDocument();
  expect(within(context).getByText(topic.summary)).toBeInTheDocument();
  expect(within(context).getByTestId('test-topic-context-icon')).toBeInTheDocument();
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  routeParams.current = { topicId: 'loops_iteration' };
  window.history.replaceState({}, '', '/test/loops_iteration?return_session_id=session%20%2F%20one');
  historyReplaceMock.mockReset();
  fetchTestTopicsMock.mockReset();
  generateTestQuestionMock.mockReset();
  reloadTestQuestionMock.mockReset();
  submitTestAnswerMock.mockReset();
  getOrCreateLearnerIDMock.mockClear();
  fetchTestTopicsMock.mockResolvedValue([topic]);
  generateTestQuestionMock.mockResolvedValue(question);
  reloadTestQuestionMock.mockResolvedValue(question);
  submitTestAnswerMock.mockResolvedValue(correctResult);
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

test('renders a 404 for an unknown topic without loading a question', async () => {
  routeParams.current = { topicId: 'missing_topic' };

  render(<TopicPage />);

  expect(await screen.findByText('404')).toBeInTheDocument();
  expect(screen.getByText('Topic not found')).toBeInTheDocument();
  expect(generateTestQuestionMock).not.toHaveBeenCalled();
  expect(reloadTestQuestionMock).not.toHaveBeenCalled();
});

test('shows a completed topic without generating or reloading a question', async () => {
  fetchTestTopicsMock.mockResolvedValue([{ ...topic, score: 10, percent: 100 }]);

  render(<TopicPage />);

  expect(await screen.findByText('Topic completed')).toBeInTheDocument();
  expect(screen.getByText('10/10')).toBeInTheDocument();
  expectTopicContext();
  expect(generateTestQuestionMock).not.toHaveBeenCalled();
  expect(reloadTestQuestionMock).not.toHaveBeenCalled();
});

test('keeps the selected topic icon and full summary visible while loading and after the question arrives', async () => {
  let resolveQuestion: ((value: PublicTestQuestion) => void) | undefined;
  generateTestQuestionMock.mockImplementation(
    () =>
      new Promise<PublicTestQuestion>((resolve) => {
        resolveQuestion = resolve;
      }),
  );

  render(<TopicPage />);

  expect(await screen.findByLabelText('Loading question')).toBeInTheDocument();
  expectTopicContext();

  resolveQuestion?.(question);
  await expectQuestionText(question.question_text);
  expectTopicContext();
});

test('auto-generates one question for an incomplete topic and records it in history', async () => {
  render(<TopicPage />);

  await expectQuestionText(question.question_text);
  expect(generateTestQuestionMock).toHaveBeenCalledTimes(1);
  expect(generateTestQuestionMock).toHaveBeenCalledWith('learner / one', 'loops_iteration');
  expect(historyReplaceMock).toHaveBeenCalledWith(
    '/test/loops_iteration?return_session_id=session%20%2F%20one&question_id=question-1',
  );
});

test('reloads question_id with GET semantics and never generates on initial load', async () => {
  window.history.replaceState(
    {},
    '',
    '/test/loops_iteration?question_id=question%20%2F%20one&return_session_id=session%20one',
  );

  render(<TopicPage />);

  await expectQuestionText(question.question_text);
  expect(reloadTestQuestionMock).toHaveBeenCalledWith('learner / one', 'question / one');
  expect(generateTestQuestionMock).not.toHaveBeenCalled();
  expect(historyReplaceMock).not.toHaveBeenCalled();
});

test('rejects a reloaded question from a different topic without rendering or submitting it', async () => {
  window.history.replaceState(
    {},
    '',
    '/test/loops_iteration?question_id=foreign-question&return_session_id=session%20%2F%20one',
  );
  reloadTestQuestionMock.mockResolvedValue({
    ...question,
    question_id: 'foreign-question',
    topic_id: 'variables_names_assignment',
    question_text: 'This foreign question must never render.',
  });

  render(<TopicPage />);

  expect(await screen.findByText('Question does not match this topic')).toBeInTheDocument();
  expectTopicContext();
  expect(screen.queryByText('This foreign question must never render.')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Your answer' })).not.toBeInTheDocument();
  expect(submitTestAnswerMock).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Open selected topic' })).toHaveAttribute(
    'href',
    '/test/loops_iteration?return_session_id=session%20%2F%20one',
  );
  expect(screen.getByRole('link', { name: 'Back to topic overview' })).toHaveAttribute(
    'href',
    '/test?return_session_id=session%20%2F%20one',
  );
  expect(generateTestQuestionMock).not.toHaveBeenCalled();
});

test('keeps submission disabled until the answer contains non-whitespace text', async () => {
  render(<TopicPage />);

  const answer = await screen.findByRole('textbox', { name: 'Your answer' });
  const submit = screen.getByRole('button', { name: 'Submit answer' });
  expect(submit).toBeDisabled();

  fireEvent.change(answer, { target: { value: '   ' } });
  expect(submit).toBeDisabled();
  fireEvent.change(answer, { target: { value: '0 then 1' } });
  expect(submit).toBeEnabled();
});

test('submits the selected option text for a multiple-choice question', async () => {
  const multipleChoiceQuestion: PublicTestQuestion = {
    ...question,
    level: 1,
    question_format: 'multiple_choice',
    question_text: 'Which symbol assigns a value to a variable?',
    options: ['The equals sign =', 'The double equals ==', 'The arrow ->', 'The colon :'],
  };
  generateTestQuestionMock.mockResolvedValue(multipleChoiceQuestion);

  render(<TopicPage />);

  const option = await screen.findByRole('radio', { name: 'The equals sign =' });
  expect(screen.queryByRole('textbox', { name: 'Your answer' })).not.toBeInTheDocument();
  fireEvent.click(option);
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));

  await waitFor(() => {
    expect(submitTestAnswerMock).toHaveBeenCalledWith('learner / one', 'question-1', 'The equals sign =');
  });
});

test('does not render persisted options for a terminology question', async () => {
  generateTestQuestionMock.mockResolvedValue({
    ...question,
    level: 2,
    question_format: 'terminology',
    question_text: 'What does None represent in Python?',
    options: ['None', 'Null', 'Empty', 'Zero'],
  });

  render(<TopicPage />);

  await screen.findByRole('textbox', { name: 'Your answer' });
  expect(screen.queryByText('Null', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

test('shows updated progress after a correct answer and loads the next question', async () => {
  const nextQuestion: PublicTestQuestion = {
    ...question,
    question_id: 'question-2',
    level: 5,
    question_text: 'What values does range(3) produce?',
    progress: correctResult.progress,
  };
  generateTestQuestionMock.mockReset();
  generateTestQuestionMock.mockResolvedValueOnce(question).mockResolvedValueOnce(nextQuestion);

  render(<TopicPage />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), {
    target: { value: '0 then 1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));

  expect(await screen.findByText('Correct')).toBeInTheDocument();
  expect(screen.getByText('4/10')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));

  expect(await screen.findByText(nextQuestion.question_text)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('');
  expect(historyReplaceMock).toHaveBeenCalledWith(
    '/test/loops_iteration?return_session_id=session%20%2F%20one',
  );
  expect(historyReplaceMock).toHaveBeenLastCalledWith(
    '/test/loops_iteration?return_session_id=session%20%2F%20one&question_id=question-2',
  );
});

test('turns a correct tenth answer into Topic completed without Next question', async () => {
  fetchTestTopicsMock.mockResolvedValue([{ ...topic, score: 9, percent: 90 }]);
  generateTestQuestionMock.mockResolvedValue({
    ...question,
    level: 10,
    progress: { score: 9, maximum: 10, percent: 90 },
  });
  submitTestAnswerMock.mockResolvedValue({
    ...correctResult,
    progress: { score: 10, maximum: 10, percent: 100 },
  });

  render(<TopicPage />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), {
    target: { value: '0 then 1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));

  expect(await screen.findByText('Topic completed')).toBeInTheDocument();
  expect(screen.getByText('10/10')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next question' })).not.toBeInTheDocument();
});

test('offers a same-level new question after an incorrect answer without changing progress', async () => {
  const replacementQuestion: PublicTestQuestion = {
    ...question,
    question_id: 'question-2',
    question_text: 'What does range(4) produce?',
    progress: incorrectResult.progress,
  };
  submitTestAnswerMock.mockResolvedValue(incorrectResult);
  generateTestQuestionMock.mockReset();
  generateTestQuestionMock.mockResolvedValueOnce(question).mockResolvedValueOnce(replacementQuestion);

  render(<TopicPage />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), {
    target: { value: '1 then 2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));

  expect(await screen.findByText('Answer needs revision')).toBeInTheDocument();
  expect(screen.getByText(incorrectResult.feedback)).toBeInTheDocument();
  expect(screen.getByText('3/10')).toBeInTheDocument();
  expect(screen.queryByText('Private correct response')).not.toBeInTheDocument();
  const returnLinks = screen.getAllByRole('link', { name: 'Return to learning' });
  expect(returnLinks).toHaveLength(1);
  expect(returnLinks[0]).not.toHaveClass('ant-btn-primary');
  fireEvent.click(screen.getByRole('button', { name: 'Try a new question' }));

  await expectQuestionText(replacementQuestion.question_text);
  expect(generateTestQuestionMock).toHaveBeenLastCalledWith('learner / one', topic.id);
  expect(screen.getByText('3/10')).toBeInTheDocument();
});

test('retries generation after a generation failure', async () => {
  generateTestQuestionMock.mockRejectedValueOnce(new Error('generation_failed')).mockResolvedValueOnce(question);

  render(<TopicPage />);

  const retry = await screen.findByRole('button', { name: 'Retry generation' });
  expectTopicContext();
  fireEvent.click(retry);
  await expectQuestionText(question.question_text);
  expect(generateTestQuestionMock).toHaveBeenCalledTimes(2);
});

test('retains the answer and hides internal details while retrying a failed judgment', async () => {
  submitTestAnswerMock
    .mockRejectedValueOnce(Object.assign(new Error('answer_evaluation_unavailable'), {
      code: 'answer_evaluation_unavailable',
      status: 502,
    }))
    .mockResolvedValueOnce(incorrectResult);

  render(<TopicPage />);
  const answer = await screen.findByRole('textbox', { name: 'Your answer' });
  fireEvent.change(answer, { target: { value: 'my retained answer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));

  expect(await screen.findByRole('button', { name: 'Retry submission' })).toBeInTheDocument();
  expect(
    screen.getByText('We could not evaluate this answer yet. Your answer is still saved here; please retry.'),
  ).toBeInTheDocument();
  expect(screen.queryByText('judging_failed')).not.toBeInTheDocument();
  expect(screen.queryByText('502')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue('my retained answer');
  fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));

  expect(await screen.findByText('Answer needs revision')).toBeInTheDocument();
  expect(submitTestAnswerMock).toHaveBeenNthCalledWith(1, 'learner / one', 'question-1', 'my retained answer');
  expect(submitTestAnswerMock).toHaveBeenNthCalledWith(2, 'learner / one', 'question-1', 'my retained answer');
});

test('uses the existing exact quota wording', async () => {
  generateTestQuestionMock.mockRejectedValue(
    Object.assign(new Error('token_budget_exhausted'), { code: 'token_budget_exhausted' }),
  );

  render(<TopicPage />);

  expect(await screen.findByText('Daily token quota exceeded. Please try again in 1 day.')).toBeInTheDocument();
});

test('preserves return_session_id in Test Center and learning links', async () => {
  fetchTestTopicsMock.mockResolvedValue([{ ...topic, score: 10, percent: 100 }]);

  render(<TopicPage />);

  expect(await screen.findByText('Topic completed')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to Test Center' })).toHaveAttribute(
    'href',
    '/test?return_session_id=session%20%2F%20one',
  );
  expect(screen.getByRole('link', { name: 'Return to learning' })).toHaveAttribute(
    'href',
    '/?session_id=session%20%2F%20one',
  );
});

test('uses the encoded public question and answer API contracts', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => question })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => question })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => correctResult });
  vi.stubGlobal('fetch', fetchMock);
  const { generateTestQuestion, reloadTestQuestion, submitTestAnswer } = await vi.importActual<
    typeof import('./api')
  >('./api');

  await expect(generateTestQuestion('learner / one', 'loops / iteration')).resolves.toEqual(question);
  await expect(reloadTestQuestion('learner / one', 'question / one')).resolves.toEqual(question);
  await expect(submitTestAnswer('learner / one', 'question / one', ' 0 then 1 ')).resolves.toEqual(correctResult);

  expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/tests/question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ learner_id: 'learner / one', topic_id: 'loops / iteration' }),
  });
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    '/api/tests/question/question%20%2F%20one?learner_id=learner%20%2F%20one',
  );
  expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/tests/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      learner_id: 'learner / one',
      question_id: 'question / one',
      answer: ' 0 then 1 ',
    }),
  });
});

test('keeps public types private-field-free and question text preformatted above the reserved boundary', () => {
  const model = readFileSync(`${process.cwd()}/src/pages/TestCenter/model.ts`, 'utf8');
  const page = readFileSync(`${process.cwd()}/src/pages/TestCenter/TopicPage.tsx`, 'utf8');
  const css = readFileSync(`${process.cwd()}/src/global.css`, 'utf8');

  expect(model).not.toMatch(/expected|equivalents|rubric|reason/i);
  expect(page).not.toMatch(/expected|equivalents|rubric|reason/i);
  expect(page).toContain("import { topicIconForKey } from './topicIcons';");
  expect(css).toMatch(/\.test-topic-practice-page\s*\{[^}]*padding-bottom:\s*32px;/s);
  expect(css).toMatch(/\.test-question-text\s*\{[^}]*white-space:\s*pre-wrap;/s);
});
