import {
  CanvasEvent,
  EdgeEvent,
  Graph,
  GraphEvent,
  NodeEvent,
  type GraphData,
  type GraphOptions,
  type NodeData,
} from '@antv/g6';
import { Renderer as CanvasRenderer } from '@antv/g-canvas';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import type {
  KGBoundaryPort,
  KGCategory,
  KGNodeRole,
  KGViewState,
  KGWorldGraph,
  WorldLayoutMetrics,
  WorldModelLayoutMetrics,
  WorldLayoutPoint,
} from './types';
import {
  buildWorldForceLayout,
  measureWorldLayout,
  measureWorldModelLayout,
} from './worldForceLayout';
import './kg-world.css';

export const ROLE_STYLES = {
  normal: { size: 16 },
  upstream: { size: 18, fill: '#94A3B8', stroke: '#64748B', lineWidth: 2 },
  downstream: { size: 18, fill: '#4FA66E', stroke: '#2F7A4B', lineWidth: 2 },
  current: { size: 36, fill: '#F28C28', stroke: '#FFF7ED', lineWidth: 3 },
} as const;

export const GRAPH_LIMITS = { minZoom: 0.35, maxZoom: 4, zoomStep: 1.1 } as const;

const WORLD_LAYOUT_KEY = 'kg-world-layout-v3';
const WORLD_LAYOUT_ALGORITHM = 'global-force-v1';
const CATEGORY_LAYOUT_KEY_PREFIX = 'kg-category-layout-v2:';
const WORLD_LAYOUT_DURATION = 1500;
const DETAIL_LAYOUT_DURATION = 1200;
const ENTERING_DETAIL_LAYOUT_DURATION = 300;
const FINAL_DRAW_RESERVE = 200;
const CAMERA_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CATEGORY_OPACITY_DURATION = 400;
const DEFAULT_CANVAS_SIZE = { width: 1000, height: 600 } as const;
const PORT_BOUNDARY_INSET = 28;
const PORT_LINE_WIDTH = 1.5;
const PORT_RENDER_BOUNDS_GUARD = PORT_LINE_WIDTH / 2;
const PORT_MIN_WIDTH = 132;
const PORT_HEIGHT = 32;
const PORT_LABEL_FONT = '500 12px Epilogue, system-ui, sans-serif';
const PORT_LABEL_HORIZONTAL_PADDING = 32;
const HORIZONTAL_PORT_SPACING = 148;
const VERTICAL_PORT_SPACING = 144;
const PORT_MINIMUM_SCREEN_GAP = 13;
const FOCUS_HALF_CYCLE = 800;
const NODE_SINGLE_CLICK_DELAY = 180;
const NODE_DOUBLE_CLICK_AFTER_DRAG_GUARD = 500;
export const KG_GRAPH_DEBUG_EVENT = 'kg-graph-debug';
export type KGLayoutSource = 'cache' | 'force' | 'reset';

export type KGGraphDebugPhase =
  | 'first-paint'
  | 'layout-settled'
  | 'presentation'
  | 'transform'
  | 'node-drag'
  | 'focus-peak'
  | 'cleanup';

export type KGGraphDebugDetail = {
  phase: KGGraphDebugPhase;
  timestamp: number;
  elapsedMs: number;
  viewState: KGViewState;
  activeCategoryID: string;
  nodeCount: number;
  edgeCount: number;
  crossCategoryEdgeCount: number;
  renderedLabelCount: number | null;
  renderedLabelReadErrorNodeIDs: string[];
  modelLayoutMetrics: WorldModelLayoutMetrics | null;
  screenLayoutMetrics: WorldLayoutMetrics | null;
  layoutSource: KGLayoutSource | null;
  canvasSize: CanvasSize;
  layoutCanvasSize: CanvasSize | null;
  modelNodes: Array<{ id: string; category_id: string; x: number; y: number }>;
  zoom: number;
  camera: { x: number; y: number };
  focusNodeID?: string;
  nodes: Array<{
    id: string;
    clientX: number;
    clientY: number;
    opacity: number;
    size: number;
    fill: string;
    shadowBlur: number;
    shadowColor: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    clientX: number;
    clientY: number;
    lineWidth: number;
    opacity: number;
    stroke: string;
    endArrow: boolean;
    states: string[];
  }>;
  renderedEdges: Array<{
    id: string;
    source: string;
    target: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    sourceAttachmentDistance: number;
    targetAttachmentDistance: number;
    sourceRadius: number;
    targetRadius: number;
  }>;
  ports: Array<{
    id: string;
    clientX: number;
    clientY: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  runtime?: {
    g6ListenerCount: number;
    intervalCount: number;
    timeoutCount: number;
    g6AnimationCount: number;
    timelineAnimationCount: number;
  };
};

function browserDebugEnabled(): boolean {
  return typeof window !== 'undefined'
    && (
      typeof process === 'undefined'
      || process.env.NODE_ENV !== 'production'
      || (window as Window & { __RESPONSIBLE_EDU_KG_DEBUG__?: boolean })
        .__RESPONSIBLE_EDU_KG_DEBUG__ === true
    );
}

function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function boundaryPortLabelWidth(label: string): number {
  if (typeof document !== 'undefined') {
    const context = document.createElement('canvas').getContext('2d');
    if (context && typeof context.measureText === 'function') {
      context.font = PORT_LABEL_FONT;
      return context.measureText(label).width;
    }
  }
  return label.length * 7.2;
}

export function sharedBoundaryPortWidth(ports: readonly KGBoundaryPort[] = []): number {
  const longestLabelWidth = Math.max(0, ...ports.map((port) => boundaryPortLabelWidth(port.label)));
  return Math.max(PORT_MIN_WIDTH, Math.ceil(longestLabelWidth + PORT_LABEL_HORIZONTAL_PADDING));
}

function reportGraphError(stage: string, error: unknown): void {
  if (!browserDebugEnabled()) return;
  console.error(`[KGGraphCanvas:${stage}]`, error);
}

type LayoutPosition = { x: number; y: number };
type CompleteWorldNodeStyle = Record<string, unknown> & {
  fill: string;
  labelMaxWidth: 0;
  labelOpacity: 0;
  labelText: '';
  opacity: number;
  size: number;
};
type ClientBounds = { minX: number; minY: number; maxX: number; maxY: number };
type EdgePathCommand = [string, ...number[]];
type GraphFrameRevision = { graphDataRevision: number; frameRevision: number };
type WorldDragFrameJob = GraphFrameRevision & {
  generation: number;
  graphInstance: Graph;
  token: number;
  viewState: KGViewState;
};
type CachedLayoutPosition = LayoutPosition & { categoryID: string };
type LayoutCache = {
  dataVersion: string;
  layoutAlgorithm: typeof WORLD_LAYOUT_ALGORITHM;
  viewportBucket: string;
  positions: Record<string, CachedLayoutPosition>;
};

type GraphEventLike = {
  data?: { id?: string };
  target?: {
    id?: string;
    attributes?: Record<string, unknown>;
    getAttribute?: (name: string) => unknown;
  };
};

export type KGGraphCanvasHandle = {
  fitView: (padding?: number, duration?: number, deadlineBound?: boolean) => Promise<void>;
  resetLayout: () => Promise<void>;
  focusCategory: (categoryID: string, duration: number) => Promise<void>;
  focusNode: (nodeID: string, duration: number) => Promise<void>;
  getZoom: () => number;
  destroy: () => void;
};

export type KGGraphCanvasProps = {
  graph: KGWorldGraph;
  categories: KGCategory[];
  ports?: KGBoundaryPort[];
  selectedNodeID?: string;
  selectedEdgeID?: string;
  activeCategoryID?: string;
  roleByNodeID?: ReadonlyMap<string, KGNodeRole> | Readonly<Record<string, KGNodeRole>>;
  colorEdgesBySourceRole?: boolean;
  viewState: KGViewState;
  dataVersion: string;
  reducedMotion: boolean;
  focusNodeID?: string;
  pathNodeIDs?: ReadonlySet<string>;
  pathEdgeIDs?: ReadonlySet<string>;
  rightViewportInset?: number;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  onNodeClick?: (nodeID: string) => void;
  onEdgeClick?: (edgeID: string) => void;
  onPortClick?: (portID: string) => void;
  onCanvasClick?: () => void;
  onLayoutSettled?: () => void;
  onCanvasUnsupported?: () => void;
  onEscape?: () => void;
};

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function isDetailView(viewState: KGViewState): boolean {
  return viewState === 'CATEGORY_DETAIL' || viewState === 'ENTERING_DETAIL';
}

function isWorldFrameView(viewState: KGViewState): boolean {
  return viewState === 'WORLD' || viewState === 'RETURNING_TO_WORLD';
}

function isTransientView(viewState: KGViewState): boolean {
  return viewState === 'ENTERING_CATEGORY'
    || viewState === 'ENTERING_DETAIL'
    || viewState === 'RETURNING_TO_CATEGORY'
    || viewState === 'RETURNING_TO_WORLD';
}

function layoutSignature(props: Pick<KGGraphCanvasProps, 'activeCategoryID' | 'viewState'>): string {
  return isDetailView(props.viewState) ? `detail|${props.activeCategoryID ?? ''}` : 'world';
}

function layoutDuration(viewState: KGViewState): number {
  if (viewState === 'ENTERING_DETAIL') return ENTERING_DETAIL_LAYOUT_DURATION;
  return isDetailView(viewState) ? DETAIL_LAYOUT_DURATION : WORLD_LAYOUT_DURATION;
}

function roleFor(
  roles: KGGraphCanvasProps['roleByNodeID'],
  nodeID: string,
): KGNodeRole {
  if (isRoleMap(roles)) return roles.get(nodeID) ?? 'normal';
  return roles?.[nodeID] ?? 'normal';
}

function isRoleMap(
  roles: KGGraphCanvasProps['roleByNodeID'],
): roles is ReadonlyMap<string, KGNodeRole> {
  return typeof (roles as ReadonlyMap<string, KGNodeRole> | undefined)?.get === 'function';
}

function currentFocusID(props: KGGraphCanvasProps): string | undefined {
  if ('focusNodeID' in props) return props.focusNodeID;
  if (isRoleMap(props.roleByNodeID)) {
    for (const [nodeID, role] of props.roleByNodeID) {
      if (role === 'current') return nodeID;
    }
    return undefined;
  }
  return Object.entries(props.roleByNodeID ?? {}).find(([, role]) => role === 'current')?.[0];
}

function oneHopNodeIDs(graph: KGWorldGraph, nodeID: string): Set<string> {
  const ids = new Set([nodeID]);
  for (const edge of graph.edges) {
    if (edge.source === nodeID) ids.add(edge.target);
    if (edge.target === nodeID) ids.add(edge.source);
  }
  return ids;
}

function sizeNumber(size: unknown, fallback = 16): number {
  if (typeof size === 'number') return size;
  if (Array.isArray(size) && typeof size[0] === 'number') return size[0];
  return fallback;
}

function layoutStorageKey(viewState: KGViewState, activeCategoryID?: string): string | undefined {
  if (isWorldFrameView(viewState)) return WORLD_LAYOUT_KEY;
  if (isDetailView(viewState) && activeCategoryID) {
    return `${CATEGORY_LAYOUT_KEY_PREFIX}${activeCategoryID}`;
  }
  return undefined;
}

function layoutViewportBucket(size: CanvasSize): string {
  return `${Math.round(size.width)}x${Math.round(size.height)}`;
}

function worldResetLayoutKey(props: KGGraphCanvasProps, size: CanvasSize): string {
  return [
    props.dataVersion,
    `${size.width}x${size.height}`,
    props.graph.nodes.map((node) => node.id).join(','),
    props.graph.edges.map((edge) => edge.id).join(','),
  ].join('|');
}

function readLayoutCache(
  key: string | undefined,
  props: KGGraphCanvasProps,
  canvasSize: CanvasSize,
): Record<string, LayoutPosition> {
  if (!key) return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<LayoutCache>;
    const expectedNodeByID = new Map(props.graph.nodes.map((node) => [node.id, node]));
    const cachedEntries = Object.entries(parsed.positions ?? {});
    const invalidHeader = parsed.dataVersion !== props.dataVersion
      || parsed.layoutAlgorithm !== WORLD_LAYOUT_ALGORITHM
      || parsed.viewportBucket !== layoutViewportBucket(canvasSize);
    const invalidNodeSet = cachedEntries.length !== expectedNodeByID.size
      || cachedEntries.some(([nodeID]) => !expectedNodeByID.has(nodeID));
    if (invalidHeader || invalidNodeSet) {
      window.localStorage.removeItem(key);
      return {};
    }
    const positions: Record<string, LayoutPosition> = {};
    for (const [nodeID, position] of cachedEntries) {
      const node = expectedNodeByID.get(nodeID);
      const categoryID = node?.data.category_id;
      const invalidPosition = position.categoryID !== categoryID
        || !Number.isFinite(position.x)
        || !Number.isFinite(position.y);
      if (invalidPosition) {
        window.localStorage.removeItem(key);
        return {};
      }
      positions[nodeID] = { x: position.x, y: position.y };
    }
    return positions;
  } catch {
    window.localStorage.removeItem(key);
    return {};
  }
}

