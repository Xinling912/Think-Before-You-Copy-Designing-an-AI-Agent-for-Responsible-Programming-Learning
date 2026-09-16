import type { KGCategory, KGOverview } from './types';

export type KGWorldLanguage = 'current' | 'en';

const HAN_SCRIPT = /[\u3400-\u9fff]/u;

export function categoryLabel(category: KGCategory, language: KGWorldLanguage): string {
  return language === 'en' ? category.label_en : category.label_zh;
}

export function categoryDescription(category: KGCategory, language: KGWorldLanguage): string {
  return language === 'en' ? category.description_en : category.description_zh;
}

export function visibleEnglishValues(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value && !HAN_SCRIPT.test(value));
}

export function englishVisibleText(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim();
  return normalized && !HAN_SCRIPT.test(normalized) ? normalized : fallback;
}

export function englishKnowledgeOverview(overview: KGOverview): KGOverview {
  return {
    ...overview,
    categories: overview.categories.map((category) => {
      const label = englishVisibleText(category.label_en, category.id);
      const description = englishVisibleText(
        category.description_en,
        'English description unavailable.',
      );
      return {
        ...category,
        label_zh: label,
        label_en: label,
        description_zh: description,
        description_en: description,
      };
    }),
    nodes: overview.nodes.map((node) => ({
      ...node,
      label: englishVisibleText(node.label, node.node_id),
      aliases: visibleEnglishValues(node.aliases),
      source_urls: visibleEnglishValues(node.source_urls),
      evidence_summary: englishVisibleText(
        node.evidence_summary,
        'English summary unavailable.',
      ),
    })),
    relations: overview.relations.map((relation) => ({
      ...relation,
      evidence_texts: visibleEnglishValues(relation.evidence_texts),
    })),
    visual_edges: overview.visual_edges.map((edge) => ({
      ...edge,
      evidence_texts: visibleEnglishValues(edge.evidence_texts),
    })),
    paths: overview.paths.map((path) => ({
      ...path,
      label: englishVisibleText(path.label, path.path_id),
      topic: englishVisibleText(path.topic, path.path_id),
      evidence_summary: englishVisibleText(
        path.evidence_summary,
        'English summary unavailable.',
      ),
    })),
  };
}
