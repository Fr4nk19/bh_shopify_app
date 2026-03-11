import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} - shop: ${shop}`);

  // Clean up shop data on uninstall
  if (topic === "APP_UNINSTALLED") {
    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }
    // Optionally keep settings/logs for reinstall, or clean up:
    // await db.shopSettings.deleteMany({ where: { shop } });
    // await db.productMapping.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 200 });
};
