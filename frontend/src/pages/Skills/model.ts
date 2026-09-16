import { skillRows, type SkillRow } from '../../data/skills';

export type { SkillRow };

export function buildSkillRows(): SkillRow[] {
  return [...skillRows].sort((left, right) => {
    if (left.mvp !== right.mvp) {
      return left.mvp ? -1 : 1;
    }
    return left.order - right.order;
  });
}