function writeLayoutCache(
  key: string | undefined,
  props: KGGraphCanvasProps,
  canvasSize: CanvasSize,
  nodes: NodeData[],
): void {
  if (!key) return;
  const expectedNodeByID = new Map(props.graph.nodes.map((node) => [node.id, node]));
  const positions: Record<string, CachedLayoutPosition> = {};
  for (const node of nodes) {
    const expectedNode = expectedNodeByID.get(node.id);
    if (!expectedNode) continue;
    const x = node.style?.x;
    const y = node.style?.y;
    if (typeof x === 'number' && Number.isFinite(x)
      && typeof y === 'number' && Number.isFinite(y)) {
      positions[node.id] = { x, y, categoryID: expectedNode.data.category_id };
    }
  }
  if (Object.keys(positions).length !== expectedNodeByID.size) return;
  window.localStorage.setItem(key, JSON.stringify({
    dataVersion: props.dataVersion,
    layoutAlgorithm: WORLD_LAYOUT_ALGORITHM,
    viewportBucket: layoutViewportBucket(canvasSize),
    positions,
  } satisfies LayoutCache));
}

function worldNodeDiameter(node: KGWorldGraph['nodes'][number]): number {
  return sizeNumber(node.style.size, 10);
}

function worldNodeStyle(
  node: KGWorldGraph['nodes'][number],
  props: KGGraphCanvasProps,
): CompleteWorldNodeStyle {
  const categoryColor = node.style.fill;
  const typeLineDash = node.data.node_type === 'Misconception' ? [4, 3] : [];
  const hasOuterRing = node.data.node_type !== 'Concept';
  return {
    ...node.style,
    cursor: 'pointer',
    lineWidth: 1.5,
    stroke: 'rgba(255,255,255,0.88)',
    lineDash: typeLineDash,
    halo: hasOuterRing,
    haloLineWidth: hasOuterRing ? 3 : 0,
    haloStroke: categoryColor,
    haloOpacity: hasOuterRing ? 1 : 0,
    haloLineDash: typeLineDash,
    shadowType: 'outer',
    shadowBlur: 0,
    shadowColor: 'rgba(242,140,40,0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fill: categoryColor,
    labelText: '',
    labelOpacity: 0,
    labelMaxWidth: 0,
    opacity: 1,
    size: worldNodeDiameter(node),
  };
}

function roleNodeStyle(
  node: KGWorldGraph['nodes'][number],
  props: KGGraphCanvasProps,
): Record<string, unknown> {
  const detail = isDetailView(props.viewState);
  if (!detail) return worldNodeStyle(node, props);
  const role = roleFor(props.roleByNodeID, node.id);
  const isCurrentFocus = role === 'current' && node.id === currentFocusID(props);
  const categoryColor = node.style.fill;
  const nodeType = node.data.node_type;
  const typeLineDash = nodeType === 'Misconception' ? [4, 3] : [];
  const base = {
    ...node.style,
    opacity: detail && props.pathNodeIDs
      ? props.pathNodeIDs.has(node.id) ? 1 : 0.20
      : node.style.opacity ?? 1,
    cursor: 'pointer',
    lineWidth: 1.5,
    stroke: 'rgba(255,255,255,0.88)',
    lineDash: typeLineDash,
  };
  const hasOuterRing = nodeType !== 'Concept' || (detail && role !== 'normal');
  const typeAndRoleRing = {
    halo: hasOuterRing,
    haloLineWidth: hasOuterRing ? 3 : 0,
    haloStroke: categoryColor,
    haloOpacity: hasOuterRing ? 1 : 0,
    haloLineDash: typeLineDash,
  };

  const exactRoleStyle = ROLE_STYLES[role];
  const currentShadow = role === 'current'
    ? {
        shadowType: 'outer',
        shadowBlur: isCurrentFocus && props.reducedMotion ? 16 : 10,
        shadowColor: isCurrentFocus
          ? props.reducedMotion
            ? 'rgba(242,140,40,0.22)'
            : 'rgba(242,140,40,0.42)'
          : 'rgba(242,140,40,0.28)',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      }
    : {
        shadowBlur: 0,
        shadowColor: 'rgba(242,140,40,0)',
      };
  return {
    ...base,
    ...exactRoleStyle,
    fill: 'fill' in exactRoleStyle ? exactRoleStyle.fill : categoryColor,
    labelText: node.data.label,
    labelOpacity: 1,
    labelFontFamily: 'Epilogue, system-ui, sans-serif',
    labelFontSize: 12,
    labelFontWeight: role === 'current' ? 700 : role === 'normal' ? 500 : 600,
    labelFill: '#1F2937',
    labelPlacement: 'bottom',
    labelOffsetY: sizeNumber(exactRoleStyle.size) / 2 + 10,
    labelMaxWidth: 160,
    labelWordWrap: true,
    ...typeAndRoleRing,
    ...currentShadow,
  };
}

function graphBehaviors(
  reducedMotion: boolean,
  interactionLocked = false,
): NonNullable<GraphOptions['behaviors']> {
  if (interactionLocked) return [];
  return [
    {
      type: 'zoom-canvas',
      key: 'kg-wheel-zoom',
      sensitivity: 1,
      animation: reducedMotion ? false : { duration: 300 },
    },
    { type: 'drag-canvas', key: 'kg-canvas-drag', animation: false },
    {
      type: 'drag-element',
      key: 'kg-node-drag',
      animation: false,
      dropEffect: 'none',
    },
  ];
}

function nodeAnimation(reducedMotion: boolean): NonNullable<GraphOptions['node']>['animation'] {
  return reducedMotion
    ? false
    : {
        update: [{
          fields: ['size', 'shadowBlur', 'shadowColor'],
          duration: FOCUS_HALF_CYCLE,
          easing: 'ease-in-out',
        }, {
          fields: ['opacity'],
          duration: CATEGORY_OPACITY_DURATION,
          easing: CAMERA_EASING,
        }],
      };
}

function edgeAnimation(reducedMotion: boolean): NonNullable<GraphOptions['edge']>['animation'] {
  return reducedMotion
    ? false
    : {
        update: [{
          fields: ['opacity'],
          duration: CATEGORY_OPACITY_DURATION,
          easing: CAMERA_EASING,
        }],
      };
}

type CanvasSize = { width: number; height: number };
type BoundarySide = 'top' | 'right' | 'bottom' | 'left';
type LayoutDatum = {
  _original?: NodeData;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
};

function originalLayoutDatum(datum: LayoutDatum): NodeData | LayoutDatum {
  return datum._original ?? datum;
}

function canvasAnchor(category: KGCategory | undefined, size: CanvasSize): LayoutPosition | undefined {
  if (!category) return undefined;
  return {
    x: category.anchor.x * size.width,
    y: category.anchor.y * size.height,
  };
}

function edgeCorridorControlPoints(
  edge: KGWorldGraph['edges'][number],
  categoryByID: ReadonlyMap<string, KGCategory>,
  size: CanvasSize,
  nodePositionByID?: ReadonlyMap<string, LayoutPosition>,
): Array<[number, number]> | undefined {
  if (!edge.data.is_cross_category) return undefined;
  const source = nodePositionByID?.get(edge.source)
    ?? canvasAnchor(categoryByID.get(edge.data.source_category_id), size);
  const target = nodePositionByID?.get(edge.target)
    ?? canvasAnchor(categoryByID.get(edge.data.target_category_id), size);
  if (!source || !target) return undefined;
  const midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
  return [
    [
      source.x * 0.82 + midpoint.x * 0.18,
      source.y * 0.82 + midpoint.y * 0.18,
    ],
    [
      target.x * 0.82 + midpoint.x * 0.18,
      target.y * 0.82 + midpoint.y * 0.18,
    ],
  ];
}

function categoryBoundarySide(active: KGCategory | undefined, external: KGCategory | undefined): BoundarySide {
  const dx = (external?.anchor.x ?? 1) - (active?.anchor.x ?? 0);
  const dy = (external?.anchor.y ?? 0) - (active?.anchor.y ?? 0);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function portPositions(
  props: KGGraphCanvasProps,
  size: CanvasSize,
  viewportToCanvas: (point: [number, number]) => [number, number] = (point) => point,
): Map<string, { x: number; y: number; side: BoundarySide }> {
  if (!isDetailView(props.viewState)) return new Map();
  const categoryByID = new Map(props.categories.map((category) => [category.id, category]));
  const active = categoryByID.get(props.activeCategoryID ?? '');
  const bySide = new Map<BoundarySide, KGBoundaryPort[]>();
  for (const port of props.ports ?? []) {
    const side = categoryBoundarySide(active, categoryByID.get(port.externalCategoryID));
    bySide.set(side, [...(bySide.get(side) ?? []), port]);
  }
  for (const ports of bySide.values()) {
    ports.sort((left, right) => {
      const categoryOrder =
        (categoryByID.get(left.externalCategoryID)?.order ?? Number.MAX_SAFE_INTEGER) -
        (categoryByID.get(right.externalCategoryID)?.order ?? Number.MAX_SAFE_INTEGER);
      const directionOrder = Number(left.direction === 'outgoing') - Number(right.direction === 'outgoing');
      return categoryOrder || directionOrder || left.id.localeCompare(right.id);
    });
  }
  const placementInset = PORT_BOUNDARY_INSET + PORT_RENDER_BOUNDS_GUARD;
  const portWidth = sharedBoundaryPortWidth(props.ports);
  const drawableWidth = Math.max(
    placementInset * 2 + portWidth,
    size.width - Math.max(0, props.rightViewportInset ?? 0),
  );
  const minX = placementInset + portWidth / 2;
  const maxX = drawableWidth - minX;
  const minY = placementInset + PORT_HEIGHT / 2;
  const maxY = size.height - minY;
  const minimumHorizontalSpacing = portWidth
    + PORT_RENDER_BOUNDS_GUARD * 2
    + PORT_MINIMUM_SCREEN_GAP;
  const horizontalCapacity = Math.max(
    1,
    Math.floor((maxX - minX) / minimumHorizontalSpacing) + 1,
  );
  for (const side of ['top', 'bottom'] as const) {
    const ports = bySide.get(side) ?? [];
    if (ports.length <= horizontalCapacity) continue;
    const overflow = ports.splice(horizontalCapacity);
    for (const port of overflow) {
      const right = bySide.get('right') ?? [];
      const left = bySide.get('left') ?? [];
      const destinationSide: BoundarySide = right.length <= left.length ? 'right' : 'left';
      bySide.set(destinationSide, [...(bySide.get(destinationSide) ?? []), port]);
    }
  }
  const minimumVerticalSpacing = PORT_HEIGHT
    + PORT_RENDER_BOUNDS_GUARD * 2
    + PORT_MINIMUM_SCREEN_GAP;
  const verticalMinimum = minY + ((bySide.get('top')?.length ?? 0) > 0 ? minimumVerticalSpacing : 0);
  const verticalMaximum = maxY - ((bySide.get('bottom')?.length ?? 0) > 0 ? minimumVerticalSpacing : 0);
  const result = new Map<string, { x: number; y: number; side: BoundarySide }>();
  for (const [side, ports] of bySide) {
    const horizontal = side === 'top' || side === 'bottom';
    const leftPreferredStart = Math.max(verticalMinimum, Math.min(264, verticalMaximum));
    const spacing = horizontal
      ? HORIZONTAL_PORT_SPACING
      : ports.length > 1
        ? Math.min(
            VERTICAL_PORT_SPACING,
            ((side === 'left'
              ? verticalMaximum - leftPreferredStart
              : verticalMaximum - verticalMinimum) / (ports.length - 1)),
          )
        : VERTICAL_PORT_SPACING;
    const preferredStart = side === 'top'
      ? maxX - (ports.length - 1) * spacing
      : side === 'bottom'
        ? drawableWidth / 2 - ((ports.length - 1) * spacing) / 2
        : side === 'left'
          ? leftPreferredStart
          : Math.max(70, verticalMinimum);
    const minimum = horizontal ? minX : verticalMinimum;
    const maximumStart = (horizontal ? maxX : verticalMaximum) - (ports.length - 1) * spacing;
    const start = Math.max(minimum, Math.min(maximumStart, preferredStart));
    ports.forEach((port, index) => {
      const offset = start + index * spacing;
      const viewportPosition: [number, number] = [
        horizontal ? offset : side === 'right' ? maxX : minX,
        horizontal ? side === 'bottom' ? maxY : minY : offset,
      ];
      const [x, y] = viewportToCanvas(viewportPosition);
      result.set(port.id, {
        x,
        y,
        side,
      });
    });
  }
  return result;
}

function stubRelationCount(port: KGBoundaryPort, insideNodeID: string): number {
  return new Set(port.relationKeys.filter((relationKey) => {
    const parts = relationKey.split('|');
    const relationInsideNodeID = port.direction === 'incoming' ? parts.at(-1) : parts[0];
    return relationInsideNodeID === insideNodeID;
  })).size;
}

function seededNodePositions(
  props: KGGraphCanvasProps,
  canvasSize: CanvasSize,
): Map<string, LayoutPosition> {
  const categoryByID = new Map(props.categories.map((category) => [category.id, category]));
  const nodesByCategory = new Map<string, KGWorldGraph['nodes']>();
  for (const node of props.graph.nodes) {
    const categoryID = node.data.category_id;
    nodesByCategory.set(categoryID, [...(nodesByCategory.get(categoryID) ?? []), node]);
  }
  const positions = new Map<string, LayoutPosition>();
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (const [categoryID, categoryNodes] of nodesByCategory) {
    const category = categoryByID.get(categoryID);
    const center = isDetailView(props.viewState)
      ? { x: canvasSize.width * 0.56, y: canvasSize.height * 0.52 }
      : canvasAnchor(category, canvasSize) ?? {
          x: canvasSize.width / 2,
          y: canvasSize.height / 2,
        };
    const categoryPhase = (category?.order ?? 0) * 0.37;
    categoryNodes
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((node, index) => {
        const radius = index === 0 ? 0 : 20 + Math.sqrt(index) * 22;
        const angle = categoryPhase + index * goldenAngle;
        const rawPosition = {
          x: Math.min(canvasSize.width - 36, Math.max(36, center.x + Math.cos(angle) * radius)),
          y: Math.min(canvasSize.height - 36, Math.max(36, center.y + Math.sin(angle) * radius)),
        };
        positions.set(node.id, rawPosition);
      });
  }
  return positions;
}

function toGraphData(
  props: KGGraphCanvasProps,
  canvasSize: CanvasSize = DEFAULT_CANVAS_SIZE,
  cachedPositions?: Record<string, LayoutPosition>,
): GraphData {
  const storageKey = layoutStorageKey(props.viewState, props.activeCategoryID);
  const positions = cachedPositions ?? readLayoutCache(storageKey, props, canvasSize);
  const detail = isDetailView(props.viewState);
  const selectedNeighborhood = detail && props.selectedNodeID && props.pathNodeIDs === undefined
    ? oneHopNodeIDs(props.graph, props.selectedNodeID)
    : undefined;
  const categoryByID = new Map(props.categories.map((category) => [category.id, category]));
  const fixedPorts = portPositions(props, canvasSize);
  const portWidth = sharedBoundaryPortWidth(props.ports);
  const seededPositions = seededNodePositions(props, canvasSize);
  const nodes: NodeData[] = props.graph.nodes.map((node) => ({
    id: node.id,
    data: node.data as unknown as Record<string, unknown>,
    states: detail && node.id === props.selectedNodeID ? ['selected'] : [],
    style: {
      ...roleNodeStyle(node, props),
      ...(selectedNeighborhood
        ? { opacity: selectedNeighborhood.has(node.id) ? 1 : 0.14 }
        : {}),
      ...seededPositions.get(node.id),
      ...positions[node.id],
    },
  }));

  for (const port of props.ports ?? []) {
    const position = fixedPorts.get(port.id);
    nodes.push({
      id: port.id,
      data: {
        ...port,
        isBoundaryPort: true,
        fixed: Boolean(position),
        fx: position?.x,
        fy: position?.y,
        boundarySide: position?.side,
      },
      style: {
        size: [portWidth, PORT_HEIGHT],
        fill: '#D4B895',
        stroke: '#606C38',
        lineWidth: PORT_LINE_WIDTH,
        radius: 16,
        labelText: port.label,
        labelFill: '#1F2937',
        labelFontFamily: 'Epilogue, system-ui, sans-serif',
        labelFontSize: 12,
        labelPlacement: 'center',
        ...(position ? { x: position.x, y: position.y } : {}),
      },
      type: 'rect',
    });
  }

  const edges = props.graph.edges.map((edge) => {
    const sourceCategoryColor = categoryByID.get(edge.data.source_category_id)?.color ?? '#64748B';
    const sourceRole = roleFor(props.roleByNodeID, edge.source);
    const sourceRoleStroke = props.colorEdgesBySourceRole && sourceRole !== 'normal'
      ? ROLE_STYLES[sourceRole].fill
      : undefined;
    const crossBundle = !detail && edge.data.is_cross_category;
    const hasPathOverlay = detail && props.pathEdgeIDs !== undefined;
    const isPathEdge = hasPathOverlay && props.pathEdgeIDs?.has(edge.id);
    const isNeighborhoodEdge = selectedNeighborhood?.has(edge.source)
      && selectedNeighborhood?.has(edge.target)
      && (edge.source === props.selectedNodeID || edge.target === props.selectedNodeID);
      const controlPoints = crossBundle
        ? edgeCorridorControlPoints(edge, categoryByID, canvasSize)
        : undefined;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: crossBundle ? 'polyline' : 'line',
        data: {
          ...(edge.data as unknown as Record<string, unknown>),
          ...(crossBundle ? { bundleStrength: 0.18 } : {}),
        },
        style: {
          cursor: 'pointer',
          endArrow: true,
          endArrowSize: 5,
          lineWidth:
            isPathEdge
              ? 3
              : detail && edge.id === props.selectedEdgeID
              ? 2.5
              : detail
                ? 1.25
                : edge.data.is_cross_category
                  ? 1.4
                  : 1,
          opacity:
            props.viewState === 'ENTERING_CATEGORY'
              && props.activeCategoryID
              && (edge.data.source_category_id !== props.activeCategoryID
                || edge.data.target_category_id !== props.activeCategoryID)
              ? 0
              : hasPathOverlay
              ? isPathEdge ? 0.96 : 0.08
              : selectedNeighborhood
              ? isNeighborhoodEdge ? 0.9 : 0.06
              : detail && edge.id === props.selectedEdgeID
              ? 0.82
              : detail
                ? 0.24
                : edge.data.is_cross_category
                  ? 0.28
                  : 0.18,
          stroke: sourceRoleStroke ?? (isPathEdge
            ? '#F28C28'
            : detail || edge.data.is_cross_category
              ? '#64748B'
              : sourceCategoryColor),
          ...(isPathEdge ? { endArrowSize: [8, 6] } : {}),
          ...(crossBundle
            ? { bundleStrength: 0.18, controlPoints, radius: 18 }
            : {}),
        },
      };
    });
  const stubs = detail
    ? (props.ports ?? []).flatMap((port) =>
        [...port.insideNodeIDs].sort().map((insideNodeID) => ({
          id: `boundary-stub:${insideNodeID}:${port.id}`,
          source: port.direction === 'incoming' ? port.id : insideNodeID,
          target: port.direction === 'incoming' ? insideNodeID : port.id,
          type: 'line',
          data: {
            isBoundaryStub: true,
            portID: port.id,
            direction: port.direction,
            relation_count: stubRelationCount(port, insideNodeID),
          },
          style: {
            endArrow: true,
            endArrowSize: 5,
            lineWidth: 1.25,
            opacity: props.pathEdgeIDs !== undefined ? 0.08 : 0.24,
            stroke: '#64748B',
          },
        })),
      )
    : [];
  return {
    nodes,
    edges: [...edges, ...stubs] as GraphData['edges'],
  };
}

