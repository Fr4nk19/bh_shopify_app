namespace BhShopifyApp.Models;

public enum SyncDirection { ShopifyToErp, ErpToShopify }
public enum SyncStatus { Success, Failed, Skipped }

/// <summary>
/// Immutable audit record for every sync attempt.
/// </summary>
public class SyncLog
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Shop { get; set; } = string.Empty;
    public SyncDirection Direction { get; set; }
    public SyncStatus Status { get; set; }

    /// <summary>Where the sync was triggered: webhook | cron | manual | erp-push | retry</summary>
    public string Source { get; set; } = string.Empty;

    public string? ErpSku { get; set; }
    public string? ShopifyVariantId { get; set; }
    public int? QuantityBefore { get; set; }
    public int? QuantityAfter { get; set; }
    public string? ErrorMessage { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
