import { useState } from 'react'
import { api, withStudent } from '../api'
import { useApp } from '../lib/app-context'
import { Alert, Badge, Card, Empty, Field, Loading, Stat, money, today, useAction, useLoad } from '../components/ui'

const TONE = { paid: 'ok', pending: 'gray', overdue: 'bad' }

function AdminFees() {
  const [status, setStatus] = useState('')
  const fees = useLoad(() => api.get(`/api/fees${status ? `?status=${status}` : ''}`), [status])
  const summary = useLoad(() => api.get('/api/fees/summary'))
  const classes = useLoad(() => api.get('/api/classes'))
  const students = useLoad(() => api.get('/api/students'))
  const [f, setF] = useState({ target: 'class', class_id: '', student_id: '', title: '', amount: '', due_date: today() })
  const create = useAction()
  const row = useAction()
  const reload = () => { fees.reload(); summary.reload() }

  async function submit(e) {
    e.preventDefault()
    const body = { title: f.title, amount: Number(f.amount), due_date: f.due_date }
    if (f.target === 'class') body.class_id = Number(f.class_id)
    else body.student_id = Number(f.student_id)
    const ok = await create.run(() => api.post('/api/fees', body), 'Fees created')
    if (ok) { setF({ ...f, title: '', amount: '' }); reload() }
  }
  async function pay(fee) {
    const v = window.prompt(`Record payment for ${fee.student_name} — ${fee.title}\nOutstanding: ${money(fee.balance)}\nAmount:`, String(fee.balance))
    if (!v) return
    const method = window.prompt('Payment method (cash / bank / cheque / upi):', 'cash') || 'cash'
    if (await row.run(() => api.post(`/api/fees/${fee.id}/payments`, { amount: Number(v), method }), 'Payment recorded')) reload()
  }

  return (
    <>
      <h1>Fees</h1>
      {summary.data && (
        <div className="grid cols-4">
          <Stat label="Billed" value={money(summary.data.billed)} />
          <Stat label="Collected" value={money(summary.data.collected)} tone="ok" />
          <Stat label="Outstanding" value={money(summary.data.outstanding)} />
          <Stat label="Overdue" value={money(summary.data.overdue)} tone={summary.data.overdue > 0 ? 'bad' : ''} />
        </div>
      )}
      <Card title="Create fee">
        <form className="form" onSubmit={submit}>
          <Field label="Bill"><select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="class">Whole class</option><option value="student">One student</option></select></Field>
          {f.target === 'class'
            ? <Field label="Class"><select required value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}><option value="">Select…</option>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field>
            : <Field label="Student"><select required value={f.student_id} onChange={(e) => setF({ ...f, student_id: e.target.value })}><option value="">Select…</option>{(students.data || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.admission_no})</option>)}</select></Field>}
          <Field label="Title"><input required placeholder="Term 2 tuition" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Amount"><input type="number" required min="1" step="0.01" style={{ width: 120 }} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Due"><input type="date" required value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <button className="btn" disabled={create.busy}>Create</button>
        </form>
        <Alert>{create.error}</Alert>
        <Alert kind="ok">{create.ok}</Alert>
      </Card>
      <Card title="Fee ledger">
        <div className="tabs">{['', 'pending', 'overdue', 'paid'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s || 'all'}</button>)}</div>
        <Loading state={fees} />
        <Alert>{row.error}</Alert>
        <Alert kind="ok">{row.ok}</Alert>
        {fees.data?.length === 0 && <Empty>No fees.</Empty>}
        {fees.data?.length > 0 && (
          <div className="table-wrap"><table><thead><tr><th>Student</th><th>Fee</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th><th /></tr></thead><tbody>
            {fees.data.map((x) => (
              <tr key={x.id}><td>{x.student_name}</td><td>{x.title}</td><td>{x.due_date}</td><td>{money(x.amount)}</td><td>{money(x.paid)}</td><td><Badge tone={TONE[x.status]}>{x.status}</Badge></td>
                <td className="row">{x.balance > 0 && <button className="btn small" onClick={() => pay(x)}>Record payment</button>}
                  <button className="btn danger small" onClick={async () => { if (window.confirm('Delete this fee and its payments?')) { await api.del(`/api/fees/${x.id}`); reload() } }}>Delete</button></td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
    </>
  )
}

function MyFees() {
  const { role, studentId } = useApp()
  const state = useLoad(() => (role === 'parent' && !studentId ? Promise.resolve([]) : api.get(withStudent('/api/fees', studentId))), [role, studentId])
  const act = useAction()
  const payOnline = async (fee) => {
    await act.run(async () => {
      const { url } = await api.post(`/api/fees/${fee.id}/checkout`, { studentId: fee.student_id })
      window.location.href = url
    }, '')
  }
  const paidFlag = new URLSearchParams(window.location.search).get('paid')
  return (
    <>
      <h1>Fees</h1>
      {paidFlag && <Alert kind="ok">Thank you — your payment is being confirmed and will appear here shortly.</Alert>}
      <Alert>{act.error}</Alert>
      <Loading state={state} />
      {state.data?.length === 0 && <Card><Empty>No fees have been billed.</Empty></Card>}
      {state.data?.map((x) => (
        <Card key={x.id} title={x.title} actions={<Badge tone={TONE[x.status]}>{x.status}</Badge>}>
          <p>{money(x.amount)} · due {x.due_date} · paid {money(x.paid)} · <strong>balance {money(x.balance)}</strong></p>
          {x.payments.length > 0 && <ul className="muted">{x.payments.map((p) => <li key={p.id}>{money(p.amount)} via {p.method} on {new Date(p.paid_at).toLocaleDateString()}</li>)}</ul>}
          {x.balance > 0 && <button className="btn" disabled={act.busy} onClick={() => payOnline(x)}>Pay {money(x.balance)} online</button>}
        </Card>
      ))}
    </>
  )
}

export default function Fees() {
  const { role } = useApp()
  return role === 'admin' ? <AdminFees /> : <MyFees />
}
