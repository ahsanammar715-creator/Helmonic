const attachmentQuestionPatterns = [
  /\b(?:this|that|the attached|the uploaded|my)\s+(?:document|file|pdf|attachment|report|submission|submittal)\b/i,
  /\b(?:attached|uploaded)\s+(?:document|file|pdf|attachment|report|submission|submittal)\b/i,
  /\bwhat(?:'s| is)\s+(?:this|that|it)(?:\s+(?:document|file|pdf|attachment|report))?\s+about\b/i,
  /\b(?:summari[sz]e|review|analyse|analyze|explain)\s+(?:this|that|it|the attached|the uploaded|my)\b/i,
  /\b(?:key|main)\s+(?:points|findings|requirements|recommendations)\s+(?:in|from|of)\s+(?:this|that|the attached|the uploaded|my)\b/i,
];

export function isAttachmentDirectedQuestion(question: string) {
  const compact = question.replace(/\s+/g, " ").trim();
  return compact.length > 0 && attachmentQuestionPatterns.some((pattern) => pattern.test(compact));
}

export function attachmentFocusInstruction(enabled: boolean) {
  if (!enabled) return "";
  return [
    "Attachment focus:",
    "The user's words such as 'this document', 'the attached file' or 'it' refer to the currently attached document.",
    "Answer the request primarily from the supplied [A#] attachment passages. For an overview question, state the document's purpose, scope and principal content directly before adding detail.",
    "Use other Helmonic or professional knowledge only as clearly separated supplementary context; never substitute unrelated evidence for the attachment.",
  ].join("\n");
}
