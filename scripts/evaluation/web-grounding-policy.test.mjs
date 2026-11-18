import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSafePublicWebQuery,
  parseBravePublicWebCitations,
} from "../../src/lib/consult/web-grounding-policy.ts";

test("web query keeps only allowlisted public acoustic and standards concepts", () => {
  const query = buildSafePublicWebQuery(
    "For confidential project J2701 at 14 Private Road, what does Building Regulations Part E and ISO 16283-1 require for airborne sound insulation?",
  );

  assert.ok(query);
  assert.match(query, /Building Regulations Part E/i);
  assert.match(query, /ISO 16283-1/i);
  assert.match(query, /airborne sound/i);
  assert.doesNotMatch(query, /J2701|Private Road|14 /i);
});

test("web query never copies names, correspondence, dates, emails or measurements", () => {
  const query = buildSafePublicWebQuery(
    "Glen emailed client@example.com on 14 March 2026 about 52 dB at Goatstown PBSA; check current noise guidance.",
  );

  assert.ok(query);
  assert.equal(query, "Ireland acoustic engineering noise official current guidance");
});

test("private-only questions are skipped instead of sent to the public web", () => {
  assert.equal(
    buildSafePublicWebQuery("What did Glen tell Owen about J2701 on 14 March?"),
    null,
  );
});

test("generic sound-engineering definitions get a privacy-safe public query", () => {
  const query = buildSafePublicWebQuery("What is sound engineering?");

  assert.equal(
    query,
    "acoustic engineering sound engineering professional technical definition",
  );
});

test("acoustic-panel definitions retain the specific public concept", () => {
  const query = buildSafePublicWebQuery("What are acoustic panels?");

  assert.ok(query);
  assert.match(query, /acoustic panels/);
  assert.match(query, /professional technical definition/);
});

test("Brave LLM context becomes normal W evidence with exact public links", () => {
  const citations = parseBravePublicWebCitations(
    {
      grounding: {
        generic: [
          {
            url: "https://www.gov.ie/en/publication/example",
            title: "Official acoustic guidance",
            snippets: [
              "Current public guidance states that an acoustic assessment is required.",
              "A second relevant point follows.",
            ],
          },
        ],
      },
    },
    { maximumSources: 4, retrievedAt: "2026-11-13T12:00:00.000Z" },
  );

  assert.equal(citations.length, 1);
  assert.equal(citations[0].marker, "W1");
  assert.equal(citations[0].title, "Official acoustic guidance");
  assert.equal(citations[0].sourceUri, "https://www.gov.ie/en/publication/example");
  assert.match(citations[0].excerpt, /acoustic assessment is required/i);
});

test("official and standards sources are prioritised without excluding the wider web", () => {
  const citations = parseBravePublicWebCitations(
    {
      grounding: {
        generic: [
          {
            url: "https://consultancy.example.com/acoustics",
            title: "Consultancy article",
            snippets: ["A useful industry explanation."],
          },
          {
            url: "https://www.iso.org/standard/12345.html",
            title: "ISO standard page",
            snippets: ["The official standards catalogue description."],
          },
          {
            url: "https://www.gov.ie/en/publication/example",
            title: "Government guidance",
            snippets: ["The official Irish guidance."],
          },
        ],
      },
    },
    { maximumSources: 4, retrievedAt: "2026-11-13T12:00:00.000Z" },
  );

  assert.deepEqual(citations.map((citation) => citation.title), [
    "Government guidance",
    "ISO standard page",
    "Consultancy article",
  ]);
  assert.deepEqual(citations.map((citation) => citation.marker), ["W1", "W2", "W3"]);
});

test("web parsing strips tracking, de-duplicates and honours an explicit domain gate", () => {
  const citations = parseBravePublicWebCitations(
    {
      grounding: {
        generic: [
          {
            url: "https://www.gov.ie/en/publication/example?utm_source=test#section",
            title: "Government guidance",
            snippets: ["Exact extracted evidence."],
          },
          {
            url: "https://www.gov.ie/en/publication/example",
            title: "Duplicate",
            snippets: ["Duplicate evidence."],
          },
          {
            url: "https://example.com/noise",
            title: "Outside the gate",
            snippets: ["This must be excluded."],
          },
        ],
      },
    },
    {
      maximumSources: 4,
      retrievedAt: "2026-11-13T12:00:00.000Z",
      allowedDomains: ["gov.ie"],
    },
  );

  assert.equal(citations.length, 1);
  assert.equal(citations[0].sourceUri, "https://www.gov.ie/en/publication/example");
});

test("web response fails closed when no safe URL and extracted passage exist", () => {
  const citations = parseBravePublicWebCitations(
    {
      grounding: {
        generic: [
          { url: "javascript:alert(1)", title: "Unsafe", snippets: ["Unsafe."] },
          { url: "https://example.com/empty", title: "No passage", snippets: [] },
        ],
      },
    },
    { maximumSources: 4, retrievedAt: "2026-11-13T12:00:00.000Z" },
  );

  assert.deepEqual(citations, []);
});
