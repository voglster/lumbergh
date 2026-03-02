import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export function relativeDate(iso: string): string {
  return dayjs(iso).fromNow()
}
