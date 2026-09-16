import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { KnowledgePathView } from '../../pages/SessionDemo/model';
import { readTransientPathSnapshot } from './transientPath';
import type { KGNode, KGOverview } from './types';

const canvasProps = vi.hoisted(() => [] as Array<Record<string, any>>);

vi.mock('./KGGraphCanvas', () => ({
  ROLE_STYLES: {
    normal: { size: 16 },
    upstream: { size: 18, fill: '#94A3B8', stroke: '#64748B', lineWidth: 2 },
    downstream: { size: 18, fill: '#4FA66E', stroke: '#2F7A4B', lineWidth: 2 },
    current: { size: 36, fill: '#F28C28', stroke: '#FFF7ED', lineWidth: 3 },
  },
  KGGraphCanvas: (props: Record<string, any>) => {
    canvasProps.push(props);
    return (
      <div
        aria-label={props['aria-label']}
        data-testid="mini-canvas"
        data-reduced-motion={String(props.reducedMotion)}
        style={props.style}
      >
        {props.graph.nodes.map((node: { id: string }) => (
          <button
            aria-label={`Select KG node ${node.id}`}
            data-testid={`canvas-node-${node.id}`}
            key={node.id}
            onClick={() => props.onNodeClick?.(node.id)}
            type="button"
          >
            {node.id}
          </button>
        ))}
        {(props.ports ?? []).map((port: { id: string }) => (
          <span data-testid={`canvas-port-${port.id}`} key={port.id}>{port.id}</span>
        ))}
      </div>
    );
  },
}));

import { KGPathMiniGraph } from './KGPathMiniGraph';

const category = {
  id: 'collections-and-access',
  label_zh: '集合与访问域',
  label_en: 'Collections and access',
  description_zh: '集合与访问知识区域。',
  description_en: 'Collections and access knowledge region.',
  color: '#606C38',
  surface_color: '#D4B895',
  anchor: { x: 0.5, y: 0.5 },
  order: 3,
  node_count: 4,
  internal_relation_count: 3,
  outgoing_relation_count: 0,
  incoming_relation_count: 0,
};

function node(node_id: string, label: string, category_id = category.id): KGNode {
  return {
    node_id,
    label,
    node_type: node_id.split(':')[0],
    origin: 'curated',
    aliases: [],
    source_ids: [],
    source_chunk_ids: [],
    source_urls: [],
    evidence_summary: `${label} evidence`,
    confidence: 1,
    category_id,
    unique_in_degree: 1,
    unique_out_degree: 1,
    unique_relation_degree: 2,
    path_ids: ['path-list-index'],
  };
}

const nodes = [
  node('Concept:list', '列表'),
  node('Concept:index', '索引'),
  node('ErrorType:IndexError', 'IndexError'),
  node('Method:append', 'append'),
  node('Concept:unrelated', '无关节点'),
];

function edge(key: string, source: string, target: string) {
  return {
    key,
    source,
    target,
    source_category_id: category.id,
    target_category_id: category.id,
    is_cross_category: false,
    relation_types: ['related_to'],
    relation_count: 1,
    provenance_count: 1,
    origins: ['curated'],
    source_ids: [],
    source_chunk_ids: [],
    source_urls: [],
    evidence_texts: [],
  };
}

const overview = {
  version: 'mini-test-v1',
  counts: {
    nodes: 5,
    categories: 1,
    curated_relation_triples: 4,
    unique_relation_triples: 4,
    visual_directed_pairs: 4,
    internal_relation_triples: 4,
    cross_category_relation_triples: 0,
    paths: 1,
    raw_edge_records: 4,
  },
  integrity: {
    valid: true,
    uncategorized_node_ids: [],
    duplicate_node_ids: [],
    dangling_relation_keys: [],
    duplicate_relation_keys: [],
    invalid_path_ids: [],
  },
  categories: [category],
  nodes,
  relations: [],
  visual_edges: [
    edge('Concept:list|Concept:index', 'Concept:list', 'Concept:index'),
    edge('Concept:index|ErrorType:IndexError', 'Concept:index', 'ErrorType:IndexError'),
    edge('Concept:list|Method:append', 'Concept:list', 'Method:append'),
    edge('Method:append|Concept:unrelated', 'Method:append', 'Concept:unrelated'),
  ],
  paths: [],
} satisfies KGOverview;

