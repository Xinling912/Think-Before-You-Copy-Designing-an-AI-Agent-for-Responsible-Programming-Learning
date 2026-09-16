import { useEffect, useMemo, useRef, useState } from 'react';

import type { KnowledgePathNode, KnowledgePathView } from '../../pages/SessionDemo/model';
import { projectWorldGraph, resolveNodeRoles } from './data';
import { KGGraphCanvas, ROLE_STYLES, type KGGraphCanvasProps } from './KGGraphCanvas';
import { writeTransientPathSnapshot } from './transientPath';
import type { KGOverview, KGRoleView, KGWorldGraph } from './types';

const overviewRequests = new WeakMap<typeof fetch, Promise<KGOverview | null>>();
const EMPTY_PORTS: NonNullable<KGGraphCanvasProps['ports']> = [];

type KGPathMiniGraphProps = {
  pathView?: KnowledgePathView;
  overview?: KGOverview;
  pathID?: string;
  turnID?: string;
  onRequestFocus?: (node: KnowledgePathNode) => void;
};

type MiniProjection = {
  graph: KGWorldGraph;
  pathNodeIDs: Set<string>;
  pathEdgeIDs: Set<string>;
  roleByNodeID: ReturnType<typeof resolveNodeRoles>;
  roleView: KGRoleView;
  focusNodeID?: string;
  categoryID: string;
};

function requestedNodeIDs(view: KnowledgePathView | undefined): string[] {
  if (!view) return [];
  return [...(view.upstream ?? []), ...(view.current ?? []), ...(view.downstream ?? [])]
    .map((node) => node.id);
}

export function knowledgePathViewSignature(view: KnowledgePathView | undefined): string {
  if (!view) return '';
  const nodes = (items: KnowledgePathNode[] | undefined) =>
    (items ?? []).map(({ id, label, type }) => [id, label, type ?? '']);
  return JSON.stringify({
    pathID: view.path_id ?? '',
    upstream: nodes(view.upstream),
    current: nodes(view.current),
    downstream: nodes(view.downstream),
    focusNodeIDs: view.focus_node_ids ?? [],
    edges: (view.edges ?? []).map((edge) => [
      edge.from,
      edge.to,
      edge.type ?? '',
      edge.relation ?? '',
      edge.traversal ?? '',
      edge.segment ?? '',
    ]),
  });
}

function loadOverview(): Promise<KGOverview | null> {
  const fetchImplementation = fetch;
  const request = overviewRequests.get(fetchImplementation);
  if (request) return request;
  const nextRequest = fetchImplementation('/api/kg/overview')
    .then(async (response) => {
      if (!response.ok) return null;
      const value = await response.json();
      if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.visual_edges)) return null;
      return value as KGOverview;
    })
    .catch((error: unknown) => {
      console.error('Unable to load KG overview for the knowledge path graph.', error);
      return null;
    });
  overviewRequests.set(fetchImplementation, nextRequest);
  void nextRequest.then((value) => {
    if (value === null && overviewRequests.get(fetchImplementation) === nextRequest) {
      overviewRequests.delete(fetchImplementation);
    }
  });
  return nextRequest;
}

function uniqueKnownIDs(ids: string[], knownIDs: Set<string>): string[] {
  return [...new Set(ids.filter((nodeID) => knownIDs.has(nodeID)))];
}

