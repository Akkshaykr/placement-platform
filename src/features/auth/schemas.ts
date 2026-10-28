import { z } from 'zod'

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 72

const email = z.string().trim().min(1, 'Enter your email address.').pipe(z.email('Enter a valid email address.'))

const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`)

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Enter your name.').max(60, 'Use at most 60 characters.'),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  })

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  })

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>
