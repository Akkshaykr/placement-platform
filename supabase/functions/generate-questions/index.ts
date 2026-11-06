// generate-questions: server-side AI drafting for aptitude questions (Phase 2).
//
// Security model
//   - The caller's JWT is forwarded. Every database call runs AS THE CALLER, so the database (not this
//     code) decides whether they are an administrator, whether AI is enabled, and their daily quota.
//   - The model key (GEMINI_API_KEY) exists only in the function's secrets. It is never returned.
//   - Model output is untrusted. It is validated with the shared Zod schema before anything is stored.
//   - Stored questions are DRAFTS. A second model pass checks them without the answer key; its result is a
//     warning only. Publication still needs an administrator's approval.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  buildGenerationPrompt,
  buildSolverPrompt,
  generatedBatchSchema,
  generationRequestSchema,
  geminiGenerationResponseSchema,
  geminiSolverResponseSchema,
  solverAnswersSchema,
  type GeneratedQuestion,
} from '../_shared/questionSchema.ts'

// Models are tried in order. Override with the GEMINI_MODELS secret (comma-separated).
const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
// Each attempt gets its own time limit, so a slow model fails fast and the next one is tried.
const ATTEMPT_TIMEOUT_MS = 25_000
const MAX_ATTEMPTS_PER_MODEL = 2

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

function allowedOrigins(): string[] {
  const configured = (Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...configured, ...DEV_ORIGINS]
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allowed = allowedOrigins().includes(origin) ? origin : allowedOrigins()[0]!
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/** Converts a database error ("CODE: message") into an HTTP status and a safe message. */
function fromDb(message: string): { status: number; code: string; message: string } {
  const m = /^([A-Z_]+):\s*(.+)$/s.exec(message)
  if (!m) return { status: 500, code: 'UNKNOWN', message: 'Something went wrong. Please try again.' }
  const map: Record<string, number> = {
    FORBIDDEN: 403,
    VALIDATION: 400,
    AI_DISABLED: 403,
    AI_QUOTA: 429,
    NOT_FOUND: 404,
  }
  return { status: map[m[1]!] ?? 409, code: m[1]!, message: m[2]!.trim() }
}

class ProviderError extends Error {
  constructor(
    public status: number,
    public providerMessage: string,
  ) {
    super(`AI_PROVIDER_ERROR:${status}`)
  }
}

function modelList(): string[] {
  const raw = Deno.env.get('GEMINI_MODELS') || Deno.env.get('GEMINI_MODEL') || ''
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_MODELS
}

interface GeminiResult {
  json: unknown
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * Calls the model with retries.
 *   - Timeouts, network errors, malformed output and 5xx responses are retried on the same model.
 *   - Quota (429), unavailable model (404) and rejected requests (400, 403) move on to the next model.
 * Throws the last error if every model fails.
 */
async function callGemini(apiKey: string, prompt: string, responseSchema: unknown): Promise<GeminiResult> {
  let lastError: unknown = new Error('AI_PROVIDER_ERROR:no-model')

  for (const model of modelList()) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.4 },
          }),
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        })

        if (res.ok) {
          const body = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[]
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
          }
          const text = body.candidates?.[0]?.content?.parts?.[0]?.text
          if (!text) throw new Error('AI_BAD_OUTPUT: empty response')
          return {
            json: JSON.parse(text),
            model,
            inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
          }
        }

        const raw = await res.text()
        console.error('gemini_error', model, res.status, raw.slice(0, 500))
        let providerMessage = ''
        try {
          providerMessage = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? ''
        } catch {
          providerMessage = raw.slice(0, 200)
        }
        lastError = new ProviderError(res.status, providerMessage.slice(0, 300))

        if (res.status < 500) break // not worth retrying this model: try the next one
        if (attempt < MAX_ATTEMPTS_PER_MODEL) await sleep(1500 * attempt)
      } catch (error) {
        lastError = error
        console.error('gemini_attempt_failed', model, attempt, (error as Error).name, (error as Error).message)
        if (attempt < MAX_ATTEMPTS_PER_MODEL) await sleep(1500 * attempt)
      }
    }
  }

  throw lastError
}

