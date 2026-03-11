using BhShopifyApp.DTOs;
using BhShopifyApp.Services.Sync;
using Microsoft.AspNetCore.Mvc;

namespace BhShopifyApp.Controllers;

/// <summary>
/// Receives inventory-change notifications pushed by the C# ERP.
///
/// POST /api/erp-webhook
/// Required headers:
///   X-Webhook-Secret: {WEBHOOK_SECRET}
///   X-Shop-Domain:    {shop}.myshopify.com
/// Body (single):
///   { "sku": "PROD-001", "quantity": 50 }
/// Body (batch):
///   { "items": [ { "sku": "PROD-001", "quantity": 50 } ] }
/// </summary>
[Route("api/erp-webhook")]
[ApiController]
public class ErpWebhookController(
    ISyncService syncService,
    IConfiguration config,
    ILogger<ErpWebhookController> logger) : ControllerBase
{
    private string? WebhookSecret => config["Sync:WebhookSecret"];

    [HttpPost]
    public async Task<IActionResult> Receive(
        [FromBody] ErpWebhookRequest body,
        CancellationToken ct)
    {
        // ── Auth ──────────────────────────────────────────────────────────────
        var secret = Request.Headers["X-Webhook-Secret"].ToString();
        if (string.IsNullOrEmpty(WebhookSecret) || secret != WebhookSecret)
        {
            logger.LogWarning("[ErpWebhook] Unauthorized request from {IP}",
                HttpContext.Connection.RemoteIpAddress);
            return Unauthorized(new { error = "Unauthorized" });
        }

        var shop = Request.Headers["X-Shop-Domain"].ToString();
        if (string.IsNullOrEmpty(shop))
            return BadRequest(new { error = "Missing X-Shop-Domain header" });

        // ── Process items ─────────────────────────────────────────────────────
        var items = body.GetItems().ToList();
        if (items.Count == 0)
            return BadRequest(new { error = "No items to process. Provide 'sku'+'quantity' or 'items' array." });

        var results = new List<object>();
        var hasErrors = false;

        foreach (var item in items)
        {
            logger.LogInformation(
                "[ErpWebhook] Processing sku={Sku} qty={Qty} shop={Shop}",
                item.Sku, item.Quantity, shop);

            var batchResult = await syncService.SyncErpToShopifyAsync(
                shop, item.Sku, item.Quantity, "erp-push", ct);

            foreach (var r in batchResult.Items)
            {
                if (!r.Success && !r.Skipped) hasErrors = true;
                results.Add(new { r.Sku, r.Success, r.Skipped, r.Error });
            }
        }

        return hasErrors
            ? StatusCode(207, new { status = "partial", results })
            : Ok(new { status = "ok", results });
    }
}
