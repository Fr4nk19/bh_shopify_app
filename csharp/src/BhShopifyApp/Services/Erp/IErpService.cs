using BhShopifyApp.DTOs;

namespace BhShopifyApp.Services.Erp;

/// <summary>
/// Abstraction over the C# ERP REST API.
/// Inject this interface wherever ERP communication is needed.
/// </summary>
public interface IErpService
{
    /// <summary>Returns inventory level for one SKU.</summary>
    Task<ErpInventoryItem> GetInventoryAsync(string shop, string sku, CancellationToken ct = default);

    /// <summary>Updates inventory for one SKU in the ERP.</summary>
    Task UpdateInventoryAsync(string shop, string sku, int quantity,
        string? shopifyVariantId = null, string? shopifyLocationId = null,
        CancellationToken ct = default);

    /// <summary>Returns all inventory items from the ERP.</summary>
    Task<IReadOnlyList<ErpInventoryItem>> GetAllInventoryAsync(string shop, CancellationToken ct = default);

    /// <summary>Verifies connectivity with the ERP and returns a result object.</summary>
    Task<ConnectionTestResult> TestConnectionAsync(string shop, CancellationToken ct = default);
}
