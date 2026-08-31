import assert from "node:assert/strict";
import test from "node:test";

import {
  createUserAssignedManagedIdentityCredential,
  requiredManagedIdentityClientId,
} from "../managed-identity.mjs";

class RecordingCredential {
  constructor(clientId) {
    this.clientId = clientId;
  }
}

test("selects the explicitly configured user-assigned identity", () => {
  const credential = createUserAssignedManagedIdentityCredential(
    { AZURE_CLIENT_ID: "  ingestion-client-id  " },
    RecordingCredential,
  );

  assert.equal(credential.clientId, "ingestion-client-id");
});

test("fails closed when AZURE_CLIENT_ID is missing", () => {
  assert.throws(
    () => requiredManagedIdentityClientId({}),
    /AZURE_CLIENT_ID is required/,
  );
});

test("fails closed when AZURE_CLIENT_ID is blank", () => {
  assert.throws(
    () => requiredManagedIdentityClientId({ AZURE_CLIENT_ID: "   " }),
    /AZURE_CLIENT_ID is required/,
  );
});
