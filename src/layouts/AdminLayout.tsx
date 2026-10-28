import { AppShell } from './AppShell'

export function AdminLayout() {
  return (
    <AppShell
      variant="admin"
      nav={[
        { to: '/admin', label: 'Overview', end: true },
        { to: '/admin/challenges', label: 'Challenges' },
        { to: '/admin/questions', label: 'Questions' },
        { to: '/admin/ai-generator', label: 'AI generator' },
        { to: '/dashboard', label: 'Student view' },
      ]}
    />
  )
}
