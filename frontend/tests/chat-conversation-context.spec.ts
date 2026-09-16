import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const composerPlaceholder = 'Type a Python learning question. Shift+Enter for a new line.';
const screenshotPath = path.resolve(
  process.cwd(),
  '../output/playwright/chat-conversation-context.png',
);

type GraphSnapshot = {
  viewState: string;
  canvasSize: { width: number; height: number };
  nodes: Array<{ id: string; clientX: number; clientY: number }>;
};

async function submitTurn(page: Page, question: string) {
  const messages = page.locator('article.session-message');
  const previousCount = await messages.count();
  const composer = page.getByPlaceholder(composerPlaceholder);
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.fill(question);
  await expect(composer).toHaveValue(question);
  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(sendButton).toBeEnabled({ timeout: 30_000 });
  await sendButton.click();
  await expect(messages).toHaveCount(previousCount + 2, { timeout: 90_000 });
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  const answer = messages.nth(previousCount + 1);
  await expect(answer).toHaveClass(/agent/);
  return answer;
}

async function selectLenForNextTurn(page: Page, message: Locator) {
  const graph = message.getByLabel('Knowledge path force graph');
  await expect(graph).toBeVisible({ timeout: 30_000 });

  await expect(message.getByTestId('kg-role-upstream')).toHaveText('Upstream');
  await expect(message.getByTestId('kg-role-current')).toHaveText('Current');
  await expect(message.getByTestId('kg-role-downstream')).toHaveText('Downstream');
  await expect(message.getByRole('link', { name: 'View in Knowledge World' })).toBeVisible();
  await expect(message.getByRole('button', { name: 'Expand knowledge path graph' })).toHaveText('Expand');

  const eventCount = await page.evaluate(() => (
    (window as Window & { __conversationContextGraphEvents?: GraphSnapshot[] })
      .__conversationContextGraphEvents ?? []
  ).length);
  await message.getByRole('button', { name: 'Expand knowledge path graph' }).click();
  const expanded = message.getByLabel('Expanded knowledge path graph');
  await expect(expanded).toBeVisible();
  await expect(expanded.getByRole('button', { name: 'Close knowledge path graph' })).toHaveText('Close');
  const expandedHeight = await expanded.getByLabel('Knowledge path force graph').evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  await expect.poll(async () => page.evaluate(({ start, height }) => {
    const events = (
      window as Window & { __conversationContextGraphEvents?: GraphSnapshot[] }
    ).__conversationContextGraphEvents ?? [];
    return events.slice(start).some((event) =>
      event.viewState === 'CATEGORY_DETAIL'
      && Math.abs(event.canvasSize.height - height) <= 2
      && event.nodes.some((node) => node.id === 'Concept:len'));
  }, { start: eventCount, height: expandedHeight }), { timeout: 30_000 }).toBe(true);

  const point = await page.evaluate(({ start, height }) => {
    const events = (
      window as Window & { __conversationContextGraphEvents?: GraphSnapshot[] }
    ).__conversationContextGraphEvents ?? [];
    const snapshot = [...events.slice(start)].reverse().find((event) =>
      event.viewState === 'CATEGORY_DETAIL'
      && Math.abs(event.canvasSize.height - height) <= 2
      && event.nodes.some((node) => node.id === 'Concept:len'));
    return snapshot?.nodes.find((node) => node.id === 'Concept:len') ?? null;
  }, { start: eventCount, height: expandedHeight });
  expect(point, 'Concept:len must be present in the expanded knowledge path').not.toBeNull();
  await page.mouse.click(point!.clientX, point!.clientY);

  const details = expanded.getByRole('region', { name: 'Selected knowledge node' });
  await expect(details).toBeVisible();
  await expect(details).toContainText('len');
  await expect(details.getByRole('button', { name: 'Ask about this node' })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Close node details' })).toHaveText('Close');
  await details.getByRole('button', { name: 'Ask about this node' }).click();
  await details.getByRole('button', { name: 'Close node details' }).click();
  await expanded.getByRole('button', { name: 'Close knowledge path graph' }).click();
  await expect(expanded).toBeHidden();
}

test('preserves contextual topics and KG selection semantics through Docker', async ({ page }) => {
  test.setTimeout(300_000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    (window as Window & { __RESPONSIBLE_EDU_KG_DEBUG__?: boolean })
      .__RESPONSIBLE_EDU_KG_DEBUG__ = true;
    const events: GraphSnapshot[] = [];
    Object.defineProperty(window, '__conversationContextGraphEvents', {
      configurable: false,
      enumerable: false,
      value: events,
      writable: false,
    });
    window.addEventListener('kg-graph-debug', (event) => {
      events.push(structuredClone((event as CustomEvent<GraphSnapshot>).detail));
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const consentHeading = page.getByRole('heading', { name: /Consent Form/ });
  if (await consentHeading.isVisible({ timeout: 10_000 }).catch(() => false)) {
    const consentChecks = page.getByRole('checkbox');
    await expect(consentChecks).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await consentChecks.nth(index).check();
    }
    await page.getByRole('button', { name: /Agree and continue/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Python Learning Helper' })).toBeVisible({
    timeout: 60_000,
  });
  const activeConversation = page.locator('.session-list-item.active');
  await expect(activeConversation).toBeVisible({ timeout: 30_000 });
  const priorConversation = await activeConversation.textContent();
  await page.getByRole('button', { name: /New/ }).click();
  await expect.poll(async () => activeConversation.textContent(), { timeout: 30_000 })
    .not.toBe(priorConversation);
  await expect(page.getByText('Start with your question')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder(composerPlaceholder)).toBeEnabled();

  const listReferenceAnswer = await submitTurn(page, '请解释 Python list 的索引和长度。');

  const dictionaryAnswer = await submitTurn(
    page,
    '请解释 Python dictionary 的键值对和 get 方法。',
  );
  await expect(dictionaryAnswer.locator('.learning-trace-answer')).toContainText(/dictionary|字典/i);

  await selectLenForNextTurn(page, listReferenceAnswer);
  const lenAnswer = await submitTurn(page, '这是啥意思？');
  await expect(lenAnswer.getByTestId('conversation-metadata')).toContainText('Selected Node: len');
  await expect(lenAnswer.getByTestId('conversation-metadata')).toContainText(
    'Topic Transition: dictionary → len',
  );

  const resumedDictionaryAnswer = await submitTurn(page, 'back');
  await expect(resumedDictionaryAnswer.getByTestId('conversation-metadata')).toContainText(
    'Topic Transition: len → dictionary',
  );
  await expect(resumedDictionaryAnswer.getByTestId('conversation-metadata')).toContainText(
    'Resumed Context:',
  );

  await selectLenForNextTurn(page, listReferenceAnswer);
  const dictionaryOverrideAnswer = await submitTurn(
    page,
    '请继续解释 dictionary 的键值对和 get 方法。',
  );
  await expect(dictionaryOverrideAnswer.getByTestId('conversation-metadata')).toContainText(
    'Selected Node: len · Not used for this response',
  );
  await expect(dictionaryOverrideAnswer.locator('.learning-trace-answer')).toContainText(
    /dictionary|字典|键值|键.*值/i,
  );

  await page.setViewportSize({ width: 1560, height: 1800 });
  await dictionaryOverrideAnswer.scrollIntoViewIfNeeded();
  await expect(dictionaryOverrideAnswer.getByText('Upstream', { exact: true })).toBeVisible();
  await expect(dictionaryOverrideAnswer.getByText('Current', { exact: true })).toBeVisible();
  await expect(dictionaryOverrideAnswer.getByText('Downstream', { exact: true })).toBeVisible();
  await expect(dictionaryOverrideAnswer.getByRole('link', { name: 'View in Knowledge World' })).toBeVisible();
  await expect(dictionaryOverrideAnswer.getByRole('button', { name: 'Expand knowledge path graph' })).toHaveText('Expand');

  mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  expect(browserErrors).toEqual([]);
});
