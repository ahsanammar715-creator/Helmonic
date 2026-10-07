import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/config";
import {
  ConsultRepositoryError,
  createConsultFolder,
  listConsultFolders,
} from "@/lib/server/consult-repository";
import { getAuthenticatedActor } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

export async function GET(request: Request) {
  const config = getRuntimeConfig();
  if (!config.enabled || !config.phase1b.foldersEnabled) {
    return responseError("Phase 1B folders are not enabled in this deployment.", 503);
  }
  const actor = getAuthenticatedActor(request);
  if (!actor) return responseError("Sign in to view folders.", 401);
  return NextResponse.json(
    { folders: await listConsultFolders(config, actor.objectId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const config = getRuntimeConfig();
  if (!config.enabled || !config.phase1b.foldersEnabled) {
    return responseError("Phase 1B folders are not enabled in this deployment.", 503);
  }
  const actor = getAuthenticatedActor(request);
  if (!actor) return responseError("Sign in to create a folder.", 401);

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; parentFolderId?: unknown }
    | null;
  const name = cleanName(body?.name);
  const parentFolderId = typeof body?.parentFolderId === "string" ? body.parentFolderId : null;
  if (!name) return responseError("Enter a folder name.", 400);
  if (parentFolderId && !uuidPattern.test(parentFolderId)) {
    return responseError("The parent folder identifier is invalid.", 400);
  }

  try {
    const folder = await createConsultFolder(config, {
      id: crypto.randomUUID(),
      ownerObjectId: actor.objectId,
      parentFolderId,
      name,
    });
    return NextResponse.json({ folder }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConsultRepositoryError) {
      return responseError(
        error.code === "conflict" ? "A folder with that name already exists." : "The parent folder is invalid.",
        error.code === "conflict" ? 409 : 400,
      );
    }
    throw error;
  }
}
