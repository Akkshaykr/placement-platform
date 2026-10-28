import { QuestionEditorPage } from './QuestionEditorPage'

export function QuestionCreateRoute() {
  return <QuestionEditorPage mode="create" />
}

export function QuestionEditRoute() {
  return <QuestionEditorPage mode="edit" />
}
