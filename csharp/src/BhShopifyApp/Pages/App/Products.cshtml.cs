using BhShopifyApp.Data;
using BhShopifyApp.Models;
using BhShopifyApp.Services.Shopify;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace BhShopifyApp.Pages.App;

public class ProductsModel(
    IShopifyInventoryService shopifyInventory,
    AppDbContext db,
    IConfiguration config) : PageModel
{
    private const int PageSize = 20;

    public IReadOnlyList<ProductMapping> Mappings { get; private set; } = [];
    public int TotalPages { get; private set; }
    public int Page { get; private set; }
    public string? Search { get; private set; }

    public async Task OnGetAsync(int page = 1, string? search = null)
    {
        Page = page;
        Search = search;
        var shop = GetShop();

        var query = db.ProductMappings.Where(m => m.Shop == shop);
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(m =>
                m.ProductTitle.Contains(search) ||
                m.ErpSku.Contains(search));

        var total = await query.CountAsync();
        TotalPages = (int)Math.Ceiling(total / (double)PageSize);

        Mappings = await query
            .OrderBy(m => m.ProductTitle).ThenBy(m => m.VariantTitle)
            .Skip((page - 1) * PageSize).Take(PageSize)
            .ToListAsync();
    }

    // ── Import all Shopify products ──────────────────────────────────────────

    public async Task<IActionResult> OnPostImportAsync()
    {
        var shop = GetShop();
        try
        {
            var products = await shopifyInventory.GetAllProductsAsync(shop);
            int created = 0, skipped = 0;

            foreach (var product in products)
            {
                foreach (var variant in product.Variants)
                {
                    if (string.IsNullOrEmpty(variant.Sku)) { skipped++; continue; }

                    foreach (var level in variant.InventoryLevels)
                    {
                        var exists = await db.ProductMappings.AnyAsync(m =>
                            m.Shop == shop &&
                            m.ShopifyVariantId == variant.Id &&
                            m.ShopifyLocationId == level.LocationId);

                        if (!exists)
                        {
                            db.ProductMappings.Add(new ProductMapping
                            {
                                Shop = shop,
                                ShopifyProductId = product.Id,
                                ShopifyVariantId = variant.Id,
                                ShopifyInventoryItemId = variant.InventoryItemId,
                                ShopifyLocationId = level.LocationId,
                                ProductTitle = product.Title,
                                VariantTitle = variant.Title == "Default Title" ? null : variant.Title,
                                ErpSku = variant.Sku,
                                SyncEnabled = false,
                            });
                            created++;
                        }
                    }
                }
            }
            await db.SaveChangesAsync();
            TempData["Success"] =
                $"Importación completa: {created} variantes, {skipped} sin SKU omitidas.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = $"Error al importar: {ex.Message}";
        }
        return RedirectToPage();
    }

    // ── Update SKU / sync flag ────────────────────────────────────────────────

    public async Task<IActionResult> OnPostUpdateAsync(
        string id, string erpSku, bool syncEnabled)
    {
        var mapping = await db.ProductMappings.FindAsync(id);
        if (mapping is not null)
        {
            mapping.ErpSku = erpSku?.Trim() ?? mapping.ErpSku;
            mapping.SyncEnabled = syncEnabled;
            mapping.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            TempData["Success"] = "Mapeo actualizado.";
        }
        return RedirectToPage();
    }

    // ── Toggle sync ───────────────────────────────────────────────────────────

    public async Task<IActionResult> OnPostToggleAsync(string id)
    {
        var mapping = await db.ProductMappings.FindAsync(id);
        if (mapping is not null)
        {
            mapping.SyncEnabled = !mapping.SyncEnabled;
            mapping.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        return RedirectToPage();
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    public async Task<IActionResult> OnPostDeleteAsync(string id)
    {
        var mapping = await db.ProductMappings.FindAsync(id);
        if (mapping is not null)
        {
            db.ProductMappings.Remove(mapping);
            await db.SaveChangesAsync();
            TempData["Success"] = "Mapeo eliminado.";
        }
        return RedirectToPage();
    }

    private string GetShop() =>
        Request.Headers["X-Shop-Domain"].FirstOrDefault()
        ?? Request.Query["shop"].FirstOrDefault()
        ?? config["DevShop"]
        ?? "dev-store.myshopify.com";
}
