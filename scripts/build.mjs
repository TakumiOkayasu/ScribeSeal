import { chmod, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outfile = "dist/scribeseal.mjs";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  minify: true,
  target: "node24",
  outfile,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __scribesealCreateRequire } from "node:module"; const require = __scribesealCreateRequire(import.meta.url);',
  },
});

const bundled = await readFile(outfile, "utf8");
await writeFile(outfile, bundled.replace(/[ \t]+$/gm, ""), "utf8");

if (process.platform !== "win32") {
  await chmod(outfile, 0o755);
}
