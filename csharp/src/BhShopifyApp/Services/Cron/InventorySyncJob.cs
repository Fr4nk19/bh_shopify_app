using BhShopifyApp.Data;
using BhShopifyApp.Services.Sync;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace BhShopifyApp.Services.Cron;

/// <summary>
/// Quartz.NET job that runs every 5 minutes and performs a full ERP→Shopify
/// inventory pull for each shop that has periodic sync enabled and whose
/// configured interval has elapsed since the last sync.
/// </summary>
[DisallowConcurrentExecution]
public sealed class InventorySyncJob(
    ISyncService syncService,
    AppDbContext db,
    ILogger<InventorySyncJob> logger) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        var ct = context.CancellationToken;
        logger.LogDebug("[Cron] InventorySyncJob triggered");

        var shops = await db.ShopSettings
            .AsNoTracking()
            .Where(s => s.SyncEnabled)
            .ToListAsync(ct);

        var now = DateTime.UtcNow;

        foreach (var settings in shops)
        {
            var intervalMs = TimeSpan.FromMinutes(settings.SyncIntervalMinutes);
            var lastSync = settings.LastSyncAt ?? DateTime.MinValue;

            if (now - lastSync < intervalMs)
                continue; // Not yet due for this shop

            logger.LogInformation(
                "[Cron] Starting full sync for shop={Shop}", settings.Shop);

            try
            {
                var result = await syncService.FullSyncErpToShopifyAsync(
                    settings.Shop, source: "cron", ct);

                logger.LogInformation(
                    "[Cron] Sync done for shop={Shop}: success={S} failed={F} skipped={K}",
                    settings.Shop, result.SuccessCount, result.FailedCount, result.SkippedCount);
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "[Cron] Full sync failed for shop={Shop}", settings.Shop);
            }
        }
    }
}
