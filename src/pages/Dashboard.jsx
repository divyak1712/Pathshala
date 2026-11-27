import { Link } from 'react-router-dom'
import { api, withStudent } from '../api'
import { useApp } from '../lib/app-context'
import { Bar, Card, Empty, Loading, Stat, money, useLoad } from '../components/ui'

function TodayTable({ rows, teacher }) {
  if (!rows.length) return <Empty>No classes scheduled today.</Empty>
  return (
    <table>
      <thead><tr><th>Time</th><th>Subject</th><th>{teacher ? 'Class' : 'Teacher'}</th><th>Room</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}><td>{r.start_time}–{r.end_time}</td><td>{r.subject}</td><td>{teacher ? r.class_name : r.teacher_name || '—'}</td><td>{r.room || '—'}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Dashboard() {
  const { user, role, studentId, students } = useApp()
  const needsStudent = role === 'parent'
  const state = useLoad(
    () => (needsStudent && !studentId ? Promise.resolve({ role, noChild: true }) : api.get(withStudent('/api/dashboard', studentId))),
    [role, studentId]
  )
  const d = state.data

  return (
    <>
      <h1>Welcome, {user.name}</h1>
      <Loading state={state} />
      {d?.noChild && <Card><Empty>No children are linked to your account yet. Please contact the school office.</Empty></Card>}

      {d && role === 'admin' && (
        <>
          <div className="grid cols-4">
            <Stat label="Students" value={d.counts.students} />
            <Stat label="Teachers" value={d.counts.teachers} />
            <Stat label="Parents" value={d.counts.parents} />
            <Stat label="Classes" value={d.counts.classes} />
            <Stat label="Attendance today" value={d.attendanceToday.marked ? `${Math.round((d.attendanceToday.present / d.attendanceToday.marked) * 100)}%` : '—'} hint={`${d.attendanceToday.marked} marked`} />
            <Stat label="Fees collected" value={money(d.fees.collected)} hint={`of ${money(d.fees.billed)} billed`} tone="ok" />
            <Stat label="Fees outstanding" value={money(d.fees.billed - d.fees.collected)} tone={d.fees.billed - d.fees.collected > 0 ? 'bad' : ''} />
          </div>
          <Card title="Students per class">
            {d.studentsByClass.length === 0 ? <Empty>No classes yet. <Link to="/academics">Create one</Link>.</Empty> : (
              <table><tbody>{d.studentsByClass.map((c) => (
                <tr key={c.label}><td>{c.label}</td><td style={{ width: '60%' }}><Bar value={c.value} max={Math.max(...d.studentsByClass.map((x) => x.value), 1)} /></td><td>{c.value}</td></tr>
              ))}</tbody></table>
            )}
          </Card>
        </>
      )}

      {d && role === 'teacher' && (
        <>
          <div className="grid cols-4">
            <Stat label="My classes" value={d.classes} />
            <Stat label="Open assignments" value={d.open_assignments} />
            <Stat label="Submissions to grade" value={d.to_grade} tone={d.to_grade ? 'bad' : ''} />
          </div>
          <Card title="Today's periods"><TodayTable rows={d.today} teacher /></Card>
        </>
      )}

      {d && !d.noChild && (role === 'student' || role === 'parent') && (
        <>
          {role === 'parent' && <p className="muted">Showing {students.find((s) => s.id === studentId)?.name}</p>}
          <div className="grid cols-4">
            <Stat label="Attendance" value={d.attendancePercentage === null ? '—' : `${d.attendancePercentage}%`} tone={d.attendancePercentage !== null && d.attendancePercentage < 75 ? 'bad' : 'ok'} />
            <Stat label="Average grade" value={d.averageGrade === null ? '—' : `${d.averageGrade}%`} />
            <Stat label="Pending assignments" value={d.pendingAssignments} />
            <Stat label="Fees outstanding" value={money(d.outstandingFees)} tone={d.outstandingFees > 0 ? 'bad' : 'ok'} />
          </div>
          <Card title="Today's timetable"><TodayTable rows={d.today} /></Card>
        </>
      )}
    </>
  )
}
