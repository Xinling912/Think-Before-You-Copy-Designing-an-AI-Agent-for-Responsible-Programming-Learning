import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const overview = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/kg-overview.json'), 'utf8'),
) as Record<string, any>;
const appURL = process.env.CHAT_KG_APP_URL ?? 'http://127.0.0.1:18081';
const sessionID = 'session-chat-kg-source-role-colors';
const screenshotPath = '/tmp/chat-kg-source-role-docker/dict-path.png';
const followUpQuestion = 'Continue without selecting a graph node.';
const followUpAnswer = 'You can continue without selecting a graph node.';

type DebugEdge = {
  id: string;
  source: string;
  target: string;
  stroke?: string;
  endArrow: boolean;
};
type DebugSnapshot = {
  phase: string;
  timestamp: number;
  viewState: string;
  canvasSize: { width: number; height: number };
  nodes: Array<{ id: string; clientX: number; clientY: number }>;
  edges: DebugEdge[];
};

const visualPairs = new Set(
  overview.visual_edges.map((edge: Record<string, any>) => `${edge.source}\u0000${edge.target}`),
);
const selectedPath = overview.paths.find(
  (candidate: Record<string, any>) =>
    candidate.path_id === 'path-collections-and-access-20-dict',
);

if (!selectedPath) {
  throw new Error('The KG fixture is missing path-collections-and-access-20-dict.');
}

const requiredDirectedRelations = [
  ['Concept:tuple', 'Concept:dict'],
  ['Concept:dict', 'Concept:set'],
  ['Concept:set', 'Concept:key'],
  ['Concept:key', 'Concept:value'],
] as const;
const requiredPathNodeIDs = [
  'Concept:sequence',
  'Concept:list',
  'Concept:tuple',
  'Concept:dict',
  'Concept:set',
  'Concept:key',
  'Concept:value',
] as const;
for (const [source, target] of requiredDirectedRelations) {
  const relationExists = selectedPath.relations.some((relation: Record<string, any>) =>
    relation.from === source && relation.to === target);
  if (!relationExists || !visualPairs.has(`${source}\u0000${target}`)) {
    throw new Error(`The KG fixture is missing directed relation ${source} -> ${target}.`);
  }
}

const nodeByID = new Map(
  overview.nodes.map((node: Record<string, any>) => [node.node_id, node]),
);
const roleByNodeID = new Map([
  ...selectedPath.upstream.map((nodeID: string) => [nodeID, 'upstream'] as const),
  ...selectedPath.focus.map((nodeID: string) => [nodeID, 'current'] as const),
  ...selectedPath.downstream.map((nodeID: string) => [nodeID, 'downstream'] as const),
]);
const directedRelations = selectedPath.relations.filter((relation: Record<string, any>) =>
  visualPairs.has(`${relation.from}\u0000${relation.to}`));
const pathNode = (nodeID: string) => {
  const node = nodeByID.get(nodeID);
  if (!node) throw new Error(`Catalog path references unknown node: ${nodeID}`);
  return { id: nodeID, label: node.label, type: node.node_type };
};
const knowledgePathView = {
  path_id: selectedPath.path_id,
  upstream: selectedPath.upstream.map(pathNode),
  current: selectedPath.focus.map(pathNode),
  downstream: selectedPath.downstream.map(pathNode),
  edges: directedRelations.map((relation: Record<string, any>) => ({
    from: relation.from,
    to: relation.to,
    relation: relation.type,
    traversal: relation.traversal,
  })),
  focus_node_ids: [selectedPath.focus[0]],
};

function expectEdge(
  snapshot: DebugSnapshot,
  source: string,
  target: string,
  stroke: string,
) {
  const edge = snapshot.edges.find((candidate) =>
    candidate.source === source && candidate.target === target);
  expect(edge, `${source} -> ${target} rendered edge`).toBeTruthy();
  expect(edge!.source).toBe(source);
  expect(edge!.target).toBe(target);
  expect(edge!.endArrow, `${source} -> ${target} debug endArrow contract`).toBe(true);
  expect(edge!.stroke, `${source} -> ${target} source-owned stroke`).toBe(stroke);
}

