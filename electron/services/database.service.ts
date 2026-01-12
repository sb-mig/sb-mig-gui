/**
 * SQLite Database Service using better-sqlite3
 *
 * Local database storage for sb-mig-gui settings and configurations.
 * Each user has their own database in the app's userData directory.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

/**
 * In-memory cache for settings to avoid repeated database queries
 * Settings rarely change during a session, so caching is very effective
 */
const settingsCache = new Map<string, string | null>()

/**
 * Initialize the SQLite database
 */
export function initDatabase(): void {
  // Get the user data directory
  const userDataPath = app.getPath('userData')

  // Ensure the directory exists
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true })
  }

  const dbPath = join(userDataPath, 'sb-mig-gui.db')
  console.log('[Database] Opening database at:', dbPath)

  // Open database
  db = new Database(dbPath)

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')

  // Create settings table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  console.log('[Database] Database initialized successfully')
}

/**
 * Get a setting value by key (uses cache for performance)
 */
export function getSetting(key: string): string | null {
  // Check cache first
  if (settingsCache.has(key)) {
    return settingsCache.get(key) ?? null
  }

  if (!db) {
    console.error('[Database] Database not initialized')
    return null
  }

  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const row = stmt.get(key) as { value: string } | undefined
  const value = row?.value ?? null

  // Cache the result
  settingsCache.set(key, value)

  return value
}

/**
 * Set a setting value (also updates cache)
 */
export function setSetting(key: string, value: string): void {
  if (!db) {
    console.error('[Database] Database not initialized')
    return
  }

  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  stmt.run(key, value)

  // Update cache
  settingsCache.set(key, value)
}

/**
 * Delete a setting (also removes from cache)
 */
export function deleteSetting(key: string): void {
  if (!db) {
    console.error('[Database] Database not initialized')
    return
  }

  const stmt = db.prepare('DELETE FROM settings WHERE key = ?')
  stmt.run(key)

  // Remove from cache
  settingsCache.delete(key)
}

/**
 * Get all settings (for debugging)
 */
export function getAllSettings(): Record<string, string> {
  if (!db) {
    console.error('[Database] Database not initialized')
    return {}
  }

  const stmt = db.prepare('SELECT key, value FROM settings')
  const rows = stmt.all() as { key: string; value: string }[]

  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }

  return result
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    console.log('[Database] Closing database connection')
    db.close()
    db = null
  }
}

// Export singleton interface
export const databaseService = {
  init: initDatabase,
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
  close: closeDatabase,
}
