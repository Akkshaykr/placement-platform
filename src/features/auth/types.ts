import { z } from 'zod'

export const appRoleSchema = z.enum(['USER', 'ADMIN'])
export type AppRole = z.infer<typeof appRoleSchema>

export const profileSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
})
export type Profile = z.infer<typeof profileSchema>

export const roleRowsSchema = z.array(z.object({ role: appRoleSchema }))
