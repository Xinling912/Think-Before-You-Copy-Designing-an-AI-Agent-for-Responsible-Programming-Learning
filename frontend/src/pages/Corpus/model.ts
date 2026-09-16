export type CorpusSummary = {
  version: string;
  chunk_count: number;
  source_count?: number;
  sources?: Array<{
    source: string;
    count: number;
  }>;
  glossary_term_count: number;
  noise_chunk_count: number;
  overlong_chunk_count: number;
  code_chunk_count: number;
};

export type CorpusChunk = {
  source_id?: string;
  chunk_id: string;
  doc_id: string;
  section_id: string;
  section_index?: number;
  chunk_index?: number;
  chunk_total?: number;
  title: string;
  heading_path: string[];
  source_url: string;
  text: string;
  char_count: number;
  code_block_count: number;
  quality_flags: string[];
  version?: string;
  source?: string;
  license?: string;
  source_license_note?: string;
};

export type CorpusFilter = {
  query: string;
  source: string;
  docId: string;
  hasCode: boolean;
  qualityFlag: string;
  outlinePath: string[];
};

export type SummaryStat = {
  label: string;
  value: string;
};

export type CorpusSourceOption = {
  name: string;
  count: number;
  codeCount: number;
};

export type CorpusOutlineNode = {
  title: string;
  key: string;
  path: string[];
  children: CorpusOutlineNode[];
};

export function formatSummaryStats(summary: CorpusSummary): SummaryStat[] {
  return [
    { label: 'Version', value: summary.version || 'mixed sources' },
    { label: 'Sources', value: String(summary.source_count ?? summary.sources?.length ?? 0) },
    { label: 'Chunks', value: String(summary.chunk_count) },
    { label: 'Code chunks', value: String(summary.code_chunk_count) },
    { label: 'Glossary terms', value: String(summary.glossary_term_count) },
  ];
}

export function buildSourceOptions(chunks: CorpusChunk[], summary?: CorpusSummary | null): CorpusSourceOption[] {
  const sourceOrder = [
    'Python official documentation',
    'Think Python',
    'Python for Everybody',
    'Runoob Python3',
  ];
  const summarySources = summary?.sources ?? [];
  const summarySourceNames = new Set(summarySources.map((item) => item.source));
  const byName = new Map<string, CorpusSourceOption>();

  for (const item of summarySources) {
    byName.set(item.source, { name: item.source, count: item.count, codeCount: 0 });
  }

  for (const chunk of chunks) {
    const name = chunk.source || chunk.source_id || 'Unknown source';
    const current = byName.get(name) ?? { name, count: 0, codeCount: 0 };
    if (!summarySourceNames.has(name)) {
      current.count += 1;
    }
    if (chunk.code_block_count > 0) {
      current.codeCount += 1;
    }
    byName.set(name, current);
  }

  return Array.from(byName.values()).sort((a, b) => {
    const left = sourceOrder.indexOf(a.name);
    const right = sourceOrder.indexOf(b.name);
    if (left !== -1 || right !== -1) {
      return (left === -1 ? Number.MAX_SAFE_INTEGER : left) - (right === -1 ? Number.MAX_SAFE_INTEGER : right);
    }
    return a.name.localeCompare(b.name);
  });
}

export function filterChunks(chunks: CorpusChunk[], filter: CorpusFilter): CorpusChunk[] {
  const query = filter.query.trim().toLowerCase();
  return chunks.filter((chunk) => {
    const source = chunk.source || chunk.source_id || '';
    if (filter.source && source !== filter.source) {
      return false;
    }
    if (filter.outlinePath.length > 0 && !pathStartsWith(chunk.heading_path, filter.outlinePath)) {
      return false;
    }
    if (filter.docId && chunk.doc_id !== filter.docId) {
      return false;
    }
    if (filter.hasCode && chunk.code_block_count === 0) {
      return false;
    }
    if (filter.qualityFlag && !chunk.quality_flags.includes(filter.qualityFlag)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      chunk.chunk_id,
      chunk.doc_id,
      chunk.title,
      chunk.source || '',
      chunk.source_id || '',
      chunk.license || '',
      chunk.source_url,
      chunk.text,
      ...chunk.heading_path,
      ...chunk.quality_flags,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function buildCorpusOutline(chunks: CorpusChunk[]): CorpusOutlineNode[] {
  const roots: CorpusOutlineNode[] = [];
  const byKey = new Map<string, CorpusOutlineNode>();

  for (const chunk of chunks) {
    for (let index = 0; index < chunk.heading_path.length; index += 1) {
      const path = chunk.heading_path.slice(0, index + 1);
      const key = path.join('\u001f');
      if (byKey.has(key)) {
        continue;
      }

      const node: CorpusOutlineNode = {
        title: chunk.heading_path[index],
        key,
        path,
        children: [],
      };
      byKey.set(key, node);

      if (index === 0) {
        roots.push(node);
      } else {
        const parentKey = path.slice(0, -1).join('\u001f');
        byKey.get(parentKey)?.children.push(node);
      }
    }
  }

  return roots;
}

export function pathStartsWith(path: string[], prefix: string[]): boolean {
  if (prefix.length > path.length) {
    return false;
  }
  return prefix.every((part, index) => path[index] === part);
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function highlightLearningTerms(text: string): string {
  return text.replace(/\b(IndexError|list|zero-based index|index)\b/gi, '<mark>$1</mark>');
}
