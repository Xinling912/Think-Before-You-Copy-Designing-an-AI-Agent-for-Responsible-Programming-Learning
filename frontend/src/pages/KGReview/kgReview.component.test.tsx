import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import KGReviewPage from './index';

const candidates = Array.from({ length: 6 }, (_, index) => ({
  candidate_id: `kgcand-${index + 1}`,
  source_chunk_id: `python-docs-3.14.6-${index + 1}`,
  source_url: `https://docs.python.org/3/tutorial/example-${index + 1}.html`,
  subject: index === 0 ? 'Concept:valid_index_range' : `Concept:source_${index + 1}`,
  predicate: index === 0 ? 'prevents' : 'related_to',
  object: index === 0 ? 'ErrorType:IndexError' : `Concept:target_${index + 1}`,
  confidence: 0.88 - index * 0.01,
  evidence_text:
    index === 0
      ? 'It raises an IndexError if the list is empty or the index is outside the list range'
      : `Evidence text for candidate ${index + 1}`,
  status: 'auto_extracted',
  review_status: 'pending',
  reviewer_id: '',
  reviewer_note: '',
  reviewed_at: '',
  created_at: '2026-07-03T00:00:00Z',
}));

const candidatePayload = {
  candidate_count: candidates.length,
  filtered_count: candidates.length,
  status_counts: {
    auto_extracted: candidates.length,
  },
  candidates,
};

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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => candidatePayload,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders five KG candidate cards per page with source evidence', async () => {
  render(<KGReviewPage />);

  await waitFor(() => expect(screen.getByText('kgcand-1')).toBeInTheDocument());

  expect(screen.getByText('Ain 2023 educational KG extraction')).toBeInTheDocument();
  expect(screen.getAllByLabelText(/KG candidate /)).toHaveLength(5);
  expect(screen.getByText('Concept:valid_index_range')).toBeInTheDocument();
  expect(screen.getByText('prevents')).toBeInTheDocument();
  expect(screen.getByText('ErrorType:IndexError')).toBeInTheDocument();
  expect(screen.getByText('python-docs-3.14.6-1')).toBeInTheDocument();
  expect(screen.getByText('https://docs.python.org/3/tutorial/example-1.html')).toBeInTheDocument();
  expect(screen.getByText('It raises an IndexError if the list is empty or the index is outside the list range')).toBeInTheDocument();
  expect(screen.getByText('0.88')).toBeInTheDocument();
  expect(screen.queryByText('kgcand-6')).not.toBeInTheDocument();
});

test('changes page without stretching candidate cards', async () => {
  render(<KGReviewPage />);

  await waitFor(() => expect(screen.getByText('kgcand-1')).toBeInTheDocument());
  fireEvent.click(screen.getByTitle('2'));

  expect(screen.getByText('kgcand-6')).toBeInTheDocument();
  expect(screen.getAllByLabelText(/KG candidate /)).toHaveLength(1);
  expect(screen.queryByText('kgcand-1')).not.toBeInTheDocument();
});

test('posts approve decision and refreshes KG candidates', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/kg/candidates/kgcand-1/review')) {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        status: 'approved',
        reviewer_id: 'local-reviewer',
        reviewer_note: 'Evidence matches Python official docs.',
      });
      return {
        ok: true,
        json: async () => ({
          candidate_id: 'kgcand-1',
          review_status: 'approved',
          reviewer_id: 'local-reviewer',
          reviewer_note: 'Evidence matches Python official docs.',
          reviewed_at: '2026-07-04T00:00:00Z',
        }),
      };
    }
    return {
      ok: true,
      json: async () => candidatePayload,
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<KGReviewPage />);
  await waitFor(() => expect(screen.getByText('kgcand-1')).toBeInTheDocument());

  fireEvent.click(screen.getAllByRole('button', { name: 'Approve / 通过' })[0]);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/kg/candidates/kgcand-1/review',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
