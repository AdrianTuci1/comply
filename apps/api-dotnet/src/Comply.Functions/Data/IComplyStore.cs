namespace Comply.Functions.Data;

/// <summary>
/// Persistence boundary for accounts, assessments and MCP keys. The .NET host uses
/// <see cref="CosmosComplyStore"/>; tests use the EF Core in-memory adapter so they stay fast
/// and isolated.
/// </summary>
public interface IComplyStore
{
    bool IsConfigured { get; }

    Task<int> CountUsersAsync(CancellationToken cancellationToken = default);
    Task<bool> UserEmailExistsAsync(string email, CancellationToken cancellationToken = default);
    Task<User?> FindUserByEmailAsync(string email, CancellationToken cancellationToken = default);
    Task<User?> FindUserByIdAsync(string id, CancellationToken cancellationToken = default);
    Task AddUserAsync(User user, CancellationToken cancellationToken = default);
    Task SaveUserAsync(User user, CancellationToken cancellationToken = default);

    Task<bool> ExternalLoginExistsAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default);
    Task AddExternalLoginAsync(ExternalLogin login, CancellationToken cancellationToken = default);

    Task<Organization?> FindOrganizationBySlugAsync(string slug, CancellationToken cancellationToken = default);
    Task<Organization?> FindOrganizationByIdAsync(string id, CancellationToken cancellationToken = default);
    Task<Organization?> FirstOrganizationAsync(CancellationToken cancellationToken = default);
    Task<bool> OrganizationSlugExistsAsync(string slug, CancellationToken cancellationToken = default);
    Task AddOrganizationAsync(Organization organization, CancellationToken cancellationToken = default);

    Task AddAssessmentAsync(Assessment assessment, CancellationToken cancellationToken = default);
    Task<Assessment?> GetAssessmentAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Assessment>> ListAssessmentsAsync(
        string organizationId,
        CancellationToken cancellationToken = default);
    Task SaveAssessmentAsync(Assessment assessment, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<McpKey>> ListMcpKeysAsync(
        string organizationId,
        CancellationToken cancellationToken = default);
    Task<McpKey?> FindMcpKeyByIdAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default);
    Task<McpKey?> FindMcpKeyByHashAsync(string hash, CancellationToken cancellationToken = default);
    Task AddMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default);
    Task SaveMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default);
}

/// <summary>A write lost a uniqueness race (email, external login or key hash).</summary>
public sealed class StoreConflictException(string message) : Exception(message);

/// <summary>Used when no Cosmos connection string is configured; auth and agent routes return 503.</summary>
public sealed class UnconfiguredComplyStore : IComplyStore
{
    public bool IsConfigured => false;

    public Task<int> CountUsersAsync(CancellationToken cancellationToken = default) => Unavailable<int>();

    public Task<bool> UserEmailExistsAsync(string email, CancellationToken cancellationToken = default) =>
        Unavailable<bool>();

    public Task<User?> FindUserByEmailAsync(string email, CancellationToken cancellationToken = default) =>
        Unavailable<User?>();

    public Task<User?> FindUserByIdAsync(string id, CancellationToken cancellationToken = default) =>
        Unavailable<User?>();

    public Task AddUserAsync(User user, CancellationToken cancellationToken = default) => Unavailable();

    public Task SaveUserAsync(User user, CancellationToken cancellationToken = default) => Unavailable();

    public Task<bool> ExternalLoginExistsAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default) => Unavailable<bool>();

    public Task AddExternalLoginAsync(ExternalLogin login, CancellationToken cancellationToken = default) =>
        Unavailable();

    public Task<Organization?> FindOrganizationBySlugAsync(
        string slug,
        CancellationToken cancellationToken = default) => Unavailable<Organization?>();

    public Task<Organization?> FindOrganizationByIdAsync(
        string id,
        CancellationToken cancellationToken = default) => Unavailable<Organization?>();

    public Task<Organization?> FirstOrganizationAsync(CancellationToken cancellationToken = default) =>
        Unavailable<Organization?>();

    public Task<bool> OrganizationSlugExistsAsync(
        string slug,
        CancellationToken cancellationToken = default) => Unavailable<bool>();

    public Task AddOrganizationAsync(
        Organization organization,
        CancellationToken cancellationToken = default) => Unavailable();

    public Task AddAssessmentAsync(
        Assessment assessment,
        CancellationToken cancellationToken = default) => Unavailable();

    public Task<Assessment?> GetAssessmentAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default) => Unavailable<Assessment?>();

    public Task<IReadOnlyList<Assessment>> ListAssessmentsAsync(
        string organizationId,
        CancellationToken cancellationToken = default) => Unavailable<IReadOnlyList<Assessment>>();

    public Task SaveAssessmentAsync(
        Assessment assessment,
        CancellationToken cancellationToken = default) => Unavailable();

    public Task<IReadOnlyList<McpKey>> ListMcpKeysAsync(
        string organizationId,
        CancellationToken cancellationToken = default) => Unavailable<IReadOnlyList<McpKey>>();

    public Task<McpKey?> FindMcpKeyByIdAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default) => Unavailable<McpKey?>();

    public Task<McpKey?> FindMcpKeyByHashAsync(
        string hash,
        CancellationToken cancellationToken = default) => Unavailable<McpKey?>();

    public Task AddMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default) => Unavailable();

    public Task SaveMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default) => Unavailable();

    private static Task Unavailable() =>
        Task.FromException(new InvalidOperationException(
            "The Comply database is not configured. Set COMPLY_COSMOS_CONNECTION."));

    private static Task<T> Unavailable<T>() =>
        Task.FromException<T>(new InvalidOperationException(
            "The Comply database is not configured. Set COMPLY_COSMOS_CONNECTION."));
}
