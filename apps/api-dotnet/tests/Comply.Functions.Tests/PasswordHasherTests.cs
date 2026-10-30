using Comply.Functions.Auth;

namespace Comply.Functions.Tests;

public sealed class PasswordHasherTests
{
    private readonly PasswordHasher _hasher = new();

    [Fact]
    public void Hashes_and_verifies_a_password()
    {
        var hash = _hasher.Hash("correct horse battery");

        Assert.True(_hasher.Verify("correct horse battery", hash));
    }

    [Fact]
    public void Rejects_a_wrong_password()
    {
        var hash = _hasher.Hash("correct horse battery");

        Assert.False(_hasher.Verify("correct horse batterY", hash));
    }

    [Fact]
    public void Hash_is_versioned_and_self_describing()
    {
        var parts = _hasher.Hash("correct horse battery").Split('$');

        Assert.Equal(5, parts.Length);
        Assert.Equal("pbkdf2-sha256", parts[0]);
        Assert.Equal("v1", parts[1]);
        Assert.True(int.Parse(parts[2]) >= 100_000);
        Assert.NotEmpty(parts[3]);
        Assert.NotEmpty(parts[4]);
    }

    [Fact]
    public void Salt_is_unique_per_hash()
    {
        var first = _hasher.Hash("correct horse battery").Split('$');
        var second = _hasher.Hash("correct horse battery").Split('$');

        Assert.NotEqual(first[3], second[3]);
        Assert.NotEqual(first[4], second[4]);
    }

    [Fact]
    public void Rejects_malformed_or_foreign_hashes()
    {
        Assert.False(_hasher.Verify("password", null));
        Assert.False(_hasher.Verify("password", ""));
        Assert.False(_hasher.Verify("password", "scrypt$1234$abcd$ef01"));
        Assert.False(_hasher.Verify("password", "pbkdf2-sha256$v2$1000$abcd$ef01"));
        Assert.False(_hasher.Verify("password", "pbkdf2-sha256$v1$abc$abcd$ef01"));
        Assert.False(_hasher.Verify(null, _hasher.Hash("correct horse battery")));
    }

    [Fact]
    public void Minimum_length_is_ten_characters()
    {
        Assert.Equal(10, PasswordHasher.MinimumLength);
    }
}
