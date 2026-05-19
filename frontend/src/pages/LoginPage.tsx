import { useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'
import GlassPanel from '../components/ui/GlassPanel'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function LoginPage() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const err = await login(password)
    if (err) {
      setError(err)
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base px-4">
      <GlassPanel variant="elevated" padding="lg" radius="xl" className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="text-xl font-semibold text-text-primary">Lumbergh</h1>
          <p className="text-sm text-text-secondary">Enter the password to continue.</p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            disabled={submitting}
          />
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={submitting || !password}
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </GlassPanel>
    </div>
  )
}
