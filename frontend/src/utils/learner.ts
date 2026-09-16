const learnerStorageKey = 'responsible-edu-agent-learner-id';

export function getOrCreateLearnerID(): string {
  if (typeof window === 'undefined') {
    return 'learner-local';
  }
  const existing = window.localStorage.getItem(learnerStorageKey);
  if (existing) {
    return existing;
  }
  const next = `learner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  window.localStorage.setItem(learnerStorageKey, next);
  return next;
}
