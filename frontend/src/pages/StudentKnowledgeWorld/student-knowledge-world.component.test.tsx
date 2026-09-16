import { act, render, screen, waitFor, within } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { KGOverview } from '../../components/KGWorld/types';

const canvasScenario = vi.hoisted(() => ({
  unsupported: false,
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../components/KGWorld/KGGraphCanvas', () => ({
  KGGraphCanvas: forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({
      fitView: vi.fn().mockResolvedValue(undefined),
      resetLayout: vi.fn().mockResolvedValue(undefined),
      focusCategory: vi.fn().mockResolvedValue(undefined),
      focusNode: vi.fn().mockResolvedValue(undefined),
      getZoom: () => 1,
      destroy: vi.fn(),
    }));
    useEffect(() => {
      canvasScenario.props.push(props);
      if (canvasScenario.unsupported) {
        (props.onCanvasUnsupported as (() => void) | undefined)?.();
      }
    }, [props]);
    return <div data-testid="kg-canvas-host" />;
  }),
}));

import StudentKnowledgeWorldPage from './index';

const loadRepositoryOverview = (): KGOverview => {
  const aiCoreDirectory = resolve(process.cwd(), '../services/ai-core-python');
  const output = execFileSync(
    process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' ? 'python' : 'python3'),
    ['-c', 'import json; from app.kg import build_kg_overview; print(json.dumps(build_kg_overview()))'],
    { cwd: aiCoreDirectory, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(output) as KGOverview;
};

const overview = loadRepositoryOverview();
let reduceMotion = false;

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 503 ? 'Service Unavailable' : '',
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function deferredResponse() {
  let resolveRequest!: (value: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  });
  return { promise, resolveRequest };
}

beforeEach(() => {
  canvasScenario.unsupported = false;
  canvasScenario.props.length = 0;
  reduceMotion = false;
  window.history.replaceState({}, '', '/knowledge-world');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(overview)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('student Knowledge World page', () => {
  test('shows the graph-sized loading skeleton while the public overview loads', () => {
    const pending = deferredResponse();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);

    render(<StudentKnowledgeWorldPage />);

    expect(screen.getByTestId('student-kg-world-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('student-kg-skeleton-region')).toHaveLength(6);
    expect(screen.getAllByTestId('student-kg-skeleton-node')).toHaveLength(24);
  });

  test('renders the complete public world in English with a route back to learning chat', async () => {
    vi.useFakeTimers();
    render(<StudentKnowledgeWorldPage />);
    await act(async () => Promise.resolve());

    expect(screen.getByRole('heading', { name: 'Knowledge World' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Learning Chat' })).toHaveAttribute('href', '/');
    expect(screen.getByTestId('kg-canvas-host')).toBeInTheDocument();
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(screen.getByRole('button', { name: 'Collections and Access' })).toBeInTheDocument();
    expect(canvasScenario.props.at(-1)?.['aria-label']).toBe('Knowledge World canvas');
    expect(fetch).toHaveBeenCalledWith('/api/kg/overview');

    const pageText = document.body.textContent ?? '';
    expect(pageText).not.toMatch(/[\u3400-\u9fff]/u);
    vi.useRealTimers();
  });

  test('restores a deep-linked path using English student controls', async () => {
    reduceMotion = true;
    const path = overview.paths.find((candidate) => candidate.category_ids.length > 0)!;
    window.history.replaceState(
      {},
      '',
      `/knowledge-world?category=${encodeURIComponent(path.category_ids[0])}&path=${encodeURIComponent(path.path_id)}`,
    );

    render(<StudentKnowledgeWorldPage />);

    await waitFor(() => expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL'));
    expect(screen.getByRole('combobox', { name: 'Learning path' })).toHaveValue(path.path_id);
    expect(screen.getByRole('button', { name: 'Back to Knowledge World' })).toBeInTheDocument();
  });

  test('keeps request failures in English and allows reload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 503));
    render(<StudentKnowledgeWorldPage />);

    expect(await screen.findByRole('heading', { name: 'Knowledge World failed to load' })).toBeInTheDocument();
    expect(screen.getByText('Unable to load knowledge graph data. Please reload.')).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Reload' })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/u);
  });

  test('does not expose non-English network error details', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('网络异常'));
    render(<StudentKnowledgeWorldPage />);

    expect(await screen.findByText('Request failed.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/u);
  });

  test('does not expose non-English payload text in integrity failures', async () => {
    const invalid = structuredClone(overview);
    invalid.integrity.valid = false;
    invalid.integrity.duplicate_node_ids = ['概念:list'];
    vi.mocked(fetch).mockResolvedValueOnce(response(invalid));

    render(<StudentKnowledgeWorldPage />);

    expect(await screen.findByRole('heading', { name: 'Knowledge graph integrity error' })).toBeInTheDocument();
    expect(screen.getByText('Knowledge graph data failed validation.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/u);
  });

  test('keeps the full graph accessible in English when Canvas is unavailable', async () => {
    canvasScenario.unsupported = true;
    render(<StudentKnowledgeWorldPage />);

    const fallback = await screen.findByTestId('student-kg-readonly-fallback');
    expect(fallback).toHaveTextContent('Collections and Access');
    expect(fallback).toHaveTextContent('Concept:list');
    expect(fallback).toHaveTextContent(overview.paths[0].path_id);
    expect(fallback.textContent).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
