import type {
  KGBoundaryPort,
  KGCategory,
  KGCategoryGraph,
  KGGraphEdge,
  KGGraphNode,
  KGLocation,
  KGNode,
  KGNodeRole,
  KGOverview,
  KGPortDirection,
  KGRoleView,
  KGValidationResult,
  KGWorldGraph,
} from './types';

const INTEGRITY_ERROR_FIELDS = [
  'uncategorized_node_ids',
  'duplicate_node_ids',
  'dangling_relation_keys',
  'duplicate_relation_keys',
  'invalid_path_ids',
] as const;

const COUNT_ARRAY_FIELDS = [
  ['nodes', 'nodes'],
  ['categories', 'categories'],
  ['unique_relation_triples', 'relations'],
  ['visual_directed_pairs', 'visual_edges'],
  ['paths', 'paths'],
] as const;

const PORT_DIRECTION_ORDER: Record<KGPortDirection, number> = {
  incoming: 0,
  outgoing: 1,
};

export function validateOverview(value: unknown): KGValidationResult {
  const errors: string[] = [];
  if (!validateOverviewStructure(value, errors)) {
    return { valid: false, errors };
  }

  validateIntegrity(value, errors);
  validateCounts(value, errors);
  validateGraphReferences(value, errors);
  validateCategoryMetrics(value, errors);

  return { valid: errors.length === 0, errors };
}

export function projectWorldGraph(overview: KGOverview): KGWorldGraph {
  const categories = categoryMap(overview.categories);
  return {
    nodes: overview.nodes.map((node) => projectNode(node, categories, worldNodeSize(node))),
    edges: overview.visual_edges.map(projectEdge),
  };
}

export function projectCategoryGraph(overview: KGOverview, categoryID: string): KGCategoryGraph {
  const categories = categoryMap(overview.categories);
  if (!categories.has(categoryID)) {
    throw new Error(`Unknown KG category: ${categoryID}`);
  }

  return {
    nodes: overview.nodes
      .filter((node) => node.category_id === categoryID)
      .map((node) => projectNode(node, categories, 16)),
    edges: overview.visual_edges
      .filter(
        (edge) =>
          !edge.is_cross_category &&
          edge.source_category_id === categoryID &&
          edge.target_category_id === categoryID,
      )
      .map(projectEdge),
    ports: buildBoundaryPorts(overview, categoryID),
  };
}

export function resolveNodeRoles(
  view: Pick<KGRoleView, 'upstream' | 'current' | 'downstream'>,
): Map<string, KGNodeRole> {
  const roles = new Map<string, KGNodeRole>();
  for (const nodeID of view.downstream) {
    roles.set(nodeID, 'downstream');
  }
  for (const nodeID of view.upstream) {
    roles.set(nodeID, 'upstream');
  }
  for (const nodeID of view.current) {
    roles.set(nodeID, 'current');
  }
  return roles;
}

export function buildBoundaryPorts(overview: KGOverview, categoryID: string): KGBoundaryPort[] {
  const categories = categoryMap(overview.categories);
  if (!categories.has(categoryID)) {
    throw new Error(`Unknown KG category: ${categoryID}`);
  }

  type PortAccumulator = {
    externalCategoryID: string;
    direction: KGPortDirection;
    relationKeys: Set<string>;
    insideNodeIDs: Set<string>;
    externalNodeIDs: Set<string>;
  };

  const groups = new Map<string, PortAccumulator>();
  for (const relation of overview.relations) {
    if (!relation.is_cross_category) {
      continue;
    }

    let direction: KGPortDirection;
    let externalCategoryID: string;
    let insideNodeID: string;
    let externalNodeID: string;
    if (relation.source_category_id === categoryID && relation.target_category_id !== categoryID) {
      direction = 'outgoing';
      externalCategoryID = relation.target_category_id;
      insideNodeID = relation.source;
      externalNodeID = relation.target;
    } else if (
      relation.target_category_id === categoryID &&
      relation.source_category_id !== categoryID
    ) {
      direction = 'incoming';
      externalCategoryID = relation.source_category_id;
      insideNodeID = relation.target;
      externalNodeID = relation.source;
    } else {
      continue;
    }

    const groupKey = `${externalCategoryID}|${direction}`;
    const group = groups.get(groupKey) ?? {
      externalCategoryID,
      direction,
      relationKeys: new Set<string>(),
      insideNodeIDs: new Set<string>(),
      externalNodeIDs: new Set<string>(),
    };
    group.relationKeys.add(relation.key);
    group.insideNodeIDs.add(insideNodeID);
    group.externalNodeIDs.add(externalNodeID);
    groups.set(groupKey, group);
  }

  return [...groups.values()]
    .sort((left, right) => {
      const categoryOrder =
        (categories.get(left.externalCategoryID)?.order ?? Number.MAX_SAFE_INTEGER) -
        (categories.get(right.externalCategoryID)?.order ?? Number.MAX_SAFE_INTEGER);
      return categoryOrder || PORT_DIRECTION_ORDER[left.direction] - PORT_DIRECTION_ORDER[right.direction];
    })
    .map((group) => {
      const externalCategory = categories.get(group.externalCategoryID);
      const relationKeys = [...group.relationKeys].sort();
      const relationCount = relationKeys.length;
      const baseLabel = `${externalCategory?.label_zh ?? group.externalCategoryID} · ${relationCount}`;
      return {
        id: `${categoryID}|${group.externalCategoryID}|${group.direction}`,
        categoryID,
        externalCategoryID: group.externalCategoryID,
        direction: group.direction,
        label: group.direction === 'incoming' ? `← ${baseLabel}` : `${baseLabel} →`,
        relationCount,
        relationKeys,
        insideNodeIDs: [...group.insideNodeIDs].sort(),
        externalNodeIDs: [...group.externalNodeIDs].sort(),
      };
    });
}

