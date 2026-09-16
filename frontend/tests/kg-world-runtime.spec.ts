import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const overview = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/kg-overview.json'), 'utf8'),
) as Record<string, any>;
const appURL = 'http://127.0.0.1:8000';
const devServerURL = 'http://127.0.0.1:8001';
const screenshotDirectory = '/tmp/kg-world-global-force';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type WorldLayoutMetrics = {
  nodeBoundsRatio: { width: number; height: number };
  nearestNeighborMedianRatio: number;
  nearestNeighborMaximumRatio: number;
  maximumCategoryCentroidDistanceRatio: number;
  finitePositionCount: number;
};
type WorldModelLayoutMetrics = WorldLayoutMetrics;
type RuntimeSnapshot = {
  phase: string;
  timestamp: number;
  viewState: string;
  nodeCount: number;
  edgeCount: number;
  crossCategoryEdgeCount: number;
  renderedLabelCount: number | null;
  renderedLabelReadErrorNodeIDs: string[];
  modelLayoutMetrics: WorldModelLayoutMetrics | null;
  screenLayoutMetrics: WorldLayoutMetrics | null;
  layoutSource: 'cache' | 'force' | 'reset' | null;
  canvasSize: { width: number; height: number };
  layoutCanvasSize: { width: number; height: number } | null;
  modelNodes: Array<{ id: string; category_id: string; x: number; y: number }>;
  nodes: Array<{
    id: string;
    clientX: number;
    clientY: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  renderedEdges: Array<{
    id: string;
    source: string;
    target: string;
    bounds: Bounds;
    sourceAttachmentDistance: number;
    targetAttachmentDistance: number;
    sourceRadius: number;
    targetRadius: number;
  }>;
};
type RuntimeSnapshotMetadata = Pick<
  RuntimeSnapshot,
  'phase' | 'timestamp' | 'viewState' | 'nodeCount' | 'edgeCount' | 'layoutCanvasSize'
>;

async function installHarness(page: Page) {
  await page.addInitScript((enableProductionDebug) => {
    if (enableProductionDebug) {
      Object.defineProperty(window, '__RESPONSIBLE_EDU_KG_DEBUG__', {
        configurable: false,
        value: true,
      });
    }
    if (sessionStorage.getItem('__kgRuntimeHarnessReady') !== '1') {
      localStorage.clear();
      sessionStorage.setItem('__kgRuntimeHarnessReady', '1');
    }
    const snapshots: unknown[] = [];
    Object.defineProperty(window, '__kgRuntimeSnapshots', {
      configurable: false,
      value: snapshots,
    });
    window.addEventListener('kg-graph-debug', (event) => {
      snapshots.push(structuredClone((event as CustomEvent).detail));
    });
  }, process.env.KG_DOCKER_RUNTIME === '1');
  await page.route(`${appURL}/**`, async (route) => {
    const requestURL = new URL(route.request().url());
    const response = await route.fetch({
      url: `${devServerURL}${requestURL.pathname}${requestURL.search}`,
    });
    await route.fulfill({ response });
  });
  await page.route('**/api/admin/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"ready":true}',
  }));
  await page.route('**/api/kg/overview', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(overview),
  }));
}

async function latestSnapshotTimestamp(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __kgRuntimeSnapshots: RuntimeSnapshot[] })
      .__kgRuntimeSnapshots.at(-1)?.timestamp ?? 0);
}

async function captureViewportScreenshot(
  page: Page,
  filename: string,
  viewport: { width: number; height: number },
) {
  const image = await page.screenshot({
    path: path.join(screenshotDirectory, filename),
    fullPage: false,
  });
  expect(image.readUInt32BE(16), `${filename} PNG width`).toBe(viewport.width);
  expect(image.readUInt32BE(20), `${filename} PNG height`).toBe(viewport.height);
}

