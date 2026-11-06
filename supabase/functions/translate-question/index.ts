
import { createClient } from '@supabase/supabase-js'
import {
  buildTranslationPrompt,
  geminiTranslationResponseSchema,
  translatedQuestionSchema,
  translationRequestSchema,
} from '../_shared/questionSchema.ts'

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
const ATTEMPT_TIMEOUT_MS = 25_000

function allowedOrigins(): string[] {
  return (Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const allowed = allowedOrigins()

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }

  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }

  return headers
}
function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function fromDb(message: string): { status: number; code: string; message: string } {
  const match = /^([A-Z_]+):\s*(.+)$/s.exec(message)

  if (!match) {
    return {
      status: 500,
      code: 'UNKNOWN',
      message: 'Something went wrong. Please try again.',
    }
  }

  const statusMap: Record<string, number> = {
    FORBIDDEN: 403,
    VALIDATION: 400,
    AI_DISABLED: 403,
    AI_QUOTA: 429,
    NOT_FOUND: 404,
  }

  return {
    status: statusMap[match[1]!] ?? 409,
    code: match[1]!,
    message: match[2]!.trim(),
  }
}

function modelList(): string[] {
  const configured = (
    Deno.env.get('GEMINI_MODELS') ||
    Deno.env.get('GEMINI_MODEL') ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return configured.length > 0 ? configured : DEFAULT_MODELS
}

class ProviderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

interface GeminiResult {
  result: unknown
  model: string
  inputTokens: number
  outputTokens: number
}

async function translateWithGemini(
  apiKey: string,
  prompt: string,
): Promise<GeminiResult> {
  let lastError: unknown = new Error('The AI provider could not complete the translation.')

  for (const model of modelList()) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: geminiTranslationResponseSchema,
              temperature: 0.2,
            },
          }),
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        },
      )

      if (!response.ok) {
        const raw = await response.text()
        console.error('translation_gemini_error', model, response.status, raw.slice(0, 500))

        lastError = new ProviderError(
          response.status,
          response.status === 429
            ? 'The AI provider quota is exhausted.'
            : `The AI provider returned error ${response.status}.`,
        )

        continue
      }

      const body = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[]
        usageMetadata?: {
          promptTokenCount?: number
          candidatesTokenCount?: number
        }
      }

      const text = body.candidates?.[0]?.content?.parts?.[0]?.text

      if (!text) {
        lastError = new Error('The AI provider returned an empty translation.')
        continue
      }

      try {
        return {
          result: JSON.parse(text),
          model,
          inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        }
      } catch {
        lastError = new Error('The AI provider returned invalid JSON.')
      }
    } catch (error) {
      console.error(
        'translation_attempt_failed',
        model,
        (error as Error).name,
        (error as Error).message,
      )

      lastError = error
    }
  }

  throw lastError
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return reply(req, 405, {
      code: 'VALIDATION',
      message: 'Use POST.',
    })
  }

  const authorization = req.headers.get('authorization')

  if (!authorization) {
    return reply(req, 401, {
      code: 'FORBIDDEN',
      message: 'Sign in before translating questions.',
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    return reply(req, 503, {
      code: 'SERVER_CONFIG',
      message: 'The translation service is not configured correctly.',
    })
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let rawBody: unknown

  try {
    rawBody = await req.json()
  } catch {
    return reply(req, 400, {
      code: 'VALIDATION',
      message: 'The request is not valid JSON.',
    })
  }

  const parsed = translationRequestSchema.safeParse(rawBody)

  if (!parsed.success) {
    return reply(req, 400, {
      code: 'VALIDATION',
      message: parsed.error.issues[0]?.message ?? 'Invalid translation request.',
    })
  }

  const request = parsed.data

  // 1. Verify administrator permissions and AI configuration.
  const status = await client.rpc('admin_ai_status')

  if (status.error) {
    const error = fromDb(status.error.message)
    return reply(req, error.status, {
      code: error.code,
      message: error.message,
    })
  }

  if (!(status.data as { enabled?: boolean } | null)?.enabled) {
    return reply(req, 403, {
      code: 'AI_DISABLED',
      message: 'AI features are currently disabled by the administrator.',
    })
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')

  if (!apiKey) {
    return reply(req, 503, {
      code: 'AI_NOT_CONFIGURED',
      message: 'The AI translation service is not configured on the server.',
    })
  }

  // 2. Reserve one shared AI quota slot.
  // The answer key is deliberately excluded from this request.
  const begin = await client.rpc('admin_ai_begin', {
    p_request: {
      count: 1,
      operation: 'TAMIL_TRANSLATION',
      question_version_id: request.question_version_id,
    },
  })

  if (begin.error) {
    const error = fromDb(begin.error.message)
    return reply(req, error.status, {
      code: error.code,
      message: error.message,
    })
  }

  const jobId = begin.data as string
  let model = modelList()[0]!
  const usage = { input: 0, output: 0 }

  // 3. Record the outcome in the existing AI generation history.
  const finish = async (
    outcome: 'SUCCEEDED' | 'FAILED',
    produced: number,
    error?: { code: string; message: string },
  ) => {
    const { error: finishError } = await client.rpc('admin_ai_finish', {
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

    if (finishError) {
      console.error('translation_job_finish_failed', jobId, finishError.message)
    }
  }

  try {
    // 4. Generate Tamil translation. No answer key is sent to Gemini.
    const generated = await translateWithGemini(
      apiKey,
      buildTranslationPrompt(request),
    )

    model = generated.model
    usage.input = generated.inputTokens
    usage.output = generated.outputTokens

    // 5. Validate the model output.
    const translated = translatedQuestionSchema.safeParse(generated.result)

    if (!translated.success) {
      await finish('FAILED', 0, {
        code: 'AI_INVALID_TRANSLATION',
        message: 'The AI returned an invalid translation.',
      })

      return reply(req, 502, {
        code: 'AI_INVALID_TRANSLATION',
        message: 'The AI returned an invalid translation. Please try again.',
      })
    }

    if (translated.data.options.length !== request.options.length) {
      await finish('FAILED', 0, {
        code: 'AI_OPTION_COUNT_MISMATCH',
        message: 'The AI changed the number of answer options.',
      })

      return reply(req, 502, {
        code: 'AI_OPTION_COUNT_MISMATCH',
        message: 'The AI changed the number of answer options. Nothing was saved.',
      })
    }

    // 6. Save as an AI draft through the authenticated admin session.
    const saved = await client.rpc('admin_save_translation', {
      p_question_version_id: request.question_version_id,
      p_language: 'ta',
      p_data: {
        ...translated.data,
        source: 'AI_DRAFT',
      },
    })

    if (saved.error) {
      const error = fromDb(saved.error.message)

      await finish('FAILED', 0, {
        code: error.code,
        message: error.message,
      })

      return reply(req, error.status, {
        code: error.code,
        message: error.message,
      })
    }

    // 7. Record success.
    await finish('SUCCEEDED', 1)

    return reply(req, 200, {
      status: 'NEEDS_REVIEW',
      source: 'AI_DRAFT',
      model,
      translation: translated.data,
    })
  } catch (error) {
    console.error(
      'translate_question_failed',
      (error as Error).name,
      (error as Error).message,
    )

    const providerError = error instanceof ProviderError
    const isQuotaError = providerError && error.status === 429
    const isTimeout = (error as Error).name === 'TimeoutError'

    const code = isQuotaError
      ? 'AI_PROVIDER_QUOTA'
      : isTimeout
        ? 'AI_TIMEOUT'
        : 'AI_TRANSLATION_FAILED'

    const message = isQuotaError
      ? 'The AI provider is busy or its quota is used up. Try again later.'
      : isTimeout
        ? 'The translation took too long. Please try again.'
        : 'Translation failed. Please try again.'

    await finish('FAILED', 0, { code, message })

    return reply(req, isQuotaError ? 429 : 502, {
      code,
      message,
    })
  }
})

