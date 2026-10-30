using Comply.Functions.Ingest;

namespace Comply.Functions.Tests.Ingest;

public sealed class HtmlTextTests
{
    [Fact]
    public void Decodes_named_entities()
    {
        Assert.Equal(
            "a & b < c > d \"quoted\" 'apostrophe' \u2014 ",
            HtmlText.DecodeEntities("a &amp; b &lt; c &gt; d &quot;quoted&quot; &apos;apostrophe&apos; &mdash;&nbsp;"));
    }

    [Fact]
    public void Decodes_numeric_entities_in_decimal_and_hex()
    {
        Assert.Equal("AB\u00e9\U0001F600", HtmlText.DecodeEntities("&#65;&#x42;&#xe9;&#x1F600;"));
    }

    [Fact]
    public void Leaves_unknown_or_invalid_entities_alone()
    {
        Assert.Equal("&bogus; &#x110000; &#;", HtmlText.DecodeEntities("&bogus; &#x110000; &#;"));
    }

    [Fact]
    public void Strip_tags_turns_breaks_and_block_ends_into_newlines()
    {
        var text = HtmlText.StripTags("<p>One<br>two</p><div>three</div><ul><li>four</li></ul>");

        Assert.Equal("One\ntwo\nthree\nfour\n", text);
    }

    [Fact]
    public void Normalize_text_collapses_whitespace_and_blank_lines()
    {
        var value = HtmlText.NormalizeText("  a \t b\u00a0c\n\n\n\nd  ");

        Assert.Equal("a b c\nd", value);
    }

    [Fact]
    public void Plain_text_strips_then_decodes()
    {
        Assert.Equal("A & B", HtmlText.PlainText("<span>A &amp; <b>B</b></span>"));
    }

    [Fact]
    public void Paragraphs_returns_normalized_non_empty_paragraphs()
    {
        var paragraphs = HtmlText.Paragraphs("<p>One</p><p> </p><p>Two <b>bold</b></p><p>Three&amp;four</p>");

        Assert.Equal(["One", "Two bold", "Three&four"], paragraphs);
    }

    [Fact]
    public void Short_title_stops_at_the_first_clause()
    {
        Assert.Equal(
            "Entities shall take appropriate measures",
            HtmlText.ShortTitle("Entities shall take appropriate measures; and then some more text follows."));
        Assert.Equal(
            "Cybersecurity risk-management measures",
            HtmlText.ShortTitle("Cybersecurity risk-management measures."));
    }

    [Fact]
    public void Short_title_caps_at_max_length_on_word_boundaries()
    {
        Assert.Equal("One two three four", HtmlText.ShortTitle("one two three four five", 20));
    }

    [Fact]
    public void Short_title_falls_back_to_a_hard_slice()
    {
        Assert.Equal("Extra", HtmlText.ShortTitle("extraordinarily", 5));
    }

    [Fact]
    public void Short_title_capitalizes_the_first_character()
    {
        Assert.Equal("Providers must comply", HtmlText.ShortTitle("providers must comply"));
    }

    [Theory]
    [InlineData("Art. 21(2)(a)", "art-21-2-a")]
    [InlineData("Art. 1(1)", "art-1-1")]
    [InlineData("Art. 13(2)(b)", "art-13-2-b")]
    [InlineData("Règlement (UE)", "reglement-ue")]
    [InlineData("  --Art. 5--  ", "art-5")]
    public void Slugify_matches_the_node_helper(string value, string expected)
    {
        Assert.Equal(expected, HtmlText.Slugify(value));
    }

    [Fact]
    public void Slugify_limits_length_and_never_ends_with_a_dash()
    {
        var slug = HtmlText.Slugify(new string('a', 60) + " b c d");

        Assert.Equal(64, slug.Length);
        Assert.Equal('c', slug[^1]);
    }

    [Fact]
    public void Element_by_class_returns_nested_inner_html()
    {
        const string html = "<div><span class=\"target\">Hello <b>world</b></span></div>";

        Assert.Equal("Hello <b>world</b>", HtmlText.ElementByClass(html, "target"));
    }

    [Fact]
    public void Element_by_class_handles_nested_spans_of_the_same_tag()
    {
        const string html = "<span class=\"target\">Outer <span class=\"inner\">Inner</span></span>tail";

        Assert.Equal("Outer <span class=\"inner\">Inner</span>", HtmlText.ElementByClass(html, "target"));
    }

    [Fact]
    public void Element_by_class_returns_null_when_missing()
    {
        Assert.Null(HtmlText.ElementByClass("<span class=\"other\">x</span>", "target"));
    }

    [Fact]
    public void Remove_elements_by_class_drops_the_whole_nested_element()
    {
        const string html =
            "<p>Keep <span class=\"term-tip\">noise <span class=\"term-tip-body\">inner</span></span> after</p>";

        Assert.Equal("<p>Keep  after</p>", HtmlText.RemoveElementsByClass(html, "term-tip"));
    }

    [Fact]
    public void Remove_elements_by_class_leaves_unclosed_markup_alone()
    {
        const string html = "<p>Keep <span class=\"term-tip\">dangling";

        Assert.Equal(html, HtmlText.RemoveElementsByClass(html, "term-tip"));
    }

    [Fact]
    public void Find_matching_close_counts_nesting_depth()
    {
        const string html = "<span class=\"a\"><span class=\"b\">x</span></span>";

        Assert.Equal(html.Length, HtmlText.FindMatchingClose(html, 0));
    }

    [Fact]
    public void Find_matching_close_reports_unbalanced_markup()
    {
        Assert.Equal(-1, HtmlText.FindMatchingClose("<span>open", 0));
        Assert.Equal(-1, HtmlText.FindMatchingClose("<span>open", 99));
    }
}
