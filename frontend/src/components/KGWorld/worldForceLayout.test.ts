import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { KGOverview, WorldLayoutPoint } from './types';
import {
  buildWorldForceLayout,
  measureWorldLayout,
  measureWorldModelLayout,
} from './worldForceLayout';

const overview = JSON.parse(
  readFileSync('tests/fixtures/kg-overview.json', 'utf8'),
) as KGOverview;

const settledFixture: WorldLayoutPoint[] = overview.categories.flatMap((category) => {
  const categoryNodes = overview.nodes.filter((node) => node.category_id === category.id);
  const center = {
    x: 120 + category.anchor.x * 1110,
    y: 40 + category.anchor.y * 780,
  };
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return categoryNodes.map((node, index) => {
    const radius = index === 0 ? 0 : 26 + Math.sqrt(index) * 24;
    const angle = category.order * 0.37 + index * goldenAngle;
    return {
      id: node.node_id,
      category_id: category.id,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
});

const internalEdgeDatum = {
  _original: overview.visual_edges.find((edge) => !edge.is_cross_category),
};
const crossCategoryEdgeDatum = {
  _original: overview.visual_edges.find((edge) => edge.is_cross_category),
};

describe('worldForceLayout', () => {
  it('normalizes unchanged pure model coordinates by the actual pre-fit canvas size', () => {
    const small = measureWorldModelLayout(
      settledFixture,
      overview.categories,
      { width: 1000, height: 600 },
    );
    const large = measureWorldModelLayout(
      settledFixture,
      overview.categories,
      { width: 2000, height: 1200 },
    );
    expect(large.nodeBoundsRatio.width).toBeCloseTo(small.nodeBoundsRatio.width / 2, 12);
    expect(large.nodeBoundsRatio.height).toBeCloseTo(small.nodeBoundsRatio.height / 2, 12);
    expect(large.nearestNeighborMedianRatio).toBeCloseTo(
      small.nearestNeighborMedianRatio / 2,
      12,
    );
    expect(large.nearestNeighborMaximumRatio).toBeCloseTo(
      small.nearestNeighborMaximumRatio / 2,
      12,
    );
    expect(large.maximumCategoryCentroidDistanceRatio).toBeCloseTo(
      small.maximumCategoryCentroidDistanceRatio / 2,
      12,
    );
  });

  it('runs one global force policy with non-zero cross-category links', () => {
    const layout = buildWorldForceLayout(overview.categories, { width: 1560, height: 907 }) as any;
    expect(layout.type).toBe('d3-force');
    expect(layout.iterations).toBe(180);
    expect(layout.nodeStrength).toBe(-82);
    expect(layout.edgeStrength(internalEdgeDatum)).toBe(0.22);
    expect(layout.edgeStrength(crossCategoryEdgeDatum)).toBe(0.075);
    expect(layout.linkDistance(internalEdgeDatum)).toBe(64);
    expect(layout.linkDistance(crossCategoryEdgeDatum)).toBe(104);
    expect(layout.x.strength).toBe(0.055);
    expect(layout.y.strength).toBe(0.055);
  });

  it('keeps the fixed force policy on the actual compact Canvas size', () => {
    const viewport = { width: 704, height: 518 };
    const layout = buildWorldForceLayout(overview.categories, viewport) as any;

    expect(layout.iterations).toBe(180);
    expect(layout.nodeStrength).toBe(-82);
    expect(layout.edgeStrength(internalEdgeDatum)).toBe(0.22);
    expect(layout.edgeStrength(crossCategoryEdgeDatum)).toBe(0.075);
    expect(layout.linkDistance(internalEdgeDatum)).toBe(64);
    expect(layout.linkDistance(crossCategoryEdgeDatum)).toBe(104);
    expect(layout.x.strength).toBe(0.055);
    expect(layout.y.strength).toBe(0.055);
  });

  it('maps normalized category anchors directly into each drawable viewport', () => {
    const category = overview.categories[0];
    const datum = { _original: { data: { category_id: category.id }, style: { size: 18 } } };
    const cases = [
      { viewport: { width: 1024, height: 768 }, span: { width: 912, height: 656 } },
      { viewport: { width: 1560, height: 907 }, span: { width: 1448, height: 795 } },
      { viewport: { width: 1920, height: 1080 }, span: { width: 1808, height: 968 } },
    ];

    for (const { viewport, span } of cases) {
      const layout = buildWorldForceLayout(overview.categories, viewport) as any;
      const expectedX = 56 + category.anchor.x * span.width;
      const expectedY = 56 + category.anchor.y * span.height;
      expect(layout.x.x(datum)).toBeCloseTo(expectedX, 10);
      expect(layout.y.y(datum)).toBeCloseTo(expectedY, 10);
      expect(layout.forceXPosition(datum)).toBeCloseTo(
        expectedX,
        10,
      );
      expect(layout.forceYPosition(datum)).toBeCloseTo(
        expectedY,
        10,
      );
      expect(layout.iterations).toBe(180);
      expect(layout.linkDistance(internalEdgeDatum)).toBe(64);
      expect(layout.linkDistance(crossCategoryEdgeDatum)).toBe(104);
      expect(layout.edgeStrength(internalEdgeDatum)).toBe(0.22);
      expect(layout.edgeStrength(crossCategoryEdgeDatum)).toBe(0.075);
      expect(layout.nodeStrength).toBe(-82);
      expect(layout.collide.radius(datum)).toBe(17);
      expect(layout.x.strength).toBe(0.055);
      expect(layout.y.strength).toBe(0.055);
      expect(layout.alpha).toBe(1);
      expect(layout.alphaDecay).toBe(0.028);
      expect(layout.alphaMin).toBe(0.015);
    }
  });

  it('measures a finite synthetic screen constellation against the full canvas', () => {
    const metrics = measureWorldLayout(settledFixture, overview.categories, {
      width: 1560,
      height: 907,
    });
    expect(metrics.finitePositionCount).toBe(83);
    expect(metrics.nodeBoundsRatio.width).toBeGreaterThan(0);
    expect(metrics.nodeBoundsRatio.height).toBeGreaterThan(0);
    expect(metrics.nearestNeighborMedianRatio).toBeGreaterThan(0);
    expect(metrics.nearestNeighborMaximumRatio).toBeGreaterThan(0);
    expect(metrics.maximumCategoryCentroidDistanceRatio).toBeGreaterThan(0);
  });

  it('keeps pure model metrics invariant when model coordinates and canvas scale uniformly', () => {
    const translatedAndScaled = settledFixture.map((node) => ({
      ...node,
      x: node.x * 3.5 + 900,
      y: node.y * 3.5 - 400,
    }));
    const baseline = measureWorldModelLayout(
      settledFixture,
      overview.categories,
      { width: 1000, height: 600 },
    );
    const transformed = measureWorldModelLayout(
      translatedAndScaled,
      overview.categories,
      { width: 3500, height: 2100 },
    );

    expect(transformed.finitePositionCount).toBe(baseline.finitePositionCount);
    expect(transformed.nearestNeighborMedianRatio).toBeCloseTo(
      baseline.nearestNeighborMedianRatio,
      12,
    );
    expect(transformed.nearestNeighborMaximumRatio).toBeCloseTo(
      baseline.nearestNeighborMaximumRatio,
      12,
    );
    expect(transformed.maximumCategoryCentroidDistanceRatio).toBeCloseTo(
      baseline.maximumCategoryCentroidDistanceRatio,
      12,
    );
    expect(transformed.nodeBoundsRatio.width).toBeCloseTo(baseline.nodeBoundsRatio.width, 12);
    expect(transformed.nodeBoundsRatio.height).toBeCloseTo(baseline.nodeBoundsRatio.height, 12);
    expect(baseline.finitePositionCount).toBe(83);
  });
});
