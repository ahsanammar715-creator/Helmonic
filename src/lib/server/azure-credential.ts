import "server-only";

import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";

let credential: DefaultAzureCredential | undefined;

function getCredential() {
  credential ??= new DefaultAzureCredential();
  return credential;
}

export async function getAzureAccessToken(scope: string) {
  const token = await getCredential().getToken(scope);

  if (!token?.token) {
    throw new Error(`Azure identity returned no access token for ${scope}`);
  }

  return token.token;
}

const managedIdentityCredentials = new Map<string, ManagedIdentityCredential>();

export async function getAzureAccessTokenForClient(scope: string, clientId: string) {
  let selected = managedIdentityCredentials.get(clientId);
  if (!selected) {
    selected = new ManagedIdentityCredential({ clientId });
    managedIdentityCredentials.set(clientId, selected);
  }

  const token = await selected.getToken(scope);
  if (!token?.token) {
    throw new Error(`Azure managed identity returned no access token for ${scope}`);
  }

  return token.token;
}
