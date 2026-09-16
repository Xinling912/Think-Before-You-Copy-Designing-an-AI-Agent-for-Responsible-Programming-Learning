import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { KGOverview } from './types';
const kgWorldCSS = readFileSync('src/components/KGWorld/kg-world.css', 'utf8');

const canvasCalls = vi.hoisted(() => ({
  fitView: vi.fn().mockResolvedValue(undefined),
  resetLayout: vi.fn().mockResolvedValue(undefined),
  focusCategory: vi.fn().mockResolvedValue(undefined),
  focusNode: vi.fn().mockResolvedValue(undefined),
}));
const canvasProps = vi.hoisted(() => [] as Array<Record<string, any>>);
const canvasPassiveWork = vi.hoisted(() => ({ enteringDetailMs: 0 }));

vi.mock('./KGGraphCanvas', () => ({
  KGGraphCanvas: forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => canvasCalls);
    useEffect(() => {
      if (props.viewState === 'ENTERING_DETAIL' && canvasPassiveWork.enteringDetailMs > 0) {
        vi.advanceTimersByTime(canvasPassiveWork.enteringDetailMs);
      }
    }, [props.viewState]);
    canvasProps.push(props);
    return (
      <div data-testid="canvas" data-view-state={props.viewState} tabIndex={0}>
        {(props.graph as { nodes: Array<{ id: string }> }).nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            onClick={() => (props.onNodeClick as (nodeID: string) => void)?.(node.id)}
          >
            {`画布节点 ${node.id}`}
          </button>
        ))}
        {((props.graph as { edges?: Array<{ id: string }> }).edges ?? []).map((edge) => (
          <button
            key={edge.id}
            type="button"
            onClick={() => (props.onEdgeClick as (edgeID: string) => void)?.(edge.id)}
          >
            {`画布关系 ${edge.id}`}
          </button>
        ))}
        {((props.ports as Array<{ id: string; label: string }> | undefined) ?? []).map((port) => (
          <button
            key={port.id}
            type="button"
            onClick={() => (props.onPortClick as (portID: string) => void)?.(port.id)}
          >
            {port.label}
          </button>
        ))}
        <button type="button" onClick={() => (props.onEscape as () => void)?.()}>
          画布 Escape
        </button>
      </div>
    );
  }),
}));

import { KGWorldMap } from './KGWorldMap';

const categorySeeds = [
  ['program-foundations', '程序基础域', 'Program Foundations'],
  ['types-and-values', '类型与值域', 'Types and Values'],
  ['collections-and-access', '集合与访问域', 'Collections and Access'],
  ['control-flow', '控制流域', 'Control Flow'],
  ['functions-and-modules', '函数与模块域', 'Functions and Modules'],
  ['errors-files-and-classes', '调试与工程域', 'Errors, Files and Classes'],
] as const;

const overview: KGOverview = {
  version: 'test-world-v1',
  counts: {
    nodes: 2,
    categories: 6,
    curated_relation_triples: 0,
    unique_relation_triples: 2,
    visual_directed_pairs: 1,
    internal_relation_triples: 2,
    cross_category_relation_triples: 0,
    paths: 0,
    raw_edge_records: 0,
  },
  integrity: {
    valid: true,
    uncategorized_node_ids: [],
    duplicate_node_ids: [],
    dangling_relation_keys: [],
    duplicate_relation_keys: [],
    invalid_path_ids: [],
  },
  categories: categorySeeds.map(([id, label_zh, label_en], order) => ({
    id,
    label_zh,
    label_en,
    description_zh: `${label_zh}的真实 API 简介`,
    description_en: `${label_en} API description`,
    color: ['#8B5E3C', '#B7794B', '#657A52', '#A45F45', '#6C7563', '#7B6551'][order],
    surface_color: ['#EAD9C7', '#F0D5B5', '#D9E1C7', '#E8CDBF', '#DCE0D2', '#DED3C8'][order],
    anchor: { x: 0.1 + order * 0.15, y: order % 2 ? 0.68 : 0.3 },
    order: order + 1,
    node_count: order === 2 ? 2 : 0,
    internal_relation_count: order === 2 ? 74 : 0,
    outgoing_relation_count: order === 2 ? 11 : 0,
    incoming_relation_count: order === 2 ? 10 : 0,
  })),
  nodes: [
    {
      node_id: 'Concept:list',
      label: '列表',
      node_type: 'Concept',
      origin: 'curated',
      aliases: ['list'],
      source_ids: [],
      source_chunk_ids: [],
      source_urls: [],
      evidence_summary: '列表是有序可变集合。',
      confidence: 1,
      category_id: 'collections-and-access',
      unique_in_degree: 0,
      unique_out_degree: 1,
      unique_relation_degree: 1,
      path_ids: [],
    },
    {
      node_id: 'Concept:index',
      label: '索引',
      node_type: 'Concept',
      origin: 'curated',
      aliases: ['index'],
      source_ids: [],
      source_chunk_ids: [],
      source_urls: [],
      evidence_summary: '索引用于按位置访问序列。',
      confidence: 1,
      category_id: 'collections-and-access',
      unique_in_degree: 1,
      unique_out_degree: 0,
      unique_relation_degree: 1,
      path_ids: [],
    },
  ],
  relations: [
    {
      key: 'Concept:list|contains|Concept:index',
      source: 'Concept:list',
      type: 'contains',
      target: 'Concept:index',
      source_category_id: 'collections-and-access',
      target_category_id: 'collections-and-access',
      is_cross_category: false,
      origins: ['curated'],
      source_ids: [],
      source_chunk_ids: [],
      source_urls: [],
      evidence_texts: [],
    },
    {
      key: 'Concept:index|depends_on|Concept:list',
      source: 'Concept:index',
      type: 'depends_on',
      target: 'Concept:list',
      source_category_id: 'collections-and-access',
      target_category_id: 'collections-and-access',
      is_cross_category: false,
      origins: ['curated'],
      source_ids: [],
      source_chunk_ids: [],
      source_urls: [],
      evidence_texts: [],
    },
  ],
  visual_edges: [{
    key: 'Concept:list|Concept:index',
    source: 'Concept:list',
    target: 'Concept:index',
    source_category_id: 'collections-and-access',
    target_category_id: 'collections-and-access',
    is_cross_category: false,
    relation_types: ['contains'],
    relation_count: 1,
    provenance_count: 1,
    origins: ['curated'],
    source_ids: [],
    source_chunk_ids: [],
    source_urls: [],
    evidence_texts: [],
  }],
  paths: [],
};

