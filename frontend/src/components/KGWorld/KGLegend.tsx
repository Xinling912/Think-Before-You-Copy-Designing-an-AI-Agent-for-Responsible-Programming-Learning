import type { KGCategory } from './types';

export type KGLegendProps = {
  categories: KGCategory[];
  activeCategoryID?: string;
  disabled?: boolean;
  onSelectCategory: (categoryID: string) => void;
};

export function KGLegend({
  categories,
  activeCategoryID,
  disabled = false,
  onSelectCategory,
}: KGLegendProps) {
  return (
    <aside className="kg-world-legend" aria-label="Knowledge graph legend">
      <div className="kg-world-legend__section">
        <h3>Knowledge categories</h3>
        <ul>
          {categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                aria-label={category.label_zh}
                aria-pressed={activeCategoryID === category.id}
                disabled={disabled}
                onClick={() => onSelectCategory(category.id)}
                style={{ '--kg-category-color': category.color } as React.CSSProperties}
              >
                <i aria-hidden="true" />
                <span>
                  <strong>{category.label_en}</strong>
                </span>
                <em>{category.node_count} nodes</em>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="kg-world-legend__section kg-world-legend__types">
        <h3>Node types</h3>
        <span><i className="is-concept" />Concept</span>
        <span><i className="is-error" />ErrorType</span>
        <span><i className="is-misconception" />Misconception</span>
      </div>
      <div className="kg-world-legend__section kg-world-legend__roles">
        <h3>Learning roles</h3>
        <span><i className="is-upstream" />upstream</span>
        <span><i className="is-current" />current</span>
        <span><i className="is-downstream" />downstream</span>
      </div>
      <div className="kg-world-legend__section kg-world-legend__edges">
        <span><i />Relation</span>
        <span><i className="is-path" />Current path</span>
      </div>
    </aside>
  );
}