export function searchNodes(overview: KGOverview, query: string): KGNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return [];
  }

  const score = (node: KGNode): number => {
    const values = [node.node_id, node.label, ...node.aliases].map((value) =>
      value.toLocaleLowerCase(),
    );
    if (values.includes(needle)) return 0;
    if (values.some((value) => value.startsWith(needle))) return 1;
    return 2;
  };

  return overview.nodes
    .filter((node) =>
      [node.node_id, node.label, ...node.aliases].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
    )
    .sort(
      (left, right) =>
        score(left) - score(right) ||
        left.label.localeCompare(right.label) ||
        left.node_id.localeCompare(right.node_id),
    )
    .slice(0, 10);
}

export function parseKGLocation(search: string): KGLocation {
  const queryStart = search.indexOf('?');
  const query = queryStart >= 0 ? search.slice(queryStart + 1) : search;
  const params = new URLSearchParams(query);
  return {
    categoryID: params.get('category') ?? '',
    focusNodeID: params.get('focus') ?? '',
    pathID: params.get('path') ?? '',
  };
}

function validateIntegrity(overview: KGOverview, errors: string[]): void {
  if (overview.integrity.valid !== true) {
    errors.push('integrity.valid must be true');
  }
  for (const field of INTEGRITY_ERROR_FIELDS) {
    const values = overview.integrity[field];
    if (!Array.isArray(values)) {
      errors.push(`integrity.${field} must be an array`);
    } else if (values.length > 0) {
      errors.push(`integrity.${field}: ${values.join(', ')}`);
    }
  }
}

function validateCounts(overview: KGOverview, errors: string[]): void {
  for (const [countField, arrayField] of COUNT_ARRAY_FIELDS) {
    const expected = overview.counts[countField];
    const actual = overview[arrayField].length;
    if (expected !== actual) {
      errors.push(`counts.${countField} is ${expected}; ${arrayField}.length is ${actual}`);
    }
  }

  const curatedRelations = overview.relations.filter((relation) =>
    relation.origins.includes('curated'),
  ).length;
  const internalRelations = overview.relations.filter(
    (relation) => relation.source_category_id === relation.target_category_id,
  ).length;
  const crossCategoryRelations = overview.relations.length - internalRelations;
  const computedCounts = [
    ['curated_relation_triples', curatedRelations],
    ['internal_relation_triples', internalRelations],
    ['cross_category_relation_triples', crossCategoryRelations],
  ] as const;
  for (const [field, actual] of computedCounts) {
    if (overview.counts[field] !== actual) {
      errors.push(`counts.${field} is ${overview.counts[field]}; computed value is ${actual}`);
    }
  }

  const visualRelationCount = overview.visual_edges.reduce(
    (total, edge) => total + edge.relation_count,
    0,
  );
  if (visualRelationCount !== overview.counts.unique_relation_triples) {
    errors.push(
      `visual edge relation_count total is ${visualRelationCount}; counts.unique_relation_triples is ${overview.counts.unique_relation_triples}`,
    );
  }
}

