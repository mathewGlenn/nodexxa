import { createTransport } from 'nodemailer'
import { prisma } from './db'
import { env } from './env'

const MAX_ATTEMPTS = 5

/** Which optional connectors have credentials configured (presence only, never values). */
export const connectorStatus = () => ({
  email: !!(env().SMTP_URL && env().SMTP_FROM),
  telegram: !!env().TELEGRAM_BOT_TOKEN,
})

function message(incident: { title: string, severity: string, status: string, details: string | null, openedAt: Date }, event: string) {
  const head = event === 'resolved' ? `RESOLVED: ${incident.title}` : `[${incident.severity.toUpperCase()}] ${incident.title}`
  return { subject: `Nodexxa — ${head}`.slice(0, 200), text: [head, incident.details, `Opened: ${incident.openedAt.toISOString()}`].filter(Boolean).join('\n') }
}

async function send(type: string, target: string, msg: { subject: string, text: string }) {
  const e = env()
  if (type === 'email') {
    await createTransport(e.SMTP_URL).sendMail({ from: e.SMTP_FROM, to: target, subject: msg.subject, text: msg.text })
    return
  }
  if (type === 'telegram') {
    const res = await fetch(`${e.TELEGRAM_API_BASE_URL}/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text: msg.text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    })
    // Error text deliberately excludes the URL, which embeds the bot token.
    if (!res.ok) throw new Error(`Telegram API responded ${res.status}`)
    return
  }
  throw new Error('Unknown channel type')
}

/** Delivers pending notifications (outbox pattern) with bounded retries. Claimed rows use SKIP LOCKED. */
export async function deliverPending(limit = 20) {
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "NotificationDelivery" SET "nextAttemptAt" = now() + interval '2 minutes'
    WHERE "id" IN (SELECT "id" FROM "NotificationDelivery" WHERE "status" = 'pending' AND "nextAttemptAt" <= now()
                   ORDER BY "nextAttemptAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "id"`
  const configured = connectorStatus()
  let sent = 0
  for (const { id } of ids) {
    const d = await prisma.notificationDelivery.findUnique({ where: { id }, include: { incident: true, channel: true } })
    if (!d) continue
    if (!configured[d.channel.type as 'email' | 'telegram']) {
      await prisma.notificationDelivery.update({ where: { id }, data: { status: 'skipped', lastError: 'Connector credentials not configured' } })
      continue
    }
    try {
      await send(d.channel.type, d.channel.target, message(d.incident, d.event))
      await prisma.notificationDelivery.update({ where: { id }, data: { status: 'sent', attempts: { increment: 1 }, lastError: null } })
      sent++
    }
    catch (e) {
      const attempts = d.attempts + 1
      await prisma.notificationDelivery.update({
        where: { id },
        data: {
          attempts, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', lastError: String((e as Error).message ?? 'send failed').slice(0, 300),
          nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** attempts),
        },
      })
    }
  }
  return { claimed: ids.length, sent }
}
