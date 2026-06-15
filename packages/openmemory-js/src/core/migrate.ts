import { env } from "./cfg";
import sqlite3 from "sqlite3";
import { Pool, PoolClient } from "pg";

const is_pg = env.metadata_backend === "postgres";
const POSTGRES_SCHEMA_VERSION = "1.5.4";
const MIGRATION_LOCK_KEY = "openmemory-js-migrations";

const log = (msg: string) => console.log(`[MIGRATE] ${msg}`);

interface Migration {
    version: string;
    desc: string;
    sqlite: string[];
}

const sqlite_migrations: Migration[] = [
    {
        version: "1.2.0",
        desc: "Multi-user tenant support",
        sqlite: [
            `ALTER TABLE memories ADD COLUMN user_id TEXT`,
            `CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id)`,
            `ALTER TABLE vectors ADD COLUMN user_id TEXT`,
            `CREATE INDEX IF NOT EXISTS idx_vectors_user ON vectors(user_id)`,
            `CREATE TABLE IF NOT EXISTS waypoints_new (
        src_id TEXT, dst_id TEXT NOT NULL, user_id TEXT,
        weight REAL NOT NULL, created_at INTEGER, updated_at INTEGER,
        PRIMARY KEY(src_id, user_id)
      )`,
            `INSERT INTO waypoints_new SELECT src_id, dst_id, NULL, weight, created_at, updated_at FROM waypoints`,
            `DROP TABLE waypoints`,
            `ALTER TABLE waypoints_new RENAME TO waypoints`,
            `CREATE INDEX IF NOT EXISTS idx_waypoints_src ON waypoints(src_id)`,
            `CREATE INDEX IF NOT EXISTS idx_waypoints_dst ON waypoints(dst_id)`,
            `CREATE INDEX IF NOT EXISTS idx_waypoints_user ON waypoints(user_id)`,
            `CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY, summary TEXT,
        reflection_count INTEGER DEFAULT 0,
        created_at INTEGER, updated_at INTEGER
      )`,
            `CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, count INTEGER DEFAULT 1, ts INTEGER NOT NULL
      )`,
            `CREATE INDEX IF NOT EXISTS idx_stats_ts ON stats(ts)`,
            `CREATE INDEX IF NOT EXISTS idx_stats_type ON stats(type)`,
            `ALTER TABLE memories ADD COLUMN agent_id TEXT DEFAULT NULL`,
            `ALTER TABLE memories ADD COLUMN session_id TEXT DEFAULT NULL`,
            `CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id)`,
            `CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`,
            `ALTER TABLE temporal_facts ADD COLUMN agent_id TEXT DEFAULT NULL`,
            `ALTER TABLE temporal_facts ADD COLUMN session_id TEXT DEFAULT NULL`,
            `CREATE INDEX IF NOT EXISTS idx_temporal_facts_agent ON temporal_facts(agent_id)`,
            `CREATE INDEX IF NOT EXISTS idx_temporal_facts_session ON temporal_facts(session_id)`,
            `ALTER TABLE temporal_edges ADD COLUMN agent_id TEXT DEFAULT NULL`,
            `ALTER TABLE temporal_edges ADD COLUMN session_id TEXT DEFAULT NULL`,
            `CREATE INDEX IF NOT EXISTS idx_temporal_edges_agent ON temporal_edges(agent_id)`,
            `CREATE INDEX IF NOT EXISTS idx_temporal_edges_session ON temporal_edges(session_id)`,
        ],
    },
];

const quote_ident = (value: string) => `"${value.replace(/"/g, '""')}"`;

const table = (schema: string, name: string) => `${quote_ident(schema)}.${quote_ident(name)}`;

