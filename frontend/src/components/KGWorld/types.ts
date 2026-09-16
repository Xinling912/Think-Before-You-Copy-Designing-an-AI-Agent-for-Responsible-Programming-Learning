export type KGStableViewState = 'WORLD' | 'CATEGORY_FOCUS' | 'CATEGORY_DETAIL';

export type KGTransientViewState =
  | 'ENTERING_CATEGORY'
  | 'ENTERING_DETAIL'
  | 'RETURNING_TO_CATEGORY'
  | 'RETURNING_TO_WORLD';

export type KGViewState = KGStableViewState | KGTransientViewState;

export type KGNodeRole = 'normal' | 'upstream' | 'downstream' | 'current';

export type KGPortDirection = 'incoming' | 'outgoing';

export type KGCounts = {
  nodes: number;
  categories: number;
  curated_relation_triples: number;
  unique_relation_triples: number;
  visual_directed_pairs: number;
  internal_relation_triples: number;
  cross_category_relation_triples: number;
  paths: number;
  raw_edge_records: number;
};

export type KGIntegrity = {
  valid: boolean;
  uncategorized_node_ids: string[];
  duplicate_node_ids: string[];
  dangling_relation_keys: string[];
  duplicate_relation_keys: string[];
  invalid_path_ids: string[];
};

export type KGAnchor = {
  x: number;
  y: number;
};

export type KGViewport = {
  width: number;
  height: number;
};

export type WorldLayoutPoint = {
  id?: string;
  category_id: string;
  x: number;
  y: number;
};

export type WorldLayoutMetrics = {
  nodeBoundsRatio: KGViewport;
  nearestNeighborMedianRatio: number;
  nearestNeighborMaximumRatio: number;
  maximumCategoryCentroidDistanceRatio: number;
  finitePositionCount: number;
};

export type WorldModelLayoutMetrics = {
  nodeBoundsRatio: KGViewport;
  nearestNeighborMedianRatio: number;
  nearestNeighborMaximumRatio: number;
  maximumCategoryCentroidDistanceRatio: number;
  finitePositionCount: number;
};

export type KGCategory = {
  id: string;
  label_zh: string;
  label_en: string;
  description_zh: string;
  description_en: string;
  color: string;
  surface_color: string;
  anchor: KGAnchor;
  order: number;
  node_count: number;
  internal_relation_count: number;
  outgoing_relation_count: number;
  incoming_relation_count: number;
};

export type KGNode = {
  node_id: string;
  label: string;
  node_type: string;
  origin: string;
  aliases: string[];
  source_ids: string[];
  source_chunk_ids: string[];
  source_urls: string[];
  evidence_summary: string;
  confidence: number | null;
  category_id: string;
  unique_in_degree: number;
  unique_out_degree: number;
  unique_relation_degree: number;
  path_ids: string[];
};

export type KGRelation = {
  key: string;
  source: string;
  type: string;
  target: string;
  source_category_id: string;
  target_category_id: string;
  is_cross_category: boolean;
  origins: string[];
  source_ids: string[];
  source_chunk_ids: string[];
  source_urls: string[];
  evidence_texts: string[];
};

export type KGVisualEdge = {
  key: string;
  source: string;
  target: string;
  source_category_id: string;
  target_category_id: string;
  is_cross_category: boolean;
  relation_types: string[];
  relation_count: number;
  provenance_count: number;
  origins: string[];
  source_ids: string[];
  source_chunk_ids: string[];
  source_urls: string[];
  evidence_texts: string[];
};

export type KGPathRelation = {
  from: string;
  to: string;
  type: string;
  traversal: string;
};

export type KGPath = {
  path_id: string;
  label: string;
  topic: string;
  path: string[];
  upstream: string[];
  focus: string[];
  downstream: string[];
  category_ids: string[];
  crosses_category_boundary: boolean;
  focus_node_ids: string[];
  hop_count: number;
  relations: KGPathRelation[];
  evidence_summary: string;
  source_url: string;
  source_urls: string[];
  source_id: string;
  evidence_chunk_ids: string[];
};

export type KGOverview = {
  version: string;
  counts: KGCounts;
  integrity: KGIntegrity;
  categories: KGCategory[];
  nodes: KGNode[];
  relations: KGRelation[];
  visual_edges: KGVisualEdge[];
  paths: KGPath[];
};

export type KGRoleEdge = {
  from: string;
  to: string;
  type?: string;
  relation?: string;
  traversal?: 'forward' | 'reverse';
  segment?: string;
};

export type KGRoleView = {
  upstream: string[];
  current: string[];
  downstream: string[];
  edges?: KGRoleEdge[];
  focus_node_ids?: string[];
};

export type KGBoundaryPort = {
  id: string;
  categoryID: string;
  externalCategoryID: string;
  direction: KGPortDirection;
  label: string;
  relationCount: number;
  relationKeys: string[];
  insideNodeIDs: string[];
  externalNodeIDs: string[];
};

export type KGGraphNode = {
  id: string;
  data: KGNode;
  style: {
    fill: string;
    size: number;
  };
};

export type KGGraphEdge = {
  id: string;
  source: string;
  target: string;
  data: KGVisualEdge;
};

export type KGWorldGraph = {
  nodes: KGGraphNode[];
  edges: KGGraphEdge[];
};

export type KGCategoryGraph = KGWorldGraph & {
  ports: KGBoundaryPort[];
};

export type KGLocation = {
  categoryID: string;
  focusNodeID: string;
  pathID: string;
};

export type KGValidationResult = {
  valid: boolean;
  errors: string[];
};
