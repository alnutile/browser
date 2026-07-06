// Inlines the real API-captured screenshot (shot.png) into the deck template,
// producing a single self-contained deck/short.html.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const tpl = readFileSync(path.join(dir, "short.template.html"), "utf8");
const png = readFileSync(path.join(dir, "shot.png"));
const dataUri = "data:image/png;base64," + png.toString("base64");

const out = tpl.replace("__SHOT__", dataUri);
writeFileSync(path.join(dir, "short.html"), out);
console.log("wrote short.html:", out.length, "bytes (screenshot inlined:", png.length, "bytes)");