function expectDictionaryPath(snapshot: DebugSnapshot) {
  const renderedNodeIDs = snapshot.nodes.map((node) => node.id);
  expect(renderedNodeIDs, 'all seven dictionary-path node IDs').toEqual(
    expect.arrayContaining([...requiredPathNodeIDs]),
  );
  for (const nodeID of requiredPathNodeIDs) {
    expect(
      renderedNodeIDs.filter((renderedNodeID) => renderedNodeID === nodeID),
      `${nodeID} rendered exactly once`,
    ).toHaveLength(1);
  }
  expectEdge(snapshot, 'Concept:tuple', 'Concept:dict', '#94A3B8');
  expectEdge(snapshot, 'Concept:dict', 'Concept:set', '#F28C28');
  expectEdge(snapshot, 'Concept:set', 'Concept:key', '#4FA66E');
  expectEdge(snapshot, 'Concept:key', 'Concept:value', '#4FA66E');
}

function visibleMessageTexts(elements: Element[]) {
  return elements.map((element) => {
    const traceAnswer = element.querySelector('.learning-trace-answer');
    const plainMessage = element.querySelector(':scope > .ant-typography');
    return (traceAnswer ?? plainMessage)?.textContent ?? '';
  });
}

test('renders chat knowledge-path edges with their source-role colors', async ({ page }) => {
  const staticOrigins = new Set<string>();
  let streamRequestBody: Record<string, unknown> | undefined;
  page.on('response', (response) => {
    const resourceType = response.request().resourceType();
    const responseURL = new URL(response.url());
    if (
      ['document', 'script', 'stylesheet', 'font', 'image'].includes(resourceType)
      || responseURL.pathname.endsWith('.map')
    ) {
      staticOrigins.add(responseURL.origin);
    }
  });

  await page.context().clearCookies();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    (window as Window & { __RESPONSIBLE_EDU_KG_DEBUG__?: boolean })
      .__RESPONSIBLE_EDU_KG_DEBUG__ = true;
    const events: unknown[] = [];
    Object.defineProperty(window, '__chatKGEvents', {
      configurable: false,
      enumerable: false,
      value: events,
      writable: false,
    });
    window.addEventListener('kg-graph-debug', (event) => {
      events.push(structuredClone((event as CustomEvent).detail));
    });
  });

  await page.route('**/api/participant/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true }),
    });
  });
  await page.route('**/api/sessions?status=active', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{
          id: sessionID,
          scenario: 'chat-kg-source-role-colors',
          status: 'active',
          message_count: 2,
        }],
      }),
    });
  });
  await page.route(`**/api/session/${sessionID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { id: sessionID, scenario: 'chat-kg-source-role-colors', status: 'active' },
        messages: [
          { id: 1, role: 'student', content: 'Show me this Python learning path.' },
          { id: 2, role: 'agent', content: 'Here is the grounded knowledge path.' },
        ],
        evidence_events: [{
          agent_message_id: 2,
          payload: {
            learning_trace: {
              turn_id: 'turn-chat-kg-source-role-colors',
              query_understanding: { original_question: 'Show me this Python learning path.' },
              kg_grounding: {
                selected_node_ids: [...roleByNodeID.keys()],
                knowledge_path_view: knowledgePathView,
              },
              rag_evidence: [],
              answer: 'Here is the grounded knowledge path.',
            },
          },
        }],
      }),
    });
  });
  await page.route('**/api/token-budget', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token_budget: {
          scope: 'global-demo',
          daily_quota: 24_000,
          used_tokens: 6_000,
          remaining_tokens: 18_000,
          remaining_percent: 75,
        },
      }),
    });
  });
  await page.route('**/api/kg/overview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(overview),
    });
  });
  await page.route('**/api/session/message/stream', async (route) => {
    streamRequestBody = route.request().postDataJSON() as Record<string, unknown>;
    const events = [
      { type: 'trace_started', session_id: sessionID, turn_id: 'turn-no-node-selection' },
      {
        type: 'guided_response_done',
        session_id: sessionID,
        turn_id: 'turn-no-node-selection',
        answer: followUpAnswer,
      },
      {
        type: 'trace_completed',
        session_id: sessionID,
        turn_id: 'turn-no-node-selection',
        agent_message_id: 4,
        learning_trace: {
          turn_id: 'turn-no-node-selection',
          query_understanding: { original_question: followUpQuestion },
          kg_grounding: { selected_node_ids: [] },
          rag_evidence: [],
          answer: followUpAnswer,
        },
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    });
  });

  await page.goto(appURL, { waitUntil: 'domcontentloaded' });
  const messages = page.locator('.session-chat-scroll article.session-message');
  await expect(messages).toHaveCount(2, { timeout: 30_000 });
  const originalMessageTexts = await messages.evaluateAll(visibleMessageTexts);
  expect(originalMessageTexts).toEqual([
    'Show me this Python learning path.',
    'Here is the grounded knowledge path.',
  ]);

  const compactGraph = messages.nth(1).getByLabel('Knowledge path force graph');
  await expect(compactGraph).toBeVisible({ timeout: 30_000 });
  const compactCanvases = compactGraph.locator('canvas');
  await expect(compactCanvases.first()).toBeVisible();
  await expect.poll(async () => compactCanvases.evaluateAll((canvases) =>
    canvases.reduce((paintedPixels, element) => {
      const canvas = element as HTMLCanvasElement;
      if (canvas.width === 0 || canvas.height === 0) return paintedPixels;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return paintedPixels;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let canvasPaintedPixels = 0;
      for (let alpha = 3; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] > 0) canvasPaintedPixels += 1;
      }
      return paintedPixels + canvasPaintedPixels;
    }, 0)), { timeout: 30_000 }).toBeGreaterThan(100);

  expect([...staticOrigins]).toEqual(['http://127.0.0.1:18081']);

  await expect.poll(async () => page.evaluate(() => {
    const events = (window as Window & { __chatKGEvents?: DebugSnapshot[] }).__chatKGEvents ?? [];
    return events.some((event) => event.viewState === 'CATEGORY_DETAIL' && event.edges.length > 0);
  }), { timeout: 30_000 }).toBe(true);

  const latestDetail = await page.evaluate(() => {
    const events = (window as Window & { __chatKGEvents?: DebugSnapshot[] }).__chatKGEvents ?? [];
    return [...events].reverse().find((event) =>
      event.viewState === 'CATEGORY_DETAIL' && event.edges.length > 0);
  });
  expect(latestDetail, 'CATEGORY_DETAIL graph debug event').toBeTruthy();

  expectDictionaryPath(latestDetail!);

  const compactHeight = await compactGraph.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const compactBoxBeforeConversation = await compactGraph.boundingBox();
  if (!compactBoxBeforeConversation) throw new Error('Compact graph bounds are unavailable.');

  const composer = page.getByPlaceholder(
    'Type a Python learning question. Shift+Enter for a new line.',
  );
  await composer.fill(followUpQuestion);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(messages).toHaveCount(4);
  const beforeGraphInteractions = await messages.evaluateAll(visibleMessageTexts);
  expect(beforeGraphInteractions).toEqual([
    ...originalMessageTexts,
    followUpQuestion,
    followUpAnswer,
  ]);
  expect(streamRequestBody).toBeTruthy();
  expect(streamRequestBody!.session_id).toBe(sessionID);
  expect(streamRequestBody).not.toHaveProperty('requested_focus_node_id');
  for (const key of ['selected_node_ids', 'selected_kg_node_ids']) {
    expect(streamRequestBody![key] ?? []).toEqual([]);
  }
  await expect(compactGraph).toBeVisible();

  await compactGraph.scrollIntoViewIfNeeded();
  const compactBoxBeforeNodeClick = await compactGraph.boundingBox();
  if (!compactBoxBeforeNodeClick) throw new Error('Compact graph bounds are unavailable after chat.');
  const setNode = latestDetail!.nodes.find((node) => node.id === 'Concept:set');
  expect(setNode, 'Concept:set debug point').toBeTruthy();
  const setNodePoint = {
    x: setNode!.clientX + compactBoxBeforeNodeClick.x - compactBoxBeforeConversation.x,
    y: setNode!.clientY + compactBoxBeforeNodeClick.y - compactBoxBeforeConversation.y,
  };
  expect(await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.tagName, setNodePoint)).toBe('CANVAS');
  await page.mouse.click(setNodePoint.x, setNodePoint.y);
  await expect(page.getByRole('region', { name: 'Selected knowledge node' })).toBeVisible();

  const preExpand = await page.evaluate(() => ({
    eventCount: ((window as Window & { __chatKGEvents?: DebugSnapshot[] }).__chatKGEvents ?? []).length,
    timestamp: performance.now(),
  }));
  await messages.nth(1).getByRole('button', { name: '展开知识路径图' }).click();
  const expandedGraph = messages.nth(1).getByLabel('Expanded knowledge path graph');
  await expect(expandedGraph).toBeVisible();
  const expandedCanvasHost = expandedGraph.getByLabel('Knowledge path force graph');
  const expandedHeight = await expandedCanvasHost.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(expandedHeight, 'expanded graph height').toBeGreaterThan(compactHeight);
  const expandedCanvases = expandedCanvasHost.locator('canvas');
  await expect(expandedCanvases.first()).toBeVisible();

  const expandedPaintPredicate = ({ eventCount, timestamp, expectedHeight }: typeof preExpand & {
    expectedHeight: number;
  }) => {
    const events = (window as Window & { __chatKGEvents?: DebugSnapshot[] }).__chatKGEvents ?? [];
    return events.slice(eventCount).some((event) =>
      event.timestamp >= timestamp
      && event.viewState === 'CATEGORY_DETAIL'
      && (event.phase === 'layout-settled' || event.phase === 'presentation')
      && Math.abs(event.canvasSize.height - expectedHeight) <= 1
      && event.nodes.length > 0
      && event.edges.length > 0);
  };
  const expandedPaintMarker = { ...preExpand, expectedHeight: expandedHeight };
  await expect.poll(async () => page.evaluate(
    expandedPaintPredicate,
    expandedPaintMarker,
  ), { timeout: 30_000 }).toBe(true);

  const expandedPaint = await page.evaluate((marker) => {
    const events = (window as Window & { __chatKGEvents?: DebugSnapshot[] }).__chatKGEvents ?? [];
    return [...events.slice(marker.eventCount)].reverse().find((event) =>
      event.timestamp >= marker.timestamp
      && event.viewState === 'CATEGORY_DETAIL'
      && (event.phase === 'layout-settled' || event.phase === 'presentation')
      && Math.abs(event.canvasSize.height - marker.expectedHeight) <= 1
      && event.nodes.length > 0
      && event.edges.length > 0);
  }, expandedPaintMarker);
  expect(expandedPaint, 'fresh expanded G6 paint event').toBeTruthy();
  expectDictionaryPath(expandedPaint!);

  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect.poll(async () => expandedCanvases.evaluateAll((canvases) =>
    canvases.reduce((paintedPixels, element) => {
      const canvas = element as HTMLCanvasElement;
      if (canvas.width === 0 || canvas.height === 0) return paintedPixels;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return paintedPixels;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let canvasPaintedPixels = 0;
      for (let alpha = 3; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] > 0) canvasPaintedPixels += 1;
      }
      return paintedPixels + canvasPaintedPixels;
    }, 0)), { timeout: 10_000 }).toBeGreaterThan(100);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  }));

  await expandedGraph.getByRole('button', { name: '关闭知识路径图' }).click();
  await expect(expandedGraph).toBeHidden();
  await page.getByRole('button', { name: '关闭节点详情' }).click();
  await expect(page.getByRole('region', { name: 'Selected knowledge node' })).toBeHidden();
  expect(await messages.evaluateAll(visibleMessageTexts)).toEqual(beforeGraphInteractions);

  const preScreenshotExpand = await page.evaluate(() => ({
    eventCount: ((window as Window & { __chatKGEvents?: DebugSnapshot[] }).__chatKGEvents ?? []).length,
    timestamp: performance.now(),
  }));
  await messages.nth(1).getByRole('button', { name: '展开知识路径图' }).click();
  await expect(expandedGraph).toBeVisible();
  await expect.poll(async () => page.evaluate(
    expandedPaintPredicate,
    { ...preScreenshotExpand, expectedHeight: expandedHeight },
  ), { timeout: 30_000 }).toBe(true);
  const finalExpandedPaint = await page.evaluate((marker) => {
    const events = (window as Window & { __chatKGEvents?: DebugSnapshot[] }).__chatKGEvents ?? [];
    return [...events.slice(marker.eventCount)].reverse().find((event) =>
      event.timestamp >= marker.timestamp
      && event.viewState === 'CATEGORY_DETAIL'
      && (event.phase === 'layout-settled' || event.phase === 'presentation')
      && Math.abs(event.canvasSize.height - marker.expectedHeight) <= 1
      && event.nodes.length > 0
      && event.edges.length > 0);
  }, { ...preScreenshotExpand, expectedHeight: expandedHeight });
  expect(finalExpandedPaint, 'fresh final expanded G6 paint event').toBeTruthy();
  expectDictionaryPath(finalExpandedPaint!);
  await expect.poll(async () => expandedCanvases.evaluateAll((canvases) =>
    canvases.reduce((paintedPixels, element) => {
      const canvas = element as HTMLCanvasElement;
      if (canvas.width === 0 || canvas.height === 0) return paintedPixels;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return paintedPixels;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let canvasPaintedPixels = 0;
      for (let alpha = 3; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] > 0) canvasPaintedPixels += 1;
      }
      return paintedPixels + canvasPaintedPixels;
    }, 0)), { timeout: 10_000 }).toBeGreaterThan(100);
  await expect(page.getByRole('region', { name: 'Selected knowledge node' })).toBeHidden();
  expect(await messages.evaluateAll(visibleMessageTexts)).toEqual(beforeGraphInteractions);
  mkdirSync('/tmp/chat-kg-source-role-docker', { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
});
