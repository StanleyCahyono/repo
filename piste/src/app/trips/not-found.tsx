/**
 * Designed 404 for /trips/<unknown id> when the [id] layout's existence check fails (a real 404 status). A layout's
 * notFound() is caught by the parent segment's boundary, so this file — not trips/[id]/not-found.tsx — renders then.
 */
import { TripNotFoundView } from '@/components/trips/not-found-view'

export default function TripsNotFound() {
  return <TripNotFoundView />
}
