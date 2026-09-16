import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const overview = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/kg-overview.json'), 'utf8'),
) as Record<string, any>;
const screenshotDir = path.join(process.cwd(), 'test-results/kg-world');
const appURL = 'http://127.0.0.1:8000';
const devServerURL = 'http://127.0.0.1:8001';
const collectionsCategoryID = 'collections-and-access';
const collectionsNodeIDs = new Set(overview.nodes
  .filter((node: Record<string, any>) => node.category_id === collectionsCategoryID)
  .map((node: Record<string, any>) => node.node_id));
const collectionsPath = overview.paths.find((candidate: Record<string, any>) =>
  candidate.category_ids.includes(collectionsCategoryID)
  && candidate.upstream.some((nodeID: string) => collectionsNodeIDs.has(nodeID))
  && candidate.focus.some((nodeID: string) => collectionsNodeIDs.has(nodeID))
  && candidate.downstream.some((nodeID: string) => collectionsNodeIDs.has(nodeID)),
);

type DebugPoint = {
  id: string;
  clientX: number;
  clientY: number;
  opacity: number;
  size?: number;
  fill?: string;
  shadowBlur?: number;
  shadowColor?: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
type DebugSnapshot = {
  phase: string;
  timestamp: number;
  elapsedMs: number;
  viewState: string;
  activeCategoryID: string;
  nodeCount: number;
  edgeCount: number;
  renderedLabelCount: number | null;
  renderedLabelReadErrorNodeIDs: string[];
  zoom: number;
  camera: { x: number; y: number };
  canvasSize: { width: number; height: number };
  focusNodeID?: string;
  nodes: DebugPoint[];
  edges: Array<DebugPoint & {
    source: string;
    target: string;
    lineWidth: number;
    states: string[];
  }>;
  ports: DebugPoint[];
  runtime?: {
    g6ListenerCount: number;
    intervalCount: number;
    timeoutCount: number;
    g6AnimationCount: number;
    timelineAnimationCount: number;
  };
};

async function installTestHarness(page: Page) {
  await page.context().clearCookies();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const kgPendingRafs = new Set<number>();
    Object.defineProperty(window, '__kgPendingRafs', {
      configurable: false,
      enumerable: false,
      value: kgPendingRafs,
      writable: false,
    });
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const track = Boolean(document.querySelector('.kg-graph-canvas'));
      let id = 0;
      id = nativeRequestAnimationFrame((time) => {
        kgPendingRafs.delete(id);
        callback(time);
      });
      if (track) kgPendingRafs.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id: number) => {
      kgPendingRafs.delete(id);
      nativeCancelAnimationFrame(id);
    };
    const events: unknown[] = [];
    Object.defineProperty(window, '__kgE2EEvents', {
      configurable: false,
      enumerable: false,
      value: events,
      writable: false,
    });
    const longTasks: Array<{ startTime: number; duration: number }> = [];
    Object.defineProperty(window, '__kgLongTasks', {
      configurable: false,
      enumerable: false,
      value: longTasks,
      writable: false,
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
    const transitionEvents: Array<{ phase: string; timestamp: number }> = [];
    Object.defineProperty(window, '__kgTransitionEvents', {
      configurable: false,
      enumerable: false,
      value: transitionEvents,
      writable: false,
    });
    window.addEventListener('kg-world-transition-debug', (event) => {
      transitionEvents.push(structuredClone((event as CustomEvent).detail));
    });
    window.addEventListener('kg-graph-debug', (event) => {
      events.push(structuredClone((event as CustomEvent).detail));
    });
  });

  // Port 8000 is the acceptance URL. The local desktop also runs an unrelated service there,
  // so only this browser context maps application documents/assets to the deterministic Umi server.
  await page.route(`${appURL}/**`, async (route) => {
    const requestURL = new URL(route.request().url());
    const upstreamURL = `${devServerURL}${requestURL.pathname}${requestURL.search}`;
    const response = await route.fetch({ url: upstreamURL });
    await route.fulfill({ response });
  });
  await page.route('**/api/admin/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":true}' });
  });
  await page.route('**/api/kg/overview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(overview),
    });
  });
}

async function openKnowledgeWorld(page: Page) {
  await installTestHarness(page);
  await page.goto('/om/kg', { waitUntil: 'domcontentloaded' });
  // The first dev-only MFSU dependency response is ~22MB; this boot allowance is not a graph
  // performance gate. Canvas paint/layout durations are measured inside the mounted component.
  await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 30_000 });
  await expect(page.locator('.kg-g6-host canvas').first()).toBeVisible();
  await waitForDebug(page, (event) => event.phase === 'layout-settled' && event.viewState === 'WORLD');
}

async function debugEvents(page: Page): Promise<DebugSnapshot[]> {
  try {
    return await page.evaluate(() =>
      ((window as unknown as { __kgE2EEvents: DebugSnapshot[] }).__kgE2EEvents ?? []));
  } catch (error) {
    if (String(error).includes('Execution context was destroyed')) return [];
    throw error;
  }
}

async function waitForDebug(
  page: Page,
  predicate: (event: DebugSnapshot) => boolean,
  timeout = 10_000,
): Promise<DebugSnapshot> {
  const handle = await page.waitForFunction(
    ([phase, viewState, activeCategoryID, focusNodeID]) => {
      const events = (window as unknown as { __kgE2EEvents?: DebugSnapshot[] }).__kgE2EEvents ?? [];
      return [...events].reverse().find((event) =>
        (!phase || event.phase === phase)
        && (!viewState || event.viewState === viewState)
        && (!activeCategoryID || event.activeCategoryID === activeCategoryID)
        && (!focusNodeID || event.focusNodeID === focusNodeID),
      );
    },
    [
      predicate.toString().includes("phase === 'focus-peak'") ? 'focus-peak' : '',
      '',
      '',
      '',
    ],
    { timeout },
  ).catch(() => undefined);
  if (handle) {
    const quick = await handle.jsonValue() as DebugSnapshot;
    await handle.dispose();
    if (predicate(quick)) return quick;
  }
  try {
    await expect.poll(async () => (await debugEvents(page)).some(predicate), { timeout }).toBe(true);
  } catch (error) {
    const published = (await debugEvents(page)).map((event) =>
      `${event.phase}:${event.viewState}:${event.nodeCount}n:${Math.round(event.elapsedMs)}ms`).join(', ');
    throw new Error(
      `Expected KG debug snapshot was not published. Published: ${published || '(none)'}`,
      { cause: error },
    );
  }
  const events = await debugEvents(page);
  const match = [...events].reverse().find(predicate);
  if (!match) throw new Error('Expected KG debug snapshot was not published.');
  return match;
}

async function latestDebug(page: Page, predicate: (event: DebugSnapshot) => boolean) {
  const events = await debugEvents(page);
  const match = [...events].reverse().find(predicate);
  if (!match) {
    throw new Error(`KG debug snapshot is unavailable. Published: ${JSON.stringify(
      events.map((event) => ({ phase: event.phase, viewState: event.viewState, nodeCount: event.nodeCount })),
    )}`);
  }
  return match;
}