const pathView: KnowledgePathView = {
  path_id: 'path-list-index',
  upstream: [{ id: 'Concept:list', label: 'list', type: 'Concept' }],
  current: [{ id: 'Concept:index', label: 'index', type: 'Concept' }],
  downstream: [{ id: 'ErrorType:IndexError', label: 'IndexError', type: 'ErrorType' }],
  edges: [
    { from: 'Concept:list', to: 'Concept:index', relation: 'uses' },
    { from: 'Concept:index', to: 'ErrorType:IndexError', relation: 'causes' },
  ],
  focus_node_ids: ['Concept:index'],
};

beforeEach(() => {
  canvasProps.length = 0;
  sessionStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('KGPathMiniGraph', () => {
  test('renders every English role and control label', () => {
    render(<KGPathMiniGraph overview={overview} pathView={pathView} turnID="turn-copy" />);

    expect(screen.getByTestId('kg-role-upstream')).toHaveTextContent('Upstream');
    expect(screen.getByTestId('kg-role-current')).toHaveTextContent('Current');
    expect(screen.getByTestId('kg-role-downstream')).toHaveTextContent('Downstream');
    expect(screen.getByRole('link', { name: 'View in Knowledge World' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand knowledge path graph' })).toHaveTextContent('Expand');

    fireEvent.click(screen.getByRole('button', { name: 'Expand knowledge path graph' }));
    expect(screen.getByRole('button', { name: 'Close knowledge path graph' })).toHaveTextContent('Close');

    fireEvent.click(screen.getByRole('button', { name: 'Select KG node Concept:index' }));
    expect(screen.getByRole('button', { name: 'Ask about this node' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close node details' })).toHaveTextContent('Close');

    const obsoleteChineseSources = [
      '上游',
      '当前',
      '下游',
      '在知识世界中查看',
      '展开',
      '关闭',
      '展开知识路径图',
      '关闭知识路径图',
      '围绕此节点继续提问',
      '关闭节点详情',
      '本回合未进入知识图谱路径。',
      '正在加载知识路径图……',
      '知识路径元数据加载失败。',
      '本回合的知识路径数据无效。',
    ];
    for (const source of obsoleteChineseSources) {
      expect(screen.queryByText(source)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(source)).not.toBeInTheDocument();
    }
  });

  test.each([
    {
      state: 'empty',
      expected: 'No knowledge graph path for this turn.',
      renderState: () => render(<KGPathMiniGraph overview={overview} turnID="turn-empty" />),
    },
    {
      state: 'loading',
      expected: 'Loading knowledge path graph…',
      renderState: () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
        return render(<KGPathMiniGraph pathView={pathView} turnID="turn-loading" />);
      },
    },
    {
      state: 'metadata failure',
      expected: 'Failed to load knowledge path metadata.',
      renderState: () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
        return render(<KGPathMiniGraph pathView={pathView} turnID="turn-failure" />);
      },
    },
    {
      state: 'invalid path',
      expected: 'Invalid knowledge path data for this turn.',
      renderState: () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        return render(
          <KGPathMiniGraph
            overview={overview}
            pathView={{ current: [{ id: 'Concept:missing', label: 'missing' }] }}
            turnID="turn-invalid-copy"
          />,
        );
      },
    },
  ])('renders exact English copy for $state state', async ({ expected, renderState }) => {
    renderState();
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  test('renders the exact inline size, roles, scoped subgraph, path overlay, and deep link', () => {
    render(<KGPathMiniGraph overview={overview} pathView={pathView} turnID="turn-7" />);

    expect(screen.getByLabelText('Knowledge path force graph')).toHaveStyle({
      width: '100%',
      height: '360px',
    });
    expect(screen.getByTestId('kg-role-upstream')).toHaveAttribute('data-fill', '#94A3B8');
    expect(screen.getByTestId('kg-role-current')).toHaveAttribute('data-fill', '#F28C28');
    expect(screen.getByTestId('kg-role-downstream')).toHaveAttribute('data-fill', '#4FA66E');
    expect(screen.getByRole('link', { name: 'View in Knowledge World' })).toHaveAttribute(
      'href',
      '/knowledge-world?category=collections-and-access&focus=Concept%3Aindex&path=path-list-index',
    );

    const props = canvasProps.at(-1)!;
    expect(props.graph.nodes.map((item: { id: string }) => item.id).sort()).toEqual([
      'Concept:index',
      'Concept:list',
      'ErrorType:IndexError',
      'Method:append',
    ]);
    expect(props.graph.nodes.map((item: { id: string }) => item.id)).not.toContain('Concept:unrelated');
    expect(props.ports).toEqual([]);
    expect([...props.pathNodeIDs].sort()).toEqual([
      'Concept:index',
      'Concept:list',
      'ErrorType:IndexError',
    ]);
    expect([...props.pathEdgeIDs].sort()).toEqual([
      'Concept:index|ErrorType:IndexError',
      'Concept:list|Concept:index',
    ]);
    expect(props.colorEdgesBySourceRole).toBe(true);
    expect(props.roleByNodeID.get('Concept:index')).toBe('current');
    expect(props.focusNodeID).toBe('Concept:index');
  });

  test('expands the same graph to the exact height and closes by button or Escape', () => {
    render(<KGPathMiniGraph overview={overview} pathView={pathView} turnID="turn-7" />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand knowledge path graph' }));
    expect(screen.getByLabelText('Knowledge path force graph')).toHaveStyle({
      height: 'calc(100vh - 96px)',
    });
    expect(canvasProps.at(-1)!.colorEdgesBySourceRole).toBe(true);
    expect(screen.getByRole('button', { name: 'Close knowledge path graph' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByLabelText('Knowledge path force graph')).toHaveStyle({ height: '360px' });

    fireEvent.click(screen.getByRole('button', { name: 'Expand knowledge path graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close knowledge path graph' }));
    expect(screen.getByLabelText('Knowledge path force graph')).toHaveStyle({ height: '360px' });
  });

  test('opens node details on selection and requests focus only from the explicit action', () => {
    const onRequestFocus = vi.fn();
    render(
      <KGPathMiniGraph
        onRequestFocus={onRequestFocus}
        overview={overview}
        pathView={pathView}
        turnID="turn-7"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select KG node Concept:index' }));

    expect(screen.getByRole('region', { name: 'Selected knowledge node' })).toHaveTextContent('索引');
    expect(screen.getByRole('region', { name: 'Selected knowledge node' })).toHaveTextContent('Concept:index');
    expect(canvasProps.at(-1)!.selectedNodeID).toBe('Concept:index');
    expect(onRequestFocus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ask about this node' }));

    expect(onRequestFocus).toHaveBeenCalledTimes(1);
    expect(onRequestFocus).toHaveBeenCalledWith({
      id: 'Concept:index',
      label: '索引',
      type: 'Concept',
    });
  });

  test('preserves graph presentation identity when Ask about this node rerenders an equivalent path', () => {
    function Harness() {
      const [requestedFocus, setRequestedFocus] = useState<string>();
      const equivalentPathView = structuredClone(pathView);
      return (
        <>
          <KGPathMiniGraph
            onRequestFocus={(node) => setRequestedFocus(node.id)}
            overview={overview}
            pathView={equivalentPathView}
            turnID="turn-stable-ask"
          />
          {requestedFocus ? <span>Pending focus: {requestedFocus}</span> : null}
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Select KG node Concept:index' }));
    const beforeAsk = canvasProps.at(-1)!;

    fireEvent.click(screen.getByRole('button', { name: 'Ask about this node' }));
    const afterAsk = canvasProps.at(-1)!;

    expect(screen.getByText('Pending focus: Concept:index')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Selected knowledge node' })).toHaveTextContent('索引');
    expect(afterAsk.selectedNodeID).toBe('Concept:index');
    expect(afterAsk.graph).toBe(beforeAsk.graph);
    expect(afterAsk.ports).toBe(beforeAsk.ports);
    expect(afterAsk.roleByNodeID).toBe(beforeAsk.roleByNodeID);
    expect(afterAsk.pathNodeIDs).toBe(beforeAsk.pathNodeIDs);
    expect(afterAsk.pathEdgeIDs).toBe(beforeAsk.pathEdgeIDs);
  });

  test('reprojects the graph when the semantic knowledge path changes', () => {
    const { rerender } = render(
      <KGPathMiniGraph overview={overview} pathView={pathView} turnID="turn-semantic-change" />,
    );
    const beforeChange = canvasProps.at(-1)!;
    const changedPathView = structuredClone(pathView);
    changedPathView.edges = changedPathView.edges?.map((item, index) => (
      index === 0 ? { ...item, relation: 'extends_to' } : item
    ));

    rerender(
      <KGPathMiniGraph
        overview={overview}
        pathView={changedPathView}
        turnID="turn-semantic-change"
      />,
    );
    const afterChange = canvasProps.at(-1)!;

    expect(afterChange.graph).not.toBe(beforeChange.graph);
    expect(afterChange.roleByNodeID).not.toBe(beforeChange.roleByNodeID);
    expect(afterChange.pathNodeIDs).not.toBe(beforeChange.pathNodeIDs);
    expect(afterChange.pathEdgeIDs).not.toBe(beforeChange.pathEdgeIDs);
  });

  test('keeps only the first current focus animated and uses static reduced-motion rendering', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList);
    const twoFocusView = {
      ...pathView,
      current: [
        { id: 'Concept:index', label: 'index', type: 'Concept' },
        { id: 'Concept:list', label: 'list', type: 'Concept' },
      ],
      focus_node_ids: ['Concept:index', 'Concept:list'],
    };

    render(<KGPathMiniGraph overview={overview} pathView={twoFocusView} turnID="turn-7" />);
    const props = canvasProps.at(-1)!;
    expect(props.focusNodeID).toBe('Concept:index');
    expect(props.reducedMotion).toBe(true);
  });

  test('uses current over upstream over downstream when one node has multiple roles', () => {
    const overlap = {
      ...pathView,
      upstream: [{ id: 'Concept:index', label: 'index', type: 'Concept' }],
      current: [{ id: 'Concept:index', label: 'index', type: 'Concept' }],
      downstream: [{ id: 'Concept:index', label: 'index', type: 'Concept' }],
      focus_node_ids: ['Concept:index'],
    };
    render(<KGPathMiniGraph overview={overview} pathView={overlap} turnID="turn-7" />);
    expect(canvasProps.at(-1)!.roleByNodeID.get('Concept:index')).toBe('current');
  });

  test('falls back to current[0] as the only breathing node when focus IDs are missing or empty', () => {
    const { rerender } = render(
      <KGPathMiniGraph
        overview={overview}
        pathView={{ ...pathView, focus_node_ids: undefined }}
        turnID="turn-missing-focus"
      />,
    );
    expect(canvasProps.at(-1)!.focusNodeID).toBe('Concept:index');

    rerender(
      <KGPathMiniGraph
        overview={overview}
        pathView={{ ...pathView, focus_node_ids: [] }}
        turnID="turn-empty-focus"
      />,
    );
    expect(canvasProps.at(-1)!.focusNodeID).toBe('Concept:index');
  });

  test('skips invalid and non-current focus IDs before falling back to the first valid current node', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <KGPathMiniGraph
        overview={overview}
        pathView={{
          ...pathView,
          focus_node_ids: ['Concept:missing', 'Concept:list', 'Concept:index'],
        }}
        turnID="turn-mixed-focus"
      />,
    );

    const props = canvasProps.at(-1)!;
    expect(props.focusNodeID).toBe('Concept:index');
    expect(props.activeCategoryID).toBe('collections-and-access');
    expect(screen.getByRole('link', { name: 'View in Knowledge World' })).toHaveAttribute(
      'href',
      '/knowledge-world?category=collections-and-access&focus=Concept%3Aindex&path=path-list-index',
    );
  });

  test('persists a filtered transient role snapshot before the turn fallback link can be clicked', () => {
    const transientView = { ...pathView, path_id: undefined };
    render(<KGPathMiniGraph overview={overview} pathView={transientView} turnID="turn / transient" />);

    const raw = sessionStorage.getItem('rea:kg-transient-path:v1:turn%20%2F%20transient');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      version: 1,
      path_id: 'turn / transient',
      role_view: {
        upstream: ['Concept:list'],
        current: ['Concept:index'],
        downstream: ['ErrorType:IndexError'],
        edges: [
          { from: 'Concept:list', to: 'Concept:index', relation: 'uses' },
          { from: 'Concept:index', to: 'ErrorType:IndexError', relation: 'causes' },
        ],
        focus_node_ids: ['Concept:index'],
      },
    });
    expect(screen.getByRole('link', { name: 'View in Knowledge World' })).toHaveAttribute(
      'href',
      '/knowledge-world?category=collections-and-access&focus=Concept%3Aindex&path=turn+%2F+transient',
    );
  });

  test('keeps a canonical reverse traversal orange through mini-graph snapshot and deep link', () => {
    const reverseView: KnowledgePathView = {
      upstream: [{ id: 'Concept:index', label: 'index', type: 'Concept' }],
      current: [{ id: 'Concept:list', label: 'list', type: 'Concept' }],
      downstream: [],
      edges: [{
        from: 'Concept:list',
        to: 'Concept:index',
        relation: 'related_to',
        traversal: 'reverse',
        segment: 'upstream_to_current',
      }],
      focus_node_ids: ['Concept:list'],
    };

    render(<KGPathMiniGraph overview={overview} pathView={reverseView} turnID="turn-reverse" />);

    expect([...canvasProps.at(-1)!.pathEdgeIDs]).toEqual(['Concept:list|Concept:index']);
    expect(readTransientPathSnapshot('turn-reverse', overview)?.edges).toEqual(reverseView.edges);
    expect(screen.getByRole('link', { name: 'View in Knowledge World' })).toHaveAttribute(
      'href',
      '/knowledge-world?category=collections-and-access&focus=Concept%3Alist&path=turn-reverse',
    );
  });

  test('does not render a canvas for onboarding, off-topic, or an absent path', () => {
    const { rerender } = render(<KGPathMiniGraph overview={overview} turnID="onboarding-turn" />);
    expect(screen.getByText('No knowledge graph path for this turn.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Knowledge path force graph')).not.toBeInTheDocument();

    rerender(<KGPathMiniGraph overview={overview} pathView={{}} turnID="off-topic-turn" />);
    expect(screen.getByText('No knowledge graph path for this turn.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Knowledge path force graph')).not.toBeInTheDocument();
  });

  test('logs and ignores unknown nodes while retaining legal path nodes', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mixed = {
      ...pathView,
      downstream: [
        ...(pathView.downstream ?? []),
        { id: 'Concept:missing', label: 'missing', type: 'Concept' },
      ],
    };
    render(<KGPathMiniGraph overview={overview} pathView={mixed} turnID="turn-7" />);

    expect(error).toHaveBeenCalledWith('Knowledge path references unknown KG node: Concept:missing');
    expect(screen.getByLabelText('Knowledge path force graph')).toBeInTheDocument();
    expect(canvasProps.at(-1)!.graph.nodes.map((item: { id: string }) => item.id)).not.toContain('Concept:missing');
  });

  test('shows the exact invalid copy when every referenced path node is unknown', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <KGPathMiniGraph
        overview={overview}
        pathView={{ current: [{ id: 'Concept:missing', label: 'missing' }] }}
        turnID="turn-invalid"
      />,
    );
    expect(screen.getByText('Invalid knowledge path data for this turn.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Knowledge path force graph')).not.toBeInTheDocument();
  });

  test('fetches KG metadata once for multiple mini graphs and isolates loading failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => overview });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <>
        <KGPathMiniGraph pathView={pathView} turnID="turn-7" />
        <KGPathMiniGraph pathView={pathView} turnID="turn-8" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByLabelText('Knowledge path force graph')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/kg/overview');
    vi.unstubAllGlobals();
  });

  test('evicts a failed single-flight request so the same fetch implementation can retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => overview });
    vi.stubGlobal('fetch', fetchMock);

    const first = render(<KGPathMiniGraph pathView={pathView} turnID="turn-retry" />);
    expect(await screen.findByText('Failed to load knowledge path metadata.')).toBeInTheDocument();
    first.unmount();

    render(<KGPathMiniGraph pathView={pathView} turnID="turn-retry" />);
    expect(await screen.findByLabelText('Knowledge path force graph')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
