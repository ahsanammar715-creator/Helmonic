import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("knowledge promotion is explicit and unchecked by default", () => {
  const popover = read("src/components/AttachPopover.tsx");
  assert.match(popover, /useState\(false\)/);
  assert.match(popover, /Add to Helmonic knowledge/);
  assert.match(popover, /Unchecked files stay conversation-scoped/);
});

test("the client waits for indexing before allowing a question", () => {
  const workspace = read("src/components/consult/ConsultWorkspace.tsx");
  const composer = read("src/components/ChatComposer.tsx");
  assert.match(workspace, /waitForAttachment/);
  assert.match(workspace, /state === "ready" \|\| payload\.document\.state === "duplicate"/);
  assert.match(composer, /disabled \|\| attachmentBusy/);
});

test("promoted documents are permanent, audited and separately searchable", () => {
  const uploadRoute = read("src/app/api/consult/conversations/[conversationId]/documents/route.ts");
  const repository = read("src/lib/server/consult-repository.ts");
  const search = read("src/lib/server/search.ts");
  const config = read("src/lib/server/config.ts");
  const worker = read("scripts/session_ingestion/worker.py");
  assert.match(uploadRoute, /promoteToKnowledge\s*\? null/);
  assert.match(repository, /knowledge-promotion-requested/);
  assert.match(search, /source_type eq 'helmonic_knowledge'/);
  assert.match(config, /consult-knowledge-uploads/);
  assert.match(worker, /knowledge-promotion-completed/);
  assert.match(worker, /"helmonic_knowledge"\s*if payload\["promoteToKnowledge"\]/);
});

test("unpromoted documents retain owner and conversation isolation", () => {
  const search = read("src/lib/server/search.ts");
  assert.match(
    search,
    /owner_object_id eq '\$\{owner\}' and conversation_id eq '\$\{conversation\}'/,
  );
  assert.match(search, /source_type eq 'session_attachment'/);
});
