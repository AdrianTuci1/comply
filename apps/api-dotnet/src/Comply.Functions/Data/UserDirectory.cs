using System.Security.Cryptography;
using System.Text;
using Comply.Functions.Auth;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Data;

public static class Ids
{
    public static string New(string prefix) =>
        $"{prefix}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()}";
}

public static class Slugs
{
    public static string From(string? value)
    {
        var builder = new StringBuilder();
        foreach (var character in (value ?? "").ToLowerInvariant())
        {
            if (character is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(character);
            }
            else if ((character is ' ' or '-' or '_' or '.') && builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
        }

        var slug = builder.ToString().Trim('-');
        if (slug.Length > 48) slug = slug[..48].Trim('-');
        return slug.Length == 0 ? "org" : slug;
    }
}

/// <summary>
/// Persistence for accounts and external logins. All reads and writes go through
/// <see cref="IComplyStore"/>, so the same logic runs on Cosmos DB in production and on the
/// in-memory EF adapter in tests.
/// </summary>
public sealed class UserDirectory(IComplyStore store, TimeProvider time, ILogger<UserDirectory>? logger = null)
{
    private static readonly SemaphoreSlim SetupGate = new(1, 1);

    private readonly IComplyStore _store = store;
    private readonly TimeProvider _time = time;
    private readonly ILogger<UserDirectory>? _logger = logger;

    public bool IsAvailable => _store.IsConfigured;

    public Task<int> CountAsync(CancellationToken cancellationToken) =>
        _store.CountUsersAsync(cancellationToken);

    public Task<User?> FindByEmailAsync(string email, CancellationToken cancellationToken) =>
        _store.FindUserByEmailAsync(email, cancellationToken);

    public Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken) =>
        _store.FindUserByIdAsync(id, cancellationToken);

    public Task<Organization?> FindOrganizationBySlugAsync(string slug, CancellationToken cancellationToken) =>
        _store.FindOrganizationBySlugAsync(slug, cancellationToken);

    /// <summary>The oldest organization, used as the single-tenant fallback in development.</summary>
    public Task<Organization?> FirstOrganizationAsync(CancellationToken cancellationToken) =>
        _store.FirstOrganizationAsync(cancellationToken);

    /// <summary>
    /// Creates the first organization and its admin. Registration is only open while the
    /// installation has no users, matching the Node setup flow.
    /// </summary>
    public async Task<User> CreateFirstAsync(
        string email,
        string name,
        string passwordHash,
        string organizationName,
        CancellationToken cancellationToken)
    {
        await SetupGate.WaitAsync(cancellationToken);
        try
        {
            if (await _store.CountUsersAsync(cancellationToken) > 0)
            {
                throw new AuthException(
                    "Setup is already complete. Ask an administrator for an account.",
                    403);
            }

            if (await _store.UserEmailExistsAsync(email, cancellationToken))
            {
                throw new AuthException("An account with this email already exists.", 409);
            }

            var now = _time.GetUtcNow();
            var organization = new Organization
            {
                Id = Ids.New("org"),
                Name = organizationName,
                Slug = await UniqueSlugAsync(organizationName, cancellationToken),
                CreatedAt = now,
            };

            var user = new User
            {
                Id = Ids.New("usr"),
                OrganizationId = organization.Id,
                Email = email,
                Name = name,
                Role = Roles.Admin,
                PasswordHash = passwordHash,
                Providers = ["password"],
                CreatedAt = now,
                LastLoginAt = now,
            };

            try
            {
                await _store.AddOrganizationAsync(organization, cancellationToken);
                await _store.AddUserAsync(user, cancellationToken);
            }
            catch (StoreConflictException exception)
            {
                _logger?.LogWarning(exception, "First-user registration failed to save.");
                throw new AuthException("An account with this email already exists.", 409);
            }

            user.Organization = organization;
            return user;
        }
        finally
        {
            SetupGate.Release();
        }
    }

