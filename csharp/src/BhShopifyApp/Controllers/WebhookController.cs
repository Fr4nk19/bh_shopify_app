using System.Text;
using System.Text.Json;
using BhShopifyApp.Data;
using BhShopifyApp.DTOs;
using BhShopifyApp.Models;
using BhShopifyApp.Services.Sync;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopifySharp;

namespace BhShopifyApp.Controllers;

/// <summary>
/// Receives Shopify webhooks (HMAC-validated).
/// POST /webhooks/inventory-levels-update
/// POST /webhooks/products-create
/// POST /webhooks/products-update
/// POST /webhooks/app-uninstalled
/// </summary>
[Route("webhooks")]
[ApiController]
public class WebhookController(
    ISyncService syncService,
    AppDbContext db,
    IConfiguration config,
    ILogger<WebhookController> logger) : ControllerBase
{
    private string ApiSecret => config["Shopify:ApiSecret"]!;

    // ── inventory_levels/update ───────────────────────────────────────────────

    [HttpPost("inventory-levels-update")]
    public async Task<IActionResult> InventoryLevelsUpdate()
    {
        var (shop, payload) = await ReadWebhookAsync<InventoryLevelWebhook>();
        if (shop is null || payload is null) return Unauthorized();

        logger.LogInformation(
            "[Webhook] inventory_levels/update: shop={Shop} item={Item} loc={Loc} qty={Qty}",
            shop, payload.InventoryItemId, payload.LocationId, payload.Available);

        // Fire and forget — Shopify expects 200 quickly
        _ = Task.Run(async () =>
        {
            try
            {
                await syncService.SyncShopifyToErpAsync(
                    shop,
                    $"gid://shopify/InventoryItem/{payload.InventoryItemId}",
                    $"gid://shopify/Location/{payload.LocationId}",
                    payload.Available,
                    "webhook");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[Webhook] Background sync failed for shop={Shop}", shop);
            }
        });

        return Ok();
    }

    // ── products/create ───────────────────────────────────────────────────────

    [HttpPost("products-create")]
    public async Task<IActionResult> ProductsCreate()
    {
        var (shop, payload) = await ReadWebhookAsync<ProductWebhook>();
        if (shop is null || payload is null) return Unauthorized();

        foreach (var variant in payload.Variants.Where(v => !string.IsNullOrEmpty(v.Sku)))
        {
            var variantGid = $"gid://shopify/ProductVariant/{variant.Id}";
            var exists = await db.ProductMappings.AnyAsync(
                m => m.Shop == shop &&
                     m.ShopifyVariantId == variantGid &&
                     m.ShopifyLocationId == "PENDING");

            if (!exists)
            {
                db.ProductMappings.Add(new ProductMapping
                {
                    Shop = shop,
                    ShopifyProductId = $"gid://shopify/Product/{payload.Id}",
                    ShopifyVariantId = variantGid,
                    ShopifyInventoryItemId = $"gid://shopify/InventoryItem/{variant.InventoryItemId}",
                    ShopifyLocationId = "PENDING",
                    ProductTitle = payload.Title,
                    VariantTitle = variant.Title == "Default Title" ? null : variant.Title,
                    ErpSku = variant.Sku!,
                    SyncEnabled = false, // Merchant must confirm
                });
            }
        }
        await db.SaveChangesAsync();

        return Ok();
    }

    // ── products/update ───────────────────────────────────────────────────────

    [HttpPost("products-update")]
    public async Task<IActionResult> ProductsUpdate()
    {
        var (shop, payload) = await ReadWebhookAsync<ProductWebhook>();
        if (shop is null || payload is null) return Unauthorized();

        foreach (var variant in payload.Variants)
        {
            var variantGid = $"gid://shopify/ProductVariant/{variant.Id}";
            var mappings = await db.ProductMappings
                .Where(m => m.Shop == shop && m.ShopifyVariantId == variantGid)
                .ToListAsync();

            foreach (var m in mappings)
            {
                m.ProductTitle = payload.Title;
                m.VariantTitle = variant.Title == "Default Title" ? null : variant.Title;
                m.UpdatedAt = DateTime.UtcNow;
            }
        }
        await db.SaveChangesAsync();

        return Ok();
    }

    // ── app/uninstalled ───────────────────────────────────────────────────────

    [HttpPost("app-uninstalled")]
    public async Task<IActionResult> AppUninstalled()
    {
        var (shop, _) = await ReadWebhookAsync<JsonElement>();
        if (shop is null) return Unauthorized();

        var session = await db.Sessions.FirstOrDefaultAsync(s => s.Shop == shop);
        if (session is not null) db.Sessions.Remove(session);

        await db.SaveChangesAsync();
        logger.LogInformation("[Webhook] App uninstalled for shop={Shop}", shop);

        return Ok();
    }

    // ── HMAC validation helper ────────────────────────────────────────────────

    private async Task<(string? shop, T? payload)> ReadWebhookAsync<T>()
    {
        Request.EnableBuffering();
        var body = await new StreamReader(Request.Body, Encoding.UTF8,
            leaveOpen: true).ReadToEndAsync();
        Request.Body.Position = 0;

        var hmacHeader = Request.Headers["X-Shopify-Hmac-Sha256"].ToString();
        if (!WebhookUtility.IsAuthenticWebhook(body, hmacHeader, ApiSecret))
        {
            logger.LogWarning("[Webhook] Invalid HMAC on {Path}", Request.Path);
            return (null, default);
        }

        var shop = Request.Headers["X-Shopify-Shop-Domain"].ToString();
        if (string.IsNullOrEmpty(shop)) return (null, default);

        try
        {
            var payload = JsonSerializer.Deserialize<T>(body,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return (shop, payload);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[Webhook] Failed to deserialize payload for shop={Shop}", shop);
            return (shop, default);
        }
    }
}
