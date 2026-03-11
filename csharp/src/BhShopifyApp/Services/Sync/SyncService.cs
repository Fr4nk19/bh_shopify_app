using BhShopifyApp.Data;
using BhShopifyApp.DTOs;
using BhShopifyApp.Models;
using BhShopifyApp.Services.Erp;
using BhShopifyApp.Services.Shopify;
using Microsoft.EntityFrameworkCore;

namespace BhShopifyApp.Services.Sync;

/// <summary>
/// Coordinates all sync operations between Shopify and the ERP.
/// Depends on IErpService and IShopifyInventoryService (both injected).
/// Writes SyncLog and SyncQueue records for audit and retry logic.
/// </summary>
public sealed class SyncService(
    IErpService erp,
    IShopifyInventoryService shopifyInventory,
    AppDbContext db,
    ILogger<SyncService> logger) : ISyncService
{
    // ── Shopify → ERP ─────────────────────────────────────────────────────────

    public async Task<SyncItemResult> SyncShopifyToErpAsync(
        string shop, string inventoryItemGid, string locationGid,
        int available, string source = "webhook", CancellationToken ct = default)
    {
        var mapping = await db.ProductMappings
            .AsNoTracking()
            .FirstOrDefaultAsync(m =>
                m.Shop == shop &&
                m.ShopifyInventoryItemId == inventoryItemGid &&
                m.ShopifyLocationId == locationGid &&
                m.SyncEnabled, ct);

        if (mapping is null)
        {
            await WriteLogAsync(shop, SyncDirection.ShopifyToErp, SyncStatus.Skipped,
                source, null, null, null, available,
                $"No mapping for inventoryItem={inventoryItemGid} location={locationGid}");
            return new SyncItemResult(null, false, Skipped: true);
        }

        try
        {
            await erp.UpdateInventoryAsync(shop, mapping.ErpSku, available,
                mapping.ShopifyVariantId, locationGid, ct);

            await WriteLogAsync(shop, SyncDirection.ShopifyToErp, SyncStatus.Success,
                source, mapping.ErpSku, mapping.ShopifyVariantId, null, available);

            logger.LogInformation(
                "[Sync] Shopify→ERP success: shop={Shop} sku={Sku} qty={Qty}",
                shop, mapping.ErpSku, available);

            return new SyncItemResult(mapping.ErpSku, true);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "[Sync] Shopify→ERP failed: shop={Shop} sku={Sku}", shop, mapping.ErpSku);

            await WriteLogAsync(shop, SyncDirection.ShopifyToErp, SyncStatus.Failed,
                source, mapping.ErpSku, mapping.ShopifyVariantId, null, available, ex.Message);

            await EnqueueRetryAsync(shop, SyncDirection.ShopifyToErp,
                mapping.ErpSku, mapping.ShopifyVariantId, locationGid, available);

            return new SyncItemResult(mapping.ErpSku, false, ex.Message);
        }
    }

    // ── ERP → Shopify ─────────────────────────────────────────────────────────

    public async Task<SyncBatchResult> SyncErpToShopifyAsync(
        string shop, string erpSku, int quantity,
        string source = "erp-push", CancellationToken ct = default)
    {
        var mappings = await db.ProductMappings
            .AsNoTracking()
            .Where(m => m.Shop == shop && m.ErpSku == erpSku && m.SyncEnabled)
            .ToListAsync(ct);

        if (mappings.Count == 0)
        {
            await WriteLogAsync(shop, SyncDirection.ErpToShopify, SyncStatus.Skipped,
                source, erpSku, null, null, quantity,
                $"No mapping found for SKU: {erpSku}");
            return new SyncBatchResult(0, 0, 1, [new SyncItemResult(erpSku, false, Skipped: true)]);
        }

        var results = new List<SyncItemResult>();

        foreach (var mapping in mappings)
        {
            try
            {
                int? before = await shopifyInventory.GetAvailableQuantityAsync(
                    shop, mapping.ShopifyInventoryItemId, mapping.ShopifyLocationId, ct);

                await shopifyInventory.SetQuantityAsync(
                    shop, mapping.ShopifyInventoryItemId, mapping.ShopifyLocationId, quantity, ct);

                await WriteLogAsync(shop, SyncDirection.ErpToShopify, SyncStatus.Success,
                    source, erpSku, mapping.ShopifyVariantId, before, quantity);

                logger.LogInformation(
                    "[Sync] ERP→Shopify success: shop={Shop} sku={Sku} qty={Qty}",
                    shop, erpSku, quantity);

                results.Add(new SyncItemResult(erpSku, true));
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "[Sync] ERP→Shopify failed: shop={Shop} sku={Sku}", shop, erpSku);

                await WriteLogAsync(shop, SyncDirection.ErpToShopify, SyncStatus.Failed,
                    source, erpSku, mapping.ShopifyVariantId, null, quantity, ex.Message);

                await EnqueueRetryAsync(shop, SyncDirection.ErpToShopify,
                    erpSku, mapping.ShopifyVariantId, mapping.ShopifyLocationId, quantity);

                results.Add(new SyncItemResult(erpSku, false, ex.Message));
            }
        }

        return BuildBatchResult(results);
    }

    // ── Full Sync ─────────────────────────────────────────────────────────────

    public async Task<SyncBatchResult> FullSyncErpToShopifyAsync(
        string shop, string source = "cron", CancellationToken ct = default)
    {
        var inventory = await erp.GetAllInventoryAsync(shop, ct);
        var results = new List<SyncItemResult>();

        foreach (var item in inventory)
        {
            var batchResult = await SyncErpToShopifyAsync(shop, item.Sku, item.Quantity, source, ct);
            results.AddRange(batchResult.Items);
        }

        // Update lastSyncAt
        var settings = await db.ShopSettings.FirstOrDefaultAsync(s => s.Shop == shop, ct);
        if (settings is not null)
        {
            settings.LastSyncAt = DateTime.UtcNow;
            settings.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        logger.LogInformation(
            "[Sync] Full sync complete for shop={Shop}: success={S} failed={F} skipped={K}",
            shop, results.Count(r => r.Success), results.Count(r => !r.Success && !r.Skipped),
            results.Count(r => r.Skipped));

        return BuildBatchResult(results);
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    public async Task<SyncStats> GetStatsAsync(string shop, CancellationToken ct = default)
    {
        var total = await db.SyncLogs.CountAsync(l => l.Shop == shop, ct);
        var success = await db.SyncLogs.CountAsync(l => l.Shop == shop && l.Status == SyncStatus.Success, ct);
        var failed = await db.SyncLogs.CountAsync(l => l.Shop == shop && l.Status == SyncStatus.Failed, ct);
        var pending = await db.SyncQueues.CountAsync(
            q => q.Shop == shop && (q.Status == QueueStatus.Pending || q.Status == QueueStatus.Processing), ct);
        var settings = await db.ShopSettings.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Shop == shop, ct);

        return new SyncStats(total, success, failed, pending,
            settings?.LastSyncAt, settings?.SyncEnabled ?? false);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async Task WriteLogAsync(
        string shop, SyncDirection direction, SyncStatus status, string source,
        string? erpSku, string? variantId, int? before, int? after,
        string? error = null)
    {
        try
        {
            db.SyncLogs.Add(new SyncLog
            {
                Shop = shop,
                Direction = direction,
                Status = status,
                Source = source,
                ErpSku = erpSku,
                ShopifyVariantId = variantId,
                QuantityBefore = before,
                QuantityAfter = after,
                ErrorMessage = error,
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to write SyncLog for shop={Shop}", shop);
        }
    }

    private async Task EnqueueRetryAsync(
        string shop, SyncDirection direction,
        string? erpSku, string? variantId, string? locationId, int? quantity)
    {
        try
        {
            db.SyncQueues.Add(new SyncQueue
            {
                Shop = shop,
                Direction = direction,
                ErpSku = erpSku,
                ShopifyVariantId = variantId,
                ShopifyLocationId = locationId,
                Quantity = quantity,
                ScheduledAt = DateTime.UtcNow.AddMinutes(2),
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to enqueue retry for shop={Shop}", shop);
        }
    }

    private static SyncBatchResult BuildBatchResult(IList<SyncItemResult> results) =>
        new(
            results.Count(r => r.Success),
            results.Count(r => !r.Success && !r.Skipped),
            results.Count(r => r.Skipped),
            results.AsReadOnly());
}
