import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envSrc = fs.readFileSync(path.join(ROOT, "api/_lib/env.js"), "utf8");
const doc = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");

/* The API reads its settings through env("NAME") / env("NAME", "default").
   A call without a second argument has no fallback and the whole API fails
   without it, so .env.example has to carry every one of them - and say which
   are which. The README tells people to add every variable from this file. */
const calls = [...envSrc.matchAll(/env\("([A-Z_0-9]+)"(,\s*"([^"]*)")?\)/g)];
const truth = calls.map((m) => ({ name: m[1], hasDefault: m[2] !== undefined, def: m[3] }));
const required = truth.filter((c) => !c.hasDefault).map((c) => c.name);

const lines = doc.split("\n");
const assigns = [...doc.matchAll(/^([A-Z_0-9]+)=(.*)$/gm)];
const listed = assigns.map((m) => m[1]);

// the comment block directly above an assignment describes that variable
const commentsAbove = (name) => {
  const i = lines.findIndex((l) => l.startsWith(name + "="));
  assert.ok(i >= 0, name + " is assigned in .env.example");
  const out = [];
  for (let j = i - 1; j >= 0 && lines[j].startsWith("#"); j--) out.unshift(lines[j]);
  return out.join("\n");
};

test(".env.example documents exactly the variables the API reads", () => {
  assert.ok(truth.length >= 10, "found the env() call sites, found " + truth.length);
  assert.deepEqual([...new Set(listed)].sort(), truth.map((c) => c.name).sort(), "same set of variables");
  assert.deepEqual(listed, [...new Set(listed)], "no variable is assigned twice");

  const extra = listed.filter((n) => !truth.some((c) => c.name === n));
  assert.deepEqual(extra, [], "nothing documented that the API never reads: " + extra);
  const missing = truth.map((c) => c.name).filter((n) => !listed.includes(n));
  assert.deepEqual(missing, [], "every variable the API reads is documented: " + missing);
});

test("every variable without a fallback is labelled REQUIRED", () => {
  for (const name of required) {
    assert.match(commentsAbove(name), /REQUIRED/, name + " has no default, so it must be marked REQUIRED");
  }
  // and a variable that does have a default must not claim otherwise
  for (const c of truth.filter((c) => c.hasDefault)) {
    assert.doesNotMatch(commentsAbove(c.name), /# REQUIRED/, c.name + " has a default and must not be marked REQUIRED");
  }
});

test("each documented default is the default the code actually uses", () => {
  for (const c of truth.filter((c) => c.hasDefault)) {
    const m = commentsAbove(c.name).match(/default "([^"]*)"/);
    assert.ok(m, c.name + " should state its default");
    assert.equal(m[1], c.def, c.name + ": documented default differs from api/_lib/env.js");
  }
});

test("a pasted line cannot carry a comment into the value", () => {
  // Vercel's form and some dotenv parsers keep everything after '=' verbatim,
  // so a trailing "# note" would become part of the secret
  const risky = lines.filter((l) => /^[A-Z_0-9]+=.*#/.test(l));
  assert.deepEqual(risky, [], "no value may be followed by a comment: " + risky);
  for (const m of assigns) {
    assert.equal(m[2], m[2].trim(), m[1] + " has stray whitespace around its value");
    assert.ok(m[2].length > 0, m[1] + " has a placeholder value to replace, not an empty one");
  }
});

test("the secret keys are never in the browser bundle", () => {
  const client = ["config.js", "member.js", "app.js", "index.html"]
    .map((f) => fs.readFileSync(path.join(ROOT, "public", f), "utf8")).join("\n");
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "PAYFAST_PASSPHRASE", "PAYFAST_MERCHANT_KEY"]) {
    assert.ok(!client.includes(name), name + " must stay server side");
  }
});
