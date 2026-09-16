import { readFileSync } from 'node:fs';
import path from 'node:path';

test('Vitest excludes every Playwright spec while retaining tests-directory unit tests', () => {
  const configSource = readFileSync(path.join(process.cwd(), 'vitest.config.ts'), 'utf8');

  expect(configSource).toMatch(/import\s+\{\s*defaultExclude,\s*defineConfig\s*\}\s+from\s+'vitest\/config'/);
  expect(configSource).toMatch(
    /exclude:\s*\[\s*\.\.\.defaultExclude,\s*'tests\/\*\*\/\*\.spec\.ts'\s*\]/,
  );
  expect(configSource).not.toContain("'tests/**/*.test.ts'");
  expect(configSource).not.toContain("'tests/**'");
});

test('Playwright binds its Umi web server to the readiness port explicitly', () => {
  const configSource = readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf8');

  expect(configSource).toMatch(/command:\s*'PORT=8001 SOCKET_SERVER=ws:\/\/127\.0\.0\.1:8001 npm run dev'/);
  expect(configSource).not.toContain('--port 8001');
});

test('browser acceptance captures screenshots without rewriting committed evidence by default', () => {
  const specSource = readFileSync(path.join(process.cwd(), 'tests/kg-world.spec.ts'), 'utf8');

  expect(specSource).toContain("process.env.UPDATE_KG_SCREENSHOTS === '1'");
  expect(specSource).toMatch(/const image = await page\.screenshot\(/);
  expect(specSource).toMatch(/if \(!existsSync\(target\) \|\| updateEvidence\) writeFileSync\(target, image\)/);
});

test('browser acceptance measures node-drawer and legend geometry', () => {
  const specSource = readFileSync(path.join(process.cwd(), 'tests/kg-world.spec.ts'), 'utf8');

  expect(specSource).toMatch(/const nodeDrawerBox = await page\.getByLabel\('节点详情'\)\.boundingBox\(\)/);
  expect(specSource).toMatch(/const nodeDrawerLegendBox = await page\.getByLabel\('知识图例'\)\.boundingBox\(\)/);
  expect(specSource).toMatch(
    /expect\(\s*boxesIntersect\(nodeDrawerLegendBox, nodeDrawerBox\),[\s\S]*?\)\.toBe\(false\)/,
  );
  expect(specSource).toContain(
    'expect(boxDistance(nodeDrawerLegendBox, nodeDrawerBox)).toBeGreaterThanOrEqual(8)',
  );
});

test('Playwright and acceptance docs identify Microsoft Edge stable consistently', () => {
  const playwrightSource = readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf8');
  const designSource = readFileSync(
    path.join(
      process.cwd(),
      '../docs/superpowers/specs/2026-07-15-kg-knowledge-world-visualization-design.md',
    ),
    'utf8',
  );
  const auditSource = readFileSync(
    path.join(
      process.cwd(),
      '../docs/superpowers/audits/2026-07-17-kg-knowledge-world-acceptance.md',
    ),
    'utf8',
  );

  expect(playwrightSource).toMatch(/name:\s*'Microsoft Edge stable'/);
  expect(playwrightSource).toMatch(/channel:\s*'msedge'/);
  expect(playwrightSource).toMatch(/testMatch:\s*'\*\*\/\*\.spec\.ts'/);
  expect(designSource).toContain(
    'Microsoft Edge stable（Chromium 内核，Playwright channel: msedge）',
  );
  expect(auditSource).toContain(
    'Microsoft Edge stable (Chromium engine, Playwright `channel: msedge`)',
  );
});
