import assert from "node:assert/strict";
import test from "node:test";

import {
  controlledCitationNamespace,
  nextControlledMarker,
  privateBookCitationAuditRecord,
  publicControlledCitation,
} from "../../src/lib/consult/citation-policy.ts";

test("controlled namespaces default safely to project documents", () => {
  assert.equal(controlledCitationNamespace("D"), "D");
  assert.equal(controlledCitationNamespace("S"), "S");
  assert.equal(controlledCitationNamespace("B"), "B");
  assert.equal(controlledCitationNamespace("unexpected"), "D");
});

test("approved-book identity is retained in a private backend audit record", () => {
  const privateCitation = {
    id: "private-chunk",
    title: "Licensed title",
    sourceId: "private-source",
    section: "Licensed chapter",
    sourceUri: "blob://private-source",
    excerpt: "Evidence text",
    citationNamespace: "B",
    marker: "B1",
    pageNumber: 47,
  };
  const audit = privateBookCitationAuditRecord("request-1", privateCitation);
  assert.deepEqual(audit, {
    event: "private-book-citation",
    requestId: "request-1",
    marker: "B1",
    chunkId: "private-chunk",
    sourceId: "private-source",
    title: "Licensed title",
    section: "Licensed chapter",
    sourceUri: "blob://private-source",
    pageNumber: 47,
  });
  assert.equal(
    privateBookCitationAuditRecord("request-1", {
      ...privateCitation,
      citationNamespace: "D",
    }),
    null,
  );
});

test("marker sequences are independent per citation namespace", () => {
  const counters = { D: 0, S: 0, B: 0 };
  assert.equal(nextControlledMarker("D", counters), "D1");
  assert.equal(nextControlledMarker("S", counters), "S1");
  assert.equal(nextControlledMarker("B", counters), "B1");
  assert.equal(nextControlledMarker("D", counters), "D2");
});

test("approved-book identity is removed from the public citation", () => {
  const publicCitation = publicControlledCitation({
    id: "private-chunk",
    title: "Licensed title",
    sourceId: "private-source",
    section: "Licensed chapter",
    sourceUri: "blob://private-source",
    excerpt: "Evidence text",
    citationNamespace: "B",
    marker: "B1",
  });

  assert.equal(publicCitation.id, "B1");
  assert.equal(publicCitation.title, "Approved acoustics reference");
  assert.equal(publicCitation.sourceId, "B1");
  assert.equal(publicCitation.section, undefined);
  assert.equal(publicCitation.sourceUri, undefined);
  assert.equal(publicCitation.excerpt, "Evidence text");
});
