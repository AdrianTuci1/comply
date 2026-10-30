using System.Text;
using Comply.Functions.Data;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Comply.Functions.Tests;

public sealed class CosmosDocumentTests
{
    private readonly CosmosJsonSerializer _serializer = new();

    [Fact]
    public void Documents_use_camel_case_and_a_top_level_id()
    {
        var user = new User
        {
            Id = "usr_1",
            OrganizationId = "org_1",
            Email = "ana@example.com",
            Name = "Ana",
            CreatedAt = DateTimeOffset.Parse("2026-01-02T03:04:05Z"),
        };

        var document = Serialize(user);

        Assert.Equal("usr_1", document["id"]!.Value<string>());
        Assert.Equal("org_1", document["organizationId"]!.Value<string>());
        Assert.Equal("ana@example.com", document["email"]!.Value<string>());
        Assert.Equal(
            DateTimeOffset.Parse("2026-01-02T03:04:05Z"),
            DateTimeOffset.Parse(document["createdAt"]!.Value<string>()!));
    }

    [Fact]
    public void Navigation_properties_and_nulls_are_not_persisted()
    {
        var user = new User
        {
            Id = "usr_1",
            OrganizationId = "org_1",
            Email = "ana@example.com",
            Name = "Ana",
            Organization = new Organization { Id = "org_1", Name = "Acme", Slug = "acme" },
        };

        var document = Serialize(user);

        Assert.Null(document["organization"]);
        Assert.Null(document["passwordHash"]);
        Assert.Null(document["lastLoginAt"]);
        Assert.Null(document["externalLogins"]);
    }

    [Fact]
    public void Assessments_embed_requirements_evidence_and_events()
    {
        var assessment = new Assessment
        {
            Id = "asm_1",
            OrganizationId = "org_1",
            Framework = "nis2",
            Name = "NIS2 2026",
            PeriodFrom = new DateOnly(2026, 1, 1),
            PeriodTo = new DateOnly(2026, 12, 31),
            Requirements =
            [
                new AssessmentRequirement
                {
                    Id = "req_1",
                    AssessmentId = "asm_1",
                    LibraryRequirementId = "nis2-1",
                    Ref = "1",
                    Title = "Risk policy",
                    Evidence =
                    [
                        new Evidence
                        {
                            Id = "ev_1",
                            AssessmentRequirementId = "req_1",
                            Type = "document",
                            Title = "Policy.pdf",
                        },
                    ],
                },
            ],
            Events =
            [
                new AssessmentEvent
                {
                    Id = "evt_1",
                    AssessmentId = "asm_1",
                    Revision = 1,
                    Type = "created",
                    Message = "Assessment created.",
                },
            ],
        };

        var document = Serialize(assessment);

        Assert.Equal("2026-01-01", document["periodFrom"]!.Value<string>());
        Assert.Equal("2026-12-31", document["periodTo"]!.Value<string>());
        Assert.Null(document["organization"]);
        Assert.Equal("Policy.pdf", document["requirements"]![0]!["evidence"]![0]!["title"]!.Value<string>());
        Assert.Equal("created", document["events"]![0]!["type"]!.Value<string>());
    }

    [Fact]
    public void Assessments_round_trip_through_the_cosmos_serializer()
    {
        var assessment = new Assessment
        {
            Id = "asm_1",
            OrganizationId = "org_1",
            Framework = "iso27001",
            Name = "ISO 27001",
            PeriodFrom = new DateOnly(2026, 3, 1),
            Requirements = [new AssessmentRequirement { Id = "req_1", AssessmentId = "asm_1" }],
        };

        var stream = _serializer.ToStream(assessment);
        stream.Position = 0;
        var restored = _serializer.FromStream<Assessment>(stream);

        Assert.Equal("asm_1", restored.Id);
        Assert.Equal(new DateOnly(2026, 3, 1), restored.PeriodFrom);
        Assert.Single(restored.Requirements);
        Assert.Equal("req_1", restored.Requirements[0].Id);
    }

    [Fact]
    public void Deserialization_closes_the_response_stream()
    {
        // The Cosmos SDK fails the request when a custom serializer leaves the stream open.
        using var stream = _serializer.ToStream(new User { Id = "usr_1" });
        stream.Position = 0;

        _serializer.FromStream<User>(stream);

        Assert.False(stream.CanRead);
    }

    [Fact]
    public void Settings_default_to_the_comply_database_and_creation_enabled()
    {
        var settings = CosmosSettings.Resolve("AccountEndpoint=https://example.documents.azure.com:443/;AccountKey=key;", null, null, null);

        Assert.True(settings.IsConfigured);
        Assert.Equal("comply", settings.Database);
        Assert.True(settings.CreateContainers);
        Assert.False(settings.AllowEmulatorCertificate);
    }

    [Fact]
    public void Settings_detect_the_local_emulator()
    {
        var settings = CosmosSettings.Resolve(
            "AccountEndpoint=https://localhost:8081/;AccountKey=key;",
            "comply-test",
            "0",
            null);

        Assert.True(settings.AllowEmulatorCertificate);
        Assert.False(settings.CreateContainers);
        Assert.Equal("comply-test", settings.Database);
    }

    [Fact]
    public void Settings_report_the_endpoint_without_the_account_key()
    {
        var settings = CosmosSettings.Resolve(
            "AccountEndpoint=https://comply.documents.azure.com:443/;AccountKey=secret;",
            null,
            null,
            null);

        Assert.Equal("comply.documents.azure.com/comply", settings.DescribeTarget());
        Assert.DoesNotContain("secret", settings.DescribeTarget());
    }

    private JObject Serialize<T>(T value)
    {
        using var stream = _serializer.ToStream(value);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        using var json = new JsonTextReader(reader) { DateParseHandling = DateParseHandling.None };
        return JObject.Load(json);
    }
}