/** Stores one validated question as a draft through the caller's session. */
async function saveDraft(
  client: SupabaseClient,
  q: GeneratedQuestion,
  ctx: { topicId: string; subtopic: string; jobId: string; model: string },
): Promise<{ question_id: string; question_version_id: string }> {
  const { data, error } = await client.rpc('admin_save_question', {
    p_question_id: null,
    p_data: {
      stem: q.stem,
      topic_id: ctx.topicId,
      subtopic: q.subtopic || ctx.subtopic || null,
      difficulty: q.difficulty,
      estimated_seconds: q.estimated_seconds,
      options: q.options,
      correct_position: q.correct_index,
      explanation: q.explanation,
      origin: 'AI',
      generation_job_id: ctx.jobId,
      generation_metadata: { model: ctx.model, job_id: ctx.jobId, generator: 'generate-questions' },
    },
  })
  if (error) throw error
  return data as { question_id: string; question_version_id: string }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return reply(req, 405, { code: 'VALIDATION', message: 'Use POST.' })

  const authorization = req.headers.get('authorization')
  if (!authorization) return reply(req, 401, { code: 'FORBIDDEN', message: 'Sign in to use the generator.' })

  // Runs as the caller. The database enforces who may call it.
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return reply(req, 400, { code: 'VALIDATION', message: 'The request is not valid JSON.' })
  }
  const parsed = generationRequestSchema.safeParse(parsedBody)
  if (!parsed.success) {
    return reply(req, 400, { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid request.' })
  }
  const request = parsed.data

  // 1. Administrator and AI-enabled checks, performed by the database as the caller.
  const status = await client.rpc('admin_ai_status')
  if (status.error) {
    const e = fromDb(status.error.message)
    return reply(req, e.status, { code: e.code, message: e.message })
  }

  // 2. Server configuration.
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return reply(req, 503, { code: 'AI_NOT_CONFIGURED', message: 'AI generation is not configured on the server yet.' })
  }

  // 3. Topic name for the prompt.
  const topic = await client.from('topics').select('name').eq('id', request.topic_id).maybeSingle()
  if (topic.error || !topic.data) {
    return reply(req, 400, { code: 'VALIDATION', message: 'The selected topic does not exist.' })
  }

  // 4. Start a job: the database enforces enabled, size and daily quota.
  const begin = await client.rpc('admin_ai_begin', {
    p_request: { count: request.count, topic_id: request.topic_id, subtopic: request.subtopic, difficulty: request.difficulty },
  })
  if (begin.error) {
    const e = fromDb(begin.error.message)
    return reply(req, e.status, { code: e.code, message: e.message })
  }
  const jobId = begin.data as string

  let model = modelList()[0]!
  const usage = { input: 0, output: 0 }

  const finish = async (outcome: 'SUCCEEDED' | 'FAILED', produced: number, error?: { code: string; message: string }) => {
    await client.rpc('admin_ai_finish', {
      p_job: jobId,
      p_status: outcome,
      p_produced: produced,
      p_provider: 'gemini',
      p_model: model,
      p_input_tokens: usage.input,
      p_output_tokens: usage.output,
      p_error_code: error?.code ?? null,
      p_error_message: error?.message ?? null,
    })
  }

  try {
    // 5. Generate.
    const prompt = buildGenerationPrompt(request, topic.data.name as string)
    const gen = await callGemini(apiKey, prompt, geminiGenerationResponseSchema)
    model = gen.model
    usage.input += gen.inputTokens
    usage.output += gen.outputTokens

    // 6. Validate every question. Anything that does not match the schema is dropped, not repaired.
    const batch = generatedBatchSchema.safeParse(gen.json)
    const candidates = batch.success ? batch.data.questions.slice(0, request.count) : []
    const warnings: string[] = []
    if (!batch.success) warnings.push('Some model output did not match the expected format and was discarded.')

    // 7. Store drafts. A rejected question is reported, and the rest still go through.
    const saved: { question_id: string; question_version_id: string; q: GeneratedQuestion }[] = []
    for (const q of candidates) {
      try {
        const r = await saveDraft(client, q, { topicId: request.topic_id, subtopic: request.subtopic, jobId, model })
        saved.push({ ...r, q })
      } catch (error) {
        const e = fromDb((error as { message?: string }).message ?? '')
        warnings.push(`A question was not saved: ${e.message}`)
      }
    }

    // 8. Second pass: solve WITHOUT the key. Agreement is recorded as PASS, disagreement as WARN.
    //    A failure here never discards the drafts.
    if (saved.length > 0) {
      try {
        const solverPrompt = buildSolverPrompt(saved.map((s, i) => ({ index: i, stem: s.q.stem, options: s.q.options })))
        const solved = await callGemini(apiKey, solverPrompt, geminiSolverResponseSchema)
        usage.input += solved.inputTokens
        usage.output += solved.outputTokens
        const answers = solverAnswersSchema.safeParse(solved.json)
        for (let i = 0; i < saved.length; i++) {
          const s = saved[i]!
          const said = answers.success ? answers.data.answers.find((a) => a.index === i)?.answer_index : undefined
          const outcome = said === undefined ? 'SKIPPED' : said === s.q.correct_index ? 'PASS' : 'WARN'
          const message =
            outcome === 'PASS'
              ? 'A second, independent pass reached the same answer.'
              : outcome === 'WARN'
                ? 'A second, independent pass chose a different option. Check this carefully.'
                : 'The second pass did not give an answer for this question.'
          await client.rpc('admin_record_solver_check', {
            p_question_version_id: s.question_version_id,
            p_outcome: outcome,
            p_message: message,
          })
        }
      } catch (error) {
        console.error('solver_pass_failed', (error as Error).name, (error as Error).message)
        warnings.push('The second-pass check did not complete. Review these drafts carefully.')
        for (const s of saved) {
          await client.rpc('admin_record_solver_check', {
            p_question_version_id: s.question_version_id,
            p_outcome: 'SKIPPED',
            p_message: 'The second-pass check did not complete.',
          })
        }
      }
    }

    const produced = saved.length
    if (produced === 0) {
      await finish('FAILED', 0, { code: 'AI_NO_VALID_OUTPUT', message: 'No question passed validation.' })
      return reply(req, 502, {
        code: 'AI_NO_VALID_OUTPUT',
        message: 'No usable questions were produced. Try a more specific request.',
      })
    }

    await finish('SUCCEEDED', produced)
    return reply(req, 200, {
      job_id: jobId,
      produced,
      question_ids: saved.map((s) => s.question_id),
      warnings,
    })
  } catch (error) {
    console.error('generate_failed', (error as Error).name, (error as Error).message)

    if (error instanceof ProviderError && error.status === 429) {
      await finish('FAILED', 0, { code: 'AI_PROVIDER_QUOTA', message: 'Provider quota exhausted.' })
      return reply(req, 429, { code: 'AI_QUOTA', message: 'The AI provider is busy or its quota is used up. Try again later.' })
    }

    let reason: string
    if (error instanceof ProviderError) {
      reason = `Gemini returned ${error.status}${error.providerMessage ? `: ${error.providerMessage}` : ''}`
    } else if ((error as Error).name === 'TimeoutError') {
      reason = 'The model took too long to answer. Try again with fewer questions.'
    } else {
      reason = ((error as Error).message ?? 'Unknown error').slice(0, 300)
    }

    await finish('FAILED', 0, { code: 'AI_PROVIDER_ERROR', message: reason })
    return reply(req, 502, { code: 'AI_PROVIDER_ERROR', message: reason })
  }
})