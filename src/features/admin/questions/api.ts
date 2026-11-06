import { z } from 'zod'
import { getSupabase } from '@/lib/supabase'
import { toAppError } from '@/features/assessment/errors'
import {
  aiStatusSchema,
  questionDetailSchema,
  questionRowSchema,
  type QuestionDetail,
  type QuestionRow,
} from '@/features/admin/adminSchemas'
import { cleanFilters } from '@/features/admin/challenges/api'

async function call<T extends z.ZodType>(name: string, args: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  const { data, error } = await getSupabase().rpc(name, args)
  if (error) throw toAppError(error)
  return schema.parse(data)
}

export interface QuestionFilters {
  q?: string
  topic_id?: string
  difficulty?: string
  review_status?: string
  origin?: string
}

export const listQuestions = (filters: QuestionFilters) =>
  call('admin_list_questions', { p_filters: cleanFilters(filters) }, z.array(questionRowSchema))

export const getQuestion = (id: string) => call('admin_get_question', { p_question_id: id }, questionDetailSchema)

export interface QuestionInput {
  stem: string
  subtopic: string
  topic_id: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  estimated_seconds: number
  options: string[]
  correct_position: number
  explanation: string
}

export const saveQuestion = (id: string | null, data: QuestionInput) =>
  call(
    'admin_save_question',
    { p_question_id: id, p_data: { ...data, origin: 'MANUAL' } },
    z.object({ question_id: z.string(), question_version_id: z.string(), review_status: z.string() }),
  )

export const approveQuestion = (questionVersionId: string) =>
  call('admin_approve_question', { p_question_version_id: questionVersionId, p_confirm: true }, z.unknown())

export interface TranslationInput {
  stem: string
  subtopic: string
  explanation: string
  options: string[]
}

export const saveTranslation = (questionVersionId: string, data: TranslationInput) =>
  call(
    'admin_save_translation',
    { p_question_version_id: questionVersionId, p_language: 'ta', p_data: { ...data, source: 'HUMAN' } },
    z.object({ status: z.string() }),
  )

export const approveTranslation = (questionVersionId: string, approve: boolean) =>
  call(
    'admin_approve_translation',
    { p_question_version_id: questionVersionId, p_language: 'ta', p_approve: approve },
    z.object({ status: z.string() }),
  )

const translatedQuestionSchema = z.object({
  stem: z.string(),
  subtopic: z.string(),
  explanation: z.string(),
  options: z.array(z.string()),
})

const translationResultSchema = z.object({
  status: z.string(),
  source: z.literal('AI_DRAFT'),
  model: z.string(),
  translation: translatedQuestionSchema,
})

/** Calls the server-side Tamil translator. The Gemini key never reaches the browser. */
export async function translateQuestion(
  questionVersionId: string,
  data: TranslationInput,
): Promise<z.infer<typeof translationResultSchema>> {
  const { data: result, error } = await getSupabase().functions.invoke('translate-question', {
    body: {
      question_version_id: questionVersionId,
      ...data,
    },
  })

  if (error) {
    let message = 'Tamil translation is unavailable right now. Try again later.'
    let code: string | undefined

    try {
      const context = (error as { context?: Response }).context
      if (context && typeof context.json === 'function') {
        const json = (await context.json()) as { code?: string; message?: string }
        code = json.code
        if (json.message) message = json.message
      }
    } catch {
      // Keep the fallback message.
    }

    throw Object.assign(new Error(message), { code })
  }

  return translationResultSchema.parse(result)
}

export const deleteQuestion = (id: string) => call('admin_delete_question', { p_question_id: id }, z.unknown())

export const aiStatus = () => call('admin_ai_status', {}, aiStatusSchema)

export interface GenerateResult {
  job_id: string
  produced: number
  question_ids: string[]
  warnings: string[]
}

/** Calls the server-side generator. The model key never leaves the server. */
export async function generateQuestions(body: Record<string, unknown>): Promise<GenerateResult> {
  const { data, error } = await getSupabase().functions.invoke('generate-questions', { body })

  if (error) {
    let message = 'The generator is unavailable right now. Try again later.'
    let code: string | undefined

    try {
      const context = (error as { context?: Response }).context
      if (context && typeof context.json === 'function') {
        const json = (await context.json()) as { code?: string; message?: string }
        code = json.code
        if (json.message) message = json.message
      }
    } catch {
      // Keep the generic message.
    }

    throw Object.assign(new Error(message), { code })
  }

  return z
    .object({
      job_id: z.string(),
      produced: z.number(),
      question_ids: z.array(z.string()),
      warnings: z.array(z.string()).default([]),
    })
    .parse(data)
}

export type { QuestionDetail, QuestionRow }
