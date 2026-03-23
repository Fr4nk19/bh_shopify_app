/**
 * Webhook: orders/create
 *
 * Triggered when a new order is placed in Shopify.
 * Sends the order data to the ERP to create a sale record,
 * which also decrements inventory and associates the customer.
 *
 * Payload example (key fields):
 * {
 *   "id": 123456789,
 *   "name": "#1001",
 *   "order_number": 1001,
 *   "email": "customer@example.com",
 *   "total_price": "100.00",
 *   "line_items": [
 *     { "sku": "PROD-001", "quantity": 2, "price": "25.00", "total_discount": "0.00" }
 *   ],
 *   "billing_address": { "address1": "...", "city": "...", ... },
 *   "shipping_address": { "address1": "...", "city": "...", ... },
 *   "payment_gateway_names": ["shopify_payments"],
 *   "customer": { "email": "...", "first_name": "...", ... },
 *   "note": "...",
 *   "note_attributes": [{ "name": "customer_code", "value": "12345678-9" }]
 * }
 */

import { authenticate } from "../shopify.server.js";
import { syncOrderToErp } from "../services/sync.server.js";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} - shop: ${shop}`, {
    orderId: payload.id,
    orderNumber: payload.name,
    email: payload.email,
    totalPrice: payload.total_price,
    lineItemCount: payload.line_items?.length ?? 0,
  });

  try {
    // Fire and forget — respond 200 immediately, sync in background
    syncOrderToErp({
      shop,
      order: payload,
      source: "webhook",
    }).catch((err) => {
      console.error(
        `[Webhook] Order sync to ERP failed for shop ${shop}, order ${payload.name}:`,
        err.message
      );
    });
  } catch (err) {
    console.error(`[Webhook] Error processing order create:`, err);
  }

  return new Response(null, { status: 200 });
};
