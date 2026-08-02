import {
  tryAcquireTableLease,
  type TableLeaseRelease,
} from '../game/tableLease'

export type TableLeaseOwner = 'action' | 'restore'
export type TableLeaseAcquireResult = 'acquired' | 'busy' | 'unavailable'

interface LeaseRequest {
  owner: TableLeaseOwner
  promise: Promise<TableLeaseAcquireResult>
}

/** Serializes the restore loop and user actions before they reach Web Locks. */
export class TableLeaseArbiter {
  private heldOwner: TableLeaseOwner | null = null
  private heldRelease: TableLeaseRelease | null = null
  private request: LeaseRequest | null = null
  private generation = 0

  constructor(
    private readonly acquireRaw: () => Promise<TableLeaseRelease | null> = tryAcquireTableLease,
  ) {}

  acquire(owner: TableLeaseOwner): Promise<TableLeaseAcquireResult> {
    if (this.heldRelease) {
      return Promise.resolve(this.heldOwner === owner ? 'acquired' : 'busy')
    }
    if (this.request) {
      return this.request.owner === owner
        ? this.request.promise
        : Promise.resolve('busy')
    }

    const generation = this.generation
    const promise = this.acquireRaw().then(
      (release): TableLeaseAcquireResult => {
        if (!release) return 'unavailable'
        if (generation !== this.generation) {
          release()
          return 'unavailable'
        }
        if (this.heldRelease) {
          release()
          return this.heldOwner === owner ? 'acquired' : 'busy'
        }
        this.heldOwner = owner
        this.heldRelease = release
        return 'acquired'
      },
      (): TableLeaseAcquireResult => 'unavailable',
    )
    const request = { owner, promise }
    this.request = request
    void promise.then(() => {
      if (this.request === request) this.request = null
    })
    return promise
  }

  owns(owner: TableLeaseOwner): boolean {
    return this.heldOwner === owner && this.heldRelease !== null
  }

  isBusy(): boolean {
    return this.heldRelease !== null || this.request !== null
  }

  release(expectedOwner?: TableLeaseOwner): boolean {
    const activeOwner = this.heldOwner ?? this.request?.owner ?? null
    if (!activeOwner || (expectedOwner && activeOwner !== expectedOwner)) {
      return false
    }
    this.generation += 1
    const release = this.heldRelease
    this.heldOwner = null
    this.heldRelease = null
    release?.()
    return true
  }
}
