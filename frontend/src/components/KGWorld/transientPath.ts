import type { KGOverview, KGRoleEdge, KGRoleView } from './types';

const STORAGE_PREFIX = 'rea:kg-transient-path:v1:';
const SNAPSHOT_VERSION = 1;

type TransientPathSnapshot = {
  version: 1;
  path_id: string;
  role_view: KGRoleView;
};

export function transientPathStorageKey(pathID: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(pathID)}`;
}

function browserSessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRoleEdge(value: unknown): value is KGRoleEdge {
  if (!value || typeof value !== 'object') return false;
  const edge = value as Record<string, unknown>;
  return typeof edge.from === 'string'
    && typeof edge.to === 'string'
    && (edge.type === undefined || typeof edge.type === 'string')
    && (edge.relation === undefined || typeof edge.relation === 'string')
    && (edge.traversal === undefined || edge.traversal === 'forward' || edge.traversal === 'reverse')
    && (edge.segment === undefined || typeof edge.segment === 'string');
}

function isRoleView(value: unknown): value is KGRoleView {
  if (!value || typeof value !== 'object') return false;
  const view = value as Record<string, unknown>;
  return isStringArray(view.upstream)
    && isStringArray(view.current)
    && isStringArray(view.downstream)
    && (view.edges === undefined || (Array.isArray(view.edges) && view.edges.every(isRoleEdge)))
    && (view.focus_node_ids === undefined || isStringArray(view.focus_node_ids));
}

function isSnapshot(value: unknown, pathID: string): value is TransientPathSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.version === SNAPSHOT_VERSION
    && snapshot.path_id === pathID
    && isRoleView(snapshot.role_view);
}

export function writeTransientPathSnapshot(
  pathID: string,
  roleView: KGRoleView,
  storage: Storage | undefined = browserSessionStorage(),
): boolean {
  if (!pathID || !storage || !isRoleView(roleView)) return false;
  const snapshot: TransientPathSnapshot = {
    version: SNAPSHOT_VERSION,
    path_id: pathID,
    role_view: roleView,
  };
  try {
    storage.setItem(transientPathStorageKey(pathID), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function readTransientPathSnapshot(
  pathID: string,
  overview: KGOverview,
  storage: Storage | undefined = browserSessionStorage(),
): KGRoleView | undefined {
  if (!pathID || !storage) return undefined;
  let value: unknown;
  try {
    const raw = storage.getItem(transientPathStorageKey(pathID));
    if (!raw) return undefined;
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!isSnapshot(value, pathID)) return undefined;

  const view = value.role_view;
  const nodeIDs = new Set(overview.nodes.map((node) => node.node_id));
  const allRoleIDs = [...view.upstream, ...view.current, ...view.downstream];
  if (view.current.length === 0 || allRoleIDs.some((nodeID) => !nodeIDs.has(nodeID))) {
    return undefined;
  }
  const currentIDs = new Set(view.current);
  if ((view.focus_node_ids ?? []).some((nodeID) => !currentIDs.has(nodeID))) {
    return undefined;
  }
  const visualPairs = new Set(
    overview.visual_edges.map((edge) => `${edge.source}\u0000${edge.target}`),
  );
  if ((view.edges ?? []).some((edge) =>
    !nodeIDs.has(edge.from)
    || !nodeIDs.has(edge.to)
    || !visualPairs.has(`${edge.from}\u0000${edge.to}`),
  )) {
    return undefined;
  }
  return view;
}
