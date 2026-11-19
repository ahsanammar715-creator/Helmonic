import "server-only";

export type AuthenticatedActor = {
  objectId: string;
  displayName?: string;
};

const entraObjectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAuthenticatedActor(request: Request): AuthenticatedActor | null {
  const objectId = request.headers.get("x-ms-client-principal-id")?.trim();
  if (!objectId || !entraObjectIdPattern.test(objectId)) return null;

  return {
    objectId,
    displayName: request.headers.get("x-ms-client-principal-name")?.trim() || undefined,
  };
}
