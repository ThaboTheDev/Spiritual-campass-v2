#!/usr/bin/env node
// Copy the Content-Security-Policy strings from the code into vercel.json.
//
// Vercel serves public/ straight from the filesystem, so the CSP the browser gets
// is the one in vercel.json - the constant in api/_lib/security/headers.js only
// reaches responses the API writes itself. Two copies of one policy drift apart
// the moment somebody edits one of them, so vercel.json is never hand-edited:
//
//     npm run sync:csp
//
// tests/unit/security.test.js then fails the build if the file and the constants
// disagree, which is what makes this script the only way to change the policy.
//
// The header blocks are found by their `source`, and only the
// Content-Security-Policy value inside each one is rewritten: the cache rules,
// HSTS and the other headers are left exactly as they are.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRIVACY_CONTENT_SECURITY_POLICY,
  SITE_CONTENT_SECURITY_POLICY,
} from "../api/_lib/security/headers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "vercel.json");

/* Which policy belongs to which block. /privacy and /privacy.html are the same
   page with and without cleanUrls, so they carry the stricter privacy policy. */
const BLOCKS = [
  { source: "/(.*)", policy: SITE_CONTENT_SECURITY_POLICY, why: "the app" },
  { source: "/privacy", policy: PRIVACY_CONTENT_SECURITY_POLICY, why: "the privacy notice" },
  { source: "/privacy.html", policy: PRIVACY_CONTENT_SECURITY_POLICY, why: "the privacy notice" },
];

const config = JSON.parse(fs.readFileSync(FILE, "utf8"));
if (!Array.isArray(config.headers)) {
  console.error("vercel.json has no headers array; nothing to sync.");
  process.exit(1);
}

const changed = [];
for (const { source, policy, why } of BLOCKS) {
  const block = config.headers.find((h) => h && h.source === source);
  if (!block || !Array.isArray(block.headers)) {
    console.error(`vercel.json has no header block for "${source}" (${why}).`);
    process.exit(1);
  }
  const header = block.headers.find((h) => h && h.key === "Content-Security-Policy");
  if (!header) {
    console.error(`the "${source}" block has no Content-Security-Policy header (${why}).`);
    process.exit(1);
  }
  if (header.value === policy) continue;
  header.value = policy;
  changed.push({ source, why, policy });
}

if (!changed.length) {
  console.log("vercel.json already matches the CSP constants.");
  process.exit(0);
}

/* Rewritten whole: one JSON.stringify keeps the file machine-generated, so a diff
   in it is always a policy change and never somebody's formatting. */
fs.writeFileSync(FILE, JSON.stringify(config, null, 2) + "\n");

for (const { source, why, policy } of changed) {
  const connect = (policy.match(/connect-src [^;]*/) || ["connect-src (none)"])[0];
  console.log(`updated ${source} (${why}): ${connect}`);
}
console.log(`vercel.json written: ${changed.length} header block${changed.length === 1 ? "" : "s"} updated.`);
