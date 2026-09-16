import { describe, expect, test } from 'vitest';

import {
  categoryDescription,
  categoryLabel,
  englishKnowledgeOverview,
  englishVisibleText,
  visibleEnglishValues,
} from './language';
import type { KGCategory, KGOverview } from './types';

const category: KGCategory = {
  id: 'collections-and-access',
  label_zh: '集合与访问域',
  label_en: 'Collections and Access',
  description_zh: '学习列表、元组和字典访问。',
  description_en: 'Learn list, tuple, and dictionary access.',
  color: '#7C8A9E',
  surface_color: '#EEF2F7',
  anchor: { x: 0.5, y: 0.5 },
  order: 1,
  node_count: 3,
  internal_relation_count: 2,
  outgoing_relation_count: 1,
  incoming_relation_count: 1,
};

describe('Knowledge World language helpers', () => {
  test('selects English category content only for the English surface', () => {
    expect(categoryLabel(category, 'en')).toBe('Collections and Access');
    expect(categoryDescription(category, 'en')).toBe('Learn list, tuple, and dictionary access.');
    expect(categoryLabel(category, 'current')).toBe('集合与访问域');
    expect(categoryDescription(category, 'current')).toBe('学习列表、元组和字典访问。');
  });

  test('filters Han-script aliases from English-visible values', () => {
    expect(visibleEnglishValues(['list', '列表', ' sequence ', '', '索引'])).toEqual([
      'list',
      'sequence',
    ]);
  });

  test('uses an English fallback for Han-script evidence', () => {
    expect(englishVisibleText('列表是有序集合。', 'English summary unavailable.')).toBe(
      'English summary unavailable.',
    );
    expect(englishVisibleText('Lists are ordered collections.', 'English summary unavailable.')).toBe(
      'Lists are ordered collections.',
    );
  });

  test('creates a complete English-safe presentation without mutating graph identity', () => {
    const overview = {
      categories: [category],
      nodes: [{
        node_id: 'Concept:list',
        label: '列表',
        aliases: ['list', '列表'],
        source_urls: ['https://example.test/list', 'https://example.test/列表'],
        evidence_summary: '列表是有序集合。',
      }],
      relations: [{ key: 'a', evidence_texts: ['Lists use indexes.', '列表使用索引。'] }],
      visual_edges: [{ key: 'a', evidence_texts: ['列表使用索引。'] }],
      paths: [{ path_id: 'path-list' }],
    } as KGOverview;

    const result = englishKnowledgeOverview(overview);

    expect(result.categories[0]).toEqual(expect.objectContaining({
      id: 'collections-and-access',
      label_zh: 'Collections and Access',
      description_zh: 'Learn list, tuple, and dictionary access.',
    }));
    expect(result.nodes[0]).toEqual(expect.objectContaining({
      node_id: 'Concept:list',
      label: 'Concept:list',
      aliases: ['list'],
      source_urls: ['https://example.test/list'],
      evidence_summary: 'English summary unavailable.',
    }));
    expect(result.relations).toHaveLength(1);
    expect(result.paths).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/[\u3400-\u9fff]/u);
    expect(overview.categories[0].label_zh).toBe('集合与访问域');
  });
});