async function blankCanvasPoint(
  page: Page,
  snapshot: DebugSnapshot,
  box: { x: number; y: number; width: number; height: number },
) {
  const occupied = [...snapshot.nodes, ...snapshot.ports];
  for (const yRatio of [0.82, 0.68, 0.54, 0.40, 0.26]) {
    for (const xRatio of [0.82, 0.68, 0.54, 0.40, 0.26]) {
      const point = { x: box.x + box.width * xRatio, y: box.y + box.height * yRatio };
      if (occupied.some((node) =>
        point.x >= node.minX - 8
        && point.x <= node.maxX + 8
        && point.y >= node.minY - 8
        && point.y <= node.maxY + 8)) {
        continue;
      }
      const isCanvas = await page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.tagName === 'CANVAS', point);
      if (isCanvas) return point;
    }
  }
  throw new Error('No Canvas point outside every rendered node and port bound was available.');
}

async function visibleCanvasNode(
  page: Page,
  snapshot: DebugSnapshot,
  box: { x: number; y: number; width: number; height: number },
  preferredID?: string,
) {
  const candidates = snapshot.nodes.slice().sort((left, right) =>
    Number(right.id === preferredID) - Number(left.id === preferredID));
  for (const node of candidates) {
    if (
      node.clientX < box.x + 36
      || node.clientX > box.x + box.width - 36
      || node.clientY < box.y + 36
      || node.clientY > box.y + box.height - 36
    ) continue;
    const isCanvas = await page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.tagName === 'CANVAS', {
        x: node.clientX,
        y: node.clientY,
      });
    if (isCanvas) return node;
  }
  throw new Error('No unobstructed graph node was available for the pointer interaction.');
}

async function visibleCanvasNodesFromIDs(
  page: Page,
  snapshot: DebugSnapshot,
  box: { x: number; y: number; width: number; height: number },
  nodeIDs: ReadonlySet<string>,
  count: number,
) {
  const visible: DebugPoint[] = [];
  for (const node of snapshot.nodes.filter((candidate) => nodeIDs.has(candidate.id))) {
    if (
      node.clientX < box.x + 36
      || node.clientX > box.x + box.width - 36
      || node.clientY < box.y + 36
      || node.clientY > box.y + box.height - 36
    ) continue;
    const isCanvas = await page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.tagName === 'CANVAS', {
        x: node.clientX,
        y: node.clientY,
      });
    if (isCanvas) visible.push(node);
    if (visible.length === count) return visible;
  }
  throw new Error(`Expected ${count} unobstructed nodes, received ${visible.length}.`);
}

