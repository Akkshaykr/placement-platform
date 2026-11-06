import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../tests/unit/utils'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { LoginPage } from './LoginPage'
import { RegisterPage } from './RegisterPage'
import * as api from './api'

vi.mock('./api')
const mocked = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('LoginPage', () => {
  it('shows validation errors without calling the server', async () => {
    renderWithProviders(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument()
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument()
    expect(mocked.signInWithEmail).not.toHaveBeenCalled()
  })

  it('wires errors to their inputs for assistive technology', async () => {
    renderWithProviders(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    const email = screen.getByLabelText('Email')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    const describedBy = email.getAttribute('aria-describedby')!
    expect(document.getElementById(describedBy)).toHaveTextContent(/valid email/i)
  })

  it('submits trimmed credentials and shows the server error', async () => {
    mocked.signInWithEmail.mockResolvedValue({ ok: false, error: { code: 'invalid_credentials', message: 'The email or password is incorrect.' } })
    renderWithProviders(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), ' ada@example.test ')
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i)
    expect(mocked.signInWithEmail).toHaveBeenCalledWith('ada@example.test', 'secret-password')
  })

  it('offers to resend the confirmation email for an unconfirmed account', async () => {
    mocked.signInWithEmail.mockResolvedValue({ ok: false, error: { code: 'email_not_confirmed', message: 'Confirm your email address first.' } })
    mocked.resendConfirmation.mockResolvedValue({ ok: true, value: undefined })
    renderWithProviders(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /resend confirmation/i }))
    expect(mocked.resendConfirmation).toHaveBeenCalledWith('ada@example.test')
  })

  it('does not offer any third-party sign-in option', () => {
    renderWithProviders(<LoginPage />)
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
  })
})

describe('RegisterPage', () => {
  const fill = async (over: Partial<Record<'name' | 'email' | 'password' | 'confirm', string>> = {}) => {
    await userEvent.type(screen.getByLabelText('Full name'), over.name ?? 'Ada Lovelace')
    await userEvent.type(screen.getByLabelText('Email'), over.email ?? 'ada@example.test')
    await userEvent.type(screen.getByLabelText('Password'), over.password ?? 'correct-horse-9')
    await userEvent.type(screen.getByLabelText('Confirm password'), over.confirm ?? 'correct-horse-9')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
  }

  it('blocks a weak or mismatched password before contacting the server', async () => {
    renderWithProviders(<RegisterPage />)
    await fill({ password: 'short', confirm: 'different' })
    expect(await screen.findByText(/at least 10 characters/i, { selector: 'p.text-danger-soft' })).toBeInTheDocument()
    expect(screen.getByText(/do not match/i)).toBeInTheDocument()
    expect(mocked.signUpWithEmail).not.toHaveBeenCalled()
  })

  it('does not reveal whether the address was already registered', async () => {
    mocked.signUpWithEmail.mockResolvedValue({ ok: true, value: { signedIn: false } })
    renderWithProviders(<RegisterPage />)
    await fill()
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeInTheDocument()
    expect(screen.getByText(/can be used for a new account/i)).toBeInTheDocument()
    expect(mocked.signUpWithEmail).toHaveBeenCalledWith({ displayName: 'Ada Lovelace', email: 'ada@example.test', password: 'correct-horse-9', confirmPassword: 'correct-horse-9' })
  })

  it('shows a server error such as rate limiting', async () => {
    mocked.signUpWithEmail.mockResolvedValue({ ok: false, error: { code: 'over_request_rate_limit', message: 'Too many attempts. Wait a few minutes and try again.' } })
    renderWithProviders(<RegisterPage />)
    await fill()
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i)
  })

  it('does not offer any third-party sign-up option', () => {
    renderWithProviders(<RegisterPage />)
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
  })
})

describe('ForgotPasswordPage', () => {
  it('gives the same confirmation whether or not the account exists', async () => {
    mocked.requestPasswordReset.mockResolvedValue({ ok: true, value: undefined })
    renderWithProviders(<ForgotPasswordPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'anyone@example.test')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument()
  })
})