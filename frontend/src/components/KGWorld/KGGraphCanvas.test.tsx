import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRef, StrictMode, useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KGCategory, KGWorldGraph } from './types';
const kgWorldCSS = readFileSync('src/components/KGWorld/kg-world.css', 'utf8');

const graphMocks = vi.hoisted(() => {
  const instances: any[] = [];
  const options: unknown[] = [];
  const state: {
    renderPromise: Promise<void> | null;
    renderPromises: Promise<void>[];
    drawPromises: Promise<void>[];
    layoutPromises: Promise<void>[];
    drawEmitsAfterRender: boolean;
  } = {
    renderPromise: null,
    renderPromises: [],
    drawPromises: [],
    layoutPromises: [],
    drawEmitsAfterRender: true,
  };

  const Graph = vi.fn(function GraphMock(nextOptions: unknown) {
    options.push(nextOptions);
    let edgeData: any[] = [];
    let nodeData: any[] = [];
    let canvasEdgeData: any[] = [];
    let canvasNodeData: any[] = [];
    const edgePathByID = new Map<string, { source: [number, number]; target: [number, number] }>();
    const paintModelToCanvas = () => {
      canvasEdgeData = edgeData.map((edge) => ({
        ...edge,
        data: { ...edge.data },
        style: { ...edge.style },
      }));
      canvasNodeData = nodeData.map((node) => ({
        ...node,
        data: { ...node.data },
        style: { ...node.style },
      }));
    };
    const overwriteAdapterControlPoints = () => {
      edgeData = edgeData.map((edge) => ({
        ...edge,
        style: edge.type === 'polyline' ? { ...edge.style, controlPoints: [] } : edge.style,
      }));
    };
    const canvasListeners = new Map<string, Set<() => void>>();
    const canvasLayer = {
      addEventListener: vi.fn((eventName: string, listener: () => void) => {
        canvasListeners.set(eventName, new Set([...(canvasListeners.get(eventName) ?? []), listener]));
      }),
      removeEventListener: vi.fn((eventName: string, listener: () => void) => {
        canvasListeners.get(eventName)?.delete(listener);
      }),
      render: vi.fn(),
      emit: (eventName: string) => {
        for (const listener of canvasListeners.get(eventName) ?? []) listener();
      },
    };
    const canvas = {
      getLayer: vi.fn(() => canvasLayer),
      getLayers: vi.fn(() => ({ main: canvasLayer })),
    };
    const tooltipPlugin = { hide: vi.fn(), updateMember: vi.fn() };
    const emitGraph = (eventName: string) => {
      for (const [registered, listener] of instance.on.mock.calls) {
        if (registered === eventName) listener({});
      }
    };
    const instance = {
      __canvas: canvasLayer,
      destroy: vi.fn(),
      context: {
        animation: { stop: vi.fn() },
        element: {
          getElement: vi.fn((id: string) => ({
            getShape: vi.fn(() => {
              const endpoints = edgePathByID.get(id) ?? {
                source: [160, 80] as [number, number],
                target: [280, 240] as [number, number],
              };
              return {
                parsedStyle: {
                  d: {
                    absolutePath: [
                      ['M', ...endpoints.source],
                      ['L', ...endpoints.target],
                    ],
                  },
                },
              };
            }),
          })),
        },
      },
      draw: vi.fn(() => {
        paintModelToCanvas();
        if (state.drawEmitsAfterRender) {
          queueMicrotask(() => canvasLayer.emit('afterrender'));
        }
        return state.drawPromises.shift() ?? Promise.resolve();
      }),
      fitView: vi.fn().mockResolvedValue(undefined),
      focusElement: vi.fn().mockResolvedValue(undefined),
      getData: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
      getCanvasData: vi.fn(() => ({ nodes: canvasNodeData, edges: canvasEdgeData })),
      getCanvas: vi.fn(() => canvas),
      getElementRenderBounds: vi.fn((id: string) => id === 'Concept:index'
        ? { min: [280, 200, 0], max: [360, 280, 0] }
        : id.includes('|')
          ? { min: [160, 80, 0], max: [280, 240, 0] }
          : { min: [80, 40, 0], max: [160, 120, 0] }),
      getElementRenderStyle: vi.fn((id: string) => ({
        ...(canvasNodeData.find((node) => node.id === id)?.style ?? {}),
        ...(id === 'Concept:index' ? { x: 320, y: 240 } : { x: 120, y: 80 }),
      })),
      getElementState: vi.fn().mockReturnValue([]),
      getEdgeData: vi.fn(() => edgeData),
      getElementPosition: vi.fn((id: string) =>
        id === 'Concept:index' ? [320, 240] : [120, 80]),
      getClientByCanvas: vi.fn(([x, y]: [number, number]) => [x + 40, y + 24]),
      getCanvasByViewport: vi.fn(([x, y]: [number, number]) => [x, y]),
      getCanvasByClient: vi.fn(([x, y]: [number, number]) => [x, y]),
      getNodeData: vi.fn(() => nodeData),
      getPosition: vi.fn().mockReturnValue([12, 18]),
      getPluginInstance: vi.fn().mockReturnValue(tooltipPlugin),
      getViewportByCanvas: vi.fn(([x, y]: [number, number]) => [x, y]),
      getZoom: vi.fn().mockReturnValue(1.25),
      layout: vi.fn(() => {
        overwriteAdapterControlPoints();
        paintModelToCanvas();
        return state.layoutPromises.shift() ?? Promise.resolve();
      }),
      off: vi.fn(),
      on: vi.fn(),
      render: vi.fn(() => {
        overwriteAdapterControlPoints();
        paintModelToCanvas();
        queueMicrotask(() => {
          emitGraph('aftercanvasinit');
          canvasLayer.emit('afterrender');
        });
        return state.renderPromises.shift() ?? state.renderPromise ?? Promise.resolve();
      }),
      resize: vi.fn(),
      setData: vi.fn((data: { nodes?: any[]; edges?: any[] }) => {
        nodeData = data.nodes ?? [];
        edgeData = data.edges ?? [];
      }),
      setLayout: vi.fn(),
      setOptions: vi.fn(),
      setPlugins: vi.fn(),
      stopLayout: vi.fn(),
      translateBy: vi.fn().mockResolvedValue(undefined),
      translateTo: vi.fn().mockResolvedValue(undefined),
      zoomBy: vi.fn().mockResolvedValue(undefined),
      zoomTo: vi.fn().mockResolvedValue(undefined),
      updateEdgeData: vi.fn((updates: any[]) => {
        const byID = new Map(updates.map((edge) => [edge.id, edge]));
        edgeData = edgeData.map((edge) => {
          const update = byID.get(edge.id);
          return update
            ? {
                ...edge,
                ...update,
                data: { ...edge.data, ...update.data },
                style: { ...edge.style, ...update.style },
              }
            : edge;
        });
      }),
      updateNodeData: vi.fn((updates: any[]) => {
        const byID = new Map(updates.map((node) => [node.id, node]));
        nodeData = nodeData.map((node) => {
          const update = byID.get(node.id);
          return update
            ? {
                ...node,
                ...update,
                data: { ...node.data, ...update.data },
                style: { ...node.style, ...update.style },
              }
            : node;
        });
      }),
      __setEdgePath: (
        id: string,
        source: [number, number],
        target: [number, number],
      ) => edgePathByID.set(id, { source, target }),
      __injectCanvasNodeStyle: (id: string, style: Record<string, unknown>) => {
        canvasNodeData = canvasNodeData.map((node) => node.id === id
          ? { ...node, style: { ...node.style, ...style } }
          : node);
      },
      __tooltipPlugin: tooltipPlugin,
    };
    instances.push(instance);
    return instance;
  });

  return { Graph, instances, options, state };
});

vi.mock('@antv/g6', () => ({
  CanvasEvent: {
    CLICK: 'canvas:click',
    POINTER_LEAVE: 'canvas:pointerleave',
    POINTER_MOVE: 'canvas:pointermove',
  },
  CommonEvent: { KEY_DOWN: 'keydown' },
  EdgeEvent: { CLICK: 'edge:click' },
  Graph: graphMocks.Graph,
  GraphEvent: {
    AFTER_CANVAS_INIT: 'aftercanvasinit',
    AFTER_DRAW: 'afterdraw',
    AFTER_LAYOUT: 'afterlayout',
    AFTER_SIZE_CHANGE: 'aftersizechange',
    AFTER_TRANSFORM: 'aftertransform',
  },
  NodeEvent: {
    CLICK: 'node:click',
    DBLCLICK: 'node:dblclick',
    DRAG: 'node:drag',
    DRAG_END: 'node:dragend',
    DRAG_START: 'node:dragstart',
    POINTER_LEAVE: 'node:pointerleave',
    POINTER_MOVE: 'node:pointermove',
    POINTER_OUT: 'node:pointerout',
    POINTER_OVER: 'node:pointerover',
  },
}));

vi.mock('@antv/g-canvas', () => ({
  Renderer: vi.fn(),
}));

import {
  GRAPH_LIMITS,
  KGGraphCanvas,
  ROLE_STYLES,
  type KGGraphCanvasHandle,
} from './KGGraphCanvas';

const categories: KGCategory[] = [
  {
    id: 'collections-and-access',
    label_zh: '集合与访问域',
    label_en: 'Collections and access',
    description_zh: '集合与访问知识区域。',
    description_en: 'Collections and access knowledge region.',
    color: '#606C38',
    surface_color: '#D4B895',
    anchor: { x: 0.24, y: 0.3 },
    order: 3,
    node_count: 2,
    internal_relation_count: 1,
    outgoing_relation_count: 0,
    incoming_relation_count: 0,
  },
  {
    id: 'functions-and-modules',
    label_zh: '函数与模块域',
    label_en: 'Functions and modules',
    description_zh: '函数与模块知识区域。',
    description_en: 'Functions and modules knowledge region.',
    color: '#C66B3D',
    surface_color: '#B08B6E',
    anchor: { x: 0.62, y: 0.7 },
    order: 5,
    node_count: 0,
    internal_relation_count: 0,
    outgoing_relation_count: 0,
    incoming_relation_count: 1,
  },
];

