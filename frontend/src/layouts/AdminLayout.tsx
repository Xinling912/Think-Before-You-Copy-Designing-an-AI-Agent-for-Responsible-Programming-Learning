import {
  BookOutlined,
  BulbOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import type { ProLayoutProps } from '@ant-design/pro-components';
import { ProLayout } from '@ant-design/pro-components';
import { Outlet, history, useLocation } from '@umijs/max';
import type { ReactNode } from 'react';

type AdminMenuRoute = NonNullable<ProLayoutProps['route']>['routes'][number];

const adminMenuRoutes: AdminMenuRoute[] = [
  {
    path: '/om/dashboard',
    name: 'Dashboard / 管理看板',
    icon: <DashboardOutlined />,
  },
  {
    path: '/om/learning',
    name: 'Learning Process / 学习过程',
    icon: <MessageOutlined />,
    routes: [
      {
        path: '/om/session-review',
        name: 'Session Review / 会话复盘',
      },
      {
        path: '/om/memory',
        name: 'Memory / 学生画像',
      },
      {
        path: '/om/evidence',
        name: 'Evidence / 学习证据',
      },
    ],
  },
  {
    path: '/om/knowledge',
    name: 'Knowledge Base / 知识库',
    icon: <DatabaseOutlined />,
    routes: [
      {
        path: '/om/corpus',
        name: 'Corpus / 语料库',
      },
      {
        path: '/om/rag',
        name: 'RAG / 检索增强',
      },
      {
        path: '/om/kg',
        name: 'Knowledge Graph / 知识图谱',
      },
      {
        path: '/om/kg-review',
        name: 'KG Review / 图谱审核',
      },
    ],
  },
  {
    path: '/om/skills',
    name: 'Teaching Skills / 教学策略',
    icon: <BulbOutlined />,
  },
  {
    path: '/om/harness',
    name: 'Harness / 实验评估',
    icon: <ExperimentOutlined />,
  },
];

function renderMenuItem(item: AdminMenuRoute, dom: ReactNode) {
  if (!item.path) {
    return dom;
  }

  return (
    <a
      href={item.path}
      onClick={(event) => {
        event.preventDefault();
        history.push(item.path!);
      }}
    >
      {dom}
    </a>
  );
}

export default function AdminLayout() {
  const location = useLocation();

  return (
    <ProLayout
      className="om-admin-layout"
      title="ResponsibleEduAgent"
      logo={<BookOutlined />}
      route={{
        path: '/om',
        routes: adminMenuRoutes,
      }}
      location={{
        pathname: location.pathname,
      }}
      menu={{
        locale: false,
      }}
      siderWidth={236}
      fixSiderbar
      fixedHeader
      menuItemRender={renderMenuItem}
      subMenuItemRender={(_, dom) => dom}
    >
      <main className="om-admin-content">
        <Outlet />
      </main>
    </ProLayout>
  );
}
