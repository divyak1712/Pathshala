import nodemailer from 'nodemailer'

let transport
export const mailConfigured = () => Boolean(process.env.SMTP_HOST)

/** Sends email (BCC to all recipients) if SMTP_* is configured; otherwise logs and no-ops. Never throws. */
export async function sendMail({ to, subject, text }) {
  const recipients = [].concat(to).filter(Boolean)
  if (!recipients.length) return
  if (!mailConfigured()) {
    console.log(`[mail:disabled] "${subject}" -> ${recipients.length} recipient(s). Set SMTP_HOST to enable.`)
    return
  }
  try {
    transport ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
    await transport.sendMail({ from: process.env.MAIL_FROM, to: process.env.MAIL_FROM, bcc: recipients, subject, text })
  } catch (err) {
    console.error('[mail] send failed:', err.message)
  }
}
