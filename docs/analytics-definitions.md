# Metric definitions

Every number shown in the product is computed from database rows by `admin_overview_stats()` (or an RLS-filtered query for students). Nothing is cached, estimated or hard-coded.

| Metric | Exact definition |
|---|---|
| Registered users | `count(*)` of `profiles` (one per account; deleting an account removes its profile) |
| Published challenges | `status = 'PUBLISHED'` and `deleted_at is null` (does not check the schedule window) |
| Challenges in preparation | status in `DRAFT, GENERATING, GENERATION_FAILED, REVIEW_REQUIRED, VALIDATED, REJECTED`, not deleted |
| Completed attempts | `count(*)` of attempts with `status = 'SUBMITTED'`, **including repeat attempts by the same person** and anonymised attempts of deleted accounts |
| Unique participants | `count(distinct user_id)` over submitted attempts; anonymised attempts are not counted |
| Open reports | `feedback_reports.status = 'OPEN'` |
| Student: Open challenges | challenges the person can read right now: published, not deleted, within start/end time |
| Student: Attempts completed | the person's own submitted attempts (RLS-restricted) |

"Total attempts" and "participants" are never merged or relabelled.

## Phase 2: challenge analytics

Computed by `admin_challenge_analytics` for one challenge (administrators only). Counts use finalised
attempts unless stated otherwise.

| Figure | Definition |
| --- | --- |
| Registered | People who joined the challenge. |
| Started attempts | All attempts, including unfinished or expired ones. |
| Started (people) | Distinct people with at least one attempt. |
| Participation rate | Started (people) ÷ registered. Blank when nobody has joined. |
| Completed attempts | Attempts finalised either by the student or by the server (time out or completion). |
| Completion rate | Completed attempts ÷ started attempts. |
| Average score | Mean of finalised scores, in marks. |
| Average percentage | Mean of (score ÷ maximum score × 100) across finalised attempts. |
| Score distribution | Finalised attempts grouped by percentage into 0–19, 20–39, 40–59, 60–79, 80–100. Scores below zero (negative marking) fall in the 0–19 band. |
| Correct rate (per question) | Correct answers ÷ finalised attempts that included the question. Unanswered counts as not correct. |
| Discrimination (per question) | Correct rate among the higher-scoring half of attempts minus the correct rate among the lower-scoring half. Halves are split by score, then submission time. |
| Too easy | At least 10 attempts and a correct rate of 90% or more. |
| Too difficult | At least 10 attempts and a correct rate of 20% or less. |
| Possibly ambiguous | At least 20 attempts and a discrimination of zero or below, with no "too easy" flag. Means stronger students were no more likely to get it right. |
| Topic accuracy | Correct answers ÷ answers given to questions in the topic, across finalised attempts. |

These flags prompt review. They are not verdicts about a question, and small samples produce no flags at all.
