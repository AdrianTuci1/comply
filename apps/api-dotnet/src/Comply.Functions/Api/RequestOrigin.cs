using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace Comply.Functions.Api;

/// <summary>Public origin of the request, honouring the reverse-proxy headers used in Azure.</summary>
public static class RequestOrigin
{
    public static string Resolve(HttpRequest request, string? publicUrl)
    {
        if (!string.IsNullOrWhiteSpace(publicUrl)) return publicUrl.Trim().TrimEnd('/');

        var scheme = Header(request, "X-Forwarded-Proto") ?? request.Scheme;
        var host = Header(request, "X-Forwarded-Host") ?? request.Host.Value;
        return $"{scheme}://{host}";
    }

    public static string? Header(HttpRequest request, string name) =>
        request.Headers.TryGetValue(name, out StringValues values) && values.Count > 0
            ? values[0]
            : null;
}