async function clickCategory(page: Page) {
  await page.evaluate(() => {
    const marks = { startedAt: performance.now(), enteringAt: 0, panelAt: 0, focusAt: 0 };
    Object.defineProperty(window, '__kgTransitionMarks', { configurable: true, value: marks });
    const observer = new MutationObserver(() => {
      const state = document.querySelector('[data-testid="kg-view-state"]')?.textContent;
      const now = performance.now();
      if (state === 'ENTERING_CATEGORY' && marks.enteringAt === 0) marks.enteringAt = now;
      if (document.querySelector('[aria-label="区域简介"]') && marks.panelAt === 0) marks.panelAt = now;
      if (state === 'CATEGORY_FOCUS' && marks.focusAt === 0) {
        marks.focusAt = now;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByLabel('知识图例').getByRole('button', {
    name: '集合与访问域',
    exact: true,
  }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('ENTERING_CATEGORY');
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS', { timeout: 1_200 });
  await expect(page.getByLabel('区域简介')).toContainText('Collections and Access');
  const marks = await page.evaluate(() =>
    (window as unknown as { __kgTransitionMarks: Record<string, number> }).__kgTransitionMarks);
  expect(marks.enteringAt - marks.startedAt).toBeLessThan(120);
  expect(marks.panelAt - marks.startedAt).toBeGreaterThanOrEqual(520);
  expect(marks.panelAt - marks.startedAt).toBeLessThanOrEqual(800);
  expect(marks.focusAt - marks.startedAt).toBeGreaterThanOrEqual(790);
  expect(marks.focusAt - marks.startedAt).toBeLessThanOrEqual(900);
  return marks.startedAt;
}

async function cameraCheckpoint(page: Page) {
  const events = await debugEvents(page);
  return {
    snapshot: [...events].reverse().find((event) => event.phase === 'transform')!,
    transformCount: events.filter((event) => event.phase === 'transform').length,
  };
}

async function expectCameraCheckpointUnchanged(
  page: Page,
  before: Awaited<ReturnType<typeof cameraCheckpoint>>,
) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const events = await debugEvents(page);
  const transforms = events.filter((event) => event.phase === 'transform');
  const afterCheckpoint = transforms.slice(before.transformCount);
  for (const snapshot of afterCheckpoint) {
    expect(snapshot.zoom).toBeCloseTo(before.snapshot.zoom, 6);
    expect(snapshot.camera.x).toBeCloseTo(before.snapshot.camera.x, 6);
    expect(snapshot.camera.y).toBeCloseTo(before.snapshot.camera.y, 6);
  }
}

async function enterDetail(page: Page) {
  const startedAt = await page.evaluate(() => {
    const marks = { startedAt: performance.now(), enteringAt: 0, detailAt: 0 };
    Object.defineProperty(window, '__kgDetailMarks', { configurable: true, value: marks });
    const observer = new MutationObserver(() => {
      const state = document.querySelector('[data-testid="kg-view-state"]')?.textContent;
      const now = performance.now();
      if (state === 'ENTERING_DETAIL' && marks.enteringAt === 0) marks.enteringAt = now;
      if (state === 'CATEGORY_DETAIL' && marks.detailAt === 0) {
        marks.detailAt = now;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return marks.startedAt;
  });
  await page.getByRole('button', { name: '查看区域详情' }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('ENTERING_DETAIL');
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_DETAIL', { timeout: 900 });
  await waitForDebug(page, (event) =>
    event.phase === 'layout-settled'
    && event.timestamp >= startedAt
    && event.viewState === 'ENTERING_DETAIL'
    && event.activeCategoryID === collectionsCategoryID,
  );
  const marks = await page.evaluate(() =>
    (window as unknown as { __kgDetailMarks: Record<string, number> }).__kgDetailMarks);
  const diagnostics = await page.evaluate(({ startedAt, detailAt }) => {
    const debugWindow = window as unknown as {
      __kgLongTasks: Array<{ startTime: number; duration: number }>;
      __kgTransitionEvents: Array<{ phase: string; timestamp: number }>;
    };
    return {
      longTasks: debugWindow.__kgLongTasks.filter((entry) =>
        entry.startTime + entry.duration >= startedAt - 25
        && entry.startTime <= detailAt + 25),
      transitions: debugWindow.__kgTransitionEvents.filter((entry) =>
        entry.timestamp >= startedAt - 25
        && entry.timestamp <= detailAt + 25),
    };
  }, { startedAt: marks.startedAt, detailAt: marks.detailAt });
  expect(marks.enteringAt - marks.startedAt).toBeLessThan(120);
  expect(marks.detailAt - marks.startedAt).toBeGreaterThanOrEqual(490);
  expect(
    marks.detailAt - marks.startedAt,
    JSON.stringify({ marks, diagnostics }),
  ).toBeLessThanOrEqual(600);
  return {
    startedAt: marks.startedAt,
    transitionMs: marks.detailAt - marks.startedAt,
  };
}

function expectPointsInside(
  points: Array<{ clientX: number; clientY: number }>,
  box: { x: number; y: number; width: number; height: number },
  padding: [number, number, number, number],
) {
  const [top, right, bottom, left] = padding;
  for (const point of points) {
    expect(point.clientX).toBeGreaterThanOrEqual(box.x + left);
    expect(point.clientX).toBeLessThanOrEqual(box.x + box.width - right);
    expect(point.clientY).toBeGreaterThanOrEqual(box.y + top);
    expect(point.clientY).toBeLessThanOrEqual(box.y + box.height - bottom);
  }
}

type Box = { x: number; y: number; width: number; height: number };

function boxesIntersect(left: Box, right: Box) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function boxDistance(left: Box, right: Box) {
  const dx = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width));
  const dy = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height));
  return Math.hypot(dx, dy);
}

function pointBox(point: DebugPoint): Box {
  return {
    x: point.minX,
    y: point.minY,
    width: point.maxX - point.minX,
    height: point.maxY - point.minY,
  };
}

function expectVisibleDistinctWorldNodes(snapshot: DebugSnapshot, drawable: Box) {
  expect(snapshot.nodeCount).toBe(83);
  expect(snapshot.nodes).toHaveLength(83);
  expect(new Set(snapshot.nodes.map((node) =>
    `${node.clientX.toFixed(3)},${node.clientY.toFixed(3)}`)).size).toBe(83);
  expect(snapshot.nodes.every((node) => node.opacity >= 0.99)).toBe(true);
  for (const node of snapshot.nodes.map(pointBox)) {
    expect(node.x).toBeGreaterThanOrEqual(drawable.x);
    expect(node.y).toBeGreaterThanOrEqual(drawable.y);
    expect(node.x + node.width).toBeLessThanOrEqual(drawable.x + drawable.width);
    expect(node.y + node.height).toBeLessThanOrEqual(drawable.y + drawable.height);
  }
}

function expectBoundaryPorts(ports: DebugPoint[], drawable: Box) {
  const portBoxes = ports.map((port) => ({ ...pointBox(port), id: port.id }));
  for (const port of portBoxes) {
    expect(port.x).toBeGreaterThanOrEqual(drawable.x);
    expect(port.y).toBeGreaterThanOrEqual(drawable.y);
    expect(port.x + port.width).toBeLessThanOrEqual(drawable.x + drawable.width);
    expect(port.y + port.height).toBeLessThanOrEqual(drawable.y + drawable.height);
    const nearestBoundaryDistance = Math.min(
      port.x - drawable.x,
      drawable.x + drawable.width - (port.x + port.width),
      port.y - drawable.y,
      drawable.y + drawable.height - (port.y + port.height),
    );
    expect(nearestBoundaryDistance).toBeGreaterThanOrEqual(27);
    expect(nearestBoundaryDistance).toBeLessThanOrEqual(29);
  }
  for (let leftIndex = 0; leftIndex < portBoxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < portBoxes.length; rightIndex += 1) {
      const pair = `${portBoxes[leftIndex].id} ${JSON.stringify(portBoxes[leftIndex])} / ${portBoxes[rightIndex].id} ${JSON.stringify(portBoxes[rightIndex])}`;
      expect(boxesIntersect(portBoxes[leftIndex], portBoxes[rightIndex]), pair).toBe(false);
      expect(boxDistance(portBoxes[leftIndex], portBoxes[rightIndex]), pair).toBeGreaterThanOrEqual(12);
    }
  }
  return portBoxes;
}

async function expectPortsAvoidDrawer(
  page: Page,
  drawerLabel: '节点详情' | '关系详情' | '跨区域关系',
  canvas: Box,
  afterTimestamp: number,
) {
  const drawer = await page.getByLabel(drawerLabel).boundingBox();
  if (!drawer) throw new Error(`${drawerLabel} bounds are unavailable.`);
  const snapshot = await waitForDebug(page, (event) =>
    event.phase === 'presentation'
    && event.timestamp > afterTimestamp
    && event.ports.length > 0);
  const drawable = {
    x: canvas.x,
    y: canvas.y,
    width: drawer.x - canvas.x,
    height: canvas.height,
  };
  const portBoxes = expectBoundaryPorts(snapshot.ports, drawable);
  for (const port of portBoxes) expect(boxesIntersect(port, drawer)).toBe(false);
}

async function screenshot(page: Page, filename: string) {
  await expect(page.locator('body')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const image = await page.screenshot({
    fullPage: false,
  });
  const target = path.join(screenshotDir, filename);
  const updateEvidence = process.env.UPDATE_KG_SCREENSHOTS === '1';
  if (!existsSync(target) || updateEvidence) writeFileSync(target, image);
}

async function frozenPeakScreenshot(page: Page, filename: string) {
  await expect(page.locator('body')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
  try {
    const image = await page.screenshot({ fullPage: false });
    const target = path.join(screenshotDir, filename);
    const updateEvidence = process.env.UPDATE_KG_SCREENSHOTS === '1';
    if (!existsSync(target) || updateEvidence) writeFileSync(target, image);
  } finally {
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
  }
}

async function startFrameMeasurement(page: Page, durationMs: number): Promise<number> {
  return page.evaluate((duration) => new Promise<number>((resolve) => {
    const start = performance.now();
    let frames = 0;
    const tick = (now: number) => {
      frames += 1;
      if (now - start >= duration) {
        resolve(frames * 1000 / (now - start));
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }), durationMs);
}

async function continuousMoves(
  page: Page,
  origin: { x: number; y: number },
  durationMs: number,
  radius = 70,
) {
  const start = Date.now();
  let step = 0;
  while (Date.now() - start < durationMs) {
    const angle = step * 0.28;
    await page.mouse.move(
      origin.x + Math.cos(angle) * radius,
      origin.y + Math.sin(angle) * radius * 0.55,
    );
    step += 1;
    await page.waitForTimeout(12);
  }
}

test('the committed real overview fixture has the exact graph contract', async () => {
  expect(overview.counts.nodes).toBe(83);
  expect(overview.counts.categories).toBe(6);
  expect(overview.counts.unique_relation_triples).toBe(367);
  expect(overview.counts.visual_directed_pairs).toBe(197);
  expect(overview.counts.paths).toBe(160);
  expect(overview.nodes).toHaveLength(83);
  expect(new Set(overview.nodes.map((node: Record<string, any>) => node.node_id)).size).toBe(83);
  expect(overview.categories).toHaveLength(6);
  expect(overview.relations).toHaveLength(367);
  expect(overview.visual_edges).toHaveLength(197);
  expect(overview.paths).toHaveLength(160);
});

test('real G6 Canvas supports the complete three-level interaction journey and eight visual states', async ({ page }) => {
  await openKnowledgeWorld(page);
  await expect(page.locator('.kg-category-overlay')).toHaveCount(0);
  await expect(page.locator('.kg-category-button')).toHaveCount(0);
  await expect(page.locator('[data-testid^="category-shape-"]')).toHaveCount(0);
  const categoryLegend = page.getByLabel('知识图例');
  await expect(categoryLegend.getByRole('button')).toHaveCount(6);
  const worldPaint = await latestDebug(page, (event) =>
    event.phase === 'layout-settled' && event.viewState === 'WORLD');
  expect(worldPaint.nodeCount).toBe(83);
  expect(worldPaint.edgeCount).toBe(197);
  expect(worldPaint.renderedLabelCount).toBe(0);
  expect(worldPaint.renderedLabelReadErrorNodeIDs).toEqual([]);
  await expect(page.getByLabel('节点详情')).toHaveCount(0);
  await expect(page.getByLabel('区域简介')).toHaveCount(0);
  const categoryByID = new Map(overview.categories.map((category: Record<string, any>) => [
    category.id,
    category,
  ]));
  const nodeByID = new Map(overview.nodes.map((node: Record<string, any>) => [node.node_id, node]));
  for (const category of overview.categories) {
    const legendButton = categoryLegend.getByRole('button', {
      name: category.label_zh,
      exact: true,
    });
    await expect(legendButton).toContainText(category.label_zh);
    await expect(legendButton).toContainText(category.label_en);
    await expect(legendButton).toContainText(`${category.node_count} 个节点`);
  }
  for (const point of worldPaint.nodes) {
    const node = nodeByID.get(point.id);
    expect(point.fill).toBe(categoryByID.get(node.category_id).color);
  }
  const canvasBox = await page.getByRole('application', { name: '知识世界画布' }).boundingBox();
  if (!canvasBox) throw new Error('Canvas bounds are unavailable.');
  expectVisibleDistinctWorldNodes(worldPaint, canvasBox);
  await screenshot(page, '01-world-1560x907.png');
  const tooltipNode = await visibleCanvasNode(page, worldPaint, canvasBox, 'Concept:list');
  await page.mouse.move(tooltipNode.clientX, tooltipNode.clientY);
  const tooltipContent = page.locator('.kg-node-tooltip');
  const tooltip = tooltipContent.locator('..');
  await expect(tooltip).toBeVisible();
  await expect(tooltipContent).toContainText('Label:');
  await expect(tooltipContent).toContainText(`Node ID: ${tooltipNode.id}`);
  await expect(tooltipContent).toContainText('Category:');
  await expect(tooltipContent).toContainText('Degree:');
  const tooltipExitPoint = await blankCanvasPoint(page, worldPaint, canvasBox);
  await page.mouse.move(tooltipExitPoint.x, tooltipExitPoint.y);
  await expect(tooltip).toHaveCSS('visibility', 'hidden', { timeout: 120 });
  const beforeWheel = await latestDebug(page, (event) => event.viewState === 'WORLD');
  const wheelAnchor = {
    x: canvasBox.x + canvasBox.width * 0.72,
    y: canvasBox.y + canvasBox.height * 0.68,
  };
  const wheelReferenceNode = beforeWheel.nodes[0];
  await page.mouse.move(wheelAnchor.x, wheelAnchor.y);
  await page.mouse.wheel(0, -10);
  await expect.poll(async () => {
    const snapshot = await latestDebug(page, (event) =>
      event.phase === 'transform' && event.timestamp > beforeWheel.timestamp);
    return snapshot.zoom / beforeWheel.zoom;
  }).toBeCloseTo(1.10, 2);
  const afterWheel = await latestDebug(page, (event) =>
    event.phase === 'transform' && event.timestamp > beforeWheel.timestamp);
  const wheelRatio = afterWheel.zoom / beforeWheel.zoom;
  expect(wheelRatio).toBeCloseTo(1.10, 2);
  const afterWheelReferenceNode = afterWheel.nodes.find((node) => node.id === wheelReferenceNode.id)!;
  expect(Math.abs(afterWheelReferenceNode.clientX
    - (wheelAnchor.x + wheelRatio * (wheelReferenceNode.clientX - wheelAnchor.x))))
    .toBeLessThanOrEqual(2);
  expect(Math.abs(afterWheelReferenceNode.clientY
    - (wheelAnchor.y + wheelRatio * (wheelReferenceNode.clientY - wheelAnchor.y))))
    .toBeLessThanOrEqual(2);

  const beforePan = await latestDebug(page, (event) => event.phase === 'transform');
  const blank = await blankCanvasPoint(page, beforePan, canvasBox);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x - 120, blank.y - 72, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => {
    const snapshot = await latestDebug(page, (event) => event.phase === 'transform');
    return `${snapshot.camera.x},${snapshot.camera.y}`;
  }).not.toBe(`${beforePan.camera.x},${beforePan.camera.y}`);

  const categoryStartedAt = await clickCategory(page);
  await page.waitForTimeout(100);
  await expect.poll(async () => {
    const snapshot = await latestDebug(page, (event) =>
      event.phase === 'transform'
      && event.activeCategoryID === collectionsCategoryID
      && event.nodeCount === collectionsNodeIDs.size);
    const [top, right, bottom, left] = [64, 296, 64, 424];
    return snapshot.nodes.length === collectionsNodeIDs.size
      && snapshot.nodes.every((point) => collectionsNodeIDs.has(point.id)
      &&
      point.clientX >= canvasBox.x + left
      && point.clientX <= canvasBox.x + canvasBox.width - right
      && point.clientY >= canvasBox.y + top
      && point.clientY <= canvasBox.y + canvasBox.height - bottom);
  }, { timeout: 1_000 }).toBe(true);
  const categoryCamera = await latestDebug(page, (event) =>
    event.phase === 'transform'
    && event.activeCategoryID === collectionsCategoryID
    && event.nodeCount === collectionsNodeIDs.size);
  expect(categoryCamera.nodeCount).toBe(16);
  expect(categoryCamera.nodes).toHaveLength(16);
  expect(categoryCamera.nodes.every((node) => collectionsNodeIDs.has(node.id))).toBe(true);
  expect(categoryCamera.timestamp - categoryStartedAt).toBeLessThanOrEqual(900);
  expectPointsInside(categoryCamera.nodes, canvasBox, [64, 296, 64, 424]);
  await expect(page.locator('.kg-category-overlay')).toHaveCount(0);
  await expect(page.locator('.kg-category-button')).toHaveCount(0);
  await expect(page.locator('[data-testid^="category-shape-"]')).toHaveCount(0);
  const categoryPanel = await page.getByLabel('区域简介').boundingBox();
  if (!categoryPanel) throw new Error('Category panel bounds are unavailable.');
  await page.mouse.move(
    categoryPanel.x + categoryPanel.width / 2,
    categoryPanel.y + categoryPanel.height / 2,
  );
  await expect(tooltip).toHaveCSS('visibility', 'hidden', { timeout: 120 });
  const focusLegend = await page.getByLabel('知识图例').boundingBox();
  if (!focusLegend) throw new Error('Focus legend bounds are unavailable.');
  for (const node of categoryCamera.nodes) {
    expect(boxesIntersect(pointBox(node), focusLegend)).toBe(false);
  }
  await screenshot(page, '02-collections-focus-1560x907.png');
  const detailTransition = await enterDetail(page);
  const detailStartedAt = detailTransition.startedAt;
  const detailCamera = await waitForDebug(page, (event) =>
    (event.phase === 'transform' || event.phase === 'presentation')
    && event.timestamp > detailStartedAt
    && event.activeCategoryID === collectionsCategoryID
    && event.nodeCount === 16
    && event.ports.length > 0);
  expectPointsInside(detailCamera.nodes, canvasBox, [64, 64, 64, 64]);
  const portBoxes = expectBoundaryPorts(detailCamera.ports, canvasBox);
  const controls = await Promise.all([
    page.getByLabel('知识世界工具栏').boundingBox(),
    page.getByLabel('区域详情导航').boundingBox(),
    page.getByLabel('知识图例').boundingBox(),
  ]);
  for (const control of controls) {
    if (!control) throw new Error('Detail control bounds are unavailable.');
    for (const port of portBoxes) expect(boxesIntersect(port, control)).toBe(false);
  }
  await screenshot(page, '03-collections-detail-1560x907.png');

  let detail = detailCamera;
  expect(detail.nodeCount).toBe(16);
  const draggedNode = await visibleCanvasNode(page, detail, canvasBox, 'Concept:list');
  const settlementBeforeDrag = detail.timestamp;
  await page.mouse.move(draggedNode.clientX, draggedNode.clientY);
  await page.mouse.down();
  await page.mouse.move(draggedNode.clientX + 84, draggedNode.clientY + 42, { steps: 12 });
  const dragSnapshot = await waitForDebug(page, (event) => {
    if (event.phase !== 'node-drag' || event.timestamp <= settlementBeforeDrag) return false;
    const point = event.nodes.find((node) => node.id === draggedNode.id);
    return Boolean(point
      && Math.abs((point.clientX - draggedNode.clientX) - 84) <= 15
      && Math.abs((point.clientY - draggedNode.clientY) - 42) <= 15);
  });
  const draggedDuringGesture = dragSnapshot.nodes.find((node) => node.id === draggedNode.id)!;
  expect(Math.abs((draggedDuringGesture.clientX - draggedNode.clientX) - 84))
    .toBeLessThanOrEqual(15);
  expect(Math.abs((draggedDuringGesture.clientY - draggedNode.clientY) - 42))
    .toBeLessThanOrEqual(15);
  await page.mouse.up();
  await waitForDebug(page, (event) => event.phase === 'node-drag');
  await waitForDebug(page, (event) =>
    event.phase === 'layout-settled'
    && event.viewState === 'CATEGORY_DETAIL'
    && event.timestamp > settlementBeforeDrag);

  detail = await latestDebug(page, (event) =>
    event.phase === 'layout-settled' && event.viewState === 'CATEGORY_DETAIL');
  const nodePoint = await visibleCanvasNode(page, detail, canvasBox, draggedNode.id);
  const beforeNodeDrawer = await cameraCheckpoint(page);
  const beforeNodeDrawerTimestamp = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.mouse.click(nodePoint.clientX, nodePoint.clientY);
  await expect(page.getByLabel('节点详情')).toBeVisible();
  await expect(page.getByLabel('节点详情')).toContainText(nodePoint.id);
  await expectPortsAvoidDrawer(page, '节点详情', canvasBox, beforeNodeDrawerTimestamp);
  const nodeDrawerBox = await page.getByLabel('节点详情').boundingBox();
  const nodeDrawerLegendBox = await page.getByLabel('知识图例').boundingBox();
  if (!nodeDrawerBox || !nodeDrawerLegendBox) {
    throw new Error('Node drawer or legend bounds are unavailable.');
  }
  expect(
    boxesIntersect(nodeDrawerLegendBox, nodeDrawerBox),
    `legend ${JSON.stringify(nodeDrawerLegendBox)} / drawer ${JSON.stringify(nodeDrawerBox)}`,
  ).toBe(false);
  expect(boxDistance(nodeDrawerLegendBox, nodeDrawerBox)).toBeGreaterThanOrEqual(8);
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expectCameraCheckpointUnchanged(page, beforeNodeDrawer);

  const oneHopIDs = new Set([nodePoint.id]);
  for (const edge of overview.visual_edges) {
    if (edge.source === nodePoint.id) oneHopIDs.add(edge.target);
    if (edge.target === nodePoint.id) oneHopIDs.add(edge.source);
  }
  const transformBeforeDoubleClick = (await latestDebug(page, (event) => event.phase === 'transform')).timestamp;
  await page.mouse.click(nodePoint.clientX, nodePoint.clientY, { clickCount: 2, delay: 60 });
  const neighborhoodCamera = await waitForDebug(page, (event) =>
    event.phase === 'transform' && event.timestamp > transformBeforeDoubleClick);
  expectPointsInside(
    neighborhoodCamera.nodes.filter((node) => oneHopIDs.has(node.id)),
    canvasBox,
    [80, 80, 80, 80],
  );
  await expect(page.getByLabel('节点详情')).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();

  detail = await latestDebug(page, (event) => event.viewState === 'CATEGORY_DETAIL');
  const edgePoint = detail.edges.find((edge) =>
    edge.source === 'Concept:dict' && edge.target === 'Concept:key') ?? detail.edges[0];
  const beforeEdgeDrawer = await cameraCheckpoint(page);
  const beforeEdgeDrawerTimestamp = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.mouse.click(edgePoint.clientX, edgePoint.clientY);
  await expect(page.getByLabel('关系详情')).toBeVisible();
  await expect(page.getByLabel('关系详情')).toContainText('relation types');
  await expectPortsAvoidDrawer(page, '关系详情', canvasBox, beforeEdgeDrawerTimestamp);
  const selectedEdgeFrame = await waitForDebug(page, (event) =>
    event.phase === 'presentation'
    && event.viewState === 'CATEGORY_DETAIL'
    && event.timestamp > beforeEdgeDrawerTimestamp
    && event.edges.some((edge) => edge.id === edgePoint.id && edge.lineWidth === 2.5));
  expect(selectedEdgeFrame.edges.find((edge) => edge.id === edgePoint.id)?.opacity).toBe(0.82);

  const selectedEdgeReturnStartedAt = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.getByRole('button', { name: '返回知识世界' }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 1_300 });
  const worldAfterSelectedEdge = await waitForDebug(page, (event) =>
    (event.phase === 'layout-settled' || event.phase === 'presentation')
    && event.viewState === 'WORLD'
    && event.nodeCount === 83
    && event.timestamp > selectedEdgeReturnStartedAt, 4_000);
  expect(worldAfterSelectedEdge.edges).toHaveLength(197);
  const edgeByID = new Map(overview.visual_edges.map((edge: Record<string, any>) => [edge.key, edge]));
  for (const edge of worldAfterSelectedEdge.edges) {
    const source = edgeByID.get(edge.id) as Record<string, any> | undefined;
    expect(edge.lineWidth, edge.id).toBe(source?.is_cross_category ? 1.4 : 1);
    expect(edge.opacity, edge.id).toBe(source?.is_cross_category ? 0.28 : 0.18);
    expect(edge.states, edge.id).toEqual([]);
  }
  await expect(page.getByLabel('关系详情')).toHaveCount(0);

  await page.getByLabel('知识图例').getByRole('button', {
    name: '集合与访问域',
    exact: true,
  }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS', { timeout: 1_200 });
  await page.getByRole('button', { name: '查看区域详情' }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_DETAIL', { timeout: 900 });

  await page.getByLabel('学习路径').selectOption(collectionsPath.path_id);
  const focusID = collectionsPath.focus_node_ids[0];
  const pathSnapshot = await waitForDebug(
    page,
    (event) => event.phase === 'focus-peak' && event.focusNodeID === focusID,
    3_000,
  );
  const roleNode = (nodeID: string) => pathSnapshot.nodes.find((node) => node.id === nodeID);
  expect(collectionsPath.upstream.filter((nodeID: string) => collectionsNodeIDs.has(nodeID))
    .some((nodeID: string) => roleNode(nodeID)?.fill === '#94A3B8' && roleNode(nodeID)?.size === 18))
    .toBe(true);
  expect(collectionsPath.focus.filter((nodeID: string) => collectionsNodeIDs.has(nodeID))
    .some((nodeID: string) => roleNode(nodeID)?.fill === '#F28C28'
      && (roleNode(nodeID)?.size ?? 0) >= 36))
    .toBe(true);
  expect(collectionsPath.downstream.filter((nodeID: string) => collectionsNodeIDs.has(nodeID))
    .some((nodeID: string) => roleNode(nodeID)?.fill === '#4FA66E' && roleNode(nodeID)?.size === 18))
    .toBe(true);
  await frozenPeakScreenshot(page, '04-learning-path-1560x907.png');

  const portSnapshot = await waitForDebug(page, (event) =>
    event.viewState === 'CATEGORY_DETAIL' && event.ports.length > 0);
  const portPoint = portSnapshot.ports[0];
  const beforePortDrawer = await cameraCheckpoint(page);
  const beforePortDrawerTimestamp = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.mouse.click(portPoint.clientX, portPoint.clientY);
  await expect(page.getByLabel('跨区域关系')).toBeVisible();
  await expect(page.getByLabel('跨区域关系')).toContainText('前往该区域');
  await expectPortsAvoidDrawer(page, '跨区域关系', canvasBox, beforePortDrawerTimestamp);
  await screenshot(page, '05-cross-category-port-1560x907.png');
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expectCameraCheckpointUnchanged(page, beforePortDrawer);
  await page.mouse.click(portPoint.clientX, portPoint.clientY);
  const crossCategoryNavigationStartedAt = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.getByRole('button', { name: '前往该区域' }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('ENTERING_CATEGORY');
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS', { timeout: 1_200 });
  await expect(page.getByLabel('区域简介')).toBeVisible();
  await waitForDebug(page, (event) =>
    event.phase === 'transform'
    && event.viewState === 'ENTERING_CATEGORY'
    && event.timestamp > crossCategoryNavigationStartedAt, 2_000);
  const worldReturnStartedAt = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.getByRole('button', { name: '返回知识世界' }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 1_300 });
  await expect(page.getByLabel('区域简介')).toHaveCount(0);
  const returnedWorld = await waitForDebug(page, (event) =>
    (event.phase === 'layout-settled' || event.phase === 'presentation')
    && event.viewState === 'WORLD'
    && event.nodeCount === 83
    && event.timestamp > worldReturnStartedAt, 4_000);
  expectVisibleDistinctWorldNodes(returnedWorld, canvasBox);

  const search = page.getByLabel('搜索知识节点');
  await search.fill('Concept:list');
  await expect(page.getByRole('option', { name: 'list · Concept:list', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '隐藏图例' }).click();
  await expect(page.getByLabel('知识图例')).toHaveCount(0);
  await page.getByRole('button', { name: '图例', exact: true }).click();
  await expect(page.getByLabel('知识图例')).toBeVisible();
  await search.fill('');

  const before1366Resize = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.setViewportSize({ width: 1366, height: 768 });
  const settled1366 = await waitForDebug(page, (event) =>
    event.phase === 'layout-settled'
    && event.viewState === 'WORLD'
    && event.nodeCount === 83
    && event.timestamp > before1366Resize, 2_500);
  expect(settled1366.elapsedMs).toBeLessThanOrEqual(1_500);
  const visible1366 = await waitForDebug(page, (event) =>
    event.phase === 'transform'
    && event.viewState === 'WORLD'
    && event.nodeCount === 83
    && event.timestamp >= settled1366.timestamp, 500);
  const canvas1366 = await page.getByRole('application', { name: '知识世界画布' }).boundingBox();
  if (!canvas1366) throw new Error('1366px Canvas bounds are unavailable.');
  expectVisibleDistinctWorldNodes(visible1366, canvas1366);
  await screenshot(page, '06-world-1366x768.png');
  const before1024Resize = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.setViewportSize({ width: 1024, height: 768 });
  const settled1024 = await waitForDebug(page, (event) =>
    event.phase === 'layout-settled'
    && event.viewState === 'WORLD'
    && event.nodeCount === 83
    && event.timestamp > before1024Resize, 2_500);
  expect(settled1024.elapsedMs).toBeLessThanOrEqual(1_500);
  const visible1024 = await waitForDebug(page, (event) =>
    event.phase === 'transform'
    && event.viewState === 'WORLD'
    && event.nodeCount === 83
    && event.timestamp >= settled1024.timestamp, 500);
  const canvas1024 = await page.getByRole('application', { name: '知识世界画布' }).boundingBox();
  if (!canvas1024) throw new Error('1024px Canvas bounds are unavailable.');
  expectVisibleDistinctWorldNodes(visible1024, canvas1024);
  const legend1024 = await page.getByLabel('知识图例').boundingBox();
  if (!legend1024) throw new Error('1024px legend bounds are unavailable.');
  const sidebar1024 = await page.locator('.ant-pro-sider').boundingBox();
  if (!sidebar1024) throw new Error('1024px sidebar bounds are unavailable.');
  expect(legend1024.x).toBeGreaterThanOrEqual(sidebar1024.x);
  expect(legend1024.x + legend1024.width)
    .toBeLessThanOrEqual(sidebar1024.x + sidebar1024.width);
  expect(boxesIntersect(legend1024, canvas1024)).toBe(false);
  const navigationItems1024 = page.locator(
    '.ant-pro-sider .ant-menu-item, .ant-pro-sider .ant-menu-submenu-title',
  );
  for (let index = 0; index < await navigationItems1024.count(); index += 1) {
    const item = navigationItems1024.nth(index);
    if (!await item.isVisible()) continue;
    const bounds = await item.boundingBox();
    if (bounds) expect(boxesIntersect(legend1024, bounds)).toBe(false);
  }
  expect(canvas1024.x + canvas1024.width).toBeLessThanOrEqual(1024);
  expect(canvas1024.y + canvas1024.height).toBeLessThanOrEqual(768);
  expect(settled1024.canvasSize.width).toBe(Math.round(canvas1024.width));
  expect(settled1024.canvasSize.height).toBe(Math.round(canvas1024.height));
  expect(visible1024.nodes).toHaveLength(83);
  for (const node of visible1024.nodes) {
    expect(node.minX, `${node.id} left bound`).toBeGreaterThanOrEqual(0);
    expect(node.minY, `${node.id} top bound`).toBeGreaterThanOrEqual(0);
    expect(node.maxX, `${node.id} right bound`).toBeLessThanOrEqual(1024);
    expect(node.maxY, `${node.id} bottom bound`).toBeLessThanOrEqual(768);
  }
  const categoryButtons1024 = page.getByLabel('知识图例').getByRole('button');
  await expect(categoryButtons1024).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    const button = categoryButtons1024.nth(index);
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    expect(await button.locator('strong').evaluate((label) => label.scrollWidth <= label.clientWidth))
      .toBe(true);
    const bounds = await button.boundingBox();
    if (!bounds) throw new Error(`1024px category button ${index + 1} bounds are unavailable.`);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(768);
  }
  for (const node of visible1024.nodes) {
    expect(boxesIntersect(pointBox(node), legend1024)).toBe(false);
  }
  await expect(page.locator('.kg-category-button')).toHaveCount(0);
  await expect(page.getByLabel('知识图例').getByRole('button')).toHaveCount(6);
  await screenshot(page, '07-world-1024x768.png');
});

test('all six category journeys return to a label-free WORLD with hover-only node facts', async ({ page }) => {
  test.setTimeout(75_000);
  await openKnowledgeWorld(page);
  const canvas = page.getByRole('application', { name: '知识世界画布' });
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Canvas bounds are unavailable.');
  const nodeIDsByCategory = new Map(overview.categories.map((category: Record<string, any>) => [
    category.id,
    new Set(overview.nodes
      .filter((node: Record<string, any>) => node.category_id === category.id)
      .map((node: Record<string, any>) => node.node_id)),
  ]));

  for (const category of overview.categories) {
    const world = await latestDebug(page, (event) =>
      event.viewState === 'WORLD'
      && event.nodeCount === 83);
    expect(world.renderedLabelCount).toBe(0);
    expect(world.renderedLabelReadErrorNodeIDs).toEqual([]);
    await expect(page.getByLabel('节点详情')).toHaveCount(0);
    await expect(page.getByLabel('区域简介')).toHaveCount(0);

    const hoverNodes = await visibleCanvasNodesFromIDs(
      page,
      world,
      canvasBox,
      nodeIDsByCategory.get(category.id)!,
      2,
    );
    const tooltipContent = page.locator('.kg-node-tooltip');
    const tooltip = tooltipContent.locator('..');
    for (const node of hoverNodes) {
      const hoverStartedAt = await page.evaluate(() => performance.now());
      await page.mouse.move(node.clientX, node.clientY);
      await expect(tooltip).toBeVisible({ timeout: 250 });
      const hoverElapsed = await page.evaluate((startedAt) => performance.now() - startedAt, hoverStartedAt);
      expect(hoverElapsed).toBeLessThanOrEqual(250);
      await expect(tooltipContent).toContainText('Label:');
      await expect(tooltipContent).toContainText(`Node ID: ${node.id}`);
      await expect(tooltipContent).toContainText('Category:');
      await expect(tooltipContent).toContainText('Degree:');
      const exit = await blankCanvasPoint(page, world, canvasBox);
      await page.mouse.move(exit.x, exit.y);
      await expect(tooltip).toHaveCSS('visibility', 'hidden', { timeout: 200 });
    }

    await expect(page.getByLabel('节点详情')).toHaveCount(0);
    await page.mouse.click(hoverNodes[0].clientX, hoverNodes[0].clientY);
    await expect(page.getByLabel('节点详情')).toBeVisible();
    await page.getByRole('button', { name: '关闭详情' }).click();

    await page.getByLabel('知识图例').getByRole('button', {
      name: category.label_zh,
      exact: true,
    }).click();
    await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS', { timeout: 1_200 });
    await expect(page.getByLabel('区域简介')).toContainText(category.description_zh);
    await page.getByRole('button', { name: '查看区域详情' }).click();
    await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_DETAIL', { timeout: 900 });
    const focusReturnStartedAt = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
    await page.getByRole('button', { name: '返回区域简介' }).click();
    await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS', { timeout: 700 });
    const returnedFocus = await waitForDebug(page, (event) =>
      event.viewState === 'CATEGORY_FOCUS'
      && event.timestamp > focusReturnStartedAt, 1_000);
    expect(returnedFocus.renderedLabelCount).toBe(0);
    expect(returnedFocus.renderedLabelReadErrorNodeIDs).toEqual([]);
    const returnStartedAt = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
    await page.getByRole('button', { name: '返回知识世界' }).click();
    await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 1_300 });
    const returned = await waitForDebug(page, (event) =>
      (event.phase === 'layout-settled' || event.phase === 'presentation')
      && event.viewState === 'WORLD'
      && event.nodeCount === 83
      && event.timestamp > returnStartedAt, 4_000);
    expect(returned.renderedLabelCount).toBe(0);
    expect(returned.renderedLabelReadErrorNodeIDs).toEqual([]);
    await expect(page.getByLabel('节点详情')).toHaveCount(0);
    await expect(page.getByLabel('区域简介')).toHaveCount(0);
  }
});

test('a real location-query refresh re-enters WORLD with a strict zero-label audit', async ({ page }) => {
  await openKnowledgeWorld(page);
  await page.evaluate(() => {
    window.history.replaceState(
      {},
      '',
      '/om/kg?category=missing-category&focus=missing-node&refresh=label-audit',
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('kg-view-state')).toHaveText('WORLD', { timeout: 30_000 });
  const snapshot = await waitForDebug(page, (event) =>
    event.phase === 'layout-settled'
    && event.viewState === 'WORLD'
    && event.nodeCount === 83);
  expect(snapshot.renderedLabelCount).toBe(0);
  expect(snapshot.renderedLabelReadErrorNodeIDs).toEqual([]);
  await expect(page.getByLabel('节点详情')).toHaveCount(0);
  await expect(page.getByLabel('区域简介')).toHaveCount(0);
});

test('4x CPU browser measurements meet paint, settlement, and continuous interaction FPS gates', async ({ page }) => {
  test.setTimeout(60_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await openKnowledgeWorld(page);
  const events = await debugEvents(page);
  const firstPaint = events.find((event) => event.phase === 'first-paint' && event.viewState === 'WORLD');
  const worldSettled = events.find((event) => event.phase === 'layout-settled' && event.viewState === 'WORLD');
  expect(firstPaint?.elapsedMs).toBeLessThanOrEqual(500);
  expect(worldSettled?.elapsedMs).toBeLessThanOrEqual(1500);

  const jsonText = JSON.stringify(overview);
  const parseMs = await page.evaluate((value) => {
    const started = performance.now();
    JSON.parse(value);
    return performance.now() - started;
  }, jsonText);
  expect(parseMs).toBeLessThanOrEqual(100);

  const box = await page.getByRole('application', { name: '知识世界画布' }).boundingBox();
  if (!box) throw new Error('Canvas bounds are unavailable.');
  const worldSnapshot = await latestDebug(page, (event) =>
    event.phase === 'layout-settled' && event.viewState === 'WORLD');
  const center = await blankCanvasPoint(page, worldSnapshot, box);

  const panBefore = await latestDebug(page, (event) => event.viewState === 'WORLD');
  const panFPSPromise = startFrameMeasurement(page, 5_000);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await continuousMoves(page, center, 5_000, 48);
  await page.mouse.up();
  const panFPS = await panFPSPromise;
  expect(panFPS).toBeGreaterThanOrEqual(45);
  const panEvents = (await debugEvents(page)).filter((event) =>
    event.phase === 'transform' && event.timestamp > panBefore.timestamp);
  expect(new Set(panEvents.map((event) =>
    `${event.camera.x.toFixed(3)},${event.camera.y.toFixed(3)}`)).size).toBeGreaterThan(50);
  expect(Math.max(...panEvents.map((event) => Math.hypot(
    event.camera.x - panBefore.camera.x,
    event.camera.y - panBefore.camera.y,
  )))).toBeGreaterThan(30);

  const zoomFPSPromise = startFrameMeasurement(page, 5_000);
  const zoomStarted = Date.now();
  let direction = -1;
  while (Date.now() - zoomStarted < 5_000) {
    await page.mouse.wheel(0, direction * 2);
    direction *= -1;
    await page.waitForTimeout(12);
  }
  const zoomFPS = await zoomFPSPromise;
  expect(zoomFPS).toBeGreaterThanOrEqual(45);

  await clickCategory(page);
  const detailTransition = await enterDetail(page);
  const detailLayoutSettled = await latestDebug(page, (event) =>
    event.phase === 'layout-settled'
    && event.activeCategoryID === collectionsCategoryID
    && event.nodeCount === collectionsNodeIDs.size);
  expect(detailLayoutSettled.elapsedMs).toBeLessThanOrEqual(1200);
  const detailPresented = await latestDebug(page, (event) =>
    event.phase === 'presentation'
    && event.viewState === 'CATEGORY_DETAIL'
    && event.activeCategoryID === collectionsCategoryID);
  const node = await visibleCanvasNode(page, detailPresented, box);
  const dragStartedAt = detailPresented.timestamp;
  const dragFPSPromise = startFrameMeasurement(page, 5_000);
  await page.mouse.move(node.clientX, node.clientY);
  await page.mouse.down();
  await continuousMoves(page, { x: node.clientX, y: node.clientY }, 5_000, 54);
  await page.mouse.up();
  const dragFPS = await dragFPSPromise;
  expect(dragFPS).toBeGreaterThanOrEqual(45);
  const dragEvents = (await debugEvents(page)).filter((event) =>
    event.phase === 'node-drag' && event.timestamp > dragStartedAt);
  const movedPositions = dragEvents.flatMap((event) => {
    const moved = event.nodes.find((candidate) => candidate.id === node.id);
    return moved ? [`${moved.clientX.toFixed(3)},${moved.clientY.toFixed(3)}`] : [];
  });
  expect(new Set(movedPositions).size).toBeGreaterThan(50);
  expect(Math.max(...dragEvents.map((event) => {
    const moved = event.nodes.find((candidate) => candidate.id === node.id)!;
    return Math.hypot(moved.clientX - node.clientX, moved.clientY - node.clientY);
  }))).toBeGreaterThan(30);
  test.info().annotations.push({
    type: 'performance',
    description: JSON.stringify({ parseMs, firstPaintMs: firstPaint?.elapsedMs,
      worldSettleMs: worldSettled?.elapsedMs, detailSettleMs: detailLayoutSettled.elapsedMs,
      detailTransitionMs: detailTransition.transitionMs, panFPS, zoomFPS, dragFPS }),
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('reduced motion reaches final camera state next frame and renders a static current focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openKnowledgeWorld(page);
  const canvas = page.getByRole('application', { name: '知识世界画布' });
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Canvas bounds are unavailable.');
  await page.getByLabel('知识图例').getByRole('button', {
    name: '集合与访问域',
    exact: true,
  }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_FOCUS');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const focusCamera = await latestDebug(page, (event) =>
    event.phase === 'presentation'
    && event.viewState === 'CATEGORY_FOCUS'
    && event.activeCategoryID === collectionsCategoryID
    && event.nodeCount === collectionsNodeIDs.size);
  expect(focusCamera.nodes.every((node) => collectionsNodeIDs.has(node.id))).toBe(true);
  expectPointsInside(focusCamera.nodes, canvasBox, [64, 296, 64, 424]);
  await page.getByRole('button', { name: '查看区域详情' }).click();
  await expect(page.getByTestId('kg-view-state')).toHaveText('CATEGORY_DETAIL');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const detailCamera = await latestDebug(page, (event) =>
    event.phase === 'presentation'
    && event.viewState === 'CATEGORY_DETAIL'
    && event.activeCategoryID === collectionsCategoryID);
  expectPointsInside(detailCamera.nodes, canvasBox, [64, 64, 64, 64]);
  expectBoundaryPorts(detailCamera.ports, canvasBox);
  const pathSelectedAt = (await debugEvents(page)).at(-1)?.timestamp ?? 0;
  await page.getByLabel('学习路径').selectOption(collectionsPath.path_id);
  await expect(canvas).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.getByLabel('节点详情')).toHaveCount(0);
  const focusID = collectionsPath.focus_node_ids[0];
  const staticFocusSnapshot = await waitForDebug(page, (event) =>
    event.phase === 'presentation'
    && event.viewState === 'CATEGORY_DETAIL'
    && event.focusNodeID === focusID
    && event.timestamp > pathSelectedAt);
  const staticFocus = staticFocusSnapshot.nodes.find((node) => node.id === focusID);
  expect(staticFocus).toEqual(expect.objectContaining({
    size: 36,
    fill: '#F28C28',
    shadowBlur: 16,
    shadowColor: 'rgba(242,140,40,0.22)',
  }));
  const before = (await debugEvents(page)).filter((event) => event.phase === 'focus-peak').length;
  await page.waitForTimeout(1_700);
  const after = (await debugEvents(page)).filter((event) => event.phase === 'focus-peak').length;
  expect(after).toBe(before);
  await screenshot(page, '08-reduced-motion-focus.png');
});
