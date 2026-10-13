// Reading requests, once.
//
// Every handler used to grow its own copy of "read the body, guess the shape,
// remember to cap the size". This module owns that:
//   · readRaw  — the bytes, capped, whether the platform parsed them or not
//   · readJson — the bytes as an object, with the content-type checked first
//   · bearer / clientIp — the two request fields the whole server reads

import { BODY_LIMIT, JSON_CONTENT_TYPES } from "../config/policy.js";
import { badRequest, tooLarge, unsupportedMedia } from "./errors.js";

/* PayFast's signature depends on the field order, so errors must not lose bytes:
   the raw text is returned untouched. */
export async function readRaw(req, { maxBytes = BODY_LIMIT.json } = {}) {
  const declared = Number(req.headers && req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  if (typeof req.rawBody === "string") return cap(req.rawBody, maxBytes);
  if (Buffer.isBuffer(req.rawBody)) return cap(req.rawBody.toString("utf8"), maxBytes);

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      if (size > maxBytes) throw tooLarge();
      chunks.push(bytes);
    }
  } catch (e) {
    if (e && e.status) throw e;                 // the size check above
    /* the stream was already consumed by the platform: fall through to req.body */
  }
  if (chunks.length) return Buffer.concat(chunks, size).toString("utf8");
  return fromParsedBody(req.body, maxBytes);
}

function cap(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw tooLarge();
  return text;
}

function fromParsedBody(body, maxBytes) {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return cap(body, maxBytes);
  if (Buffer.isBuffer(body)) return cap(body.toString("utf8"), maxBytes);
  if (typeof body === "object") return cap(new URLSearchParams(body).toString(), maxBytes);
  return "";
}

/* The part of content-type before the parameters, lowercased. */
export function mediaType(req) {
  return String((req.headers && req.headers["content-type"]) || "").split(";")[0].trim().toLowerCase();
}

export async function readJson(req, { maxBytes = BODY_LIMIT.json, contentTypes = JSON_CONTENT_TYPES } = {}) {
  if (!contentTypes.includes(mediaType(req))) throw unsupportedMedia();
  const raw = (await readRaw(req, { maxBytes })).trim();
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw badRequest("invalid_json"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw badRequest("invalid_json");
  return parsed;
}

export function bearer(req) {
  const header = String((req.headers && req.headers.authorization) || "").trim();
  if (header.length > 8192) return null;                 // no legitimate token is this long
  const m = /^Bearer\s+(\S+)$/.exec(header);
  return m ? m[1] : null;
}

/* Vercel terminates TLS and forwards the client address. The first entry of
   x-forwarded-for is the caller; the rest are proxies. */
export function clientIp(req) {
  const forwarded = String((req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0].trim();
  const real = req.headers && req.headers["x-real-ip"];
  const direct = req.socket && req.socket.remoteAddress;
  return forwarded || real || direct || "";
}
