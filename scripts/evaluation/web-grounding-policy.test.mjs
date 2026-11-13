import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSafePublicWebQuery,
  parsePublicWebCitations,
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

test("web response becomes normal W evidence with exact public links", () => {
  const text =
    "Current public guidance states that an acoustic assessment is required. A second point follows.";
  const citations = parsePublicWebCitations(
    {
      output: [
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text,
              annotations: [
                {
                  type: "url_citation",
                  start_index: 0,
                  end_index: 70,
                  url: "https://www.gov.ie/en/publication/example",
                  title: "Official acoustic guidance",
                },
              ],
            },
          ],
        },
      ],
    },
    { maximumSources: 4, retrievedAt: "2026-11-13T12:00:00.000Z" },
  );

  assert.equal(citations.length, 1);
  assert.equal(citations[0].marker, "W1");
  assert.equal(citations[0].title, "Official acoustic guidance");
  assert.equal(citations[0].sourceUri, "https://www.gov.ie/en/publication/example");
  assert.match(citations[0].excerpt, /acoustic assessment is required/i);
});

test("web response fails closed when no actual search or safe URL exists", () => {
  const withoutSearch = parsePublicWebCitations(
    {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Unsupported response.",
              annotations: [
                { type: "url_citation", url: "javascript:alert(1)", title: "Unsafe" },
              ],
            },
          ],
        },
      ],
    },
    { maximumSources: 4, retrievedAt: "2026-11-13T12:00:00.000Z" },
  );

  assert.deepEqual(withoutSearch, []);
});
