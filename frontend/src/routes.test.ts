import { routes } from './routes';

type Route = {
  path?: string;
  name?: string;
  component?: string;
  redirect?: string;
  layout?: boolean;
  wrappers?: string[];
  routes?: Route[];
};

function flatten(routes: Route[]): Route[] {
  return routes.flatMap((route) => [route, ...flatten(route.routes ?? [])]);
}

test('splits the student entry from the operation management routes', () => {
  const allRoutes = flatten(routes as Route[]);
  const studentRoute = allRoutes.find((route) => route.path === '/');
  const operationShell = allRoutes.find((route) => route.path === '/om' && route.component);

  expect(studentRoute).toEqual(
    expect.objectContaining({
      path: '/',
      component: './SessionDemo',
      name: 'Learning chat / 学习对话',
    }),
  );
  expect(studentRoute?.routes).toBeUndefined();

  expect(operationShell).toEqual(
    expect.objectContaining({
      path: '/om',
      component: '@/layouts/AdminLayout',
    }),
  );
  expect(flatten(operationShell?.routes ?? [])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: '', redirect: '/om/dashboard' }),
      expect.objectContaining({ path: 'session-review', name: 'Session Review / 会话复盘' }),
    ]),
  );

  expect(
    flatten(operationShell?.routes ?? [])
      .map((route) => route.path)
      .filter(Boolean)
      .every((path) => !path?.startsWith('/')),
  ).toBe(true);

  expect(allRoutes.some((route) => route.path === '/dashboard')).toBe(false);
  expect(allRoutes.some((route) => route.path === '/session-demo')).toBe(false);
  expect(allRoutes.some((route) => route.path === '/memory')).toBe(false);
});

test('groups operation management menu entries by role workflow', () => {
  const allRoutes = flatten(routes as Route[]);

  expect(allRoutes.map((route) => route.name)).toEqual(
    expect.arrayContaining([
      '学习过程 / Learning Process',
      '知识库管理 / Knowledge Base',
      'Session Review / 会话复盘',
      'Memory / 学生画像',
      'Skills / 教学技能',
      'Harness / 验证工具',
    ]),
  );
});

test('keeps the knowledge world page registered at /om/kg', () => {
  const operationShell = (routes as Route[]).find((route) => route.path === '/om' && route.component);

  expect(flatten(operationShell?.routes ?? [])).toContainEqual(
    expect.objectContaining({
      path: 'kg',
      name: 'Knowledge Graph / 知识图谱',
      component: './KG',
    }),
  );
});

test('registers a participant-only student Knowledge World outside the admin shell', () => {
  const topLevelRoutes = routes as Route[];
  const studentKnowledgeWorld = topLevelRoutes.find(
    (route) => route.path === '/knowledge-world',
  );

  expect(studentKnowledgeWorld).toEqual(
    expect.objectContaining({
      path: '/knowledge-world',
      name: 'Knowledge World',
      component: './StudentKnowledgeWorld',
      wrappers: ['@/wrappers/ParticipantGate'],
    }),
  );
  expect(studentKnowledgeWorld?.wrappers).not.toContain('@/wrappers/AdminGate');
  expect(studentKnowledgeWorld?.component).not.toBe('@/layouts/AdminLayout');
});

test('registers the Test Center as a top-level route before any wildcard', () => {
  const topLevelRoutes = routes as Route[];
  const testCenterIndex = topLevelRoutes.findIndex((route) => route.path === '/test');
  const wildcardIndex = topLevelRoutes.findIndex((route) => route.path === '*' || route.path === '/*');

  expect(testCenterIndex).toBeGreaterThanOrEqual(0);
  expect(topLevelRoutes[testCenterIndex]).toEqual(
    expect.objectContaining({
      path: '/test',
      component: './TestCenter',
    }),
  );
  expect(wildcardIndex === -1 || testCenterIndex < wildcardIndex).toBe(true);
});

test('registers the dynamic topic practice route before any wildcard', () => {
  const topLevelRoutes = routes as Route[];
  const practiceIndex = topLevelRoutes.findIndex((route) => route.path === '/test/:topicId');
  const wildcardIndex = topLevelRoutes.findIndex((route) => route.path === '*' || route.path === '/*');

  expect(practiceIndex).toBeGreaterThanOrEqual(0);
  expect(topLevelRoutes[practiceIndex]).toEqual(
    expect.objectContaining({
      path: '/test/:topicId',
      component: './TestCenter/TopicPage',
    }),
  );
  expect(wildcardIndex === -1 || practiceIndex < wildcardIndex).toBe(true);
});