    /// <summary>
    /// Finds or creates the account for a verified external identity and records the link.
    /// The first account in an empty installation becomes the admin.
    /// </summary>
    public async Task<User> EnsureExternalAsync(OidcIdentity identity, CancellationToken cancellationToken)
    {
        await SetupGate.WaitAsync(cancellationToken);
        try
        {
            var user = await _store.FindUserByEmailAsync(identity.Email, cancellationToken);
            var now = _time.GetUtcNow();

            if (user is null)
            {
                var organization = await _store.FirstOrganizationAsync(cancellationToken);
                if (organization is null)
                {
                    organization = new Organization
                    {
                        Id = Ids.New("org"),
                        Name = "Organization",
                        Slug = await UniqueSlugAsync("Organization", cancellationToken),
                        CreatedAt = now,
                    };
                    await _store.AddOrganizationAsync(organization, cancellationToken);
                }

                var firstUser = await _store.CountUsersAsync(cancellationToken) == 0;
                user = new User
                {
                    Id = Ids.New("usr"),
                    OrganizationId = organization.Id,
                    Email = identity.Email,
                    Name = ResolveName(identity.Name, identity.Email),
                    Role = firstUser ? Roles.Admin : Roles.Member,
                    PasswordHash = null,
                    Providers = [identity.Provider],
                    CreatedAt = now,
                    LastLoginAt = now,
                    Organization = organization,
                };

                try
                {
                    await _store.AddUserAsync(user, cancellationToken);
                }
                catch (StoreConflictException)
                {
                    // A concurrent callback may have written the same email first.
                    _logger?.LogWarning("External sign-in raced with another request; reloading the account.");
                    return await ReloadAsync(identity.Email, cancellationToken);
                }
            }
            else
            {
                user.LastLoginAt = now;
                if (!user.Providers.Contains(identity.Provider)) user.Providers.Add(identity.Provider);
                await _store.SaveUserAsync(user, cancellationToken);
            }

            var linked = await _store.ExternalLoginExistsAsync(
                identity.Provider,
                identity.Subject,
                cancellationToken);

            if (!linked)
            {
                try
                {
                    await _store.AddExternalLoginAsync(new ExternalLogin
                    {
                        Id = ExternalLoginId(identity.Provider, identity.Subject),
                        UserId = user.Id,
                        Provider = identity.Provider,
                        Subject = identity.Subject,
                        CreatedAt = now,
                    }, cancellationToken);
                }
                catch (StoreConflictException)
                {
                    // Another instance linked the same identity first; the account is already valid.
                }
            }

            return user;
        }
        finally
        {
            SetupGate.Release();
        }
    }

    public async Task TouchLoginAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await _store.FindUserByIdAsync(userId, cancellationToken);
        if (user is null) return;

        user.LastLoginAt = _time.GetUtcNow();
        await _store.SaveUserAsync(user, cancellationToken);
    }

    public static string ResolveName(string? name, string email)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length > 0) return trimmed;

        var local = email.Split('@')[0];
        var parts = local.Split(['.', '_', '-'], StringSplitOptions.RemoveEmptyEntries);
        var display = string.Join(' ', parts.Select(part =>
            char.ToUpperInvariant(part[0]) + part[1..]));
        return display.Length == 0 ? email : display;
    }

    /// <summary>A Cosmos-safe, stable document id for the provider+subject pair.</summary>
    public static string ExternalLoginId(string provider, string subject) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{provider}\n{subject}")))
            .ToLowerInvariant();

    private async Task<User> ReloadAsync(string email, CancellationToken cancellationToken) =>
        await _store.FindUserByEmailAsync(email, cancellationToken)
        ?? throw new AuthException("External sign-in could not be completed.", 409);

    private async Task<string> UniqueSlugAsync(string name, CancellationToken cancellationToken)
    {
        var baseSlug = Slugs.From(name);
        var slug = baseSlug;
        var suffix = 2;
        while (await _store.OrganizationSlugExistsAsync(slug, cancellationToken))
        {
            slug = $"{baseSlug}-{suffix}";
            suffix++;
        }

        return slug;
    }
}
