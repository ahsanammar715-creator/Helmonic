import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  attachmentFocusInstruction,
  isAttachmentDirectedQuestion,
} from "../../src/lib/consult/attachment-query-policy.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("deictic attachment questions are recognised", () => {
  for (const question of [
    "What is this document about?",
    "Summarise the attached file",
    "What are the key findings in this PDF?",
    "Please review the uploaded report",
    "What is it about?",
  ]) {
    assert.equal(isAttachmentDirectedQuestion(question), true, question);
  }
});

test("ordinary technical questions do not force attachment overview retrieval", () => {
  for (const question of [
    "What is acoustics?",
    "Explain Rw and DnT,w",
    "What standard applies to airborne sound insulation testing?",
  ]) {
    assert.equal(isAttachmentDirectedQuestion(question), false, question);
  }
});

test("attachment focus makes the attached evidence primary", () => {
  const instruction = attachmentFocusInstruction(true);
  assert.match(instruction, /currently attached document/i);
  assert.match(instruction, /primarily from the supplied \[A#\]/i);
  assert.match(instruction, /never substitute unrelated evidence/i);
  assert.equal(attachmentFocusInstruction(false), "");
});

test("the client, route, search and model keep attachment scope end to end", () => {
  const composer = read("src/components/ChatComposer.tsx");
  const workspace = read("src/components/consult/ConsultWorkspace.tsx");
  const route = read("src/app/api/consult/query/route.ts");
  const search = read("src/lib/server/search.ts");
  const model = read("src/lib/server/model.ts");

  assert.match(composer, /attachment\.state === "ready"/);
  assert.match(workspace, /attachmentDocumentIds/);
  assert.match(route, /overview: attachmentDirected/);
  assert.match(route, /attachmentFocus: attachmentDirected && attachmentCitations\.length > 0/);
  assert.match(search, /search: overview \? "\*" : question\.trim\(\)/);
  assert.match(search, /document_id eq/);
  assert.match(search, /source_type eq 'helmonic_knowledge'/);
  assert.match(model, /attachmentFocusInstruction/);
});
