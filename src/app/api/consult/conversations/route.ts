import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/config";
import {
  ConsultRepositoryError,
  createConsultConversation,
  listConsultConversations,
} from "@/lib/server/consult-repository";
import { getAuthenticatedActor } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function enabled(config: ReturnType<typeof getRuntimeConfig>) {
  return config.enabled && (config.phase1b.uploadsEnabled || config.phase1b.foldersEnabled);
}

export async function GET(request: Request) {
  const config = getRuntimeConfig();
  if (!enabled(config)) return NextResponse.json({ error: "Phase 1B conversations are not enabled." }, { status: 503 });
  const actor = getAuthenticatedActor(request);
  if (!actor) return NextResponse.json({ error: "Sign in to view conversations." }, { status: 401 });
  const conversations = await listConsultConversations(config, actor.objectId);
  return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const config = getRuntimeConfig();
  if (!enabled(config)) return NextResponse.json({ error: "Phase 1B conversations are not enabled." }, { status: 503 });
  const actor = getAuthenticatedActor(request);
  if (!actor) return NextResponse.json({ error: "Sign in to create a conversation." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { title?: unknown; folderId?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim().replace(/\s+/g, " ").slice(0, 200) : "New Consult conversation";
  const folderId = typeof body?.folderId === "string" ? body.folderId : null;
  if (!title) return NextResponse.json({ error: "Enter a conversation title." }, { status: 400 });
  if (folderId && !uuidPattern.test(folderId)) {
    return NextResponse.json({ error: "The selected folder is invalid." }, { status: 400 });
  }
  try {
    const conversation = await createConsultConversation(config, {
      id: crypto.randomUUID(),
      ownerObjectId: actor.objectId,
      folderId,
      title,
    });
    return NextResponse.json({ conversation }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConsultRepositoryError) {
      return NextResponse.json({ error: "The selected folder is invalid." }, { status: 400 });
    }
    throw error;
  }
}
