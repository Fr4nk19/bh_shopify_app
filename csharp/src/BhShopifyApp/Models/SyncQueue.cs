namespace BhShopifyApp.Models;

public enum QueueStatus { Pending, Processing, Completed, Failed }

/// <summary>
/// Retry queue for failed sync attempts (exponential back-off).
/// </summary>
public class SyncQueue
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Shop { get; set; } = string.Empty;
    public SyncDirection Direction { get; set; }

    public string? ErpSku { get; set; }
    public string? ShopifyVariantId { get; set; }
    public string? ShopifyLocationId { get; set; }
    public int? Quantity { get; set; }

    public int Attempts { get; set; } = 0;
    public int MaxAttempts { get; set; } = 3;
    public QueueStatus Status { get; set; } = QueueStatus.Pending;
    public string? ErrorMessage { get; set; }

    public DateTime ScheduledAt { get; set; } = DateTime.UtcNow;
    public DateTime? ProcessedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
