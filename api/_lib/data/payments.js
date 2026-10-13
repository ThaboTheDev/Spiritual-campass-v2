// Money-related tables: the checkouts we started and the notifications PayFast sent.
//
// Nothing here decides whether a payment is genuine — that is domain/itn.js. This
// module only reads and writes rows.

import { rest } from "./supabase.js";

const q = (v) => encodeURIComponent(String(v));

export const payments = {
  async insertCheckout(row) {
    return rest("checkouts", { method: "POST", body: row, prefer: "return=minimal" });
  },
  async getCheckout(mPaymentId) {
    const rows = await rest(`checkouts?m_payment_id=eq.${q(mPaymentId)}&select=*&limit=1`);
    return (rows && rows[0]) || null;
  },
  async updateCheckout(mPaymentId, patch) {
    return rest(`checkouts?m_payment_id=eq.${q(mPaymentId)}`, { method: "PATCH", body: patch, prefer: "return=minimal" });
  },
  /* None when this pf_payment_id was already recorded: each notification is applied once. */
  async getPaymentByPfId(pfPaymentId) {
    const rows = await rest(`payments?pf_payment_id=eq.${q(pfPaymentId)}&select=*&limit=1`);
    return (rows && rows[0]) || null;
  },
  async insertPayment(row) {
    return rest("payments?on_conflict=pf_payment_id", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=representation" });
  },
};
