import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { getSupabase } from '@/lib/supabase'

const topicRow = z.object({
  id: z.string(),
  name: z.string(),
  category_id: z.string(),
  categories: z.object({ name: z.string() }).nullable(),
})
export type TopicOption = { id: string; name: string; category: string }

/** Active topics for pickers. Row level security returns active rows to every signed-in person. */
export function useTopics() {
  return useQuery({
    queryKey: ['topics'],
    queryFn: async (): Promise<TopicOption[]> => {
      const { data, error } = await getSupabase()
        .from('topics')
        .select('id, name, category_id, categories(name)')
        .is('deleted_at', null)
        .order('sort_order')
      if (error) throw error
      return z
        .array(topicRow)
        .parse(data)
        .map((t) => ({ id: t.id, name: t.name, category: t.categories?.name ?? 'Other' }))
    },
    staleTime: 5 * 60_000,
  })
}

