using Comply.Functions.Api;
using Comply.Functions.Auth;
using Comply.Functions.Data;
using Microsoft.EntityFrameworkCore;

namespace Comply.Functions.Tests;

public sealed class AuthApiTests
{
    private const string StrongPassword = "correct horse battery";

    private static string RegisterBody(
        string email = "ada@example.com",
        string password = StrongPassword,
        string? name = "Ada Lovelace",
        string organization = "Nordwind Logistics") =>
        $$"""{"email":"{{email}}","name":"{{name}}","password":"{{password}}","organizationName":"{{organization}}"}""";

    private static async Task<SessionResult> AdminSessionAsync(AuthFixture fixture)
    {
        var response = await fixture.SendAsync("/api/auth/register", "POST", RegisterBody());
        Assert.Equal(201, response.Status);
        return (SessionResult)response.Body!;
    }

    [Fact]
    public async Task First_registration_creates_the_admin_and_returns_a_session()
    {
        using var fixture = new AuthFixture();

        var response = await fixture.SendAsync("/api/auth/register", "POST", RegisterBody());

        Assert.Equal(201, response.Status);
        var body = TestJson.Body(response);
        Assert.False(string.IsNullOrWhiteSpace(body["session"]!.GetValue<string>()));
        Assert.Equal("2026-10-30T20:00:00.000Z", body["expiresAt"]!.GetValue<string>());
        Assert.Equal("ada@example.com", body["user"]!["email"]!.GetValue<string>());
        Assert.Equal("Ada Lovelace", body["user"]!["name"]!.GetValue<string>());
        Assert.Equal("Nordwind Logistics", body["user"]!["organizationName"]!.GetValue<string>());
        Assert.Equal("admin", body["user"]!["role"]!.GetValue<string>());
    }

    [Fact]
    public async Task Registration_sets_a_httponly_session_cookie()
    {
        using var fixture = new AuthFixture();

        var response = await fixture.SendAsync("/api/auth/register", "POST", RegisterBody());

        var cookie = response.Headers!["Set-Cookie"];
        Assert.Contains("comply_session=", cookie);
        Assert.Contains("HttpOnly", cookie);
        Assert.Contains("SameSite=Lax", cookie);
        Assert.DoesNotContain("Secure", cookie);
    }

    [Fact]
    public async Task First_registration_stores_the_admin_with_a_password_hash()
    {
        using var fixture = new AuthFixture();

        await AdminSessionAsync(fixture);

        await using var context = await fixture.CreateContextAsync();
        var user = await context.Users.Include(item => item.Organization).SingleAsync();
        Assert.Equal("ada@example.com", user.Email);
        Assert.Equal(Roles.Admin, user.Role);
        Assert.Contains("password", user.Providers);
        Assert.NotNull(user.PasswordHash);
        Assert.DoesNotContain(StrongPassword, user.PasswordHash!);
        Assert.Single(context.Organizations);
        Assert.Equal("nordwind-logistics", user.Organization!.Slug);
    }

