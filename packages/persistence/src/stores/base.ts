import type Database from 'better-sqlite3-multiple-ciphers'

import type { StoreRegistry } from './registry'

/**
 * Shared state for every domain store. All stores run against the same
 * connection, so a transaction opened by one store covers work another store
 * performs inside it.
 */
export interface StoreContext {
  readonly database: Database.Database
  readonly databaseKey: Buffer
  readonly mappingKey: Buffer
  /**
   * Populated once every store has been constructed. Stores read it only while
   * a method runs, never during construction, so the late assignment is safe.
   */
  stores: StoreRegistry
}

export abstract class DomainStore {
  protected readonly database: Database.Database
  protected readonly databaseKey: Buffer
  protected readonly mappingKey: Buffer

  constructor(private readonly context: StoreContext) {
    this.database = context.database
    this.databaseKey = context.databaseKey
    this.mappingKey = context.mappingKey
  }

  /** Cross-domain collaborators, reached through the registry to avoid module cycles. */
  protected get stores(): StoreRegistry {
    return this.context.stores
  }
}
