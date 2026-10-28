import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { AppRole, Profile } from './types'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'
export type RolesStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  roles: AppRole[]
  rolesStatus: RolesStatus
  /** UX hint only. Real authorization is enforced by the database. */
  isAdmin: boolean
  profile: Profile | null
  /** True after the person opened a password-recovery link. */
  recovering: boolean
  retryRoles: () => void
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
