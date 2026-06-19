"use client"

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js"

let SQL: SqlJsStatic | null = null
let db: Database | null = null

async function getSQL(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file: string) =>
        process.env.NEXT_PUBLIC_SQLITE_WASM ?? `/${file}`,
    })
  }
  return SQL
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined"
}

function getPersistKey(): string {
  return `pharmacy-sqlite-db`
}

async function getDB(): Promise<Database> {
  if (!isBrowser()) throw new Error("SQLite only available in browser")

  if (db) return db

  const sql = await getSQL()
  const saved = localStorage.getItem(getPersistKey())

  if (saved) {
    const buffer = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0))
    db = new sql.Database(buffer)
  } else {
    db = new sql.Database()
  }

  initTables(db)
  return db
}

function initTables(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS local_documents (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_local_docs_type ON local_documents(doc_type);
    CREATE INDEX IF NOT EXISTS idx_local_docs_synced ON local_documents(synced);

    CREATE TABLE IF NOT EXISTS local_mutations (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      retries INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mutations_table ON local_mutations(table_name);

    CREATE TABLE IF NOT EXISTS local_cache (
      cache_key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_expires ON local_cache(expires_at);

    CREATE TABLE IF NOT EXISTS local_sync_state (
      table_name TEXT PRIMARY KEY,
      last_sync_at TEXT,
      last_row_version INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS local_offline_sales (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS local_offline_purchases (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_settings (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pharmacy_settings_lookup ON pharmacy_settings(pharmacy_id, key);

    CREATE TABLE IF NOT EXISTS pharmacy_branches (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      district TEXT,
      city TEXT,
      country TEXT,
      postal_code TEXT,
      phone TEXT,
      email TEXT,
      manager_name TEXT,
      manager_phone TEXT,
      tax_id TEXT,
      commercial_register TEXT,
      notes TEXT,
      is_default INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_invoice_designs (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      name TEXT NOT NULL,
      template TEXT DEFAULT 'standard',
      is_default INTEGER DEFAULT 0,
      show_logo INTEGER DEFAULT 1,
      show_header INTEGER DEFAULT 1,
      header_text TEXT,
      header_subtitle_1 TEXT,
      header_subtitle_2 TEXT,
      header_subtitle_3 TEXT,
      show_footer INTEGER DEFAULT 1,
      footer_text TEXT,
      show_barcode INTEGER DEFAULT 1,
      show_qr INTEGER DEFAULT 1,
      qr_enabled INTEGER DEFAULT 1,
      qr_show_business_name INTEGER DEFAULT 1,
      qr_show_invoice_no INTEGER DEFAULT 1,
      qr_show_date INTEGER DEFAULT 1,
      qr_show_total INTEGER DEFAULT 1,
      qr_show_tax INTEGER DEFAULT 1,
      show_tax INTEGER DEFAULT 1,
      show_discount INTEGER DEFAULT 1,
      show_customer_info INTEGER DEFAULT 1,
      show_customer_id INTEGER DEFAULT 0,
      show_customer_tax INTEGER DEFAULT 1,
      show_phone INTEGER DEFAULT 1,
      show_address INTEGER DEFAULT 1,
      show_shipping INTEGER DEFAULT 0,
      show_item_image INTEGER DEFAULT 0,
      show_item_code INTEGER DEFAULT 1,
      show_item_brand INTEGER DEFAULT 0,
      show_item_unit INTEGER DEFAULT 1,
      show_total_qty INTEGER DEFAULT 1,
      show_payment_info INTEGER DEFAULT 1,
      show_total_in_words INTEGER DEFAULT 1,
      show_signature INTEGER DEFAULT 0,
      show_currency INTEGER DEFAULT 1,
      paper_size TEXT DEFAULT 'A4',
      font_family TEXT DEFAULT 'Cairo',
      font_size INTEGER DEFAULT 12,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_tax_rates (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rate REAL NOT NULL,
      rate_type TEXT DEFAULT 'percent',
      is_default INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_tax_groups (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      tax_rate_ids TEXT,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_tax_group_members (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      tax_rate_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_barcode_paper_settings (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      name TEXT NOT NULL,
      page_width REAL,
      page_height REAL,
      left_margin REAL,
      right_margin REAL,
      top_margin REAL,
      bottom_margin REAL,
      label_width REAL,
      label_height REAL,
      columns INTEGER,
      rows INTEGER,
      gap_horizontal REAL,
      gap_vertical REAL,
      font_size INTEGER,
      barcode_symbology TEXT,
      show_price INTEGER DEFAULT 1,
      show_name INTEGER DEFAULT 1,
      show_barcode INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_receipt_printers (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      name TEXT NOT NULL,
      printer_type TEXT DEFAULT 'thermal',
      interface_type TEXT DEFAULT 'usb',
      ip_address TEXT,
      port INTEGER DEFAULT 9100,
      paper_width INTEGER DEFAULT 80,
      characters_per_line INTEGER DEFAULT 42,
      is_default INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_notification_templates (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      scenario TEXT NOT NULL,
      name TEXT NOT NULL,
      channel TEXT DEFAULT 'in_app',
      subject TEXT,
      body TEXT NOT NULL,
      tags TEXT DEFAULT '',
      auto_send INTEGER DEFAULT 1,
      variables TEXT,
      is_default INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pharmacy_backups (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL,
      name TEXT NOT NULL,
      file_size INTEGER,
      type TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

function persist(): void {
  if (!db) return
  const data = db.export()
  const hex = Array.from(data)
    .map((b: number) => String.fromCharCode(b))
    .join("")
  try {
    localStorage.setItem(getPersistKey(), btoa(hex))
  } catch {
    /* localStorage full - suppress */
  }
}

export const localSQLite = {
  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    const database = await getDB()
    const stmt = database.prepare(sql)
    if (params) stmt.bind(params)
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  },

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const database = await getDB()
    if (params) {
      database.run(sql, params)
    } else {
      database.run(sql)
    }
    persist()
  },

  async insert(table: string, data: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(data)
    const cols = keys.join(", ")
    const placeholders = keys.map(() => "?").join(", ")
    const values = keys.map((k) => data[k])
    await this.execute(
      `INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${placeholders})`,
      values,
    )
  },

  async getAll(table: string, where?: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    let sql = `SELECT * FROM ${table}`
    if (where) sql += ` WHERE ${where}`
    return this.query(sql, params)
  },

  async getById(table: string, id: string): Promise<Record<string, unknown> | null> {
    const results = await this.query(`SELECT * FROM ${table} WHERE id = ?`, [id])
    return results[0] ?? null
  },

  async delete(table: string, id: string): Promise<void> {
    await this.execute(`DELETE FROM ${table} WHERE id = ?`, [id])
  },

  async getUnsynced(table = "local_documents"): Promise<Record<string, unknown>[]> {
    return this.query(`SELECT * FROM ${table} WHERE synced = 0 ORDER BY created_at ASC`)
  },

  async markSynced(id: string, table = "local_documents"): Promise<void> {
    await this.execute(
      `UPDATE ${table} SET synced = 1, updated_at = datetime('now') WHERE id = ?`,
      [id],
    )
  },

  async getCache(key: string): Promise<unknown | null> {
    const rows = await this.query(
      `SELECT data FROM local_cache WHERE cache_key = ? AND expires_at > ?`,
      [key, Date.now()],
    )
    if (!rows[0]) return null
    return JSON.parse(rows[0].data as string)
  },

  async setCache(key: string, data: unknown, ttlMs = 300000): Promise<void> {
    await this.execute(
      `INSERT OR REPLACE INTO local_cache (cache_key, data, expires_at) VALUES (?, ?, ?)`,
      [key, JSON.stringify(data), Date.now() + ttlMs],
    )
  },

  async clearCache(): Promise<void> {
    await this.execute(`DELETE FROM local_cache WHERE expires_at < ?`, [Date.now()])
  },

  async getLastSync(table: string): Promise<string | null> {
    const rows = await this.query(
      `SELECT last_sync_at FROM local_sync_state WHERE table_name = ?`,
      [table],
    )
    return (rows[0]?.last_sync_at as string) ?? null
  },

  async setLastSync(table: string, version: number): Promise<void> {
    await this.execute(
      `INSERT OR REPLACE INTO local_sync_state (table_name, last_sync_at, last_row_version) VALUES (?, datetime('now'), ?)`,
      [table, version],
    )
  },

  async getStorageSize(): Promise<number> {
    if (!db) return 0
    return db.export().length
  },

  async reset(): Promise<void> {
    if (db) {
      db.close()
      db = null
    }
    localStorage.removeItem(getPersistKey())
  },

  async tableExists(name: string): Promise<boolean> {
    const rows = await this.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [name],
    )
    return rows.length > 0
  },
}
