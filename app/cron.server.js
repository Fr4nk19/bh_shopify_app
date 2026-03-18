/**
 * Cron Job - ERP → Shopify periodic sync
 * Runs every N minutes per shop based on their settings
 *
 * This module is imported in entry.server.jsx to start cron on server boot.
 */

import cron from "node-cron";
import { db } from "./db.server.js";
import { fullSyncErpToShopify } from "./services/sync.server.js";
import { fullSyncCustomersErpToShopify } from "./services/customer-sync.server.js";
import { unauthenticated } from "./shopify.server.js";

let cronJob = null;

export function startCron() {
  if (cronJob) return; // already running

  // Run every 5 minutes, check each shop's interval setting
  cronJob = cron.schedule("*/5 * * * *", async () => {
    try {
      await runSyncForAllShops();
    } catch (err) {
      console.error("[Cron] Error during sync:", err);
    }
  });

  console.log("[Cron] ERP sync cron job started");
}

async function runSyncForAllShops() {
  const shops = await db.shopSettings.findMany({
    where: { syncEnabled: true },
  });

  const now = new Date();

  for (const settings of shops) {
    const intervalMs = settings.syncIntervalMin * 60 * 1000;
    const lastSync = settings.lastSyncAt ? new Date(settings.lastSyncAt) : null;

    // Check if it's time to sync for this shop
    if (lastSync && now.getTime() - lastSync.getTime() < intervalMs) {
      continue; // Not yet
    }

    console.log(`[Cron] Starting sync for shop: ${settings.shop}`);

    try {
      const { admin } = await unauthenticated.admin(settings.shop);

      const results = await fullSyncErpToShopify({
        shop: settings.shop,
        graphql: admin.graphql,
        source: "cron",
      });

      console.log(`[Cron] Inventory sync complete for ${settings.shop}:`, results);

      // Sync customers
      try {
        const customerResults = await fullSyncCustomersErpToShopify({
          shop: settings.shop,
          graphql: admin.graphql,
          source: "cron",
        });
        console.log(`[Cron] Customer sync complete for ${settings.shop}:`, customerResults);
      } catch (customerErr) {
        console.error(`[Cron] Customer sync failed for ${settings.shop}:`, customerErr.message);
      }
    } catch (err) {
      console.error(`[Cron] Sync failed for ${settings.shop}:`, err.message);
    }
  }
}

export function stopCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("[Cron] ERP sync cron job stopped");
  }
}
