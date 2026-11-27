import { useCallback, useEffect, useState } from 'react'

export const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n ?? 0)
export const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Loads data on mount / when deps change. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }))
    return fn()
      .then((data) => setState({ data, error: '', loading: false }))
      .catch((err) => setState({ data: null, error: err.message, loading: false }))
    // Callers pass the dependency list explicitly, so the lint rules cannot verify it statically.
    // oxlint-disable-next-line react/use-memo, react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    run()
  }, [run])
  return { ...state, reload: run }
}

/** Runs an async action, tracking busy/error/ok state for a form or button. */
export function useAction() {
  const [state, setState] = useState({ busy: false, error: '', ok: '' })
  const run = async (fn, okMessage = 'Saved') => {
    setState({ busy: true, error: '', ok: '' })
    try {
      const result = await fn()
      setState({ busy: false, error: '', ok: okMessage })
      return result ?? true
    } catch (err) {
      setState({ busy: false, error: err.message, ok: '' })
      return false
    }
  }
  return { ...state, run }
}

export function Alert({ kind = 'error', children }) {
  return children ? <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null
}
export function Card({ title, actions, children }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          <div className="row">{actions}</div>
        </header>
      )}
      {children}
    </section>
  )
}
export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}
export function Badge({ tone = 'gray', children }) {
  return <span className={`badge ${tone}`}>{children}</span>
}
export function Loading({ state }) {
  if (state.loading && !state.data) return <p className="muted">Loading…</p>
  if (state.error) return <Alert>{state.error}</Alert>
  return null
}
export function Empty({ children }) {
  return <p className="muted empty">{children}</p>
}
export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
export function Bar({ value, max = 100, tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="bar" role="img" aria-label={`${Math.round(pct)}%`}>
      <div className={`bar-fill ${tone || ''}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
