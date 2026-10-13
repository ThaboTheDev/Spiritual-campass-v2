// One object that is every table the server uses.
//
// services/* and domain/itn.js receive this as their only way of touching data, so
// a test can hand them an in-memory stand-in (tests/unit/helpers.js does exactly
// that) and no handler ever builds a REST path itself.

import { members, ensureMember } from "./members.js";
import { centres } from "./centres.js";
import { payments } from "./payments.js";
import { auditLog } from "./audit.js";
import { rateLimits } from "./rate-limits.js";
import { revenuecatEvents } from "./revenuecat-events.js";

export const db = Object.freeze({
  ...members,
  ...centres,
  ...payments,
  ...auditLog,
  ...rateLimits,
  ...revenuecatEvents,
});

export { ensureMember };
