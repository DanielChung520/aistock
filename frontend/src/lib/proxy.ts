export const BACKEND_TIMEOUT_MS = 90_000

export function backendSignal(ms: number = BACKEND_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms)
}
