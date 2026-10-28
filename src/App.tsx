import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { RouterProvider } from 'react-router/dom'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { getEnv } from '@/lib/env'
import { createQueryClient } from '@/lib/queryClient'
import { SetupRequiredPage } from '@/pages/SetupRequiredPage'
import { createAppRouter } from '@/router'

function ConfiguredApp() {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(createAppRouter)
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}

export function App() {
  const env = getEnv()
  if (!env.ok) return <SetupRequiredPage problems={env.problems} />
  return <ConfiguredApp />
}
