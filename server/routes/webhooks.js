import { Router, raw } from 'express'
import { pool } from '../db.js'
import { verifyStripeSignature } from '../lib/stripe.js'

const router = Router()

// Mounted BEFORE express.json(): signature verification needs the exact raw bytes.
router.post('/stripe', raw({ type: '*/*' }), async (req, res) => {
  const body = req.body.toString('utf8')
  if (!verifyStripeSignature(body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Invalid signature' })
  }
  const event = JSON.parse(body)
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object
    const feeId = Number(s.metadata?.fee_id)
    if (Number.isInteger(feeId) && s.payment_status === 'paid') {
      // reference UNIQUE => Stripe retries are idempotent
      await pool.query(
        `INSERT INTO payments (fee_id, amount, method, reference) VALUES ($1,$2,'stripe',$3) ON CONFLICT (reference) DO NOTHING`,
        [feeId, s.amount_total / 100, s.id]
      )
    }
  }
  res.json({ received: true })
})

export default router
