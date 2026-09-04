import "server-only";

import { DefaultAzureCredential } from "@azure/identity";

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
