const TW_TIMEZONE = 'Asia/Taipei'
const OPEN_MINUTES = 9 * 60
const CLOSE_MINUTES = 13 * 60 + 35

export function isTwMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TW_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = part('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') return false

  const minutes = Number(part('hour')) * 60 + Number(part('minute'))
  return minutes >= OPEN_MINUTES && minutes <= CLOSE_MINUTES
}
