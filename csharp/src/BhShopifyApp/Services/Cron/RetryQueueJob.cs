using BhShopifyApp.Data;
using BhShopifyApp.Models;
using BhShopifyApp.Services.Sync;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace BhShopifyApp.Services.Cron;

/// <summary>
/// Processes pending entries in the SyncQueue, applying exponential back-off.
/// Runs every 2 minutes.
/// </summary>
[DisallowConcurrentExecution]
public sealed class RetryQueueJob(
    ISyncService syncService,
    AppDbContext db,
    ILogger<RetryQueueJob> logger) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        var ct = context.CancellationToken;

        var pending = await db.SyncQueues
            .Where(q => q.Status == QueueStatus.Pending
                     && q.Attempts < q.MaxAttempts
                     && q.ScheduledAt <= DateTime.UtcNow)
            .OrderBy(q => q.CreatedAt)
            .Take(30)
            .ToListAsync(ct);

        if (pending.Count == 0) return;

        logger.LogDebug("[RetryQueue] Processing {Count} pending items", pending.Count);

        foreach (var item in pending)
        {
            item.Status = QueueStatus.Processing;
            item.Attempts++;
            item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            try
            {
                if (item.Direction == SyncDirection.ErpToShopify)
                {
                    await syncService.SyncErpToShopifyAsync(
                        item.Shop, item.ErpSku!, item.Quantity!.Value, "retry", ct);
                }
                else
                {
                    await syncService.SyncShopifyToErpAsync(
                        item.Shop,
                        item.ShopifyVariantId!, // used as inventoryItemGid in retry context
                        item.ShopifyLocationId!,
                        item.Quantity!.Value,
                        "retry", ct);
                }

                item.Status = QueueStatus.Completed;
                item.ProcessedAt = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                var isFinal = item.Attempts >= item.MaxAttempts;
                item.Status = isFinal ? QueueStatus.Failed : QueueStatus.Pending;
                item.ErrorMessage = ex.Message;

                // Exponential back-off: 2^attempts minutes
                item.ScheduledAt = DateTime.UtcNow.AddMinutes(Math.Pow(2, item.Attempts));

                logger.LogWarning(
                    "[RetryQueue] Item {Id} attempt {A}/{Max} failed for shop={Shop}: {Err}",
                    item.Id, item.Attempts, item.MaxAttempts, item.Shop, ex.Message);
            }

            item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
    }
}