function validateGraphReferences(overview: KGOverview, errors: string[]): void {
  const categoryIDs = new Set(overview.categories.map((category) => category.id));
  const nodeIDs = new Set(overview.nodes.map((node) => node.node_id));
  reportDuplicates(
    overview.categories.map((category) => category.id),
    'category IDs',
    errors,
  );
  reportDuplicates(
    overview.nodes.map((node) => node.node_id),
    'node IDs',
    errors,
  );
  reportDuplicates(
    overview.relations.map((relation) => relation.key),
    'relation keys',
    errors,
  );
  reportDuplicates(
    overview.visual_edges.map((edge) => edge.key),
    'visual edge keys',
    errors,
  );
  reportDuplicates(
    overview.paths.map((path) => path.path_id),
    'path IDs',
    errors,
  );

  const nodeCategories = new Map<string, string>();
  for (const node of overview.nodes) {
    nodeCategories.set(node.node_id, node.category_id);
    if (!categoryIDs.has(node.category_id)) {
      errors.push(`node ${node.node_id} uses unknown category ${node.category_id}`);
    }
  }

  for (const relation of overview.relations) {
    validateEdgeReference(
      'relation',
      relation.key,
      relation.source,
      relation.target,
      relation.source_category_id,
      relation.target_category_id,
      relation.is_cross_category,
      nodeIDs,
      categoryIDs,
      nodeCategories,
      errors,
    );
  }
  for (const edge of overview.visual_edges) {
    validateEdgeReference(
      'visual edge',
      edge.key,
      edge.source,
      edge.target,
      edge.source_category_id,
      edge.target_category_id,
      edge.is_cross_category,
      nodeIDs,
      categoryIDs,
      nodeCategories,
      errors,
    );
  }

  for (const path of overview.paths) {
    for (const categoryID of path.category_ids) {
      if (!categoryIDs.has(categoryID)) {
        errors.push(`path ${path.path_id} uses unknown category ${categoryID}`);
      }
    }
    const references = new Set([
      ...path.path,
      ...path.upstream,
      ...path.focus,
      ...path.downstream,
      ...path.focus_node_ids,
      ...path.relations.flatMap((relation) => [relation.from, relation.to]),
    ]);
    for (const nodeID of references) {
      if (!nodeIDs.has(nodeID)) {
        errors.push(`path ${path.path_id} references missing node ${nodeID}`);
      }
    }
  }
}

function validateCategoryMetrics(overview: KGOverview, errors: string[]): void {
  for (const category of overview.categories) {
    const nodeCount = overview.nodes.filter((node) => node.category_id === category.id).length;
    const internalRelationCount = overview.relations.filter(
      (relation) =>
        relation.source_category_id === relation.target_category_id &&
        relation.source_category_id === category.id &&
        relation.target_category_id === category.id,
    ).length;
    const outgoingRelationCount = overview.relations.filter(
      (relation) =>
        relation.source_category_id !== relation.target_category_id &&
        relation.source_category_id === category.id,
    ).length;
    const incomingRelationCount = overview.relations.filter(
      (relation) =>
        relation.source_category_id !== relation.target_category_id &&
        relation.target_category_id === category.id,
    ).length;
    const metrics = [
      ['node_count', nodeCount],
      ['internal_relation_count', internalRelationCount],
      ['outgoing_relation_count', outgoingRelationCount],
      ['incoming_relation_count', incomingRelationCount],
    ] as const;
    for (const [field, actual] of metrics) {
      if (category[field] !== actual) {
        errors.push(`category ${category.id} ${field} is ${category[field]}; computed value is ${actual}`);
      }
    }
  }
}

function validateEdgeReference(
  kind: string,
  key: string,
  source: string,
  target: string,
  sourceCategoryID: string,
  targetCategoryID: string,
  isCrossCategory: boolean,
  nodeIDs: Set<string>,
  categoryIDs: Set<string>,
  nodeCategories: Map<string, string>,
  errors: string[],
): void {
  if (!nodeIDs.has(source)) errors.push(`${kind} ${key} has dangling source ${source}`);
  if (!nodeIDs.has(target)) errors.push(`${kind} ${key} has dangling target ${target}`);
  if (!categoryIDs.has(sourceCategoryID)) {
    errors.push(`${kind} ${key} uses unknown source category ${sourceCategoryID}`);
  }
  if (!categoryIDs.has(targetCategoryID)) {
    errors.push(`${kind} ${key} uses unknown target category ${targetCategoryID}`);
  }
  const computedIsCrossCategory = sourceCategoryID !== targetCategoryID;
  if (isCrossCategory !== computedIsCrossCategory) {
    errors.push(
      `${kind} ${key} is_cross_category is ${isCrossCategory}; computed value is ${computedIsCrossCategory}`,
    );
  }
  const actualSourceCategory = nodeCategories.get(source);
  const actualTargetCategory = nodeCategories.get(target);
  if (actualSourceCategory && actualSourceCategory !== sourceCategoryID) {
    errors.push(
      `${kind} ${key} source category ${sourceCategoryID} does not match ${actualSourceCategory}`,
    );
  }
  if (actualTargetCategory && actualTargetCategory !== targetCategoryID) {
    errors.push(
      `${kind} ${key} target category ${targetCategoryID} does not match ${actualTargetCategory}`,
    );
  }
}

