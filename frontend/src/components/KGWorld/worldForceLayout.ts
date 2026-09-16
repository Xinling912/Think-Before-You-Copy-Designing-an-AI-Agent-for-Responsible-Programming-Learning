import type { GraphOptions, NodeData } from '@antv/g6';

import type {
  KGCategory,
  KGViewport,
  WorldLayoutMetrics,
  WorldModelLayoutMetrics,
  WorldLayoutPoint,
} from './types';

const WORLD_PADDING_TOP = 56;
const WORLD_PADDING_RIGHT = 56;
const WORLD_PADDING_BOTTOM = 56;
const WORLD_PADDING_LEFT = 56;

type LayoutNodeDatum = {
  _original?: NodeData;
  category_id?: unknown;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
};

type LayoutEdgeDatum = {
  _original?: LayoutEdgeDatum;
  is_cross_category?: unknown;
  data?: Record<string, unknown>;
};

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function originalNode(datum: LayoutNodeDatum): LayoutNodeDatum {
  return (datum._original ?? datum) as LayoutNodeDatum;
}

function originalEdge(datum: LayoutEdgeDatum): LayoutEdgeDatum {
  return datum._original ?? datum;
}

function sizeNumber(size: unknown, fallback = 16): number {
  if (typeof size === 'number') return size;
  if (Array.isArray(size) && typeof size[0] === 'number') return size[0];
  return fallback;
}

function isCrossCategory(datum: LayoutEdgeDatum): boolean {
  const edge = originalEdge(datum);
  return Boolean(edge.data?.is_cross_category ?? edge.is_cross_category);
}

function nodeCategory(
  datum: LayoutNodeDatum,
  categories: KGCategory[],
): KGCategory | undefined {
  const node = originalNode(datum);
  const categoryID = String(node.data?.category_id ?? node.category_id ?? '');
  return categories.find((category) => category.id === categoryID);
}

function categoryAnchorX(
  datum: LayoutNodeDatum,
  categories: KGCategory[],
  viewport: KGViewport,
): number {
  const drawableWidth = Math.max(
    1,
    viewport.width - WORLD_PADDING_LEFT - WORLD_PADDING_RIGHT,
  );
  return WORLD_PADDING_LEFT
    + (nodeCategory(datum, categories)?.anchor.x ?? 0.5) * drawableWidth;
}

function categoryAnchorY(
  datum: LayoutNodeDatum,
  categories: KGCategory[],
  viewport: KGViewport,
): number {
  const drawableHeight = Math.max(
    1,
    viewport.height - WORLD_PADDING_TOP - WORLD_PADDING_BOTTOM,
  );
  return WORLD_PADDING_TOP
    + (nodeCategory(datum, categories)?.anchor.y ?? 0.5) * drawableHeight;
}

export function buildWorldForceLayout(
  categories: KGCategory[],
  viewport: KGViewport,
): GraphOptions['layout'] {
  const xTarget = (datum: LayoutNodeDatum) =>
    categoryAnchorX(originalNode(datum), categories, viewport);
  const yTarget = (datum: LayoutNodeDatum) =>
    categoryAnchorY(originalNode(datum), categories, viewport);
  return {
    type: 'd3-force',
    animation: false,
    enableWorker: false,
    width: viewport.width,
    height: viewport.height,
    iterations: 180,
    linkDistance: (datum: LayoutEdgeDatum) => isCrossCategory(datum) ? 104 : 64,
    edgeStrength: (datum: LayoutEdgeDatum) => isCrossCategory(datum) ? 0.075 : 0.22,
    nodeStrength: -82,
    collide: {
      radius: (datum: LayoutNodeDatum) => sizeNumber(originalNode(datum).style?.size) / 2 + 8,
    },
    x: {
      strength: 0.055,
      x: xTarget,
    },
    y: {
      strength: 0.055,
      y: yTarget,
    },
    // @antv/layout 1.x gives these compatibility aliases precedence over
    // its default center when configuring d3-force's x/y target accessors.
    forceXPosition: xTarget,
    forceYPosition: yTarget,
    alpha: 1,
    alphaDecay: 0.028,
    alphaMin: 0.015,
    randomSource: seededRandom(20260718),
  } as GraphOptions['layout'];
}

