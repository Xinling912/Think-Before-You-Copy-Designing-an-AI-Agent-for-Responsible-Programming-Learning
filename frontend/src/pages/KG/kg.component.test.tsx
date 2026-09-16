import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { KGOverview } from '../../components/KGWorld/types';
import { writeTransientPathSnapshot } from '../../components/KGWorld/transientPath';

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
    return (
      <div
        data-testid="kg-canvas-host"
        data-selected-node-id={String(props.selectedNodeID ?? '')}
        data-view-state={String(props.viewState)}
      />
    );
  }),
}));

import KGPage from './index';

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
  sessionStorage.clear();
  window.history.replaceState({}, '', '/om/kg');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
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

describe('KG knowledge world page', () => {
  test('uses a graph-sized loading skeleton with six regions and twenty-four nodes', () => {
    const pending = deferredResponse();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);

    render(<KGPage />);

    expect(screen.getByTestId('kg-world-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('kg-skeleton-region')).toHaveLength(6);
    expect(screen.getAllByTestId('kg-skeleton-node')).toHaveLength(24);
    expect(screen.queryByTestId('kg-canvas-host')).not.toBeInTheDocument();
  });

  test('renders the validated world with the four exact API metrics', async () => {
    render(<KGPage />);

    expect(await screen.findByTestId('kg-canvas-host')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Knowledge graph' })).toBeInTheDocument();
    expect(screen.getByText('Nodes')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Relations')).toBeInTheDocument();
    expect(screen.getByText('Paths')).toBeInTheDocument();
    expect(screen.getByText('83', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('6', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('367', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('160', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText('197', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(screen.queryByText('Nodes', { selector: 'button' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('fades the loading skeleton for exactly 180ms after success', async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    render(<KGPage />);

    await act(async () => pending.resolveRequest(response(overview)));
    expect(screen.getByTestId('kg-world-skeleton')).toHaveClass('is-exiting');
    expect(screen.getByTestId('kg-canvas-host')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(179));
    expect(screen.getByTestId('kg-world-skeleton')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('kg-world-skeleton')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test('shows exact HTTP failure copy, status, and reloads the request', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(overview));
    render(<KGPage />);

    expect(await screen.findByRole('heading', { name: 'Knowledge World failed to load' })).toBeInTheDocument();
    expect(screen.getByText('Unable to load knowledge graph data. Please reload.')).toBeInTheDocument();
    expect(screen.getByText(/503 Service Unavailable/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reload' }));

    expect(await screen.findByTestId('kg-canvas-host')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('shows the network error message without disabling page navigation', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Failed to fetch'));
    render(<KGPage />);

    expect(await screen.findByRole('heading', { name: 'Knowledge World failed to load' })).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Reload' })).toBeEnabled();
    expect(screen.queryByTestId('kg-canvas-host')).not.toBeInTheDocument();
  });

  test('lists every integrity error and prohibits partial graph and success metrics', async () => {
    const invalid = structuredClone(overview);
    invalid.integrity.valid = false;
    invalid.integrity.duplicate_node_ids = ['Concept:list'];
    invalid.integrity.invalid_path_ids = ['kg-path-invalid-a', 'kg-path-invalid-b'];
    vi.mocked(fetch).mockResolvedValueOnce(response(invalid));
    render(<KGPage />);

    expect(await screen.findByRole('heading', { name: 'Knowledge graph integrity error' })).toBeInTheDocument();
    expect(screen.getByText(/integrity\.duplicate_node_ids: Concept:list/)).toBeInTheDocument();
    expect(screen.getByText(/kg-path-invalid-a, kg-path-invalid-b/)).toBeInTheDocument();
    expect(screen.queryByTestId('kg-canvas-host')).not.toBeInTheDocument();
    expect(screen.queryByText('83', { selector: 'strong' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Reload' })).toBeEnabled();
  });

  test('falls back to read-only categories, nodes, and paths when Canvas is unsupported', async () => {
    canvasScenario.unsupported = true;
    render(<KGPage />);

    expect(await screen.findByTestId('kg-readonly-fallback')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Collections and Access' })).toBeInTheDocument();
    expect(screen.getByText('Concept:list')).toBeInTheDocument();
    expect(screen.getByText(overview.paths[0].path_id)).toBeInTheDocument();
    expect(screen.getByText('83', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('6', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('367', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('160', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText('197', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.queryByText(/网络可视化/)).not.toBeInTheDocument();
  });

  test('keeps an exact deep-link focus highlighted without auto-opening node details', async () => {
    reduceMotion = true;
    window.history.replaceState(
      {},
      '',
      '/om/kg?category=collections-and-access&focus=Concept%3Alist',
    );
    render(<KGPage />);

    await waitFor(() => expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS'));
    expect(screen.getByTestId('kg-canvas-host')).toHaveAttribute('data-selected-node-id', '');
    expect(canvasScenario.props.at(-1)?.focusNodeID).toBe('Concept:list');
  });

  test('restores the requested learning path from the URL', async () => {
    reduceMotion = true;
    const path = overview.paths.find((candidate) => candidate.category_ids.length > 0)!;
    window.history.replaceState(
      {},
      '',
      `/om/kg?category=${encodeURIComponent(path.category_ids[0])}&path=${encodeURIComponent(path.path_id)}`,
    );
    render(<KGPage />);

    await waitFor(() => expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL'));
    expect(screen.getByRole('combobox', { name: '学习路径' })).toHaveValue(path.path_id);
  });

  test('ignores a stale session snapshot when the path ID belongs to the overview', async () => {
    reduceMotion = true;
    const path = overview.paths.find((candidate) => candidate.focus.length > 0)!;
    const staleFocusID = overview.nodes.find((node) => !path.focus.includes(node.node_id))!.node_id;
    expect(writeTransientPathSnapshot(path.path_id, {
      upstream: [],
      current: [staleFocusID],
      downstream: [],
      edges: [],
      focus_node_ids: [staleFocusID],
    })).toBe(true);
    window.history.replaceState(
      {},
      '',
      `/om/kg?category=${encodeURIComponent(path.category_ids[0])}&path=${encodeURIComponent(path.path_id)}`,
    );

    render(<KGPage />);

    await waitFor(() => expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL'));
    expect(screen.getByRole('combobox', { name: '学习路径' })).toHaveValue(path.path_id);
    const props = canvasScenario.props.at(-1)! as Record<string, any>;
    expect(props.focusNodeID).toBe(path.focus_node_ids.find((nodeID) => path.focus.includes(nodeID)));
    expect(props.roleByNodeID.get(staleFocusID)).not.toBe('current');
  });

  test('restores a transient turn path snapshot through the real page controller', async () => {
    reduceMotion = true;
    const path = overview.paths.find((candidate) =>
      candidate.focus_node_ids.some((nodeID) => candidate.focus.includes(nodeID))
      && candidate.relations.length > 0,
    )!;
    const focusID = path.focus_node_ids.find((nodeID) => path.focus.includes(nodeID))!;
    const turnPathID = 'turn-transient-controller';
    const roleView = {
      upstream: path.upstream,
      current: path.focus,
      downstream: path.downstream,
      edges: path.relations.map((relation) => ({
        from: relation.from,
        to: relation.to,
        relation: relation.type,
      })),
      focus_node_ids: [focusID],
    };
    expect(writeTransientPathSnapshot(turnPathID, roleView)).toBe(true);
    const categoryID = overview.nodes.find((node) => node.node_id === focusID)!.category_id;
    window.history.replaceState(
      {},
      '',
      `/om/kg?category=${encodeURIComponent(categoryID)}&focus=${encodeURIComponent(focusID)}&path=${encodeURIComponent(turnPathID)}`,
    );

    render(<KGPage />);

    await waitFor(() => expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL'));
    expect(screen.getByTestId('kg-canvas-host')).toHaveAttribute('data-selected-node-id', '');
    const selector = screen.getByRole('combobox', { name: '学习路径' });
    expect(selector).toHaveValue(turnPathID);
    expect(screen.getByRole('option', { name: `${turnPathID} · 本回合路径` })).toBeInTheDocument();

    const props = canvasScenario.props.at(-1)! as Record<string, any>;
    expect(props.focusNodeID).toBe(focusID);
    expect(props.roleByNodeID.get(focusID)).toBe('current');
    expect([...props.pathNodeIDs].sort()).toEqual(
      [...new Set([
        ...roleView.upstream,
        ...roleView.current,
        ...roleView.downstream,
        ...roleView.edges.flatMap((edge) => [edge.from, edge.to]),
      ])].sort(),
    );
    const expectedEdgeIDs = overview.visual_edges
      .filter((edge) => roleView.edges.some((roleEdge) =>
        roleEdge.from === edge.source && roleEdge.to === edge.target,
      ))
      .map((edge) => edge.key)
      .sort();
    expect([...props.pathEdgeIDs].sort()).toEqual(expectedEdgeIDs);

    fireEvent.change(selector, { target: { value: '' } });
    const clearedProps = canvasScenario.props.at(-1)! as Record<string, any>;
    expect([...clearedProps.roleByNodeID]).toEqual([]);
    expect(clearedProps.focusNodeID).toBeUndefined();
    expect(clearedProps.pathNodeIDs).toBeUndefined();
    expect(clearedProps.pathEdgeIDs).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '返回知识世界' }));
    await waitFor(() => expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD'));
    const worldProps = canvasScenario.props.at(-1)! as Record<string, any>;
    expect([...worldProps.roleByNodeID]).toEqual([]);
    expect(worldProps.focusNodeID).toBeUndefined();
  });
});