function worldCorridorUpdates(
  props: KGGraphCanvasProps,
  canvasSize: CanvasSize,
  nodePositions: ReadonlyArray<WorldLayoutPoint> = [],
) {
  if (isDetailView(props.viewState)) return [];
  const categoryByID = new Map(props.categories.map((category) => [category.id, category]));
  const nodePositionByID = new Map(nodePositions.flatMap((position) => position.id
    ? [[position.id, { x: position.x, y: position.y }] as const]
    : []));
  return props.graph.edges.flatMap((edge) => {
    const controlPoints = edgeCorridorControlPoints(
      edge,
      categoryByID,
      canvasSize,
      nodePositionByID,
    );
    return controlPoints
      ? [{
          id: edge.id,
          type: 'polyline' as const,
          data: { bundleStrength: 0.18 },
          style: { bundleStrength: 0.18, controlPoints, radius: 18 },
        }]
      : [];
  });
}

function readFiniteNodePositions(
  graph: Graph,
  props: KGGraphCanvasProps,
): Array<WorldLayoutPoint & { id: string }> {
  return props.graph.nodes.map((node) => {
    const [x, y] = graph.getElementPosition(node.id);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Node ${node.id} has a non-finite rendered position.`);
    }
    return { id: node.id, category_id: node.data.category_id, x, y };
  });
}

function sameNodePositions(
  left: ReadonlyArray<WorldLayoutPoint & { id: string }>,
  right: ReadonlyArray<WorldLayoutPoint & { id: string }>,
): boolean {
  if (left.length !== right.length) return false;
  const rightByID = new Map(right.map((point) => [point.id, point]));
  return left.every((point) => {
    const candidate = rightByID.get(point.id);
    return candidate?.x === point.x && candidate.y === point.y;
  });
}

function readWorldScreenLayoutMetrics(
  graph: Graph,
  props: KGGraphCanvasProps,
  canvasSize: CanvasSize,
): WorldLayoutMetrics {
  const points = props.graph.nodes.flatMap((node) => {
    try {
      const modelPosition = graph.getElementPosition(node.id);
      const renderStyle = graph.getElementRenderStyle(node.id);
      const x = Number.isFinite(Number(renderStyle.x)) ? Number(renderStyle.x) : modelPosition[0];
      const y = Number.isFinite(Number(renderStyle.y)) ? Number(renderStyle.y) : modelPosition[1];
      const [clientX, clientY] = graph.getClientByCanvas([x, y]);
      return Number.isFinite(clientX) && Number.isFinite(clientY)
        ? [{ id: node.id, category_id: node.data.category_id, x: clientX, y: clientY }]
        : [];
    } catch {
      return [];
    }
  });
  return measureWorldLayout(points, props.categories, canvasSize);
}

function isAcceptedWorldScreenLayout(metrics: WorldLayoutMetrics): boolean {
  return metrics.finitePositionCount === 83
    && metrics.nodeBoundsRatio.width >= 0.68
    && metrics.nodeBoundsRatio.width <= 0.90
    && metrics.nodeBoundsRatio.height >= 0.62
    && metrics.nodeBoundsRatio.height <= 0.88
    && metrics.nearestNeighborMedianRatio >= 0.018
    && metrics.nearestNeighborMedianRatio <= 0.055
    && metrics.nearestNeighborMaximumRatio <= 0.11
    && metrics.maximumCategoryCentroidDistanceRatio <= 0.50;
}

function assertWorldModelLayoutMetrics(
  points: ReadonlyArray<WorldLayoutPoint>,
  categories: KGCategory[],
  canvasSize: CanvasSize,
): void {
  const metrics = measureWorldModelLayout([...points], categories, canvasSize);
  const values = [
    metrics.nearestNeighborMedianRatio,
    metrics.nearestNeighborMaximumRatio,
    metrics.maximumCategoryCentroidDistanceRatio,
  ];
  if (
    metrics.finitePositionCount !== points.length
    || values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('WORLD layout metrics contain incomplete or non-finite node geometry.');
  }
}

function commandEndpoint(command: EdgePathCommand): [number, number] | undefined {
  if (command[0].toUpperCase() === 'Z' || command.length < 3) return undefined;
  const x = command.at(-2);
  const y = command.at(-1);
  return typeof x === 'number' && Number.isFinite(x)
    && typeof y === 'number' && Number.isFinite(y)
    ? [x, y]
    : undefined;
}

function renderedEdgeEndpoints(
  graph: Graph,
  id: string,
): { source: [number, number]; target: [number, number] } | undefined {
  const edge = (graph as unknown as {
    context?: {
      element?: {
        getElement?: (elementID: string) => {
          getShape?: (name: string) => {
            parsedStyle?: { d?: { absolutePath?: unknown } };
          } | undefined;
        } | undefined;
      };
    };
  }).context?.element?.getElement?.(id);
  const path = edge?.getShape?.('key')?.parsedStyle?.d?.absolutePath;
  if (!Array.isArray(path)) return undefined;
  const commands = path.filter((command): command is EdgePathCommand =>
    Array.isArray(command) && typeof command[0] === 'string');
  const source = commands.map(commandEndpoint).find((point) => point !== undefined);
  const target = [...commands].reverse().map(commandEndpoint).find((point) => point !== undefined);
  if (!source || !target) return undefined;
  return { source, target };
}

function distanceToBoundsBoundary(
  point: { x: number; y: number },
  bounds: ClientBounds,
): number {
  const insideX = point.x >= bounds.minX && point.x <= bounds.maxX;
  const insideY = point.y >= bounds.minY && point.y <= bounds.maxY;
  if (insideX && insideY) {
    return Math.min(
      point.x - bounds.minX,
      bounds.maxX - point.x,
      point.y - bounds.minY,
      bounds.maxY - point.y,
    );
  }
  return Math.hypot(
    point.x - Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
    point.y - Math.max(bounds.minY, Math.min(bounds.maxY, point.y)),
  );
}

function buildLayout(
  props: KGGraphCanvasProps,
  canvasSize: CanvasSize = DEFAULT_CANVAS_SIZE,
): NonNullable<GraphOptions['layout']> {
  const detail = isDetailView(props.viewState);
  const categoryByID = new Map(props.categories.map((category) => [category.id, category]));
  const categoryOrder = categoryByID.get(props.activeCategoryID ?? '')?.order ?? 0;
  const seed = 20260715 + (detail ? categoryOrder : 0);

  return detail
    ? {
        type: 'd3-force',
        animation: false,
        enableWorker: false,
        iterations: 72,
        nodeFilter: (datum: LayoutDatum) => !originalLayoutDatum(datum).data?.isBoundaryPort,
        linkDistance: 96,
        edgeStrength: 0.28,
        nodeStrength: -220,
        collide: {
          radius: (datum: LayoutDatum) => {
            const node = originalLayoutDatum(datum);
            const label = String(node.data?.label ?? '');
            return sizeNumber(node.style?.size) / 2 + Math.min(80, label.length * 6) + 18;
          },
        },
        alpha: 0.8,
        alphaDecay: 0.045,
        alphaMin: 0.03,
        randomSource: seededRandom(seed),
      }
    : buildWorldForceLayout(props.categories, canvasSize) as NonNullable<GraphOptions['layout']>;
}

function buildPlugins(props: KGGraphCanvasProps): NonNullable<GraphOptions['plugins']> {
  const categoryByID = new Map(props.categories.map((category) => [category.id, category]));
  return [{
    type: 'tooltip',
    key: 'kg-node-tooltip',
    trigger: 'hover',
    style: {
      '.tooltip': {
        transition: 'none',
      },
    },
    enable: (_event: unknown, items: Array<{ data?: Record<string, unknown> }>) =>
      Boolean(items[0]?.data?.node_id) && !items[0].data?.isBoundaryPort,
    getContent: async (_event: unknown, items: Array<{ id?: string; data?: Record<string, unknown> }>) => {
      const item = items[0];
      if (!item) return document.createElement('div');
      const data = item.data ?? {};
      const category = categoryByID.get(String(data.category_id ?? ''));
      const root = document.createElement('div');
      root.className = 'kg-node-tooltip';
      const fields = [
        ['Label', String(data.label ?? item.id ?? '')],
        ['Node ID', String(data.node_id ?? item.id ?? '')],
        ['Category', category?.label_zh ?? String(data.category_id ?? '')],
        ['Degree', String(data.unique_relation_degree ?? 0)],
      ];
      for (const [label, value] of fields) {
        const row = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = `${label}: `;
        row.append(strong, document.createTextNode(value));
        root.appendChild(row);
      }
      return root;
    },
    onOpenChange: () => undefined,
  }];
}

function canvasSupported(): boolean {
  try {
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
}

function eventID(event: GraphEventLike): string {
  return String(event.target?.id ?? event.data?.id ?? '');
}

export const KGGraphCanvas = forwardRef<KGGraphCanvasHandle, KGGraphCanvasProps>(
  function KGGraphCanvas(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasHostRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<Graph | null>(null);
    const propsRef = useRef(props);
    const initialPropsRef = useRef(props);
    const previousDataRef = useRef(props.graph);
    const previousViewStateRef = useRef(props.viewState);
    const previousLayoutSignatureRef = useRef(
      layoutSignature(props),
    );
    const layoutTimerRef = useRef<number | undefined>(undefined);
    const layoutRunRef = useRef(0);
    const settledLayoutRunRef = useRef(-1);
    const settledLayoutStartedAtRef = useRef<number | undefined>(undefined);
    const layoutWaitersRef = useRef(new Map<number, { promise: Promise<void>; resolve: () => void }>());
    const lifecycleGenerationRef = useRef(0);
    const presentationGenerationRef = useRef(0);
    const focusGenerationRef = useRef(0);
    const presentedGraphRef = useRef<Graph | null>(null);
    const destroyedGraphsRef = useRef(new WeakSet<Graph>());
    const focusTimerRef = useRef<number | undefined>(undefined);
    const nodeClickTimerRef = useRef<number | undefined>(undefined);
    const lastNodeDragEndedAtRef = useRef(Number.NEGATIVE_INFINITY);
    const hideTooltipOutsideCanvasRef = useRef<() => void>(() => undefined);
    const animatedFocusRef = useRef<string | undefined>(undefined);
    const lastCanvasSizeRef = useRef<CanvasSize | undefined>(undefined);
    const debugMountedRef = useRef(true);
    const debugCanvasStartedAtRef = useRef(monotonicNow());
    const debugLayoutStartedAtRef = useRef(new Map<number, number>());
    const debugPaintedGraphsRef = useRef(new WeakSet<Graph>());
    const initialDrawCompletedGraphsRef = useRef(new WeakSet<Graph>());
    const finalizingLayoutRunsRef = useRef(new Set<number>());
    const graphDataRevisionRef = useRef(0);
    const frameRevisionRef = useRef(0);
    const pendingLayoutStartRef = useRef<{
      graphInstance: Graph;
      generation: number;
      run: number;
      duration: number;
      isCurrentUpdate: () => boolean;
    } | undefined>(undefined);
    const pendingLayoutStartFrameRef = useRef<number | undefined>(undefined);
    const layoutStabilityFrameRef = useRef<{
      frameID: number;
      graphInstance: Graph;
      generation: number;
      run: number;
      isCurrentUpdate: () => boolean;
      previousSignature: string | undefined;
      stableFrameCount: number;
    } | undefined>(undefined);
    const dragSnapshotFrameRef = useRef<number | undefined>(undefined);
    const dragSnapshotTokenRef = useRef(0);
    const dragDrawInFlightRef = useRef<WorldDragFrameJob | undefined>(undefined);
    const pendingDragOriginRef = useRef<WorldDragFrameJob | undefined>(undefined);
    const queuedWorldDragFrameRef = useRef<WorldDragFrameJob | undefined>(undefined);
    const worldResetPositionsRef = useRef(new Map<
      string,
      Array<WorldLayoutPoint & { id: string }>
    >());
    const layoutSourceRef = useRef<KGLayoutSource>('force');
    const settledWorldModelRef = useRef<{
      metrics: WorldModelLayoutMetrics;
      nodes: Array<WorldLayoutPoint & { id: string }>;
      source: KGLayoutSource;
      canvasSize: CanvasSize;
    } | null>(null);
    const worldGeometryDrawsInFlightRef = useRef(new WeakMap<Graph, number>());
    propsRef.current = props;

    const isCurrentGraph = (graphInstance: Graph, generation: number) =>
      graphRef.current === graphInstance &&
      !destroyedGraphsRef.current.has(graphInstance) &&
      lifecycleGenerationRef.current === generation;

    const currentCanvasSize = (): CanvasSize => ({
      width: containerRef.current?.clientWidth || DEFAULT_CANVAS_SIZE.width,
      height: containerRef.current?.clientHeight || DEFAULT_CANVAS_SIZE.height,
    });

    const currentGraphFrameRevision = (): GraphFrameRevision => ({
      graphDataRevision: graphDataRevisionRef.current,
      frameRevision: frameRevisionRef.current,
    });

    const bumpGraphDataRevision = (): GraphFrameRevision => {
      graphDataRevisionRef.current += 1;
      frameRevisionRef.current += 1;
      return currentGraphFrameRevision();
    };

    const isCurrentGraphFrameRevision = (revision: GraphFrameRevision) =>
      graphDataRevisionRef.current === revision.graphDataRevision
      && frameRevisionRef.current === revision.frameRevision;

    const drawWorldGeometry = async (graphInstance: Graph): Promise<void> => {
      const tracked = isWorldFrameView(propsRef.current.viewState);
      if (tracked) {
        const drawsInFlight = worldGeometryDrawsInFlightRef.current;
        drawsInFlight.set(graphInstance, (drawsInFlight.get(graphInstance) ?? 0) + 1);
      }
      try {
        await graphInstance.draw();
      } finally {
        if (tracked) {
          const drawsInFlight = worldGeometryDrawsInFlightRef.current;
          const remaining = (drawsInFlight.get(graphInstance) ?? 1) - 1;
          if (remaining > 0) drawsInFlight.set(graphInstance, remaining);
          else drawsInFlight.delete(graphInstance);
        }
      }
    };

    const publishDebugSnapshot = (
      graphInstance: Graph,
      phase: KGGraphDebugPhase,
      startedAt = debugCanvasStartedAtRef.current,
    ) => {
      if (
        !browserDebugEnabled()
        || !debugMountedRef.current
        || graphRef.current !== graphInstance
        || destroyedGraphsRef.current.has(graphInstance)
      ) return;
      const currentProps = propsRef.current;
      const renderedLabelReadErrorNodeIDs: string[] = [];
      let visibleRenderedLabelCount = 0;
      for (const node of currentProps.graph.nodes) {
        try {
          const renderStyle = graphInstance.getElementRenderStyle(node.id);
          const labelText = typeof renderStyle.labelText === 'string'
            ? renderStyle.labelText
            : '';
          const labelOpacity = Number.isFinite(Number(renderStyle.labelOpacity))
            ? Number(renderStyle.labelOpacity)
            : 1;
          if (labelText.trim().length > 0 && labelOpacity > 0) {
            visibleRenderedLabelCount += 1;
          }
        } catch {
          renderedLabelReadErrorNodeIDs.push(node.id);
        }
      }
      const renderedLabelCount = renderedLabelReadErrorNodeIDs.length === 0
        ? visibleRenderedLabelCount
        : null;
      const renderedBounds = (id: string) => {
        try {
          const bounds = graphInstance.getElementRenderBounds(id);
          const [firstX, firstY] = graphInstance.getClientByCanvas([bounds.min[0], bounds.min[1]]);
          const [secondX, secondY] = graphInstance.getClientByCanvas([bounds.max[0], bounds.max[1]]);
          const clientBounds = {
            minX: Math.min(firstX, secondX),
            minY: Math.min(firstY, secondY),
            maxX: Math.max(firstX, secondX),
            maxY: Math.max(firstY, secondY),
          };
          return Object.values(clientBounds).every(Number.isFinite) ? clientBounds : undefined;
        } catch {
          return undefined;
        }
      };
      const positioned = (id: string) => {
        try {
          const modelPosition = graphInstance.getElementPosition(id);
          const renderStyle = graphInstance.getElementRenderStyle(id);
          const x = Number.isFinite(Number(renderStyle.x)) ? Number(renderStyle.x) : modelPosition[0];
          const y = Number.isFinite(Number(renderStyle.y)) ? Number(renderStyle.y) : modelPosition[1];
          const opacity = Number.isFinite(Number(renderStyle.opacity))
            ? Number(renderStyle.opacity)
            : 1;
          const renderedSize = sizeNumber(renderStyle.size, 0);
          const fill = String(renderStyle.fill ?? '');
          const shadowBlur = Number.isFinite(Number(renderStyle.shadowBlur))
            ? Number(renderStyle.shadowBlur)
            : 0;
          const shadowColor = String(renderStyle.shadowColor ?? '');
          const bounds = renderedBounds(id);
          if (!bounds) return undefined;
          const [clientX, clientY] = graphInstance.getClientByCanvas([x, y]);
          return Number.isFinite(clientX) && Number.isFinite(clientY)
            ? {
                id,
                clientX,
                clientY,
                opacity,
                size: renderedSize,
                fill,
                shadowBlur,
                shadowColor,
                ...bounds,
              }
            : undefined;
        } catch {
          return undefined;
        }
      };
      const nodes = currentProps.graph.nodes.flatMap((node) => {
        const point = positioned(node.id);
        return point ? [point] : [];
      });
      const positionedPort = (id: string) => {
        const point = positioned(id);
        if (!point) return undefined;
        const halfWidth = sharedBoundaryPortWidth(currentProps.ports) / 2 + PORT_RENDER_BOUNDS_GUARD;
        const halfHeight = PORT_HEIGHT / 2 + PORT_RENDER_BOUNDS_GUARD;
        return {
          ...point,
          minX: point.clientX - halfWidth,
          minY: point.clientY - halfHeight,
          maxX: point.clientX + halfWidth,
          maxY: point.clientY + halfHeight,
        };
      };
      const ports = (currentProps.ports ?? []).flatMap((port) => {
        const point = positionedPort(port.id);
        return point ? [point] : [];
      });
      const nodePointByID = new Map(nodes.map((node) => [node.id, node]));
      const edges = currentProps.graph.edges.flatMap((edge) => {
        const source = nodePointByID.get(edge.source);
        const target = nodePointByID.get(edge.target);
        if (!source || !target) return [];
        let lineWidth = 0;
        let opacity = 1;
        let stroke = '';
        let endArrow = false;
        let states: string[] = [];
        try {
          const renderStyle = graphInstance.getElementRenderStyle(edge.id);
          const renderedLineWidth = Number(renderStyle.lineWidth);
          const renderedOpacity = Number(renderStyle.opacity);
          const renderedStroke = renderStyle.stroke;
          lineWidth = Number.isFinite(renderedLineWidth) ? renderedLineWidth : 0;
          opacity = Number.isFinite(renderedOpacity) ? renderedOpacity : 1;
          stroke = typeof renderedStroke === 'string'
            ? renderedStroke
            : String(renderedStroke ?? '');
          endArrow = renderStyle.endArrow === true;
          states = graphInstance.getElementState(edge.id).map(String);
        } catch {
          // A transform event can precede construction of the corresponding edge element.
        }
        return [{
          id: edge.id,
          source: edge.source,
          target: edge.target,
          clientX: (source.clientX + target.clientX) / 2,
          clientY: (source.clientY + target.clientY) / 2,
          lineWidth,
          opacity,
          stroke,
          endArrow,
          states,
        }];
      });
      const renderedEdges = currentProps.graph.edges.flatMap((edge) => {
        const source = nodePointByID.get(edge.source);
        const target = nodePointByID.get(edge.target);
        const bounds = renderedBounds(edge.id);
        const endpoints = renderedEdgeEndpoints(graphInstance, edge.id);
        if (!source || !target || !bounds || !endpoints) return [];
        const [sourceX, sourceY] = graphInstance.getClientByCanvas(endpoints.source);
        const [targetX, targetY] = graphInstance.getClientByCanvas(endpoints.target);
        if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) return [];
        return [{
          id: edge.id,
          source: edge.source,
          target: edge.target,
          bounds,
          sourceAttachmentDistance: distanceToBoundsBoundary(
            { x: sourceX, y: sourceY },
            source,
          ),
          targetAttachmentDistance: distanceToBoundsBoundary(
            { x: targetX, y: targetY },
            target,
          ),
          sourceRadius: Math.max(source.maxX - source.minX, source.maxY - source.minY) / 2,
          targetRadius: Math.max(target.maxX - target.minX, target.maxY - target.minY) / 2,
        }];
      });
      const timestamp = monotonicNow();
      let screenLayoutMetrics: WorldLayoutMetrics | null = null;
      if (currentProps.viewState === 'WORLD') {
        try {
          const categoryByNodeID = new Map(
            currentProps.graph.nodes.map((node) => [node.id, node.data.category_id]),
          );
          screenLayoutMetrics = measureWorldLayout(
            nodes.map((node) => ({
              id: node.id,
              category_id: categoryByNodeID.get(node.id) ?? '',
              x: node.clientX,
              y: node.clientY,
            })),
            currentProps.categories,
            currentCanvasSize(),
          );
        } catch {
          screenLayoutMetrics = null;
        }
      }
      let zoom = 1;
      let cameraX = 0;
      let cameraY = 0;
      try {
        zoom = graphInstance.getZoom();
      } catch {
        // G6 emits its first draw before the camera is initialized.
      }
      try {
        [cameraX, cameraY] = graphInstance.getPosition();
      } catch {
        // The initial draw is still a valid paint milestone with the default origin.
      }
      const detail: KGGraphDebugDetail = {
        phase,
        timestamp,
        elapsedMs: timestamp - startedAt,
        viewState: currentProps.viewState,
        activeCategoryID: currentProps.activeCategoryID ?? '',
        nodeCount: currentProps.graph.nodes.length,
        edgeCount: currentProps.graph.edges.length,
        crossCategoryEdgeCount: currentProps.graph.edges.filter(
          (edge) => edge.data.is_cross_category,
        ).length,
        renderedLabelCount,
        renderedLabelReadErrorNodeIDs,
        modelLayoutMetrics: settledWorldModelRef.current?.metrics ?? null,
        screenLayoutMetrics,
        layoutSource: settledWorldModelRef.current?.source ?? null,
        canvasSize: currentCanvasSize(),
        layoutCanvasSize: settledWorldModelRef.current?.canvasSize ?? null,
        modelNodes: settledWorldModelRef.current?.nodes.map((node) => ({ ...node })) ?? [],
        zoom,
        camera: { x: cameraX, y: cameraY },
        focusNodeID: currentFocusID(currentProps),
        nodes,
        edges,
        renderedEdges,
        ports,
      };
      window.dispatchEvent(new CustomEvent<KGGraphDebugDetail>(KG_GRAPH_DEBUG_EVENT, { detail }));
    };

    const publishFirstPaint = (graphInstance: Graph) => {
      if (debugPaintedGraphsRef.current.has(graphInstance)) return;
      debugPaintedGraphsRef.current.add(graphInstance);
      publishDebugSnapshot(graphInstance, 'first-paint');
    };

    const drawModelUpdates = (
      graphInstance: Graph,
      generation: number,
      isCurrentUpdate: () => boolean,
      onDrawn?: () => void,
    ) => {
      if (!isCurrentGraph(graphInstance, generation) || !isCurrentUpdate()) return;
      void drawWorldGeometry(graphInstance)
        .then(() => {
          if (!isCurrentGraph(graphInstance, generation) || !isCurrentUpdate()) return;
          onDrawn?.();
        })
        .catch((error) => reportGraphError('model-draw', error));
    };

    const reapplyWorldCorridors = (
      graphInstance: Graph,
      generation: number,
    ): boolean => {
      if (!isCurrentGraph(graphInstance, generation)) return false;
      const currentProps = propsRef.current;
      const nodePositions = isDetailView(currentProps.viewState)
        ? []
        : readFiniteNodePositions(graphInstance, currentProps);
      const updates = worldCorridorUpdates(
        currentProps,
        currentCanvasSize(),
        nodePositions,
      );
      if (updates.length > 0) {
        graphInstance.updateEdgeData(updates);
        if (isWorldFrameView(propsRef.current.viewState)) bumpGraphDataRevision();
      }
      return updates.length > 0;
    };

    const synchronizeWorldCorridors = (
      graphInstance: Graph,
      generation: number,
      isCurrentUpdate: () => boolean,
      onSynchronized?: () => void,
    ) => {
      if (!isCurrentGraph(graphInstance, generation) || !isCurrentUpdate()) return;
      if (!reapplyWorldCorridors(graphInstance, generation)) {
        onSynchronized?.();
        return;
      }
      drawModelUpdates(graphInstance, generation, isCurrentUpdate, onSynchronized);
    };

    const updateBoundaryPortPositions = (graphInstance: Graph, generation: number): boolean => {
      if (!isCurrentGraph(graphInstance, generation)) return false;
      const bounds = containerRef.current?.getBoundingClientRect();
      const positions = portPositions(
        propsRef.current,
        currentCanvasSize(),
        (point) => graphInstance.getCanvasByClient([
          point[0] + (bounds?.left ?? 0),
          point[1] + (bounds?.top ?? 0),
        ]),
      );
      const updates = (propsRef.current.ports ?? []).flatMap((port) => {
        const position = positions.get(port.id);
        return position
          ? [{
              id: port.id,
              data: {
                fixed: true,
                fx: position.x,
                fy: position.y,
                boundarySide: position.side,
              },
              style: {
                x: position.x,
                y: position.y,
                size: [sharedBoundaryPortWidth(propsRef.current.ports), PORT_HEIGHT],
                radius: 16,
                lineWidth: PORT_LINE_WIDTH,
                labelFontSize: 12,
              },
            }]
          : [];
      });
      if (updates.length > 0) graphInstance.updateNodeData(updates);
      return updates.length > 0;
    };

    const synchronizePresentationGeometry = (
      graphInstance: Graph,
      generation: number,
      isCurrentUpdate: () => boolean,
      onSynchronized?: () => void,
    ) => {
      const synchronizeCorridors = () => synchronizeWorldCorridors(
        graphInstance,
        generation,
        isCurrentUpdate,
        onSynchronized,
      );
      if (!updateBoundaryPortPositions(graphInstance, generation)) {
        synchronizeCorridors();
        return;
      }
      drawModelUpdates(graphInstance, generation, isCurrentUpdate, synchronizeCorridors);
    };

    const synchronizeCompletedCameraTransform = async (
      graphInstance: Graph,
      generation: number,
    ) => {
      if (!isCurrentGraph(graphInstance, generation)) return;
      const portsUpdated = updateBoundaryPortPositions(graphInstance, generation);
      if (portsUpdated) {
        await graphInstance.draw().catch((error) => reportGraphError('camera-model-draw', error));
      }
      if (!isCurrentGraph(graphInstance, generation)) return;
      publishDebugSnapshot(graphInstance, 'transform');
    };
    const synchronizeCanvasViewport = (
      graphInstance: Graph,
      generation: number,
      resizeGraph: boolean,
    ) => {
      if (!isCurrentGraph(graphInstance, generation)) return;
      const size = currentCanvasSize();
      const previous = lastCanvasSizeRef.current;
      if (previous?.width === size.width && previous.height === size.height) return;
      lastCanvasSizeRef.current = size;
      const currentProps = propsRef.current;
      graphInstance.setLayout(buildLayout(currentProps, size));
      if (resizeGraph) graphInstance.resize(size.width, size.height);
      if (!isCurrentGraph(graphInstance, generation)) return;
      const portsUpdated = updateBoundaryPortPositions(graphInstance, generation);
      const corridorsUpdated = reapplyWorldCorridors(graphInstance, generation);
      if (resizeGraph) {
        scheduleLayoutAfterDataFrame(
          graphInstance,
          generation,
          layoutDuration(currentProps.viewState),
          () => isCurrentGraph(graphInstance, generation),
        );
        return;
      }
      if (portsUpdated || corridorsUpdated) {
        drawModelUpdates(
          graphInstance,
          generation,
          () => isCurrentGraph(graphInstance, generation),
        );
      }
    };

    const savePositions = (graphInstance: Graph, generation: number) => {
      if (!isCurrentGraph(graphInstance, generation)) return;
      const currentProps = propsRef.current;
      writeLayoutCache(
        layoutStorageKey(currentProps.viewState, currentProps.activeCategoryID),
        currentProps,
        currentCanvasSize(),
        graphInstance.getNodeData(),
      );
    };

    const renderCanvasLayers = (graphInstance: Graph) => {
      for (const layer of Object.values(graphInstance.getCanvas().getLayers())) {
        layer.render();
      }
    };

    const commitWorldFrame = async (
      graphInstance: Graph,
      frameProps: KGGraphCanvasProps,
      canvasSize: CanvasSize,
      generation: number,
      run: number,
      isCurrentUpdate: () => boolean,
    ): Promise<boolean> => {
      let revision = currentGraphFrameRevision();
      const isCurrentCommit = () =>
        isCurrentGraph(graphInstance, generation)
        && run === layoutRunRef.current
        && isCurrentUpdate()
        && isCurrentGraphFrameRevision(revision);
      if (!isCurrentCommit()) return false;
      const rawNodePositions = readFiniteNodePositions(graphInstance, frameProps);
      const nodePositions = rawNodePositions;
      assertWorldModelLayoutMetrics(nodePositions, frameProps.categories, canvasSize);
      graphInstance.updateEdgeData(worldCorridorUpdates(frameProps, canvasSize, nodePositions));
      revision = bumpGraphDataRevision();
      if (!isCurrentCommit()) return false;
      graphInstance.setOptions({
        animation: false,
        node: { animation: false },
        edge: { animation: false },
      });
      await drawWorldGeometry(graphInstance);
      if (!isCurrentCommit()) return false;
      const drawnNodePositions = readFiniteNodePositions(graphInstance, frameProps);
      graphInstance.setOptions({ padding: [56, 56, 56, 56] });
      await graphInstance.fitView(
        { when: 'always', direction: 'both' },
        false,
      );
      if (!isCurrentCommit()) return false;
      const fittedNodePositions = readFiniteNodePositions(graphInstance, frameProps);
      if (!sameNodePositions(drawnNodePositions, fittedNodePositions)) {
        throw new Error('WORLD node coordinates changed after the committed draw resolved.');
      }
      if (!isCurrentCommit()) return false;
      if (
        layoutSourceRef.current === 'cache'
        && !isAcceptedWorldScreenLayout(
          readWorldScreenLayoutMetrics(graphInstance, frameProps, canvasSize),
        )
      ) {
        window.localStorage.removeItem(WORLD_LAYOUT_KEY);
        settledWorldModelRef.current = null;
        graphInstance.setData(toGraphData(frameProps, canvasSize, {}));
        bumpGraphDataRevision();
        scheduleLayoutAfterDataFrame(
          graphInstance,
          generation,
          layoutDuration(frameProps.viewState),
          isCurrentUpdate,
        );
        return false;
      }
      const resetKey = worldResetLayoutKey(frameProps, canvasSize);
      if (!worldResetPositionsRef.current.has(resetKey)) {
        worldResetPositionsRef.current.set(
          resetKey,
          nodePositions.map((point) => ({ ...point })),
        );
      }
      settledWorldModelRef.current = {
        metrics: measureWorldModelLayout(nodePositions, frameProps.categories, canvasSize),
        nodes: nodePositions.map((point) => ({ ...point })),
        source: layoutSourceRef.current,
        canvasSize: { ...canvasSize },
      };
      publishDebugSnapshot(
        graphInstance,
        'layout-settled',
        settledLayoutStartedAtRef.current ?? debugCanvasStartedAtRef.current,
      );
      if (!isCurrentCommit()) return false;
      savePositions(graphInstance, generation);
      return true;
    };

    const cancelLayoutStabilityFrame = (run?: number) => {
      const pending = layoutStabilityFrameRef.current;
      if (!pending || (run !== undefined && pending.run !== run)) return;
      window.cancelAnimationFrame(pending.frameID);
      layoutStabilityFrameRef.current = undefined;
    };

    const cancelPendingLayoutStartFrame = () => {
      if (pendingLayoutStartFrameRef.current === undefined) return;
      window.cancelAnimationFrame(pendingLayoutStartFrameRef.current);
      pendingLayoutStartFrameRef.current = undefined;
    };

    const nodePositionSignature = (graphInstance: Graph): string | undefined => {
      const positions = graphInstance.getNodeData().map((node) => {
        const x = node.style?.x;
        const y = node.style?.y;
        return typeof x === 'number'
          && Number.isFinite(x)
          && typeof y === 'number'
          && Number.isFinite(y)
          ? [node.id, x, y] as const
          : undefined;
      });
      if (positions.length === 0 || positions.some((position) => position === undefined)) {
        return undefined;
      }
      return JSON.stringify(
        positions
          .filter((position): position is readonly [string, number, number] => position !== undefined)
          .sort(([leftID], [rightID]) => leftID.localeCompare(rightID)),
      );
    };

    const settleLayout = (
      graphInstance: Graph,
      generation: number,
      run: number,
      isCurrentUpdate: () => boolean,
    ) => {
      if (
        !isCurrentGraph(graphInstance, generation) ||
        run !== layoutRunRef.current ||
        settledLayoutRunRef.current === run
      ) return;
      settledLayoutStartedAtRef.current =
        debugLayoutStartedAtRef.current.get(run) ?? debugCanvasStartedAtRef.current;
      cancelLayoutStabilityFrame(run);
      if (layoutTimerRef.current !== undefined) {
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = undefined;
      }
      const completeSettlement = () => {
        if (
          !isCurrentGraph(graphInstance, generation)
          || run !== layoutRunRef.current
          || !isCurrentUpdate()
        ) return;
        settledLayoutRunRef.current = run;
        finalizingLayoutRunsRef.current.delete(run);
        propsRef.current.onLayoutSettled?.();
        debugLayoutStartedAtRef.current.delete(run);
        layoutWaitersRef.current.get(run)?.resolve();
        layoutWaitersRef.current.delete(run);
      };
      const abandonSettlement = () => {
        finalizingLayoutRunsRef.current.delete(run);
        debugLayoutStartedAtRef.current.delete(run);
        layoutWaitersRef.current.get(run)?.resolve();
        layoutWaitersRef.current.delete(run);
      };
      const currentProps = propsRef.current;
      if (isWorldFrameView(currentProps.viewState)) {
        let replacementFrame: number | undefined;
        let replacementInFlight = false;
        const isCurrentReplacement = () =>
          isCurrentGraph(graphInstance, generation)
          && run === layoutRunRef.current
          && finalizingLayoutRunsRef.current.has(run)
          && settledLayoutRunRef.current !== run
          && isCurrentUpdate()
          && isWorldFrameView(propsRef.current.viewState);
        const replacementBlocked = () =>
          (worldGeometryDrawsInFlightRef.current.get(graphInstance) ?? 0) > 0
          || pendingDragOriginRef.current?.graphInstance === graphInstance
          || queuedWorldDragFrameRef.current?.graphInstance === graphInstance
          || dragDrawInFlightRef.current?.graphInstance === graphInstance;
        const scheduleReplacementCommit = () => {
          if (!isCurrentReplacement()) {
            abandonSettlement();
            return;
          }
          if (replacementFrame !== undefined || replacementInFlight) return;
          replacementFrame = window.requestAnimationFrame(() => {
            replacementFrame = undefined;
            if (!isCurrentReplacement()) {
              abandonSettlement();
              return;
            }
            if (replacementBlocked()) {
              scheduleReplacementCommit();
              return;
            }
            replacementInFlight = true;
            void commitWorldFrame(
              graphInstance,
              propsRef.current,
              currentCanvasSize(),
              generation,
              run,
              isCurrentUpdate,
            )
              .then((committed) => {
                replacementInFlight = false;
                if (committed) completeSettlement();
                else scheduleReplacementCommit();
              })
              .catch((error) => {
                replacementInFlight = false;
                reportGraphError('world-frame', error);
                abandonSettlement();
              });
          });
        };
        void commitWorldFrame(
          graphInstance,
          currentProps,
          currentCanvasSize(),
          generation,
          run,
          isCurrentUpdate,
        )
          .then((committed) => {
            if (committed) completeSettlement();
            else scheduleReplacementCommit();
          })
          .catch((error) => {
            reportGraphError('world-frame', error);
            abandonSettlement();
          });
        return;
      }
      renderCanvasLayers(graphInstance);
      savePositions(graphInstance, generation);
      publishDebugSnapshot(
        graphInstance,
        'layout-settled',
        debugLayoutStartedAtRef.current.get(run) ?? debugCanvasStartedAtRef.current,
      );
      completeSettlement();
    };

    const createLayoutRun = (): number => {
      frameRevisionRef.current += 1;
      cancelPendingLayoutStartFrame();
      cancelLayoutStabilityFrame();
      if (layoutTimerRef.current !== undefined) {
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = undefined;
      }
      for (const [oldRun, waiter] of layoutWaitersRef.current) {
        waiter.resolve();
        layoutWaitersRef.current.delete(oldRun);
        debugLayoutStartedAtRef.current.delete(oldRun);
        finalizingLayoutRunsRef.current.delete(oldRun);
      }
      finalizingLayoutRunsRef.current.clear();
      const run = ++layoutRunRef.current;
      settledLayoutStartedAtRef.current = undefined;
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      layoutWaitersRef.current.set(run, { promise, resolve });
      return run;
    };

    const waitForStableNodePositions = (
      graphInstance: Graph,
      generation: number,
      run: number,
      isCurrentUpdate: () => boolean,
    ) => {
      cancelLayoutStabilityFrame();
      const pending = {
        frameID: 0,
        graphInstance,
        generation,
        run,
        isCurrentUpdate,
        previousSignature: nodePositionSignature(graphInstance),
        stableFrameCount: 0,
      };
      const sampleNextFrame = () => {
        pending.frameID = window.requestAnimationFrame(() => {
          if (layoutStabilityFrameRef.current !== pending) return;
          if (
            !isCurrentGraph(graphInstance, generation)
            || !isCurrentUpdate()
            || run !== layoutRunRef.current
          ) {
            layoutStabilityFrameRef.current = undefined;
            return;
          }
          const signature = nodePositionSignature(graphInstance);
          if (signature !== undefined && signature === pending.previousSignature) {
            pending.stableFrameCount += 1;
          } else {
            pending.previousSignature = signature;
            pending.stableFrameCount = 0;
          }
          if (pending.stableFrameCount >= 2) {
            layoutStabilityFrameRef.current = undefined;
            settleLayout(graphInstance, generation, run, pending.isCurrentUpdate);
            return;
          }
          sampleNextFrame();
        });
      };
      layoutStabilityFrameRef.current = pending;
      sampleNextFrame();
    };

    const finalizeLayout = (
      graphInstance: Graph,
      generation: number,
      run: number,
      isCurrentUpdate: () => boolean,
    ) => {
      if (
        !isCurrentGraph(graphInstance, generation)
        || !isCurrentUpdate()
        || run !== layoutRunRef.current
        || finalizingLayoutRunsRef.current.has(run)
      ) return;
      finalizingLayoutRunsRef.current.add(run);
      if (layoutTimerRef.current !== undefined) {
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = undefined;
      }
      if (!isWorldFrameView(propsRef.current.viewState)) {
        reapplyWorldCorridors(graphInstance, generation);
        void graphInstance.draw().catch((error) => reportGraphError('final-layout-draw', error));
      }
      waitForStableNodePositions(graphInstance, generation, run, isCurrentUpdate);
    };

    const startLayoutRun = (
      graphInstance: Graph,
      generation: number,
      run: number,
      duration: number,
      isCurrentUpdate: () => boolean,
    ) => {
      if (
        !isCurrentGraph(graphInstance, generation)
        || !isCurrentUpdate()
        || run !== layoutRunRef.current
      ) return;
      debugLayoutStartedAtRef.current.set(run, monotonicNow());
      layoutTimerRef.current = window.setTimeout(() => {
        if (
          !isCurrentGraph(graphInstance, generation)
          || !isCurrentUpdate()
          || run !== layoutRunRef.current
        ) return;
        graphInstance.stopLayout();
        finalizeLayout(graphInstance, generation, run, isCurrentUpdate);
      }, Math.max(0, duration - FINAL_DRAW_RESERVE));
      void graphInstance.layout()
        .then(() => finalizeLayout(graphInstance, generation, run, isCurrentUpdate))
        .catch((error) => reportGraphError('layout', error));
    };

    const startPendingLayout = (
      graphInstance: Graph,
      generation: number,
      run: number,
    ) => {
      const pendingStart = pendingLayoutStartRef.current;
      if (
        pendingStart?.graphInstance !== graphInstance
        || pendingStart.generation !== generation
        || pendingStart.run !== run
        || pendingStart.run !== layoutRunRef.current
      ) return;
      cancelPendingLayoutStartFrame();
      pendingLayoutStartRef.current = undefined;
      if (!pendingStart.isCurrentUpdate()) return;
      const currentProps = propsRef.current;
      if (layoutSourceRef.current === 'cache' && isWorldFrameView(currentProps.viewState)) {
        debugLayoutStartedAtRef.current.set(run, monotonicNow());
        finalizeLayout(graphInstance, generation, run, pendingStart.isCurrentUpdate);
        return;
      }
      graphInstance.setLayout(buildLayout(currentProps, currentCanvasSize()));
      graphInstance.setOptions({
        animation: !currentProps.reducedMotion,
        node: { animation: nodeAnimation(currentProps.reducedMotion) },
        edge: { animation: edgeAnimation(currentProps.reducedMotion) },
      });
      startLayoutRun(
        graphInstance,
        generation,
        pendingStart.run,
        pendingStart.duration,
        pendingStart.isCurrentUpdate,
      );
    };

    const scheduleLayoutAfterDataFrame = (
      graphInstance: Graph,
      generation: number,
      duration: number,
      isCurrentUpdate: () => boolean,
    ): number => {
      const run = createLayoutRun();
      layoutSourceRef.current = 'force';
      graphInstance.setOptions({
        animation: false,
        node: { animation: false },
        edge: { animation: false },
      });
      pendingLayoutStartRef.current = {
        graphInstance,
        generation,
        run,
        duration,
        isCurrentUpdate,
      };
      pendingLayoutStartFrameRef.current = window.requestAnimationFrame(() => {
        pendingLayoutStartFrameRef.current = undefined;
        startPendingLayout(graphInstance, generation, run);
      });
      void graphInstance.draw()
        .then(() => startPendingLayout(graphInstance, generation, run))
        .catch((error) => reportGraphError('pre-layout-draw', error));
      return run;
    };

    const waitForCurrentLayout = async (graphInstance: Graph, generation: number) => {
      const run = layoutRunRef.current;
      await layoutWaitersRef.current.get(run)?.promise;
      return isCurrentGraph(graphInstance, generation) && run === layoutRunRef.current;
    };

    const focusElementsToUsableArea = async (
      graphInstance: Graph,
      generation: number,
      elementIDs: string[],
      duration: number,
      padding: [number, number, number, number],
    ) => {
      if (elementIDs.length === 0) return;
      const bounds = elementIDs.map((id) => graphInstance.getElementRenderBounds(id));
      const minX = Math.min(...bounds.map((bound) => bound.min[0]));
      const minY = Math.min(...bounds.map((bound) => bound.min[1]));
      const maxX = Math.max(...bounds.map((bound) => bound.max[0]));
      const maxY = Math.max(...bounds.map((bound) => bound.max[1]));
      const size = currentCanvasSize();
      const [top, right, bottom, left] = padding;
      const usableWidth = Math.max(1, size.width - left - right);
      const usableHeight = Math.max(1, size.height - top - bottom);
      const contentWidth = Math.max(1, maxX - minX + 16);
      const contentHeight = Math.max(1, maxY - minY + 16);
      const targetZoom = Math.max(
        GRAPH_LIMITS.minZoom,
        Math.min(GRAPH_LIMITS.maxZoom, usableWidth / contentWidth, usableHeight / contentHeight),
      );
      if (browserDebugEnabled()) {
        (window as unknown as { __kgFocusDiagnostic?: unknown }).__kgFocusDiagnostic = {
          bounds: { minX, minY, maxX, maxY },
          targetZoom,
          padding,
        };
      }
      const animation = propsRef.current.reducedMotion
        ? false
        : { duration: duration / 2, easing: CAMERA_EASING };
      graphInstance.setOptions({ padding });
      await graphInstance.zoomTo(targetZoom, animation).catch(() => undefined);
      if (!isCurrentGraph(graphInstance, generation)) return;
      await graphInstance.focusElement(elementIDs, animation).catch(() => undefined);
      if (!isCurrentGraph(graphInstance, generation)) return;
      const renderedClientBounds = () => {
        const zoom = graphInstance.getZoom();
        const points = elementIDs.flatMap((id) => {
          const style = graphInstance.getElementRenderStyle(id);
          const position = graphInstance.getElementPosition(id);
          const x = Number.isFinite(Number(style.x)) ? Number(style.x) : position[0];
          const y = Number.isFinite(Number(style.y)) ? Number(style.y) : position[1];
          const [clientX, clientY] = graphInstance.getClientByCanvas([x, y]);
          const halfSize = sizeNumber(style.size, 12) * zoom / 2 + 4;
          return [{
            minX: clientX - halfSize,
            minY: clientY - halfSize,
            maxX: clientX + halfSize,
            maxY: clientY + halfSize,
          }];
        });
        return {
          minX: Math.min(...points.map((point) => point.minX)),
          minY: Math.min(...points.map((point) => point.minY)),
          maxX: Math.max(...points.map((point) => point.maxX)),
          maxY: Math.max(...points.map((point) => point.maxY)),
        };
      };
      let clientBounds = renderedClientBounds();
      const fitCorrection = Math.min(
        1,
        usableWidth / Math.max(1, clientBounds.maxX - clientBounds.minX),
        usableHeight / Math.max(1, clientBounds.maxY - clientBounds.minY),
      );
      if (fitCorrection < 0.995) {
        await graphInstance.zoomTo(
          Math.max(GRAPH_LIMITS.minZoom, graphInstance.getZoom() * fitCorrection * 0.98),
          false,
        ).catch(() => undefined);
        if (!isCurrentGraph(graphInstance, generation)) return;
        await graphInstance.focusElement(elementIDs, false).catch(() => undefined);
        if (!isCurrentGraph(graphInstance, generation)) return;
        clientBounds = renderedClientBounds();
      }
      const containerBounds = containerRef.current?.getBoundingClientRect();
      const safeCenterX = (containerBounds?.left ?? 0) + left + usableWidth / 2;
      const safeCenterY = (containerBounds?.top ?? 0) + top + usableHeight / 2;
      const correctionX = safeCenterX - (clientBounds.minX + clientBounds.maxX) / 2;
      const correctionY = safeCenterY - (clientBounds.minY + clientBounds.maxY) / 2;
      if (Number.isFinite(correctionX) && Number.isFinite(correctionY)
        && (Math.abs(correctionX) > 0.5 || Math.abs(correctionY) > 0.5)) {
        await graphInstance.translateBy([correctionX, correctionY], false).catch(() => undefined);
      }
    };

    const clearFocusAnimation = (graphInstance?: Graph, restore = true) => {
      focusGenerationRef.current += 1;
      if (focusTimerRef.current !== undefined) {
        window.clearInterval(focusTimerRef.current);
        focusTimerRef.current = undefined;
      }
      const oldFocus = animatedFocusRef.current;
      animatedFocusRef.current = undefined;
      if (!graphInstance || destroyedGraphsRef.current.has(graphInstance)) return;
      (graphInstance as unknown as {
        context?: { animation?: { stop: () => void } };
      }).context?.animation?.stop();
      graphInstance.setOptions({ animation: false, node: { animation: false } });
      if (restore && oldFocus) {
        graphInstance.updateNodeData([{
          id: oldFocus,
          style: {
            size: 36,
            shadowType: 'outer',
            shadowBlur: 10,
            shadowColor: 'rgba(242,140,40,0.28)',
            shadowOffsetX: 0,
            shadowOffsetY: 0,
          },
        }]);
        if (isWorldFrameView(propsRef.current.viewState)) bumpGraphDataRevision();
        void graphInstance.draw().catch(() => undefined);
      }
    };

    const destroyGraph = (graphInstance = graphRef.current) => {
      if (!graphInstance || destroyedGraphsRef.current.has(graphInstance)) return;
      const runtimeContext = (graphInstance as unknown as {
        context?: {
          animation?: { animations?: Set<unknown> };
          canvas?: {
            document?: {
              timeline?: { animationsWithPromises?: Array<{ playState?: string }> };
            };
          };
        };
      }).context;
      lifecycleGenerationRef.current += 1;
      presentationGenerationRef.current += 1;
      clearFocusAnimation(graphInstance, false);
      if (layoutTimerRef.current !== undefined) {
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = undefined;
      }
      pendingLayoutStartRef.current = undefined;
      cancelPendingLayoutStartFrame();
      cancelLayoutStabilityFrame();
      for (const waiter of layoutWaitersRef.current.values()) waiter.resolve();
      layoutWaitersRef.current.clear();
      debugLayoutStartedAtRef.current.clear();
      settledLayoutStartedAtRef.current = undefined;
      finalizingLayoutRunsRef.current.clear();
      destroyedGraphsRef.current.add(graphInstance);
      graphInstance.destroy();
      if (graphRef.current === graphInstance) graphRef.current = null;
      return {
        g6AnimationCount: runtimeContext?.animation?.animations?.size ?? 0,
        timelineAnimationCount:
          runtimeContext?.canvas?.document?.timeline?.animationsWithPromises
            ?.filter((animation) => animation.playState !== 'finished').length ?? 0,
      };
    };

    const fitView = async (padding = 64, duration = 400, deadlineBound = false) => {
      const graphInstance = graphRef.current;
      if (!graphInstance) return;
      const generation = lifecycleGenerationRef.current;
      if (!await waitForCurrentLayout(graphInstance, generation)) return;
      const effectivePadding = isWorldFrameView(propsRef.current.viewState)
        ? [56, 56, 56, 56] as [number, number, number, number]
        : padding;
      graphInstance.setOptions({ padding: effectivePadding });
      await graphInstance.fitView(
        { when: 'always', direction: 'both' },
        propsRef.current.reducedMotion || deadlineBound || duration === 0
          ? false
          : { duration, easing: CAMERA_EASING },
      ).catch(() => undefined);
      if (!isCurrentGraph(graphInstance, generation)) return;
      await synchronizeCompletedCameraTransform(graphInstance, generation);
    };

    useImperativeHandle(
      ref,
      () => ({
        fitView,
        resetLayout: async () => {
          const graphInstance = graphRef.current;
          if (!graphInstance) return;
          const currentProps = propsRef.current;
          const storageKey = layoutStorageKey(
            currentProps.viewState,
            currentProps.activeCategoryID,
          );
          if (storageKey) window.localStorage.removeItem(storageKey);
          const generation = lifecycleGenerationRef.current;
          const canvasSize = currentCanvasSize();
          const resetPositions = currentProps.viewState === 'WORLD'
            ? worldResetPositionsRef.current.get(worldResetLayoutKey(currentProps, canvasSize))
            : undefined;
          if (resetPositions) {
            layoutSourceRef.current = 'reset';
            graphInstance.updateNodeData(resetPositions.map((point) => ({
              id: point.id,
              style: { x: point.x, y: point.y },
            })));
            bumpGraphDataRevision();
            layoutRunRef.current += 1;
            settledLayoutStartedAtRef.current = monotonicNow();
            await commitWorldFrame(
              graphInstance,
              currentProps,
              canvasSize,
              generation,
              layoutRunRef.current,
              () => isCurrentGraph(graphInstance, generation),
            );
            return;
          }
          graphInstance.setData(toGraphData(currentProps, currentCanvasSize()));
          bumpGraphDataRevision();
          graphInstance.setLayout(buildLayout(currentProps, currentCanvasSize()));
          const duration = layoutDuration(currentProps.viewState);
          const isCurrentRun = () => isCurrentGraph(graphInstance, generation);
          const run = scheduleLayoutAfterDataFrame(
            graphInstance,
            generation,
            duration,
            isCurrentRun,
          );
          await layoutWaitersRef.current.get(run)?.promise;
          if (run !== layoutRunRef.current || !isCurrentGraph(graphInstance, generation)) return;
          await fitView();
        },
        focusCategory: async (categoryID, duration) => {
          const graphInstance = graphRef.current;
          if (!graphInstance) return;
          const generation = lifecycleGenerationRef.current;
          if (!await waitForCurrentLayout(graphInstance, generation)) return;
          const members = propsRef.current.graph.nodes
            .filter((node) => node.data.category_id === categoryID)
            .map((node) => node.id);
          if (members.length === 0) return;
          await focusElementsToUsableArea(
            graphInstance,
            generation,
            members,
            duration,
            [72, 304, 72, 432],
          );
          await synchronizeCompletedCameraTransform(graphInstance, generation);
        },
        focusNode: async (nodeID, duration) => {
          const graphInstance = graphRef.current;
          if (!graphInstance) return;
          const generation = lifecycleGenerationRef.current;
          if (!await waitForCurrentLayout(graphInstance, generation)) return;
          await graphInstance.focusElement(
            nodeID,
            propsRef.current.reducedMotion
              ? false
              : { duration, easing: CAMERA_EASING },
          ).catch(() => undefined);
          await synchronizeCompletedCameraTransform(graphInstance, generation);
        },
        getZoom: () => graphRef.current?.getZoom() ?? 1,
        destroy: destroyGraph,
      }),
      [],
    );

    useEffect(() => {
      const initialProps = initialPropsRef.current;
      const container = canvasHostRef.current;
      if (!container) return undefined;
      if (!canvasSupported()) {
        propsRef.current.onCanvasUnsupported?.();
        return undefined;
      }

      const generation = ++lifecycleGenerationRef.current;
      debugMountedRef.current = true;
      debugCanvasStartedAtRef.current = monotonicNow();
      const graphInstance = new Graph({
        container,
        renderer: () => new CanvasRenderer(),
        autoResize: true,
        animation: false,
        zoomRange: [GRAPH_LIMITS.minZoom, GRAPH_LIMITS.maxZoom],
        behaviors: graphBehaviors(initialProps.reducedMotion, isTransientView(initialProps.viewState)),
        plugins: buildPlugins(initialProps),
        node: {
          type: (datum) => (datum.data?.isBoundaryPort ? 'rect' : 'circle'),
          state: {
            selected: {
              halo: true,
              haloLineWidth: 8,
              haloStroke: '#C08E3A',
            },
          },
          animation: false,
        },
        edge: {
          type: (datum) => datum.type ?? 'line',
          animation: false,
        },
      });
      graphRef.current = graphInstance;
      lastCanvasSizeRef.current = currentCanvasSize();

      let renderCanvas: ReturnType<ReturnType<Graph['getCanvas']>['getLayer']> | undefined;
      const onCanvasAfterRender = () => {
        if (!isCurrentGraph(graphInstance, generation)) return;
        initialDrawCompletedGraphsRef.current.add(graphInstance);
        publishFirstPaint(graphInstance);
        const pendingStart = pendingLayoutStartRef.current;
        if (pendingStart) startPendingLayout(graphInstance, generation, pendingStart.run);
      };
      const forceHideTooltipElement = () => {
        const tooltipElement = containerRef.current
          ?.ownerDocument.querySelector<HTMLElement>('.kg-node-tooltip')
          ?.parentElement;
        if (tooltipElement) tooltipElement.style.visibility = 'hidden';
      };
      const hideTooltipOutsideCanvas = () => {
        const tooltip = graphInstance.getPluginInstance('kg-node-tooltip') as unknown as {
          hide?: () => void;
        } | undefined;
        tooltip?.hide?.();
        forceHideTooltipElement();
      };
      hideTooltipOutsideCanvasRef.current = hideTooltipOutsideCanvas;
      const clearPendingNodeClick = () => {
        if (nodeClickTimerRef.current === undefined) return;
        window.clearTimeout(nodeClickTimerRef.current);
        nodeClickTimerRef.current = undefined;
      };
      const drainWorldDragFrames = (): void => {
        if (dragDrawInFlightRef.current) return;
        const queued = queuedWorldDragFrameRef.current;
        if (!queued) return;
        queuedWorldDragFrameRef.current = undefined;
        if (
          !isCurrentGraph(queued.graphInstance, queued.generation)
          || propsRef.current.viewState !== queued.viewState
          || !isCurrentGraphFrameRevision(queued)
        ) return;
        const currentProps = propsRef.current;
        const nodePositions = readFiniteNodePositions(queued.graphInstance, currentProps);
        queued.graphInstance.updateEdgeData(
          worldCorridorUpdates(currentProps, currentCanvasSize(), nodePositions),
        );
        const preparedRevision = bumpGraphDataRevision();
        const inFlight: WorldDragFrameJob = { ...queued, ...preparedRevision };
        dragDrawInFlightRef.current = inFlight;
        void drawWorldGeometry(queued.graphInstance)
          .then(() => {
            if (
              !isCurrentGraph(inFlight.graphInstance, inFlight.generation)
              || inFlight.token !== dragSnapshotTokenRef.current
              || propsRef.current.viewState !== inFlight.viewState
              || !isCurrentGraphFrameRevision(inFlight)
            ) return;
            publishDebugSnapshot(inFlight.graphInstance, 'node-drag');
          })
          .catch((error) => reportGraphError('world-drag-frame', error))
          .finally(() => {
            if (dragDrawInFlightRef.current === inFlight) {
              dragDrawInFlightRef.current = undefined;
            }
            drainWorldDragFrames();
          });
      };
      const scheduleDragSnapshot = () => {
        const token = ++dragSnapshotTokenRef.current;
        const originViewState = propsRef.current.viewState;
        if (originViewState === 'WORLD') frameRevisionRef.current += 1;
        pendingDragOriginRef.current = {
          graphInstance,
          generation,
          token,
          viewState: originViewState,
          ...currentGraphFrameRevision(),
        };
        if (dragSnapshotFrameRef.current !== undefined) return;
        dragSnapshotFrameRef.current = window.requestAnimationFrame(() => {
          dragSnapshotFrameRef.current = undefined;
          const origin = pendingDragOriginRef.current;
          pendingDragOriginRef.current = undefined;
          if (
            !origin
            || !isCurrentGraph(origin.graphInstance, origin.generation)
            || propsRef.current.viewState !== origin.viewState
            || origin.token !== dragSnapshotTokenRef.current
            || !isCurrentGraphFrameRevision(origin)
          ) return;
          if (!isWorldFrameView(origin.viewState)) {
            publishDebugSnapshot(origin.graphInstance, 'node-drag');
            return;
          }
          queuedWorldDragFrameRef.current = origin;
          drainWorldDragFrames();
        });
      };
      const listeners: Array<[string, (event: unknown) => void]> = [
        [GraphEvent.AFTER_CANVAS_INIT, () => {
          renderCanvas?.removeEventListener('afterrender', onCanvasAfterRender);
          renderCanvas = graphInstance.getCanvas().getLayer('main');
          renderCanvas.addEventListener('afterrender', onCanvasAfterRender);
        }],
        [NodeEvent.CLICK, (rawEvent) => {
          if (isTransientView(propsRef.current.viewState)) return;
          const event = rawEvent as GraphEventLike;
          const id = eventID(event);
          const port = propsRef.current.ports?.find((candidate) => candidate.id === id);
          if (port) propsRef.current.onPortClick?.(port.id);
          else if (id) {
            clearPendingNodeClick();
            nodeClickTimerRef.current = window.setTimeout(() => {
              nodeClickTimerRef.current = undefined;
              if (!isCurrentGraph(graphInstance, generation)) return;
              if (isTransientView(propsRef.current.viewState)) return;
              propsRef.current.onNodeClick?.(id);
            }, NODE_SINGLE_CLICK_DELAY);
          }
        }],
        [NodeEvent.DBLCLICK, (rawEvent) => {
          if (isTransientView(propsRef.current.viewState)) return;
          const id = eventID(rawEvent as GraphEventLike);
          if (!id) return;
          if (
            monotonicNow() - lastNodeDragEndedAtRef.current
            < NODE_DOUBLE_CLICK_AFTER_DRAG_GUARD
          ) return;
          clearPendingNodeClick();
          void focusElementsToUsableArea(
            graphInstance,
            generation,
            [...oneHopNodeIDs(propsRef.current.graph, id)],
            500,
            [80, 80, 80, 80],
          ).then(() => {
            if (!isCurrentGraph(graphInstance, generation)) return;
            if (isTransientView(propsRef.current.viewState)) return;
            propsRef.current.onNodeClick?.(id);
          });
        }],
        [EdgeEvent.CLICK, (rawEvent) => {
          if (isTransientView(propsRef.current.viewState)) return;
          clearPendingNodeClick();
          const event = rawEvent as GraphEventLike;
          const id = eventID(event);
          if (id) propsRef.current.onEdgeClick?.(id);
        }],
        [CanvasEvent.CLICK, (rawEvent) => {
          void rawEvent;
          if (isTransientView(propsRef.current.viewState)) return;
          clearPendingNodeClick();
          propsRef.current.onCanvasClick?.();
        }],
        [NodeEvent.DRAG_START, () => undefined],
        [NodeEvent.DRAG, (rawEvent) => {
          if (isTransientView(propsRef.current.viewState)) return;
          void rawEvent;
          scheduleDragSnapshot();
        }],
        [NodeEvent.DRAG_END, () => {
          if (isTransientView(propsRef.current.viewState)) return;
          lastNodeDragEndedAtRef.current = monotonicNow();
          const currentProps = propsRef.current;
          if (!isDetailView(currentProps.viewState)) {
            savePositions(graphInstance, generation);
            return;
          }
          const duration = layoutDuration(currentProps.viewState);
          scheduleLayoutAfterDataFrame(
            graphInstance,
            generation,
            duration,
            () => isCurrentGraph(graphInstance, generation),
          );
        }],
        [GraphEvent.AFTER_TRANSFORM, () => {
          publishDebugSnapshot(graphInstance, 'transform');
        }],
        [GraphEvent.AFTER_SIZE_CHANGE, () => {
          synchronizeCanvasViewport(graphInstance, generation, false);
        }],
      ];
      for (const [eventName, listener] of listeners) graphInstance.on(eventName, listener);

      const resizeObserver = typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            synchronizeCanvasViewport(graphInstance, generation, true);
          });
      resizeObserver?.observe(containerRef.current!);

      const initialCanvasSize = currentCanvasSize();
      const initialCache = readLayoutCache(
        layoutStorageKey(initialProps.viewState, initialProps.activeCategoryID),
        initialProps,
        initialCanvasSize,
      );
      layoutSourceRef.current = isWorldFrameView(initialProps.viewState)
        && Object.keys(initialCache).length === initialProps.graph.nodes.length
        ? 'cache'
        : 'force';
      graphInstance.setData(toGraphData(initialProps, initialCanvasSize, initialCache));
      bumpGraphDataRevision();
      graphInstance.setOptions({
        animation: false,
        node: { animation: false },
        edge: { animation: false },
      });
      const maxDuration = layoutDuration(initialProps.viewState);
      const initialRun = createLayoutRun();
      pendingLayoutStartRef.current = {
        graphInstance,
        generation,
        run: initialRun,
        duration: maxDuration,
        isCurrentUpdate: () => isCurrentGraph(graphInstance, generation),
      };
      void graphInstance.render()
        .then(() => {
          if (!isCurrentGraph(graphInstance, generation)) return;
          initialDrawCompletedGraphsRef.current.add(graphInstance);
        })
        .catch((error) => reportGraphError('initial-render', error));

      return () => {
        dragSnapshotTokenRef.current += 1;
        if (pendingDragOriginRef.current?.graphInstance === graphInstance) {
          pendingDragOriginRef.current = undefined;
        }
        if (queuedWorldDragFrameRef.current?.graphInstance === graphInstance) {
          queuedWorldDragFrameRef.current = undefined;
        }
        if (dragDrawInFlightRef.current?.graphInstance === graphInstance) {
          dragDrawInFlightRef.current = undefined;
        }
        hideTooltipOutsideCanvasRef.current = () => undefined;
        debugMountedRef.current = false;
        if (nodeClickTimerRef.current !== undefined) {
          window.clearTimeout(nodeClickTimerRef.current);
          nodeClickTimerRef.current = undefined;
        }
        if (dragSnapshotFrameRef.current !== undefined) {
          window.cancelAnimationFrame(dragSnapshotFrameRef.current);
          dragSnapshotFrameRef.current = undefined;
        }
        renderCanvas?.removeEventListener('afterrender', onCanvasAfterRender);
        if (pendingLayoutStartRef.current?.graphInstance === graphInstance) {
          pendingLayoutStartRef.current = undefined;
        }
        resizeObserver?.disconnect();
        for (const [eventName, listener] of listeners) graphInstance.off(eventName, listener);
        const animationCounts = destroyGraph(graphInstance) ?? {
          g6AnimationCount: 0,
          timelineAnimationCount: 0,
        };
        if (browserDebugEnabled()) {
          const eventGroups = (graphInstance as unknown as {
            getEvents?: () => Record<string, unknown[]>;
          }).getEvents?.() ?? {};
          const timestamp = monotonicNow();
          window.dispatchEvent(new CustomEvent<KGGraphDebugDetail>(KG_GRAPH_DEBUG_EVENT, {
            detail: {
              phase: 'cleanup',
              timestamp,
              elapsedMs: timestamp - debugCanvasStartedAtRef.current,
              viewState: propsRef.current.viewState,
              activeCategoryID: propsRef.current.activeCategoryID ?? '',
              nodeCount: 0,
              edgeCount: 0,
              crossCategoryEdgeCount: 0,
              zoom: 1,
              camera: { x: 0, y: 0 },
              nodes: [],
              edges: [],
              renderedEdges: [],
              renderedLabelCount: 0,
              renderedLabelReadErrorNodeIDs: [],
              modelLayoutMetrics: null,
              screenLayoutMetrics: null,
              layoutSource: null,
              canvasSize: currentCanvasSize(),
              layoutCanvasSize: null,
              modelNodes: [],
              ports: [],
              runtime: {
                g6ListenerCount: Object.values(eventGroups).reduce(
                  (count, group) => count + group.length,
                  0,
                ),
                intervalCount: focusTimerRef.current === undefined ? 0 : 1,
                timeoutCount:
                  (layoutTimerRef.current === undefined ? 0 : 1)
                  + (nodeClickTimerRef.current === undefined ? 0 : 1),
                ...animationCounts,
              },
            },
          }));
        }
      };
    }, []);

    useEffect(() => {
      const graphInstance = graphRef.current;
      if (!graphInstance) return;
      if (presentedGraphRef.current !== graphInstance) {
        presentedGraphRef.current = graphInstance;
        previousDataRef.current = props.graph;
        previousViewStateRef.current = props.viewState;
        previousLayoutSignatureRef.current = layoutSignature(props);
        return;
      }
      const previousGraph = previousDataRef.current;
      const previousNodeIDs = new Set(previousGraph.nodes.map((node) => node.id));
      const sameNodeSet = previousGraph.nodes.length === props.graph.nodes.length
        && props.graph.nodes.every((node) => previousNodeIDs.has(node.id));
      const nodeSetExpanded = props.graph.nodes.some((node) => !previousNodeIDs.has(node.id));
      const nextLayoutSignature = layoutSignature(props);
      const layoutChanged = previousLayoutSignatureRef.current !== nextLayoutSignature;
      const shouldRunLayout = layoutChanged || nodeSetExpanded;
      const completingDetailEntry =
        previousViewStateRef.current === 'ENTERING_DETAIL'
        && props.viewState === 'CATEGORY_DETAIL'
        && sameNodeSet
        && !layoutChanged;
      const completingCategoryEntry =
        previousViewStateRef.current === 'ENTERING_CATEGORY'
        && props.viewState === 'CATEGORY_FOCUS'
        && sameNodeSet
        && !layoutChanged;
      const completingWorldReturn =
        previousViewStateRef.current === 'RETURNING_TO_WORLD'
        && props.viewState === 'WORLD'
        && sameNodeSet
        && !layoutChanged;
      const continuingWorldReturnLayout =
        completingWorldReturn && layoutWaitersRef.current.has(layoutRunRef.current);
      previousDataRef.current = props.graph;
      previousViewStateRef.current = props.viewState;
      previousLayoutSignatureRef.current = nextLayoutSignature;
      if (continuingWorldReturnLayout) return;
      if (completingCategoryEntry || completingDetailEntry || completingWorldReturn) {
        publishDebugSnapshot(graphInstance, 'presentation');
        return;
      }
      const lifecycleGeneration = lifecycleGenerationRef.current;
      const presentationGeneration = ++presentationGenerationRef.current;
      const isCurrentPresentation = () =>
        isCurrentGraph(graphInstance, lifecycleGeneration) &&
        presentationGenerationRef.current === presentationGeneration;
      const isCurrentLayoutUpdate = () =>
        isCurrentGraph(graphInstance, lifecycleGeneration)
        && layoutSignature(propsRef.current) === nextLayoutSignature;
      if (layoutChanged) {
        graphInstance.setPlugins(buildPlugins(props));
      }
      graphInstance.setData(toGraphData(props, currentCanvasSize()));
      bumpGraphDataRevision();
      if (shouldRunLayout) {
        const duration = layoutDuration(props.viewState);
        scheduleLayoutAfterDataFrame(
          graphInstance,
          lifecycleGeneration,
          duration,
          isCurrentLayoutUpdate,
        );
      } else {
        graphInstance.setOptions({
          animation: false,
          node: { animation: false },
          edge: { animation: false },
        });
        void drawWorldGeometry(graphInstance)
          .then(() => {
            if (!isCurrentPresentation()) return;
            synchronizePresentationGeometry(
              graphInstance,
              lifecycleGeneration,
              isCurrentPresentation,
              () => {
                publishDebugSnapshot(graphInstance, 'presentation');
                graphInstance.setOptions({
                  animation: !propsRef.current.reducedMotion,
                  node: { animation: nodeAnimation(propsRef.current.reducedMotion) },
                  edge: { animation: edgeAnimation(propsRef.current.reducedMotion) },
                });
              },
            );
          })
          .catch(() => undefined);
      }
      return () => {
        if (presentationGenerationRef.current === presentationGeneration) {
          presentationGenerationRef.current += 1;
        }
      };
    }, [
      props.activeCategoryID,
      props.categories,
      props.colorEdgesBySourceRole,
      props.dataVersion,
      props.focusNodeID,
      props.graph,
      props.pathEdgeIDs,
      props.pathNodeIDs,
      props.ports,
      props.reducedMotion,
      props.rightViewportInset,
      props.roleByNodeID,
      props.selectedEdgeID,
      props.selectedNodeID,
      props.viewState,
    ]);

    useEffect(() => {
      const graphInstance = graphRef.current;
      if (!graphInstance) return;
      if (!initialDrawCompletedGraphsRef.current.has(graphInstance)) return;
      graphInstance.setOptions({
        animation: !props.reducedMotion,
        behaviors: graphBehaviors(props.reducedMotion, isTransientView(props.viewState)),
        node: { animation: nodeAnimation(props.reducedMotion) },
        edge: { animation: edgeAnimation(props.reducedMotion) },
      });
    }, [props.reducedMotion, props.viewState]);

    const detailPresentation = isDetailView(props.viewState);

    useEffect(() => {
      const graphInstance = graphRef.current;
      if (!graphInstance) return;
      clearFocusAnimation(graphInstance, detailPresentation);
      const focusID = currentFocusID(props);
      if (!detailPresentation || props.reducedMotion || !focusID) return;
      graphInstance.setOptions({ animation: true, node: { animation: nodeAnimation(false) } });
      const generation = ++focusGenerationRef.current;
      animatedFocusRef.current = focusID;
      let expanded = false;
      focusTimerRef.current = window.setInterval(() => {
        if (
          graphRef.current !== graphInstance ||
          destroyedGraphsRef.current.has(graphInstance) ||
          focusGenerationRef.current !== generation
        ) return;
        expanded = !expanded;
        graphInstance.updateNodeData([{
          id: focusID,
          style: {
            size: expanded ? 40 : 36,
            shadowType: 'outer',
            shadowBlur: expanded ? 22 : 10,
            shadowColor: expanded
              ? 'rgba(242,140,40,0.08)'
              : 'rgba(242,140,40,0.42)',
            shadowOffsetX: 0,
            shadowOffsetY: 0,
          },
        }]);
        void graphInstance.draw()
          .then(() => {
            if (expanded) publishDebugSnapshot(graphInstance, 'focus-peak');
          })
          .catch(() => undefined);
      }, FOCUS_HALF_CYCLE);
      return () => clearFocusAnimation(
        graphInstance,
        isDetailView(propsRef.current.viewState),
      );
    }, [detailPresentation, props.focusNodeID, props.reducedMotion, props.roleByNodeID]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const graphInstance = graphRef.current;
      if (!graphInstance || isTransientView(props.viewState)) return;
      const animation = props.reducedMotion ? false : false;
      switch (event.key) {
        case '+':
        case '=':
          event.preventDefault();
          void graphInstance.zoomBy(GRAPH_LIMITS.zoomStep, animation);
          break;
        case '-':
          event.preventDefault();
          void graphInstance.zoomBy(1 / GRAPH_LIMITS.zoomStep, animation);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          void graphInstance.translateBy([48, 0], animation);
          break;
        case 'ArrowRight':
          event.preventDefault();
          void graphInstance.translateBy([-48, 0], animation);
          break;
        case 'ArrowUp':
          event.preventDefault();
          void graphInstance.translateBy([0, 48], animation);
          break;
        case 'ArrowDown':
          event.preventDefault();
          void graphInstance.translateBy([0, -48], animation);
          break;
        case '0':
          event.preventDefault();
          void fitView();
          break;
        case 'Escape':
          props.onEscape?.();
          break;
      }
    };

    const className = ['kg-graph-canvas', props.className].filter(Boolean).join(' ');
    return (
      <div
        ref={containerRef}
        className={className}
        style={props.style}
        aria-label={props['aria-label'] ?? 'Knowledge graph canvas'}
        data-view-state={props.viewState}
        data-reduced-motion={props.reducedMotion ? 'true' : 'false'}
        onKeyDown={onKeyDown}
        onPointerLeave={() => hideTooltipOutsideCanvasRef.current()}
        role="application"
        tabIndex={0}
      >
        <div ref={canvasHostRef} className="kg-g6-host" aria-hidden="true" />
      </div>
    );
  },
);
