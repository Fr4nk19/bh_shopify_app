using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using BhShopifyApp.Data;
using Microsoft.EntityFrameworkCore;

namespace BhShopifyApp.Services.Shopify;

/// <summary>
/// Communicates with Shopify's Admin GraphQL API.
/// Uses the stored access token for each shop (offline token flow).
/// </summary>
public sealed class ShopifyInventoryService(
    IHttpClientFactory httpClientFactory,
    AppDbContext db,
    ILogger<ShopifyInventoryService> logger) : IShopifyInventoryService
{
    // ── GraphQL documents ─────────────────────────────────────────────────────

    private const string GetInventoryLevelQuery = """
        query($inventoryItemId: ID!, $locationId: ID!) {
          inventoryLevel(inventoryItemId: $inventoryItemId, locationId: $locationId) {
            quantities(names: ["available"]) { name quantity }
          }
        }
        """;

    private const string SetQuantityMutation = """
        mutation SetInventory($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup { id }
            userErrors { field message }
          }
        }
        """;

    private const string GetLocationsQuery = """
        { locations(first: 20) {
            edges { node { id name isActive } }
        } }
        """;

    private const string GetProductsQuery = """
        query GetProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id title
                variants(first: 50) {
                  edges {
                    node {
                      id title sku
                      inventoryItem {
                        id
                        inventoryLevels(first: 10) {
                          edges {
                            node {
                              location { id name }
                              quantities(names: ["available"]) { name quantity }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        """;

    // ── Interface implementation ──────────────────────────────────────────────

    public async Task<int?> GetAvailableQuantityAsync(
        string shop, string inventoryItemGid, string locationGid, CancellationToken ct = default)
    {
        var result = await ExecuteGraphQLAsync(shop, GetInventoryLevelQuery,
            new { inventoryItemId = inventoryItemGid, locationId = locationGid }, ct);

        var qty = result
            .GetProperty("data")
            .GetProperty("inventoryLevel")
            .GetProperty("quantities")
            .EnumerateArray()
            .FirstOrDefault(q => q.GetProperty("name").GetString() == "available")
            .GetProperty("quantity")
            .GetInt32();

        return qty;
    }

    public async Task SetQuantityAsync(
        string shop, string inventoryItemGid, string locationGid,
        int quantity, CancellationToken ct = default)
    {
        var variables = new
        {
            input = new
            {
                reason = "correction",
                name = "available",
                quantities = new[]
                {
                    new
                    {
                        inventoryItemId = inventoryItemGid,
                        locationId = locationGid,
                        quantity
                    }
                }
            }
        };

        var result = await ExecuteGraphQLAsync(shop, SetQuantityMutation, variables, ct);

        var userErrors = result
            .GetProperty("data")
            .GetProperty("inventorySetQuantities")
            .GetProperty("userErrors")
            .EnumerateArray()
            .ToList();

        if (userErrors.Count > 0)
        {
            var messages = string.Join(", ",
                userErrors.Select(e => e.GetProperty("message").GetString()));
            throw new InvalidOperationException($"Shopify inventory error: {messages}");
        }
    }

    public async Task<IReadOnlyList<ShopifyLocation>> GetLocationsAsync(
        string shop, CancellationToken ct = default)
    {
        var result = await ExecuteGraphQLAsync(shop, GetLocationsQuery, null, ct);

        return result
            .GetProperty("data")
            .GetProperty("locations")
            .GetProperty("edges")
            .EnumerateArray()
            .Select(e => e.GetProperty("node"))
            .Select(n => new ShopifyLocation(
                n.GetProperty("id").GetString()!,
                n.GetProperty("name").GetString()!,
                n.GetProperty("isActive").GetBoolean()))
            .ToList();
    }

    public async Task<IReadOnlyList<ShopifyProduct>> GetAllProductsAsync(
        string shop, CancellationToken ct = default)
    {
        var products = new List<ShopifyProduct>();
        string? cursor = null;

        do
        {
            var result = await ExecuteGraphQLAsync(shop, GetProductsQuery,
                cursor is null ? (object?)null : new { cursor }, ct);

            var productsData = result.GetProperty("data").GetProperty("products");
            var pageInfo = productsData.GetProperty("pageInfo");

            foreach (var edge in productsData.GetProperty("edges").EnumerateArray())
            {
                var node = edge.GetProperty("node");
                var variants = node.GetProperty("variants").GetProperty("edges")
                    .EnumerateArray()
                    .Select(ve => ve.GetProperty("node"))
                    .Select(v =>
                    {
                        var levels = v.GetProperty("inventoryItem")
                            .GetProperty("inventoryLevels")
                            .GetProperty("edges")
                            .EnumerateArray()
                            .Select(le => le.GetProperty("node"))
                            .Select(l => new ShopifyInventoryLevel(
                                l.GetProperty("location").GetProperty("id").GetString()!,
                                l.GetProperty("location").GetProperty("name").GetString()!,
                                l.GetProperty("quantities").EnumerateArray()
                                    .FirstOrDefault(q => q.GetProperty("name").GetString() == "available")
                                    .GetProperty("quantity").GetInt32()))
                            .ToList();

                        return new ShopifyVariant(
                            v.GetProperty("id").GetString()!,
                            v.GetProperty("title").GetString(),
                            v.TryGetProperty("sku", out var sku) ? sku.GetString() : null,
                            v.GetProperty("inventoryItem").GetProperty("id").GetString()!,
                            levels);
                    })
                    .ToList();

                products.Add(new ShopifyProduct(
                    node.GetProperty("id").GetString()!,
                    node.GetProperty("title").GetString()!,
                    variants));
            }

            var hasNextPage = pageInfo.GetProperty("hasNextPage").GetBoolean();
            cursor = hasNextPage ? pageInfo.GetProperty("endCursor").GetString() : null;

        } while (cursor is not null);

        return products;
    }

    // ── GraphQL executor ──────────────────────────────────────────────────────

    private async Task<JsonElement> ExecuteGraphQLAsync(
        string shop, string query, object? variables, CancellationToken ct)
    {
        var session = await db.Sessions
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Shop == shop, ct)
            ?? throw new InvalidOperationException(
                $"No se encontró sesión para la tienda '{shop}'. " +
                "Es posible que la app no esté instalada.");

        var client = httpClientFactory.CreateClient("shopify-graphql");
        client.BaseAddress = new Uri($"https://{shop}");
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session.AccessToken);

        var body = JsonSerializer.Serialize(new { query, variables });
        using var content = new StringContent(body, Encoding.UTF8, "application/json");

        var response = await client.PostAsync(
            $"/admin/api/2024-07/graphql.json", content, ct);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        var doc = JsonDocument.Parse(json);

        if (doc.RootElement.TryGetProperty("errors", out var errors) &&
            errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
        {
            var msg = errors.EnumerateArray()
                .Select(e => e.GetProperty("message").GetString())
                .FirstOrDefault();
            throw new InvalidOperationException($"Shopify GraphQL error: {msg}");
        }

        return doc.RootElement;
    }
}
