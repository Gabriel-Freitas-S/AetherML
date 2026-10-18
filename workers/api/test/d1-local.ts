// workers/api/test/d1-local.ts — adaptador D1 local sobre node:sqlite para workers/api.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const DB_DIR = fileURLToPath(new URL("../../../db/", import.meta.url));

type Bindable = null | number | bigint | string | Uint8Array;

const bindable = (v: unknown): Bindable =>
	v === undefined ? null : (v as Bindable);

export function createSchema(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec(readFileSync(`${DB_DIR}migrations/0001_init.sql`, "utf8"));
	db.exec(readFileSync(`${DB_DIR}migrations/0002_observed_source.sql`, "utf8"));
	db.exec(
		readFileSync(`${DB_DIR}migrations/0003_observed_source_unique.sql`, "utf8"),
	);
	db.exec(readFileSync(`${DB_DIR}seed.sql`, "utf8"));
	return db;
}

function prepared(sqlite: DatabaseSync, sql: string, values: unknown[]) {
	const stmt = sqlite.prepare(sql);
	const args = values.map(bindable);
	return {
		bind(...more: unknown[]) {
			return prepared(sqlite, sql, [...values, ...more]);
		},
		async all<T = Record<string, unknown>>() {
			return {
				success: true as const,
				results: stmt.all(...args) as T[],
				meta: {},
			};
		},
		async first<T = unknown>(colName?: string) {
			const row = stmt.get(...args) as Record<string, unknown> | undefined;
			if (!row) return null;
			return (colName === undefined ? row : row[colName]) as T;
		},
		async run() {
			const r = stmt.run(...args);
			return {
				success: true as const,
				results: [],
				meta: {
					changes: Number(r.changes),
					last_row_id: Number(r.lastInsertRowid),
				},
			};
		},
	};
}

export interface LocalD1 {
	db: D1Database;
	sqlite: DatabaseSync;
	close(): void;
}

export function localD1(sqlite: DatabaseSync): LocalD1 {
	const db = {
		prepare: (sql: string) => prepared(sqlite, sql, []),
		batch: async (statements: unknown[]) => {
			const out = [];
			for (const s of statements as Array<ReturnType<typeof prepared>>) {
				out.push(await s.run());
			}
			return out;
		},
	} as unknown as D1Database;

	return {
		db,
		sqlite,
		close: () => sqlite.close(),
	};
}
