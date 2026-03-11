using BhShopifyApp.Models;
using Microsoft.EntityFrameworkCore;

namespace BhShopifyApp.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<ShopSession> Sessions => Set<ShopSession>();
    public DbSet<ShopSettings> ShopSettings => Set<ShopSettings>();
    public DbSet<ProductMapping> ProductMappings => Set<ProductMapping>();
    public DbSet<SyncLog> SyncLogs => Set<SyncLog>();
    public DbSet<SyncQueue> SyncQueues => Set<SyncQueue>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // ── ShopSession ────────────────────────────────────────────────────────
        modelBuilder.Entity<ShopSession>(e =>
        {
            e.HasKey(s => s.Id);
            e.HasIndex(s => s.Shop).IsUnique();
            e.Property(s => s.Shop).IsRequired().HasMaxLength(255);
            e.Property(s => s.AccessToken).IsRequired();
        });

        // ── ShopSettings ──────────────────────────────────────────────────────
        modelBuilder.Entity<ShopSettings>(e =>
        {
            e.HasKey(s => s.Id);
            e.HasIndex(s => s.Shop).IsUnique();
            e.Property(s => s.Shop).IsRequired().HasMaxLength(255);
            e.Property(s => s.ErpBaseUrl).IsRequired();
            e.Property(s => s.ErpApiKey).IsRequired();
            e.Property(s => s.ErpApiHeader).HasDefaultValue("X-Api-Key");
        });

        // ── ProductMapping ────────────────────────────────────────────────────
        modelBuilder.Entity<ProductMapping>(e =>
        {
            e.HasKey(p => p.Id);
            e.HasIndex(p => new { p.Shop, p.ShopifyVariantId, p.ShopifyLocationId }).IsUnique();
            e.HasIndex(p => p.Shop);
            e.HasIndex(p => new { p.Shop, p.ErpSku });
            e.Property(p => p.Shop).IsRequired().HasMaxLength(255);
            e.Property(p => p.ErpSku).IsRequired();
        });

        // ── SyncLog ───────────────────────────────────────────────────────────
        modelBuilder.Entity<SyncLog>(e =>
        {
            e.HasKey(l => l.Id);
            e.HasIndex(l => l.Shop);
            e.HasIndex(l => new { l.Shop, l.CreatedAt });
            e.HasIndex(l => l.Status);
            e.Property(l => l.Shop).IsRequired().HasMaxLength(255);
            e.Property(l => l.Source).IsRequired();
        });

        // ── SyncQueue ─────────────────────────────────────────────────────────
        modelBuilder.Entity<SyncQueue>(e =>
        {
            e.HasKey(q => q.Id);
            e.HasIndex(q => new { q.Shop, q.Status });
            e.HasIndex(q => new { q.Status, q.ScheduledAt });
            e.Property(q => q.Shop).IsRequired().HasMaxLength(255);
        });
    }
}
