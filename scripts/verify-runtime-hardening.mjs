import { readFile } from "node:fs/promises";

const dockerfileUrl = new URL("../Dockerfile", import.meta.url);
const dockerfile = await readFile(dockerfileUrl, "utf8");

const required = [
  ["the application listens on unprivileged port 8080", /\bPORT=8080\b/],
  ["the image documents port 8080", /^EXPOSE 8080$/m],
  ["the runtime switches to the built-in non-root Node user", /^USER node$/m],
  ["runtime files are owned by the non-root Node user", /COPY --chown=node:node --from=builder/],
];

const forbidden = [
  ["root runtime user", /^USER (?:0|root)$/m],
  ["privileged port 80 listener", /\bPORT=80\b/],
  ["privileged port 80 exposure", /^EXPOSE 80$/m],
  ["expired Tuesday runtime-exception label", /com\.helmonic\.runtime-exception/],
];

const failures = [
  ...required
    .filter(([, pattern]) => !pattern.test(dockerfile))
    .map(([description]) => `Missing: ${description}.`),
  ...forbidden
    .filter(([, pattern]) => pattern.test(dockerfile))
    .map(([description]) => `Forbidden: ${description}.`),
];

if (failures.length > 0) {
  console.error("Container runtime hardening verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Container runtime hardening verified: non-root user, port 8080, no exception label.");
}
