import { readFile, writeFile } from "node:fs/promises";
const source = await readFile(new URL("../lib/person-comparison.mjs", import.meta.url), "utf8");
await writeFile(new URL("../miniapp/lib/person-comparison.js", import.meta.url), source.replaceAll("export function ", "function ") + "\nmodule.exports = { comparisonSelection, buildPersonComparison };\n");
