using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Inspects and resolves the deliberately small set of mapping anchors.  This
/// class keeps the tag-then-bookmark precedence in one place and refuses to
/// infer a location from surrounding text.
/// </summary>
public static class TemplateAnchors
{
    public static IReadOnlyList<AnchorInfo> Inspect(MainDocumentPart mainPart)
    {
        var document = mainPart.Document
            ?? throw new InvalidDataException("The template has no main document XML.");
        var anchors = new List<AnchorInfo>();

        foreach (var group in document.Descendants<SdtElement>()
                     .Select(control => new
                     {
                         Name = control.SdtProperties?.GetFirstChild<Tag>()?.Val?.Value,
                         Control = control,
                     })
                     .Where(item => !string.IsNullOrWhiteSpace(item.Name))
                     .GroupBy(item => item.Name!, StringComparer.Ordinal)
                     .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            var issue = group.Count() == 1 ? DescribeControlIssue(group.Single().Control) : "duplicate tag";
            anchors.Add(new AnchorInfo(
                group.Key,
                "content-control",
                group.Count() == 1 ? GetLevel(group.Single().Control) : "unknown",
                group.Count(),
                issue is null,
                issue));
        }

        foreach (var group in document.Descendants<BookmarkStart>()
                     .Where(bookmark => !string.IsNullOrWhiteSpace(bookmark.Name?.Value))
                     .GroupBy(bookmark => bookmark.Name!.Value!, StringComparer.Ordinal)
                     .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            var bookmarks = group.ToArray();
            var issue = bookmarks.Length == 1 ? DescribeBookmarkIssue(bookmarks[0]) : "duplicate bookmark";
            anchors.Add(new AnchorInfo(
                group.Key,
                "bookmark",
                bookmarks.Length == 1 ? "paragraph" : "unknown",
                bookmarks.Length,
                issue is null,
                issue));
        }

        return anchors;
    }

    public static MappingResolution Resolve(MainDocumentPart mainPart, MappingPlan mapping, bool bodyRequiresBlockContent)
    {
        var document = mainPart.Document
            ?? throw new InvalidDataException("The template has no main document XML.");
        var targets = new[]
        {
            (Name: mapping.Title, RequiresBlock: false),
            (Name: mapping.Abstract, RequiresBlock: false),
            (Name: mapping.Body, RequiresBlock: bodyRequiresBlockContent),
        };
        var resolved = new Dictionary<string, TargetLocation>(StringComparer.Ordinal);
        var missing = new List<string>();
        var issues = new List<string>();

        foreach (var (name, requiresBlock) in targets)
        {
            var controls = document.Descendants<SdtElement>()
                .Where(control => string.Equals(
                    control.SdtProperties?.GetFirstChild<Tag>()?.Val?.Value,
                    name,
                    StringComparison.Ordinal))
                .ToArray();
            if (controls.Length > 1)
            {
                issues.Add($"duplicate tag: {name}");
                continue;
            }
            if (controls.Length == 1)
            {
                var controlIssue = DescribeControlIssue(controls[0]);
                if (controlIssue is not null)
                {
                    issues.Add($"invalid content-control {name}: {controlIssue}");
                    continue;
                }
                if (requiresBlock && controls[0] is not SdtBlock)
                {
                    issues.Add($"incompatibleAnchor: {name} is {GetLevel(controls[0])}-level but body insertion requires a block-level content control");
                    continue;
                }
                resolved.Add(name, new TargetLocation(controls[0], null));
                continue;
            }

            var bookmarks = document.Descendants<BookmarkStart>()
                .Where(bookmark => string.Equals(bookmark.Name?.Value, name, StringComparison.Ordinal))
                .ToArray();
            if (bookmarks.Length == 0)
            {
                missing.Add(name);
                continue;
            }
            if (bookmarks.Length > 1)
            {
                issues.Add($"duplicate bookmark: {name}");
                continue;
            }
            var bookmarkIssue = DescribeBookmarkIssue(bookmarks[0]);
            if (bookmarkIssue is not null)
            {
                issues.Add($"invalid bookmark {name}: {bookmarkIssue}");
                continue;
            }
            if (requiresBlock && bookmarks[0].Ancestors<Paragraph>().FirstOrDefault()?.ParagraphProperties?.SectionProperties is not null)
            {
                issues.Add($"incompatibleAnchor: {name} shares a paragraph with a template section break");
                continue;
            }
            resolved.Add(name, new TargetLocation(null, bookmarks[0]));
        }

        return new MappingResolution(resolved, missing, issues);
    }

    private static string GetLevel(SdtElement control) => control switch
    {
        SdtBlock => "block",
        SdtRun => "inline",
        SdtCell => "cell",
        _ => "unknown",
    };

    private static string? DescribeControlIssue(SdtElement control) => control switch
    {
        SdtBlock block when block.SdtContentBlock is null => "missing block content",
        SdtRun run when run.SdtContentRun is null => "missing run content",
        SdtCell cell when cell.SdtContentCell is null => "missing cell content",
        _ => null,
    };

    private static string? DescribeBookmarkIssue(BookmarkStart bookmark)
    {
        var id = bookmark.Id?.Value;
        if (string.IsNullOrWhiteSpace(id)) return "missing w:id";
        var paragraph = bookmark.Ancestors<Paragraph>().FirstOrDefault();
        if (paragraph is null) return "not contained by a paragraph";
        var matchingEnds = paragraph.Descendants<BookmarkEnd>()
            .Where(end => string.Equals(end.Id?.Value, id, StringComparison.Ordinal))
            .ToArray();
        return matchingEnds.Length switch
        {
            0 => "missing matching bookmark end in the same paragraph",
            > 1 => "multiple matching bookmark ends in the same paragraph",
            _ => null,
        };
    }

    public sealed record TargetLocation(SdtElement? ContentControl, BookmarkStart? Bookmark);

    public sealed record MappingResolution(
        IReadOnlyDictionary<string, TargetLocation> Targets,
        IReadOnlyList<string> MissingTargets,
        IReadOnlyList<string> Issues);
}
