using BhShopifyApp.Data;
using BhShopifyApp.Models;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace BhShopifyApp.Pages.App;

public class SyncLogModel(AppDbContext db, IConfiguration config) : PageModel
{
    private const int PageSize = 25;

    public IReadOnlyList<SyncLog> Logs { get; private set; } = [];
    public int Total { get; private set; }
    public int Page { get; private set; }
    public int TotalPages { get; private set; }
    public string? Direction { get; private set; }
    public string? Status { get; private set; }
    public string? SkuFilter { get; private set; }

    public async Task OnGetAsync(
        int page = 1,
        string? direction = null,
        string? status = null,
        string? sku = null)
    {
        Page = page;
        Direction = direction;
        Status = status;
        SkuFilter = sku;

        var shop = GetShop();

        var query = db.SyncLogs.Where(l => l.Shop == shop);

        if (!string.IsNullOrEmpty(direction) &&
            Enum.TryParse<SyncDirection>(direction, out var dir))
            query = query.Where(l => l.Direction == dir);

        if (!string.IsNullOrEmpty(status) &&
            Enum.TryParse<SyncStatus>(status, out var st))
            query = query.Where(l => l.Status == st);

        if (!string.IsNullOrEmpty(sku))
            query = query.Where(l => l.ErpSku != null && l.ErpSku.Contains(sku));

        Total = await query.CountAsync();
        TotalPages = (int)Math.Ceiling(Total / (double)PageSize);

        Logs = await query
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * PageSize)
            .Take(PageSize)
            .ToListAsync();
    }

    private string GetShop() =>
        Request.Headers["X-Shop-Domain"].FirstOrDefault()
        ?? Request.Query["shop"].FirstOrDefault()
        ?? config["DevShop"]
        ?? "dev-store.myshopify.com";
}