const graph: KGWorldGraph = {
  nodes: [
    {
      id: 'Concept:list',
      data: {
        node_id: 'Concept:list',
        label: '列表',
        node_type: 'Concept',
        origin: 'curated',
        aliases: [],
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
      style: { fill: '#606C38', size: 10 },
    },
    {
      id: 'Concept:index',
      data: {
        node_id: 'Concept:index',
        label: '索引',
        node_type: 'Concept',
        origin: 'curated',
        aliases: [],
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
      style: { fill: '#606C38', size: 10 },
    },
  ],
  edges: [
    {
      id: 'Concept:list|uses|Concept:index',
      source: 'Concept:list',
      target: 'Concept:index',
      data: {
        key: 'Concept:list|Concept:index',
        source: 'Concept:list',
        target: 'Concept:index',
        source_category_id: 'collections-and-access',
        target_category_id: 'collections-and-access',
        is_cross_category: false,
        relation_types: ['uses'],
        relation_count: 1,
        provenance_count: 1,
        origins: ['curated'],
        source_ids: [],
        source_chunk_ids: [],
        source_urls: [],
        evidence_texts: [],
      },
    },
    {
      id: 'Concept:list|crosses|Concept:index',
      source: 'Concept:list',
      target: 'Concept:index',
      data: {
        key: 'Concept:list|crosses|Concept:index',
        source: 'Concept:list',
        target: 'Concept:index',
        source_category_id: 'collections-and-access',
        target_category_id: 'functions-and-modules',
        is_cross_category: true,
        relation_types: ['crosses'],
        relation_count: 1,
        provenance_count: 1,
        origins: ['curated'],
        source_ids: [],
        source_chunk_ids: [],
        source_urls: [],
        evidence_texts: [],
      },
    },
  ],
};

function worldGraphWithNodeCount(nodeCount: number): KGWorldGraph {
  return {
    nodes: Array.from({ length: nodeCount }, (_, index) => {
      const template = graph.nodes[index % graph.nodes.length];
      const id = `Concept:review-${index}`;
      return {
        ...template,
        id,
        data: {
          ...template.data,
          node_id: id,
          category_id: categories[index % categories.length].id,
        },
      };
    }),
    edges: [],
  };
}

function acceptedWorldCachePositions(worldGraph: KGWorldGraph) {
  return Object.fromEntries(worldGraph.nodes.map((node, index) => [
    node.id,
    {
      x: 140 + (index % 10) * 76,
      y: 90 + Math.floor(index / 10) * 48,
      categoryID: node.data.category_id,
    },
  ]));
}

function installWorldCache(worldGraph: KGWorldGraph) {
  localStorage.setItem('kg-world-layout-v3', JSON.stringify({
    dataVersion: 'overview-v1',
    layoutAlgorithm: 'global-force-v1',
    viewportBucket: '1000x600',
    positions: acceptedWorldCachePositions(worldGraph),
  }));
}

function canvasProps(overrides: Record<string, unknown> = {}) {
  return {
    categories,
    dataVersion: 'overview-v1',
    graph,
    reducedMotion: false,
    roleByNodeID: new Map([['Concept:list', 'current' as const]]),
    selectedEdgeID: '',
    selectedNodeID: 'Concept:list',
    viewState: 'WORLD' as const,
    ...overrides,
  };
}

function latestGraph() {
  return graphMocks.instances.at(-1)!;
}

function graphOption() {
  return graphMocks.options.at(-1) as {
    behaviors: Array<Record<string, unknown>>;
    layout: Record<string, unknown>;
    plugins: Array<Record<string, unknown>>;
    renderer: unknown;
    zoomRange: [number, number];
  };
}

function latestLayout() {
  return latestGraph().setLayout.mock.calls.at(-1)?.[0] as Record<string, any>;
}

function emitCanvasReadyAndRender(graphInstance = latestGraph()) {
  graphInstance.on.mock.calls.find(
    ([eventName]: [string]) => eventName === 'aftercanvasinit',
  )?.[1]?.({});
  graphInstance.__canvas.emit('afterrender');
}

function controlAnimationFrames() {
  let nextID = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = nextID++;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    cancel,
    pending: () => callbacks.size,
    request,
    async flush(timestamp = 16) {
      const frame = [...callbacks.values()];
      callbacks.clear();
      await act(async () => {
        for (const callback of frame) callback(timestamp);
        await Promise.resolve();
      });
    },
  };
}

describe('KGGraphCanvas', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete (window as Window & { __RESPONSIBLE_EDU_KG_DEBUG__?: boolean })
      .__RESPONSIBLE_EDU_KG_DEBUG__;
    graphMocks.Graph.mockClear();
    graphMocks.instances.length = 0;
    graphMocks.options.length = 0;
    graphMocks.state.renderPromise = null;
    graphMocks.state.renderPromises.length = 0;
    graphMocks.state.drawPromises.length = 0;
    graphMocks.state.layoutPromises.length = 0;
    graphMocks.state.drawEmitsAfterRender = true;
    localStorage.clear();
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => {
    delete (window as Window & { __RESPONSIBLE_EDU_KG_DEBUG__?: boolean })
      .__RESPONSIBLE_EDU_KG_DEBUG__;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    getContextSpy.mockRestore();
  });

  it('emits read-only browser snapshots for paint, settlement, transform, and focus peak then stops on unmount', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'test');
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);

    const { unmount } = render(
      <KGGraphCanvas {...canvasProps({
        activeCategoryID: categories[0].id,
        focusNodeID: 'Concept:list',
        viewState: 'CATEGORY_DETAIL',
      })} />,
    );
    await act(async () => Promise.resolve());
    emitCanvasReadyAndRender();
    await act(async () => {
      vi.advanceTimersByTime(34);
      await Promise.resolve();
    });

    expect(events.map((event) => event.detail.phase)).toEqual(
      expect.arrayContaining(['first-paint', 'layout-settled']),
    );
    const firstPaint = events.find((event) => event.detail.phase === 'first-paint')?.detail;
    expect(firstPaint).toEqual(expect.objectContaining({
      activeCategoryID: 'collections-and-access',
      edgeCount: 2,
      nodeCount: 2,
      viewState: 'CATEGORY_DETAIL',
      zoom: 1.25,
      camera: { x: 12, y: 18 },
    }));
    expect(firstPaint.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'Concept:index', clientX: 360, clientY: 264 }),
    ]));
    expect(firstPaint.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'Concept:list|uses|Concept:index',
        source: 'Concept:list',
        stroke: expect.any(String),
        target: 'Concept:index',
      }),
    ]));
    expect(firstPaint.renderedEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'Concept:list|uses|Concept:index',
        source: 'Concept:list',
        target: 'Concept:index',
        bounds: { minX: 200, minY: 104, maxX: 320, maxY: 264 },
        sourceAttachmentDistance: 0,
        targetAttachmentDistance: 0,
        sourceRadius: 40,
        targetRadius: 40,
      }),
    ]));
    expect(firstPaint.crossCategoryEdgeCount).toBe(1);

    const transform = latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'aftertransform',
    )?.[1];
    transform?.({});
    expect(events.at(-1)?.detail.phase).toBe('transform');

    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
    });
    expect(events.at(-1)?.detail.phase).toBe('focus-peak');
    expect(events.at(-1)?.detail.focusNodeID).toBe('Concept:list');

    const eventCount = events.length;
    const canvas = latestGraph().__canvas;
    unmount();
    expect(canvas.removeEventListener).toHaveBeenCalledWith('afterrender', expect.any(Function));
    expect(events).toHaveLength(eventCount + 1);
    expect(events.at(-1)?.detail).toEqual(expect.objectContaining({
      phase: 'cleanup',
      runtime: {
        g6ListenerCount: 0,
        intervalCount: 0,
        timeoutCount: 0,
        g6AnimationCount: 0,
        timelineAnimationCount: 0,
      },
    }));
    const cleanupEventCount = events.length;
    canvas.emit('afterrender');
    transform?.({});
    act(() => vi.advanceTimersByTime(1600));
    expect(events).toHaveLength(cleanupEventCount);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('rejects a huge edge AABB false-positive by measuring the actual key-path endpoints', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    latestGraph().getElementRenderBounds.mockImplementation((id: string) => id.includes('|')
      ? { min: [-1_000, -1_000, 0], max: [1_000, 1_000, 0] }
      : id === 'Concept:index'
        ? { min: [280, 200, 0], max: [360, 280, 0] }
        : { min: [80, 40, 0], max: [160, 120, 0] });
    latestGraph().__setEdgePath(
      'Concept:list|uses|Concept:index',
      [240, 80],
      [200, 240],
    );
    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'aftertransform',
    )?.[1]?.({});

    const edge = events.at(-1)?.detail.renderedEdges.find(
      (candidate: { id: string }) => candidate.id === 'Concept:list|uses|Concept:index',
    );
    expect(edge).toEqual(expect.objectContaining({
      sourceAttachmentDistance: 80,
      targetAttachmentDistance: 80,
    }));
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('does not publish browser debug snapshots in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const listener = vi.fn();
    window.addEventListener('kg-graph-debug', listener);

    const { unmount } = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    expect(listener).not.toHaveBeenCalled();

    unmount();
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('publishes browser debug snapshots in production only when the explicit test hook is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    (window as Window & { __RESPONSIBLE_EDU_KG_DEBUG__?: boolean })
      .__RESPONSIBLE_EDU_KG_DEBUG__ = true;
    const listener = vi.fn();
    window.addEventListener('kg-graph-debug', listener);

    const { unmount } = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    emitCanvasReadyAndRender();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ phase: 'first-paint' }),
    }));

    unmount();
    delete (window as Window & { __RESPONSIBLE_EDU_KG_DEBUG__?: boolean })
      .__RESPONSIBLE_EDU_KG_DEBUG__;
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('publishes the current rendered node center during a drag instead of the stale layout position', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    latestGraph().getElementPosition.mockReturnValue([120, 80]);
    latestGraph().getElementRenderStyle.mockReturnValue({ x: 204, y: 122 });
    latestGraph().getElementRenderBounds.mockImplementation((id: string) => id === 'Concept:list'
      ? { min: [164, 82, 0], max: [244, 162, 0] }
      : { min: [280, 200, 0], max: [360, 280, 0] });
    const eventCount = events.length;
    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'node:drag',
    )?.[1]?.({});
    expect(events).toHaveLength(eventCount);
    expect(frames.pending()).toBeGreaterThanOrEqual(1);
    await frames.flush();

    const drag = events.at(-1)?.detail;
    expect(drag.phase).toBe('node-drag');
    expect(drag.nodes.find((node: { id: string }) => node.id === 'Concept:list')).toEqual({
      id: 'Concept:list',
      clientX: 244,
      clientY: 146,
      opacity: 1,
      size: 0,
      fill: '',
      shadowBlur: 0,
      shadowColor: '',
      maxX: 284,
      maxY: 186,
      minX: 204,
      minY: 106,
    });
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('commits WORLD drag corridors and draw before publishing without projecting nodes', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const frameCalls: string[] = [];
    const listener = (event: Event) => {
      if ((event as CustomEvent<Record<string, any>>).detail.phase === 'node-drag') {
        frameCalls.push('publish:node-drag');
      }
    };
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const updateCorridors = latestGraph().updateEdgeData.getMockImplementation();
    latestGraph().updateEdgeData.mockImplementation((updates: any[]) => {
      frameCalls.push('update-corridors');
      return updateCorridors?.(updates);
    });
    latestGraph().draw.mockImplementation(() => {
      frameCalls.push('draw');
      return Promise.resolve();
    });
    latestGraph().updateNodeData.mockClear();

    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'node:drag',
    )?.[1]?.({});
    await frames.flush();
    await act(async () => Promise.resolve());

    window.removeEventListener('kg-graph-debug', listener);
    expect(frameCalls).toEqual([
      'update-corridors',
      'draw',
      'publish:node-drag',
    ]);
    expect(latestGraph().updateNodeData).not.toHaveBeenCalled();
  });

  it('serializes WORLD drag draws and publishes only the latest queued state', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((yes) => { resolve = yes; });
      return { promise, resolve };
    };
    const firstDraw = deferred();
    const secondDraw = deferred();
    const dragSnapshots: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => {
      const snapshot = event as CustomEvent<Record<string, any>>;
      if (snapshot.detail.phase === 'node-drag') dragSnapshots.push(snapshot);
    };
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();
    render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    await frames.flush(16);
    await frames.flush(32);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    latestGraph().draw.mockClear();
    latestGraph().draw
      .mockImplementationOnce(() => firstDraw.promise)
      .mockImplementationOnce(() => secondDraw.promise);
    const drag = latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'node:drag',
    )?.[1];

    drag?.({});
    await frames.flush(48);
    drag?.({});
    await frames.flush(64);
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);

    await act(async () => firstDraw.resolve());
    expect(dragSnapshots).toHaveLength(0);
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
    await act(async () => secondDraw.resolve());
    expect(dragSnapshots).toHaveLength(1);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('invalidates a pending WORLD drag publication when presentation data and view change', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    let resolveDragDraw!: () => void;
    const dragDraw = new Promise<void>((resolve) => { resolveDragDraw = resolve; });
    const dragSnapshots: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => {
      const snapshot = event as CustomEvent<Record<string, any>>;
      if (snapshot.detail.phase === 'node-drag') dragSnapshots.push(snapshot);
    };
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();
    const { rerender } = render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    await frames.flush(16);
    await frames.flush(32);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    latestGraph().draw.mockClear();
    latestGraph().draw.mockImplementationOnce(() => dragDraw);

    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'node:drag',
    )?.[1]?.({});
    await frames.flush(48);
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);

    rerender(<KGGraphCanvas {...canvasProps({
      selectedEdgeID: 'Concept:list|uses|Concept:index',
      viewState: 'CATEGORY_FOCUS',
    })} />);
    await act(async () => Promise.resolve());
    await act(async () => resolveDragDraw());

    expect(dragSnapshots).toHaveLength(0);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('drops an unflushed WORLD drag origin after view and data change before its RAF', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const dragSnapshots: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => {
      const snapshot = event as CustomEvent<Record<string, any>>;
      if (snapshot.detail.phase === 'node-drag') dragSnapshots.push(snapshot);
    };
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();
    const { rerender } = render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    await frames.flush(16);
    await frames.flush(32);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    latestGraph().draw.mockClear();

    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'node:drag',
    )?.[1]?.({});
    expect(frames.pending()).toBeGreaterThanOrEqual(1);

    rerender(<KGGraphCanvas {...canvasProps({
      selectedEdgeID: 'Concept:list|uses|Concept:index',
      viewState: 'CATEGORY_FOCUS',
    })} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));
    await act(async () => Promise.resolve());
    const drawCountAfterRerender = latestGraph().draw.mock.calls.length;
    await frames.flush(48);

    expect(latestGraph().draw).toHaveBeenCalledTimes(drawCountAfterRerender);
    expect(dragSnapshots).toHaveLength(0);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('publishes first paint from the real Canvas render event even when the G6 promise remains pending', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    graphMocks.state.renderPromise = new Promise(() => undefined);
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);

    const { unmount } = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    expect(events.some((event) => event.detail.phase === 'first-paint')).toBe(true);

    emitCanvasReadyAndRender();
    expect(events.filter((event) => event.detail.phase === 'first-paint')).toHaveLength(1);
    expect(latestGraph().layout).toHaveBeenCalledTimes(1);

    unmount();
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('keeps debug publication read-only when the early G6 camera is not initialized yet', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    graphMocks.state.renderPromise = new Promise(() => undefined);
    const listener = vi.fn();
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps()} />);
    latestGraph().getZoom.mockImplementationOnce(() => {
      throw new TypeError('camera is not initialized');
    });
    latestGraph().getPosition.mockImplementationOnce(() => {
      throw new TypeError('camera is not initialized');
    });
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    expect(() => emitCanvasReadyAndRender()).not.toThrow();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ camera: { x: 0, y: 0 }, zoom: 1 }),
    }));
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('exports the exact role styles and graph limits', () => {
    expect(ROLE_STYLES).toEqual({
      normal: { size: 16 },
      upstream: { size: 18, fill: '#94A3B8', stroke: '#64748B', lineWidth: 2 },
      downstream: { size: 18, fill: '#4FA66E', stroke: '#2F7A4B', lineWidth: 2 },
      current: { size: 36, fill: '#F28C28', stroke: '#FFF7ED', lineWidth: 3 },
    });
    expect(GRAPH_LIMITS).toEqual({ minZoom: 0.35, maxZoom: 4, zoomStep: 1.1 });
  });

  it('constructs one Canvas graph per mount and renders once after setting initial data', async () => {
    const { unmount } = render(<KGGraphCanvas {...canvasProps()} />);

    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    expect(graphMocks.Graph).toHaveBeenCalledTimes(1);
    expect(latestGraph().setData).toHaveBeenCalledTimes(1);
    expect(latestGraph().setData.mock.invocationCallOrder[0]).toBeLessThan(
      latestGraph().render.mock.invocationCallOrder[0],
    );
    expect(graphOption().layout).toBeUndefined();
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    expect(latestGraph().render.mock.invocationCallOrder[0]).toBeLessThan(
      latestGraph().setLayout.mock.invocationCallOrder[0],
    );
    expect(latestGraph().setLayout.mock.invocationCallOrder[0]).toBeLessThan(
      latestGraph().layout.mock.invocationCallOrder[0],
    );
    expect(graphOption().renderer).toEqual(expect.any(Function));

    unmount();
    expect(latestGraph().destroy).toHaveBeenCalledTimes(1);
  });

  it('settles only after two consecutive animation frames observe identical finite node positions', async () => {
    const frames = controlAnimationFrames();
    const onLayoutSettled = vi.fn();
    render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));

    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(1);

    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:index', style: { x: 320, y: 240 } },
      { id: 'Concept:list', style: { x: 120, y: 80 } },
    ]);
    await frames.flush(16);
    expect(onLayoutSettled).not.toHaveBeenCalled();

    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: 122, y: 80 } },
      { id: 'Concept:index', style: { x: 320, y: 240 } },
    ]);
    await frames.flush(32);
    expect(onLayoutSettled).not.toHaveBeenCalled();
    await frames.flush(48);
    expect(onLayoutSettled).not.toHaveBeenCalled();
    await frames.flush(64);

    expect(onLayoutSettled).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
  });

  it('commits final WORLD node and corridor geometry as one awaited rendered frame', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    let resolveLayout!: () => void;
    graphMocks.state.layoutPromises.push(new Promise<void>((resolve) => { resolveLayout = resolve; }));
    const frameCalls: string[] = [];
    let drawResolved = false;
    let worldCoordinateUpdates = 0;
    let nodeUpdatesAfterDrawResolved = 0;
    const onLayoutSettled = vi.fn();
    const listener = (event: Event) => {
      if ((event as CustomEvent<Record<string, any>>).detail.phase === 'layout-settled') {
        frameCalls.push('publish:layout-settled');
      }
    };
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));

    let readLogged = false;
    latestGraph().getElementPosition.mockImplementation((id: string) => {
      if (!readLogged) {
        readLogged = true;
        frameCalls.push('read-final-node-positions');
      }
      return id === 'Concept:index' ? [320, 240] : [120, 80];
    });
    const updateCorridors = latestGraph().updateEdgeData.getMockImplementation();
    latestGraph().updateEdgeData.mockImplementation((updates: any[]) => {
      frameCalls.push('update-corridors');
      return updateCorridors?.(updates);
    });
    latestGraph().draw.mockImplementation(() => {
      frameCalls.push('draw:start');
      return Promise.resolve().then(() => {
        drawResolved = true;
        frameCalls.push('draw:resolved');
      });
    });
    latestGraph().fitView.mockImplementation(() => {
      frameCalls.push('fit-view:start');
      return Promise.resolve().then(() => frameCalls.push('fit-view:resolved'));
    });
    const updateNodes = latestGraph().updateNodeData.getMockImplementation();
    latestGraph().updateNodeData.mockImplementation((updates: any[]) => {
      worldCoordinateUpdates += updates.filter((node) =>
        Number.isFinite(node.style?.x) || Number.isFinite(node.style?.y)).length;
      if (drawResolved) nodeUpdatesAfterDrawResolved += 1;
      return updateNodes?.(updates);
    });
    const storageSet = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'kg-world-layout-v3') frameCalls.push('save-layout');
      return storageSet.call(this, key, value);
    });

    await act(async () => resolveLayout());
    await frames.flush(16);
    await frames.flush(32);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    setItem.mockRestore();
    window.removeEventListener('kg-graph-debug', listener);

    expect(latestGraph().setOptions).toHaveBeenCalledWith({ padding: [56, 56, 56, 56] });
    expect(latestGraph().setOptions).toHaveBeenCalledWith({
      animation: false,
      node: { animation: false },
      edge: { animation: false },
    });
    expect(latestGraph().fitView).toHaveBeenCalledWith(
      { when: 'always', direction: 'both' },
      false,
    );
    expect(frameCalls).toEqual([
      'read-final-node-positions',
      'update-corridors',
      'draw:start',
      'draw:resolved',
      'fit-view:start',
      'fit-view:resolved',
      'publish:layout-settled',
      'save-layout',
    ]);
    expect(nodeUpdatesAfterDrawResolved).toBe(0);
    expect(worldCoordinateUpdates).toBe(0);
  });

  it('does not publish or save a settled WORLD frame when draw rejects', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    let resolveLayout!: () => void;
    graphMocks.state.layoutPromises.push(new Promise<void>((resolve) => { resolveLayout = resolve; }));
    const onLayoutSettled = vi.fn();
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    latestGraph().draw.mockRejectedValueOnce(new Error('draw failed'));
    localStorage.clear();

    await act(async () => resolveLayout());
    await frames.flush(16);
    await frames.flush(32);
    await act(async () => Promise.resolve());

    window.removeEventListener('kg-graph-debug', listener);
    expect(events.some((event) => event.detail.phase === 'layout-settled')).toBe(false);
    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(localStorage.getItem('kg-world-layout-v3')).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      '[KGGraphCanvas:world-frame]',
      expect.objectContaining({ message: 'draw failed' }),
    );
    consoleError.mockRestore();
  });

  it('abandons a stale WORLD commit after draw resolves without fitting, publishing, or saving', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((yes) => { resolve = yes; });
      return { promise, resolve };
    };
    const oldLayout = deferred();
    const newLayout = deferred();
    const oldCommitDraw = deferred();
    const newCommitDraw = deferred();
    graphMocks.state.layoutPromises.push(oldLayout.promise, newLayout.promise);
    const oldGraph = worldGraphWithNodeCount(82);
    const newGraph = worldGraphWithNodeCount(83);
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      graph: oldGraph,
      onLayoutSettled,
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    latestGraph().draw.mockImplementationOnce(() => oldCommitDraw.promise);

    await act(async () => oldLayout.resolve());
    await frames.flush(16);
    await frames.flush(32);
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);

    rerender(<KGGraphCanvas {...canvasProps({
      graph: newGraph,
      onLayoutSettled,
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(2));
    latestGraph().draw.mockImplementationOnce(() => newCommitDraw.promise);
    latestGraph().fitView.mockClear();
    localStorage.clear();
    events.length = 0;

    await act(async () => oldCommitDraw.resolve());
    expect(latestGraph().fitView).not.toHaveBeenCalled();
    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(events.some((event) => event.detail.phase === 'layout-settled')).toBe(false);
    expect(localStorage.getItem('kg-world-layout-v3')).toBeNull();

    await act(async () => newLayout.resolve());
    await frames.flush(48);
    await frames.flush(64);
    await act(async () => newCommitDraw.resolve());
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('invalidates a pending WORLD commit when same-signature presentation data calls setData', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((yes) => { resolve = yes; });
      return { promise, resolve };
    };
    const layout = deferred();
    const oldCommitDraw = deferred();
    const presentationDraw = deferred();
    const replacementDraw = deferred();
    const replacementFit = deferred();
    graphMocks.state.layoutPromises.push(layout.promise);
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();
    const ref = createRef<KGGraphCanvasHandle>();
    const { rerender } = render(<KGGraphCanvas ref={ref} {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    latestGraph().draw.mockImplementationOnce(() => oldCommitDraw.promise);

    await act(async () => layout.resolve());
    await frames.flush(16);
    await frames.flush(32);
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);
    latestGraph().fitView.mockClear();
    localStorage.clear();
    events.length = 0;
    latestGraph().draw.mockImplementationOnce(() => presentationDraw.promise);

    rerender(<KGGraphCanvas ref={ref} {...canvasProps({
      onLayoutSettled,
      selectedEdgeID: 'Concept:list|uses|Concept:index',
    })} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalledTimes(2));
    latestGraph().fitView.mockImplementationOnce(() => replacementFit.promise);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await act(async () => oldCommitDraw.resolve());

    expect(latestGraph().fitView).not.toHaveBeenCalled();
    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(events.some((event) => event.detail.phase === 'layout-settled')).toBe(false);
    expect(localStorage.getItem('kg-world-layout-v3')).toBeNull();
    let waiterCompleted = false;
    const waiter = ref.current!.fitView(64, 0).then(() => { waiterCompleted = true; });
    await act(async () => Promise.resolve());
    expect(waiterCompleted).toBe(false);
    expect(latestGraph().fitView).not.toHaveBeenCalled();

    await frames.flush(48);
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.detail.phase === 'presentation')).toBe(false);
    expect(latestGraph().fitView).not.toHaveBeenCalled();
    expect(waiterCompleted).toBe(false);

    await act(async () => presentationDraw.resolve());
    await waitFor(() => expect(events.some((event) => event.detail.phase === 'presentation')).toBe(true));
    const drawsBeforeReplacement = latestGraph().draw.mock.calls.length;
    latestGraph().draw.mockImplementationOnce(() => replacementDraw.promise);
    events.length = 0;
    await frames.flush(64);
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalledTimes(drawsBeforeReplacement + 1));
    expect(latestGraph().fitView).not.toHaveBeenCalled();
    expect(waiterCompleted).toBe(false);

    await act(async () => replacementDraw.resolve());
    await waitFor(() => expect(latestGraph().fitView).toHaveBeenCalledTimes(1));
    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(waiterCompleted).toBe(false);

    await act(async () => replacementFit.resolve());
    await waiter;
    expect(waiterCompleted).toBe(true);
    expect(latestGraph().fitView).toHaveBeenCalledTimes(2);
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.detail.phase === 'layout-settled')).toHaveLength(1);
    expect(setItem.mock.calls.filter(([key]) => key === 'kg-world-layout-v3')).toHaveLength(1);
    expect(localStorage.getItem('kg-world-layout-v3')).not.toBeNull();
    setItem.mockRestore();
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('invalidates a pending WORLD commit at drag event time before the drag RAF runs', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((yes) => { resolve = yes; });
      return { promise, resolve };
    };
    const layout = deferred();
    const oldCommitDraw = deferred();
    const dragDraw = deferred();
    const replacementDraw = deferred();
    const replacementFit = deferred();
    graphMocks.state.layoutPromises.push(layout.promise);
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();
    const ref = createRef<KGGraphCanvasHandle>();
    render(<KGGraphCanvas ref={ref} {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    latestGraph().draw.mockImplementationOnce(() => oldCommitDraw.promise);

    await act(async () => layout.resolve());
    await frames.flush(16);
    await frames.flush(32);
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);
    latestGraph().fitView.mockClear();
    localStorage.clear();
    events.length = 0;

    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'node:drag',
    )?.[1]?.({});
    expect(frames.pending()).toBeGreaterThanOrEqual(1);
    latestGraph().draw
      .mockImplementationOnce(() => dragDraw.promise)
      .mockImplementationOnce(() => replacementDraw.promise);
    latestGraph().fitView.mockImplementationOnce(() => replacementFit.promise);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => oldCommitDraw.resolve());

    expect(latestGraph().fitView).not.toHaveBeenCalled();
    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(events.some((event) => event.detail.phase === 'layout-settled')).toBe(false);
    expect(localStorage.getItem('kg-world-layout-v3')).toBeNull();
    let waiterCompleted = false;
    const waiter = ref.current!.fitView(64, 0).then(() => { waiterCompleted = true; });
    await act(async () => Promise.resolve());
    expect(waiterCompleted).toBe(false);

    await frames.flush(48);
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
    expect(latestGraph().fitView).not.toHaveBeenCalled();
    expect(waiterCompleted).toBe(false);

    await act(async () => dragDraw.resolve());
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
    await frames.flush(64);
    expect(latestGraph().draw).toHaveBeenCalledTimes(3);
    expect(latestGraph().fitView).not.toHaveBeenCalled();

    await act(async () => replacementDraw.resolve());
    await waitFor(() => expect(latestGraph().fitView).toHaveBeenCalledTimes(1));
    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(waiterCompleted).toBe(false);

    await act(async () => replacementFit.resolve());
    await waiter;
    expect(waiterCompleted).toBe(true);
    expect(latestGraph().fitView).toHaveBeenCalledTimes(2);
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.detail.phase === 'layout-settled')).toHaveLength(1);
    expect(setItem.mock.calls.filter(([key]) => key === 'kg-world-layout-v3')).toHaveLength(1);
    expect(localStorage.getItem('kg-world-layout-v3')).not.toBeNull();
    setItem.mockRestore();
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('refuses a returning-WORLD publish when any of 83 coordinates changes after draw resolves', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((yes) => { resolve = yes; });
      return { promise, resolve };
    };
    const layout = deferred();
    const draw = deferred();
    const fit = deferred();
    const worldGraph = worldGraphWithNodeCount(83);
    const categoryGraph = { ...worldGraph, nodes: worldGraph.nodes.slice(0, 1) };
    const positions = new Map(worldGraph.nodes.map((node, index) => [
      node.id,
      [80 + (index % 12) * 48, 72 + Math.floor(index / 12) * 52] as [number, number],
    ]));
    let drawResolved = false;
    const readsAfterDraw = new Set<string>();
    const onLayoutSettled = vi.fn();
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      graph: categoryGraph,
      onLayoutSettled,
      viewState: 'CATEGORY_FOCUS',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    await frames.flush(16);
    await frames.flush(32);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    onLayoutSettled.mockClear();
    events.length = 0;
    latestGraph().getElementPosition.mockImplementation((id: string) => {
      if (drawResolved) readsAfterDraw.add(id);
      return positions.get(id) ?? [0, 0];
    });
    graphMocks.state.layoutPromises.push(layout.promise);
    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      graph: worldGraph,
      onLayoutSettled,
      viewState: 'RETURNING_TO_WORLD',
    })} />);
    await frames.flush(48);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(2));
    latestGraph().draw.mockImplementationOnce(() => draw.promise);
    latestGraph().fitView.mockImplementationOnce(() => fit.promise);

    await act(async () => layout.resolve());
    await frames.flush(64);
    await frames.flush(80);
    rerender(<KGGraphCanvas {...canvasProps({
      graph: worldGraph,
      onLayoutSettled,
      viewState: 'WORLD',
    })} />);
    drawResolved = true;
    await act(async () => draw.resolve());
    expect(readsAfterDraw.size).toBe(83);
    positions.set(worldGraph.nodes[0].id, [999, 999]);
    await act(async () => fit.resolve());

    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(events.some((event) => event.detail.phase === 'layout-settled')).toBe(false);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('does not count a frame as stable while any layout node position is non-finite', async () => {
    const frames = controlAnimationFrames();
    const onLayoutSettled = vi.fn();
    render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));

    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: Number.NaN, y: 80 } },
      { id: 'Concept:index', style: { x: 320, y: 240 } },
    ]);
    await frames.flush(16);
    await frames.flush(32);
    await frames.flush(48);
    expect(onLayoutSettled).not.toHaveBeenCalled();

    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:index', style: { x: 320, y: 240 } },
      { id: 'Concept:list', style: { x: 120, y: 80 } },
    ]);
    await frames.flush(64);
    await frames.flush(80);
    await frames.flush(96);
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);
  });

  it('cancels an obsolete position-stability watcher when a newer layout run starts', async () => {
    const frames = controlAnimationFrames();
    const onLayoutSettled = vi.fn();
    const { rerender } = render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    const obsoleteFrameID = frames.request.mock.results.at(-1)?.value;

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      onLayoutSettled,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(2));

    expect(frames.cancel).toHaveBeenCalledWith(obsoleteFrameID);
    await frames.flush(16);
    await frames.flush(32);
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('kg-category-layout-v2:collections-and-access')).toContain('Concept:list');
  });

  it('cancels the pending position-stability animation frame on unmount', async () => {
    const frames = controlAnimationFrames();
    const onLayoutSettled = vi.fn();
    const { unmount } = render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    const pendingFrameID = frames.request.mock.results.at(-1)?.value;

    unmount();

    expect(frames.cancel).toHaveBeenCalledWith(pendingFrameID);
    expect(frames.pending()).toBe(0);
    await frames.flush(16);
    expect(onLayoutSettled).not.toHaveBeenCalled();
  });

  it('uses setData and draw without constructing or rendering again when data changes', async () => {
    const { rerender } = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const nextGraph = { ...graph, edges: [] };
    rerender(<KGGraphCanvas {...canvasProps({ graph: nextGraph })} />);

    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);
    expect(latestGraph().render).toHaveBeenCalledTimes(1);
    expect(graphMocks.Graph).toHaveBeenCalledTimes(1);
  });

  it('explicitly restores world node opacity after a transient category fade', async () => {
    const fadedGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        style: { ...node.style, opacity: 0 },
      })),
    };
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      graph: fadedGraph,
      viewState: 'ENTERING_CATEGORY',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    rerender(<KGGraphCanvas {...canvasProps({ graph, viewState: 'WORLD' })} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));

    const worldNodes = (latestGraph().setData.mock.calls.at(-1)?.[0] as {
      nodes: Array<{ style: { opacity?: number } }>;
    }).nodes;
    expect(worldNodes.every((node) => node.style.opacity === 1)).toBe(true);
  });

  it('refreshes Canvas data without leaking detail role or selection presentation into WORLD', async () => {
    const { rerender } = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    rerender(
      <KGGraphCanvas
        {...canvasProps({
          roleByNodeID: new Map([['Concept:index', 'downstream' as const]]),
          selectedNodeID: 'Concept:index',
        })}
      />,
    );

    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
    expect(latestGraph().render).toHaveBeenCalledTimes(1);
    const updatedData = latestGraph().setData.mock.calls[1][0] as {
      nodes: Array<{ id: string; states?: string[] }>;
    };
    expect(updatedData.nodes.find((node) => node.id === 'Concept:index')?.states).toEqual([]);
    expect(updatedData.nodes.find((node) => node.id === 'Concept:list')?.states).toEqual([]);
  });

  it('configures one global force policy and renders no category surface or title', async () => {
    const view = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const option = graphOption();
    expect(option.zoomRange).toEqual([0.35, 4]);
    expect(option.behaviors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'zoom-canvas' }),
        expect.objectContaining({ type: 'drag-canvas' }),
        expect.objectContaining({
          type: 'drag-element',
          animation: false,
          dropEffect: 'none',
        }),
      ]),
    );
    expect(latestLayout()).toEqual(
      expect.objectContaining({
        type: 'd3-force',
        animation: false,
        enableWorker: false,
        iterations: 180,
        linkDistance: expect.any(Function),
        edgeStrength: expect.any(Function),
        nodeStrength: -82,
        alpha: 1,
        alphaDecay: 0.028,
        alphaMin: 0.015,
        randomSource: expect.any(Function),
      }),
    );
    const edgeStrength = latestLayout().edgeStrength as (datum: unknown) => number;
    const linkDistance = latestLayout().linkDistance as (datum: unknown) => number;
    expect(edgeStrength({ _original: graph.edges[0] })).toBe(0.22);
    expect(edgeStrength({ _original: graph.edges[1] })).toBe(0.075);
    expect(linkDistance({ _original: graph.edges[0] })).toBe(64);
    expect(linkDistance({ _original: graph.edges[1] })).toBe(104);
    expect(option.plugins).toEqual([
      expect.objectContaining({ type: 'tooltip', key: 'kg-node-tooltip', trigger: 'hover' }),
    ]);
    expect(option.plugins).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'edge-bundling' })]),
    );

    const initialData = latestGraph().setData.mock.calls[0][0] as {
      edges: Array<Record<string, any>>;
      nodes: Array<{ id: string; style: { fill: string } }>;
    };
    const internalEdge = initialData.edges.find(
      (edge) => edge.id === 'Concept:list|uses|Concept:index',
    );
    const crossEdge = initialData.edges.find(
      (edge) => edge.id === 'Concept:list|crosses|Concept:index',
    );
    expect(internalEdge).toEqual(
      expect.objectContaining({ type: 'line', style: expect.not.objectContaining({ bundleStrength: 0.18 }) }),
    );
    expect(internalEdge.data).not.toHaveProperty('bundleStrength');
    expect(crossEdge).toEqual(
      expect.objectContaining({
        type: 'polyline',
        data: expect.objectContaining({ bundleStrength: 0.18 }),
        style: expect.objectContaining({
          bundleStrength: 0.18,
          controlPoints: expect.any(Array),
        }),
      }),
    );
    expect(view.queryByTestId('category-shape-collections-and-access')).not.toBeInTheDocument();
    expect(view.queryByLabelText('Knowledge categories')).not.toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain(categories[0].surface_color);
    expect(view.container.innerHTML).not.toContain(categories[1].surface_color);
    const worldNodes = initialData.nodes;
    expect(worldNodes.find((node) => node.id === 'Concept:list')?.style.fill).toBe(categories[0].color);
    expect(worldNodes.find((node) => node.id === 'Concept:index')?.style.fill).toBe(categories[0].color);
  });

  it('never creates a canvas category hit target', async () => {
    const onCategoryClick = vi.fn();
    const view = render(
      <KGGraphCanvas {...canvasProps({ onCategoryClick })} />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    expect(view.queryByTestId('category-shape-collections-and-access')).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: /集合与访问域.*Collections and access/ })).not.toBeInTheDocument();
    expect(onCategoryClick).not.toHaveBeenCalled();
    expect(kgWorldCSS).not.toMatch(/\.kg-category-overlay path\s*\{/);
  });

  it('builds a safe node-only hover tooltip with label, node ID, category, and degree', async () => {
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const tooltip = graphOption().plugins.find((plugin) => plugin.type === 'tooltip')!;
    expect(tooltip.style).toEqual({ '.tooltip': { transition: 'none' } });
    expect(tooltip.enable({}, [{ data: { isBoundaryPort: true } }])).toBe(false);
    expect(tooltip.enable({}, [{ data: graph.edges[0].data }])).toBe(false);
    expect(tooltip.enable({}, [{ data: graph.nodes[0].data }])).toBe(true);
    const content = await tooltip.getContent({}, [{ id: graph.nodes[0].id, data: graph.nodes[0].data }]);
    expect(content).toBeInstanceOf(HTMLElement);
    expect(content).toHaveClass('kg-node-tooltip');
    expect(content).toHaveTextContent('Label: 列表');
    expect(content).toHaveTextContent('Node ID: Concept:list');
    expect(content).toHaveTextContent('Category: 集合与访问域');
    expect(content).toHaveTextContent('Degree: 1');
  });

  it('seeds every real node with deterministic finite coordinates before the first Canvas draw', async () => {
    const first = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalled());
    const firstNodes = (latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; style: { x?: number; y?: number } }>;
    }).nodes;
    expect(firstNodes).toHaveLength(graph.nodes.length);
    for (const node of firstNodes) {
      expect(Number.isFinite(node.style.x)).toBe(true);
      expect(Number.isFinite(node.style.y)).toBe(true);
    }
    const firstPositions = Object.fromEntries(firstNodes.map((node) => [
      node.id,
      { x: node.style.x, y: node.style.y },
    ]));
    first.unmount();
    localStorage.removeItem('kg-world-layout-v3');

    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalled());
    const secondNodes = (latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; style: { x?: number; y?: number } }>;
    }).nodes;
    expect(Object.fromEntries(secondNodes.map((node) => [
      node.id,
      { x: node.style.x, y: node.style.y },
    ]))).toEqual(firstPositions);
  });

  it('ignores old caches, defers complete finite v3 geometry, and rejects invalid v3 atomically', async () => {
    localStorage.setItem('kg-world-layout-v1', JSON.stringify({
      version: 'overview-v1',
      positions: {
        'Concept:list': { x: 9999, y: -9999 },
        'Concept:index': { x: 9999, y: -9999 },
      },
    }));
    const first = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalled());
    const v1Ignored = latestGraph().setData.mock.calls[0][0].nodes as Array<{
      id: string;
      style: { x: number; y: number };
    }>;
    expect(v1Ignored.every((node) => node.style.x !== 9999 && node.style.y !== -9999)).toBe(true);
    first.unmount();

    const legalPositions = {
      'Concept:list': { x: 210, y: 170, categoryID: categories[0].id },
      'Concept:index': { x: 275, y: 205, categoryID: categories[0].id },
    };
    localStorage.setItem('kg-world-layout-v2', JSON.stringify({
      dataVersion: 'overview-v1',
      viewportBucket: '1000x600',
      positions: legalPositions,
    }));
    const second = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalled());
    const v2Ignored = latestGraph().setData.mock.calls[0][0].nodes as Array<{
      id: string;
      style: { x: number; y: number };
    }>;
    expect(v2Ignored.find((node) => node.id === 'Concept:list')?.style).not.toEqual(
      expect.objectContaining({ x: 210, y: 170 }),
    );
    second.unmount();

    localStorage.setItem('kg-world-layout-v3', JSON.stringify({
      dataVersion: 'overview-v1',
      layoutAlgorithm: 'global-force-v1',
      viewportBucket: '1000x600',
      positions: legalPositions,
    }));
    const third = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalled());
    const structurallyAccepted = latestGraph().setData.mock.calls[0][0].nodes as Array<{
      id: string;
      style: { x: number; y: number };
    }>;
    expect(structurallyAccepted.find((node) => node.id === 'Concept:list')?.style).toEqual(
      expect.objectContaining({ x: 210, y: 170 }),
    );
    expect(localStorage.getItem('kg-world-layout-v3')).not.toBeNull();
    third.unmount();

    localStorage.setItem('kg-world-layout-v3', JSON.stringify({
      dataVersion: 'overview-v1',
      layoutAlgorithm: 'global-force-v1',
      viewportBucket: '1000x600',
      positions: {
        'Concept:list': { x: 9999, y: -9999, categoryID: categories[0].id },
      },
    }));
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalled());
    expect(localStorage.getItem('kg-world-layout-v3')).toBeNull();
  });

  it('restores a structurally valid WORLD cache only after real fitted screen geometry passes', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const worldGraph = worldGraphWithNodeCount(83);
    installWorldCache(worldGraph);
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();

    render(<KGGraphCanvas {...canvasProps({ graph: worldGraph, onLayoutSettled })} />);
    await act(async () => Promise.resolve());
    latestGraph().getElementRenderStyle.mockImplementation((id: string) =>
      latestGraph().getNodeData().find((node: { id: string }) => node.id === id)?.style ?? {});
    latestGraph().getElementPosition.mockImplementation((id: string) => {
      const style = latestGraph().getNodeData().find(
        (node: { id: string }) => node.id === id,
      )?.style;
      return [style?.x ?? Number.NaN, style?.y ?? Number.NaN];
    });
    latestGraph().getClientByCanvas.mockImplementation(([x, y]: [number, number]) => [x, y]);

    await frames.flush(16);
    await frames.flush(32);
    await frames.flush(48);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    window.removeEventListener('kg-graph-debug', listener);

    expect(latestGraph().layout).not.toHaveBeenCalled();
    expect(events.filter((event) => event.detail.phase === 'layout-settled')).toHaveLength(1);
    expect(events.find((event) => event.detail.phase === 'layout-settled')?.detail.layoutSource)
      .toBe('cache');
    expect(localStorage.getItem('kg-world-layout-v3')).not.toBeNull();
  });

  it('invalidates a near-threshold WORLD cache after the real fit and publishes only its force replacement', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const worldGraph = worldGraphWithNodeCount(83);
    const forcePositions = Object.fromEntries(Object.entries(
      acceptedWorldCachePositions(worldGraph),
    ).map(([id, position]) => [id, { ...position, x: position.x + 6, y: position.y + 3 }]));
    installWorldCache(worldGraph);
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const onLayoutSettled = vi.fn();
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    let cacheProjection = true;

    try {
      render(<KGGraphCanvas {...canvasProps({ graph: worldGraph, onLayoutSettled })} />);
      await act(async () => Promise.resolve());
      latestGraph().getElementRenderStyle.mockImplementation((id: string) =>
        latestGraph().getNodeData().find((node: { id: string }) => node.id === id)?.style ?? {});
      latestGraph().getElementPosition.mockImplementation((id: string) => {
        const style = latestGraph().getNodeData().find(
          (node: { id: string }) => node.id === id,
        )?.style;
        return [style?.x ?? Number.NaN, style?.y ?? Number.NaN];
      });
      latestGraph().getClientByCanvas.mockImplementation(([x, y]: [number, number]) => [
        cacheProjection ? 500 + (x - 500) * 0.99 : x,
        y,
      ]);
      latestGraph().layout.mockImplementation(() => {
        cacheProjection = false;
        latestGraph().updateNodeData(Object.entries(forcePositions).map(([id, position]) => ({
          id,
          style: { x: position.x, y: position.y },
        })));
        return Promise.resolve();
      });

      for (let index = 1; index <= 10; index += 1) await frames.flush(index * 16);
      await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));

      const settled = events.filter((event) => event.detail.phase === 'layout-settled');
      expect(settled).toHaveLength(1);
      expect(settled[0].detail.layoutSource).toBe('force');
      expect(latestGraph().layout).toHaveBeenCalledTimes(1);
      expect(latestGraph().setData).toHaveBeenCalledTimes(2);
      expect(removeItem).toHaveBeenCalledWith('kg-world-layout-v3');
      const worldSaves = setItem.mock.calls.filter(([key]) => key === 'kg-world-layout-v3');
      expect(worldSaves).toHaveLength(1);
      expect(JSON.parse(String(worldSaves[0][1])).positions[worldGraph.nodes[0].id]).toEqual(
        forcePositions[worldGraph.nodes[0].id],
      );
      expect(localStorage.getItem('kg-world-layout-v3')).not.toBeNull();
    } finally {
      window.removeEventListener('kg-graph-debug', listener);
      removeItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('never reads or writes the WORLD cache while rendering category focus', async () => {
    const storageGet = Storage.prototype.getItem;
    const storageSet = Storage.prototype.setItem;
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(
      this: Storage,
      key: string,
    ) {
      return storageGet.call(this, key);
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(
      this: Storage,
      key: string,
      value: string,
    ) {
      return storageSet.call(this, key, value);
    });
    const onLayoutSettled = vi.fn();

    try {
      render(<KGGraphCanvas {...canvasProps({
        activeCategoryID: categories[0].id,
        graph: { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] },
        onLayoutSettled,
        viewState: 'CATEGORY_FOCUS',
      })} />);
      await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
      latestGraph().on.mock.calls.find(
        ([event]) => event === 'node:dragend',
      )?.[1]?.({ target: { id: 'Concept:list' } });

      expect(getItem.mock.calls.some(([key]) => key === 'kg-world-layout-v3')).toBe(false);
      expect(setItem.mock.calls.some(([key]) => key === 'kg-world-layout-v3')).toBe(false);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('does not project a dragged world node into a category boundary', async () => {
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().getElementRenderStyle.mockReturnValue({ x: 9999, y: -9999 });
    latestGraph().updateNodeData.mockClear();
    const drag = latestGraph().on.mock.calls.find(([event]) => event === 'node:drag')?.[1];

    drag?.({ target: { id: 'Concept:list' } });

    expect(latestGraph().updateNodeData).not.toHaveBeenCalled();
  });

  it('evaluates world forces from real G6 layout datums in current canvas pixels', async () => {
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const layout = latestLayout() as {
      collide: { radius: (datum: { _original: KGWorldGraph['nodes'][number] }) => number };
      x: { x: (datum: { _original: KGWorldGraph['nodes'][number] }) => number };
      y: { y: (datum: { _original: KGWorldGraph['nodes'][number] }) => number };
    };
    const realDatum = { _original: graph.nodes[0] };

    expect(layout.x.x(realDatum)).toBeCloseTo(269.12);
    expect(layout.y.y(realDatum)).toBeCloseTo(202.4);
    expect(layout.collide.radius(realDatum)).toBe(13);
  });

  it('reapplies normalized world corridors to the Canvas once after adapter render and layout', async () => {
    const onLayoutSettled = vi.fn();
    const { rerender } = render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));

    const expectedControlPoints = [
      [138, 94.39999999999999],
      [302, 225.59999999999997],
    ];
    const currentEdges = () => latestGraph().getEdgeData() as Array<Record<string, any>>;
    const canvasEdges = () => latestGraph().getCanvasData().edges as Array<Record<string, any>>;
    const currentCross = () => currentEdges().find(
      (edge) => edge.id === 'Concept:list|crosses|Concept:index',
    );
    const expectPersistedWorldCorridor = () => {
      expect(currentCross()).toEqual(expect.objectContaining({
        type: 'polyline',
        data: expect.objectContaining({ bundleStrength: 0.18 }),
        style: expect.objectContaining({
          bundleStrength: 0.18,
          controlPoints: [
            [expect.any(Number), expect.any(Number)],
            [expect.any(Number), expect.any(Number)],
          ],
        }),
      }));
      expect(currentEdges().find(
        (edge) => edge.id === 'Concept:list|uses|Concept:index',
      )).toEqual(expect.objectContaining({
        type: 'line',
        style: expect.not.objectContaining({ controlPoints: expect.anything() }),
      }));
    };

    expectPersistedWorldCorridor();
    expect(canvasEdges().find(
      (edge) => edge.id === 'Concept:list|crosses|Concept:index',
    )?.style.controlPoints).toEqual(expectedControlPoints);
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);
    latestGraph().getElementPosition.mockImplementation((id: string) => {
      const node = (latestGraph().getNodeData() as Array<Record<string, any>>)
        .find((candidate) => candidate.id === id);
      return [node?.style.x ?? 0, node?.style.y ?? 0];
    });

    rerender(<KGGraphCanvas {...canvasProps({ onLayoutSettled, selectedNodeID: 'Concept:index' })} />);
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalledTimes(2));
    expectPersistedWorldCorridor();
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);

    rerender(<KGGraphCanvas {...canvasProps({
      graph: { ...graph, nodes: [...graph.nodes] },
      onLayoutSettled,
    })} />);
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalledTimes(5));
    expectPersistedWorldCorridor();
    expect(latestGraph().draw).toHaveBeenCalledTimes(5);
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);
    expect(latestGraph().layout).toHaveBeenCalledTimes(1);

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      onLayoutSettled,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(2));
    expect(latestGraph().draw).toHaveBeenCalledTimes(7);
    expect(latestGraph().layout).toHaveBeenCalledTimes(2);
    expect(currentEdges().every(
      (edge) => edge.type === 'line' && edge.style.controlPoints === undefined,
    )).toBe(true);
  });

  it('uses the detail layout values and does not configure edge bundling in detail', async () => {
    render(
      <KGGraphCanvas
        {...canvasProps({ activeCategoryID: 'collections-and-access', viewState: 'CATEGORY_DETAIL' })}
      />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    expect(latestLayout()).toEqual(
      expect.objectContaining({
        type: 'd3-force',
        animation: false,
        enableWorker: false,
        iterations: 72,
        linkDistance: 96,
        edgeStrength: 0.28,
        nodeStrength: -220,
        alpha: 0.8,
        alphaDecay: 0.045,
        alphaMin: 0.03,
        randomSource: expect.any(Function),
      }),
    );
    expect(graphOption().plugins).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'edge-bundling' })]),
    );
    const detailData = latestGraph().setData.mock.calls[0][0] as {
      edges: Array<Record<string, any>>;
    };
    expect(detailData.edges.every((edge) => edge.type === 'line')).toBe(true);
    expect(
      detailData.edges.every(
        (edge) => edge.data.bundleStrength === undefined && edge.style.bundleStrength === undefined,
      ),
    ).toBe(true);
  });

  it('keeps focus animation out of CSS metadata and uses a static focus under reduced motion', async () => {
    const roles = new Map([
      ['Concept:list', 'current' as const],
      ['Concept:index', 'current' as const],
    ]);
    const { rerender } = render(
      <KGGraphCanvas
        {...canvasProps({
          activeCategoryID: categories[0].id,
          focusNodeID: 'Concept:index',
          roleByNodeID: roles,
          viewState: 'CATEGORY_DETAIL',
        })}
      />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const initialNodes = (latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; style: Record<string, unknown> }>;
    }).nodes;
    expect(initialNodes.find((node) => node.id === 'Concept:index')?.style).not.toHaveProperty('className');
    expect(initialNodes.find((node) => node.id === 'Concept:index')?.style).toEqual(
      expect.objectContaining({ shadowBlur: 10, shadowColor: 'rgba(242,140,40,0.42)' }),
    );
    expect(initialNodes.find((node) => node.id === 'Concept:list')?.style).toEqual(
      expect.objectContaining({
        size: 36,
        shadowBlur: 10,
        shadowColor: 'rgba(242,140,40,0.28)',
      }),
    );

    rerender(
      <KGGraphCanvas
        {...canvasProps({
          activeCategoryID: categories[0].id,
          focusNodeID: 'Concept:index',
          reducedMotion: true,
          roleByNodeID: roles,
          viewState: 'CATEGORY_DETAIL',
        })}
      />,
    );
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));
    const reducedNodes = (latestGraph().setData.mock.calls[1][0] as {
      nodes: Array<{ id: string; style: Record<string, unknown> }>;
    }).nodes;
    expect(reducedNodes.find((node) => node.id === 'Concept:index')?.style).toEqual(
      expect.objectContaining({
        size: 36,
        shadowBlur: 16,
        shadowColor: 'rgba(242,140,40,0.22)',
      }),
    );
  });

  it('drives the sole detail focus breathing through G6 node updates and cancels it immediately', async () => {
    vi.useFakeTimers();
    const roles = new Map([
      ['Concept:list', 'current' as const],
      ['Concept:index', 'current' as const],
    ]);
    const { rerender, unmount } = render(
      <KGGraphCanvas
        {...canvasProps({
          activeCategoryID: categories[0].id,
          focusNodeID: 'Concept:list',
          roleByNodeID: roles,
          viewState: 'CATEGORY_DETAIL',
        })}
      />,
    );

    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(800));
    expect(latestGraph().updateNodeData).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'Concept:list',
        style: expect.objectContaining({
          size: 40,
          shadowBlur: 22,
          shadowColor: 'rgba(242,140,40,0.08)',
        }),
      }),
    ]);
    act(() => vi.advanceTimersByTime(800));
    expect(latestGraph().updateNodeData).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'Concept:list',
        style: expect.objectContaining({
          size: 36,
          shadowBlur: 10,
          shadowColor: 'rgba(242,140,40,0.42)',
        }),
      }),
    ]);

    rerender(
      <KGGraphCanvas
        {...canvasProps({
          activeCategoryID: categories[0].id,
          focusNodeID: 'Concept:index',
          roleByNodeID: roles,
          viewState: 'CATEGORY_DETAIL',
        })}
      />,
    );
    expect(latestGraph().context.animation.stop).toHaveBeenCalled();
    expect(latestGraph().updateNodeData).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'Concept:list',
        style: expect.objectContaining({ size: 36, shadowBlur: 10 }),
      }),
    ]);

    rerender(
      <KGGraphCanvas
        {...canvasProps({
          activeCategoryID: categories[0].id,
          focusNodeID: 'Concept:index',
          reducedMotion: true,
          roleByNodeID: roles,
          viewState: 'CATEGORY_DETAIL',
        })}
      />,
    );
    const reducedData = latestGraph().setData.mock.calls.at(-1)?.[0] as {
      nodes: Array<{ id: string; style: Record<string, unknown> }>;
    };
    expect(reducedData.nodes.find((node) => node.id === 'Concept:index')?.style).toEqual(
      expect.objectContaining({
        size: 36,
        shadowBlur: 16,
        shadowColor: 'rgba(242,140,40,0.22)',
      }),
    );
    const updatesBeforeUnmount = latestGraph().updateNodeData.mock.calls.length;
    unmount();
    act(() => vi.advanceTimersByTime(1600));
    expect(latestGraph().updateNodeData).toHaveBeenCalledTimes(updatesBeforeUnmount);
    vi.useRealTimers();
  });

  it('does not infer a breathing focus when the controller supplies no focus_node_ids[0]', async () => {
    vi.useFakeTimers();
    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      focusNodeID: undefined,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await act(async () => Promise.resolve());

    act(() => vi.advanceTimersByTime(1600));
    expect(latestGraph().updateNodeData).not.toHaveBeenCalledWith([
      expect.objectContaining({ style: expect.objectContaining({ size: 40 }) }),
    ]);
  });

  it('exposes commands without exposing the Graph instance', async () => {
    const ref = createRef<KGGraphCanvasHandle>();
    render(<KGGraphCanvas ref={ref} {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    await act(async () => {
      await ref.current!.fitView(72, 900);
      await ref.current!.fitView(64, 500, true);
      await ref.current!.focusCategory('collections-and-access', 800);
      await ref.current!.focusNode('Concept:list', 500);
    });

    expect(latestGraph().fitView).toHaveBeenCalledTimes(3);
    expect(latestGraph().setOptions).toHaveBeenCalledWith({ padding: [56, 56, 56, 56] });
    expect(latestGraph().fitView).toHaveBeenCalledWith(
      { when: 'always', direction: 'both' },
      { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    expect(latestGraph().fitView.mock.calls[2][1]).toBe(false);
    expect(latestGraph().setOptions).toHaveBeenCalledWith({ padding: [72, 304, 72, 432] });
    expect(latestGraph().zoomTo).toHaveBeenCalledWith(
      264 / 296,
      { duration: 400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    expect(latestGraph().focusElement).toHaveBeenCalledWith(
      ['Concept:list', 'Concept:index'],
      { duration: 400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    expect(latestGraph().focusElement).toHaveBeenCalledWith(
      'Concept:list',
      { duration: 500, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    expect(ref.current!.getZoom()).toBe(1.25);
    expect(Object.keys(ref.current!)).toEqual([
      'fitView',
      'resetLayout',
      'focusCategory',
      'focusNode',
      'getZoom',
      'destroy',
    ]);
  });

  it('keeps imperative WORLD fitView camera-only after settlement', async () => {
    const ref = createRef<KGGraphCanvasHandle>();
    const onLayoutSettled = vi.fn();
    render(<KGGraphCanvas ref={ref} {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    latestGraph().updateEdgeData.mockClear();
    latestGraph().updateNodeData.mockClear();
    latestGraph().draw.mockClear();
    latestGraph().setOptions.mockClear();

    await act(async () => {
      await ref.current!.fitView(64, 0);
    });

    expect(latestGraph().fitView).toHaveBeenCalledWith(
      { when: 'always', direction: 'both' },
      false,
    );
    expect(latestGraph().setOptions).toHaveBeenCalledWith({ padding: [56, 56, 56, 56] });
    expect(latestGraph().updateEdgeData).not.toHaveBeenCalled();
    expect(latestGraph().updateNodeData).not.toHaveBeenCalled();
    expect(latestGraph().draw).not.toHaveBeenCalled();
  });

  it('locks a selected detail node and its one-hop neighborhood, while double click fits that neighborhood', async () => {
    const onNodeClick = vi.fn();
    const isolated = {
      ...graph.nodes[0],
      id: 'Concept:isolated',
      data: { ...graph.nodes[0].data, node_id: 'Concept:isolated' },
    };
    const neighborhoodGraph = { ...graph, nodes: [...graph.nodes, isolated] };
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      graph: neighborhoodGraph,
      onNodeClick,
      selectedNodeID: undefined,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      graph: neighborhoodGraph,
      onNodeClick,
      selectedNodeID: 'Concept:list',
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));
    const data = latestGraph().setData.mock.calls[1][0] as {
      nodes: Array<{ id: string; style: { opacity?: number } }>;
      edges: Array<{ id: string; style: { opacity: number } }>;
    };
    expect(data.nodes.find((node) => node.id === 'Concept:list')?.style.opacity).toBe(1);
    expect(data.nodes.find((node) => node.id === 'Concept:index')?.style.opacity).toBe(1);
    expect(data.nodes.find((node) => node.id === 'Concept:isolated')?.style.opacity).toBe(0.14);
    expect(data.edges.every((edge) => edge.style.opacity === 0.9)).toBe(true);

    const doubleClick = latestGraph().on.mock.calls.find(
      ([event]) => event === 'node:dblclick',
    )?.[1];
    doubleClick?.({ target: { id: 'Concept:list' } });
    await waitFor(() => expect(latestGraph().zoomTo).toHaveBeenCalled());
    expect(latestGraph().setOptions).toHaveBeenCalledWith({ padding: [80, 80, 80, 80] });
    expect(latestGraph().focusElement).toHaveBeenCalledWith(
      ['Concept:list', 'Concept:index'],
      { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    await waitFor(() => expect(onNodeClick).toHaveBeenCalledWith('Concept:list'));
  });

  it('ignores a synthetic node double click immediately after drag while allowing a later deliberate double click', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));

    const dragEnd = latestGraph().on.mock.calls.find(
      ([event]) => event === 'node:dragend',
    )?.[1];
    const doubleClick = latestGraph().on.mock.calls.find(
      ([event]) => event === 'node:dblclick',
    )?.[1];
    latestGraph().zoomTo.mockClear();
    latestGraph().focusElement.mockClear();

    dragEnd?.({ target: { id: 'Concept:list' } });
    doubleClick?.({ target: { id: 'Concept:list' } });

    expect(latestGraph().zoomTo).not.toHaveBeenCalled();
    expect(latestGraph().focusElement).not.toHaveBeenCalled();

    now.mockReturnValue(1_501);
    doubleClick?.({ target: { id: 'Concept:list' } });

    await waitFor(() => expect(latestGraph().zoomTo).toHaveBeenCalledTimes(1));
    expect(latestGraph().focusElement).toHaveBeenCalledWith(
      ['Concept:list', 'Concept:index'],
      { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  });

  it('locks every Canvas interaction in transient states and restores it when stable', async () => {
    const callbacks = {
      onCanvasClick: vi.fn(),
      onEdgeClick: vi.fn(),
      onEscape: vi.fn(),
      onNodeClick: vi.fn(),
    };
    const { getByLabelText, queryByRole, queryByTestId, rerender } = render(
      <KGGraphCanvas
        {...canvasProps({ ...callbacks, viewState: 'WORLD' })}
        aria-label="Knowledge graph canvas"
      />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().setLayout.mockClear();

    rerender(
      <KGGraphCanvas
        {...canvasProps({ ...callbacks, activeCategoryID: categories[0].id, viewState: 'ENTERING_CATEGORY' })}
        aria-label="Knowledge graph canvas"
      />,
    );

    expect(queryByRole('button', { name: /集合与访问域.*Collections and access/ })).not.toBeInTheDocument();
    expect(latestGraph().setOptions).toHaveBeenCalledWith(expect.objectContaining({
      behaviors: [],
      node: expect.objectContaining({
        animation: expect.objectContaining({
          update: expect.arrayContaining([
            {
              fields: ['opacity'],
              duration: 400,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
          ]),
        }),
      }),
      edge: {
        animation: {
          update: [{
            fields: ['opacity'],
            duration: 400,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }],
        },
      },
    }));
    const listener = (eventName: string) => latestGraph().on.mock.calls
      .find(([registered]) => registered === eventName)?.[1] as (event: unknown) => void;
    listener('node:click')({ target: { id: 'Concept:list' } });
    listener('edge:click')({ target: { id: graph.edges[0].id } });
    listener('canvas:click')({});
    listener('node:dragstart')({});
    listener('node:drag')({});
    listener('node:dragend')({});
    fireEvent.keyDown(getByLabelText('Knowledge graph canvas'), { key: '+' });
    fireEvent.keyDown(getByLabelText('Knowledge graph canvas'), { key: 'ArrowLeft' });
    fireEvent.keyDown(getByLabelText('Knowledge graph canvas'), { key: '0' });
    fireEvent.keyDown(getByLabelText('Knowledge graph canvas'), { key: 'Escape' });

    expect(callbacks.onNodeClick).not.toHaveBeenCalled();
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
    expect(callbacks.onCanvasClick).not.toHaveBeenCalled();
    expect(callbacks.onEscape).not.toHaveBeenCalled();
    expect(latestGraph().zoomBy).not.toHaveBeenCalled();
    expect(latestGraph().translateBy).not.toHaveBeenCalled();
    expect(latestGraph().fitView).not.toHaveBeenCalled();
    expect(latestGraph().layout).toHaveBeenCalledTimes(1);

    latestGraph().setOptions.mockClear();
    rerender(
      <KGGraphCanvas
        {...canvasProps({ ...callbacks, activeCategoryID: categories[0].id, viewState: 'CATEGORY_FOCUS' })}
        aria-label="Knowledge graph canvas"
      />,
    );
    expect(queryByTestId('category-shape-collections-and-access')).not.toBeInTheDocument();
    expect(queryByRole('button', { name: /集合与访问域.*Collections and access/ })).not.toBeInTheDocument();
    expect(latestGraph().setOptions).toHaveBeenCalledWith(expect.objectContaining({
      behaviors: expect.arrayContaining([
        expect.objectContaining({ type: 'zoom-canvas' }),
        expect.objectContaining({ type: 'drag-canvas' }),
        expect.objectContaining({
          type: 'drag-element',
          animation: false,
          dropEffect: 'none',
        }),
      ]),
    }));
  });

  it('handles +, -, arrow, 0, and Escape keyboard commands', async () => {
    const onEscape = vi.fn();
    const { getByLabelText } = render(
      <KGGraphCanvas {...canvasProps({ onEscape })} aria-label="Knowledge graph canvas" />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const canvas = getByLabelText('Knowledge graph canvas');

    fireEvent.keyDown(canvas, { key: '+' });
    fireEvent.keyDown(canvas, { key: '-' });
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowUp' });
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    fireEvent.keyDown(canvas, { key: '0' });
    fireEvent.keyDown(canvas, { key: 'Escape' });

    await waitFor(() => expect(latestGraph().fitView).toHaveBeenCalledTimes(2));

    expect(latestGraph().zoomBy).toHaveBeenNthCalledWith(1, 1.1, false);
    expect(latestGraph().zoomBy).toHaveBeenNthCalledWith(2, 1 / 1.1, false);
    expect(latestGraph().translateBy).toHaveBeenNthCalledWith(1, [48, 0], false);
    expect(latestGraph().translateBy).toHaveBeenNthCalledWith(2, [-48, 0], false);
    expect(latestGraph().translateBy).toHaveBeenNthCalledWith(3, [0, 48], false);
    expect(latestGraph().translateBy).toHaveBeenNthCalledWith(4, [0, -48], false);
    expect(latestGraph().fitView).toHaveBeenCalledTimes(2);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('pairs every G6 event registration with cleanup without registering hull events', async () => {
    const onLayoutSettled = vi.fn();
    const { unmount } = render(
      <KGGraphCanvas {...canvasProps({ onLayoutSettled })} />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));

    const registered = latestGraph().on.mock.calls.map(([event]) => event);
    expect(registered).toEqual(
      expect.arrayContaining([
        'node:click',
        'edge:click',
        'canvas:click',
        'node:dragstart',
        'node:drag',
        'node:dragend',
        'aftertransform',
        'aftersizechange',
      ]),
    );
    expect(registered).not.toContain('afterlayout');
    expect(registered).not.toContain('hull:click');

    unmount();
    expect(latestGraph().off).toHaveBeenCalledTimes(latestGraph().on.mock.calls.length);
    for (const registration of latestGraph().on.mock.calls) {
      expect(latestGraph().off).toHaveBeenCalledWith(...registration);
    }
  });

  it('lets the G6 plugin own Canvas hover and hides synchronously when the pointer leaves the whole Canvas', async () => {
    const view = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    expect(latestGraph().on.mock.calls.map(([event]) => event)).not.toEqual(
      expect.arrayContaining([
        'canvas:pointermove',
        'canvas:pointerleave',
        'node:pointermove',
        'node:pointerover',
        'node:pointerout',
        'node:pointerleave',
      ]),
    );

    latestGraph().__tooltipPlugin.hide.mockClear();
    const tooltip = document.createElement('div');
    tooltip.style.visibility = 'visible';
    const tooltipContent = document.createElement('div');
    tooltipContent.className = 'kg-node-tooltip';
    tooltip.appendChild(tooltipContent);
    view.getByRole('application').appendChild(tooltip);
    fireEvent.pointerOut(view.getByRole('application'));
    expect(latestGraph().__tooltipPlugin.hide).toHaveBeenCalledTimes(1);
    expect(tooltip).toHaveStyle({ visibility: 'hidden' });
  });

  it('owns resize cleanup without creating category geometry or title hit targets', async () => {
    let resizeCallback!: ResizeObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    });
    const onCategoryClick = vi.fn();
    const view = render(
      <KGGraphCanvas {...canvasProps({ onCategoryClick })} />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const listener = (eventName: string) =>
      latestGraph().on.mock.calls.find(([event]) => event === eventName)?.[1];
    expect(view.queryByTestId('category-shape-collections-and-access')).not.toBeInTheDocument();
    expect(view.queryByRole('button', {
      name: /集合与访问域.*Collections and access/,
    })).not.toBeInTheDocument();
    listener('aftertransform')?.({});
    expect(onCategoryClick).not.toHaveBeenCalled();
    Object.defineProperties(view.getByRole('application'), {
      clientWidth: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 800 },
    });
    latestGraph().resize.mockClear();
    resizeCallback([], {} as ResizeObserver);
    await act(async () => Promise.resolve());
    expect(latestGraph().resize).toHaveBeenCalledWith(1200, 800);
    listener('aftersizechange')?.({});
    await act(async () => Promise.resolve());
    expect(latestGraph().resize).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalled();

    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('never creates a convex overlay for a two-node category', async () => {
    const view = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().on.mock.calls.find(([event]) => event === 'node:dragend')?.[1]?.({});
    expect(view.queryByTestId('category-shape-collections-and-access')).not.toBeInTheDocument();
  });

  it('emits node, edge, port, and Canvas callbacks without category Canvas callbacks', async () => {
    const callbacks = {
      onNodeClick: vi.fn(),
      onEdgeClick: vi.fn(),
      onCategoryClick: vi.fn(),
      onPortClick: vi.fn(),
      onCanvasClick: vi.fn(),
    };
    const port = {
      id: 'collections-and-access|functions-and-modules|outgoing',
      categoryID: 'collections-and-access',
      externalCategoryID: 'functions-and-modules',
      direction: 'outgoing' as const,
      label: '函数与模块域 · 1 →',
      relationCount: 1,
      relationKeys: ['Concept:list|crosses|Concept:index'],
      insideNodeIDs: ['Concept:list'],
      externalNodeIDs: ['Concept:index'],
    };
    render(
      <KGGraphCanvas {...canvasProps({ ...callbacks, ports: [port] })} />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();

    const listener = (eventName: string) =>
      latestGraph().on.mock.calls.find(([event]) => event === eventName)?.[1];
    listener('node:click')?.({ target: { id: 'Concept:list' } });
    expect(callbacks.onNodeClick).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(180));
    listener('node:click')?.({ target: { id: port.id } });
    listener('edge:click')?.({ target: { id: graph.edges[0].id } });
    listener('canvas:click')?.({ target: { attributes: {} } });

    expect(callbacks.onNodeClick).toHaveBeenCalledWith('Concept:list');
    expect(callbacks.onPortClick).toHaveBeenCalledWith(port.id);
    expect(callbacks.onEdgeClick).toHaveBeenCalledWith(graph.edges[0].id);
    expect(callbacks.onCategoryClick).not.toHaveBeenCalled();
    expect(callbacks.onCanvasClick).toHaveBeenCalledTimes(1);
    expect(kgWorldCSS).not.toContain('.kg-category-overlay');
    expect(kgWorldCSS).not.toContain('.kg-category-button');
    expect(kgWorldCSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?transition-duration:\s*0ms !important;/s,
    );
  });

  it('maps direct world anchors on resize and publishes only after the final geometry frame', async () => {
    let resizeCallback!: ResizeObserverCallback;
    vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    });
    const view = render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalledTimes(1));
    const container = view.getByRole('application');
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 800 },
    });
    latestGraph().setOptions.mockClear();
    latestGraph().updateEdgeData.mockClear();
    latestGraph().draw.mockClear();
    latestGraph().layout.mockClear();
    latestGraph().fitView.mockClear();

    resizeCallback([], {} as ResizeObserver);
    await act(async () => Promise.resolve());

    expect(latestGraph().setLayout).toHaveBeenCalledWith(expect.any(Object));
    const resizedLayout = latestGraph().setLayout.mock.calls.at(-1)?.[0] as {
      x: { x: (datum: { _original: KGWorldGraph['nodes'][number] }) => number };
      y: { y: (datum: { _original: KGWorldGraph['nodes'][number] }) => number };
    };
    expect(resizedLayout.x.x({ _original: graph.nodes[0] })).toBeCloseTo(317.12);
    expect(resizedLayout.y.y({ _original: graph.nodes[0] })).toBeCloseTo(262.4);
    expect(latestGraph().draw).toHaveBeenCalledTimes(1);
    expect(latestGraph().layout).toHaveBeenCalledTimes(1);
    expect(latestGraph().__canvas.render).toHaveBeenCalledTimes(0);
    await waitFor(() => expect(latestGraph().fitView).toHaveBeenCalledWith(
      { when: 'always', direction: 'both' },
      false,
    ));
    await waitFor(() => expect(latestGraph().draw).toHaveBeenCalledTimes(2));
    expect(latestGraph().fitView).toHaveBeenCalledTimes(1);
    for (const [updates] of latestGraph().updateEdgeData.mock.calls) {
      const resizedCorridor = updates.find(
        (edge: { id: string }) => edge.id === 'Concept:list|crosses|Concept:index',
      );
      expect(resizedCorridor?.style.controlPoints).toEqual([
        [138, 94.39999999999999],
        [302, 225.59999999999997],
      ]);
    }
    latestGraph().on.mock.calls.find(([event]) => event === 'aftersizechange')?.[1]?.({});
    await act(async () => Promise.resolve());
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
  });

  it('fixes detail ports to the anchor-facing boundary and emits one directed line stub per inside node', async () => {
    const detailCategories: KGCategory[] = [
      { ...categories[0], anchor: { x: 0.5, y: 0.5 } },
      { ...categories[1], id: 'z-right', anchor: { x: 0.9, y: 0.6 }, order: 9 },
      { ...categories[1], id: 'a-right', anchor: { x: 0.9, y: 0.4 }, order: 1 },
      { ...categories[1], id: 'top', anchor: { x: 0.5, y: 0.1 }, order: 2 },
    ];
    const ports = [
      {
        id: 'z-port', categoryID: categories[0].id, externalCategoryID: 'z-right',
        direction: 'outgoing' as const, label: 'Errors, Files and Classes · 4 →', relationCount: 2,
        relationKeys: ['z1', 'z2'], insideNodeIDs: ['Concept:index', 'Concept:list'], externalNodeIDs: ['z'],
      },
      {
        id: 'a-port', categoryID: categories[0].id, externalCategoryID: 'a-right',
        direction: 'incoming' as const, label: '← A · 1', relationCount: 1,
        relationKeys: ['a1'], insideNodeIDs: ['Concept:list'], externalNodeIDs: ['a'],
      },
      {
        id: 'top-port', categoryID: categories[0].id, externalCategoryID: 'top',
        direction: 'incoming' as const, label: '← Top · 1', relationCount: 1,
        relationKeys: ['t1'], insideNodeIDs: ['Concept:index'], externalNodeIDs: ['t'],
      },
    ];
    render(
      <KGGraphCanvas {...canvasProps({
        activeCategoryID: categories[0].id,
        categories: detailCategories,
        ports,
        viewState: 'CATEGORY_DETAIL',
      })} />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const data = latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; data: Record<string, unknown>; style: Record<string, unknown> }>;
      edges: Array<{ id: string; source: string; target: string; type: string; data: Record<string, unknown> }>;
    };
    const a = data.nodes.find((node) => node.id === 'a-port')!;
    const z = data.nodes.find((node) => node.id === 'z-port')!;
    const top = data.nodes.find((node) => node.id === 'top-port')!;
    expect([a, z, top].map((node) => node.style.size)).toEqual([
      z.style.size,
      z.style.size,
      z.style.size,
    ]);
    expect((z.style.size as [number, number])[0]).toBeGreaterThan(132);
    expect(z.style.labelText).toBe('Errors, Files and Classes · 4 →');
    expect([a, z, top].every((node) => node.style.labelWordWrap === undefined
      && node.style.labelWordWrapWidth === undefined
      && node.style.labelMaxLines === undefined
      && node.style.labelTextOverflow === undefined)).toBe(true);
    expect([a, z, top].every((node) => node.data.fixed === true)).toBe(true);
    expect((latestLayout().nodeFilter as (node: { data?: Record<string, unknown> }) => boolean)(
      { data: { isBoundaryPort: true } },
    )).toBe(false);
    expect(data.edges.filter((edge) => edge.data.isBoundaryStub)).toEqual([
      expect.objectContaining({ source: 'Concept:index', target: 'z-port', type: 'line' }),
      expect.objectContaining({ source: 'Concept:list', target: 'z-port', type: 'line' }),
      expect.objectContaining({ source: 'a-port', target: 'Concept:list', type: 'line' }),
      expect.objectContaining({ source: 'top-port', target: 'Concept:index', type: 'line' }),
    ]);
    expect(data.edges.filter((edge) => edge.data.isBoundaryStub).every(
      (edge) => edge.data.bundleStrength === undefined,
    )).toBe(true);
  });

  it('pins boundary ports to the drawable edge left of a visible details drawer', async () => {
    const detailCategories: KGCategory[] = [
      { ...categories[0], anchor: { x: 0.5, y: 0.5 } },
      { ...categories[1], id: 'right', anchor: { x: 0.9, y: 0.5 }, order: 1 },
    ];
    const ports = [{
      id: 'right-port', categoryID: categories[0].id, externalCategoryID: 'right',
      direction: 'outgoing' as const, label: 'Right · 1 →', relationCount: 1,
      relationKeys: ['Concept:list|r|External:right'], insideNodeIDs: ['Concept:list'],
      externalNodeIDs: ['External:right'],
    }];
    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      categories: detailCategories,
      ports,
      rightViewportInset: 400,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const data = latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; style: Record<string, unknown> }>;
    };
    expect(data.nodes.find((node) => node.id === 'right-port')?.style)
      .toEqual(expect.objectContaining({ x: 505.25, y: 70 }));
  });

  it('reprojects boundary ports after a drawer changes the usable viewport without a camera transform', async () => {
    const detailCategories: KGCategory[] = [
      { ...categories[0], anchor: { x: 0.5, y: 0.5 } },
      { ...categories[1], id: 'right', anchor: { x: 0.9, y: 0.5 }, order: 1 },
    ];
    const ports = [{
      id: 'right-port', categoryID: categories[0].id, externalCategoryID: 'right',
      direction: 'outgoing' as const, label: 'Right · 1 →', relationCount: 1,
      relationKeys: ['Concept:list|r|External:right'], insideNodeIDs: ['Concept:list'],
      externalNodeIDs: ['External:right'],
    }];
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      categories: detailCategories,
      ports,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().getCanvasByClient.mockImplementation(
      ([x, y]: [number, number]) => [x + 100, y + 20],
    );
    latestGraph().getZoom.mockReturnValue(2);
    latestGraph().updateNodeData.mockClear();

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      categories: detailCategories,
      ports,
      rightViewportInset: 400,
      selectedNodeID: 'Concept:list',
      viewState: 'CATEGORY_DETAIL',
    })} />);

    await waitFor(() => expect(latestGraph().updateNodeData).toHaveBeenCalled());
    const updates = latestGraph().updateNodeData.mock.calls.flatMap(([nodes]) => nodes);
    expect(updates.find((node: { id: string }) => node.id === 'right-port')).toEqual(
      expect.objectContaining({
        style: expect.objectContaining({
          x: 605.25,
          y: 90,
          size: [132, 32],
          radius: 16,
          lineWidth: 1.5,
          labelFontSize: 12,
        }),
      }),
    );

    latestGraph().getZoom.mockImplementation(() => {
      throw new Error('viewport is not initialized');
    });
    latestGraph().updateNodeData.mockClear();
    const transform = latestGraph().on.mock.calls.find(
      ([event]) => event === 'aftertransform',
    )?.[1];
    expect(() => transform?.({})).not.toThrow();
    await act(async () => Promise.resolve());
    expect(latestGraph().updateNodeData).not.toHaveBeenCalled();
  });

  it('publishes screen-fixed boundary port bounds independently of stale G6 render bounds', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const detailCategories: KGCategory[] = [
      { ...categories[0], anchor: { x: 0.5, y: 0.5 } },
      { ...categories[1], id: 'right', anchor: { x: 0.9, y: 0.5 }, order: 1 },
    ];
    const port = {
      id: 'right-port', categoryID: categories[0].id, externalCategoryID: 'right',
      direction: 'outgoing' as const, label: 'Right · 1 →', relationCount: 1,
      relationKeys: ['Concept:list|r|External:right'], insideNodeIDs: ['Concept:list'],
      externalNodeIDs: ['External:right'],
    };
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      categories: detailCategories,
      ports: [port],
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().getElementRenderBounds.mockReturnValue({
      min: [100, 100, 0],
      max: [500, 300, 0],
    });
    latestGraph().on.mock.calls.find(([event]) => event === 'aftertransform')?.[1]?.({});
    await act(async () => Promise.resolve());

    const snapshot = [...events].reverse().find((event) => event.detail.phase === 'transform')?.detail;
    const bounds = snapshot.ports.find((candidate: { id: string }) => candidate.id === port.id);
    expect(bounds.maxX - bounds.minX).toBe(133.5);
    expect(bounds.maxY - bounds.minY).toBe(33.5);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('sorts same-side ports by category order and keeps per-node counts fixed after resize', async () => {
    let resizeCallback!: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe = vi.fn();
      disconnect = disconnect;
      unobserve = vi.fn();
    });
    const detailCategories: KGCategory[] = [
      { ...categories[0], anchor: { x: 0.5, y: 0.5 } },
      { ...categories[1], id: 'late', anchor: { x: 0.9, y: 0.55 }, order: 9 },
      { ...categories[1], id: 'early', anchor: { x: 0.9, y: 0.45 }, order: 1 },
    ];
    const ports = [
      {
        id: 'aaa-late', categoryID: categories[0].id, externalCategoryID: 'late',
        direction: 'outgoing' as const, label: 'Late · 1 →', relationCount: 1,
        relationKeys: ['Concept:index|r|External:late'], insideNodeIDs: ['Concept:index'], externalNodeIDs: ['External:late'],
      },
      {
        id: 'zzz-early-out', categoryID: categories[0].id, externalCategoryID: 'early',
        direction: 'outgoing' as const, label: 'Early · 3 →', relationCount: 3,
        relationKeys: [
          'Concept:index|r|External:a',
          'Concept:list|s|External:b',
          'Concept:list|t|External:c',
        ], insideNodeIDs: ['Concept:index', 'Concept:list'], externalNodeIDs: ['External:a', 'External:b', 'External:c'],
      },
      {
        id: 'yyy-early-in', categoryID: categories[0].id, externalCategoryID: 'early',
        direction: 'incoming' as const, label: '← Early · 1', relationCount: 1,
        relationKeys: ['External:d|u|Concept:list'], insideNodeIDs: ['Concept:list'], externalNodeIDs: ['External:d'],
      },
    ];
    const view = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      categories: detailCategories,
      ports,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const initial = latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; style: Record<string, unknown> }>;
      edges: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(initial.nodes.filter((node) => ports.some((port) => port.id === node.id)).map(
      (node) => [node.id, node.style.x, node.style.y],
    )).toEqual([
      ['aaa-late', 905.25, 358],
      ['zzz-early-out', 905.25, 214],
      ['yyy-early-in', 905.25, 70],
    ]);
    expect(initial.edges.filter((edge) => edge.data.isBoundaryStub).map(
      (edge) => [edge.id, edge.data.relation_count],
    )).toEqual([
      ['boundary-stub:Concept:index:aaa-late', 1],
      ['boundary-stub:Concept:index:zzz-early-out', 1],
      ['boundary-stub:Concept:list:zzz-early-out', 2],
      ['boundary-stub:Concept:list:yyy-early-in', 1],
    ]);

    const container = view.getByRole('application');
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 800 },
    });
    latestGraph().updateNodeData.mockClear();
    latestGraph().draw.mockClear();
    latestGraph().resize.mockClear();
    resizeCallback([], {} as ResizeObserver);
    await act(async () => Promise.resolve());
    expect(latestGraph().resize).toHaveBeenCalledWith(1200, 800);
    expect(latestGraph().updateNodeData).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'yyy-early-in', style: expect.objectContaining({ x: 1105.25, y: 70 }) }),
      expect.objectContaining({ id: 'zzz-early-out', style: expect.objectContaining({ x: 1105.25, y: 214 }) }),
      expect.objectContaining({ id: 'aaa-late', style: expect.objectContaining({ x: 1105.25, y: 358 }) }),
    ]));
    expect(latestGraph().updateNodeData.mock.invocationCallOrder.at(-1)).toBeLessThan(
      latestGraph().draw.mock.invocationCallOrder.at(-1),
    );
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
    expect(latestGraph().getCanvasData().nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'zzz-early-out',
        style: expect.objectContaining({ x: 1105.25, y: 214 }),
      }),
    ]));

    latestGraph().getCanvasByClient.mockImplementation(
      ([x, y]: [number, number]) => [(x - 100) / 2, (y - 50) / 2],
    );
    latestGraph().updateNodeData.mockClear();
    latestGraph().draw.mockClear();
    latestGraph().on.mock.calls.find(([event]) => event === 'aftertransform')?.[1]?.({});
    await act(async () => Promise.resolve());
    expect(latestGraph().updateNodeData).not.toHaveBeenCalled();
    expect(latestGraph().draw).not.toHaveBeenCalled();
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('redistributes same-side overflow ports around the drawable boundary without overlap', async () => {
    const detailCategories: KGCategory[] = [
      { ...categories[0], anchor: { x: 0.5, y: 0.5 } },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...categories[1],
        id: `bottom-${index}`,
        anchor: { x: 0.45 + index * 0.02, y: 0.95 },
        order: index,
      })),
    ];
    const ports = Array.from({ length: 6 }, (_, index) => ({
      id: `bottom-port-${index}`,
      categoryID: categories[0].id,
      externalCategoryID: `bottom-${index}`,
      direction: 'outgoing' as const,
      label: `Bottom ${index} · 1 →`,
      relationCount: 1,
      relationKeys: [`Concept:list|r|External:${index}`],
      insideNodeIDs: ['Concept:list'],
      externalNodeIDs: [`External:${index}`],
    }));
    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      categories: detailCategories,
      ports,
      rightViewportInset: 400,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const data = latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{
        id: string;
        data: { boundarySide?: string };
        style: { x?: number; y?: number };
      }>;
    };
    const renderedPorts = data.nodes.filter((node) => ports.some((port) => port.id === node.id));
    expect(renderedPorts).toHaveLength(6);
    expect(renderedPorts.filter((port) => port.data.boundarySide === 'bottom')).toHaveLength(3);
    expect(renderedPorts.some((port) => port.data.boundarySide === 'right')).toBe(true);
    const boxes = renderedPorts.map((port) => ({
      left: Number(port.style.x) - 66.75,
      right: Number(port.style.x) + 66.75,
      top: Number(port.style.y) - 16.75,
      bottom: Number(port.style.y) + 16.75,
    }));
    for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
        const left = boxes[leftIndex];
        const right = boxes[rightIndex];
        const horizontalGap = Math.max(0, left.left - right.right, right.left - left.right);
        const verticalGap = Math.max(0, left.top - right.bottom, right.top - left.bottom);
        expect(Math.hypot(horizontalGap, verticalGap)).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('guards StrictMode render continuations by generation and Graph identity', async () => {
    const deferred = () => {
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject };
    };
    const newRender = deferred();
    graphMocks.state.renderPromises.push(newRender.promise);
    const onLayoutSettled = vi.fn();
    render(
      <StrictMode><KGGraphCanvas {...canvasProps({ onLayoutSettled })} /></StrictMode>,
    );
    expect(graphMocks.instances).toHaveLength(2);
    const oldGraph = graphMocks.instances[0];
    const newGraph = graphMocks.instances[1];

    await act(async () => Promise.resolve());
    expect(oldGraph.render).toHaveBeenCalledTimes(1);
    expect(newGraph.render).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    await act(async () => newRender.resolve());
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);

    expect(oldGraph.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not move the replacement Graph camera when StrictMode destroys a pending reset', async () => {
    graphMocks.state.layoutPromises.push(new Promise(() => undefined));
    let resetLayout: Promise<void> | undefined;

    function ResetOnce() {
      const ref = useRef<KGGraphCanvasHandle>(null);
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        resetLayout = ref.current!.resetLayout();
      }, []);
      return <KGGraphCanvas ref={ref} {...canvasProps()} />;
    }

    render(<StrictMode><ResetOnce /></StrictMode>);
    expect(graphMocks.instances).toHaveLength(2);
    const oldGraph = graphMocks.instances[0];
    const newGraph = graphMocks.instances[1];

    await act(async () => resetLayout);

    expect(oldGraph.destroy).toHaveBeenCalledTimes(1);
    expect(oldGraph.fitView).not.toHaveBeenCalled();
    expect(newGraph.fitView).not.toHaveBeenCalled();
  });

  it('does not rerun force layout for world presentation-only data changes', async () => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((yes) => { resolve = yes; });
      return { promise, resolve };
    };
    const oldDraw = deferred();
    const newDraw = deferred();
    const { rerender } = render(<KGGraphCanvas {...canvasProps()} />);
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    latestGraph().layout.mockClear();
    latestGraph().draw.mockClear();
    graphMocks.state.drawPromises.push(oldDraw.promise, newDraw.promise);
    rerender(<KGGraphCanvas {...canvasProps({ graph: { ...graph, edges: [] } })} />);
    rerender(<KGGraphCanvas {...canvasProps({ graph: { ...graph, nodes: graph.nodes.slice(0, 1) } })} />);
    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
    await act(async () => Promise.resolve());
    expect(latestGraph().layout).not.toHaveBeenCalled();
    await act(async () => oldDraw.resolve());
    expect(latestGraph().layout).not.toHaveBeenCalled();
    await act(async () => newDraw.resolve());
    expect(latestGraph().layout).not.toHaveBeenCalled();
  });

  it('does not redraw the identical detail graph when ENTERING_DETAIL becomes CATEGORY_DETAIL', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const detailProps = canvasProps({
      activeCategoryID: categories[0].id,
      viewState: 'ENTERING_DETAIL',
    });
    const { rerender } = render(<KGGraphCanvas {...detailProps} />);
    await act(async () => Promise.resolve());
    latestGraph().setData.mockClear();
    latestGraph().draw.mockClear();

    rerender(<KGGraphCanvas {...detailProps} viewState="CATEGORY_DETAIL" />);
    await act(async () => Promise.resolve());

    expect(latestGraph().setData).not.toHaveBeenCalled();
    expect(latestGraph().draw).not.toHaveBeenCalled();
    expect(events.some((event) =>
      event.detail.phase === 'presentation'
      && event.detail.viewState === 'CATEGORY_DETAIL')).toBe(true);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('does not redraw the identical category graph when ENTERING_CATEGORY becomes CATEGORY_FOCUS', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const categoryGraph = { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] };
    const enteringProps = canvasProps({
      activeCategoryID: categories[0].id,
      graph: categoryGraph,
      viewState: 'ENTERING_CATEGORY',
    });
    const { rerender } = render(<KGGraphCanvas {...enteringProps} />);
    await act(async () => Promise.resolve());
    latestGraph().setData.mockClear();
    latestGraph().draw.mockClear();

    rerender(<KGGraphCanvas {...enteringProps} viewState="CATEGORY_FOCUS" />);
    await act(async () => Promise.resolve());

    expect(latestGraph().setData).not.toHaveBeenCalled();
    expect(latestGraph().draw).not.toHaveBeenCalled();
    expect(events.some((event) =>
      event.detail.phase === 'presentation'
      && event.detail.viewState === 'CATEGORY_FOCUS')).toBe(true);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('does not restore and draw an obsolete current-focus style while leaving detail', async () => {
    const roleByNodeID = new Map([['Concept:list', 'current' as const]]);
    const detailProps = canvasProps({
      activeCategoryID: categories[0].id,
      roleByNodeID,
      viewState: 'CATEGORY_DETAIL',
    });
    const { rerender } = render(<KGGraphCanvas {...detailProps} />);
    await act(async () => Promise.resolve());
    latestGraph().draw.mockClear();

    rerender(<KGGraphCanvas {...detailProps} viewState="ENTERING_CATEGORY" />);
    await act(async () => Promise.resolve());

    expect(latestGraph().draw).toHaveBeenCalledTimes(2);
  });

  it('reruns the world force layout when a category graph expands back to all nodes', async () => {
    const categoryGraph = { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] };
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph: categoryGraph,
      viewState: 'CATEGORY_FOCUS',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    latestGraph().layout.mockClear();

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph,
      viewState: 'RETURNING_TO_WORLD',
    })} />);

    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
  });

  it('keeps the returning-world layout active when the stable WORLD state renders', async () => {
    const categoryGraph = { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] };
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph: categoryGraph,
      viewState: 'CATEGORY_FOCUS',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    graphMocks.state.layoutPromises.push(new Promise(() => undefined));
    latestGraph().layout.mockClear();
    latestGraph().setData.mockClear();

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph,
      viewState: 'RETURNING_TO_WORLD',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    expect(latestGraph().setData).toHaveBeenCalledTimes(1);

    rerender(<KGGraphCanvas {...canvasProps({ graph: { ...graph }, viewState: 'WORLD' })} />);
    await act(async () => Promise.resolve());

    expect(latestGraph().setData).toHaveBeenCalledTimes(1);
    expect(latestGraph().layout).toHaveBeenCalledTimes(1);
  });

  it('hands an already committed returning-world frame to WORLD without redrawing it', async () => {
    const categoryGraph = { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] };
    const onLayoutSettled = vi.fn();
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph: categoryGraph,
      onLayoutSettled,
      viewState: 'CATEGORY_FOCUS',
    })} />);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    onLayoutSettled.mockClear();
    latestGraph().setData.mockClear();

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph,
      onLayoutSettled,
      viewState: 'RETURNING_TO_WORLD',
    })} />);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    expect(latestGraph().setData).toHaveBeenCalledTimes(1);

    rerender(<KGGraphCanvas {...canvasProps({ graph: { ...graph }, viewState: 'WORLD' })} />);
    await act(async () => Promise.resolve());

    expect(latestGraph().setData).toHaveBeenCalledTimes(1);
  });

  it('clears selected, current-role and path presentation before handing RETURNING_TO_WORLD to WORLD', async () => {
    const categoryGraph = { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] };
    const staleRoles = new Map([['Concept:list', 'current' as const]]);
    const stalePathNodes = new Set(['Concept:list']);
    const stalePathEdges = new Set([graph.edges[0].id]);
    const staleSelectedEdgeID = graph.edges[0].id;
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph: categoryGraph,
      roleByNodeID: staleRoles,
      selectedEdgeID: staleSelectedEdgeID,
      selectedNodeID: 'Concept:list',
      pathNodeIDs: stalePathNodes,
      pathEdgeIDs: stalePathEdges,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    latestGraph().setData.mockClear();

    rerender(<KGGraphCanvas {...canvasProps({
      graph,
      roleByNodeID: staleRoles,
      selectedEdgeID: staleSelectedEdgeID,
      selectedNodeID: 'Concept:list',
      pathNodeIDs: stalePathNodes,
      pathEdgeIDs: stalePathEdges,
      viewState: 'RETURNING_TO_WORLD',
    })} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(1));
    const returningData = latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; states: string[]; style: Record<string, unknown> }>;
      edges: Array<{ id: string; states?: string[]; style: Record<string, unknown> }>;
    };
    const previouslySelected = returningData.nodes.find((node) => node.id === 'Concept:list');
    expect(previouslySelected?.states).toEqual([]);
    expect(previouslySelected?.style).toEqual(expect.objectContaining({
      labelText: '',
      labelOpacity: 0,
      opacity: 1,
    }));
    expect(previouslySelected?.style.shadowBlur ?? 0).toBe(0);
    expect(returningData.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'Concept:list|uses|Concept:index',
        style: expect.objectContaining({ lineWidth: 1, opacity: 0.18 }),
      }),
      expect.objectContaining({
        id: 'Concept:list|crosses|Concept:index',
        style: expect.objectContaining({ lineWidth: 1.4, opacity: 0.28 }),
      }),
    ]));
    expect(returningData.edges.every((edge) => !edge.states || edge.states.length === 0)).toBe(true);

    const callsAfterReturn = latestGraph().setData.mock.calls.length;
    rerender(<KGGraphCanvas {...canvasProps({ graph: { ...graph }, viewState: 'WORLD' })} />);
    await act(async () => Promise.resolve());
    expect(latestGraph().setData).toHaveBeenCalledTimes(callsAfterReturn);
  });

  it('does not publish WORLD settlement while the return commit draw is pending or after it rejects', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const frames = controlAnimationFrames();
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const worldGraph = worldGraphWithNodeCount(83);
    const categoryGraph = { ...worldGraph, nodes: worldGraph.nodes.slice(0, 1), edges: [] };
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph: categoryGraph,
      viewState: 'CATEGORY_FOCUS',
    })} />);
    await waitFor(() => expect(latestGraph().layout).toHaveBeenCalledTimes(1));
    await frames.flush(16);
    await frames.flush(32);
    await frames.flush(48);
    events.length = 0;
    latestGraph().layout.mockClear();
    graphMocks.state.drawEmitsAfterRender = false;
    graphMocks.state.drawPromises.push(new Promise(() => undefined));

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: 'collections-and-access',
      graph: worldGraph,
      viewState: 'RETURNING_TO_WORLD',
    })} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    let rejectCommitDraw!: (error: Error) => void;
    graphMocks.state.drawPromises.push(new Promise<void>((_resolve, reject) => {
      rejectCommitDraw = reject;
    }));
    await frames.flush(64);
    await frames.flush(80);
    await frames.flush(96);
    rerender(<KGGraphCanvas {...canvasProps({ graph: worldGraph, viewState: 'WORLD' })} />);
    await act(async () => Promise.resolve());

    expect(latestGraph().layout).toHaveBeenCalledTimes(1);
    expect(events.some((event) =>
      event.detail.phase === 'layout-settled'
      && event.detail.viewState === 'WORLD'
      && event.detail.nodeCount === worldGraph.nodes.length)).toBe(false);
    await act(async () => rejectCommitDraw(new Error('return draw failed')));
    expect(events.some((event) =>
      event.detail.phase === 'layout-settled'
      && event.detail.viewState === 'WORLD'
      && event.detail.nodeCount === worldGraph.nodes.length)).toBe(false);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('does not let an obsolete layout continuation settle a newer run', async () => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((yes) => { resolve = yes; });
      return { promise, resolve };
    };
    const oldLayout = deferred();
    const newLayout = deferred();
    graphMocks.state.layoutPromises.push(Promise.resolve(), oldLayout.promise, newLayout.promise);
    const onLayoutSettled = vi.fn();
    const { rerender } = render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    onLayoutSettled.mockClear();
    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: 710, y: 410 } },
    ]);
    localStorage.clear();

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      graph: { ...graph, edges: [] },
      onLayoutSettled,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await act(async () => Promise.resolve());
    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[1].id,
      graph: { ...graph, nodes: graph.nodes.slice(0, 1) },
      onLayoutSettled,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await act(async () => Promise.resolve());
    await act(async () => oldLayout.resolve());
    expect(onLayoutSettled).not.toHaveBeenCalled();
    expect(localStorage.getItem('kg-world-layout-v3')).toBeNull();
    await act(async () => newLayout.resolve());
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('kg-category-layout-v2:functions-and-modules')).toContain('Concept:list');
  });

  it('saves a world drag without restarting the force layout for the other categories', async () => {
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: 210, y: 170 } },
      { id: 'Concept:index', style: { x: 275, y: 205 } },
    ]);
    latestGraph().layout.mockClear();
    localStorage.clear();

    latestGraph().on.mock.calls.find(
      ([event]) => event === 'node:dragend',
    )?.[1]?.({ target: { id: 'Concept:list' } });

    expect(latestGraph().layout).not.toHaveBeenCalled();
    expect(localStorage.getItem('kg-world-layout-v3')).toContain('Concept:list');
    expect(localStorage.getItem('kg-world-layout-v3')).toContain('Concept:index');
  });

  it('updates all runtime animation options and refreshes focus when reduced motion changes', async () => {
    vi.useFakeTimers();
    const roles = new Map([['Concept:list', 'current' as const]]);
    const { rerender } = render(
      <KGGraphCanvas {...canvasProps({
        activeCategoryID: categories[0].id,
        focusNodeID: 'Concept:list',
        roleByNodeID: roles,
        viewState: 'CATEGORY_DETAIL',
      })} />,
    );
    await act(async () => Promise.resolve());
    latestGraph().setOptions.mockClear();
    latestGraph().updateNodeData.mockClear();

    rerender(
      <KGGraphCanvas {...canvasProps({
        activeCategoryID: categories[0].id,
        focusNodeID: 'Concept:list',
        reducedMotion: true,
        roleByNodeID: roles,
        viewState: 'CATEGORY_DETAIL',
      })} />,
    );
    expect(latestGraph().setOptions).toHaveBeenCalledWith(expect.objectContaining({
      animation: false,
      behaviors: expect.arrayContaining([
        expect.objectContaining({ type: 'zoom-canvas', animation: false }),
      ]),
      node: expect.objectContaining({ animation: false }),
      edge: expect.objectContaining({ animation: false }),
    }));
    const updatesAtReduced = latestGraph().updateNodeData.mock.calls.length;
    act(() => vi.advanceTimersByTime(1600));
    expect(latestGraph().updateNodeData).toHaveBeenCalledTimes(updatesAtReduced);

    rerender(
      <KGGraphCanvas {...canvasProps({
        activeCategoryID: categories[0].id,
        focusNodeID: 'Concept:list',
        reducedMotion: false,
        roleByNodeID: roles,
        viewState: 'CATEGORY_DETAIL',
      })} />,
    );
    expect(latestGraph().setOptions).toHaveBeenCalledWith(expect.objectContaining({
      animation: true,
      behaviors: expect.arrayContaining([
        expect.objectContaining({ type: 'zoom-canvas', animation: { duration: 300 } }),
      ]),
      node: expect.objectContaining({ animation: expect.objectContaining({ update: expect.any(Array) }) }),
      edge: expect.objectContaining({ animation: expect.objectContaining({ update: expect.any(Array) }) }),
    }));
    act(() => vi.advanceTimersByTime(800));
    expect(latestGraph().updateNodeData).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'Concept:list', style: expect.objectContaining({ size: 40 }) }),
    ]);
  });

  it('runs resetLayout through the detail deadline controller', async () => {
    vi.useFakeTimers();
    const ref = createRef<KGGraphCanvasHandle>();
    render(
      <KGGraphCanvas ref={ref} {...canvasProps({
        activeCategoryID: categories[0].id,
        viewState: 'CATEGORY_DETAIL',
      })} />,
    );
    await act(async () => Promise.resolve());
    graphMocks.state.layoutPromises.push(new Promise(() => undefined));
    latestGraph().stopLayout.mockClear();
    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: 330, y: 220 } },
      { id: 'Concept:index', style: { x: 430, y: 320 } },
    ]);
    localStorage.clear();

    void ref.current!.resetLayout();
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(999));
    expect(latestGraph().stopLayout).not.toHaveBeenCalled();
    expect(localStorage.getItem('kg-category-layout-v2:collections-and-access')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(latestGraph().stopLayout).toHaveBeenCalledTimes(1);
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(34);
      await Promise.resolve();
    });
    expect(localStorage.getItem('kg-category-layout-v2:collections-and-access')).toContain('Concept:list');
  });

  it('restarts a drag layout deadline and saves only after settlement', async () => {
    vi.useFakeTimers();
    let resolveDrag!: () => void;
    render(
      <KGGraphCanvas {...canvasProps({
        activeCategoryID: categories[0].id,
        viewState: 'CATEGORY_DETAIL',
      })} />,
    );
    await act(async () => Promise.resolve());
    graphMocks.state.layoutPromises.push(new Promise<void>((resolve) => { resolveDrag = resolve; }));
    latestGraph().layout.mockClear();
    latestGraph().getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: 344, y: 233 } },
      { id: 'Concept:index', style: { x: 444, y: 333 } },
    ]);
    localStorage.clear();
    const listener = (eventName: string) =>
      latestGraph().on.mock.calls.find(([event]) => event === eventName)?.[1];

    listener('node:dragend')?.({});
    await act(async () => Promise.resolve());
    expect(latestGraph().layout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('kg-category-layout-v2:collections-and-access')).toBeNull();
    await act(async () => resolveDrag());
    await act(async () => {
      vi.advanceTimersByTime(34);
      await Promise.resolve();
    });
    expect(localStorage.getItem('kg-category-layout-v2:collections-and-access')).toContain('Concept:index');
    act(() => vi.advanceTimersByTime(1200));
    expect(latestGraph().stopLayout).not.toHaveBeenCalled();
  });

  it('applies exact internal edge styles and Canvas-real double node type borders', async () => {
    const typedGraph: KGWorldGraph = {
      ...graph,
      nodes: [
        { ...graph.nodes[0], id: 'ErrorType:IndexError', data: { ...graph.nodes[0].data, node_id: 'ErrorType:IndexError', node_type: 'ErrorType' } },
        { ...graph.nodes[1], id: 'Misconception:off_by_one', data: { ...graph.nodes[1].data, node_id: 'Misconception:off_by_one', node_type: 'Misconception' } },
      ],
      edges: [],
    };
    const { rerender } = render(
      <KGGraphCanvas {...canvasProps({ graph: typedGraph, roleByNodeID: new Map() })} />,
    );
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    const worldNodes = (latestGraph().setData.mock.calls[0][0] as { nodes: Array<{ id: string; style: Record<string, unknown> }> }).nodes;
    expect(worldNodes.every((node) => node.style.fill === categories[0].color)).toBe(true);
    expect(worldNodes.every((node) => node.style.labelText === '')).toBe(true);
    expect(worldNodes.find((node) => node.id === 'ErrorType:IndexError')?.style).toEqual(
      expect.objectContaining({ halo: true, haloLineWidth: 3, haloLineDash: [] }),
    );
    expect(worldNodes.find((node) => node.id === 'Misconception:off_by_one')?.style).toEqual(
      expect.objectContaining({ halo: true, haloLineWidth: 3, haloLineDash: [4, 3], lineDash: [4, 3] }),
    );

    rerender(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      selectedNodeID: undefined,
      viewState: 'CATEGORY_DETAIL',
    })} />);
    const detailEdges = (latestGraph().setData.mock.calls.at(-1)?.[0] as { edges: Array<{ data: Record<string, unknown>; style: Record<string, unknown> }> }).edges;
    const internal = detailEdges.find((edge) => !edge.data.is_cross_category && !edge.data.isBoundaryStub)!;
    expect(internal.style).toEqual(expect.objectContaining({ stroke: '#64748B', lineWidth: 1.25, opacity: 0.24 }));

    rerender(<KGGraphCanvas {...canvasProps()} />);
    const worldEdges = (latestGraph().setData.mock.calls.at(-1)?.[0] as { edges: Array<{ data: Record<string, unknown>; style: Record<string, unknown> }> }).edges;
    const worldInternal = worldEdges.find((edge) => !edge.data.is_cross_category)!;
    expect(worldInternal.style.stroke).toBe(categories[0].color);
    expect(worldEdges.every((edge) => edge.style.endArrow === true)).toBe(true);
    expect(worldEdges.every((edge) => edge.style.lineDash === undefined)).toBe(true);
  });

  it('replaces every WORLD node with a complete label-free style after all six category journeys', async () => {
    const ref = createRef<KGGraphCanvasHandle>();
    const sixCategories: KGCategory[] = [
      ...categories,
      ...[
        ['program-foundations', '#8B5E3C', 1],
        ['types-and-values', '#4C78A8', 2],
        ['control-flow', '#A05179', 4],
        ['errors-files-and-classes', '#B45A4D', 6],
      ].map(([id, color, order]) => ({
        ...categories[0],
        id: String(id),
        color: String(color),
        order: Number(order),
      })),
    ].sort((left, right) => left.order - right.order);
    const worldGraph: KGWorldGraph = {
      nodes: Array.from({ length: 83 }, (_, index) => {
        const category = sixCategories[index % sixCategories.length];
        const id = `Concept:world-${index}`;
        return {
          ...graph.nodes[0],
          id,
          data: {
            ...graph.nodes[0].data,
            node_id: id,
            category_id: category.id,
          },
          style: { fill: category.color, size: 10 },
        };
      }),
      edges: [],
    };
    const assertCompleteWorldStyles = () => {
      const rendered = latestGraph().setData.mock.calls.at(-1)?.[0] as {
        nodes: Array<{ id: string; data: { category_id: string }; style: Record<string, unknown> }>;
      };
      expect(rendered.nodes).toHaveLength(83);
      for (const node of rendered.nodes) {
        expect(node.style).toEqual(expect.objectContaining({
          fill: sixCategories.find((category) => category.id === node.data.category_id)?.color,
          labelText: '',
          labelOpacity: 0,
          labelMaxWidth: 0,
          opacity: 1,
          size: 10,
        }));
      }
    };

    const { rerender } = render(<KGGraphCanvas ref={ref} {...canvasProps({
      categories: sixCategories,
      graph: worldGraph,
      roleByNodeID: new Map(),
      selectedNodeID: undefined,
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    assertCompleteWorldStyles();

    for (const category of sixCategories) {
      rerender(<KGGraphCanvas {...canvasProps({
        activeCategoryID: category.id,
        categories: sixCategories,
        graph: worldGraph,
        roleByNodeID: new Map(),
        selectedNodeID: undefined,
        viewState: 'CATEGORY_FOCUS',
      })} />);
      rerender(<KGGraphCanvas {...canvasProps({
        activeCategoryID: category.id,
        categories: sixCategories,
        graph: worldGraph,
        roleByNodeID: new Map(),
        selectedNodeID: undefined,
        viewState: 'CATEGORY_DETAIL',
      })} />);
      const detailNodes = (latestGraph().setData.mock.calls.at(-1)?.[0] as {
        nodes: Array<{ data: { label: string }; style: Record<string, unknown> }>;
      }).nodes;
      expect(detailNodes.every((node) => node.style.labelText === node.data.label
        && node.style.labelOpacity === 1
        && node.style.labelFontSize === 12
        && node.style.labelMaxWidth === 160)).toBe(true);
      rerender(<KGGraphCanvas {...canvasProps({
        activeCategoryID: category.id,
        categories: sixCategories,
        graph: worldGraph,
        roleByNodeID: new Map(),
        selectedNodeID: undefined,
        viewState: 'CATEGORY_FOCUS',
      })} />);
      assertCompleteWorldStyles();
      rerender(<KGGraphCanvas {...canvasProps({
        categories: sixCategories,
        graph: worldGraph,
        roleByNodeID: new Map(),
        selectedNodeID: undefined,
        viewState: 'WORLD',
      })} />);
      assertCompleteWorldStyles();
    }

    rerender(<KGGraphCanvas ref={ref} {...canvasProps({
      categories: sixCategories,
      dataVersion: 'overview-data-refresh-v2',
      graph: worldGraph,
      roleByNodeID: new Map([['Concept:world-0', 'current']]),
      selectedNodeID: 'Concept:world-0',
      viewState: 'WORLD',
    })} />);
    assertCompleteWorldStyles();

    const relationFilteredGraph: KGWorldGraph = {
      ...worldGraph,
      edges: [{
        ...graph.edges[0],
        id: 'Concept:world-0|uses|Concept:world-6',
        source: 'Concept:world-0',
        target: 'Concept:world-6',
      }],
    };
    rerender(<KGGraphCanvas ref={ref} {...canvasProps({
      categories: sixCategories,
      graph: relationFilteredGraph,
      roleByNodeID: new Map(),
      selectedNodeID: undefined,
      viewState: 'WORLD',
    })} />);
    assertCompleteWorldStyles();

    await act(async () => {
      await ref.current!.resetLayout();
    });
    const nodesAfterReset = latestGraph().getNodeData() as Array<{ style: Record<string, unknown> }>;
    expect(nodesAfterReset).toHaveLength(83);
    expect(nodesAfterReset.every((node) =>
      node.style.labelText === ''
      && node.style.labelOpacity === 0
      && node.style.labelMaxWidth === 0)).toBe(true);
  });

  it('publishes zero rendered labels from actual WORLD render styles in every debug phase', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'test');
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    const { rerender } = render(<KGGraphCanvas {...canvasProps({
      roleByNodeID: new Map(),
      selectedNodeID: undefined,
    })} />);
    await act(async () => Promise.resolve());
    emitCanvasReadyAndRender();
    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'afterlayout',
    )?.[1]?.({});
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'aftertransform',
    )?.[1]?.({});
    rerender(<KGGraphCanvas {...canvasProps({
      roleByNodeID: new Map(),
      selectedNodeID: 'Concept:index',
    })} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'node:drag',
    )?.[1]?.({ data: { id: 'Concept:list' } });
    await act(async () => {
      vi.advanceTimersByTime(34);
      await Promise.resolve();
      await Promise.resolve();
    });

    const requiredPhases = ['first-paint', 'layout-settled', 'transform', 'presentation', 'node-drag'];
    for (const phase of requiredPhases) {
      expect(
        events.find((event) => event.detail.phase === phase)?.detail.renderedLabelCount,
        `Missing zero-label ${phase} snapshot; received ${events.map((event) => event.detail.phase).join(', ')}`,
      ).toBe(0);
      expect(events.find(
        (event) => event.detail.phase === phase,
      )?.detail.renderedLabelReadErrorNodeIDs).toEqual([]);
    }
    expect(events.every((event) =>
      event.detail.phase === 'cleanup' || event.detail.renderedLabelCount === 0)).toBe(true);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('counts a visible rendered label even when that node has no readable geometry', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().__injectCanvasNodeStyle('Concept:list', {
      labelText: 'stale visible label',
      labelOpacity: 1,
    });
    latestGraph().getElementRenderBounds.mockImplementation((id: string) => {
      if (id === 'Concept:list') throw new Error('bounds unavailable');
      return id === 'Concept:index'
        ? { min: [280, 200, 0], max: [360, 280, 0] }
        : { min: [160, 80, 0], max: [280, 240, 0] };
    });

    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'aftertransform',
    )?.[1]?.({});

    expect(events.at(-1)?.detail.renderedLabelCount).toBe(1);
    expect(events.at(-1)?.detail.renderedLabelReadErrorNodeIDs).toEqual([]);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('fails closed when any rendered node style cannot be read', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const events: Array<CustomEvent<Record<string, any>>> = [];
    const listener = (event: Event) => events.push(event as CustomEvent<Record<string, any>>);
    window.addEventListener('kg-graph-debug', listener);
    render(<KGGraphCanvas {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));
    latestGraph().getElementRenderStyle.mockImplementation((id: string) => {
      if (id === 'Concept:index') throw new Error('style unavailable');
      return { labelText: '', labelOpacity: 0, x: 120, y: 80 };
    });

    latestGraph().on.mock.calls.find(
      ([eventName]) => eventName === 'aftertransform',
    )?.[1]?.({});

    expect(events.at(-1)?.detail.renderedLabelCount).toBeNull();
    expect(events.at(-1)?.detail.renderedLabelReadErrorNodeIDs).toEqual(['Concept:index']);
    window.removeEventListener('kg-graph-debug', listener);
  });

  it('applies exact selected-path edge emphasis and non-path dimming in real Canvas data', async () => {
    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      pathEdgeIDs: new Set(['Concept:list|uses|Concept:index']),
      pathNodeIDs: new Set(['Concept:list']),
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const rendered = latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; style: Record<string, unknown> }>;
      edges: Array<{ id: string; style: Record<string, unknown> }>;
    };
    expect(rendered.nodes.find((node) => node.id === 'Concept:list')?.style.opacity).toBe(1);
    expect(rendered.nodes.find((node) => node.id === 'Concept:index')?.style.opacity).toBe(0.20);
    expect(rendered.edges.find((edge) => edge.id === 'Concept:list|uses|Concept:index')?.style).toEqual(
      expect.objectContaining({ lineWidth: 3, opacity: 0.96, stroke: '#F28C28' }),
    );
    expect(rendered.edges.find((edge) => edge.id === 'Concept:list|crosses|Concept:index')?.style.opacity).toBe(0.08);
  });

  it('colors the fixed dictionary path by each directed edge source role', async () => {
    const roleByNodeID = {
      'Concept:sequence': 'upstream',
      'Concept:list': 'upstream',
      'Concept:tuple': 'upstream',
      'Concept:dict': 'current',
      'Concept:set': 'downstream',
      'Concept:key': 'downstream',
      'Concept:value': 'downstream',
    } as const;
    const edgePairs = [
      ['Concept:sequence', 'Concept:list'],
      ['Concept:list', 'Concept:tuple'],
      ['Concept:tuple', 'Concept:dict'],
      ['Concept:dict', 'Concept:set'],
      ['Concept:set', 'Concept:key'],
      ['Concept:key', 'Concept:value'],
    ] as const;
    const dictionaryGraph: KGWorldGraph = {
      nodes: Object.keys(roleByNodeID).map((id) => ({
        ...graph.nodes[0],
        id,
        data: { ...graph.nodes[0].data, node_id: id },
      })),
      edges: edgePairs.map(([source, target]) => {
        const id = `${source} -> ${target}`;
        return {
          ...graph.edges[0],
          id,
          source,
          target,
          data: { ...graph.edges[0].data, key: id, source, target },
        };
      }),
    };

    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      colorEdgesBySourceRole: true,
      graph: dictionaryGraph,
      pathEdgeIDs: new Set(dictionaryGraph.edges.map((edge) => edge.id)),
      roleByNodeID,
      selectedNodeID: '',
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const renderedEdges = (latestGraph().setData.mock.calls[0][0] as {
      edges: Array<{
        id: string;
        source: string;
        target: string;
        style: Record<string, unknown>;
      }>;
    }).edges;
    const stroke = (source: string, target: string) => renderedEdges.find(
      (edge) => edge.source === source && edge.target === target,
    )!.style.stroke;

    expect(stroke('Concept:tuple', 'Concept:dict')).toBe('#94A3B8');
    expect(stroke('Concept:dict', 'Concept:set')).toBe('#F28C28');
    expect(stroke('Concept:set', 'Concept:key')).toBe('#4FA66E');
    expect(stroke('Concept:key', 'Concept:value')).toBe('#4FA66E');
  });

  it('uses only the source role for all six cross-role directions with isolated fallbacks', async () => {
    const roleByNodeID = {
      'upstream-a': 'upstream',
      'current-a': 'current',
      'downstream-a': 'downstream',
      'normal-a': 'normal',
    } as const;
    const edgePairs = [
      ['upstream-a', 'current-a'],
      ['upstream-a', 'downstream-a'],
      ['current-a', 'upstream-a'],
      ['current-a', 'downstream-a'],
      ['downstream-a', 'upstream-a'],
      ['downstream-a', 'current-a'],
      ['normal-a', 'current-a'],
    ] as const;
    const matrixGraph: KGWorldGraph = {
      nodes: Object.keys(roleByNodeID).map((id) => ({
        ...graph.nodes[0],
        id,
        data: { ...graph.nodes[0].data, node_id: id },
      })),
      edges: edgePairs.map(([source, target]) => {
        const id = `${source} -> ${target}`;
        return {
          ...graph.edges[0],
          id,
          source,
          target,
          data: { ...graph.edges[0].data, key: id, source, target },
        };
      }),
    };
    const detailProps = canvasProps({
      activeCategoryID: categories[0].id,
      colorEdgesBySourceRole: true,
      graph: matrixGraph,
      pathEdgeIDs: new Set(matrixGraph.edges.map((edge) => edge.id)),
      roleByNodeID,
      selectedNodeID: '',
      viewState: 'CATEGORY_DETAIL',
    });

    const { rerender } = render(<KGGraphCanvas {...detailProps} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const initialEdges = (latestGraph().setData.mock.calls[0][0] as {
      edges: Array<{
        id: string;
        source: string;
        target: string;
        style: Record<string, unknown>;
      }>;
    }).edges;
    const stroke = (source: string, target: string) => initialEdges.find(
      (edge) => edge.source === source && edge.target === target,
    )!.style.stroke;

    expect(stroke('upstream-a', 'current-a')).toBe('#94A3B8');
    expect(stroke('upstream-a', 'downstream-a')).toBe('#94A3B8');
    expect(stroke('current-a', 'upstream-a')).toBe('#F28C28');
    expect(stroke('current-a', 'downstream-a')).toBe('#F28C28');
    expect(stroke('downstream-a', 'upstream-a')).toBe('#4FA66E');
    expect(stroke('downstream-a', 'current-a')).toBe('#4FA66E');
    for (const [source, target] of edgePairs.slice(0, 6)) {
      expect(initialEdges.find((edge) =>
        edge.id === `${source} -> ${target}`)).toEqual(expect.objectContaining({
        source,
        target,
        style: expect.objectContaining({
          lineWidth: 3,
          opacity: 0.96,
          endArrow: true,
          endArrowSize: [8, 6],
        }),
      }));
    }
    expect(stroke('normal-a', 'current-a')).toBe('#F28C28');

    rerender(<KGGraphCanvas {...detailProps} colorEdgesBySourceRole={undefined} />);
    await waitFor(() => expect(latestGraph().setData).toHaveBeenCalledTimes(2));
    const fallbackEdges = (latestGraph().setData.mock.calls[1][0] as {
      edges: Array<{ id: string; style: Record<string, unknown> }>;
    }).edges;
    expect(fallbackEdges.map((edge) => edge.style.stroke)).toEqual(
      edgePairs.map(() => '#F28C28'),
    );
  });

  it('composes every node type border with normal, path role, current, and focus styles', async () => {
    const nodeTypes = ['Concept', 'ErrorType', 'Misconception'] as const;
    const roles = ['normal', 'upstream', 'downstream', 'current'] as const;
    const typedNodes = nodeTypes.flatMap((nodeType) => roles.map((role) => {
      const id = `${nodeType}:${role}`;
      return {
        ...graph.nodes[0],
        id,
        data: { ...graph.nodes[0].data, node_id: id, node_type: nodeType },
      };
    }));
    const roleByNodeID = new Map(typedNodes.map((node) => [
      node.id,
      node.id.split(':').at(-1) as typeof roles[number],
    ]));
    render(<KGGraphCanvas {...canvasProps({
      activeCategoryID: categories[0].id,
      focusNodeID: 'ErrorType:current',
      graph: { ...graph, nodes: typedNodes, edges: [] },
      roleByNodeID,
      selectedNodeID: '',
      viewState: 'CATEGORY_DETAIL',
    })} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    const rendered = (latestGraph().setData.mock.calls[0][0] as {
      nodes: Array<{ id: string; style: Record<string, unknown> }>;
    }).nodes;
    for (const nodeType of nodeTypes) {
      for (const role of roles) {
        const style = rendered.find((node) => node.id === `${nodeType}:${role}`)!.style;
        const needsOuterTypeOrRoleRing = nodeType !== 'Concept' || role !== 'normal';
        expect(style.lineDash).toEqual(nodeType === 'Misconception' ? [4, 3] : []);
        expect(style.halo).toBe(needsOuterTypeOrRoleRing);
        if (needsOuterTypeOrRoleRing) {
          expect(style.haloStroke).toBe(categories[0].color);
          expect(style.haloLineDash).toEqual(nodeType === 'Misconception' ? [4, 3] : []);
        }
        expect(style).not.toHaveProperty('categoryRingColor');
        expect(style).not.toHaveProperty('categoryRingWidth');
      }
    }
    expect(rendered.find((node) => node.id === 'ErrorType:current')?.style).toEqual(
      expect.objectContaining({
        fill: '#F28C28',
        halo: true,
        haloStroke: categories[0].color,
        shadowBlur: 10,
        shadowColor: 'rgba(242,140,40,0.42)',
      }),
    );
  });

  it('uses exact world/detail layout deadlines and storage keys', async () => {
    vi.useFakeTimers();
    graphMocks.state.layoutPromises.push(new Promise(() => undefined));
    const onWorldSettled = vi.fn();

    const world = render(<KGGraphCanvas {...canvasProps({ onLayoutSettled: onWorldSettled })} />);
    const worldGraph = latestGraph();
    worldGraph.getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: 210, y: 170 } },
      { id: 'Concept:index', style: { x: 275, y: 205 } },
    ]);
    await act(async () => Promise.resolve());
    expect(worldGraph.draw).toHaveBeenCalledTimes(0);
    expect(worldGraph.render).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1299));
    expect(worldGraph.stopLayout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(worldGraph.stopLayout).toHaveBeenCalledTimes(1);
    expect(worldGraph.draw).toHaveBeenCalledTimes(0);
    expect(onWorldSettled).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(34);
      await Promise.resolve();
    });
    expect(onWorldSettled).toHaveBeenCalledTimes(1);
    expect(worldGraph.draw).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('kg-world-layout-v3')).toContain('Concept:list');
    world.unmount();

    graphMocks.state.layoutPromises.push(new Promise(() => undefined));
    const onDetailSettled = vi.fn();
    render(
      <KGGraphCanvas
        {...canvasProps({
          activeCategoryID: categories[0].id,
          onLayoutSettled: onDetailSettled,
          reducedMotion: true,
          viewState: 'CATEGORY_DETAIL',
        })}
      />,
    );
    const detailGraph = latestGraph();
    detailGraph.getNodeData.mockReturnValue([
      { id: 'Concept:list', style: { x: 160, y: 220 } },
      { id: 'Concept:index', style: { x: 260, y: 320 } },
    ]);
    await act(async () => Promise.resolve());
    expect(detailGraph.draw).toHaveBeenCalledTimes(0);
    expect(detailGraph.render).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(999));
    expect(detailGraph.stopLayout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(detailGraph.stopLayout).toHaveBeenCalledTimes(1);
    expect(detailGraph.draw).toHaveBeenCalledTimes(1);
    expect(onDetailSettled).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(34);
      await Promise.resolve();
    });
    expect(onDetailSettled).toHaveBeenCalledTimes(1);
    expect(
      localStorage.getItem('kg-category-layout-v2:collections-and-access'),
    ).toContain('Concept:index');

    vi.useRealTimers();
  });

  it('settles initial render once without an unscoped AFTER_LAYOUT listener', async () => {
    const onLayoutSettled = vi.fn();
    render(<KGGraphCanvas {...canvasProps({ onLayoutSettled })} />);
    await waitFor(() => expect(onLayoutSettled).toHaveBeenCalledTimes(1));

    expect(latestGraph().on.mock.calls.map(([event]) => event)).not.toContain('afterlayout');
    expect(onLayoutSettled).toHaveBeenCalledTimes(1);
  });

  it('does not destroy twice when the imperative destroy command precedes unmount', async () => {
    const ref = createRef<KGGraphCanvasHandle>();
    const { unmount } = render(<KGGraphCanvas ref={ref} {...canvasProps()} />);
    await waitFor(() => expect(latestGraph().render).toHaveBeenCalledTimes(1));

    ref.current!.destroy();
    unmount();

    expect(latestGraph().destroy).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported 2D Canvas without constructing G6', () => {
    getContextSpy.mockReturnValue(null);
    const onCanvasUnsupported = vi.fn();

    render(<KGGraphCanvas {...canvasProps({ onCanvasUnsupported })} />);

    expect(onCanvasUnsupported).toHaveBeenCalledTimes(1);
    expect(graphMocks.Graph).not.toHaveBeenCalled();
  });
});
