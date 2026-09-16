import { describe, expect, test } from 'vitest';

import type { KGOverview } from './types';
import {
  readTransientPathSnapshot,
  transientPathStorageKey,
  writeTransientPathSnapshot,
} from './transientPath';

const overview = {
  nodes: [
    { node_id: 'Concept:list' },
    { node_id: 'Concept:index' },
    { node_id: 'ErrorType:IndexError' },
  ],
  visual_edges: [
    { source: 'Concept:list', target: 'Concept:index' },
    { source: 'Concept:index', target: 'ErrorType:IndexError' },
  ],
} as KGOverview;

describe('transient KG path snapshots', () => {
  test('round-trips a versioned role view through the namespaced session key', () => {
    sessionStorage.clear();
    const roleView = {
      upstream: ['Concept:list'],
      current: ['Concept:index'],
      downstream: ['ErrorType:IndexError'],
      edges: [
        { from: 'Concept:list', to: 'Concept:index', relation: 'uses' },
        { from: 'Concept:index', to: 'ErrorType:IndexError', relation: 'causes' },
      ],
      focus_node_ids: ['Concept:index'],
    };

    expect(writeTransientPathSnapshot('turn / 7', roleView)).toBe(true);
    expect(sessionStorage.getItem(transientPathStorageKey('turn / 7'))).toContain('"version":1');
    expect(readTransientPathSnapshot('turn / 7', overview)).toEqual(roleView);
  });

  test('rejects mismatched, malformed, unknown-node, and non-current-focus snapshots', () => {
    sessionStorage.clear();
    const key = transientPathStorageKey('turn-invalid');
    for (const payload of [
      '{',
      JSON.stringify({ version: 1, path_id: 'other-turn' }),
      JSON.stringify({
        version: 1,
        path_id: 'turn-invalid',
        role_view: {
          upstream: [],
          current: ['Concept:missing'],
          downstream: [],
          edges: [],
          focus_node_ids: ['Concept:missing'],
        },
      }),
      JSON.stringify({
        version: 1,
        path_id: 'turn-invalid',
        role_view: {
          upstream: ['Concept:list'],
          current: ['Concept:index'],
          downstream: [],
          edges: [],
          focus_node_ids: ['Concept:list'],
        },
      }),
    ]) {
      sessionStorage.setItem(key, payload);
      expect(readTransientPathSnapshot('turn-invalid', overview)).toBeUndefined();
    }
  });

  test('rejects an unsupported traversal value instead of accepting malformed path semantics', () => {
    sessionStorage.clear();
    const key = transientPathStorageKey('turn-invalid-traversal');
    sessionStorage.setItem(key, JSON.stringify({
      version: 1,
      path_id: 'turn-invalid-traversal',
      role_view: {
        upstream: ['Concept:index'],
        current: ['Concept:list'],
        downstream: [],
        edges: [{
          from: 'Concept:list',
          to: 'Concept:index',
          traversal: 'sideways',
        }],
        focus_node_ids: ['Concept:list'],
      },
    }));

    expect(readTransientPathSnapshot('turn-invalid-traversal', overview)).toBeUndefined();
  });

  test('fails closed when sessionStorage access throws', () => {
    const throwingStorage = {
      getItem: () => { throw new DOMException('blocked'); },
      setItem: () => { throw new DOMException('blocked'); },
    } as unknown as Storage;
    const roleView = {
      upstream: ['Concept:list'],
      current: ['Concept:index'],
      downstream: [],
      edges: [{ from: 'Concept:list', to: 'Concept:index' }],
      focus_node_ids: ['Concept:index'],
    };

    expect(writeTransientPathSnapshot('turn-blocked', roleView, throwingStorage)).toBe(false);
    expect(readTransientPathSnapshot('turn-blocked', overview, throwingStorage)).toBeUndefined();
  });
});