async function waitForSnapshot(
  page: Page,
  predicate: (snapshot: RuntimeSnapshotMetadata) => boolean,
  timeout = 4_000,
) {
  const snapshotMetadata = () => page.evaluate(() =>
    (window as unknown as { __kgRuntimeSnapshots: RuntimeSnapshot[] })
      .__kgRuntimeSnapshots.map((snapshot, index) => ({
        index,
        phase: snapshot.phase,
        timestamp: snapshot.timestamp,
        viewState: snapshot.viewState,
        nodeCount: snapshot.nodeCount,
        edgeCount: snapshot.edgeCount,
        layoutCanvasSize: snapshot.layoutCanvasSize,
      })));
  await expect.poll(async () => (await snapshotMetadata()).some((snapshot) =>
    predicate(snapshot)), { timeout }).toBe(true);
  const match = [...await snapshotMetadata()].reverse().find((snapshot) =>
    predicate(snapshot));
  if (!match) throw new Error('Expected KG runtime snapshot was not published.');
  return page.evaluate((index) =>
    (window as unknown as { __kgRuntimeSnapshots: RuntimeSnapshot[] })
      .__kgRuntimeSnapshots[index], match.index);
}

function assertWorldModelGeometry(snapshot: RuntimeSnapshot) {
  expect(snapshot.nodeCount).toBe(83);
  expect(snapshot.edgeCount).toBe(197);
  expect(snapshot.crossCategoryEdgeCount).toBe(48);
  expect(snapshot.nodes).toHaveLength(83);
  expect(snapshot.renderedEdges).toHaveLength(197);
  expect(snapshot.renderedLabelCount).toBe(0);
  expect(snapshot.renderedLabelReadErrorNodeIDs).toEqual([]);
  expect(snapshot.modelLayoutMetrics).not.toBeNull();
  expect(snapshot.modelLayoutMetrics?.finitePositionCount).toBe(83);
  expect(snapshot.layoutSource).not.toBeNull();
  expect(snapshot.modelNodes).toHaveLength(83);
  expect(new Set(snapshot.nodes.map((node) =>
    `${node.clientX.toFixed(3)},${node.clientY.toFixed(3)}`)).size).toBe(83);
  const detachedEdges = snapshot.renderedEdges.filter((edge) =>
    edge.sourceAttachmentDistance > 8
    || edge.targetAttachmentDistance > 8);
  expect(detachedEdges).toEqual([]);
  const connectedNodeIDs = new Set(snapshot.renderedEdges.flatMap((edge) => [
    edge.source,
    edge.target,
  ]));
  expect(snapshot.nodes.every((node) => connectedNodeIDs.has(node.id))).toBe(true);
}

function assertWorldScreenGeometry(snapshot: RuntimeSnapshot) {
  expect(snapshot.screenLayoutMetrics).not.toBeNull();
  expect(snapshot.screenLayoutMetrics?.finitePositionCount).toBe(83);
  expect(snapshot.screenLayoutMetrics?.nodeBoundsRatio.width).toBeGreaterThanOrEqual(0.68);
  expect(snapshot.screenLayoutMetrics?.nodeBoundsRatio.width).toBeLessThanOrEqual(0.90);
  expect(snapshot.screenLayoutMetrics?.nodeBoundsRatio.height).toBeGreaterThanOrEqual(0.62);
  expect(snapshot.screenLayoutMetrics?.nodeBoundsRatio.height).toBeLessThanOrEqual(0.88);
  expect(snapshot.screenLayoutMetrics?.nearestNeighborMedianRatio).toBeGreaterThanOrEqual(0.018);
  expect(snapshot.screenLayoutMetrics?.nearestNeighborMedianRatio).toBeLessThanOrEqual(0.055);
  expect(snapshot.screenLayoutMetrics?.nearestNeighborMaximumRatio).toBeLessThanOrEqual(0.11);
  expect(snapshot.screenLayoutMetrics?.maximumCategoryCentroidDistanceRatio).toBeLessThanOrEqual(0.50);
}

function assertWorldGeometry(snapshot: RuntimeSnapshot) {
  assertWorldModelGeometry(snapshot);
  assertWorldScreenGeometry(snapshot);
}

function assertRenderedEdgesAttached(snapshot: RuntimeSnapshot) {
  expect(snapshot.renderedEdges).toHaveLength(snapshot.edgeCount);
  expect(snapshot.renderedEdges.filter((edge) =>
    edge.sourceAttachmentDistance > 8
    || edge.targetAttachmentDistance > 8)).toEqual([]);
}

