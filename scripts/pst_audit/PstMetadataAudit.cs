using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using XstReader;

internal static class PstMetadataAudit
{
    private const string ToolVersion = "1.0.0";
    private static readonly UTF8Encoding Utf8Bom = new UTF8Encoding(true);

    private sealed class FolderResult
    {
        public string Path;
        public uint DeclaredItems;
        public long EnumeratedItems;
        public long EmailItems;
        public long OtherItems;
        public long AttachmentCount;
        public long AttachmentBytes;
        public long MessageBytes;
        public long ErrorCount;
        public DateTime? FirstDate;
        public DateTime? LastDate;
    }

    private sealed class MailboxResult
    {
        public string Label;
        public string SourcePath;
        public long PstBytes;
        public DateTime SourceModifiedUtc;
        public string StorageEncoding = "unknown";
        public bool PasswordProtected;
        public readonly List<FolderResult> Folders = new List<FolderResult>();
        public string FatalIssue;

        public long EnumeratedItems => Folders.Sum(f => f.EnumeratedItems);
        public long EmailItems => Folders.Sum(f => f.EmailItems);
        public long OtherItems => Folders.Sum(f => f.OtherItems);
        public long AttachmentCount => Folders.Sum(f => f.AttachmentCount);
        public long AttachmentBytes => Folders.Sum(f => f.AttachmentBytes);
        public long MessageBytes => Folders.Sum(f => f.MessageBytes);
        public long ErrorCount => Folders.Sum(f => f.ErrorCount) + (FatalIssue == null ? 0 : 1);
        public DateTime? FirstDate => Folders.Where(f => f.FirstDate.HasValue)
            .Select(f => f.FirstDate).OrderBy(v => v).FirstOrDefault();
        public DateTime? LastDate => Folders.Where(f => f.LastDate.HasValue)
            .Select(f => f.LastDate).OrderByDescending(v => v).FirstOrDefault();
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--self-test")
                return SelfTest();

            if (args.Length < 2)
            {
                Console.Error.WriteLine(
                    "Usage: PstMetadataAudit.exe <output-directory> <label=full-pst-path> [...]");
                return 2;
            }

            var outputDirectory = Path.GetFullPath(args[0]);
            Directory.CreateDirectory(outputDirectory);

            var inputs = ParseInputs(args.Skip(1));
            ValidateBoundaries(outputDirectory, inputs.Select(i => i.Item2));

            Console.WriteLine("HELMONIC PST METADATA INVENTORY");
            Console.WriteLine("Privacy mode: metadata only; bodies and attachment payloads are forbidden.");
            Console.WriteLine("Azure calls: none.");

            var results = new List<MailboxResult>();
            foreach (var input in inputs)
            {
                var result = AuditMailbox(input.Item1, input.Item2, outputDirectory);
                results.Add(result);
                WriteMailboxReport(result, outputDirectory);
            }

