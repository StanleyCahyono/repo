/** Designed 404 for /resorts/<unknown id> when the [id] layout's existence check fails (a real 404 status). */
import { ResortNotFoundView } from '@/components/resort/not-found-view'

export default function ResortsNotFound() {
  return <ResortNotFoundView />
}
