export type TableLeaseRelease = () => void

const TABLE_LEASE_NAME = 'nine-road-baccarat:active-table:v1'

export function tableLeaseIsSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.locks)
}

export async function tryAcquireTableLease(): Promise<TableLeaseRelease | null> {
  if (!tableLeaseIsSupported()) return null

  return new Promise<TableLeaseRelease | null>((resolve) => {
    let acquisitionResolved = false
    const resolveOnce = (release: TableLeaseRelease | null) => {
      if (acquisitionResolved) return
      acquisitionResolved = true
      resolve(release)
    }

    void navigator.locks
      .request(
        TABLE_LEASE_NAME,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolveOnce(null)
            return
          }

          await new Promise<void>((releaseLock) => {
            let released = false
            resolveOnce(() => {
              if (released) return
              released = true
              releaseLock()
            })
          })
        },
      )
      .catch(() => {
        // Integrity takes priority over availability: without a real exclusive
        // lock, two tabs could advance the same durable round journal.
        resolveOnce(null)
      })
  })
}
