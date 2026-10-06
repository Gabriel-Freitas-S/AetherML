// apps/web/scripts/gen-sw-version.mjs — carimba a versão dos caches do Service Worker.
//
// Sem isso os nomes ficam presos a "v3": o SW nunca rotaciona entre deploys e um
// visitante cujo NetworkFirst falhou continua recebendo o bundle antigo para sempre.
// O carimbo entra no bundle do próprio SW, então trocar de deploy invalida os caches.
//
// Executado por `build:sw` (ver package.json) antes do esbuild.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "src", "generated", "cache-version.ts");

const pad = (n) => String(n).padStart(2, "0");

function stamp() {
	const d = new Date();
	const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
	const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
	return `${date}T${time}Z`;
}

const body = `// GERADO por scripts/gen-sw-version.mjs — não editar à mão.
// Regenerado a cada build por \`build:sw\`; commitar para que \`astro build\`
// funcione mesmo sem o prebuild.
export const CACHE_VERSION = "${stamp()}";
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, body, "utf8");
console.log(`[gen-sw-version] CACHE_VERSION = ${stamp()} -> ${outFile}`);