function reportDuplicates(values: string[], label: string, errors: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size > 0) {
    errors.push(`duplicate ${label}: ${[...duplicates].sort().join(', ')}`);
  }
}

function projectNode(
  node: KGNode,
  categories: Map<string, KGCategory>,
  size: number,
): KGGraphNode {
  return {
    id: node.node_id,
    data: node,
    style: {
      fill: categories.get(node.category_id)?.color ?? '#64748B',
      size,
    },
  };
}

function projectEdge(edge: KGOverview['visual_edges'][number]): KGGraphEdge {
  return {
    id: edge.key,
    source: edge.source,
    target: edge.target,
    data: edge,
  };
}

function worldNodeSize(node: KGNode): number {
  return Math.min(18, 8 + Math.sqrt(node.unique_in_degree + node.unique_out_degree) * 1.8);
}

function categoryMap(categories: KGCategory[]): Map<string, KGCategory> {
  return new Map(categories.map((category) => [category.id, category]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ValueValidator = (value: unknown, path: string, errors: string[]) => boolean;

type FieldSchema<T extends object> = {
  [Key in keyof T]-?: ValueValidator;
};

function validateOverviewStructure(value: unknown, errors: string[]): value is KGOverview {
  if (!isRecord(value)) {
    errors.push('overview must be an object');
    return false;
  }
  return validateFields(value, '', OVERVIEW_SCHEMA, errors);
}

function validateFields(
  value: Record<string, unknown>,
  path: string,
  schema: Readonly<Record<string, ValueValidator>>,
  errors: string[],
): boolean {
  let valid = true;
  for (const field of Object.keys(schema)) {
    const fieldPath = path ? `${path}.${field}` : field;
    if (!schema[field](value[field], fieldPath, errors)) {
      valid = false;
    }
  }
  return valid;
}

function stringValue(value: unknown, path: string, errors: string[]): boolean {
  if (typeof value === 'string') return true;
  errors.push(`${path} must be a string`);
  return false;
}

function numberValue(value: unknown, path: string, errors: string[]): boolean {
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  errors.push(`${path} must be a finite number`);
  return false;
}

function nullableNumberValue(value: unknown, path: string, errors: string[]): boolean {
  if (value === null) return true;
  return numberValue(value, path, errors);
}

function booleanValue(value: unknown, path: string, errors: string[]): boolean {
  if (typeof value === 'boolean') return true;
  errors.push(`${path} must be a boolean`);
  return false;
}

function arrayOf(itemValidator: ValueValidator): ValueValidator {
  return (value, path, errors) => {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return false;
    }
    let valid = true;
    for (const [index, item] of value.entries()) {
      if (!itemValidator(item, `${path}[${index}]`, errors)) {
        valid = false;
      }
    }
    return valid;
  };
}

function objectWith<T extends object>(schema: FieldSchema<T>): ValueValidator {
  return (value, path, errors) => {
    if (!isRecord(value)) {
      errors.push(`${path} must be an object`);
      return false;
    }
    return validateFields(value, path, schema, errors);
  };
}

const STRING_ARRAY = arrayOf(stringValue);

const COUNT_SCHEMA = {
  nodes: numberValue,
  categories: numberValue,
  curated_relation_triples: numberValue,
  unique_relation_triples: numberValue,
  visual_directed_pairs: numberValue,
  internal_relation_triples: numberValue,
  cross_category_relation_triples: numberValue,
  paths: numberValue,
  raw_edge_records: numberValue,
} satisfies FieldSchema<KGOverview['counts']>;

const INTEGRITY_SCHEMA = {
  valid: booleanValue,
  uncategorized_node_ids: STRING_ARRAY,
  duplicate_node_ids: STRING_ARRAY,
  dangling_relation_keys: STRING_ARRAY,
  duplicate_relation_keys: STRING_ARRAY,
  invalid_path_ids: STRING_ARRAY,
} satisfies FieldSchema<KGOverview['integrity']>;

const ANCHOR_SCHEMA = {
  x: numberValue,
  y: numberValue,
} satisfies FieldSchema<KGOverview['categories'][number]['anchor']>;

const CATEGORY_SCHEMA = {
  id: stringValue,
  label_zh: stringValue,
  label_en: stringValue,
  description_zh: stringValue,
  description_en: stringValue,
  color: stringValue,
  surface_color: stringValue,
  anchor: objectWith(ANCHOR_SCHEMA),
  order: numberValue,
  node_count: numberValue,
  internal_relation_count: numberValue,
  outgoing_relation_count: numberValue,
  incoming_relation_count: numberValue,
} satisfies FieldSchema<KGOverview['categories'][number]>;

const NODE_SCHEMA = {
  node_id: stringValue,
  label: stringValue,
  node_type: stringValue,
  origin: stringValue,
  aliases: STRING_ARRAY,
  source_ids: STRING_ARRAY,
  source_chunk_ids: STRING_ARRAY,
  source_urls: STRING_ARRAY,
  evidence_summary: stringValue,
  confidence: nullableNumberValue,
  category_id: stringValue,
  unique_in_degree: numberValue,
  unique_out_degree: numberValue,
  unique_relation_degree: numberValue,
  path_ids: STRING_ARRAY,
} satisfies FieldSchema<KGOverview['nodes'][number]>;

const RELATION_SCHEMA = {
  key: stringValue,
  source: stringValue,
  type: stringValue,
  target: stringValue,
  source_category_id: stringValue,
  target_category_id: stringValue,
  is_cross_category: booleanValue,
  origins: STRING_ARRAY,
  source_ids: STRING_ARRAY,
  source_chunk_ids: STRING_ARRAY,
  source_urls: STRING_ARRAY,
  evidence_texts: STRING_ARRAY,
} satisfies FieldSchema<KGOverview['relations'][number]>;

const VISUAL_EDGE_SCHEMA = {
  key: stringValue,
  source: stringValue,
  target: stringValue,
  source_category_id: stringValue,
  target_category_id: stringValue,
  is_cross_category: booleanValue,
  relation_types: STRING_ARRAY,
  relation_count: numberValue,
  provenance_count: numberValue,
  origins: STRING_ARRAY,
  source_ids: STRING_ARRAY,
  source_chunk_ids: STRING_ARRAY,
  source_urls: STRING_ARRAY,
  evidence_texts: STRING_ARRAY,
} satisfies FieldSchema<KGOverview['visual_edges'][number]>;

const PATH_RELATION_SCHEMA = {
  from: stringValue,
  to: stringValue,
  type: stringValue,
  traversal: stringValue,
} satisfies FieldSchema<KGOverview['paths'][number]['relations'][number]>;

const PATH_SCHEMA = {
  path_id: stringValue,
  label: stringValue,
  topic: stringValue,
  path: STRING_ARRAY,
  upstream: STRING_ARRAY,
  focus: STRING_ARRAY,
  downstream: STRING_ARRAY,
  category_ids: STRING_ARRAY,
  crosses_category_boundary: booleanValue,
  focus_node_ids: STRING_ARRAY,
  hop_count: numberValue,
  relations: arrayOf(objectWith(PATH_RELATION_SCHEMA)),
  evidence_summary: stringValue,
  source_url: stringValue,
  source_urls: STRING_ARRAY,
  source_id: stringValue,
  evidence_chunk_ids: STRING_ARRAY,
} satisfies FieldSchema<KGOverview['paths'][number]>;

const OVERVIEW_SCHEMA = {
  version: stringValue,
  counts: objectWith(COUNT_SCHEMA),
  integrity: objectWith(INTEGRITY_SCHEMA),
  categories: arrayOf(objectWith(CATEGORY_SCHEMA)),
  nodes: arrayOf(objectWith(NODE_SCHEMA)),
  relations: arrayOf(objectWith(RELATION_SCHEMA)),
  visual_edges: arrayOf(objectWith(VISUAL_EDGE_SCHEMA)),
  paths: arrayOf(objectWith(PATH_SCHEMA)),
} satisfies FieldSchema<KGOverview>;
