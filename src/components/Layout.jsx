import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useApp } from '../lib/app-context'
import { signOut } from '../lib/auth-client'

const NAV = {
  admin: [['/', 'Dashboard'], ['/users', 'Users'], ['/academics', 'Classes & Subjects'], ['/timetable', 'Timetable'], ['/attendance', 'Attendance'], ['/fees', 'Fees'], ['/announcements', 'Announcements']],
  teacher: [['/', 'Dashboard'], ['/attendance', 'Attendance'], ['/grades', 'Gradebook'], ['/assignments', 'Assignments'], ['/timetable', 'My Timetable'], ['/announcements', 'Announcements']],
  student: [['/', 'Dashboard'], ['/attendance', 'Attendance'], ['/grades', 'Grades'], ['/assignments', 'Assignments'], ['/timetable', 'Timetable'], ['/fees', 'Fees'], ['/announcements', 'Announcements']],
  parent: [['/', 'Dashboard'], ['/attendance', 'Attendance'], ['/grades', 'Grades'], ['/assignments', 'Assignments'], ['/timetable', 'Timetable'], ['/fees', 'Fees'], ['/announcements', 'Announcements']],
}

export default function Layout() {
  const { user, role, students, studentId, setStudentId } = useApp()
  const navigate = useNavigate()

  async function logout() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Pathshala</div>
        <nav aria-label="Main">
          {NAV[role].map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          {role === 'parent' ? (
            <label className="row">
              <span className="muted">Viewing child</span>
              <select value={studentId ?? ''} onChange={(e) => setStudentId(Number(e.target.value))}>
                {students.length === 0 && <option value="">No children linked</option>}
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} {s.class_name ? `(${s.class_name})` : ''}</option>
                ))}
              </select>
            </label>
          ) : (
            <span />
          )}
          <div className="row">
            <NavLink to="/profile" className="user-chip">{user.name} <span className={`role role-${role}`}>{role}</span></NavLink>
            <button className="btn ghost" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  )
}
