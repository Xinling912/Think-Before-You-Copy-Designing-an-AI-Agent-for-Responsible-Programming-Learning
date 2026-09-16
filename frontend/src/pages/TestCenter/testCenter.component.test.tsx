import { render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { TestIconKey, TestTopicProgress } from './model';
import { topicIconByKey } from './topicIcons';
import TestCenterPage from './index';

const fetchTestTopicsMock = vi.hoisted(() => vi.fn());
const getOrCreateLearnerIDMock = vi.hoisted(() => vi.fn(() => 'learner / one'));

vi.mock('./api', () => ({
  fetchTestTopics: fetchTestTopicsMock,
}));

vi.mock('../../utils/learner', () => ({
  getOrCreateLearnerID: getOrCreateLearnerIDMock,
}));

const iconKeys: TestIconKey[] = [
  'CodeOutlined',
  'EditOutlined',
  'DatabaseOutlined',
  'CalculatorOutlined',
  'FontSizeOutlined',
  'UnorderedListOutlined',
  'KeyOutlined',
  'NumberOutlined',
  'BranchesOutlined',
  'ReloadOutlined',
  'FilterOutlined',
  'FunctionOutlined',
  'SwapOutlined',
  'AppstoreOutlined',
  'BugOutlined',
  'FileTextOutlined',
  'ApartmentOutlined',
  'DeploymentUnitOutlined',
  'SafetyCertificateOutlined',
  'CloudOutlined',
];

const topics: TestTopicProgress[] = iconKeys.map((icon, index) => ({
  id: `topic_${String(index + 1).padStart(2, '0')}`,
  label: `Python topic ${String(index + 1).padStart(2, '0')}`,
  summary: `Contract summary for Python topic ${String(index + 1).padStart(2, '0')}.`,
  icon,
  score: index % 11,
  maximum: 10,
  percent: (index % 11) * 10,
}));

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
  window.history.replaceState({}, '', '/test?return_session_id=session%20%2F%20one');
  fetchTestTopicsMock.mockReset();
  fetchTestTopicsMock.mockResolvedValue(topics);
  getOrCreateLearnerIDMock.mockClear();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

test('fetches by shared learner ID and renders twenty ordered accessible topic links', async () => {
  render(<TestCenterPage />);

  await waitFor(() => expect(fetchTestTopicsMock).toHaveBeenCalledWith('learner / one'));

  expect(screen.getByText('Ten mastery levels per topic')).toBeInTheDocument();
  expect(screen.queryByText(/ten questions per topic/i)).not.toBeInTheDocument();
  const cardLinks = screen.getAllByRole('link', { name: /^Open Python topic \d{2} test$/ });
  expect(cardLinks).toHaveLength(20);
  expect(cardLinks.map((link) => link.getAttribute('aria-label'))).toEqual(
    topics.map((topic) => `Open ${topic.label} test`),
  );
  expect(screen.getAllByTestId('test-topic-icon')).toHaveLength(20);

  topics.forEach((topic, index) => {
    const card = cardLinks[index];
    expect(within(card).getByText(topic.label)).toBeInTheDocument();
    expect(within(card).getByText(topic.summary)).toBeInTheDocument();
    expect(within(card).getByText(`${topic.score}/10`)).toBeInTheDocument();
    expect(within(card).getByLabelText(`${topic.label} progress ${topic.score}/10`)).toBeInTheDocument();
    expect(card).toHaveAttribute(
      'href',
      `/test/${encodeURIComponent(topic.id)}?return_session_id=session%20%2F%20one`,
    );
  });

  expect(screen.getByRole('link', { name: 'Back to learning' })).toHaveAttribute(
    'href',
    '/?session_id=session%20%2F%20one',
  );
});

test('uses plain topic and learning links when there is no return session', async () => {
  window.history.replaceState({}, '', '/test');
  render(<TestCenterPage />);

  const firstCard = await screen.findByRole('link', { name: `Open ${topics[0].label} test` });
  expect(firstCard).toHaveAttribute('href', `/test/${encodeURIComponent(topics[0].id)}`);
  expect(screen.getByRole('link', { name: 'Back to learning' })).toHaveAttribute('href', '/');
});

test('renders an Ant Result when topic loading fails', async () => {
  fetchTestTopicsMock.mockRejectedValue(new Error('test_topics_lookup_failed'));

  render(<TestCenterPage />);

  expect(await screen.findByText('Unable to load Test Center')).toBeInTheDocument();
  expect(screen.getByText('test_topics_lookup_failed')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /^Open Python topic/ })).not.toBeInTheDocument();
});

test('turns an unknown API icon into a visible contract error', async () => {
  fetchTestTopicsMock.mockResolvedValue([
    {
      ...topics[0],
      icon: 'UnknownOutlined' as TestIconKey,
    },
  ]);

  render(<TestCenterPage />);

  expect(await screen.findByText('Unable to load Test Center')).toBeInTheDocument();
  expect(screen.getByText('Unsupported test topic icon: UnknownOutlined')).toBeInTheDocument();
});

test('the topics API URL-encodes the learner ID and returns the public topic fields', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ topics }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  const { fetchTestTopics } = await vi.importActual<typeof import('./api')>('./api');

  await expect(fetchTestTopics('learner / one')).resolves.toEqual(topics);
  expect(fetchMock).toHaveBeenCalledWith('/api/tests/topics?learner_id=learner%20%2F%20one');
});

test('maps exactly twenty icon keys to twenty distinct Ant icon components', () => {
  expect(Object.keys(topicIconByKey)).toEqual(iconKeys);
  expect(new Set(Object.values(topicIconByKey)).size).toBe(20);
});

test('keeps the overview at five, four, and two columns without horizontal overflow', () => {
  const css = readFileSync(`${process.cwd()}/src/global.css`, 'utf8');

  expect(css).toMatch(/\.test-center-page\s*\{[^}]*padding-bottom:\s*32px;[^}]*overflow-x:\s*hidden;/s);
  expect(css).toMatch(
    /\.test-topic-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);/s,
  );
  expect(css).toMatch(
    /@media\s*\(max-width:\s*1199px\)[\s\S]*?\.test-topic-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
  );
  expect(css).toMatch(
    /@media\s*\(max-width:\s*767px\)[\s\S]*?\.test-topic-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  );
  expect(css).toMatch(
    /\.test-topic-summary\.ant-typography\s*\{[^}]*display:\s*-webkit-box;[^}]*overflow:\s*hidden;[^}]*-webkit-box-orient:\s*vertical;[^}]*-webkit-line-clamp:\s*2;/s,
  );
  expect(css).toMatch(
    /\.test-topic-summary\.ant-typography\s*\{[^}]*flex:\s*0\s+0\s+39px;[^}]*height:\s*39px;[^}]*max-height:\s*39px;/s,
  );
});
