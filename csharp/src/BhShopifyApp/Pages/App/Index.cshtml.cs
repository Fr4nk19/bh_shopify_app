using BhShopifyApp.Data;
using BhShopifyApp.Models;
using BhShopifyApp.Services.Sync;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace BhShopifyApp.Pages.App;

public class IndexModel(
    ISyncService syncService,
    AppDbContext db,
    IConfiguration config) : PageModel
{
    public SyncStats Stats { get; private set; } = default!;
    public IReadOnlyList<SyncLog> RecentLogs { get; private set; } = [];
    public bool IsConfigured { get; private set; }

    public async Task OnGetAsync()
    {
        var shop = GetShop();
        Stats = await syncService.GetStatsAsync(shop);
        IsConfigured = await db.ShopSettings.AnyAsync(s => s.Shop == shop);
        RecentLogs = await db.SyncLogs
            .Where(l => l.Shop == shop)
            .OrderByDescending(l => l.CreatedAt)
            .Take(10)
            .ToListAsync();
    }

    public async Task<IActionResult> OnPostFullSyncAsync()
    {
        var shop = GetShop();
        try
        {
            var result = await syncService.FullSyncErpToShopifyAsync(shop, "manual");
            TempData["SyncResult"] =
                $"Sincronización completada: {result.SuccessCount} exitosas, " +
                $"{result.FailedCount} fallidas, {result.SkippedCount} omitidas.";
        }
        catch (Exception ex)
        {
            TempData["SyncError"] = $"Error al sincronizar: {ex.Message}";
        }
        return RedirectToPage();
    }

    // In production this comes from the verified Shopify session/JWT.
    // For development, fall back to X-Shop-Domain header or query param.
    private string GetShop() =>
        Request.Headers["X-Shop-Domain"].FirstOrDefault()
        ?? Request.Query["shop"].FirstOrDefault()
        ?? config["DevShop"]
        ?? "dev-store.myshopify.com";
}
