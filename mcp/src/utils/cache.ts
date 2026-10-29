export class TTLCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>()
  private readonly ttlMs: number

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }
}
