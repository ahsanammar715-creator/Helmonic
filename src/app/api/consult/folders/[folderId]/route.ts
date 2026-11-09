import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/config";
import {
  ConsultRepositoryError,
  updateConsultFolder,
} from "@/lib/server/consult-repository";
import { getAuthenticatedActor } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/consult/folders/[folderId]">,
) {
  const config = getRuntimeConfig();
  if (!config.enabled || !config.phase1b.foldersEnabled) {
    return NextResponse.json({ error: "Phase 1B folders are not enabled." }, { status: 503 });
  }
  const actor = getAuthenticatedActor(request);
  if (!actor) return NextResponse.json({ error: "Sign in to rename a folder." }, { status: 401 });
  const { folderId } = await context.params;
  if (!uuidPattern.test(folderId)) {
    return NextResponse.json({ error: "The folder identifier is invalid." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Enter a folder name." }, { status: 400 });

  try {
    const folder = await updateConsultFolder(config, {
      id: folderId,
      ownerObjectId: actor.objectId,
      name,
    });
    return NextResponse.json({ folder }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConsultRepositoryError) {
      return NextResponse.json(
        { error: error.code === "conflict" ? "A folder with that name already exists." : "Folder not found." },
        { status: error.code === "conflict" ? 409 : 404 },
      );
    }
    throw error;
  }
}
