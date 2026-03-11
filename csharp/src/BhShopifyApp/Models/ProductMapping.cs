namespace BhShopifyApp.Models;

/// <summary>
/// Links a Shopify product variant (at a specific location) to an ERP SKU.
/// </summary>
public class ProductMapping
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Shop { get; set; } = string.Empty;

    // Shopify side
    public string ShopifyProductId { get; set; } = string.Empty;
    public string ShopifyVariantId { get; set; } = string.Empty;
    public string ShopifyInventoryItemId { get; set; } = string.Empty;
    public string ShopifyLocationId { get; set; } = string.Empty;
    public string ProductTitle { get; set; } = string.Empty;
    public string? VariantTitle { get; set; }

    // ERP side
    public string ErpSku { get; set; } = string.Empty;

    public bool SyncEnabled { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
