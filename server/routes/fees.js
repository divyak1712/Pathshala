import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, requireRole, resolveStudentId, HttpError, need, int, num, dateStr } from '../lib/access.js'
import { stripeConfigured, createCheckoutSession } from '../lib/stripe.js'

const router = Router()
router.use(requireAuth)

const FEE_SELECT = `SELECT f.id, f.student_id, f.title, f.amount::float AS amount, to_char(f.due_date,'YYYY-MM-DD') AS due_date,
    COALESCE(p.paid, 0)::float AS paid, (f.amount - COALESCE(p.paid, 0))::float AS balance,
    CASE WHEN f.amount - COALESCE(p.paid,0) <= 0 THEN 'paid' WHEN f.due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END AS status
  FROM fees f LEFT JOIN (SELECT fee_id, sum(amount) AS paid FROM payments GROUP BY fee_id) p ON p.fee_id = f.id`

router.get('/', async (req, res) => {
  const { role } = req.user
  if (role === 'teacher') throw new HttpError(403, 'Not allowed for your role')
  if (role === 'admin') {
    const { rows } = await pool.query(
      `SELECT x.*, u.name AS student_name, s.admission_no FROM (${FEE_SELECT}) x
       JOIN students s ON s.id = x.student_id JOIN "user" u ON u.id = s.user_id
       WHERE ($1::text IS NULL OR x.status = $1) ORDER BY x.due_date DESC, x.id DESC`,
      [req.query.status || null]
    )
    return res.json(rows)
  }
  const studentId = await resolveStudentId(req)
  const { rows } = await pool.query(`${FEE_SELECT} WHERE f.student_id = $1 ORDER BY f.due_date DESC`, [studentId])
  const { rows: pay } = await pool.query(
    `SELECT p.id, p.fee_id, p.amount::float AS amount, p.method, p.paid_at FROM payments p JOIN fees f ON f.id = p.fee_id
     WHERE f.student_id = $1 ORDER BY p.paid_at DESC`, [studentId])
  res.json(rows.map((f) => ({ ...f, payments: pay.filter((p) => p.fee_id === f.id) })))
})

router.get('/summary', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(amount),0)::float AS billed, COALESCE(sum(paid),0)::float AS collected, COALESCE(sum(balance),0)::float AS outstanding,
            COALESCE(sum(balance) FILTER (WHERE status = 'overdue'),0)::float AS overdue FROM (${FEE_SELECT}) x`)
  res.json(rows[0])
})

// Bill one student, or every student in a class.
router.post('/', requireRole('admin'), async (req, res) => {
  const title = need(req.body.title, 'Title is required')
  const amount = num(req.body.amount, 'Amount is required')
  if (amount <= 0) throw new HttpError(400, 'Amount must be positive')
  const due = dateStr(req.body.due_date, 'Due date is required')
  let ids
  if (req.body.class_id) {
    ids = (await pool.query('SELECT id FROM students WHERE class_id = $1', [int(req.body.class_id, 'Invalid class')])).rows.map((r) => r.id)
    if (!ids.length) throw new HttpError(400, 'That class has no students')
  } else {
    ids = [int(req.body.student_id, 'Select a student or a class')]
  }
  await pool.query(
    `INSERT INTO fees (student_id, title, amount, due_date) SELECT unnest($1::int[]), $2, $3, $4`, [ids, title, amount, due])
  res.status(201).json({ created: ids.length })
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM fees WHERE id = $1', [int(req.params.id, 'Invalid fee')])
  res.json({ ok: true })
})

// Offline payment (cash / bank / cheque). Row-locks the fee so concurrent entries can't overpay.
router.post('/:id/payments', requireRole('admin'), async (req, res) => {
  const feeId = int(req.params.id, 'Invalid fee')
  const amount = num(req.body.amount, 'Amount is required')
  if (amount <= 0) throw new HttpError(400, 'Amount must be positive')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT amount::float AS amount FROM fees WHERE id = $1 FOR UPDATE', [feeId])
    if (!rows[0]) throw new HttpError(404, 'Fee not found')
    const { rows: paid } = await client.query('SELECT COALESCE(sum(amount),0)::float AS paid FROM payments WHERE fee_id = $1', [feeId])
    const balance = Math.round((rows[0].amount - paid[0].paid) * 100) / 100
    if (amount > balance) throw new HttpError(400, `Amount exceeds outstanding balance (${balance})`)
    await client.query('INSERT INTO payments (fee_id, amount, method, recorded_by) VALUES ($1,$2,$3,$4)',
      [feeId, amount, req.body.method || 'cash', req.user.id])
    await client.query('COMMIT')
    res.status(201).json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// Online payment via Stripe Checkout (student or parent of the student).
router.post('/:id/checkout', requireRole('student', 'parent'), async (req, res) => {
  if (!stripeConfigured()) {
    throw new HttpError(501, 'Online payments are not configured. Ask the school office, or set STRIPE_SECRET_KEY on the server.')
  }
  const { rows } = await pool.query(`SELECT * FROM (${FEE_SELECT}) x WHERE x.id = $1`, [int(req.params.id, 'Invalid fee')])
  const fee = rows[0]
  if (!fee) throw new HttpError(404, 'Fee not found')
  req.query.studentId = fee.student_id // re-uses the ownership check: must be own / linked child
  await resolveStudentId(req)
  if (fee.balance <= 0) throw new HttpError(400, 'This fee is already paid')
  const base = process.env.BETTER_AUTH_URL
  const session = await createCheckoutSession({
    feeId: fee.id, title: fee.title, amount: fee.balance,
    successUrl: `${base}/fees?paid=1`, cancelUrl: `${base}/fees`,
  })
  res.json({ url: session.url })
})

export default router
