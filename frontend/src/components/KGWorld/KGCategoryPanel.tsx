import type { KGCategory } from './types';
import type { KGWorldLanguage } from './language';

export type KGCategoryPanelProps = {
  category: KGCategory;
  onEnterDetail: () => void;
  onReturnWorld: () => void;
  transitioning?: boolean;
  language?: KGWorldLanguage;
};

export function KGCategoryPanel({
  category,
  onEnterDetail,
  onReturnWorld,
  transitioning = false,
  language = 'current',
}: KGCategoryPanelProps) {
  const english = language === 'en';
  const metrics = [
    [english ? 'Nodes' : '节点', category.node_count],
    [english ? 'Internal relations' : '区内关系', category.internal_relation_count],
    [english ? 'Outgoing relations' : '出区关系', category.outgoing_relation_count],
    [english ? 'Incoming relations' : '入区关系', category.incoming_relation_count],
  ] as const;
  return (
    <aside
      className="kg-category-panel"
      aria-label={english ? 'Category Overview' : '区域简介'}
      data-transitioning={transitioning ? 'true' : 'false'}
      style={{ '--kg-category-color': category.color } as React.CSSProperties}
    >
      <p className="kg-category-panel__eyebrow">Knowledge Region</p>
      <h2 aria-label={category.label_zh}>{category.label_zh}</h2>
      {!english ? <p className="kg-category-panel__english">{category.label_en}</p> : null}
      <p className="kg-category-panel__description">{category.description_zh}</p>
      <dl>
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <button disabled={transitioning} className="kg-category-panel__primary" type="button" onClick={onEnterDetail}>
        {english ? 'View Category Details' : '查看区域详情'}
      </button>
      <button disabled={transitioning} className="kg-category-panel__text" type="button" onClick={onReturnWorld}>
        {english ? 'Back to Knowledge World' : '返回知识世界'}
      </button>
    </aside>
  );
}
