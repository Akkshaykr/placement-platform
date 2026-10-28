import { expect } from 'vitest'

/** The statement must be rejected because the role lacks a grant. */
export async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow(/permission denied/i)
}

/** The statement must be rejected by a row level security policy. */
export async function expectRlsViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow(/row-level security/i)
}

export const TABLES = [
  'audit_logs', 'app_settings', 'profiles', 'user_roles', 'categories', 'topics',
  'ai_generation_jobs', 'challenges', 'challenge_versions', 'questions', 'question_versions',
  'question_options', 'question_answer_keys', 'challenge_version_questions',
  'question_validation_results', 'challenge_attempts', 'attempt_answers', 'attempt_scores',
  'bookmarks', 'feedback_reports',
  // Phase 2
  'challenge_registrations', 'attempt_questions',
] as const
