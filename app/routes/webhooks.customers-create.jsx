/**
 * Webhook: customers/create
 *
 * Triggered when a new customer is created in Shopify.
 * Auto-imports the customer into CustomerMapping as unmapped.
 */

import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} - shop: ${shop} - customer: ${payload.id}`);

  try {
    const shopifyCustomerId = `gid://shopify/Customer/${payload.id}`;

    await db.customerMapping.upsert({
      where: {
        shop_shopifyCustomerId: {
          shop,
          shopifyCustomerId,
        },
      },
      update: {
        firstName: payload.first_name,
        lastName: payload.last_name,
        email: payload.email,
        phone: payload.phone,
      },
      create: {
        shop,
        shopifyCustomerId,
        erpCustomerCode: "", // Must be mapped by merchant
        firstName: payload.first_name,
        lastName: payload.last_name,
        email: payload.email,
        phone: payload.phone,
        syncEnabled: false, // Disabled until merchant maps the ERP code
      },
    });
  } catch (err) {
    console.error(`[Webhook] Error processing customers/create:`, err);
  }

  return new Response(null, { status: 200 });
};
