/**
 * Echo suppression for order-driven inventory changes.
 *
 * When a Shopify order is placed, the ERP sale (orders/create → createErpSale)
 * is the authoritative movement that decrements ERP stock. Shopify ALSO fires
 * an inventory_levels/update webhook for the very same change. Without
 * suppression, that webhook would push the already-decremented quantity back to
 * the ERP and double-count the sale.
 *
 * We mark the inventory items touched by an order here, so the inventory webhook
 * skips the ERP write-back for order-driven changes while genuine manual edits
 * in Shopify admin (no associated order) still flow through to the ERP.
 *
 * The suppression is intentionally robust to webhook ordering: the inventory
 * webhook defers its ERP write briefly (see ECHO_DEFER_MS) so the order webhook
 * has time to register the suppression even if it arrives second.
 *
 * NOTE: state lives in-process. The app runs as a persistent Node server
 * (Railway + in-process node-cron), so this Map is shared across webhook
 * handlers. On a restart or a multi-instance deploy, a missed suppression at
 * worst causes a single transient stock write that the ERP→Shopify cron
 * reconciles on its next run.
 */

// How long an order keeps an inventory item suppressed.
const SUPPRESS_WINDOW_MS = 60_000;

// How long the inventory webhook waits before writing to the ERP, giving the
// order webhook time to register a suppression regardless of arrival order.
export const ECHO_DEFER_MS = 5_000;

const suppressions = new Map(); // key -> expiresAtMs

function keyOf(shop, inventoryItemId) {
  return `${shop}::${inventoryItemId}`;
}

/**
 * Mark an inventory item as order-driven so the next inventory webhook for it
 * skips the ERP write-back.
 */
export function suppressInventoryEcho(shop, inventoryItemId, windowMs = SUPPRESS_WINDOW_MS) {
  if (!shop || !inventoryItemId) return;
  suppressions.set(keyOf(shop, inventoryItemId), Date.now() + windowMs);
}

/**
 * Returns true if this inventory change was caused by a recent order (and should
 * NOT be pushed to the ERP). Consumes the suppression so it only applies once.
 */
export function consumeInventoryEcho(shop, inventoryItemId) {
  const key = keyOf(shop, inventoryItemId);
  const expiresAt = suppressions.get(key);
  if (!expiresAt) return false;
  suppressions.delete(key);
  return Date.now() <= expiresAt;
}

// Periodically drop stale entries so the Map cannot grow unbounded if a
// suppressed item never receives its expected inventory webhook.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of suppressions) {
    if (now > expiresAt) suppressions.delete(key);
  }
}, 5 * 60_000);
cleanup.unref?.();
