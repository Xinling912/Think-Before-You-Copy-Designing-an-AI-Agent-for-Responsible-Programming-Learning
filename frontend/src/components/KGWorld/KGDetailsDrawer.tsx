import { useEffect, useMemo } from 'react';

import type { KGBoundaryPort, KGOverview, KGRelation } from './types';
import type { KGWorldLanguage } from './language';

export type KGSelection =
  | { kind: 'none' }
  | { kind: 'node'; nodeID: string }
  | { kind: 'edge'; edgeID: string }
  | { kind: 'port'; portID: string };

type KGDetailsDrawerProps = {
  overview: KGOverview;
  selection: KGSelection;
  ports: KGBoundaryPort[];
  reducedMotion: boolean;
  onClose: () => void;
  onNavigateCategory: (categoryID: string) => void;
  language?: KGWorldLanguage;
};

const provenanceOrder = new Map([
  ['curated', 0],
  ['generated', 1],
  ['merged', 2],
]);

function sortProvenance(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    (provenanceOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (provenanceOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right),
  );
}

function DrawerShell({
  label,
  selection,
  reducedMotion,
  onClose,
  children,
  language,
}: {
  label: string;
  selection: Exclude<KGSelection, { kind: 'none' }>;
  reducedMotion: boolean;
  onClose: () => void;
  children: React.ReactNode;
  language: KGWorldLanguage;
}) {
  return (
    <aside
      aria-label={label}
      className={[
        'kg-details-drawer',
        `kg-details-drawer--${selection.kind}`,
        reducedMotion ? 'is-static-focus' : '',
      ].filter(Boolean).join(' ')}
      data-selection-kind={selection.kind}
      style={{ width: selection.kind === 'node' ? '400px' : '440px' }}
    >
      <button
        type="button"
        className="kg-details-drawer__close"
        aria-label={language === 'en' ? 'Close details' : '关闭详情'}
        onClick={onClose}
      >
        ×
      </button>
      {children}
    </aside>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kg-details-drawer__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function KGDetailsDrawer({
  overview,
  selection,
  ports,
  reducedMotion,
  onClose,
  onNavigateCategory,
  language = 'current',
}: KGDetailsDrawerProps) {
  const english = language === 'en';
  useEffect(() => {
    if (selection.kind === 'none') return undefined;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, selection.kind]);

  const categoryByID = useMemo(
    () => new Map(overview.categories.map((category) => [category.id, category])),
    [overview.categories],
  );
  const nodeByID = useMemo(
    () => new Map(overview.nodes.map((node) => [node.node_id, node])),
    [overview.nodes],
  );

  if (selection.kind === 'none') return null;

  if (selection.kind === 'node') {
    const node = nodeByID.get(selection.nodeID);
    if (!node) return null;
    const neighbors = overview.relations
      .flatMap((relation) => {
        const otherID = relation.source === node.node_id
          ? relation.target
          : relation.target === node.node_id
            ? relation.source
            : '';
        const other = nodeByID.get(otherID);
        return other ? [{ relation, other }] : [];
      })
      .sort((left, right) =>
        left.relation.type.localeCompare(right.relation.type)
        || left.other.label.localeCompare(right.other.label)
        || left.other.node_id.localeCompare(right.other.node_id),
      );
    const pathIDs = [...node.path_ids].sort((left, right) => left.localeCompare(right));
    return (
      <DrawerShell
        label={english ? 'Node details' : '节点详情'}
        selection={selection}
        reducedMotion={reducedMotion}
        onClose={onClose}
        language={language}
      >
        <p className="kg-details-drawer__eyebrow">{node.node_type}</p>
        <h2>{node.label}</h2>
        <dl>
          <Fact label="node ID">{node.node_id}</Fact>
          <Fact label="node type">{node.node_type}</Fact>
          <Fact label={english ? 'category' : '分类'}>{categoryByID.get(node.category_id)?.label_zh ?? node.category_id}</Fact>
          <Fact label="aliases">{node.aliases.join(english ? ', ' : '、')}</Fact>
          <Fact label={english ? 'unique in-degree' : '唯一入度'}>{node.unique_in_degree}</Fact>
          <Fact label={english ? 'unique out-degree' : '唯一出度'}>{node.unique_out_degree}</Fact>
        </dl>
        <section>
          <h3>{english ? 'Neighboring nodes' : '相邻节点'}</h3>
          <ul>
            {neighbors.map(({ relation, other }) => (
              <li key={relation.key} data-testid="node-neighbor">
                {relation.type} · {other.label} · {other.node_id}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>{english ? 'Learning paths' : '所属学习路径'}</h3>
          <ul>
            {pathIDs.map((pathID) => <li key={pathID} data-testid="node-path">{pathID}</li>)}
          </ul>
        </section>
        <section>
          <h3>evidence summary</h3>
          <p>{node.evidence_summary}</p>
        </section>
        <section>
          <h3>source URLs</h3>
          <ul>
            {node.source_urls.map((url) => (
              <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>
            ))}
          </ul>
        </section>
      </DrawerShell>
    );
  }

  if (selection.kind === 'edge') {
    const edge = overview.visual_edges.find((candidate) => candidate.key === selection.edgeID);
    if (!edge) return null;
    const triples = overview.relations
      .filter((relation) => relation.source === edge.source && relation.target === edge.target)
      .sort((left, right) => left.type.localeCompare(right.type) || left.key.localeCompare(right.key));
    const relationTypes = [...new Set(triples.map((relation) => relation.type))].sort();
    const provenances = sortProvenance(triples.flatMap((relation) => relation.origins));
    return (
      <DrawerShell
        label={english ? 'Relation details' : '关系详情'}
        selection={selection}
        reducedMotion={reducedMotion}
        onClose={onClose}
        language={language}
      >
        <p className="kg-details-drawer__eyebrow">{edge.relation_count}</p>
        <h2>{nodeByID.get(edge.source)?.label ?? edge.source} → {nodeByID.get(edge.target)?.label ?? edge.target}</h2>
        <dl>
          <Fact label="source node">{edge.source}</Fact>
          <Fact label="target node">{edge.target}</Fact>
          <Fact label={english ? 'aggregated relation count' : '聚合关系数量'}>{edge.relation_count}</Fact>
        </dl>
        <section>
          <h3>relation types</h3>
          <ul>{relationTypes.map((type) => <li key={type} data-testid="relation-type">{type}</li>)}</ul>
        </section>
        <section>
          <h3>provenance</h3>
          <ul>{provenances.map((origin) => <li key={origin} data-testid="relation-provenance">{origin}</li>)}</ul>
        </section>
        <section>
          <h3>{english ? 'Unique triples' : '唯一三元组'}</h3>
          <ul className="kg-details-drawer__triples">
            {triples.map((relation) => (
              <li key={relation.key} data-testid="edge-triple">
                <span>{relation.source}</span>
                <strong>{relation.type}</strong>
                <span>{relation.target}</span>
                <small>{sortProvenance(relation.origins).join(' · ')}</small>
              </li>
            ))}
          </ul>
        </section>
      </DrawerShell>
    );
  }

  const port = ports.find((candidate) => candidate.id === selection.portID);
  if (!port) return null;
  const keySet = new Set(port.relationKeys);
  const triples = overview.relations
    .filter((relation) => keySet.has(relation.key))
    .sort((left, right) =>
      left.source.localeCompare(right.source)
      || left.type.localeCompare(right.type)
      || left.target.localeCompare(right.target),
    );
  return (
    <DrawerShell
      label={english ? 'Cross-category relations' : '跨区域关系'}
      selection={selection}
      reducedMotion={reducedMotion}
      onClose={onClose}
      language={language}
    >
      <p className="kg-details-drawer__eyebrow">{port.direction}</p>
      <h2>{port.label}</h2>
      <ul className="kg-details-drawer__triples">
        {triples.map((relation: KGRelation) => (
          <li key={relation.key} data-testid="port-triple">
            <span>{relation.source}</span>
            <strong>{relation.type}</strong>
            <span>{relation.target}</span>
            <small>{port.direction}</small>
            <small>{sortProvenance(relation.origins).join(' · ')}</small>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="kg-details-drawer__navigate"
        onClick={() => onNavigateCategory(port.externalCategoryID)}
      >
        {english ? 'Go to Category' : '前往该区域'}
      </button>
    </DrawerShell>
  );
}
