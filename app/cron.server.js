/**
 * Cron Job - ERP → Shopify periodic sync
 * Runs every N minutes per shop based on their settings
 *
 * This module is imported in entry.server.jsx to start cron on server boot.
 */

import cron from "node-cron";
import { db } from "./db.server.js";
import { fullSyncErpToShopify } from "./services/sync.server.js";
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

      console.log(`[Cron] Sync complete for ${settings.shop}:`, results);
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
