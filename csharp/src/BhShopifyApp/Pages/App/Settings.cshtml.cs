using BhShopifyApp.Data;
using BhShopifyApp.DTOs;
using BhShopifyApp.Models;
using BhShopifyApp.Services.Erp;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace BhShopifyApp.Pages.App;

public class SettingsModel(
    IErpService erpService,
    AppDbContext db,
    IConfiguration config) : PageModel
{
    public ShopSettings? Settings { get; private set; }
    public ConnectionTestResult? TestResult { get; private set; }

    public async Task OnGetAsync()
    {
        var shop = GetShop();
        Settings = await db.ShopSettings.FindAsync(
            (await db.ShopSettings.FirstOrDefaultAsync(s => s.Shop == shop))?.Id ?? "");
        Settings ??= await db.ShopSettings.FirstOrDefaultAsync(s => s.Shop == shop);
    }

    public async Task<IActionResult> OnPostSaveAsync(
        string erpBaseUrl, string erpApiKey,
        string erpApiHeader, bool syncEnabled, int syncIntervalMinutes)
    {
        var shop = GetShop();
        var existing = await db.ShopSettings.FirstOrDefaultAsync(s => s.Shop == shop);

        if (existing is null)
        {
            db.ShopSettings.Add(new ShopSettings
            {
                Shop = shop,
                ErpBaseUrl = erpBaseUrl,
                ErpApiKey = erpApiKey,
                ErpApiHeader = string.IsNullOrWhiteSpace(erpApiHeader) ? "X-Api-Key" : erpApiHeader,
                SyncEnabled = syncEnabled,
                SyncIntervalMinutes = syncIntervalMinutes,
            });
        }
        else
        {
            existing.ErpBaseUrl = erpBaseUrl;
            existing.ErpApiKey = erpApiKey;
            existing.ErpApiHeader = string.IsNullOrWhiteSpace(erpApiHeader) ? "X-Api-Key" : erpApiHeader;
            existing.SyncEnabled = syncEnabled;
            existing.SyncIntervalMinutes = syncIntervalMinutes;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        TempData["Success"] = "Configuración guardada correctamente.";
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostTestAsync(
        string erpBaseUrl, string erpApiKey, string erpApiHeader)
    {
        var shop = GetShop();

        // Save temporarily so ErpService can read it
        var existing = await db.ShopSettings.FirstOrDefaultAsync(s => s.Shop == shop);
        if (existing is null)
        {
            db.ShopSettings.Add(new ShopSettings
            {
                Shop = shop, ErpBaseUrl = erpBaseUrl, ErpApiKey = erpApiKey,
                ErpApiHeader = erpApiHeader, SyncEnabled = false,
            });
        }
        else
        {
            existing.ErpBaseUrl = erpBaseUrl;
            existing.ErpApiKey = erpApiKey;
            existing.ErpApiHeader = erpApiHeader;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();

        TestResult = await erpService.TestConnectionAsync(shop);
        Settings = await db.ShopSettings.FirstOrDefaultAsync(s => s.Shop == shop);
        return Page();
    }

    private string GetShop() =>
        Request.Headers["X-Shop-Domain"].FirstOrDefault()
        ?? Request.Query["shop"].FirstOrDefault()
        ?? config["DevShop"]
        ?? "dev-store.myshopify.com";
}
