namespace BhShopifyApp.Services.Shopify;

/// <summary>
/// Abstraction over Shopify's inventory-related GraphQL API.
/// </summary>
public interface IShopifyInventoryService
{
    /// <summary>Returns the current available quantity for an inventory item at a location.</summary>
    Task<int?> GetAvailableQuantityAsync(
        string shop, string inventoryItemGid, string locationGid,
        CancellationToken ct = default);

    /// <summary>Sets the absolute available quantity using inventorySetQuantities.</summary>
    Task SetQuantityAsync(
        string shop, string inventoryItemGid, string locationGid,
        int quantity, CancellationToken ct = default);

    /// <summary>Returns all active locations for the shop.</summary>
    Task<IReadOnlyList<ShopifyLocation>> GetLocationsAsync(
        string shop, CancellationToken ct = default);

    /// <summary>Returns all products with their variants and inventory levels.</summary>
    Task<IReadOnlyList<ShopifyProduct>> GetAllProductsAsync(
        string shop, CancellationToken ct = default);
}

// ─── Value objects ─────────────────────────────────────────────────────────────

public record ShopifyLocation(string Id, string Name, bool IsActive);

public record ShopifyInventoryLevel(
    string LocationId, string LocationName, int Available);

public record ShopifyVariant(
    string Id, string? Title, string? Sku,
    string InventoryItemId,
    IReadOnlyList<ShopifyInventoryLevel> InventoryLevels);

public record ShopifyProduct(
    string Id, string Title,
    IReadOnlyList<ShopifyVariant> Variants);
