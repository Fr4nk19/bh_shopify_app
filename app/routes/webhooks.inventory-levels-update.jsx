/**
 * Webhook: inventory_levels/update
 *
 * Triggered when inventory changes in Shopify.
 * Payload example:
 * {
 *   "inventory_item_id": 123456,
 *   "location_id": 654321,
 *   "available": 10,
 *   "updated_at": "2024-01-01T00:00:00-05:00"
 * }
 */

import { authenticate } from "../shopify.server.js";
import { scheduleInventorySyncWithEchoGuard } from "../services/sync.server.js";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} - shop: ${shop}`, {
    inventoryItemId: payload.inventory_item_id,
    locationId: payload.location_id,
    available: payload.available,
  });

  try {
    // Respond 200 immediately. The ERP write is deferred briefly and skipped
    // when the change was caused by a Shopify order (the ERP sale already
    // decremented stock); manual edits in Shopify admin still sync to the ERP.
    scheduleInventorySyncWithEchoGuard({
      shop,
      inventoryItemId: `gid://shopify/InventoryItem/${payload.inventory_item_id}`,
      locationId: `gid://shopify/Location/${payload.location_id}`,
      available: payload.available,
      source: "webhook",
    });
  } catch (err) {
    console.error(`[Webhook] Error processing inventory update:`, err);
  }

  return new Response(null, { status: 200 });
};
