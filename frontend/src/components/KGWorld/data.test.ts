import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { KGOverview } from './types';
import {
  buildBoundaryPorts,
  parseKGLocation,
  projectCategoryGraph,
  projectWorldGraph,
  resolveNodeRoles,
  searchNodes,
  validateOverview,
} from './data';

const loadRepositoryOverview = (): KGOverview => {
  const aiCoreDirectory = resolve(process.cwd(), '../services/ai-core-python');
  const output = execFileSync(
    process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' ? 'python' : 'python3'),
    [
      '-c',
      'import json; from app.kg import build_kg_overview; print(json.dumps(build_kg_overview()))',
    ],
    { cwd: aiCoreDirectory, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(output) as KGOverview;
};

const cloneOverview = (overview: KGOverview): KGOverview => structuredClone(overview);

describe('KG overview data adapter', () => {
  const fixture = loadRepositoryOverview();

  test('accepts the deterministic repository overview contract', () => {
    expect(fixture.counts).toEqual({
      nodes: 83,
      categories: 6,
      curated_relation_triples: 364,
      unique_relation_triples: 367,
      visual_directed_pairs: 197,
      internal_relation_triples: 312,
      cross_category_relation_triples: 55,
      paths: 160,
      raw_edge_records: 3500,
    });
    expect(validateOverview(fixture)).toEqual({ valid: true, errors: [] });
  });

  test('rejects an invalid backend integrity report', () => {
    const invalid = cloneOverview(fixture);
    invalid.integrity.valid = false;
    invalid.integrity.duplicate_node_ids = ['Concept:list'];

    const result = validateOverview(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Concept:list');
  });

  test.each([
    ['nodes', 'nodes'],
    ['categories', 'categories'],
    ['unique_relation_triples', 'relations'],
    ['visual_directed_pairs', 'visual_edges'],
    ['paths', 'paths'],
  ] as const)('rejects %s count and %s array mismatches', (countKey, arrayKey) => {
    const invalid = cloneOverview(fixture);
    invalid.counts[countKey] += 1;

    const result = validateOverview(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain(countKey);
    expect(invalid[arrayKey]).toHaveLength(fixture[arrayKey].length);
  });

  test('rejects nodes and edges that refer to unknown categories', () => {
    const invalid = cloneOverview(fixture);
    invalid.nodes[0].category_id = 'unknown-category';
    invalid.visual_edges[0].source_category_id = 'unknown-category';

    const result = validateOverview(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('unknown-category');
  });

  test('rejects dangling relation and visual edge endpoints', () => {
    const invalid = cloneOverview(fixture);
    invalid.relations[0].target = 'Concept:missing';
    invalid.visual_edges[0].source = 'Concept:also_missing';

    const result = validateOverview(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Concept:missing');
    expect(result.errors.join(' ')).toContain('Concept:also_missing');
  });

  test('rejects paths that refer to missing nodes', () => {
    const invalid = cloneOverview(fixture);
    invalid.paths[0].path.push('Concept:missing');

    const result = validateOverview(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain(invalid.paths[0].path_id);
    expect(result.errors.join(' ')).toContain('Concept:missing');
  });

  test.each([
    [
      'a missing version',
      (overview: KGOverview): unknown => {
        const { version: _version, ...withoutVersion } = overview;
        return withoutVersion;
      },
      'version must be a string',
    ],
    [
      'a null category',
      (overview: KGOverview): unknown => ({
        ...overview,
        categories: [null, ...overview.categories.slice(1)],
      }),
      'categories[0] must be an object',
    ],
    [
      'a malformed category anchor',
      (overview: KGOverview): unknown => ({
        ...overview,
        categories: overview.categories.map((category, index) =>
          index === 0 ? { ...category, anchor: null } : category,
        ),
      }),
      'categories[0].anchor must be an object',
    ],
    [
      'a malformed nested relation field',
      (overview: KGOverview): unknown => ({
        ...overview,
        relations: overview.relations.map((relation, index) =>
          index === 0 ? { ...relation, origins: [null] } : relation,
        ),
      }),
      'relations[0].origins[0] must be a string',
    ],
    [
      'a malformed nested path relation',
      (overview: KGOverview): unknown => ({
        ...overview,
        paths: overview.paths.map((path, index) =>
          index === 0 ? { ...path, relations: [null] } : path,
        ),
      }),
      'paths[0].relations[0] must be an object',
    ],
  ] as const)('rejects %s without throwing', (_label, mutate, expectedError) => {
    const invalid = mutate(fixture);

    expect(() => validateOverview(invalid)).not.toThrow();
    const result = validateOverview(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expectedError);
  });

  test.each([
    ['relation', 'relations'],
    ['visual edge', 'visual_edges'],
  ] as const)('rejects a %s whose cross-category flag disagrees with its categories', (kind, field) => {
    const invalid = cloneOverview(fixture);
    const edge = invalid[field].find(
      (candidate) => candidate.source_category_id !== candidate.target_category_id,
    );
    expect(edge).toBeDefined();
    if (!edge) return;
    edge.is_cross_category = false;

    const result = validateOverview(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain(
      `${kind} ${edge.key} is_cross_category is false; computed value is true`,
    );
  });

  test('projects the complete world graph', () => {
    const graph = projectWorldGraph(fixture);

    expect(graph.nodes).toHaveLength(83);
    expect(graph.edges).toHaveLength(197);
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(83);
    expect(graph.nodes[0].data.node_id).toBe(graph.nodes[0].id);
    expect(graph.edges[0]).toMatchObject({
      id: fixture.visual_edges[0].key,
      source: fixture.visual_edges[0].source,
      target: fixture.visual_edges[0].target,
    });
  });

  test('projects only category nodes, internal visual edges, and boundary ports', () => {
    const graph = projectCategoryGraph(fixture, 'collections-and-access');

    expect(graph.nodes).toHaveLength(16);
    expect(graph.edges).toHaveLength(39);
    expect(graph.nodes.every((node) => node.data.category_id === 'collections-and-access')).toBe(true);
    expect(graph.edges.every((edge) => edge.data.is_cross_category === false)).toBe(true);
    expect(graph.ports).toEqual(buildBoundaryPorts(fixture, 'collections-and-access'));
  });

  test('uses current, upstream, downstream role precedence', () => {
    const roles = resolveNodeRoles({
      upstream: ['Concept:list', 'Concept:tuple'],
      current: ['Concept:list'],
      downstream: ['Concept:list', 'Concept:tuple', 'Concept:dict'],
    });

    expect(roles.get('Concept:list')).toBe('current');
    expect(roles.get('Concept:tuple')).toBe('upstream');
    expect(roles.get('Concept:dict')).toBe('downstream');
  });

  test('groups non-empty boundary ports by external category and direction', () => {
    const ports = buildBoundaryPorts(fixture, 'collections-and-access');
    const keys = ports.map((port) => `${port.externalCategoryID}|${port.direction}`);

    expect(ports.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(ports.length);
    expect(ports.every((port) => port.externalNodeIDs.length > 0)).toBe(true);
    expect(ports.every((port) => port.relationCount === port.relationKeys.length)).toBe(true);
    expect(ports.some((port) => port.direction === 'incoming')).toBe(true);
    expect(ports.some((port) => port.direction === 'outgoing')).toBe(true);
  });

  test('projects every cross-category relation through exactly one incoming and one outgoing port', () => {
    const crossCategoryRelations = fixture.relations.filter(
      (relation) => relation.is_cross_category,
    );
    const relationByKey = new Map(
      crossCategoryRelations.map((relation) => [relation.key, relation]),
    );
    const expectedRelationKeys = crossCategoryRelations
      .map((relation) => relation.key)
      .sort();
    const incomingRelationKeys: string[] = [];
    const outgoingRelationKeys: string[] = [];

    expect(fixture.categories).toHaveLength(6);
    expect(crossCategoryRelations).toHaveLength(55);
    expect(new Set(expectedRelationKeys).size).toBe(expectedRelationKeys.length);

    for (const category of fixture.categories) {
      const graph = projectCategoryGraph(fixture, category.id);
      const ports = graph.ports;
      const portKeys = ports.map(
        (port) => `${port.externalCategoryID}|${port.direction}`,
      );

      expect(graph.nodes.every((node) => node.data.category_id === category.id)).toBe(
        true,
      );
      expect(new Set(portKeys).size).toBe(ports.length);

      for (const port of ports) {
        const expectedPortRelations = crossCategoryRelations.filter((relation) =>
          port.direction === 'incoming'
            ? relation.source_category_id === port.externalCategoryID &&
              relation.target_category_id === category.id
            : relation.source_category_id === category.id &&
              relation.target_category_id === port.externalCategoryID,
        );
        const expectedPortRelationKeys = expectedPortRelations
          .map((relation) => relation.key)
          .sort();
        const expectedInsideNodeIDs = [
          ...new Set(
            expectedPortRelations.map((relation) =>
              port.direction === 'incoming' ? relation.target : relation.source,
            ),
          ),
        ].sort();
        const expectedExternalNodeIDs = [
          ...new Set(
            expectedPortRelations.map((relation) =>
              port.direction === 'incoming' ? relation.source : relation.target,
            ),
          ),
        ].sort();

        expect(port.categoryID).toBe(category.id);
        expect(port.externalCategoryID).not.toBe(category.id);
        expect(port.relationKeys).toEqual(expectedPortRelationKeys);
        expect(port.relationCount).toBe(expectedPortRelationKeys.length);
        expect(port.insideNodeIDs).toEqual(expectedInsideNodeIDs);
        expect(port.externalNodeIDs).toEqual(expectedExternalNodeIDs);

        if (port.direction === 'incoming') {
          incomingRelationKeys.push(...port.relationKeys);
        } else {
          outgoingRelationKeys.push(...port.relationKeys);
        }

        for (const relationKey of port.relationKeys) {
          const relation = relationByKey.get(relationKey);

          expect(relation).toBeDefined();
          if (!relation) continue;

          expect(relation.is_cross_category).toBe(true);
          if (port.direction === 'incoming') {
            expect(relation.source_category_id).toBe(port.externalCategoryID);
            expect(relation.target_category_id).toBe(category.id);
            expect(port.externalNodeIDs).toContain(relation.source);
            expect(port.insideNodeIDs).toContain(relation.target);
          } else {
            expect(relation.source_category_id).toBe(category.id);
            expect(relation.target_category_id).toBe(port.externalCategoryID);
            expect(port.insideNodeIDs).toContain(relation.source);
            expect(port.externalNodeIDs).toContain(relation.target);
          }
        }
      }
    }

    expect(incomingRelationKeys.sort()).toEqual(expectedRelationKeys);
    expect(outgoingRelationKeys.sort()).toEqual(expectedRelationKeys);
    expect(new Set(incomingRelationKeys).size).toBe(55);
    expect(new Set(outgoingRelationKeys).size).toBe(55);
    expect(new Set([...incomingRelationKeys, ...outgoingRelationKeys])).toEqual(
      new Set(expectedRelationKeys),
    );
  });

  test('searches IDs, labels, and aliases case-insensitively', () => {
    const byID = searchNodes(fixture, 'CONCEPT:LIST');
    const alias = fixture.nodes.find((node) => node.node_id === 'Concept:list')?.aliases[0] ?? 'list';

    expect(byID[0]?.node_id).toBe('Concept:list');
    expect(searchNodes(fixture, alias.toUpperCase()).some((node) => node.node_id === 'Concept:list')).toBe(
      true,
    );
    expect(searchNodes(fixture, '')).toEqual([]);
  });

  test('parses category, focus, and path deep-link parameters', () => {
    expect(parseKGLocation('?focus=Concept%3Alist&category=collections-and-access')).toEqual({
      categoryID: 'collections-and-access',
      focusNodeID: 'Concept:list',
      pathID: '',
    });
    expect(parseKGLocation('?path=path-1')).toEqual({
      categoryID: '',
      focusNodeID: '',
      pathID: 'path-1',
    });
  });
});
