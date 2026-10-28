import type { TopicOption } from './useTopics'

/** Grouped <option>s for a topic <select>. */
export function TopicOptions({ topics }: { topics: TopicOption[] }) {
  const groups = [...new Set(topics.map((t) => t.category))]
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {topics.filter((t) => t.category === g).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}
