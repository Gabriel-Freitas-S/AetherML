// workers/ingestion/test/d1-local.ts — adaptador D1 local sobre `node:sqlite`.
//
// D1 é SQLite; `node:sqlite` é o mesmo motor. Serve para exercitar `ingest()`
// contra um banco de verdade (UNIQUE, ON CONFLICT, atomicidade de batch) sem
// subir `wrangler dev` e sem tocar em nenhum estado compartilhado ou remoto.
// O DDL vem de db/migrations/*.sql — apenas LIDO, nunca aplicado por aqui.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB_DIR = fileURLToPath(new URL("../../../db/", import.meta.url));

type Bindable = null | number | bigint | string | Uint8Array;

/** `node:sqlite` (como D1) rejeita `undefined` como parâmetro: vira NULL. */
const bindable = (v: unknown): Bindable => (v === undefined ? null : (v as Bindable));

/** Cria um SQLite em memória com o schema canônico de `db/migrations`. */
export function createSchema(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	// Leitura dos DDL versionados; 0002 é o ALTER que adiciona `source`.
	db.exec(readFileSync(`${DB_DIR}migrations/0001_init.sql`, "utf8"));
	db.exec(readFileSync(`${DB_DIR}migrations/0002_observed_source.sql`, "utf8"));
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
			return { success: true as const, results: stmt.all(...args) as T[], meta: {} };
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
				meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
			};
		},
	};
}

export interface LocalD1 {
	db: D1Database;
	sqlite: DatabaseSync;
	close(): void;
}

/** Envolve um `DatabaseSync` na interface D1 que `ingest()` consome. */
export function localD1(sqlite: DatabaseSync): LocalD1 {
	let queue: Promise<unknown> = Promise.resolve();
	const db = {
		prepare: (sql: string) => prepared(sqlite, sql, []),
		// D1 garante atomicidade: `batch` roda tudo numa transação só. E o D1
		// real serializa escritas por database (uma transação de escrita por vez).
		// `ingest()` dispara as 9 estações em paralelo, então esta fila é o que
		// reproduz o servidor: sem ela, `BEGIN` aninhado estoura no SQLite local.
		batch(statements: unknown[]) {
			const run = queue.then(async () => {
				sqlite.exec("BEGIN");
				try {
					const out = [];
					for (const s of statements as Array<ReturnType<typeof prepared>>) {
						out.push(await s.run());
					}
					sqlite.exec("COMMIT");
					return out;
				} catch (err) {
					sqlite.exec("ROLLBACK");
					throw err;
				}
			});
			// A fila não pode envenenar: um batch falhado libera a próxima.
			queue = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		},
		async exec(sql: string) {
			sqlite.exec(sql);
			return { count: 0, duration: 0 };
		},
		async dump() {
			return new ArrayBuffer(0);
		},
	};
	return { db: db as unknown as D1Database, sqlite, close: () => sqlite.close() };
}
