import ConsultWorkspace from "@/components/consult/ConsultWorkspace";
import { getRuntimeConfig } from "@/lib/server/config";

export const metadata = { title: "Consult · Helmonic" };
export const dynamic = "force-dynamic";

export default function ConsultPage() {
  const config = getRuntimeConfig();
  return <ConsultWorkspace webGroundingEnabled={config.webGrounding.enabled} />;
}
