import { AdminChallengeEditorPage } from './AdminChallengeEditorPage'

export function ChallengeCreateRoute() {
  return <AdminChallengeEditorPage mode="create" />
}

export function ChallengeEditRoute() {
  return <AdminChallengeEditorPage mode="edit" />
}
