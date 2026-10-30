using Comply.Functions.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Comply.Functions.Tests;

public sealed class DatabaseMappingTests
{
    private static ComplyDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ComplyDbContext>()
            // Model building does not open a connection, so the provider mapping is testable
            // without a running PostgreSQL instance.
            .UseNpgsql("Host=localhost;Database=comply;Username=comply;Password=comply")
            .Options);

    private static IEntityType Entity(ComplyDbContext context, Type type) =>
        context.Model.FindEntityType(type)
        ?? throw new InvalidOperationException($"{type.Name} is not part of the model.");

    [Theory]
    [InlineData(typeof(Organization), "organizations")]
    [InlineData(typeof(User), "users")]
    [InlineData(typeof(ExternalLogin), "external_logins")]
    [InlineData(typeof(Assessment), "assessments")]
    [InlineData(typeof(AssessmentRequirement), "assessment_requirements")]
    [InlineData(typeof(Evidence), "evidence")]
    [InlineData(typeof(AssessmentEvent), "assessment_events")]
    [InlineData(typeof(McpKey), "mcp_keys")]
    public void Tables_use_snake_case_names(Type type, string table)
    {
        using var context = CreateContext();

        Assert.Equal(table, Entity(context, type).GetTableName());
    }

    [Theory]
    [InlineData(typeof(User), nameof(User.OrganizationId), "organization_id")]
    [InlineData(typeof(User), nameof(User.PasswordHash), "password_hash")]
    [InlineData(typeof(User), nameof(User.LastLoginAt), "last_login_at")]
    [InlineData(typeof(ExternalLogin), nameof(ExternalLogin.Provider), "provider")]
    [InlineData(typeof(Assessment), nameof(Assessment.PeriodFrom), "period_from")]
    [InlineData(typeof(Assessment), nameof(Assessment.ContentStatus), "content_status")]
    [InlineData(typeof(Assessment), nameof(Assessment.ReviewedAt), "reviewed_at")]
    [InlineData(typeof(AssessmentRequirement), nameof(AssessmentRequirement.LibraryRequirementId), "library_requirement_id")]
    [InlineData(typeof(AssessmentRequirement), nameof(AssessmentRequirement.Ref), "ref")]
    [InlineData(typeof(Evidence), nameof(Evidence.AssessmentRequirementId), "assessment_requirement_id")]
    [InlineData(typeof(Evidence), nameof(Evidence.Citation), "citation")]
    [InlineData(typeof(Evidence), nameof(Evidence.Hash), "hash")]
    [InlineData(typeof(Evidence), nameof(Evidence.CreatedAt), "created_at")]
    [InlineData(typeof(AssessmentEvent), nameof(AssessmentEvent.Revision), "revision")]
    [InlineData(typeof(McpKey), nameof(McpKey.KeyPrefix), "key_prefix")]
    public void Columns_use_snake_case_names(Type type, string property, string column)
    {
        using var context = CreateContext();

        var mapped = Entity(context, type).FindProperty(property);

        Assert.NotNull(mapped);
        Assert.Equal(column, mapped!.GetColumnName());
    }

    [Fact]
    public void Timestamps_are_timestamptz()
    {
        using var context = CreateContext();
        var user = Entity(context, typeof(User));

        Assert.Equal("timestamp with time zone", user.FindProperty(nameof(User.CreatedAt))!.GetColumnType());
        Assert.Equal("timestamp with time zone", user.FindProperty(nameof(User.LastLoginAt))!.GetColumnType());
        Assert.Equal("date", Entity(context, typeof(Assessment)).FindProperty(nameof(Assessment.PeriodFrom))!.GetColumnType());
    }

    [Fact]
    public void Lists_are_stored_as_text_arrays()
    {
        using var context = CreateContext();

        Assert.Equal("text[]", Entity(context, typeof(User)).FindProperty(nameof(User.Providers))!.GetColumnType());
        Assert.Equal("text[]", Entity(context, typeof(McpKey)).FindProperty(nameof(McpKey.Scopes))!.GetColumnType());
    }

    [Theory]
    [InlineData(typeof(Organization), new[] { "slug" })]
    [InlineData(typeof(User), new[] { "email" })]
    [InlineData(typeof(ExternalLogin), new[] { "provider", "subject" })]
    [InlineData(typeof(McpKey), new[] { "key_hash" })]
    [InlineData(typeof(AssessmentRequirement), new[] { "assessment_id", "library_requirement_id" })]
    public void Unique_indexes_protect_identity_columns(Type type, string[] columns)
    {
        using var context = CreateContext();
        var entity = Entity(context, type);

        var index = entity.GetIndexes().SingleOrDefault(candidate =>
            candidate.IsUnique
            && candidate.Properties.Select(property => property.GetColumnName()).SequenceEqual(columns));

        Assert.NotNull(index);
    }

    [Fact]
    public void Tenant_and_status_lookup_indexes_exist()
    {
        using var context = CreateContext();
        var assessments = Entity(context, typeof(Assessment));

        var indexed = assessments.GetIndexes()
            .Select(index => string.Join(',', index.Properties.Select(property => property.GetColumnName())))
            .ToList();

        Assert.Contains("organization_id,framework", indexed);
        Assert.Contains("organization_id,content_status", indexed);
        Assert.Contains("organization_id,updated_at", indexed);
    }

    [Fact]
    public void Assessment_children_cascade_and_tenants_do_not()
    {
        using var context = CreateContext();

        var requirement = Entity(context, typeof(AssessmentRequirement))
            .GetForeignKeys()
            .Single(key => key.PrincipalEntityType.ClrType == typeof(Assessment));
        var assessment = Entity(context, typeof(Assessment))
            .GetForeignKeys()
            .Single(key => key.PrincipalEntityType.ClrType == typeof(Organization));

        Assert.Equal(DeleteBehavior.Cascade, requirement.DeleteBehavior);
        Assert.Equal(DeleteBehavior.Restrict, assessment.DeleteBehavior);
    }

    [Fact]
    public void Initial_migration_is_compiled_into_the_assembly()
    {
        var migration = typeof(ComplyDbContext).Assembly
            .GetTypes()
            .SingleOrDefault(type => type.Name == "InitialSchema");

        Assert.NotNull(migration);
        Assert.StartsWith("Comply.Functions.Data.Migrations", migration!.Namespace);
    }

    [Fact]
    public void The_evidence_extension_migration_is_compiled_into_the_assembly()
    {
        var migration = typeof(ComplyDbContext).Assembly
            .GetTypes()
            .SingleOrDefault(type => type.Name == "AddEvidenceCitationAndHash");

        Assert.NotNull(migration);
        Assert.StartsWith("Comply.Functions.Data.Migrations", migration!.Namespace);
    }

    [Fact]
    public void The_model_snapshot_carries_the_agent_columns()
    {
        using var context = CreateContext();
        var evidence = Entity(context, typeof(Evidence));

        Assert.Equal("citation", evidence.FindProperty(nameof(Evidence.Citation))!.GetColumnName());
        Assert.Equal("hash", evidence.FindProperty(nameof(Evidence.Hash))!.GetColumnName());
        Assert.True(evidence.FindProperty(nameof(Evidence.Citation))!.IsNullable);
        Assert.True(evidence.FindProperty(nameof(Evidence.Hash))!.IsNullable);
        Assert.Equal(
            "text",
            evidence.FindProperty(nameof(Evidence.Hash))!.GetColumnType());
    }
}
