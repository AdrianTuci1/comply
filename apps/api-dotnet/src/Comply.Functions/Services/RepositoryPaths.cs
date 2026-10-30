namespace Comply.Functions.Services;

internal static class RepositoryPaths
{
    /// <summary>
    /// Walks up from the build output and the working directory looking for the repository
    /// marker. Returns null when the app runs from a published, repository-free directory.
    /// </summary>
    public static string? FindRoot()
    {
        var starts = new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() };

        foreach (var start in starts)
        {
            var directory = new DirectoryInfo(start);
            while (directory is not null)
            {
                var marker = Path.Combine(
                    directory.FullName, "apps", "api-node", "seed", "library.json");
                if (File.Exists(marker)) return directory.FullName;
                directory = directory.Parent;
            }
        }

        return null;
    }
}
