namespace BhShopifyApp.Models;

/// <summary>
/// Stores Shopify OAuth session tokens per shop.
/// </summary>
public class ShopSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Shop { get; set; } = string.Empty;
    public string AccessToken { get; set; } = string.Empty;
    public string Scopes { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
