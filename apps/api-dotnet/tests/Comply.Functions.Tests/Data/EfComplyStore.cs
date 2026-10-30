using Microsoft.EntityFrameworkCore;

namespace Comply.Functions.Data;

/// <summary>
/// EF Core adapter used by the test suite. The production Functions host uses
/// <see cref="CosmosComplyStore"/>; keeping this adapter means the service tests exercise the
/// same persistence contract without a Cosmos emulator.
/// </summary>
public sealed class EfComplyStore(ComplyDatabase database) : IComplyStore
{
    private readonly ComplyDatabase _database = database;

    public bool IsConfigured => _database.IsConfigured;

    public async Task<int> CountUsersAsync(CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Users.CountAsync(cancellationToken);
    }

    public async Task<bool> UserEmailExistsAsync(string email, CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Users.AnyAsync(user => user.Email == email, cancellationToken);
    }

    public async Task<User?> FindUserByEmailAsync(string email, CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Users
            .Include(user => user.Organization)
            .SingleOrDefaultAsync(user => user.Email == email, cancellationToken);
    }

    public async Task<User?> FindUserByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Users
            .Include(user => user.Organization)
            .SingleOrDefaultAsync(user => user.Id == id, cancellationToken);
    }

    public async Task AddUserAsync(User user, CancellationToken cancellationToken = default)
    {
        var organization = user.Organization;
        user.Organization = null;
        try
        {
            await using var context = await ContextAsync(cancellationToken);
            context.Users.Add(user);
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            throw new StoreConflictException($"A user with {user.Email} already exists.");
        }
        finally
        {
            user.Organization = organization;
        }
    }

    public async Task SaveUserAsync(User user, CancellationToken cancellationToken = default)
    {
        var organization = user.Organization;
        user.Organization = null;
        try
        {
            await using var context = await ContextAsync(cancellationToken);
            context.Users.Update(user);
            await context.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            user.Organization = organization;
        }
    }

    public async Task<bool> ExternalLoginExistsAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.ExternalLogins.AnyAsync(
            login => login.Provider == provider && login.Subject == subject,
            cancellationToken);
    }

    public async Task AddExternalLoginAsync(
        ExternalLogin login,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        context.ExternalLogins.Add(login);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            throw new StoreConflictException("The external login is already linked.");
        }
    }

    public async Task<Organization?> FindOrganizationBySlugAsync(
        string slug,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Organizations
            .SingleOrDefaultAsync(organization => organization.Slug == slug, cancellationToken);
    }

    public async Task<Organization?> FindOrganizationByIdAsync(
        string id,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Organizations
            .SingleOrDefaultAsync(organization => organization.Id == id, cancellationToken);
    }

    public async Task<Organization?> FirstOrganizationAsync(CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Organizations
            .OrderBy(organization => organization.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<bool> OrganizationSlugExistsAsync(
        string slug,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Organizations.AnyAsync(
            organization => organization.Slug == slug,
            cancellationToken);
    }

    public async Task AddOrganizationAsync(
        Organization organization,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        context.Organizations.Add(organization);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            throw new StoreConflictException($"The organization slug {organization.Slug} is taken.");
        }
    }

    public async Task AddAssessmentAsync(
        Assessment assessment,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        context.Assessments.Add(assessment);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<Assessment?> GetAssessmentAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Assessments
            .Include(item => item.Requirements)
            .ThenInclude(requirement => requirement.Evidence)
            .Include(item => item.Events)
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Id == id && item.OrganizationId == organizationId,
                cancellationToken);
    }

    public async Task<IReadOnlyList<Assessment>> ListAssessmentsAsync(
        string organizationId,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.Assessments
            .Where(item => item.OrganizationId == organizationId)
            .Include(item => item.Requirements)
            .ThenInclude(requirement => requirement.Evidence)
            .Include(item => item.Events)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task SaveAssessmentAsync(
        Assessment assessment,
        CancellationToken cancellationToken = default)
    {
        // The store hands out detached aggregates. Replacing the stored aggregate keeps the
        // adapter correct for both new and updated children without graph-diff bookkeeping.
        var organization = assessment.Organization;
        assessment.Organization = null;
        try
        {
            await using var context = await ContextAsync(cancellationToken);
            var existing = await context.Assessments
                .Include(item => item.Requirements)
                .ThenInclude(requirement => requirement.Evidence)
                .Include(item => item.Events)
                .SingleOrDefaultAsync(item => item.Id == assessment.Id, cancellationToken);
            if (existing is not null)
            {
                context.Assessments.Remove(existing);
                await context.SaveChangesAsync(cancellationToken);
            }

            context.Assessments.Add(assessment);
            await context.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            assessment.Organization = organization;
        }
    }

    public async Task<IReadOnlyList<McpKey>> ListMcpKeysAsync(
        string organizationId,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.McpKeys
            .Where(key => key.OrganizationId == organizationId)
            .OrderByDescending(key => key.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<McpKey?> FindMcpKeyByIdAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.McpKeys.SingleOrDefaultAsync(
            key => key.Id == id && key.OrganizationId == organizationId,
            cancellationToken);
    }

    public async Task<McpKey?> FindMcpKeyByHashAsync(
        string hash,
        CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        return await context.McpKeys.AsNoTracking()
            .SingleOrDefaultAsync(key => key.KeyHash == hash, cancellationToken);
    }

    public async Task AddMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        context.McpKeys.Add(key);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task SaveMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default)
    {
        await using var context = await ContextAsync(cancellationToken);
        context.McpKeys.Update(key);
        await context.SaveChangesAsync(cancellationToken);
    }

    private Task<ComplyDbContext> ContextAsync(CancellationToken cancellationToken) =>
        _database.Factory.CreateDbContextAsync(cancellationToken);
}