function coordinateMap(snapshot: RuntimeSnapshot) {
  return new Map(snapshot.nodes.map((node) => [node.id, { x: node.clientX, y: node.clientY }]));
}

async function clickResetAndWait(page: Page, checkpoint: number) {
  await page.getByRole('button', { name: '重置布局' }).click();
  return waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'layout-settled'
    && snapshot.viewState === 'WORLD'
    && snapshot.timestamp > checkpoint, 6_000);
}

test('global force constellation satisfies three viewports, deterministic reset, cache restore, and six-category drag contracts', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(screenshotDirectory, { recursive: true });
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    const isUmiDevServerWebSocketNoise = text.includes('ws://127.0.0.1:8001/')
      && (text.includes('__umi_ping') || text.includes('WebSocket connection'));
    if (!isUmiDevServerWebSocketNoise
      && (message.type() === 'error' || /(?:NaN|Infinity)/.test(text))) {
      browserErrors.push(text);
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await installHarness(page);
  await page.setViewportSize({ width: 1560, height: 907 });
  await page.goto('/om/kg', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 30_000 });

  let world!: RuntimeSnapshot;
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1560, height: 907 },
    { width: 1920, height: 1080 },
  ]) {
    const checkpoint = await latestSnapshotTimestamp(page);
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const canvasSize = await page.getByRole('application').evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    }));
    world = await waitForSnapshot(page, (snapshot) =>
      snapshot.phase === 'layout-settled'
      && snapshot.viewState === 'WORLD'
      && snapshot.layoutCanvasSize?.width === canvasSize.width
      && snapshot.layoutCanvasSize?.height === canvasSize.height
      && snapshot.timestamp > checkpoint, 6_000);
    console.log('KG_RUNTIME_METRICS', JSON.stringify({
      viewport,
      canvasSize,
      source: world.layoutSource,
      model: world.modelLayoutMetrics,
      screen: world.screenLayoutMetrics,
    }));
    assertWorldGeometry(world);
    const [canvasBounds, legendBounds, sidebarBounds] = await Promise.all([
      page.getByRole('application', { name: '知识世界画布' }).boundingBox(),
      page.getByLabel('知识图例').boundingBox(),
      page.locator('.ant-pro-sider').boundingBox(),
    ]);
    if (!canvasBounds || !legendBounds || !sidebarBounds) {
      throw new Error(`${viewport.width}px Canvas, legend, or sidebar bounds are unavailable.`);
    }
    expect(world.canvasSize.width).toBe(Math.round(canvasBounds.width));
    expect(world.canvasSize.height).toBe(Math.round(canvasBounds.height));
    if (viewport.width === 1024) {
      expect(canvasBounds.width).toBeGreaterThanOrEqual(650);
      expect(canvasBounds.height).toBeGreaterThanOrEqual(440);
      expect(legendBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x);
      expect(legendBounds.x + legendBounds.width)
        .toBeLessThanOrEqual(sidebarBounds.x + sidebarBounds.width);
      const legendOverlapsCanvas = legendBounds.x < canvasBounds.x + canvasBounds.width
        && legendBounds.x + legendBounds.width > canvasBounds.x
        && legendBounds.y < canvasBounds.y + canvasBounds.height
        && legendBounds.y + legendBounds.height > canvasBounds.y;
      expect(legendOverlapsCanvas).toBe(false);
      const navigationItems = page.locator(
        '.ant-pro-sider .ant-menu-item, .ant-pro-sider .ant-menu-submenu-title',
      );
      for (let index = 0; index < await navigationItems.count(); index += 1) {
        const navigationItem = navigationItems.nth(index);
        if (!await navigationItem.isVisible()) continue;
        const bounds = await navigationItem.boundingBox();
        if (!bounds) continue;
        const overlapsNavigation = legendBounds.x < bounds.x + bounds.width
          && legendBounds.x + legendBounds.width > bounds.x
          && legendBounds.y < bounds.y + bounds.height
          && legendBounds.y + legendBounds.height > bounds.y;
        expect(overlapsNavigation).toBe(false);
      }
      expect(canvasBounds.x + canvasBounds.width).toBeLessThanOrEqual(viewport.width);
      expect(canvasBounds.y + canvasBounds.height).toBeLessThanOrEqual(viewport.height);
      expect(legendBounds.x + legendBounds.width).toBeLessThanOrEqual(viewport.width);
      expect(legendBounds.y + legendBounds.height).toBeLessThanOrEqual(viewport.height);
      expect(world.nodes).toHaveLength(83);
      for (const node of world.nodes) {
        expect(node.minX, `${node.id} left bound`).toBeGreaterThanOrEqual(0);
        expect(node.minY, `${node.id} top bound`).toBeGreaterThanOrEqual(0);
        expect(node.maxX, `${node.id} right bound`).toBeLessThanOrEqual(viewport.width);
        expect(node.maxY, `${node.id} bottom bound`).toBeLessThanOrEqual(viewport.height);
      }

      const categoryButtons = page.getByLabel('知识图例').getByRole('button');
      await expect(categoryButtons).toHaveCount(6);
      const toolbarBounds = await page.locator('.kg-world-toolbar__primary').boundingBox();
      if (!toolbarBounds) {
        throw new Error('1024px toolbar bounds are unavailable.');
      }
      expect(toolbarBounds.x).toBeGreaterThanOrEqual(0);
      expect(toolbarBounds.y).toBeGreaterThanOrEqual(0);
      expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(viewport.width);
      expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(viewport.height);
      for (let index = 0; index < 6; index += 1) {
        const button = categoryButtons.nth(index);
        await expect(button).toBeVisible();
        await expect(button).toBeEnabled();
        const primaryLabelFits = await button.locator('strong').evaluate((label) =>
          label.scrollWidth <= label.clientWidth);
        expect(primaryLabelFits, `1024px category label ${index + 1} must not truncate`).toBe(true);
        const bounds = await button.boundingBox();
        if (!bounds) {
          throw new Error(`1024px category button ${index + 1} bounds are unavailable.`);
        }
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        const overlapsToolbar = bounds.x < toolbarBounds.x + toolbarBounds.width
          && bounds.x + bounds.width > toolbarBounds.x
          && bounds.y < toolbarBounds.y + toolbarBounds.height
          && bounds.y + bounds.height > toolbarBounds.y;
        expect(overlapsToolbar).toBe(false);
      }
    } else {
      expect(legendBounds.x).toBeGreaterThanOrEqual(canvasBounds.x + canvasBounds.width + 8);
      const categoryButtons = page.getByLabel('知识图例').getByRole('button');
      await expect(categoryButtons).toHaveCount(6);
      const buttonBounds = [];
      for (let index = 0; index < 6; index += 1) {
        const button = categoryButtons.nth(index);
        await expect(button).toBeVisible();
        const labelsFit = await button.evaluate((element) =>
          [...element.querySelectorAll('strong, small')].every(
            (label) => label.scrollWidth <= label.clientWidth,
          ));
        expect(labelsFit, `${viewport.width}px category button ${index + 1} labels must fit`).toBe(true);
        const bounds = await button.boundingBox();
        if (!bounds) throw new Error(`${viewport.width}px category button ${index + 1} bounds unavailable.`);
        buttonBounds.push(bounds);
      }
      expect(new Set(buttonBounds.map((bounds) => Math.round(bounds.x))).size).toBe(2);
      for (let first = 0; first < buttonBounds.length; first += 1) {
        for (let second = first + 1; second < buttonBounds.length; second += 1) {
          const a = buttonBounds[first];
          const b = buttonBounds[second];
          const overlaps = a.x < b.x + b.width && a.x + a.width > b.x
            && a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlaps, `${viewport.width}px category buttons ${first + 1}/${second + 1} overlap`).toBe(false);
        }
      }
    }
    await captureViewportScreenshot(
      page,
      `world-${viewport.width}x${viewport.height}.png`,
      viewport,
    );
    await expect(page.locator('.kg-category-overlay')).toHaveCount(0);
    await expect(page.locator('.kg-category-button')).toHaveCount(0);
    await expect(page.locator('[data-testid^="category-shape-"]')).toHaveCount(0);
    await expect(page.getByLabel('知识图例').getByRole('button')).toHaveCount(6);
  }

  await page.waitForTimeout(400);
  world = await waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'transform'
    && snapshot.viewState === 'WORLD'
    && snapshot.nodeCount === 83);
  const canvasCandidates = await page.evaluate((points) => points.filter((point) =>
    document.elementFromPoint(point.clientX, point.clientY)?.tagName === 'CANVAS'), world.nodes);
  expect(canvasCandidates.length).toBeGreaterThanOrEqual(20);
  const categoryByNodeID = new Map(overview.nodes.map((node: Record<string, any>) => [
    node.node_id,
    node.category_id,
  ]));
  const candidatesByCategory = new Map<string, {
    node: RuntimeSnapshot['nodes'][number];
    clearance: number;
  }>();
  for (const candidate of canvasCandidates) {
    const categoryID = categoryByNodeID.get(candidate.id);
    if (!categoryID) continue;
    const clearance = Math.min(...canvasCandidates
      .filter((other) => other.id !== candidate.id)
      .map((other) => Math.hypot(
        other.clientX - candidate.clientX,
        other.clientY - candidate.clientY,
      )));
    const current = candidatesByCategory.get(categoryID);
    if (!current || clearance > current.clearance) {
      candidatesByCategory.set(categoryID, { node: candidate, clearance });
    }
  }
  expect([...candidatesByCategory.keys()].sort()).toEqual(
    overview.categories.map((category: Record<string, any>) => category.id).sort(),
  );
  for (const [dragIndex, category] of overview.categories.entries()) {
    const candidate = candidatesByCategory.get(category.id)!.node;
    const node = world.nodes.find((point) => point.id === candidate.id) ?? candidate;
    const target = {
      x: node.clientX + (dragIndex % 2 === 0 ? -30 : 30),
      y: node.clientY + (dragIndex % 2 === 0 ? -24 : 24),
    };
    const checkpoint = world.timestamp;
    await page.mouse.move(node.clientX, node.clientY);
    await page.mouse.down();
    await page.waitForTimeout(20);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    world = await waitForSnapshot(page, (snapshot) =>
      snapshot.phase === 'node-drag'
      && snapshot.viewState === 'WORLD'
      && snapshot.timestamp > checkpoint, 2_000);
    assertWorldGeometry(world);
  }

  const firstReset = await clickResetAndWait(page, world.timestamp);
  const firstResetCoordinates = coordinateMap(firstReset);
  const secondReset = await clickResetAndWait(page, firstReset.timestamp);
  for (const [nodeID, first] of firstResetCoordinates) {
    const second = coordinateMap(secondReset).get(nodeID)!;
    expect(Math.hypot(second.x - first.x, second.y - first.y), nodeID).toBeLessThanOrEqual(1);
  }
  assertWorldGeometry(secondReset);

  const cachedRaw = await page.evaluate(() => localStorage.getItem('kg-world-layout-v3'));
  if (!cachedRaw) throw new Error('WORLD v3 cache was not written before reload.');
  const controlledCache = JSON.parse(cachedRaw) as {
    positions: Record<string, { x: number; y: number; categoryID: string }>;
    marker?: string;
  };
  controlledCache.marker = 'controlled-cache-provenance';
  for (const position of Object.values(controlledCache.positions)) {
    position.x += 13;
    position.y -= 7;
  }
  await page.evaluate((cache) => {
    localStorage.setItem('kg-world-layout-v3', JSON.stringify(cache));
  }, controlledCache);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 30_000 });
  const restored = await waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'layout-settled'
    && snapshot.viewState === 'WORLD'
    && snapshot.nodeCount === 83, 8_000);
  expect(restored.layoutSource).toBe('cache');
  const restoredModelByID = new Map(restored.modelNodes.map((node) => [node.id, node]));
  for (const [nodeID, expected] of Object.entries(controlledCache.positions)) {
    const actual = restoredModelByID.get(nodeID);
    expect(actual?.x, `${nodeID} cached x`).toBeCloseTo(expected.x, 6);
    expect(actual?.y, `${nodeID} cached y`).toBeCloseTo(expected.y, 6);
  }
  assertWorldGeometry(restored);

  const collapsedCache = structuredClone(controlledCache);
  for (const [index, position] of Object.values(collapsedCache.positions).entries()) {
    position.x = 420 + (index % 2);
    position.y = 320 + (index % 3);
  }
  await page.evaluate((cache) => {
    localStorage.setItem('kg-world-layout-v3', JSON.stringify(cache));
  }, collapsedCache);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 30_000 });
  const recoveredFromCollapsedCache = await waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'layout-settled'
    && snapshot.viewState === 'WORLD'
    && snapshot.nodeCount === 83, 8_000);
  expect(recoveredFromCollapsedCache.layoutSource).toBe('force');
  assertWorldGeometry(recoveredFromCollapsedCache);

  const relationSelect = page.getByLabel('关系类型');
  const relationshipType = await relationSelect.locator('option').nth(1).getAttribute('value');
  if (!relationshipType) throw new Error('A concrete relationship filter is required.');
  const filterCheckpoint = recoveredFromCollapsedCache.timestamp;
  await relationSelect.selectOption(relationshipType);
  const filtered = await waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'presentation'
    && snapshot.viewState === 'WORLD'
    && snapshot.timestamp > filterCheckpoint, 6_000);
  expect(filtered.nodeCount).toBe(83);
  expect(filtered.edgeCount).toBeGreaterThan(0);
  expect(filtered.edgeCount).toBeLessThan(197);
  assertRenderedEdgesAttached(filtered);
  await page.getByRole('button', { name: '重置筛选' }).click();
  const resetFilter = await waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'presentation'
    && snapshot.viewState === 'WORLD'
    && snapshot.edgeCount === 197
    && snapshot.timestamp > filtered.timestamp, 6_000);
  assertWorldGeometry(resetFilter);

  let returnedWorld = resetFilter;
  for (const category of overview.categories) {
    await page.getByLabel('知识图例').getByRole('button', {
      name: category.label_zh,
      exact: true,
    }).click();
    await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS', { timeout: 1_500 });
    await page.getByRole('button', { name: '查看区域详情' }).click();
    await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_DETAIL', { timeout: 1_200 });
    const returnCheckpoint = await latestSnapshotTimestamp(page);
    await page.getByRole('button', { name: '返回知识世界' }).click();
    await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 1_500 });
    returnedWorld = await waitForSnapshot(page, (snapshot) =>
      (snapshot.phase === 'layout-settled' || snapshot.phase === 'presentation')
      && snapshot.viewState === 'WORLD'
      && snapshot.timestamp > returnCheckpoint, 6_000);
    assertWorldModelGeometry(returnedWorld);
  }

  const resizeCheckpoint = returnedWorld.timestamp;
  await page.setViewportSize({ width: 1560, height: 907 });
  const resized = await waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'layout-settled'
    && snapshot.viewState === 'WORLD'
    && snapshot.timestamp > resizeCheckpoint, 6_000);
  assertWorldGeometry(resized);
  const fitCheckpoint = resized.timestamp;
  await page.getByRole('button', { name: '适应画布' }).click();
  const fitted = await waitForSnapshot(page, (snapshot) =>
    snapshot.phase === 'transform'
    && snapshot.viewState === 'WORLD'
    && snapshot.timestamp > fitCheckpoint, 6_000);
  expect(fitted.modelNodes).toEqual(resized.modelNodes);
  assertWorldGeometry(fitted);
  const firstCategory = overview.categories[0];
  const cacheBeforeFocus = await page.evaluate(() => localStorage.getItem('kg-world-layout-v3'));
  await page.getByLabel('知识图例').getByRole('button', {
    name: firstCategory.label_zh,
    exact: true,
  }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS', { timeout: 1_500 });
  expect(await page.evaluate(() => localStorage.getItem('kg-world-layout-v3'))).toBe(cacheBeforeFocus);
  await captureViewportScreenshot(
    page,
    'category-focus-1560x907.png',
    { width: 1560, height: 907 },
  );
  await page.getByRole('button', { name: '查看区域详情' }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_DETAIL', { timeout: 1_200 });
  await captureViewportScreenshot(
    page,
    'category-detail-1560x907.png',
    { width: 1560, height: 907 },
  );
  expect(browserErrors).toEqual([]);
});
