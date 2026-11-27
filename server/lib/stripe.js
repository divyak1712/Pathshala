import crypto from 'node:crypto'

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY)

/** Creates a Stripe Checkout Session via REST (no SDK). Amount in major units (e.g. rupees). */
export async function createCheckoutSession({ feeId, title, amount, successUrl, cancelUrl }) {
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': process.env.CURRENCY || 'inr',
    'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)),
    'line_items[0][price_data][product_data][name]': title,
    'metadata[fee_id]': String(feeId),
  })
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message || 'Stripe request failed')
  return json
}

/** Verifies the Stripe-Signature header (HMAC-SHA256 over `${t}.${rawBody}`), 5 minute tolerance. */
export function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  if (!parts.t || !parts.v1) return false
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(parts.v1)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