            WriteCombinedReports(results, outputDirectory);
            Console.WriteLine("Completed. Reports: " + outputDirectory);
            return results.Any(r => r.FatalIssue != null) ? 1 : 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.GetType().Name + ": " + ex.Message);
            return 1;
        }
    }

    private static List<Tuple<string, string>> ParseInputs(IEnumerable<string> rawInputs)
    {
        var result = new List<Tuple<string, string>>();
        var labels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in rawInputs)
        {
            var separator = raw.IndexOf('=');
            if (separator < 1 || separator == raw.Length - 1)
                throw new ArgumentException("Each PST input must be label=full-path: " + raw);

            var label = SafeLabel(raw.Substring(0, separator));
            var path = Path.GetFullPath(raw.Substring(separator + 1));
            if (!labels.Add(label))
                throw new ArgumentException("Duplicate mailbox label: " + label);
            if (!File.Exists(path))
                throw new FileNotFoundException("PST file not found", path);
            if (!String.Equals(Path.GetExtension(path), ".pst", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Input is not a .pst file: " + path);

            result.Add(Tuple.Create(label, path));
        }

        return result;
    }

    private static void ValidateBoundaries(string outputDirectory, IEnumerable<string> sourcePaths)
    {
        var output = EnsureTrailingSeparator(Path.GetFullPath(outputDirectory));
        foreach (var sourcePath in sourcePaths)
        {
            var source = Path.GetFullPath(sourcePath);
            var sourceDirectory = EnsureTrailingSeparator(Path.GetDirectoryName(source));
            if (output.StartsWith(sourceDirectory, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    "Output must not be inside the PST source directory: " + outputDirectory);
            if (source.StartsWith(output, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    "PST source must not be inside the report directory: " + source);
        }
    }

    private static MailboxResult AuditMailbox(string label, string sourcePath, string outputDirectory)
    {
        var info = new FileInfo(sourcePath);
        var result = new MailboxResult
        {
            Label = label,
            SourcePath = sourcePath,
            PstBytes = info.Length,
            SourceModifiedUtc = info.LastWriteTimeUtc,
        };

        var messagePath = Path.Combine(outputDirectory, label + "-messages.csv");
        var folderPath = Path.Combine(outputDirectory, label + "-folders.csv");
        var issuePath = Path.Combine(outputDirectory, label + "-issues.csv");
        var manifestPath = Path.Combine(outputDirectory, label + "-source-manifest.txt");

        WriteSourceManifest(manifestPath, result);

        using (var messages = NewCsv(messagePath,
            "item_id", "folder", "item_class", "is_email", "subject", "sender",
            "sender_email", "recipients", "received_utc", "submitted_utc", "modified_utc",
            "attachment_count", "attachment_names", "attachment_types", "attachment_bytes",
            "message_size_bytes"))
        using (var issues = NewCsv(issuePath,
            "scope", "folder", "item_id", "error_type", "message"))
        {
            try
            {
                Console.WriteLine("Reading " + label + " (read-only): " + sourcePath);
                var pst = new XstFile(sourcePath);
                var root = pst.ReadFolderTree();
                var store = pst.ReadMetadataOnlyStoreDetails();
                result.StorageEncoding = store.StorageEncoding;
                result.PasswordProtected = store.PasswordProtected;
                if (store.PasswordProtected)
                {
                    result.FatalIssue = "PST password marker is set; message enumeration was not attempted.";
                    WriteCsv(issues, "pst", "", "", "PasswordProtected", result.FatalIssue);
                }
                else
                {
                    AuditFolderTree(pst, root, result, messages, issues);
                }
            }
            catch (Exception ex)
            {
                result.FatalIssue = ex.GetType().Name + ": " + Clean(ex.Message);
                WriteCsv(issues, "pst", "", "", ex.GetType().Name, ex.Message);
            }
        }

        WriteFolderCsv(folderPath, result.Folders);
        return result;
    }

    private static void AuditFolderTree(
        XstFile pst,
        Folder folder,
        MailboxResult mailbox,
        StreamWriter messages,
        StreamWriter issues)
    {
        AuditFolder(pst, folder, mailbox, messages, issues);
        foreach (var child in folder.Folders.OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase))
            AuditFolderTree(pst, child, mailbox, messages, issues);
    }

    private static void AuditFolder(
        XstFile pst,
        Folder folder,
        MailboxResult mailbox,
        StreamWriter messages,
        StreamWriter issues)
    {
        var folderResult = new FolderResult
        {
            Path = folder.Path ?? "<root>",
            DeclaredItems = folder.ContentCount,
        };
        mailbox.Folders.Add(folderResult);

        List<Message> folderMessages;
        try
        {
            folderMessages = pst.ReadMessages(folder);
        }
        catch (Exception ex)
        {
            folderResult.ErrorCount++;
            WriteCsv(issues, "folder", folderResult.Path, "", ex.GetType().Name, ex.Message);
            folder.Messages.Clear();
            return;
        }

        foreach (var message in folderMessages)
        {
            var itemId = message.Nid.dwValue.ToString(CultureInfo.InvariantCulture);
            try
            {
                var details = pst.ReadMetadataOnlyDetails(message);
                var itemClass = details.MessageClass ?? "";
                var isEmail = IsEmail(itemClass);
                var date = message.Received ?? message.Submitted ?? message.Modified;
                var attachmentBytes = message.Attachments.Sum(a => Math.Max(0, (long)a.Size));
                var attachmentNames = String.Join("; ", message.Attachments.Select(a => a.FileName ?? a.DisplayName));
                var attachmentTypes = String.Join("; ", message.Attachments.Select(AttachmentType));
                var recipients = String.Join("; ", message.Recipients.Select(RecipientText));

                folderResult.EnumeratedItems++;
                if (isEmail) folderResult.EmailItems++; else folderResult.OtherItems++;
                folderResult.AttachmentCount += message.Attachments.Count;
                folderResult.AttachmentBytes += attachmentBytes;
                folderResult.MessageBytes += Math.Max(0, (long)(details.MessageSizeBytes ?? 0));
                if (date.HasValue)
                {
                    if (!folderResult.FirstDate.HasValue || date.Value < folderResult.FirstDate.Value)
                        folderResult.FirstDate = date;
                    if (!folderResult.LastDate.HasValue || date.Value > folderResult.LastDate.Value)
                        folderResult.LastDate = date;
                }

                WriteCsv(
                    messages,
                    itemId,
                    folderResult.Path,
                    itemClass,
                    isEmail ? "true" : "false",
                    message.Subject,
                    message.From,
                    details.SenderEmail,
                    recipients,
                    Iso(message.Received),
                    Iso(message.Submitted),
                    Iso(message.Modified),
                    message.Attachments.Count.ToString(CultureInfo.InvariantCulture),
                    attachmentNames,
                    attachmentTypes,
                    attachmentBytes.ToString(CultureInfo.InvariantCulture),
                    (details.MessageSizeBytes ?? 0).ToString(CultureInfo.InvariantCulture));
            }
            catch (Exception ex)
            {
                folderResult.ErrorCount++;
                WriteCsv(issues, "item", folderResult.Path, itemId, ex.GetType().Name, ex.Message);
            }
        }

        messages.Flush();
        issues.Flush();
        // XstReader stores enumerated messages on the Folder object. Release each
        // completed folder before moving on so multi-gigabyte archives remain bounded.
        folder.Messages.Clear();
        Console.WriteLine(String.Format(
            CultureInfo.InvariantCulture,
            "  {0}: {1} items, {2} issues",
            folderResult.Path,
            folderResult.EnumeratedItems,
            folderResult.ErrorCount));
    }

    private static bool IsEmail(string itemClass)
    {
        if (String.IsNullOrWhiteSpace(itemClass))
            return true;

        return itemClass.StartsWith("IPM.Note", StringComparison.OrdinalIgnoreCase) ||
               itemClass.StartsWith("REPORT.IPM.Note", StringComparison.OrdinalIgnoreCase) ||
               itemClass.StartsWith("IPM.Schedule.Meeting", StringComparison.OrdinalIgnoreCase);
    }

    private static string RecipientText(Recipient recipient)
    {
        return String.Format(
            CultureInfo.InvariantCulture,
            "{0}|{1}|{2}",
            recipient.RecipientType,
            recipient.DisplayName ?? "",
            recipient.EmailAddress ?? "");
    }

    private static string AttachmentType(Attachment attachment)
    {
        var fileName = attachment.FileName ?? attachment.DisplayName ?? "";
        var extension = Path.GetExtension(fileName);
        if (!String.IsNullOrWhiteSpace(extension))
            return extension.TrimStart('.').ToLowerInvariant();
        return attachment.Type.ToLowerInvariant();
    }

    private static void WriteFolderCsv(string path, IEnumerable<FolderResult> folders)
    {
        using (var writer = NewCsv(path,
            "folder", "declared_items", "enumerated_items", "email_items", "other_items",
            "first_date_utc", "last_date_utc", "attachment_count", "attachment_bytes",
            "message_bytes", "issue_count", "declared_vs_enumerated_delta"))
        {
            foreach (var folder in folders)
            {
                WriteCsv(
                    writer,
                    folder.Path,
                    folder.DeclaredItems.ToString(CultureInfo.InvariantCulture),
                    folder.EnumeratedItems.ToString(CultureInfo.InvariantCulture),
                    folder.EmailItems.ToString(CultureInfo.InvariantCulture),
                    folder.OtherItems.ToString(CultureInfo.InvariantCulture),
                    Iso(folder.FirstDate),
                    Iso(folder.LastDate),
                    folder.AttachmentCount.ToString(CultureInfo.InvariantCulture),
                    folder.AttachmentBytes.ToString(CultureInfo.InvariantCulture),
                    folder.MessageBytes.ToString(CultureInfo.InvariantCulture),
                    folder.ErrorCount.ToString(CultureInfo.InvariantCulture),
                    ((long)folder.DeclaredItems - folder.EnumeratedItems).ToString(CultureInfo.InvariantCulture));
            }
        }
    }

    private static void WriteSourceManifest(string path, MailboxResult result)
    {
        File.WriteAllLines(path, new[]
        {
            "tool_version=" + ToolVersion,
            "metadata_only=true",
            "body_content_read=false",
            "attachment_content_read=false",
            "third_party_consent_open=true",
            "source_path=" + result.SourcePath,
            "source_size_bytes=" + result.PstBytes.ToString(CultureInfo.InvariantCulture),
            "source_last_write_utc=" + result.SourceModifiedUtc.ToString("o", CultureInfo.InvariantCulture),
            "source_access=FileMode.Open/FileAccess.Read",
        }, Utf8Bom);
    }

    private static void WriteMailboxReport(MailboxResult result, string outputDirectory)
    {
        var path = Path.Combine(outputDirectory, result.Label + "-report.md");
        var sb = new StringBuilder();
        sb.AppendLine("# PST metadata inventory: " + result.Label);
        sb.AppendLine();
        sb.AppendLine("> **Metadata-only safety flag:** no email body or attachment content was read or stored. " +
                      "Third-party consent remains unresolved; full-content extraction is prohibited without a separate explicit approval.");
        sb.AppendLine();
        sb.AppendLine("- Source: `" + Md(result.SourcePath) + "`");
        sb.AppendLine("- PST size: " + HumanBytes(result.PstBytes));
        sb.AppendLine("- PST storage encoding: " + result.StorageEncoding);
        sb.AppendLine("- Password marker present: " + (result.PasswordProtected ? "yes; enumeration stopped" : "no"));
        sb.AppendLine("- Email items: " + result.EmailItems.ToString("N0", CultureInfo.InvariantCulture));
        sb.AppendLine("- Other Outlook items: " + result.OtherItems.ToString("N0", CultureInfo.InvariantCulture));
        sb.AppendLine("- Folders: " + result.Folders.Count.ToString("N0", CultureInfo.InvariantCulture));
        sb.AppendLine("- Date range: " + DisplayDate(result.FirstDate) + " to " + DisplayDate(result.LastDate));
        sb.AppendLine("- Attachments: " + result.AttachmentCount.ToString("N0", CultureInfo.InvariantCulture) +
                      " (metadata-declared size " + HumanBytes(result.AttachmentBytes) + ")");
        sb.AppendLine("- Message metadata-declared size: " + HumanBytes(result.MessageBytes));
        sb.AppendLine("- Reported issues: " + result.ErrorCount.ToString("N0", CultureInfo.InvariantCulture));
        if (result.FatalIssue != null)
            sb.AppendLine("- PST-level issue: " + result.FatalIssue);
        sb.AppendLine();
        sb.AppendLine("## Scope estimate for a later, separately approved extraction");
        sb.AppendLine();
        sb.AppendLine("A later full-content pass would have to policy-filter and process approximately " +
                      result.EmailItems.ToString("N0", CultureInfo.InvariantCulture) + " emails and " +
                      result.AttachmentCount.ToString("N0", CultureInfo.InvariantCulture) +
                      " attachments. This is sizing information only; it does not authorize extraction, OCR, upload, or ingestion.");
        File.WriteAllText(path, sb.ToString(), Utf8Bom);
    }

    private static void WriteCombinedReports(List<MailboxResult> results, string outputDirectory)
    {
        var csvPath = Path.Combine(outputDirectory, "combined-summary.csv");
        using (var writer = NewCsv(csvPath,
            "mailbox", "pst_bytes", "folders", "email_items", "other_items", "first_date_utc",
            "last_date_utc", "attachment_count", "attachment_bytes", "message_bytes",
            "storage_encoding", "password_protected", "issue_count", "fatal_issue"))
        {
            foreach (var result in results)
            {
                WriteCsv(
                    writer,
                    result.Label,
                    result.PstBytes.ToString(CultureInfo.InvariantCulture),
                    result.Folders.Count.ToString(CultureInfo.InvariantCulture),
                    result.EmailItems.ToString(CultureInfo.InvariantCulture),
                    result.OtherItems.ToString(CultureInfo.InvariantCulture),
                    Iso(result.FirstDate),
                    Iso(result.LastDate),
                    result.AttachmentCount.ToString(CultureInfo.InvariantCulture),
                    result.AttachmentBytes.ToString(CultureInfo.InvariantCulture),
                    result.MessageBytes.ToString(CultureInfo.InvariantCulture),
                    result.StorageEncoding,
                    result.PasswordProtected ? "true" : "false",
                    result.ErrorCount.ToString(CultureInfo.InvariantCulture),
                    result.FatalIssue);
            }
        }

        var mdPath = Path.Combine(outputDirectory, "combined-report.md");
        var totalEmails = results.Sum(r => r.EmailItems);
        var totalAttachments = results.Sum(r => r.AttachmentCount);
        var sb = new StringBuilder();
        sb.AppendLine("# Combined PST metadata inventory");
        sb.AppendLine();
        sb.AppendLine("> **Metadata only:** no email body or attachment content was read or stored. " +
                      "Third-party consent remains open and must be resolved before any full-content extraction.");
        sb.AppendLine();
        sb.AppendLine("| Mailbox | PST size | Emails | Other items | Attachments | Date range | Issues |");
        sb.AppendLine("| --- | ---: | ---: | ---: | ---: | --- | ---: |");
        foreach (var result in results)
        {
            sb.AppendLine(String.Format(
                CultureInfo.InvariantCulture,
                "| {0} | {1} | {2:N0} | {3:N0} | {4:N0} | {5} to {6} | {7:N0} |",
                Md(result.Label), HumanBytes(result.PstBytes), result.EmailItems, result.OtherItems,
                result.AttachmentCount, DisplayDate(result.FirstDate), DisplayDate(result.LastDate),
                result.ErrorCount));
        }
        sb.AppendLine();
        sb.AppendLine("A later full-content pass would involve approximately " +
                      totalEmails.ToString("N0", CultureInfo.InvariantCulture) + " emails and " +
                      totalAttachments.ToString("N0", CultureInfo.InvariantCulture) +
                      " attachments. This is informational only and grants no permission to extract them.");
        File.WriteAllText(mdPath, sb.ToString(), Utf8Bom);
    }

    private static StreamWriter NewCsv(string path, params string[] headers)
    {
        var writer = new StreamWriter(path, false, Utf8Bom);
        WriteCsv(writer, headers);
        return writer;
    }

    private static void WriteCsv(StreamWriter writer, params string[] values)
    {
        writer.WriteLine(String.Join(",", values.Select(Csv)));
    }

    private static string Csv(string value)
    {
        var cleaned = Clean(value);
        if (cleaned.Length > 0 && "=+-@".IndexOf(cleaned[0]) >= 0)
            cleaned = "'" + cleaned;
        return "\"" + cleaned.Replace("\"", "\"\"") + "\"";
    }

    private static string Clean(string value)
    {
        return (value ?? "").Replace("\r\n", " ").Replace("\r", " ").Replace("\n", " ");
    }

    private static string Iso(DateTime? value)
    {
        return value.HasValue ? value.Value.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture) : "";
    }

    private static string DisplayDate(DateTime? value)
    {
        return value.HasValue ? value.Value.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "unknown";
    }

    private static string HumanBytes(long bytes)
    {
        string[] units = { "B", "KiB", "MiB", "GiB", "TiB" };
        var value = Math.Max(0, (double)bytes);
        var index = 0;
        while (value >= 1024 && index < units.Length - 1)
        {
            value /= 1024;
            index++;
        }
        return value.ToString(index == 0 ? "0" : "0.0", CultureInfo.InvariantCulture) + " " + units[index];
    }

    private static string Md(string value)
    {
        return (value ?? "").Replace("|", "\\|").Replace("`", "'");
    }

    private static string SafeLabel(string value)
    {
        var chars = value.Trim().ToLowerInvariant()
            .Select(c => Char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '-')
            .ToArray();
        var label = new string(chars).Trim('-');
        if (label.Length == 0)
            throw new ArgumentException("Mailbox label is empty after sanitization.");
        return label;
    }

    private static string EnsureTrailingSeparator(string path)
    {
        return path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
               Path.DirectorySeparatorChar;
    }

    private static int SelfTest()
    {
        if (Csv("=SUM(A1:A2)") != "\"'=SUM(A1:A2)\"")
            throw new Exception("CSV formula neutralization failed.");
        if (!IsEmail("IPM.Note") || IsEmail("IPM.Contact"))
            throw new Exception("Item classification failed.");
        if (AttachmentType(new Attachment { LongFileName = "report.PDF" }) != "pdf")
            throw new Exception("Attachment type classification failed.");
        Console.WriteLine("PST metadata audit self-test passed.");
        return 0;
    }
}
