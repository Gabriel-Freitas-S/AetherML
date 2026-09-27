// apps/web/src/lib/basemaps.ts — CARTO Basemaps raster (PNG) com API key via ?key= + OSM
// Formato Carto: https://{s}.basemaps.cartocdn.com/rastertiles/{style}/{z}/{x}/{y}.png?key=KEY

export const CARTO_API_KEY = "cb1_3q4i_1_207b38bc870f4a6872f384bf";

export const BASEMAP_STYLES = [
	"voyager",
	"dark_all",
	"positron",
	"osm",
] as const;
export type BasemapStyle = (typeof BASEMAP_STYLES)[number];

export const DEFAULT_BASEMAP: BasemapStyle = "voyager";

export const BASEMAP_LABELS: Record<BasemapStyle, string> = {
	voyager: "Voyager",
	dark_all: "Dark",
	positron: "Positron",
	osm: "OSM",
};

export function tileUrl(style: BasemapStyle): string {
	if (style === "osm") {
		return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
	}
	return `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`;
}
