import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { PageLoading } from '@/components/PageLoading'
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage'
import { RedirectIfAuthenticated, RequireAdmin, RequireAuth } from '@/features/auth/guards'
import { AdminLayout } from '@/layouts/AdminLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { PublicLayout } from '@/layouts/PublicLayout'
import { StudentLayout } from '@/layouts/StudentLayout'
import { LandingPage } from '@/pages/LandingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/** Route-level code splitting: a page's code (and its form libraries) loads when it is first visited. */
function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return async () => ({ Component: (await load())[name] as ComponentType })
}

/** Shown during the first render while a lazily loaded route's code is fetched (avoids a blank screen). */
const rootRoute = (children: RouteObject[]): RouteObject[] => [{ HydrateFallback: PageLoading, children }]

export const routes: RouteObject[] = rootRoute([
  { element: <PublicLayout />, children: [{ path: '/', element: <LandingPage /> }] },
  {
    element: <AuthLayout />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { path: '/login', lazy: lazyPage(() => import('@/features/auth/LoginPage'), 'LoginPage') },
          { path: '/register', lazy: lazyPage(() => import('@/features/auth/RegisterPage'), 'RegisterPage') },
          { path: '/forgot-password', lazy: lazyPage(() => import('@/features/auth/ForgotPasswordPage'), 'ForgotPasswordPage') },
        ],
      },
      // Reachable while signed in, because the recovery link itself signs the person in.
      { path: '/reset-password', lazy: lazyPage(() => import('@/features/auth/ResetPasswordPage'), 'ResetPasswordPage') },
    ],
  },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <StudentLayout />,
        children: [
          { path: '/dashboard', lazy: lazyPage(() => import('@/features/dashboard/StudentDashboardPage'), 'StudentDashboardPage') },
          { path: '/profile', lazy: lazyPage(() => import('@/features/profile/ProfilePage'), 'ProfilePage') },
          { path: '/challenges', lazy: lazyPage(() => import('@/features/challenges/ChallengesPage'), 'ChallengesPage') },
          { path: '/challenges/:slug', lazy: lazyPage(() => import('@/features/challenges/ChallengeDetailPage'), 'ChallengeDetailPage') },
          { path: '/attempt/:attemptId', lazy: lazyPage(() => import('@/features/challenges/AttemptPage'), 'AttemptPage') },
          { path: '/results/:attemptId', lazy: lazyPage(() => import('@/features/challenges/ResultPage'), 'ResultPage') },
          { path: '/leaderboard/:challengeId', lazy: lazyPage(() => import('@/features/challenges/LeaderboardPage'), 'LeaderboardPage') },
          { path: '/history', lazy: lazyPage(() => import('@/features/challenges/HistoryPage'), 'HistoryPage') },
        ],
      },
      {
        element: <RequireAdmin />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              {
                path: '/admin',
                // Loaded on demand so students never download administrator code.
                lazy: async () => {
                  const { AdminOverviewPage } = await import('@/features/admin/AdminOverviewPage')
                  return { Component: AdminOverviewPage }
                },
              },
              { path: '/admin/challenges', lazy: lazyPage(() => import('@/features/admin/challenges/AdminChallengesPage'), 'AdminChallengesPage') },
              { path: '/admin/challenges/new', lazy: lazyPage(() => import('@/features/admin/challenges/routes'), 'ChallengeCreateRoute') },
              { path: '/admin/challenges/:id', lazy: lazyPage(() => import('@/features/admin/challenges/routes'), 'ChallengeEditRoute') },
              { path: '/admin/challenges/:id/insights', lazy: lazyPage(() => import('@/features/admin/challenges/AdminChallengeInsightsPage'), 'AdminChallengeInsightsPage') },
              { path: '/admin/questions', lazy: lazyPage(() => import('@/features/admin/questions/QuestionBankPage'), 'QuestionBankPage') },
              { path: '/admin/questions/new', lazy: lazyPage(() => import('@/features/admin/questions/routes'), 'QuestionCreateRoute') },
              { path: '/admin/questions/:id', lazy: lazyPage(() => import('@/features/admin/questions/routes'), 'QuestionEditRoute') },
              { path: '/admin/ai-generator', lazy: lazyPage(() => import('@/features/admin/questions/AiGeneratorPage'), 'AiGeneratorPage') },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])

export const createAppRouter = () => createBrowserRouter(routes)
