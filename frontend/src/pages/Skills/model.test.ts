import { buildSkillRows } from './model';

test('places the MVP learning skills first', () => {
  const rows = buildSkillRows();

  expect(rows.slice(0, 5).map((row) => row.id)).toEqual([
    'student-learning/retrieve-first-gate',
    'student-learning/progressive-hint-ladder',
    'student-learning/stuck-and-error-diagnosis-coach',
    'student-learning/confidence-calibration-check',
    'student-learning/teach-back-evaluator',
  ]);
  expect(rows.slice(0, 5).every((row) => row.mvp)).toBe(true);
});
