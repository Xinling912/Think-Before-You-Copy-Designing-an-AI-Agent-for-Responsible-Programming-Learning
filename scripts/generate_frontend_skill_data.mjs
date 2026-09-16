import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const inventoryPath = resolve(root, 'docs/education-agent-skills-inventory.md');
const outputPath = resolve(root, 'frontend/src/data/skills.ts');

const markdown = readFileSync(inventoryPath, 'utf8');
const rows = [];

for (const line of markdown.split(/\r?\n/)) {
  const match = line.match(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
  if (!match || match[4].trim() === '状态') {
    continue;
  }

  const [, order, domain, skill, status, descriptionZh] = match;
  rows.push({
    order: Number(order),
    domain,
    skill,
    id: `${domain}/${skill}`,
    status: status.trim(),
    descriptionZh: descriptionZh.trim(),
    mvp: status.includes('MVP'),
  });
}

if (rows.length !== 165) {
  throw new Error(`Expected 165 skills, got ${rows.length}`);
}

rows.sort((left, right) => Number(right.mvp) - Number(left.mvp) || left.order - right.order);

const content = `export type SkillRow = {
  order: number;
  domain: string;
  skill: string;
  id: string;
  status: string;
  descriptionZh: string;
  mvp: boolean;
};

export const skillRows: SkillRow[] = ${JSON.stringify(rows, null, 2)};
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, content);
