using Microsoft.EntityFrameworkCore;

namespace Comply.Functions.Data;

/// <summary>
/// EF Core model used by the test adapter (<see cref="EfComplyStore"/>). Production persistence
/// goes through <see cref="CosmosComplyStore"/>; the model only needs to behave like a
/// relational store for the in-memory provider.
/// </summary>
public sealed class ComplyDbContext(DbContextOptions<ComplyDbContext> options) : DbContext(options)
{
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<User> Users => Set<User>();
    public DbSet<ExternalLogin> ExternalLogins => Set<ExternalLogin>();
    public DbSet<Assessment> Assessments => Set<Assessment>();
    public DbSet<AssessmentRequirement> AssessmentRequirements => Set<AssessmentRequirement>();
    public DbSet<Evidence> Evidence => Set<Evidence>();
    public DbSet<AssessmentEvent> AssessmentEvents => Set<AssessmentEvent>();
    public DbSet<McpKey> McpKeys => Set<McpKey>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Organization>(entity =>
        {
            entity.ToTable("organizations");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.Name).HasColumnName("name").HasColumnType("text").IsRequired();
            entity.Property(item => item.Slug).HasColumnName("slug").HasColumnType("text").IsRequired();
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone");
            entity.HasIndex(item => item.Slug).IsUnique().HasDatabaseName("ix_organizations_slug");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.OrganizationId).HasColumnName("organization_id").HasColumnType("text").IsRequired();
            entity.Property(item => item.Email).HasColumnName("email").HasColumnType("text").IsRequired();
            entity.Property(item => item.Name).HasColumnName("name").HasColumnType("text").IsRequired();
            entity.Property(item => item.Role).HasColumnName("role").HasColumnType("text").IsRequired();
            entity.Property(item => item.PasswordHash).HasColumnName("password_hash").HasColumnType("text");
            entity.Property(item => item.Providers).HasColumnName("providers").HasColumnType("text[]").IsRequired();
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone");
            entity.Property(item => item.LastLoginAt).HasColumnName("last_login_at").HasColumnType("timestamp with time zone");
            entity.HasIndex(item => item.Email).IsUnique().HasDatabaseName("ix_users_email");
            entity.HasIndex(item => item.OrganizationId).HasDatabaseName("ix_users_organization_id");
            entity.HasOne(item => item.Organization)
                .WithMany(organization => organization.Users)
                .HasForeignKey(item => item.OrganizationId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ExternalLogin>(entity =>
        {
            entity.ToTable("external_logins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.UserId).HasColumnName("user_id").HasColumnType("text").IsRequired();
            entity.Property(item => item.Provider).HasColumnName("provider").HasColumnType("text").IsRequired();
            entity.Property(item => item.Subject).HasColumnName("subject").HasColumnType("text").IsRequired();
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone");
            entity.HasIndex(item => new { item.Provider, item.Subject })
                .IsUnique()
                .HasDatabaseName("ix_external_logins_provider_subject");
            entity.HasIndex(item => item.UserId).HasDatabaseName("ix_external_logins_user_id");
            entity.HasOne(item => item.User)
                .WithMany(user => user.ExternalLogins)
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Assessment>(entity =>
        {
            entity.ToTable("assessments");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.OrganizationId).HasColumnName("organization_id").HasColumnType("text").IsRequired();
            entity.Property(item => item.Framework).HasColumnName("framework").HasColumnType("text").IsRequired();
            entity.Property(item => item.Name).HasColumnName("name").HasColumnType("text").IsRequired();
            entity.Property(item => item.Scope).HasColumnName("scope").HasColumnType("text");
            entity.Property(item => item.PeriodFrom).HasColumnName("period_from").HasColumnType("date");
            entity.Property(item => item.PeriodTo).HasColumnName("period_to").HasColumnType("date");
            entity.Property(item => item.Phase).HasColumnName("phase").HasColumnType("text").IsRequired();
            entity.Property(item => item.Revision).HasColumnName("revision").HasColumnType("integer");
            entity.Property(item => item.ContentStatus).HasColumnName("content_status").HasColumnType("text").IsRequired();
            entity.Property(item => item.Language).HasColumnName("language").HasColumnType("text").IsRequired();
            entity.Property(item => item.CreatedBy).HasColumnName("created_by").HasColumnType("text");
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone");
            entity.Property(item => item.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp with time zone");
            entity.Property(item => item.ReviewedAt).HasColumnName("reviewed_at").HasColumnType("timestamp with time zone");
            entity.Property(item => item.ExportedAt).HasColumnName("exported_at").HasColumnType("timestamp with time zone");
            entity.HasIndex(item => new { item.OrganizationId, item.Framework })
                .HasDatabaseName("ix_assessments_organization_framework");
            entity.HasIndex(item => new { item.OrganizationId, item.ContentStatus })
                .HasDatabaseName("ix_assessments_organization_content_status");
            entity.HasIndex(item => new { item.OrganizationId, item.UpdatedAt })
                .HasDatabaseName("ix_assessments_organization_updated_at");
            entity.HasOne(item => item.Organization)
                .WithMany(organization => organization.Assessments)
                .HasForeignKey(item => item.OrganizationId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<AssessmentRequirement>(entity =>
        {
            entity.ToTable("assessment_requirements");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.AssessmentId).HasColumnName("assessment_id").HasColumnType("text").IsRequired();
            entity.Property(item => item.LibraryRequirementId).HasColumnName("library_requirement_id").HasColumnType("text").IsRequired();
            entity.Property(item => item.Ref).HasColumnName("ref").HasColumnType("text").IsRequired();
            entity.Property(item => item.Title).HasColumnName("title").HasColumnType("text").IsRequired();
            entity.Property(item => item.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(item => item.SourceId).HasColumnName("source_id").HasColumnType("text");
            entity.Property(item => item.Theme).HasColumnName("theme").HasColumnType("text");
            entity.Property(item => item.Status).HasColumnName("status").HasColumnType("text").IsRequired();
            entity.Property(item => item.Conclusion).HasColumnName("conclusion").HasColumnType("text");
            entity.Property(item => item.CompletedAt).HasColumnName("completed_at").HasColumnType("timestamp with time zone");
            entity.Property(item => item.Position).HasColumnName("position").HasColumnType("integer");
            entity.HasIndex(item => item.AssessmentId).HasDatabaseName("ix_assessment_requirements_assessment_id");
            entity.HasIndex(item => new { item.AssessmentId, item.Status })
                .HasDatabaseName("ix_assessment_requirements_assessment_status");
            entity.HasIndex(item => new { item.AssessmentId, item.Position })
                .HasDatabaseName("ix_assessment_requirements_assessment_position");
            // The agent addresses requirements by their library id, and one assessment never
            // carries the same library requirement twice.
            entity.HasIndex(item => new { item.AssessmentId, item.LibraryRequirementId })
                .IsUnique()
                .HasDatabaseName("ix_assessment_requirements_assessment_library_requirement");
            entity.HasOne(item => item.Assessment)
                .WithMany(assessment => assessment.Requirements)
                .HasForeignKey(item => item.AssessmentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Evidence>(entity =>
        {
            entity.ToTable("evidence");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.AssessmentRequirementId)
                .HasColumnName("assessment_requirement_id")
                .HasColumnType("text")
                .IsRequired();
            entity.Property(item => item.Type).HasColumnName("type").HasColumnType("text").IsRequired();
            entity.Property(item => item.Title).HasColumnName("title").HasColumnType("text").IsRequired();
            entity.Property(item => item.Source).HasColumnName("source").HasColumnType("text");
            entity.Property(item => item.Summary).HasColumnName("summary").HasColumnType("text");
            entity.Property(item => item.Citation).HasColumnName("citation").HasColumnType("text");
            entity.Property(item => item.Hash).HasColumnName("hash").HasColumnType("text");
            entity.Property(item => item.Url).HasColumnName("url").HasColumnType("text");
            entity.Property(item => item.CreatedBy).HasColumnName("created_by").HasColumnType("text");
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone");
            entity.HasIndex(item => item.AssessmentRequirementId)
                .HasDatabaseName("ix_evidence_assessment_requirement_id");
            entity.HasOne(item => item.AssessmentRequirement)
                .WithMany(requirement => requirement.Evidence)
                .HasForeignKey(item => item.AssessmentRequirementId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AssessmentEvent>(entity =>
        {
            entity.ToTable("assessment_events");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.AssessmentId).HasColumnName("assessment_id").HasColumnType("text").IsRequired();
            entity.Property(item => item.Revision).HasColumnName("revision").HasColumnType("integer");
            entity.Property(item => item.Type).HasColumnName("type").HasColumnType("text").IsRequired();
            entity.Property(item => item.Message).HasColumnName("message").HasColumnType("text").IsRequired();
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone");
            entity.HasIndex(item => new { item.AssessmentId, item.Revision })
                .HasDatabaseName("ix_assessment_events_assessment_revision");
            entity.HasOne(item => item.Assessment)
                .WithMany(assessment => assessment.Events)
                .HasForeignKey(item => item.AssessmentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<McpKey>(entity =>
        {
            entity.ToTable("mcp_keys");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id").HasColumnType("text");
            entity.Property(item => item.OrganizationId).HasColumnName("organization_id").HasColumnType("text").IsRequired();
            entity.Property(item => item.Name).HasColumnName("name").HasColumnType("text").IsRequired();
            entity.Property(item => item.KeyPrefix).HasColumnName("key_prefix").HasColumnType("text").IsRequired();
            entity.Property(item => item.KeyHash).HasColumnName("key_hash").HasColumnType("text").IsRequired();
            entity.Property(item => item.Scopes).HasColumnName("scopes").HasColumnType("text[]").IsRequired();
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone");
            entity.Property(item => item.LastUsedAt).HasColumnName("last_used_at").HasColumnType("timestamp with time zone");
            entity.Property(item => item.RevokedAt).HasColumnName("revoked_at").HasColumnType("timestamp with time zone");
            entity.HasIndex(item => item.KeyHash).IsUnique().HasDatabaseName("ix_mcp_keys_key_hash");
            entity.HasIndex(item => new { item.OrganizationId, item.CreatedAt })
                .HasDatabaseName("ix_mcp_keys_organization_created_at");
            entity.HasOne(item => item.Organization)
                .WithMany(organization => organization.McpKeys)
                .HasForeignKey(item => item.OrganizationId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