function median(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

function spatialMeasurements(nodes: WorldLayoutPoint[], categories: KGCategory[]) {
  const finiteNodes = nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
  if (finiteNodes.length === 0) {
    return {
      finiteNodes,
      width: 0,
      height: 0,
      nearestNeighborDistances: [] as number[],
      maximumCategoryCentroidDistance: 0,
    };
  }
  const xs = finiteNodes.map((node) => node.x);
  const ys = finiteNodes.map((node) => node.y);
  const nearestNeighborDistances = finiteNodes.map((node, index) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let otherIndex = 0; otherIndex < finiteNodes.length; otherIndex += 1) {
      if (index === otherIndex) continue;
      const other = finiteNodes[otherIndex];
      nearest = Math.min(nearest, Math.hypot(node.x - other.x, node.y - other.y));
    }
    return Number.isFinite(nearest) ? nearest : 0;
  }).sort((left, right) => left - right);
  const centroids = categories.flatMap((category) => {
    const categoryNodes = finiteNodes.filter((node) => node.category_id === category.id);
    if (categoryNodes.length === 0) return [];
    return [{
      x: categoryNodes.reduce((sum, node) => sum + node.x, 0) / categoryNodes.length,
      y: categoryNodes.reduce((sum, node) => sum + node.y, 0) / categoryNodes.length,
    }];
  });
  let maximumCategoryCentroidDistance = 0;
  for (let left = 0; left < centroids.length; left += 1) {
    for (let right = left + 1; right < centroids.length; right += 1) {
      maximumCategoryCentroidDistance = Math.max(
        maximumCategoryCentroidDistance,
        Math.hypot(centroids[left].x - centroids[right].x, centroids[left].y - centroids[right].y),
      );
    }
  }
  return {
    finiteNodes,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    nearestNeighborDistances,
    maximumCategoryCentroidDistance,
  };
}

export function measureWorldModelLayout(
  nodes: WorldLayoutPoint[],
  categories: KGCategory[],
  viewport: KGViewport,
): WorldModelLayoutMetrics {
  const measurements = spatialMeasurements(nodes, categories);
  const drawableWidth = Math.max(1, viewport.width);
  const drawableHeight = Math.max(1, viewport.height);
  const diagonal = Math.hypot(drawableWidth, drawableHeight);
  if (measurements.finiteNodes.length === 0) {
    return {
      nodeBoundsRatio: { width: 0, height: 0 },
      nearestNeighborMedianRatio: 0,
      nearestNeighborMaximumRatio: 0,
      maximumCategoryCentroidDistanceRatio: 0,
      finitePositionCount: measurements.finiteNodes.length,
    };
  }
  return {
    nodeBoundsRatio: {
      width: measurements.width / drawableWidth,
      height: measurements.height / drawableHeight,
    },
    nearestNeighborMedianRatio: median(measurements.nearestNeighborDistances) / diagonal,
    nearestNeighborMaximumRatio: Math.max(...measurements.nearestNeighborDistances) / diagonal,
    maximumCategoryCentroidDistanceRatio:
      measurements.maximumCategoryCentroidDistance / diagonal,
    finitePositionCount: measurements.finiteNodes.length,
  };
}

export function measureWorldLayout(
  nodes: WorldLayoutPoint[],
  categories: KGCategory[],
  viewport: KGViewport,
): WorldLayoutMetrics {
  const drawableWidth = Math.max(1, viewport.width);
  const drawableHeight = Math.max(1, viewport.height);
  const drawableDiagonal = Math.hypot(drawableWidth, drawableHeight);
  const measurements = spatialMeasurements(nodes, categories);
  const { finiteNodes } = measurements;

  if (finiteNodes.length === 0) {
    return {
      nodeBoundsRatio: { width: 0, height: 0 },
      nearestNeighborMedianRatio: 0,
      nearestNeighborMaximumRatio: 0,
      maximumCategoryCentroidDistanceRatio: 0,
      finitePositionCount: 0,
    };
  }

  return {
    nodeBoundsRatio: {
      width: measurements.width / drawableWidth,
      height: measurements.height / drawableHeight,
    },
    nearestNeighborMedianRatio: median(measurements.nearestNeighborDistances) / drawableDiagonal,
    nearestNeighborMaximumRatio: Math.max(...measurements.nearestNeighborDistances) / drawableDiagonal,
    maximumCategoryCentroidDistanceRatio:
      measurements.maximumCategoryCentroidDistance / drawableDiagonal,
    finitePositionCount: finiteNodes.length,
  };
}