    [Fact]
    public async Task Later_registrations_are_refused_with_403()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);

        var response = await fixture.SendAsync(
            "/api/auth/register",
            "POST",
            RegisterBody(email: "grace@example.com"));

        Assert.Equal(403, response.Status);
        Assert.Equal(
            "Setup is already complete. Ask an administrator for an account.",
            TestJson.Error(response));
    }

    [Fact]
    public async Task Registration_validates_the_email_and_password()
    {
        using var fixture = new AuthFixture();

        var badEmail = await fixture.SendAsync(
            "/api/auth/register",
            "POST",
            RegisterBody(email: "not-an-email"));
        var shortPassword = await fixture.SendAsync(
            "/api/auth/register",
            "POST",
            RegisterBody(password: "short"));

        Assert.Equal(400, badEmail.Status);
        Assert.Equal("Enter a valid email address.", TestJson.Error(badEmail));
        Assert.Equal(400, shortPassword.Status);
        Assert.Equal("Use a password with at least 10 characters.", TestJson.Error(shortPassword));
    }

    [Fact]
    public async Task Registering_an_existing_email_cannot_create_a_second_account()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);

        var response = await fixture.SendAsync("/api/auth/register", "POST", RegisterBody());

        Assert.Equal(403, response.Status);
        await using var context = await fixture.CreateContextAsync();
        Assert.Single(context.Users);
        Assert.Single(context.Organizations);
    }

    [Fact]
    public async Task Login_returns_the_node_session_shape()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);

        var response = await fixture.SendAsync(
            "/api/auth/login",
            "POST",
            $$"""{"email":"ADA@example.com","password":"{{StrongPassword}}"}""");

        Assert.Equal(200, response.Status);
        var body = TestJson.Body(response);
        Assert.False(string.IsNullOrWhiteSpace(body["session"]!.GetValue<string>()));
        Assert.Equal("2026-10-30T20:00:00.000Z", body["expiresAt"]!.GetValue<string>());
        Assert.Equal("admin", body["user"]!["role"]!.GetValue<string>());
        Assert.Equal("Nordwind Logistics", body["user"]!["organizationName"]!.GetValue<string>());
    }

    [Fact]
    public async Task Login_rejects_wrong_credentials()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);

        var wrongPassword = await fixture.SendAsync(
            "/api/auth/login",
            "POST",
            """{"email":"ada@example.com","password":"wrong password here"}""");
        var unknownEmail = await fixture.SendAsync(
            "/api/auth/login",
            "POST",
            """{"email":"nobody@example.com","password":"correct horse battery"}""");

        Assert.Equal(401, wrongPassword.Status);
        Assert.Equal("Email or password is incorrect.", TestJson.Error(wrongPassword));
        Assert.Equal(401, unknownEmail.Status);
    }

    [Fact]
    public async Task Login_is_unavailable_without_a_database()
    {
        using var fixture = new AuthFixture();
        var withoutDatabase = new AuthApi(
            new AuthService(
                new UserDirectory(new EfComplyStore(new ComplyDatabase(null)), fixture.Time),
                fixture.Tokens,
                new PasswordHasher(),
                fixture.Time),
            new OidcService([], fixture.Tokens, fixture.Http, fixture.Time),
            fixture.Settings,
            new DeploymentSettings(null, null, null, null),
            fixture.Http);

        var request = TestRequest.Build("/api/auth/login", "POST", """{"email":"a@b.co","password":"1234567890"}""");
        var response = await withoutDatabase.TryHandleAsync(request, "/api/auth/login", default);

        Assert.Equal(503, response!.Status);
        Assert.Equal("The database is not configured for this deployment.", TestJson.Error(response));
    }

    [Fact]
    public async Task Magic_link_returns_a_dev_token_and_verifies_into_a_session()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);

        var magic = await fixture.SendAsync(
            "/api/auth/magic-link",
            "POST",
            """{"email":"  ADA@Example.com "}""");

        Assert.Equal(201, magic.Status);
        var magicBody = TestJson.Body(magic);
        Assert.True(magicBody["sent"]!.GetValue<bool>());
        Assert.Equal("ada@example.com", magicBody["email"]!.GetValue<string>());
        Assert.Equal("2026-10-30T12:15:00.000Z", magicBody["expiresAt"]!.GetValue<string>());
        var token = magicBody["devToken"]!.GetValue<string>();

        var verify = await fixture.SendAsync("/api/auth/verify", "POST", $$"""{"token":"{{token}}"}""");

        Assert.Equal(200, verify.Status);
        var session = TestJson.Body(verify);
        Assert.Equal("ada@example.com", session["user"]!["email"]!.GetValue<string>());
        Assert.False(string.IsNullOrWhiteSpace(session["session"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Magic_link_omits_the_dev_token_when_email_delivery_is_configured()
    {
        using var fixture = new AuthFixture(
            mailWebhookUrl: "https://mail.example.com/hook",
            devLinks: false,
            handler: new StubHandler(System.Net.HttpStatusCode.OK, "{}"));
        await AdminSessionAsync(fixture);

        var response = await fixture.SendAsync(
            "/api/auth/magic-link",
            "POST",
            """{"email":"ada@example.com"}""");

        Assert.Equal(201, response.Status);
        Assert.Null(TestJson.Body(response)["devToken"]);
    }

    [Fact]
    public async Task Magic_link_fails_when_no_delivery_channel_exists()
    {
        using var fixture = new AuthFixture(devLinks: false);
        await AdminSessionAsync(fixture);

        var response = await fixture.SendAsync(
            "/api/auth/magic-link",
            "POST",
            """{"email":"ada@example.com"}""");

        Assert.Equal(503, response.Status);
        Assert.Equal("Email delivery is not configured for this deployment.", TestJson.Error(response));
    }

    [Fact]
    public async Task Magic_link_rejects_an_expired_token()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);
        var token = new AuthService(
                fixture.Users,
                fixture.Tokens,
                new PasswordHasher(),
                fixture.Time)
            .RequestMagicLink("ada@example.com")
            .Token;

        fixture.Time.Advance(TimeSpan.FromMinutes(16));

        var response = await fixture.SendAsync("/api/auth/verify", "POST", $$"""{"token":"{{token}}"}""");

        Assert.Equal(400, response.Status);
        Assert.Equal("This sign-in link is invalid or has expired.", TestJson.Error(response));
    }

    [Fact]
    public async Task Magic_link_for_an_unknown_email_cannot_be_verified()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);
        var token = fixture.Tokens.SignMagic("nobody@example.com");

        var response = await fixture.SendAsync("/api/auth/verify", "POST", $$"""{"token":"{{token}}"}""");

        Assert.Equal(400, response.Status);
        Assert.Equal("No account exists for this email.", TestJson.Error(response));
    }

    [Fact]
    public async Task Providers_reports_setup_state_before_registration()
    {
        using var fixture = new AuthFixture();

        var response = await fixture.SendAsync("/api/auth/providers");

        Assert.Equal(200, response.Status);
        var body = TestJson.Body(response);
        Assert.True(body["password"]!.GetValue<bool>());
        Assert.Empty(body["providers"]!.AsArray());
        Assert.False(body["demo"]!.GetValue<bool>());
        Assert.True(body["setupRequired"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Providers_setup_is_complete_after_registration()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);

        var body = TestJson.Body(await fixture.SendAsync("/api/auth/providers"));

        Assert.False(body["setupRequired"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Providers_lists_only_configured_providers()
    {
        using var fixture = new AuthFixture(new Dictionary<string, string>
        {
            ["COMPLY_OIDC_GOOGLE_CLIENT_ID"] = "google-id",
            ["COMPLY_OIDC_GOOGLE_CLIENT_SECRET"] = "google-secret",
            ["COMPLY_OIDC_GITHUB_CLIENT_ID"] = "github-id",
            ["COMPLY_OIDC_GITHUB_CLIENT_SECRET"] = "github-secret",
            ["COMPLY_OIDC_CLIENT_ID"] = "sso-id",
            ["COMPLY_OIDC_CLIENT_SECRET"] = "sso-secret",
            ["COMPLY_OIDC_ISSUER"] = "https://sso.example.com",
            ["COMPLY_OIDC_AUTHORIZATION_ENDPOINT"] = "https://sso.example.com/authorize",
            ["COMPLY_OIDC_TOKEN_ENDPOINT"] = "https://sso.example.com/token",
            ["COMPLY_OIDC_JWKS_URI"] = "https://sso.example.com/jwks",
            ["COMPLY_OIDC_LABEL"] = "Example SSO",
        });

        var body = TestJson.Body(await fixture.SendAsync("/api/auth/providers"));
        var providers = body["providers"]!.AsArray();

        Assert.Equal(3, providers.Count);
        Assert.Equal("google", providers[0]!["id"]!.GetValue<string>());
        Assert.Equal("GitHub", providers[1]!["label"]!.GetValue<string>());
        Assert.Equal("oauth2", providers[1]!["kind"]!.GetValue<string>());
        Assert.Equal("sso", providers[2]!["id"]!.GetValue<string>());
        Assert.Equal("Example SSO", providers[2]!["label"]!.GetValue<string>());
        Assert.Equal("oidc", providers[2]!["kind"]!.GetValue<string>());
    }

    [Fact]
    public async Task Me_resolves_bearer_and_cookie_sessions()
    {
        using var fixture = new AuthFixture();
        var session = await AdminSessionAsync(fixture);

        var bearer = await fixture.SendAsync("/api/auth/me", bearer: session.Session);
        var cookie = await fixture.SendAsync(
            "/api/auth/me",
            cookie: $"comply_session={session.Session}");
        var anonymous = await fixture.SendAsync("/api/auth/me");

        Assert.Equal(200, bearer.Status);
        Assert.Equal("ada@example.com", TestJson.Body(bearer)["user"]!["email"]!.GetValue<string>());
        Assert.Equal(200, cookie.Status);
        Assert.Equal(401, anonymous.Status);
        Assert.Equal("Not signed in.", TestJson.Error(anonymous));
    }

    [Fact]
    public async Task Me_rejects_a_token_signed_with_another_secret()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);
        var foreign = new AuthTokenService("another-secret", fixture.Time);

        var response = await fixture.SendAsync("/api/auth/me", bearer: foreign.SignSession("ada@example.com"));

        Assert.Equal(401, response.Status);
    }

    [Fact]
    public async Task Exchange_trades_a_one_time_code_for_a_session()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);
        var code = fixture.Auth.IssueCode("ada@example.com");

        var response = await fixture.SendAsync("/api/auth/exchange", "POST", $$"""{"code":"{{code}}"}""");

        Assert.Equal(200, response.Status);
        Assert.Equal("ada@example.com", TestJson.Body(response)["user"]!["email"]!.GetValue<string>());
    }

    [Fact]
    public async Task Exchange_rejects_invalid_and_expired_codes()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);
        var code = fixture.Auth.IssueCode("ada@example.com");

        var invalid = await fixture.SendAsync("/api/auth/exchange", "POST", """{"code":"nope"}""");

        fixture.Time.Advance(TimeSpan.FromSeconds(61));
        var expired = await fixture.SendAsync("/api/auth/exchange", "POST", $$"""{"code":"{{code}}"}""");

        Assert.Equal(400, invalid.Status);
        Assert.Equal("This sign-in code is invalid or has expired.", TestJson.Error(invalid));
        Assert.Equal(400, expired.Status);
    }

    [Fact]
    public async Task A_magic_link_token_cannot_be_exchanged_as_an_oidc_code()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);
        var magic = fixture.Tokens.SignMagic("ada@example.com");

        var response = await fixture.SendAsync("/api/auth/exchange", "POST", $$"""{"code":"{{magic}}"}""");

        Assert.Equal(400, response.Status);
    }

    [Fact]
    public async Task Sign_out_clears_the_session_cookie()
    {
        using var fixture = new AuthFixture();

        var response = await fixture.SendAsync("/api/auth/sign-out", "POST");

        Assert.Equal(204, response.Status);
        Assert.Contains("Max-Age=0", response.Headers!["Set-Cookie"]);
    }

    [Fact]
    public async Task Unknown_auth_routes_return_404_and_wrong_methods_return_405()
    {
        using var fixture = new AuthFixture();

        var unknown = await fixture.SendAsync("/api/auth/nope");
        var wrongMethod = await fixture.SendAsync("/api/auth/login");

        Assert.Equal(404, unknown.Status);
        Assert.Equal(405, wrongMethod.Status);
        Assert.Equal("POST, OPTIONS", wrongMethod.Headers!["Allow"]);
    }

    [Theory]
    [InlineData("google")]
    [InlineData("github")]
    public async Task Oidc_callback_errors_redirect_to_the_app(string provider)
    {
        using var fixture = new AuthFixture(new Dictionary<string, string>
        {
            ["COMPLY_OIDC_GOOGLE_CLIENT_ID"] = "id",
            ["COMPLY_OIDC_GOOGLE_CLIENT_SECRET"] = "secret",
            ["COMPLY_OIDC_GITHUB_CLIENT_ID"] = "id",
            ["COMPLY_OIDC_GITHUB_CLIENT_SECRET"] = "secret",
        });

        var response = await fixture.SendAsync(
            $"/api/auth/oidc/{provider}/callback",
            query: "?error=access_denied");

        Assert.Equal(302, response.Status);
        Assert.Equal(
            "http://localhost:4200/sign-in?error=Sign-in%20was%20cancelled.",
            response.Headers!["Location"]);
    }

    [Fact]
    public async Task Oidc_callback_rejects_an_expired_state()
    {
        using var fixture = new AuthFixture(new Dictionary<string, string>
        {
            ["COMPLY_OIDC_GOOGLE_CLIENT_ID"] = "id",
            ["COMPLY_OIDC_GOOGLE_CLIENT_SECRET"] = "secret",
        });
        var state = fixture.Tokens.SignState("google", "verifier", "nonce");
        fixture.Time.Advance(TimeSpan.FromMinutes(11));

        var response = await fixture.SendAsync(
            "/api/auth/oidc/google/callback",
            query: $"?code=abc&state={Uri.EscapeDataString(state)}");

        Assert.Equal(302, response.Status);
        Assert.Contains("error=", response.Headers!["Location"]);
        Assert.Contains("expired", response.Headers!["Location"]);
    }

    [Fact]
    public async Task Oidc_start_redirects_to_the_provider()
    {
        using var fixture = new AuthFixture(new Dictionary<string, string>
        {
            ["COMPLY_OIDC_GOOGLE_CLIENT_ID"] = "google-id",
            ["COMPLY_OIDC_GOOGLE_CLIENT_SECRET"] = "google-secret",
        });

        var response = await fixture.SendAsync("/api/auth/oidc/google/start");

        Assert.Equal(302, response.Status);
        Assert.StartsWith("https://accounts.google.com/o/oauth2/v2/auth?", response.Headers!["Location"]);
    }

    [Fact]
    public async Task Oidc_start_for_an_unconfigured_provider_returns_404()
    {
        using var fixture = new AuthFixture();

        var response = await fixture.SendAsync("/api/auth/oidc/google/start");

        Assert.Equal(404, response.Status);
        Assert.Equal("This sign-in provider is not configured.", TestJson.Error(response));
    }

    [Fact]
    public async Task External_sign_in_reuses_the_account_for_a_known_email()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);

        var google = await fixture.Users.EnsureExternalAsync(
            new OidcIdentity("google", "google-subject", "ada@example.com", "Ada"),
            default);
        var github = await fixture.Users.EnsureExternalAsync(
            new OidcIdentity("github", "github-subject", "ada@example.com", "Ada"),
            default);

        Assert.Equal(google.Id, github.Id);
        await using var context = await fixture.CreateContextAsync();
        Assert.Single(context.Users);
        Assert.Equal(2, context.ExternalLogins.Count());
        var stored = await context.Users.SingleAsync();
        Assert.Contains("password", stored.Providers);
        Assert.Contains("google", stored.Providers);
        Assert.Contains("github", stored.Providers);
    }

    [Fact]
    public async Task External_sign_in_on_an_empty_installation_creates_the_admin()
    {
        using var fixture = new AuthFixture();

        var user = await fixture.Users.EnsureExternalAsync(
            new OidcIdentity("google", "subject-1", "grace@example.com", null),
            default);

        Assert.Equal(Roles.Admin, user.Role);
        Assert.Equal("Grace", user.Name);
        Assert.Null(user.PasswordHash);
        Assert.Equal("Organization", user.Organization!.Name);
    }

    [Fact]
    public async Task External_login_links_are_unique_per_provider_and_subject()
    {
        using var fixture = new AuthFixture();
        await AdminSessionAsync(fixture);
        var identity = new OidcIdentity("google", "subject-1", "ada@example.com", "Ada");

        await fixture.Users.EnsureExternalAsync(identity, default);
        await fixture.Users.EnsureExternalAsync(identity, default);

        await using var context = await fixture.CreateContextAsync();
        Assert.Single(context.ExternalLogins);
    }

    [Fact]
    public void Expires_at_is_formatted_as_a_utc_iso_string()
    {
        Assert.Equal(
            "2026-10-30T20:00:00.000Z",
            AuthService.FormatTimestamp(
                new DateTimeOffset(2026, 10, 30, 21, 0, 0, TimeSpan.FromHours(1))));
    }
}
