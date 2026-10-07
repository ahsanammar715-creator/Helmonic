import "server-only";

export type AuthenticatedActor = {
  objectId: string;
  displayName?: string;
  groupObjectIds: string[];
};

const entraObjectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAuthenticatedActor(request: Request): AuthenticatedActor | null {
  const objectId = request.headers.get("x-ms-client-principal-id")?.trim();
  if (!objectId || !entraObjectIdPattern.test(objectId)) return null;

  return {
    objectId,
    displayName: request.headers.get("x-ms-client-principal-name")?.trim() || undefined,
    groupObjectIds: principalGroups(request),
  };
}

function principalGroups(request: Request) {
  const encoded = request.headers.get("x-ms-client-principal")?.trim();
  if (!encoded) return [];

  try {
    const principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      claims?: Array<{ typ?: string; val?: string }>;
    };
    return [
      ...new Set(
        (principal.claims ?? [])
          .filter((claim) => /(?:groups|group)/i.test(claim.typ ?? ""))
          .map((claim) => claim.val?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  } catch {
    return [];
  }
}
