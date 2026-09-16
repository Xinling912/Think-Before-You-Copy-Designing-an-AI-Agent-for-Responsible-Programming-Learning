import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import DashboardPage from './index';

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
});

test('presents the responsible learning agent positioning and evidence cards', () => {
  render(<DashboardPage />);

  expect(
    screen.getByText('ResponsibleEduAgent: a Python learning agent that teaches without giving away the answer.'),
  ).toBeInTheDocument();
  expect(screen.getByText('No direct answer first')).toBeInTheDocument();
  expect(screen.getByText('Source-grounded explanation')).toBeInTheDocument();
  expect(screen.getByText('Learning evidence recorded')).toBeInTheDocument();
  expect(screen.queryByText(/Student question -> Query rewrite/)).not.toBeInTheDocument();
  expect(screen.queryByText(/MVP/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/group meeting/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/demo entrance/i)).not.toBeInTheDocument();
});

test('shows one poster stage at a time with sequential and direct navigation', () => {
  render(<DashboardPage />);

  expect(screen.getByRole('heading', { name: 'Student question' })).toBeInTheDocument();
  expect(screen.getByAltText('Student question flow diagram')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Go Gateway' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
  expect(screen.getByRole('heading', { name: 'Go Gateway' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Student question' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Jump to KG grounding' }));
  expect(screen.getByRole('heading', { name: 'KG grounding' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Go Gateway' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
  expect(screen.getByRole('heading', { name: 'Query understanding' })).toBeInTheDocument();
});
