namespace BhShopifyApp.DTOs;

public record SyncItemResult(
    string? Sku,
    bool Success,
    string? Error = null,
    bool Skipped = false
);

public record SyncBatchResult(
    int SuccessCount,
    int FailedCount,
    int SkippedCount,
    IReadOnlyList<SyncItemResult> Items
);

public record ConnectionTestResult(
    bool Success,
    string Message,
    object? Data = null
);