const overview83: KGOverview = {
  ...overview,
  counts: { ...overview.counts, nodes: 83 },
  nodes: [
    ...overview.nodes,
    ...Array.from({ length: 81 }, (_, index) => ({
      ...overview.nodes[0],
      node_id: `Concept:other-${index}`,
      label: `其他节点 ${index}`,
      aliases: [],
      category_id: 'program-foundations',
    })),
  ],
};

const detailOverview: KGOverview = {
  ...overview,
  counts: {
    ...overview.counts,
    nodes: 4,
    unique_relation_triples: 6,
    visual_directed_pairs: 3,
    internal_relation_triples: 4,
    cross_category_relation_triples: 2,
    paths: 2,
  },
  categories: overview.categories.map((category) => ({
    ...category,
    node_count: category.id === 'collections-and-access'
      ? 3
      : category.id === 'program-foundations'
        ? 1
        : 0,
    internal_relation_count: category.id === 'collections-and-access' ? 4 : 0,
    outgoing_relation_count: category.id === 'collections-and-access'
      || category.id === 'program-foundations'
      ? 1
      : 0,
    incoming_relation_count: category.id === 'collections-and-access'
      || category.id === 'program-foundations'
      ? 1
      : 0,
  })),
  nodes: [
    { ...overview.nodes[0], path_ids: ['path-b', 'path-a'], source_urls: ['https://example.test/list'] },
    { ...overview.nodes[1], path_ids: ['path-b', 'path-a'] },
    {
      ...overview.nodes[1],
      node_id: 'Concept:slice',
      label: '切片',
      aliases: ['slice'],
      unique_in_degree: 1,
      unique_out_degree: 0,
      path_ids: ['path-b'],
    },
    {
      ...overview.nodes[0],
      node_id: 'Concept:range',
      label: '范围',
      aliases: ['range'],
      category_id: 'program-foundations',
      unique_in_degree: 1,
      unique_out_degree: 1,
      path_ids: [],
    },
  ],
  relations: [
    {
      ...overview.relations[0],
      key: 'Concept:list|zeta|Concept:index',
      type: 'zeta',
      origins: ['merged'],
    },
    {
      ...overview.relations[0],
      key: 'Concept:list|alpha|Concept:index',
      type: 'alpha',
      origins: ['generated'],
    },
    {
      ...overview.relations[0],
      key: 'Concept:list|beta|Concept:index',
      type: 'beta',
      origins: ['curated'],
    },
    {
      ...overview.relations[0],
      key: 'Concept:index|leads_to|Concept:slice',
      source: 'Concept:index',
      type: 'leads_to',
      target: 'Concept:slice',
    },
    {
      ...overview.relations[0],
      key: 'Concept:list|related_to|Concept:range',
      source: 'Concept:list',
      type: 'related_to',
      target: 'Concept:range',
      target_category_id: 'program-foundations',
      is_cross_category: true,
    },
    {
      ...overview.relations[0],
      key: 'Concept:range|supports|Concept:index',
      source: 'Concept:range',
      type: 'supports',
      target: 'Concept:index',
      source_category_id: 'program-foundations',
      is_cross_category: true,
      origins: ['generated'],
    },
  ],
  visual_edges: [
    {
      ...overview.visual_edges[0],
      relation_types: ['zeta', 'alpha', 'beta'],
      relation_count: 3,
      origins: ['merged', 'generated', 'curated'],
      provenance_count: 3,
    },
    {
      ...overview.visual_edges[0],
      key: 'Concept:index|Concept:slice',
      source: 'Concept:index',
      target: 'Concept:slice',
      relation_types: ['leads_to'],
    },
    {
      ...overview.visual_edges[0],
      key: 'Concept:list|Concept:range',
      source: 'Concept:list',
      target: 'Concept:range',
      target_category_id: 'program-foundations',
      is_cross_category: true,
      relation_types: ['related_to'],
    },
  ],
  paths: [
    {
      path_id: 'path-b',
      label: '列表到切片',
      topic: '序列访问',
      path: ['Concept:list', 'Concept:index', 'Concept:slice'],
      upstream: ['Concept:list', 'Concept:index'],
      focus: ['Concept:index'],
      downstream: ['Concept:index', 'Concept:slice'],
      category_ids: ['collections-and-access'],
      crosses_category_boundary: false,
      focus_node_ids: ['Concept:index', 'Concept:list'],
      hop_count: 2,
      relations: [
        { from: 'Concept:list', to: 'Concept:index', type: 'alpha', traversal: 'forward' },
        { from: 'Concept:index', to: 'Concept:slice', type: '', traversal: 'forward' },
      ],
      evidence_summary: 'API 路径证据',
      source_url: 'https://example.test/path-b',
      source_urls: ['https://example.test/path-b'],
      source_id: 'source-b',
      evidence_chunk_ids: ['chunk-b'],
    },
    {
      path_id: 'path-a',
      label: '列表到索引',
      topic: '序列访问',
      path: ['Concept:list', 'Concept:index'],
      upstream: ['Concept:list'],
      focus: ['Concept:index'],
      downstream: [],
      category_ids: ['collections-and-access'],
      crosses_category_boundary: false,
      focus_node_ids: ['Concept:index'],
      hop_count: 1,
      relations: [{ from: 'Concept:list', to: 'Concept:index', type: 'alpha', traversal: 'forward' }],
      evidence_summary: 'API 路径证据 A',
      source_url: 'https://example.test/path-a',
      source_urls: ['https://example.test/path-a'],
      source_id: 'source-a',
      evidence_chunk_ids: ['chunk-a'],
    },
  ],
};

