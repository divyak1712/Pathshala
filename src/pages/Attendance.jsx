import { useEffect, useState } from 'react'
import { api, withStudent } from '../api'
import { useApp } from '../lib/app-context'
import { Alert, Badge, Card, Empty, Field, Loading, Stat, today, useAction, useLoad } from '../components/ui'

const STATUSES = ['present', 'absent', 'late', 'excused']
const TONE = { present: 'ok', absent: 'bad', late: 'warn', excused: 'gray' }

function Register() {
  const classes = useLoad(() => api.get('/api/classes'))
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(today())
  const [marks, setMarks] = useState({})
  const roster = useLoad(() => (classId ? api.get(`/api/attendance/class/${classId}?date=${date}`) : Promise.resolve([])), [classId, date])
  const save = useAction()

  useEffect(() => {
    if (!classId && classes.data?.length) setClassId(String(classes.data[0].id))
  }, [classes.data, classId])
  useEffect(() => {
    setMarks(Object.fromEntries((roster.data || []).filter((r) => r.status).map((r) => [r.student_id, r.status])))
  }, [roster.data])

  const markAll = (status) => setMarks(Object.fromEntries((roster.data || []).map((r) => [r.student_id, status])))
  const submit = () =>
    save.run(() => api.put(`/api/attendance/class/${classId}`, { date, records: Object.entries(marks).map(([student_id, status]) => ({ student_id: Number(student_id), status })) }), 'Attendance saved')
  const unmarked = (roster.data || []).filter((r) => !marks[r.student_id]).length

  return (
    <>
      <h1>Attendance register</h1>
      <Card>
        <div className="form">
          <Field label="Class"><select value={classId} onChange={(e) => setClassId(e.target.value)}>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {classes.data?.length === 0 && <Empty>You are not assigned to any class yet. Ask the administrator.</Empty>}
      </Card>
      {classId && (
        <Card title="Students" actions={<><button className="btn ghost small" onClick={() => markAll('present')}>Mark all present</button></>}>
          <Loading state={roster} />
          {roster.data?.length === 0 && <Empty>This class has no students.</Empty>}
          {roster.data?.length > 0 && (
            <table><thead><tr><th>Roll</th><th>Name</th><th>Status</th></tr></thead><tbody>
              {roster.data.map((r) => (
                <tr key={r.student_id}><td>{r.roll_no ?? '—'}</td><td>{r.name}</td>
                  <td className="segmented">{STATUSES.map((s) => (
                    <label key={s}><input type="radio" name={`s-${r.student_id}`} checked={marks[r.student_id] === s} onChange={() => setMarks({ ...marks, [r.student_id]: s })} />{s}</label>
                  ))}</td></tr>
              ))}
            </tbody></table>
          )}
          <Alert>{save.error}</Alert>
          <Alert kind="ok">{save.ok}</Alert>
          {roster.data?.length > 0 && <p className="row"><button className="btn" disabled={save.busy || Object.keys(marks).length === 0} onClick={submit}>Save attendance</button>{unmarked > 0 && <span className="muted">{unmarked} not marked yet</span>}</p>}
        </Card>
      )}
    </>
  )
}

function MyAttendance() {
  const { studentId, role } = useApp()
  const state = useLoad(() => (role === 'parent' && !studentId ? Promise.resolve(null) : api.get(withStudent('/api/attendance/student', studentId))), [studentId, role])
  const d = state.data
  return (
    <>
      <h1>Attendance</h1>
      <Loading state={state} />
      {d && (
        <>
          <div className="grid cols-4">
            <Stat label="Attendance" value={d.percentage === null ? '—' : `${d.percentage}%`} tone={d.percentage !== null && d.percentage < 75 ? 'bad' : 'ok'} hint="present + late, excluding excused" />
            {STATUSES.map((s) => <Stat key={s} label={s} value={d.summary[s]} />)}
          </div>
          <Card title="History (last 180 records)">
            {d.records.length === 0 ? <Empty>No attendance recorded yet.</Empty> : (
              <table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
                {d.records.map((r) => <tr key={r.date}><td>{r.date}</td><td><Badge tone={TONE[r.status]}>{r.status}</Badge></td></tr>)}
              </tbody></table>
            )}
          </Card>
        </>
      )}
    </>
  )
}

export default function Attendance() {
  const { role } = useApp()
  return role === 'admin' || role === 'teacher' ? <Register /> : <MyAttendance />
}
