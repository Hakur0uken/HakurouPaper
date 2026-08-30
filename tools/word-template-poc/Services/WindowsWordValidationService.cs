using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Developer-only Microsoft Word smoke test. It is never called by the Tauri
/// bridge or normal export path: callers must invoke the explicit CLI command.
/// </summary>
public static class WindowsWordValidationService
{
    public static WordApplicationValidationResult Validate(string inputPath, string outputPath)
    {
        if (!OperatingSystem.IsWindows()) return new WordApplicationValidationResult(true, true, false, null, "Microsoft Word validation is Windows-only.");
        return ValidateWindows(inputPath, outputPath);
    }

    [SupportedOSPlatform("windows")]
    private static WordApplicationValidationResult ValidateWindows(string inputPath, string outputPath)
    {
        var type = Type.GetTypeFromProgID("Word.Application");
        if (type is null) return new WordApplicationValidationResult(true, true, false, null, "Microsoft Word is not installed; validation skipped.");

        object? application = null;
        object? documents = null;
        object? document = null;
        try
        {
            application = Activator.CreateInstance(type)
                ?? throw new InvalidOperationException("Unable to start Microsoft Word.");
            dynamic word = application;
            word.Visible = false;
            word.DisplayAlerts = 0;
            documents = word.Documents;
            dynamic wordDocuments = documents;
            document = wordDocuments.Open(Path.GetFullPath(inputPath), false, true);
            dynamic openDocument = document;
            openDocument.SaveAs2(Path.GetFullPath(outputPath), 16);
            openDocument.Close(0);
            document = null;
            word.Quit(0);
            application = null;
            return new WordApplicationValidationResult(true, false, true, Path.GetFullPath(outputPath), "Microsoft Word opened and saved a validation copy without repair prompts.");
        }
        catch (Exception exception)
        {
            return new WordApplicationValidationResult(false, false, true, null, exception.Message);
        }
        finally
        {
            if (document is not null)
            {
                try { ((dynamic)document).Close(0); } catch { /* best-effort COM cleanup */ }
            }
            if (application is not null)
            {
                try { ((dynamic)application).Quit(0); } catch { /* best-effort COM cleanup */ }
            }
            ReleaseComObject(document);
            ReleaseComObject(documents);
            ReleaseComObject(application);
        }
    }

    [SupportedOSPlatform("windows")]
    private static void ReleaseComObject(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }
}

public sealed record WordApplicationValidationResult(
    bool Success,
    bool Skipped,
    bool WordDetected,
    string? OutputPath,
    string Message);
