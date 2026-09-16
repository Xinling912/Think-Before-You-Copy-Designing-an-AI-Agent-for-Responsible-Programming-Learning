export const routes = [
  {
    path: '/',
    name: 'Learning chat / 学习对话',
    component: './SessionDemo',
    wrappers: ['@/wrappers/ParticipantGate'],
  },
  {
    path: '/test',
    name: 'Python Test Center',
    component: './TestCenter',
    wrappers: ['@/wrappers/ParticipantGate'],
  },
  {
    path: '/test/:topicId',
    component: './TestCenter/TopicPage',
    wrappers: ['@/wrappers/ParticipantGate'],
  },
  {
    path: '/knowledge-world',
    name: 'Knowledge World',
    component: './StudentKnowledgeWorld',
    wrappers: ['@/wrappers/ParticipantGate'],
  },
  {
    path: '/om',
    component: '@/layouts/AdminLayout',
    wrappers: ['@/wrappers/AdminGate'],
    routes: [
      { path: '', redirect: '/om/dashboard' },
      { path: 'dashboard', name: 'Dashboard / 管理看板', component: './Dashboard' },
      {
        path: 'learning',
        name: '学习过程 / Learning Process',
        redirect: '/om/session-review',
      },
      { path: 'session-review', name: 'Session Review / 会话复盘', component: './SessionReview' },
      { path: 'memory', name: 'Memory / 学生画像', component: './Memory' },
      { path: 'evidence', name: 'Evidence / 学习证据', component: './Evidence' },
      {
        path: 'knowledge',
        name: '知识库管理 / Knowledge Base',
        redirect: '/om/corpus',
      },
      { path: 'corpus', name: 'Corpus / 语料库', component: './Corpus' },
      { path: 'rag', name: 'RAG / 检索增强', component: './RAG' },
      { path: 'kg', name: 'Knowledge Graph / 知识图谱', component: './KG' },
      { path: 'kg-review', name: 'KG Review / 图谱审核', component: './KGReview' },
      { path: 'skills', name: 'Skills / 教学技能', component: './Skills' },
      { path: 'harness', name: 'Harness / 验证工具', component: './Harness' },
    ],
  },
];
