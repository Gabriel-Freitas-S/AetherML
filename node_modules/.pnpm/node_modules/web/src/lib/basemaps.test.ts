import assert from "node:assert/strict";
import { test } from "node:test";
import { CARTO_API_KEY, DEFAULT_BASEMAP, tileUrl } from "./basemaps.ts";

test("tileUrl usa endpoint rastertiles com ?key= (sem watermark)", () => {
	const url = tileUrl("voyager");
	assert.equal(
		url,
		`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,
	);
	assert.ok(!url.includes("api_key"), "não deve usar api_key legado");
	assert.ok(url.includes("?key="), "deve usar ?key=");
	assert.ok(url.includes("/rastertiles/"), "deve usar /rastertiles/");
});

test("tileUrl suporta dark_all e positron com a mesma key", () => {
	for (const style of ["dark_all", "positron"] as const) {
		const url = tileUrl(style);
		assert.ok(
			url.startsWith(`https://basemaps.cartocdn.com/rastertiles/${style}/`),
			style,
		);
		assert.ok(url.endsWith(`?key=${CARTO_API_KEY}`), style);
	}
});

test("API key fixada e estilo padrão é voyager", () => {
	assert.equal(CARTO_API_KEY, "cb1_3q4i_1_207b38bc870f4a6872f384bf");
	assert.equal(DEFAULT_BASEMAP, "voyager");
});
