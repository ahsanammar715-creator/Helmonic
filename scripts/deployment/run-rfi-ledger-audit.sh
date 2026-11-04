#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${AZURE_JOB_NAME:?AZURE_JOB_NAME is required}"
: "${TENDER_INTELLIGENCE_IMAGE:?TENDER_INTELLIGENCE_IMAGE is required}"

restore_safe_recurring_mode() {
  az containerapp job update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --set-env-vars \
      HELMONIC_RFI_LEDGER_AUDIT_ONLY=false \
      HELMONIC_ODOO_PREFLIGHT_ONLY=false \
      HELMONIC_ODOO_MIGRATION_ONLY=false \
      HELMONIC_ODOO_COMPLETED_LEDGER_SYNC_ONLY=false \
      HELMONIC_BUILDINGINFO_BROWSER_ENABLED=false \
      HELMONIC_SCHEDULE_GUARD_ENABLED=true \
      NODE_OPTIONS=--experimental-strip-types \
    --command node \
    --args scripts/tender_intelligence/run-daily-automation.mjs \
    --only-show-errors >/dev/null
}

show_execution_logs() {
  local execution_name="$1"
  local container_name
  container_name="$(az containerapp job show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --query 'properties.template.containers[0].name' \
    --output tsv)"
  az containerapp job logs show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --execution "$execution_name" \
    --container "$container_name" \
    --format text \
    --tail 300 2>&1 || true
}

trap restore_safe_recurring_mode EXIT

az containerapp job update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --image "$TENDER_INTELLIGENCE_IMAGE" \
  --set-env-vars \
    HELMONIC_RFI_LEDGER_AUDIT_ONLY=true \
    HELMONIC_ODOO_PREFLIGHT_ONLY=false \
    HELMONIC_ODOO_MIGRATION_ONLY=false \
    HELMONIC_ODOO_COMPLETED_LEDGER_SYNC_ONLY=false \
    HELMONIC_BUILDINGINFO_BROWSER_ENABLED=false \
    HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    NODE_OPTIONS=--experimental-strip-types \
  --command node \
  --args scripts/tender_intelligence/run-daily-automation.mjs \
  --only-show-errors >/dev/null

execution_name="$(az containerapp job start \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --query name \
  --output tsv)"
echo "Started read-only completed-ledger RFI audit: $execution_name"

for attempt in {1..40}; do
  status="$(az containerapp job execution show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --job-execution-name "$execution_name" \
    --query properties.status \
    --output tsv 2>/dev/null || true)"
  case "$status" in
    Succeeded)
      echo "Read-only completed-ledger RFI audit succeeded."
      show_execution_logs "$execution_name"
      exit 0
      ;;
    Failed)
      echo "Read-only completed-ledger RFI audit failed." >&2
      show_execution_logs "$execution_name"
      exit 1
      ;;
    *) sleep 15 ;;
  esac
done

echo "Read-only completed-ledger RFI audit exceeded its 10-minute safety limit." >&2
show_execution_logs "$execution_name"
az containerapp job stop \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --job-execution-name "$execution_name" \
  --only-show-errors \
  --output none 2>/dev/null || true
exit 1
