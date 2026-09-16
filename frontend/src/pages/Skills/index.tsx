import { ProTable } from '@ant-design/pro-components';
import { Tag } from 'antd';
import { buildSkillRows, type SkillRow } from './model';

type SkillTableRow = SkillRow & {
  globalIndex: number;
};

const rows: SkillTableRow[] = buildSkillRows().map((row, index) => ({
  ...row,
  globalIndex: index + 1,
}));

export default function SkillsPage() {
  return (
    <main className="rea-page skills-page skills-page-fixed">
      <section className="rea-header skills-compact-header">
        <div className="rea-kicker">Skills</div>
        <h1 className="rea-title">Education agent skills</h1>
      </section>

      <ProTable<SkillTableRow>
        className="skills-table"
        size="small"
        rowKey="id"
        dataSource={rows}
        search={false}
        pagination={{ pageSize: 10, showSizeChanger: false, position: ['bottomCenter'] }}
        columns={[
          { title: 'Index', dataIndex: 'globalIndex', width: 72, search: false },
          { title: 'ID', dataIndex: 'id', copyable: true, ellipsis: true, width: 280 },
          { title: 'Domain', dataIndex: 'domain', ellipsis: true, width: 180 },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 140,
            search: false,
            render: (_, row) => <Tag color={row.mvp ? 'blue' : 'default'}>{row.status}</Tag>,
          },
          { title: '中文用途', dataIndex: 'descriptionZh', ellipsis: true, search: false },
        ]}
        options={false}
      />
    </main>
  );
}