export function projectKnowledgePathSubgraph(
  overview: KGOverview,
  view: KnowledgePathView,
): MiniProjection | null {
  const nodeByID = new Map(overview.nodes.map((node) => [node.node_id, node]));
  const rawIDs = requestedNodeIDs(view);
  const referencedIDs = [
    ...rawIDs,
    ...(view.focus_node_ids ?? []),
    ...(view.edges ?? []).flatMap((edge) => [edge.from, edge.to]),
  ];
  const unknownIDs = [...new Set(referencedIDs.filter((nodeID) => !nodeByID.has(nodeID)))];
  for (const nodeID of unknownIDs) {
    console.error(`Knowledge path references unknown KG node: ${nodeID}`);
  }

  const pathNodeIDs = new Set(rawIDs.filter((nodeID) => nodeByID.has(nodeID)));
  if (pathNodeIDs.size === 0) return null;

  const scopeNodeIDs = new Set(pathNodeIDs);
  for (const edge of overview.visual_edges) {
    if (pathNodeIDs.has(edge.source) && nodeByID.has(edge.target)) scopeNodeIDs.add(edge.target);
    if (pathNodeIDs.has(edge.target) && nodeByID.has(edge.source)) scopeNodeIDs.add(edge.source);
  }

  const pathPairs = new Set(
    (view.edges ?? []).map((edge) => `${edge.from}\u0000${edge.to}`),
  );
  const world = projectWorldGraph(overview);
  const graph = {
    nodes: world.nodes.filter((node) => scopeNodeIDs.has(node.id)),
    edges: world.edges.filter(
      (edge) => scopeNodeIDs.has(edge.source) && scopeNodeIDs.has(edge.target),
    ),
  };
  const pathEdgeIDs = new Set(
    graph.edges
      .filter((edge) => pathPairs.has(`${edge.source}\u0000${edge.target}`))
      .map((edge) => edge.id),
  );
  const validRoles = {
    upstream: uniqueKnownIDs((view.upstream ?? []).map((node) => node.id), pathNodeIDs),
    current: uniqueKnownIDs((view.current ?? []).map((node) => node.id), pathNodeIDs),
    downstream: uniqueKnownIDs((view.downstream ?? []).map((node) => node.id), pathNodeIDs),
  };
  const roleByNodeID = resolveNodeRoles(validRoles);
  const focusNodeID = (view.focus_node_ids ?? []).find((nodeID) =>
    pathNodeIDs.has(nodeID) && roleByNodeID.get(nodeID) === 'current',
  ) ?? validRoles.current[0];
  const validEdgePairs = new Set(graph.edges.map((edge) => `${edge.source}\u0000${edge.target}`));
  const roleView: KGRoleView = {
    ...validRoles,
    edges: (view.edges ?? []).filter((edge) =>
      pathNodeIDs.has(edge.from)
      && pathNodeIDs.has(edge.to)
      && validEdgePairs.has(`${edge.from}\u0000${edge.to}`),
    ),
    focus_node_ids: focusNodeID ? [focusNodeID] : [],
  };
  const categoryID = nodeByID.get(focusNodeID ?? '')?.category_id ?? '';

  return {
    graph,
    pathNodeIDs,
    pathEdgeIDs,
    roleByNodeID,
    roleView,
    focusNodeID,
    categoryID,
  };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export function KGPathMiniGraph({
  pathView,
  overview: suppliedOverview,
  pathID,
  turnID,
  onRequestFocus,
}: KGPathMiniGraphProps) {
  const pathViewSignature = knowledgePathViewSignature(pathView);
  const stablePathViewRef = useRef({ signature: pathViewSignature, value: pathView });
  if (stablePathViewRef.current.signature !== pathViewSignature) {
    stablePathViewRef.current = { signature: pathViewSignature, value: pathView };
  }
  const stablePathView = stablePathViewRef.current.value;
  const rawNodeIDs = requestedNodeIDs(stablePathView);
  const hasPath = rawNodeIDs.length > 0;
  const [loadedOverview, setLoadedOverview] = useState<KGOverview | null | undefined>(suppliedOverview);
  const [expanded, setExpanded] = useState(false);
  const [selectedNodeID, setSelectedNodeID] = useState<string>();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (suppliedOverview) {
      setLoadedOverview(suppliedOverview);
      return;
    }
    if (!hasPath) return;
    let current = true;
    void loadOverview().then((value) => {
      if (current) setLoadedOverview(value);
    });
    return () => {
      current = false;
    };
  }, [hasPath, suppliedOverview]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [expanded]);

  const projection = useMemo(
    () => loadedOverview && stablePathView
      ? projectKnowledgePathSubgraph(loadedOverview, stablePathView)
      : undefined,
    [loadedOverview, stablePathView],
  );

  useEffect(() => {
    if (selectedNodeID && !projection?.graph.nodes.some((node) => node.id === selectedNodeID)) {
      setSelectedNodeID(undefined);
    }
  }, [projection, selectedNodeID]);

  const persistentPathID = pathID || stablePathView?.path_id || '';
  useEffect(() => {
    if (persistentPathID || !turnID || !projection) return;
    writeTransientPathSnapshot(turnID, projection.roleView);
  }, [persistentPathID, projection, turnID]);

  if (!hasPath) {
    return <p className="kg-path-mini-state">No knowledge graph path for this turn.</p>;
  }
  if (loadedOverview === undefined) {
    return <p className="kg-path-mini-state">Loading knowledge path graph…</p>;
  }
  if (loadedOverview === null) {
    return <p className="kg-path-mini-state">Failed to load knowledge path metadata.</p>;
  }
  if (!projection) {
    return <p className="kg-path-mini-state">Invalid knowledge path data for this turn.</p>;
  }

  const focusID = projection.focusNodeID
    ?? [...projection.pathNodeIDs][0];
  const selectedPathID = pathID || stablePathView?.path_id || turnID || '';
  const params = new URLSearchParams();
  params.set('category', projection.categoryID);
  params.set('focus', focusID);
  if (selectedPathID) params.set('path', selectedPathID);
  const canvasHeight = expanded ? 'calc(100vh - 96px)' : '360px';
  const selectedNode = projection.graph.nodes.find((node) => node.id === selectedNodeID)?.data;

  return (
    <section
      className={`kg-path-mini ${expanded ? 'expanded' : ''}`}
      aria-label={expanded ? 'Expanded knowledge path graph' : undefined}
    >
      <div className="kg-path-mini-toolbar">
        <a href={`/knowledge-world?${params.toString()}`}>View in Knowledge World</a>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Close knowledge path graph' : 'Expand knowledge path graph'}
        >
          {expanded ? 'Close' : 'Expand'}
        </button>
      </div>
      <div className="kg-path-mini-role-legend" aria-label="Knowledge path role legend">
        <span data-testid="kg-role-upstream" data-fill={ROLE_STYLES.upstream.fill}>
          <i style={{ background: ROLE_STYLES.upstream.fill }} />Upstream
        </span>
        <span data-testid="kg-role-current" data-fill={ROLE_STYLES.current.fill}>
          <i style={{ background: ROLE_STYLES.current.fill }} />Current
        </span>
        <span data-testid="kg-role-downstream" data-fill={ROLE_STYLES.downstream.fill}>
          <i style={{ background: ROLE_STYLES.downstream.fill }} />Downstream
        </span>
      </div>
      <KGGraphCanvas
        colorEdgesBySourceRole
        graph={projection.graph}
        categories={loadedOverview.categories}
        ports={EMPTY_PORTS}
        roleByNodeID={projection.roleByNodeID}
        viewState="CATEGORY_DETAIL"
        activeCategoryID={projection.categoryID}
        dataVersion={`${loadedOverview.version}:mini:${selectedPathID || focusID}`}
        reducedMotion={reducedMotion}
        focusNodeID={projection.focusNodeID}
        pathNodeIDs={projection.pathNodeIDs}
        pathEdgeIDs={projection.pathEdgeIDs}
        selectedNodeID={selectedNodeID}
        aria-label="Knowledge path force graph"
        style={{ width: '100%', height: canvasHeight }}
        onNodeClick={setSelectedNodeID}
        onEscape={() => setExpanded(false)}
      />
      {selectedNode ? (
        <div className="kg-path-mini-node-detail" role="region" aria-label="Selected knowledge node">
          <div>
            <span>{selectedNode.node_type}</span>
            <strong>{selectedNode.label}</strong>
            <small>{selectedNode.node_id}</small>
          </div>
          <div className="kg-path-mini-node-actions">
            <button
              type="button"
              onClick={() => onRequestFocus?.({
                id: selectedNode.node_id,
                label: selectedNode.label,
                type: selectedNode.node_type,
              })}
            >
              Ask about this node
            </button>
            <button type="button" onClick={() => setSelectedNodeID(undefined)} aria-label="Close node details">
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
