using System.Globalization;
using Comply.Functions.Data;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Auth;

/// <summary>
/// Local account and session logic. HTTP shaping lives in <see cref="Api.AuthApi"/>; this class
/// owns the rules and throws <see cref="AuthException"/> with the status the API returns.
/// </summary>
public sealed class AuthService(
    UserDirectory users,
    AuthTokenService tokens,
    PasswordHasher hasher,
    TimeProvider time,
    ILogger<AuthService>? logger = null)
{
    private readonly UserDirectory _users = users;
    private readonly AuthTokenService _tokens = tokens;
    private readonly PasswordHasher _hasher = hasher;
    private readonly TimeProvider _time = time;
    private readonly ILogger<AuthService>? _logger = logger;

    public bool DatabaseAvailable => _users.IsAvailable;

    /// <summary>Creates the first organization and admin; later registrations are refused.</summary>
    public async Task<SessionResult> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken)
    {
        RequireDatabase();

        var email = EmailAddress.Normalize(request.Email);
        if (!EmailAddress.IsValid(email))
        {
            throw new AuthException("Enter a valid email address.", 400);
        }

        if (string.IsNullOrEmpty(request.Password) || request.Password.Length < PasswordHasher.MinimumLength)
        {
            throw new AuthException(
                $"Use a password with at least {PasswordHasher.MinimumLength} characters.",
                400);
        }

        var organizationName = string.IsNullOrWhiteSpace(request.OrganizationName)
            ? "Organization"
            : request.OrganizationName.Trim();

        var user = await _users.CreateFirstAsync(
            email,
            UserDirectory.ResolveName(request.Name, email),
            _hasher.Hash(request.Password),
            organizationName,
            cancellationToken);

        _logger?.LogInformation("Created the first organization and admin account.");
        return BuildSession(user);
    }

    public async Task<SessionResult> LoginAsync(
        string? email,
        string? password,
        CancellationToken cancellationToken)
    {
        RequireDatabase();

        var user = await _users.FindByEmailAsync(EmailAddress.Normalize(email), cancellationToken);
        if (user?.PasswordHash is null || string.IsNullOrEmpty(password) || !_hasher.Verify(password, user.PasswordHash))
        {
            throw new AuthException("Email or password is incorrect.", 401);
        }

        await _users.TouchLoginAsync(user.Id, cancellationToken);
        return BuildSession(user);
    }

    public MagicLinkResult RequestMagicLink(string? email)
    {
        var normalized = EmailAddress.Normalize(email);
        if (!EmailAddress.IsValid(normalized))
        {
            throw new AuthException("Enter a valid email address.", 400);
        }

        var expiresAt = _time.GetUtcNow().Add(AuthTokenService.MagicTtl);
        return new MagicLinkResult(normalized, FormatTimestamp(expiresAt), _tokens.SignMagic(normalized, expiresAt));
    }

    public async Task<SessionResult> VerifyMagicLinkAsync(string? token, CancellationToken cancellationToken)
    {
        RequireDatabase();

        var payload = _tokens.Verify(token);
        if (payload is null || payload.Kind != TokenKind.Magic)
        {
            throw new AuthException("This sign-in link is invalid or has expired.", 400);
        }

        var user = await _users.FindByEmailAsync(payload.Email!, cancellationToken);
        if (user is null)
        {
            throw new AuthException("No account exists for this email.", 400);
        }

        await _users.TouchLoginAsync(user.Id, cancellationToken);
        return BuildSession(user);
    }

    public async Task<SessionResult> ExchangeCodeAsync(string? code, CancellationToken cancellationToken)
    {
        RequireDatabase();

        var payload = _tokens.Verify(code);
        if (payload is null || payload.Kind != TokenKind.OidcCode)
        {
            throw new AuthException("This sign-in code is invalid or has expired.", 400);
        }

        var user = await _users.FindByEmailAsync(payload.Email!, cancellationToken);
        if (user is null)
        {
            throw new AuthException("The account no longer exists.", 401);
        }

        await _users.TouchLoginAsync(user.Id, cancellationToken);
        return BuildSession(user);
    }

    /// <summary>Resolves the signed-in user for a bearer or cookie session token.</summary>
    public async Task<UserView?> UserForTokenAsync(string? token, CancellationToken cancellationToken)
    {
        if (!DatabaseAvailable) return null;

        var payload = _tokens.Verify(token);
        if (payload is null || payload.Kind != TokenKind.Session) return null;

        var user = await _users.FindByEmailAsync(payload.Email!, cancellationToken);
        return user is null ? null : ToView(user);
    }

    public async Task<ProvidersResult> GetProvidersAsync(
        IReadOnlyList<ProviderView> providers,
        CancellationToken cancellationToken)
    {
        return new ProvidersResult(
            Password: DatabaseAvailable,
            Providers: providers,
            Demo: false,
            SetupRequired: await SetupRequiredAsync(cancellationToken));
    }

    public async Task<bool> SetupRequiredAsync(CancellationToken cancellationToken) =>
        DatabaseAvailable && await _users.CountAsync(cancellationToken) == 0;

    public async Task<User> EnsureExternalAsync(OidcIdentity identity, CancellationToken cancellationToken)
    {
        RequireDatabase();
        var user = await _users.EnsureExternalAsync(identity, cancellationToken);
        _logger?.LogInformation("Signed in {Email} through {Provider}.", user.Email, identity.Provider);
        return user;
    }

    public string IssueCode(User user) => _tokens.SignCode(user.Email);

    public string IssueCode(string email) => _tokens.SignCode(email);

    public SessionResult SessionFor(User user) => BuildSession(user);

    private SessionResult BuildSession(User user)
    {
        var expiresAt = _time.GetUtcNow().Add(AuthTokenService.SessionTtl);
        return new SessionResult(
            _tokens.SignSession(user.Email, expiresAt),
            FormatTimestamp(expiresAt),
            ToView(user));
    }

    private static UserView ToView(User user) => new(
        user.Email,
        user.Name,
        user.Organization?.Name ?? "",
        user.Role);

    private void RequireDatabase()
    {
        if (!DatabaseAvailable)
        {
            throw new AuthException("The database is not configured for this deployment.", 503);
        }
    }

    internal static string FormatTimestamp(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
