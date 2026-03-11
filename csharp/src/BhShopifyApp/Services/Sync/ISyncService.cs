using BhShopifyApp.DTOs;

namespace BhShopifyApp.Services.Sync;

/// <summary>
/// Orchestrates bidirectional inventory synchronisation between Shopify and the ERP.
/// </summary>
public interface ISyncService
{
    /// <summary>
    /// Called when Shopify fires an inventory_levels/update webhook.
    /// Finds the mapped ERP SKU and pushes the new quantity to the ERP.
    /// </summary>
    Task<SyncItemResult> SyncShopifyToErpAsync(
        string shop, string inventoryItemGid, string locationGid,
        int available, string source = "webhook",
        CancellationToken ct = default);

    /// <summary>
    /// Called when the ERP sends a stock-change notification.
    /// Finds all Shopify mappings for the SKU and updates Shopify inventory.
    /// </summary>
    Task<SyncBatchResult> SyncErpToShopifyAsync(
        string shop, string erpSku, int quantity,
        string source = "erp-push",
        CancellationToken ct = default);

    /// <summary>
    /// Pulls all inventory from the ERP and updates Shopify.
    /// Used by the cron job and the "Sync All" button.
    /// </summary>
    Task<SyncBatchResult> FullSyncErpToShopifyAsync(
        string shop, string source = "cron",
        CancellationToken ct = default);

    /// <summary>Returns aggregate statistics for the dashboard.</summary>
    Task<SyncStats> GetStatsAsync(string shop, CancellationToken ct = default);
}

public record SyncStats(
    int Total, int Success, int Failed, int PendingQueue,
    DateTime? LastSyncAt, bool SyncEnabled);
