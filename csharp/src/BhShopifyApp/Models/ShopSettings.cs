namespace BhShopifyApp.Models;

/// <summary>
/// Per-shop ERP connection configuration.
/// </summary>
public class ShopSettings
{
    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <summary>Shopify shop domain, e.g. my-store.myshopify.com</summary>
    public string Shop { get; set; } = string.Empty;

    /// <summary>Base URL of the C# ERP REST API.</summary>
    public string ErpBaseUrl { get; set; } = string.Empty;

    /// <summary>API key used to authenticate against the ERP.</summary>
    public string ErpApiKey { get; set; } = string.Empty;

    /// <summary>HTTP header name that carries the API key. Default: X-Api-Key.</summary>
    public string ErpApiHeader { get; set; } = "X-Api-Key";

    /// <summary>Whether periodic (cron) sync is enabled for this shop.</summary>
    public bool SyncEnabled { get; set; } = true;

    /// <summary>How often (in minutes) to pull inventory from the ERP.</summary>
    public int SyncIntervalMinutes { get; set; } = 15;

    public DateTime? LastSyncAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
