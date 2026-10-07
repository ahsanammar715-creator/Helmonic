import { ManagedIdentityCredential } from "@azure/identity";

export function requiredManagedIdentityClientId(environment = process.env) {
  const clientId = environment.AZURE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      "AZURE_CLIENT_ID is required to select the validation job's user-assigned managed identity",
    );
  }
  return clientId;
}

export function createUserAssignedManagedIdentityCredential(
  environment = process.env,
  Credential = ManagedIdentityCredential,
) {
  return new Credential(requiredManagedIdentityClientId(environment));
}
