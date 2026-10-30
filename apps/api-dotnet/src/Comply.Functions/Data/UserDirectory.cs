using System.Security.Cryptography;
using System.Text;
using Comply.Functions.Auth;
using Microsoft.EntityFrameworkCore;
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
/// Persistence for accounts and external logins. All reads and writes use a fresh context from
/// the factory so the singleton services stay safe to reuse across invocations.
/// </summary>
public sealed class UserDirectory(ComplyDatabase database, TimeProvider time, ILogger<UserDirectory>? logger = null)
{
    private static readonly SemaphoreSlim SetupGate = new(1, 1);

    private readonly ComplyDatabase _database = database;
    private readonly TimeProvider _time = time;
    private readonly ILogger<UserDirectory>? _logger = logger;

    public bool IsAvailable => _database.IsConfigured;

    public async Task<int> CountAsync(CancellationToken cancellationToken)
    {
        await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);
        return await context.Users.CountAsync(cancellationToken);
    }

    public async Task<User?> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);
        return await context.Users
            .Include(user => user.Organization)
            .SingleOrDefaultAsync(user => user.Email == email, cancellationToken);
    }

    public async Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken)
    {
        await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);
        return await context.Users
            .Include(user => user.Organization)
            .SingleOrDefaultAsync(user => user.Id == id, cancellationToken);
    }

    public async Task<Organization?> FindOrganizationBySlugAsync(string slug, CancellationToken cancellationToken)
    {
        await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);
        return await context.Organizations
            .SingleOrDefaultAsync(organization => organization.Slug == slug, cancellationToken);
    }

    /// <summary>The oldest organization, used as the single-tenant fallback in development.</summary>
    public async Task<Organization?> FirstOrganizationAsync(CancellationToken cancellationToken)
    {
        await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);
        return await context.Organizations
            .OrderBy(organization => organization.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
    }

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
            await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);

            if (await context.Users.AnyAsync(cancellationToken))
            {
                throw new AuthException(
                    "Setup is already complete. Ask an administrator for an account.",
                    403);
            }

            if (await context.Users.AnyAsync(user => user.Email == email, cancellationToken))
            {
                throw new AuthException("An account with this email already exists.", 409);
            }

            var now = _time.GetUtcNow();
            var organization = new Organization
            {
                Id = Ids.New("org"),
                Name = organizationName,
                Slug = await UniqueSlugAsync(context, organizationName, cancellationToken),
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

            context.Organizations.Add(organization);
            context.Users.Add(user);

            try
            {
                await context.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception)
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
            await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);

            var user = await context.Users
                .Include(item => item.Organization)
                .SingleOrDefaultAsync(item => item.Email == identity.Email, cancellationToken);

            var now = _time.GetUtcNow();

            if (user is null)
            {
                var organization = await context.Organizations
                    .OrderBy(item => item.CreatedAt)
                    .FirstOrDefaultAsync(cancellationToken);

                if (organization is null)
                {
                    organization = new Organization
                    {
                        Id = Ids.New("org"),
                        Name = "Organization",
                        Slug = await UniqueSlugAsync(context, "Organization", cancellationToken),
                        CreatedAt = now,
                    };
                    context.Organizations.Add(organization);
                }

                var firstUser = !await context.Users.AnyAsync(cancellationToken);
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
                context.Users.Add(user);
            }
            else
            {
                user.LastLoginAt = now;
                if (!user.Providers.Contains(identity.Provider)) user.Providers.Add(identity.Provider);
            }

            var linked = await context.ExternalLogins.AnyAsync(
                login => login.Provider == identity.Provider && login.Subject == identity.Subject,
                cancellationToken);

            if (!linked)
            {
                context.ExternalLogins.Add(new ExternalLogin
                {
                    Id = Ids.New("ext"),
                    UserId = user.Id,
                    Provider = identity.Provider,
                    Subject = identity.Subject,
                    CreatedAt = now,
                });
            }

            try
            {
                await context.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception)
            {
                // A concurrent callback may have written the same link or email first.
                _logger?.LogWarning(exception, "External sign-in raced with another request; reloading the account.");
                await using var reload = await _database.Factory.CreateDbContextAsync(cancellationToken);
                return await reload.Users
                    .Include(item => item.Organization)
                    .SingleAsync(item => item.Email == identity.Email, cancellationToken);
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
        await using var context = await _database.Factory.CreateDbContextAsync(cancellationToken);
        var user = await context.Users.SingleOrDefaultAsync(item => item.Id == userId, cancellationToken);
        if (user is null) return;

        user.LastLoginAt = _time.GetUtcNow();
        await context.SaveChangesAsync(cancellationToken);
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

    private static async Task<string> UniqueSlugAsync(
        ComplyDbContext context,
        string name,
        CancellationToken cancellationToken)
    {
        var baseSlug = Slugs.From(name);
        var slug = baseSlug;
        var suffix = 2;
        while (await context.Organizations.AnyAsync(item => item.Slug == slug, cancellationToken))
        {
            slug = $"{baseSlug}-{suffix}";
            suffix++;
        }

        return slug;
    }
}
