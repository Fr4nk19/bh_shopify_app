using System.Text.Json.Serialization;

namespace BhShopifyApp.DTOs;

// ─── ERP Responses ────────────────────────────────────────────────────────────

/// <summary>Single inventory item returned by GET /api/inventory/{sku}</summary>
public record ErpInventoryItem(
    [property: JsonPropertyName("sku")] string Sku,
    [property: JsonPropertyName("quantity")] int Quantity,
    [property: JsonPropertyName("location")] string? Location,
    [property: JsonPropertyName("updatedAt")] DateTime? UpdatedAt
);

/// <summary>Wrapper when ERP returns { "items": [...] }</summary>
public record ErpInventoryListResponse(
    [property: JsonPropertyName("items")] List<ErpInventoryItem>? Items
);

/// <summary>Wrapper when ERP returns { "items": [...] } for products</summary>
public record ErpProductListResponse(
    [property: JsonPropertyName("items")] List<ErpProduct>? Items
);

public record ErpProduct(
    [property: JsonPropertyName("sku")] string Sku,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string? Description
);

// ─── ERP Push Payload (PUT /api/inventory/{sku}) ──────────────────────────────

public record ErpInventoryUpdateRequest(
    [property: JsonPropertyName("sku")] string Sku,
    [property: JsonPropertyName("quantity")] int Quantity,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("updatedAt")] string UpdatedAt,
    [property: JsonPropertyName("shopifyVariantId")] string? ShopifyVariantId,
    [property: JsonPropertyName("shopifyLocationId")] string? ShopifyLocationId
);

// ─── ERP → App Webhook ────────────────────────────────────────────────────────

/// <summary>
/// Body the C# ERP sends to POST /api/erp-webhook.
/// Supports single { sku, quantity } or batch { items: [...] }.
/// </summary>
public class ErpWebhookRequest
{
    [JsonPropertyName("sku")]
    public string? Sku { get; set; }

    [JsonPropertyName("quantity")]
    public int? Quantity { get; set; }

    [JsonPropertyName("items")]
    public List<ErpWebhookItem>? Items { get; set; }

    /// <summary>Normalises to a flat list regardless of single/batch format.</summary>
    public IEnumerable<ErpWebhookItem> GetItems()
    {
        if (Items is { Count: > 0 })
            return Items;

        if (Sku is not null && Quantity.HasValue)
            return [new ErpWebhookItem(Sku, Quantity.Value)];

        return [];
    }
}

public record ErpWebhookItem(
    [property: JsonPropertyName("sku")] string Sku,
    [property: JsonPropertyName("quantity")] int Quantity
);

// ─── Shopify Webhook payloads ─────────────────────────────────────────────────

public class InventoryLevelWebhook
{
    [JsonPropertyName("inventory_item_id")]
    public long InventoryItemId { get; set; }

    [JsonPropertyName("location_id")]
    public long LocationId { get; set; }

    [JsonPropertyName("available")]
    public int Available { get; set; }

    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; set; }
}

public class ProductWebhook
{
    [JsonPropertyName("id")]
    public long Id { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("variants")]
    public List<ProductVariantWebhook> Variants { get; set; } = [];
}

public class ProductVariantWebhook
{
    [JsonPropertyName("id")]
    public long Id { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("sku")]
    public string? Sku { get; set; }

    [JsonPropertyName("inventory_item_id")]
    public long InventoryItemId { get; set; }
}
