import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";
import unocss from "unocss/astro";

export default defineConfig({
	integrations: [svelte(), unocss()],
	vite: {
		server: {
			headers: {
				"Cross-Origin-Opener-Policy": "same-origin",
				"Cross-Origin-Embedder-Policy": "require-corp",
			},
		},
		optimizeDeps: {
			exclude: ["onnxruntime-web"],
		},
	},
});
