import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync("preview/funlink-phase-0-3-complete.html", "utf8");
for (const id of ["authScreen", "appScreen", "page", "modalbg", "toast"]) {
  assert.ok(html.includes('id="' + id + '"'), "Missing UI root: " + id);
}
for (const page of ["overview", "links", "domains", "campaigns", "qr", "analytics", "clicks", "api", "billing", "settings", "admin"]) {
  assert.ok(html.includes("'" + page + "'"), "Missing page renderer: " + page);
}
assert.ok(html.includes("function authMode"), "Login/register switch missing");
assert.ok(html.includes("function render"), "Page renderer missing");
console.log("FunLink Phase 0.3 preview checks passed.");