async function get_db_version_sqlite(
    db: sqlite3.Database,
): Promise<string | null> {
    return new Promise((ok, no) => {
        db.get(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`,
            (err, row: any) => {
                if (err) return no(err);
                if (!row) return ok(null);
                db.get(
                    `SELECT version FROM schema_version ORDER BY applied_at DESC LIMIT 1`,
                    (e, v: any) => {
                        if (e) return no(e);
                        ok(v?.version || null);
                    },
                );
            },
        );
    });
}

async function set_db_version_sqlite(
    db: sqlite3.Database,
    version: string,
): Promise<void> {
    return new Promise((ok, no) => {
        db.run(
            `CREATE TABLE IF NOT EXISTS schema_version (
        version TEXT PRIMARY KEY, applied_at INTEGER
      )`,
            (err) => {
                if (err) return no(err);
                db.run(
                    `INSERT OR REPLACE INTO schema_version VALUES (?, ?)`,
                    [version, Date.now()],
                    (e) => {
                        if (e) return no(e);
                        ok();
                    },
                );
            },
        );
    });
}

async function check_column_exists_sqlite(
    db: sqlite3.Database,
    table: string,
    column: string,
): Promise<boolean> {
    return new Promise((ok, no) => {
        db.all(`PRAGMA table_info(${table})`, (err, rows: any[]) => {
            if (err) return no(err);
            ok(rows.some((r) => r.name === column));
        });
    });
}

async function run_sqlite_migration(
    db: sqlite3.Database,
    m: Migration,
): Promise<void> {
    log(`Running migration: ${m.version} - ${m.desc}`);

    const has_user_id = await check_column_exists_sqlite(
        db,
        "memories",
        "user_id",
    );
    if (has_user_id) {
        log(
            `Migration ${m.version} already applied (user_id exists), skipping`,
        );
        await set_db_version_sqlite(db, m.version);
        return;
    }

    for (const sql of m.sqlite) {
        await new Promise<void>((ok, no) => {
            db.run(sql, (err) => {
                if (err && !err.message.includes("duplicate column")) {
                    log(`ERROR: ${err.message}`);
                    return no(err);
                }
                ok();
            });
        });
    }

    await set_db_version_sqlite(db, m.version);
    log(`Migration ${m.version} completed successfully`);
}

async function set_db_version_pg(client: PoolClient, version: string): Promise<void> {
    const schema = process.env.OM_PG_SCHEMA || "public";
    await client.query(
        `CREATE TABLE IF NOT EXISTS ${table(schema, "schema_version")} (
      version TEXT PRIMARY KEY, applied_at BIGINT
    )`,
    );
    await client.query(
        `INSERT INTO ${table(schema, "schema_version")} VALUES ($1, $2)
     ON CONFLICT (version) DO UPDATE SET applied_at = EXCLUDED.applied_at`,
        [version, Date.now()],
    );
}

function get_pg_table_names() {
    const schema = process.env.OM_PG_SCHEMA || "public";
    const memories = process.env.OM_PG_TABLE || "openmemory_memories";
    const vectors = process.env.OM_VECTOR_TABLE || "openmemory_vectors";

    return {
        schema,
        memories,
        vectors,
        memories_table: table(schema, memories),
        vectors_table: table(schema, vectors),
        waypoints_table: table(schema, "openmemory_waypoints"),
        embed_logs_table: table(schema, "openmemory_embed_logs"),
        users_table: table(schema, "openmemory_users"),
        stats_table: table(schema, "stats"),
        temporal_facts_table: table(schema, "temporal_facts"),
        temporal_edges_table: table(schema, "temporal_edges"),
    };
}

function get_pg_schema_statements(): string[] {
    const t = get_pg_table_names();
    const vector_column_type = env.use_pgvector ? "vector(1024)" : "bytea";

    return [
        `CREATE SCHEMA IF NOT EXISTS ${quote_ident(t.schema)}`,
        ...(env.use_pgvector ? [`CREATE EXTENSION IF NOT EXISTS vector`] : []),
        `CREATE TABLE IF NOT EXISTS ${t.memories_table}(id uuid primary key,user_id text,agent_id text,session_id text,segment integer default 0,content text not null,simhash text,primary_sector text not null,tags text,meta text,created_at bigint,updated_at bigint,last_seen_at bigint,salience double precision,decay_lambda double precision,version integer default 1,mean_dim integer,mean_vec bytea,compressed_vec bytea,feedback_score double precision default 0)`,
        `CREATE TABLE IF NOT EXISTS ${t.vectors_table}(id uuid,sector text,user_id text,agent_id text,session_id text,v ${vector_column_type},dim integer not null,primary key(id,sector))`,
        `CREATE TABLE IF NOT EXISTS ${t.waypoints_table}(src_id text,dst_id text not null,user_id text,weight double precision not null,created_at bigint,updated_at bigint,primary key(src_id,user_id))`,
        `CREATE TABLE IF NOT EXISTS ${t.embed_logs_table}(id text primary key,model text,status text,ts bigint,err text)`,
        `CREATE TABLE IF NOT EXISTS ${t.users_table}(user_id text primary key,summary text,reflection_count integer default 0,created_at bigint,updated_at bigint)`,
        `CREATE TABLE IF NOT EXISTS ${t.stats_table}(id serial primary key,type text not null,count integer default 1,ts bigint not null)`,
        `CREATE TABLE IF NOT EXISTS ${t.temporal_facts_table}(id uuid primary key,subject text not null,predicate text not null,object text not null,valid_from bigint not null,valid_to bigint,confidence double precision not null check(confidence >= 0 and confidence <= 1),last_updated bigint not null,metadata text,user_id text,agent_id text,session_id text)`,
        `CREATE TABLE IF NOT EXISTS ${t.temporal_edges_table}(id uuid primary key,source_id uuid not null,target_id uuid not null,relation_type text not null,valid_from bigint not null,valid_to bigint,weight double precision not null,metadata text,user_id text,agent_id text,session_id text,foreign key(source_id) references ${t.temporal_facts_table}(id),foreign key(target_id) references ${t.temporal_facts_table}(id))`,
        `ALTER TABLE ${t.memories_table} ADD COLUMN IF NOT EXISTS user_id TEXT`,
        `ALTER TABLE ${t.memories_table} ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT NULL`,
        `ALTER TABLE ${t.memories_table} ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT NULL`,
        `ALTER TABLE ${t.vectors_table} ADD COLUMN IF NOT EXISTS user_id TEXT`,
        `ALTER TABLE ${t.vectors_table} ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT NULL`,
        `ALTER TABLE ${t.vectors_table} ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT NULL`,
        `ALTER TABLE ${t.waypoints_table} ADD COLUMN IF NOT EXISTS user_id TEXT`,
        `ALTER TABLE ${t.temporal_facts_table} ADD COLUMN IF NOT EXISTS user_id TEXT`,
        `ALTER TABLE ${t.temporal_facts_table} ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT NULL`,
        `ALTER TABLE ${t.temporal_facts_table} ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT NULL`,
        `ALTER TABLE ${t.temporal_edges_table} ADD COLUMN IF NOT EXISTS user_id TEXT`,
        `ALTER TABLE ${t.temporal_edges_table} ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT NULL`,
        `ALTER TABLE ${t.temporal_edges_table} ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT NULL`,
    ];
}

function get_pg_index_statements(): string[] {
    const t = get_pg_table_names();

    return [
        ...(env.use_pgvector
            ? [`CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_vectors_hnsw_idx ON ${t.vectors_table} USING hnsw (v vector_cosine_ops) WITH (m = 16, ef_construction = 64)`]
            : []),
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_facts_subject_idx ON ${t.temporal_facts_table}(subject)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_facts_predicate_idx ON ${t.temporal_facts_table}(predicate)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_facts_validity_idx ON ${t.temporal_facts_table}(valid_from,valid_to)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_facts_composite_idx ON ${t.temporal_facts_table}(subject,predicate,valid_from,valid_to)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_facts_user_idx ON ${t.temporal_facts_table}(user_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_facts_user_subject_pred_idx ON ${t.temporal_facts_table}(user_id,subject,predicate,valid_from,valid_to)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_facts_object_idx ON ${t.temporal_facts_table}(object)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_edges_source_idx ON ${t.temporal_edges_table}(source_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_edges_user_idx ON ${t.temporal_edges_table}(user_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_edges_target_idx ON ${t.temporal_edges_table}(target_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS temporal_edges_validity_idx ON ${t.temporal_edges_table}(valid_from,valid_to)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_memories_sector_idx ON ${t.memories_table}(primary_sector)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_memories_segment_idx ON ${t.memories_table}(segment)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_memories_simhash_idx ON ${t.memories_table}(simhash)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_memories_user_idx ON ${t.memories_table}(user_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_memories_agent_idx ON ${t.memories_table}(agent_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_memories_session_idx ON ${t.memories_table}(session_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_temporal_facts_agent_idx ON ${t.temporal_facts_table}(agent_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_temporal_facts_session_idx ON ${t.temporal_facts_table}(session_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_temporal_edges_agent_idx ON ${t.temporal_edges_table}(agent_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_temporal_edges_session_idx ON ${t.temporal_edges_table}(session_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_vectors_user_idx ON ${t.vectors_table}(user_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_waypoints_user_idx ON ${t.waypoints_table}(user_id)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_stats_ts_idx ON ${t.stats_table}(ts)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS openmemory_stats_type_idx ON ${t.stats_table}(type)`,
    ];
}

async function run_pg_migrations(pool: Pool): Promise<void> {
    const client = await pool.connect();
    let lock_acquired = false;

    try {
        await client.query(`SET lock_timeout = '5s'`);
        await client.query(`SET statement_timeout = '30min'`);

        const lock = await client.query(
            `SELECT pg_try_advisory_lock(hashtext($1::text)) AS locked`,
            [MIGRATION_LOCK_KEY],
        );
        lock_acquired = Boolean(lock.rows[0]?.locked);

        if (!lock_acquired) {
            throw new Error("Another OpenMemory migration is already running");
        }

        log("Running Postgres schema migrations");
        for (const sql of get_pg_schema_statements()) {
            await client.query(sql);
        }

        log("Running Postgres concurrent index migrations");
        for (const sql of get_pg_index_statements()) {
            await client.query(sql);
        }

        await set_db_version_pg(client, POSTGRES_SCHEMA_VERSION);
        log(`Postgres migrations completed successfully (${POSTGRES_SCHEMA_VERSION})`);
    } finally {
        if (lock_acquired) {
            await client.query(`SELECT pg_advisory_unlock(hashtext($1::text))`, [
                MIGRATION_LOCK_KEY,
            ]);
        }
        client.release();
    }
}

export async function run_migrations() {
    log("Checking for pending migrations...");

    if (is_pg) {
        const ssl =
            process.env.OM_PG_SSL === "require"
                ? { rejectUnauthorized: false }
                : process.env.OM_PG_SSL === "disable"
                  ? false
                  : undefined;

        const pool = new Pool({
            host: process.env.OM_PG_HOST,
            port: process.env.OM_PG_PORT ? +process.env.OM_PG_PORT : undefined,
            database: process.env.OM_PG_DB || "openmemory",
            user: process.env.OM_PG_USER,
            password: process.env.OM_PG_PASSWORD,
            ssl,
        });

        try {
            await run_pg_migrations(pool);
        } finally {
            await pool.end();
        }
    } else {
        const db_path = process.env.OM_DB_PATH || "./data/openmemory.sqlite";
        const db = new sqlite3.Database(db_path);

        const current = await get_db_version_sqlite(db);
        log(`Current database version: ${current || "none"}`);

        for (const m of sqlite_migrations) {
            if (!current || m.version > current) {
                await run_sqlite_migration(db, m);
            }
        }

        await new Promise<void>((ok) => db.close(() => ok()));
    }

    log("All migrations completed");
}