describe('KGWorldMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    canvasProps.length = 0;
    canvasPassiveWork.enteringDetailMs = 0;
    Object.values(canvasCalls).forEach((mock) => mock.mockClear());
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  const advance = (duration: number) => act(() => vi.advanceTimersByTime(duration));

  test('starts in the stable world state', () => {
    render(<KGWorldMap overview={overview} />);

    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(screen.queryByRole('complementary', { name: '节点详情' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '区域简介' })).not.toBeInTheDocument();
    const legend = screen.getByRole('complementary', { name: 'Knowledge graph legend' });
    const categoryButtons = within(legend).getAllByRole('button');
    expect(categoryButtons).toHaveLength(6);
    expect(within(legend).getByRole('button', { name: '集合与访问域' })).toHaveTextContent(
      'Collections and Access2 nodes',
    );
    expect(screen.queryByRole('group', { name: '知识分类' })).not.toBeInTheDocument();
  });

  test('renders an English-only student presentation without changing the complete world', () => {
    const { container } = render(<KGWorldMap overview={overview} language="en" />);

    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(screen.getByRole('button', { name: 'Collections and Access' })).toBeInTheDocument();
    expect(canvasProps.at(-1)?.['aria-label']).toBe('Knowledge World canvas');

    fireEvent.click(screen.getByRole('button', { name: 'Collections and Access' }));
    advance(800);

    const categoryPanel = screen.getByRole('complementary', { name: 'Category Overview' });
    expect(categoryPanel).toHaveTextContent('Collections and Access API description');
    expect(within(categoryPanel).getByRole('button', { name: 'View Category Details' })).toBeInTheDocument();
    expect(within(categoryPanel).getByRole('button', { name: 'Back to Knowledge World' })).toBeInTheDocument();

    const studentSurface = container.cloneNode(true) as HTMLElement;
    studentSurface.querySelector('[data-testid="canvas"]')?.remove();
    const accessibleNames = [...studentSurface.querySelectorAll('[aria-label]')]
      .map((element) => element.getAttribute('aria-label') ?? '')
      .join(' ');
    expect(studentSurface.textContent).not.toMatch(/[\u3400-\u9fff]/u);
    expect(accessibleNames).not.toMatch(/[\u3400-\u9fff]/u);
  });

  test('keeps WORLD explanation-free after focus and detail round trips through all six categories', () => {
    render(<KGWorldMap overview={overview} />);

    for (const [, categoryLabel] of categorySeeds) {
      expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
      expect(screen.queryByRole('complementary', { name: '节点详情' })).not.toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: '区域简介' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: categoryLabel }));
      advance(800);
      expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
      expect(screen.getByRole('complementary', { name: '区域简介' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
      advance(500);
      expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL');
      expect(screen.queryByRole('complementary', { name: 'Knowledge graph legend' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '分类' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '分类' }));
      advance(400);
      expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
      fireEvent.click(screen.getByRole('button', { name: '返回知识世界' }));
      advance(800);

      expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
      expect(screen.queryByRole('complementary', { name: '节点详情' })).not.toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: '区域简介' })).not.toBeInTheDocument();
    }
  });

  test('keeps a world node click in WORLD and reserves category/detail transitions for the legend and panel', () => {
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(canvasCalls.focusCategory).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: '节点详情' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    advance(800);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');

    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
  });

  test('uses the exact 800ms and 500ms category and detail transitions', () => {
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    expect(canvasCalls.focusCategory).toHaveBeenCalledWith('collections-and-access', 400);
    expect(screen.queryByRole('complementary', { name: '区域简介' })).not.toBeInTheDocument();

    advance(519);
    expect(screen.queryByRole('complementary', { name: '区域简介' })).not.toBeInTheDocument();
    advance(1);
    const enteringPanel = screen.getByRole('complementary', { name: '区域简介' });
    expect(enteringPanel).toHaveAttribute('data-transitioning', 'true');
    expect(within(enteringPanel).getByRole('button', { name: '查看区域详情' })).toBeDisabled();
    advance(279);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');

    const panel = screen.getByRole('complementary', { name: '区域简介' });
    expect(panel).toHaveAttribute('data-transitioning', 'false');
    expect(panel).toHaveTextContent('集合与访问域的真实 API 简介');
    expect(panel).toHaveTextContent('2');
    expect(panel).toHaveTextContent('74');
    expect(panel).toHaveTextContent('11');
    expect(panel).toHaveTextContent('10');

    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
    expect(screen.queryByRole('complementary', { name: '区域简介' })).not.toBeInTheDocument();
    advance(499);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL');
  });

  test('starts the 500ms detail deadline at the user action before child passive work', () => {
    render(<KGWorldMap overview={overview} />);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    advance(800);
    canvasPassiveWork.enteringDetailMs = 150;

    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
    advance(349);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
    advance(1);

    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL');
    expect(canvasCalls.fitView).toHaveBeenLastCalledWith(64, 350, true);
  });

  test('locks new transitions while a camera animation is active', () => {
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    fireEvent.click(screen.getByRole('button', { name: '控制流域' }));

    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    expect(canvasCalls.focusCategory).toHaveBeenCalledTimes(1);
    expect(canvasCalls.focusCategory).toHaveBeenLastCalledWith('collections-and-access', 400);
    advance(800);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
    expect(screen.getByRole('heading', { name: '集合与访问域' })).toBeInTheDocument();
  });

  test('returns detail to focus in 400ms and focus to world in 800ms', () => {
    render(<KGWorldMap overview={overview} />);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    advance(800);
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    advance(500);

    fireEvent.click(screen.getByRole('button', { name: '分类' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_CATEGORY');
    expect(canvasCalls.focusCategory).toHaveBeenLastCalledWith('collections-and-access', 400);
    advance(399);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_CATEGORY');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');

    fireEvent.click(screen.getByRole('button', { name: '返回知识世界' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_WORLD');
    expect(canvasCalls.fitView).toHaveBeenLastCalledWith(64, 800);
    advance(799);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_WORLD');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
  });

  test('returning a visible node drawer to category focus clears selection so one Escape returns world', () => {
    render(<KGWorldMap overview={overview} />);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    advance(800);
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    advance(500);
    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    expect(screen.getByRole('complementary', { name: '节点详情' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '分类' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_CATEGORY');
    expect(screen.queryByRole('complementary', { name: '节点详情' })).not.toBeInTheDocument();
    advance(400);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');

    fireEvent.click(screen.getByRole('button', { name: '画布 Escape' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_WORLD');
    expect(canvasCalls.fitView).toHaveBeenLastCalledWith(64, 800);
  });

  test('returns detail directly to world in the specified 900ms', () => {
    render(<KGWorldMap overview={overview} />);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    advance(800);
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    advance(500);

    fireEvent.click(screen.getByRole('button', { name: '返回知识世界' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_WORLD');
    expect(canvasCalls.fitView).toHaveBeenLastCalledWith(64, 900);
    advance(899);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_WORLD');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
  });

  test('disables every toolbar command and keeps the original transition deadline', () => {
    render(<KGWorldMap overview={overview} />);
    const input = screen.getByRole('searchbox', { name: 'Search knowledge nodes' });

    fireEvent.change(input, { target: { value: 'list' } });
    advance(100);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');

    expect(input).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Relation type' })).toBeDisabled();
    for (const name of ['Reset filters', 'Fit view', 'Reset layout', 'Hide legend', '控制流域']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }

    advance(80);
    expect(canvasProps.at(-1)?.selectedNodeID).toBeUndefined();
    advance(719);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
  });

  test('keeps all 83 world nodes through the first 400ms fade, then focuses 12px target nodes', () => {
    render(<KGWorldMap overview={overview83} />);
    expect(canvasProps.at(-1)?.graph.nodes).toHaveLength(83);

    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    expect(canvasProps.at(-1)?.viewState).toBe('ENTERING_CATEGORY');
    expect(canvasProps.at(-1)?.graph.nodes).toHaveLength(83);
    expect(canvasProps.at(-1)?.graph.nodes.find(
      (node: { id: string }) => node.id === 'Concept:other-0',
    )?.style.opacity).toBe(0);
    expect(canvasProps.at(-1)?.graph.nodes.find(
      (node: { id: string }) => node.id === 'Concept:list',
    )?.style.opacity).not.toBe(0);

    advance(399);
    expect(canvasProps.at(-1)?.graph.nodes).toHaveLength(83);
    advance(1);
    expect(canvasProps.at(-1)?.viewState).toBe('ENTERING_CATEGORY');
    expect(canvasProps.at(-1)?.graph.nodes).toHaveLength(2);
    expect(canvasProps.at(-1)?.ports).toBeUndefined();
    expect(canvasCalls.focusCategory).toHaveBeenLastCalledWith('collections-and-access', 400);
    advance(400);
    expect(canvasProps.at(-1)?.viewState).toBe('CATEGORY_FOCUS');
    expect(canvasProps.at(-1)?.graph.nodes).toHaveLength(2);
    expect(canvasProps.at(-1)?.graph.nodes.every(
      (node: { style: { size: number } }) => node.style.size === 12,
    )).toBe(true);
    expect(screen.queryByRole('group', { name: '知识分类' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    expect(canvasProps.at(-1)?.graph.nodes.every(
      (node: { style: { size: number } }) => node.style.size === 16,
    )).toBe(true);
    expect(canvasProps.at(-1)?.ports).toEqual([]);
  });

  test('uses the legend and primary panel action as the only interactive route to detail', () => {
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    expect(canvasCalls.focusCategory).toHaveBeenCalledWith('collections-and-access', 400);
    advance(800);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
    expect(canvasCalls.fitView).toHaveBeenCalledWith(64, 500, true);
    expect(canvasCalls.focusNode).not.toHaveBeenCalled();
    advance(499);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL');
    expect(canvasProps.at(-1)?.selectedNodeID).toBeUndefined();
  });

  test('opens a world node summary immediately without changing levels', () => {
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(screen.getByRole('complementary', { name: '节点详情' })).toBeInTheDocument();
  });

  test('opens a category-focus node summary without skipping the introduction level', () => {
    render(<KGWorldMap overview={overview} />);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    advance(800);

    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
    expect(screen.getByRole('complementary', { name: '节点详情' })).toBeInTheDocument();
  });

  test('renders six API category legend buttons and all world toolbar commands', () => {
    render(<KGWorldMap overview={overview} />);

    const categoryGroup = screen.getByRole('complementary', { name: 'Knowledge graph legend' });
    expect(within(categoryGroup).getAllByRole('button')).toHaveLength(6);
    for (const [, label] of categorySeeds) {
      expect(within(categoryGroup).getByRole('button', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));
    expect(canvasCalls.fitView).toHaveBeenCalledWith(64);
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(canvasCalls.resetLayout).toHaveBeenCalledTimes(1);
  });

  test('navigates directly between category overviews through the visible legend', () => {
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: categorySeeds[2][1] }));
    advance(800);
    const controlFlow = screen.getByRole('button', { name: categorySeeds[3][1] });
    expect(controlFlow).toBeEnabled();
    fireEvent.click(controlFlow);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    advance(800);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
    expect(canvasProps.at(-1)?.activeCategoryID).toBe('control-flow');
  });

  test('removes world-only map controls and closes the detail-navigation gap at level three', () => {
    const { container } = render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: categorySeeds[2][1] }));
    advance(800);
    fireEvent.click(container.querySelector('.kg-category-panel__primary')!);
    advance(1000);

    expect(screen.getByRole('searchbox', { name: 'Search knowledge nodes' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Relation type' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fit view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset layout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /legend/i })).not.toBeInTheDocument();
    expect(kgWorldCSS).toMatch(/\.kg-detail-navigation\s*\{[\s\S]*?top:\s*92px;/);
  });

  test('places the category navigator as a top-right canvas overlay', () => {
    const { container } = render(<KGWorldMap overview={overview} />);
    const layout = container.querySelector('.kg-world-map__graph-layout');
    const canvas = screen.getByTestId('canvas');
    const legend = screen.getByRole('complementary', { name: 'Knowledge graph legend' });

    expect(layout).not.toBeNull();
    expect(canvas.parentElement).toBe(layout);
    expect(legend.parentElement).toBe(layout);
    expect(kgWorldCSS).not.toContain('--kg-legend-column-width');
    expect(kgWorldCSS).toMatch(/\.kg-world-map__graph-layout\s*\{[\s\S]*?position:\s*relative;[\s\S]*?display:\s*block;/);
    expect(kgWorldCSS).toMatch(/\.kg-world-legend\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*24px;[\s\S]*?right:\s*24px;[\s\S]*?width:\s*clamp\(320px,\s*28vw,\s*440px\);/);
    expect(kgWorldCSS).toMatch(/\.kg-world-legend\s+ul\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(kgWorldCSS).toMatch(/\.kg-details-drawer\s*\{\s*right:\s*24px;/);
    expect(kgWorldCSS).toMatch(/@container\s+kg-world\s+\(max-width:\s*1199px\)\s*\{[\s\S]*?\.kg-world-legend\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*12px;[\s\S]*?right:\s*12px;[\s\S]*?width:\s*212px;/);
    expect(kgWorldCSS).toMatch(/@container\s+kg-world\s+\(max-width:\s*1199px\)\s*\{[\s\S]*?\.kg-world-legend\s+ul\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(kgWorldCSS).toMatch(/@container\s+kg-world\s+\(max-width:\s*1199px\)\s*\{[\s\S]*?\.kg-world-legend\s+li\s+button\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?\.kg-world-legend\s+li\s+button\s+small\s*\{[\s\S]*?display:\s*none;/);
  });

  test('debounces ID, label, and alias search by 180ms and opens a chosen node summary', () => {
    render(<KGWorldMap overview={overview} />);
    const input = screen.getByRole('searchbox', { name: 'Search knowledge nodes' });

    fireEvent.change(input, { target: { value: 'list' } });
    advance(179);
    expect(screen.queryByRole('option', { name: '列表 · Concept:list' })).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByRole('option', { name: '列表 · Concept:list' })).toBeInTheDocument();
    expect(canvasProps.at(-1)?.selectedNodeID).toBe('Concept:list');

    fireEvent.click(screen.getByRole('option', { name: '列表 · Concept:list' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(screen.getByRole('complementary', { name: '节点详情' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '不存在' } });
    advance(180);
    expect(screen.getByText('No matching nodes')).toBeInTheDocument();
  });

  test('filters relation types without deleting nodes and resets the filter', () => {
    render(<KGWorldMap overview={overview} />);
    expect(canvasProps.at(-1)?.graph.edges).toHaveLength(1);
    expect(canvasProps.at(-1)?.graph.nodes).toHaveLength(2);

    fireEvent.change(screen.getByRole('combobox', { name: 'Relation type' }), {
      target: { value: 'depends_on' },
    });
    expect(canvasProps.at(-1)?.graph.edges).toHaveLength(0);
    expect(canvasProps.at(-1)?.graph.nodes).toHaveLength(2);
    expect(canvasProps.at(-1)?.graph.nodes.every(
      (node: { style: { opacity?: number } }) => node.style.opacity === 0.28,
    )).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(canvasProps.at(-1)?.graph.edges).toHaveLength(1);
  });

  test('toggles the fixed legend and Escape clears selection before exiting each level', () => {
    render(<KGWorldMap overview={overview} />);
    expect(screen.getByRole('complementary', { name: 'Knowledge graph legend' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide legend' }));
    expect(screen.queryByRole('complementary', { name: 'Knowledge graph legend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '图例' }));
    expect(screen.getByRole('complementary', { name: 'Knowledge graph legend' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    fireEvent.click(screen.getByRole('button', { name: '画布 Escape' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(canvasProps.at(-1)?.selectedNodeID).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    advance(800);
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    advance(500);
    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    fireEvent.click(screen.getByRole('button', { name: '画布 Escape' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL');
    expect(canvasProps.at(-1)?.selectedNodeID).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '画布 Escape' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_CATEGORY');
    advance(400);
    fireEvent.click(screen.getByRole('button', { name: '画布 Escape' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('RETURNING_TO_WORLD');
  });

  test('opens API-backed node and edge drawers with exact widths and sorted facts', () => {
    render(<KGWorldMap overview={detailOverview} />);

    fireEvent.click(screen.getByRole('button', { name: '画布关系 Concept:list|Concept:index' }));
    expect(screen.getByRole('complementary', { name: '关系详情' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');

    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));

    const nodeDrawer = screen.getByRole('complementary', { name: '节点详情' });
    expect(nodeDrawer).toHaveAttribute('data-selection-kind', 'node');
    expect(nodeDrawer).toHaveStyle({ width: '400px' });
    expect(nodeDrawer).toHaveTextContent('列表');
    expect(nodeDrawer).toHaveTextContent('Concept:list');
    expect(nodeDrawer).toHaveTextContent('Concept');
    expect(nodeDrawer).toHaveTextContent('集合与访问域');
    expect(nodeDrawer).toHaveTextContent('列表是有序可变集合。');
    expect(within(nodeDrawer).getAllByRole('link')).toHaveLength(1);
    expect(within(nodeDrawer).getAllByTestId('node-neighbor').map((item) => item.textContent)).toEqual([
      'alpha · 索引 · Concept:index',
      'beta · 索引 · Concept:index',
      'related_to · 范围 · Concept:range',
      'zeta · 索引 · Concept:index',
    ]);
    expect(within(nodeDrawer).getAllByTestId('node-path').map((item) => item.textContent)).toEqual([
      'path-a',
      'path-b',
    ]);

    fireEvent.click(within(nodeDrawer).getByRole('button', { name: '关闭详情' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('WORLD');
    expect(canvasProps.at(-1)?.selectedNodeID).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '画布关系 Concept:list|Concept:index' }));
    const edgeDrawer = screen.getByRole('complementary', { name: '关系详情' });
    expect(edgeDrawer).toHaveAttribute('data-selection-kind', 'edge');
    expect(edgeDrawer).toHaveStyle({ width: '440px' });
    expect(within(edgeDrawer).getAllByTestId('relation-type').map((item) => item.textContent)).toEqual([
      'alpha',
      'beta',
      'zeta',
    ]);
    expect(within(edgeDrawer).getAllByTestId('relation-provenance').map((item) => item.textContent)).toEqual([
      'curated',
      'generated',
      'merged',
    ]);
    expect(within(edgeDrawer).getAllByTestId('edge-triple').map((item) => item.textContent)).toEqual([
      expect.stringContaining('alpha'),
      expect.stringContaining('beta'),
      expect.stringContaining('zeta'),
    ]);
  });

  test('groups exact boundary ports, opens unique triples, and navigates only from the explicit button', () => {
    render(<KGWorldMap overview={detailOverview} />);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    advance(800);
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    advance(500);

    expect(canvasProps.at(-1)?.graph.nodes.map((node: { id: string }) => node.id)).toEqual([
      'Concept:list',
      'Concept:index',
      'Concept:slice',
    ]);
    expect(screen.getByRole('button', { name: '← 程序基础域 · 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '程序基础域 · 1 →' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '程序基础域 · 1 →' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL');
    const portDrawer = screen.getByRole('complementary', { name: '跨区域关系' });
    expect(portDrawer).toHaveAttribute('data-selection-kind', 'port');
    expect(portDrawer).toHaveStyle({ width: '440px' });
    expect(within(portDrawer).getAllByTestId('port-triple')).toHaveLength(1);
    expect(portDrawer).toHaveTextContent('Concept:list');
    expect(portDrawer).toHaveTextContent('related_to');
    expect(portDrawer).toHaveTextContent('Concept:range');
    expect(portDrawer).toHaveTextContent('outgoing');
    expect(portDrawer).toHaveTextContent('curated');
    expect(canvasCalls.focusCategory).toHaveBeenCalledTimes(1);

    fireEvent.click(within(portDrawer).getByRole('button', { name: '前往该区域' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    expect(canvasCalls.focusCategory).toHaveBeenLastCalledWith('program-foundations', 400);
    advance(799);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    advance(1);
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
    expect(screen.getByRole('heading', { name: '程序基础域' })).toBeInTheDocument();
  });

  test('selects real paths by ID and applies precedence, exact focus, and path overlay', () => {
    render(<KGWorldMap overview={detailOverview} initialLocation={{ pathID: 'path-b' }} />);
    advance(800);
    advance(500);

    const selector = screen.getByRole('combobox', { name: '学习路径' });
    expect(selector).toHaveValue('path-b');
    expect(within(selector).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '清除路径高亮',
      'path-a · 列表到索引',
      'path-b · 列表到切片',
    ]);
    const roles = canvasProps.at(-1)?.roleByNodeID as Map<string, string>;
    expect(roles.get('Concept:list')).toBe('upstream');
    expect(roles.get('Concept:index')).toBe('current');
    expect(roles.get('Concept:slice')).toBe('downstream');
    expect(canvasProps.at(-1)?.focusNodeID).toBe('Concept:index');
    expect([...canvasProps.at(-1)?.pathNodeIDs]).toEqual([
      'Concept:list',
      'Concept:index',
      'Concept:slice',
    ]);
    expect([...canvasProps.at(-1)?.pathEdgeIDs]).toEqual([
      'Concept:list|Concept:index',
      'Concept:index|Concept:slice',
    ]);

    fireEvent.change(selector, { target: { value: '' } });
    expect(canvasProps.at(-1)?.pathNodeIDs).toBeUndefined();
    expect(canvasProps.at(-1)?.pathEdgeIDs).toBeUndefined();
    expect(canvasProps.at(-1)?.roleByNodeID.size).toBe(0);
  });

  test('clears an incompatible learning path before entering another category from world', () => {
    render(<KGWorldMap overview={detailOverview} initialLocation={{ pathID: 'path-a' }} />);
    advance(800);
    advance(500);
    expect(screen.getByRole('combobox', { name: '学习路径' })).toHaveValue('path-a');

    fireEvent.click(screen.getByRole('button', { name: '返回知识世界' }));
    advance(900);
    fireEvent.click(screen.getByRole('button', { name: '程序基础域' }));
    advance(800);
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    advance(500);

    const selector = screen.getByRole('combobox', { name: '学习路径' });
    expect(selector).toHaveValue('');
    expect(within(selector).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '清除路径高亮',
    ]);
    expect(canvasProps.at(-1)?.pathNodeIDs).toBeUndefined();
    expect(canvasProps.at(-1)?.pathEdgeIDs).toBeUndefined();
    expect(canvasProps.at(-1)?.graph.nodes.every(
      (node: { style: { opacity?: number } }) => node.style.opacity !== 0.2,
    )).toBe(true);
    expect(canvasProps.at(-1)?.graph.edges.every(
      (edge: { style: { opacity?: number } }) => edge.style.opacity !== 0.08,
    )).toBe(true);
  });

  test('reserves the drawer inset for the canvas while the sibling legend remains in normal flow', () => {
    const { container } = render(<KGWorldMap overview={detailOverview} />);
    fireEvent.click(screen.getByRole('button', { name: '画布节点 Concept:list' }));
    advance(800);
    advance(500);

    const world = container.querySelector('.kg-world-map');
    expect(world).toHaveStyle({ '--kg-drawer-offset': '416px' });
    expect(canvasProps.at(-1)?.rightViewportInset).toBe(418);

    fireEvent.click(screen.getByRole('button', { name: 'Hide legend' }));
    expect(screen.getByRole('button', { name: '图例' })).toBeInTheDocument();
    expect(world).toHaveStyle({ '--kg-drawer-offset': '416px' });

    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(canvasProps.at(-1)?.rightViewportInset).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '图例' }));
    fireEvent.click(screen.getByRole('button', { name: '画布关系 Concept:list|Concept:index' }));
    expect(world).toHaveStyle({ '--kg-drawer-offset': '456px' });
    expect(canvasProps.at(-1)?.rightViewportInset).toBe(458);

    expect(kgWorldCSS).toMatch(/\.kg-world-legend\s*\{[\s\S]*?position:\s*relative;/);
    expect(kgWorldCSS).not.toMatch(/\.kg-world-legend\s*\{[^}]*right:\s*var\(--kg-drawer-offset/);
    expect(kgWorldCSS).not.toMatch(/\.kg-world-legend-toggle\s*\{[^}]*right:\s*var\(--kg-drawer-offset/);
  });

  test('keeps all 160 API path IDs accessible through their category selector', () => {
    const paths = Array.from({ length: 160 }, (_, index) => ({
      ...detailOverview.paths[0],
      path_id: `path-${String(index).padStart(3, '0')}`,
      label: `API 路径 ${index}`,
    }));
    render(<KGWorldMap overview={{
      ...detailOverview,
      counts: { ...detailOverview.counts, paths: 160 },
      paths,
    }} initialLocation={{ pathID: 'path-159' }} />);
    advance(800);
    advance(500);

    const selector = screen.getByRole('combobox', { name: '学习路径' });
    expect(within(selector).getAllByRole('option')).toHaveLength(161);
    expect(within(selector).getByRole('option', { name: 'path-000 · API 路径 0' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'path-159 · API 路径 159' })).toBeInTheDocument();
  });

  test('keeps URL focus passive until the learner explicitly selects a node', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    render(
      <KGWorldMap
        overview={detailOverview}
        roleView={{
          upstream: ['Concept:list'],
          current: ['Concept:index'],
          downstream: ['Concept:slice'],
          focus_node_ids: ['Concept:index'],
        }}
        initialLocation={{ focusNodeID: 'Concept:index', pathID: 'path-b' }}
      />,
    );
    await act(async () => Promise.resolve());
    advance(40);
    advance(500);

    expect(canvasProps.at(-1)?.focusNodeID).toBe('Concept:index');
    expect(canvasProps.at(-1)?.selectedNodeID).toBeUndefined();
    expect(document.querySelector('.kg-details-drawer')).not.toBeInTheDocument();
    expect([...canvasProps.at(-1)?.pathNodeIDs]).toEqual([
      'Concept:list',
      'Concept:index',
      'Concept:slice',
    ]);
  });

  test('uses the fixed world CSS geometry without organic texture overrides', () => {
    expect(kgWorldCSS).toMatch(/\.kg-world-map\s*\{[\s\S]*?--kg-camera-left-reserve:\s*424px;[\s\S]*?--kg-fit-padding:\s*64px;/);
    expect(kgWorldCSS).toMatch(/\.kg-world-map__graph-layout\s*>\s*\.kg-graph-canvas\s*\{[\s\S]*?background-color:\s*#f8fafc;[\s\S]*?background-size:\s*32px 32px,\s*32px 32px;/i);
    expect(kgWorldCSS).not.toContain('radial-gradient');
    expect(kgWorldCSS).not.toContain('feTurbulence');
    expect(kgWorldCSS).toMatch(/\.kg-category-panel\s*\{[\s\S]*?top:\s*94px;[\s\S]*?width:\s*360px;/);
    expect(kgWorldCSS).toMatch(/\.kg-detail-navigation button\s*\{[\s\S]*?font:\s*600 12px\/1\.2 Epilogue, system-ui, sans-serif;/);
    expect(kgWorldCSS).toMatch(/\.kg-world-legend\s*\{[\s\S]*?top:\s*24px;[\s\S]*?right:\s*24px;[\s\S]*?width:\s*clamp\(320px,\s*28vw,\s*440px\);/);
    const tabletRule = kgWorldCSS.match(/@media \(max-width:\s*1024px\)\s*\{([\s\S]*)\}\s*$/)?.[1] ?? '';
    expect(tabletRule).not.toMatch(/\.kg-category-panel\s*\{[^}]*top:\s*\d+px;/);
  });

  test('cleans a pending transition timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(<KGWorldMap overview={overview} />);
    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    clearTimeoutSpy.mockClear();

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  test('reduced motion keeps the transient state order but completes each step next frame', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    await act(async () => Promise.resolve());
    act(() => frames.shift()?.(16));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');
    fireEvent.click(screen.getByRole('button', { name: '查看区域详情' }));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_DETAIL');
    await act(async () => Promise.resolve());
    act(() => frames.shift()?.(32));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_DETAIL');
    expect(canvasProps.at(-1)?.reducedMotion).toBe(true);

    vi.unstubAllGlobals();
  });

  test('reduced motion does not complete a category transition before its camera promise', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let resolveCamera!: () => void;
    const cameraComplete = new Promise<void>((resolve) => { resolveCamera = resolve; });
    canvasCalls.focusCategory.mockReturnValue(cameraComplete);
    render(<KGWorldMap overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: '集合与访问域' }));
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('ENTERING_CATEGORY');
    expect(frames).toHaveLength(0);

    await act(async () => {
      resolveCamera();
      await cameraComplete;
      await Promise.resolve();
    });
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(16));
    expect(screen.getByTestId('kg-view-state')).toHaveTextContent('CATEGORY_FOCUS');

    canvasCalls.focusCategory.mockResolvedValue(undefined);
    vi.unstubAllGlobals();
  });
});
