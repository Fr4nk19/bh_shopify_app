/**
 * Webhook: customers/update
 *
 * Triggered when a customer is updated in Shopify.
 * Syncs changes to ERP if mapping exists and is enabled.
 */

import { authenticate } from "../shopify.server.js";
import { syncCustomerShopifyToErp } from "../services/customer-sync.server.js";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} - shop: ${shop} - customer: ${payload.id}`);

  const shopifyCustomerId = `gid://shopify/Customer/${payload.id}`;

  // Fire-and-forget sync
  syncCustomerShopifyToErp({
    shop,
    shopifyCustomerId,
    customerData: {
      first_name: payload.first_name,
      last_name: payload.last_name,
      email: payload.email,
      phone: payload.phone,
      default_address: payload.default_address,
    },
    source: "webhook",
  }).catch((err) => {
    console.error(`[Webhook] Customer sync failed for ${payload.id}:`, err.message);
  });

  return new Response(null, { status: 200 });
};
