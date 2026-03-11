using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BhShopifyApp.Data;
using BhShopifyApp.DTOs;
using Microsoft.EntityFrameworkCore;

namespace BhShopifyApp.Services.Erp;

/// <summary>
/// Communicates with the C# ERP REST API.
/// An HttpClient is injected via the typed-client pattern; per-shop headers
/// are applied dynamically before each request because credentials differ per
/// shop and can change at runtime (Settings page).
/// </summary>
public sealed class ErpService(
    IHttpClientFactory httpClientFactory,
    AppDbContext db,
    ILogger<ErpService> logger) : IErpService
{
    // ── Public interface ──────────────────────────────────────────────────────

    public async Task<ErpInventoryItem> GetInventoryAsync(
        string shop, string sku, CancellationToken ct = default)
    {
        var client = await BuildClientAsync(shop, ct);
        var response = await client.GetAsync($"/api/inventory/{Uri.EscapeDataString(sku)}", ct);
        await EnsureSuccessAsync(response, $"GET /api/inventory/{sku}");

        return (await response.Content.ReadFromJsonAsync<ErpInventoryItem>(ct))
               ?? throw new InvalidOperationException($"ERP returned null for SKU {sku}");
    }

    public async Task UpdateInventoryAsync(
        string shop, string sku, int quantity,
        string? shopifyVariantId = null, string? shopifyLocationId = null,
        CancellationToken ct = default)
    {
        var client = await BuildClientAsync(shop, ct);
        var payload = new ErpInventoryUpdateRequest(
            Sku: sku,
            Quantity: quantity,
            Source: "shopify",
            UpdatedAt: DateTime.UtcNow.ToString("O"),
            ShopifyVariantId: shopifyVariantId,
            ShopifyLocationId: shopifyLocationId
        );

        var response = await client.PutAsJsonAsync(
            $"/api/inventory/{Uri.EscapeDataString(sku)}", payload, ct);
        await EnsureSuccessAsync(response, $"PUT /api/inventory/{sku}");
    }

    public async Task<IReadOnlyList<ErpInventoryItem>> GetAllInventoryAsync(
        string shop, CancellationToken ct = default)
    {
        var client = await BuildClientAsync(shop, ct);
        var response = await client.GetAsync("/api/inventory", ct);
        await EnsureSuccessAsync(response, "GET /api/inventory");

        var json = await response.Content.ReadAsStringAsync(ct);

        // Support both direct array and { "items": [...] } wrapper
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            return JsonSerializer.Deserialize<List<ErpInventoryItem>>(json)
                   ?? [];
        }

        var wrapper = JsonSerializer.Deserialize<ErpInventoryListResponse>(json);
        return wrapper?.Items ?? [];
    }

    public async Task<ConnectionTestResult> TestConnectionAsync(
        string shop, CancellationToken ct = default)
    {
        try
        {
            var client = await BuildClientAsync(shop, ct);

            // Try /api/health first; fall back to /api/inventory
            HttpResponseMessage? response = null;
            try
            {
                response = await client.GetAsync("/api/health", ct);
                if (!response.IsSuccessStatusCode) response = null;
            }
            catch { /* ignore, try inventory */ }

            response ??= await client.GetAsync("/api/inventory", ct);
            await EnsureSuccessAsync(response, "Connection test");

            return new ConnectionTestResult(true, "Conexión exitosa con el ERP.");
        }
        catch (Exception ex)
        {
            logger.LogWarning("ERP connection test failed for shop {Shop}: {Error}", shop, ex.Message);
            return new ConnectionTestResult(false, ex.Message);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<HttpClient> BuildClientAsync(string shop, CancellationToken ct)
    {
        var settings = await db.ShopSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Shop == shop, ct)
            ?? throw new InvalidOperationException(
                $"ERP no configurado para la tienda '{shop}'. " +
                "Configure la conexión ERP en la sección de Ajustes.");

        var client = httpClientFactory.CreateClient("erp");
        client.BaseAddress = new Uri(settings.ErpBaseUrl.TrimEnd('/'));
        client.DefaultRequestHeaders.Remove(settings.ErpApiHeader);
        client.DefaultRequestHeaders.Add(settings.ErpApiHeader, settings.ErpApiKey);
        return client;
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, string operation)
    {
        if (response.IsSuccessStatusCode) return;

        var body = await response.Content.ReadAsStringAsync();
        var status = (int)response.StatusCode;

        var message = status switch
        {
            401 or 403 => $"ERP: API Key inválida o sin permisos ({status})",
            404 => $"ERP: Recurso no encontrado en {operation} (404)",
            400 or 422 => $"ERP: Solicitud inválida en {operation}: {body}",
            >= 500 => $"ERP: Error del servidor ({status}): {body}",
            _ => $"ERP: Error {status} en {operation}: {body}"
        };

        throw new HttpRequestException(message, null, response.StatusCode);
    }
}
