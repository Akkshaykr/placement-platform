import { AppShell } from './AppShell'

export function StudentLayout() {
  return (
    <AppShell
      variant="student"
      nav={[
        { to: '/dashboard', label: 'Dashboard' },
        { to: '/challenges', label: 'Challenges' },
        { to: '/history', label: 'My attempts' },
        { to: '/profile', label: 'Profile' },
      ]}
    />
  )
}
