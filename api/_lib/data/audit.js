// The append-only audit trail (table: audit_log).
//
// Only identifiers we cannot avoid are stored, and they are stored hashed: the
// actor, the target and the caller's address as short hashes. The trail answers
// "who did this, and when" without becoming a second copy of the membership list.
// See security/audit.js for what is recorded and why.

import { rest } from "./supabase.js";

export const auditLog = {
  async insertAuditLog(row) {
    return rest("audit_log", { method: "POST", body: row, prefer: "return=minimal" });
  },
};
