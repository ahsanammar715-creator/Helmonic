using System;

namespace XstReader
{
    /// <summary>
    /// The only per-message detail object exposed to the PST inventory.
    /// It deliberately contains no body or attachment-content field.
    /// </summary>
    public sealed class MetadataOnlyMessageDetails
    {
        public string MessageClass { get; set; }
        public int? MessageSizeBytes { get; set; }
        public string SenderEmail { get; set; }
    }

    public sealed class MetadataOnlyStoreDetails
    {
        public uint PasswordChecksum { get; set; }
        public string StorageEncoding { get; set; }
        public bool PasswordProtected => PasswordChecksum != 0;
    }

    /// <summary>
    /// A metadata-only extension compiled beside a pinned, local XstReader copy.
    /// The build script changes only the class declaration to partial in its ignored
    /// build directory. This method uses only an explicit metadata-property whitelist
    /// and the recipient/attachment table reader; it never invokes payload loaders.
    /// </summary>
    public partial class XstFile
    {
        private static readonly PropertyGetters<MetadataOnlyMessageDetails> pgMetadataOnlyMessage =
            new PropertyGetters<MetadataOnlyMessageDetails>
            {
                {(EpropertyTag)0x001A, (d, val) => d.MessageClass = val},
                {(EpropertyTag)0x0E08, (d, val) => d.MessageSizeBytes = Convert.ToInt32(val)},
                {(EpropertyTag)0x0C1F, (d, val) => d.SenderEmail = val},
                {EpropertyTag.PidTagSentRepresentingEmailAddress,
                    (d, val) => { if (String.IsNullOrWhiteSpace(d.SenderEmail)) d.SenderEmail = val; }},
            };

        private static readonly PropertyGetters<MetadataOnlyStoreDetails> pgMetadataOnlyStore =
            new PropertyGetters<MetadataOnlyStoreDetails>
            {
                // PidTagPstPassword is a checksum/access-control marker, not body data.
                {(EpropertyTag)0x67FF, (d, val) => d.PasswordChecksum = Convert.ToUInt32(val)},
            };

        public MetadataOnlyStoreDetails ReadMetadataOnlyStoreDetails()
        {
            using (var stream = ndb.GetReadStream())
            {
                var details = new MetadataOnlyStoreDetails
                {
                    StorageEncoding = ndb.CryptMethod.ToString(),
                };
                ltp.ReadProperties<MetadataOnlyStoreDetails>(
                    stream,
                    new NID(EnidSpecial.NID_MESSAGE_STORE),
                    pgMetadataOnlyStore,
                    details);
                return details;
            }
        }

        public MetadataOnlyMessageDetails ReadMetadataOnlyDetails(Message message)
        {
            if (message == null)
                throw new ArgumentNullException(nameof(message));

            using (var stream = ndb.GetReadStream())
            {
                var details = new MetadataOnlyMessageDetails();
                var subNodeTree = ltp.ReadProperties<MetadataOnlyMessageDetails>(
                    stream,
                    message.Nid,
                    pgMetadataOnlyMessage,
                    details);

                // This existing helper reads only the recipient and attachment tables.
                // Its property getters are metadata whitelists and do not load payloads.
                ReadMessageTables(stream, subNodeTree, message);

                AssertNoPayloadWasLoaded(message);
                return details;
            }
        }

        private static void AssertNoPayloadWasLoaded(Message message)
        {
            if (message.Body != null || message.BodyHtml != null || message.Html != null ||
                message.RtfCompressed != null)
            {
                throw new InvalidOperationException(
                    "Metadata-only safety boundary failed: message body data was loaded.");
            }

            foreach (var attachment in message.Attachments)
            {
                if (attachment.Content != null)
                {
                    throw new InvalidOperationException(
                        "Metadata-only safety boundary failed: attachment content was loaded.");
                }
            }
        }
    }
}
