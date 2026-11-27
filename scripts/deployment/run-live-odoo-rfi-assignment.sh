#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${AZURE_JOB_NAME:?AZURE_JOB_NAME is required}"
: "${TENDER_INTELLIGENCE_IMAGE:?TENDER_INTELLIGENCE_IMAGE is required}"

expected_live_url="${HELMONIC_ODOO_EXPECTED_BASE_URL:-}"
expected_live_database="${HELMONIC_ODOO_EXPECTED_DATABASE:-iacoustics}"
max_ledger_age_hours="${HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS:-36}"
if [[ "$expected_live_url" != "https://iacoustics.odoo.com" || "$expected_live_database" != "iacoustics" ]]; then
  echo "Live RFI assignment refused: the exact iAcoustics Odoo target was not confirmed." >&2
  exit 1
fi

show_logs() {
  local execution_name="$1"
  local container_name
  container_name="$(az containerapp job show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_JOB_NAME" --query 'properties.template.containers[0].name' --output tsv)"
  az containerapp job logs show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_JOB_NAME" --execution "$execution_name" --container "$container_name" --format text --tail 300 2>&1 || true
}

wait_for_execution() {
  local execution_name="$1"
  local label="$2"
  for attempt in {1..80}; do
    status="$(az containerapp job execution show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_JOB_NAME" --job-execution-name "$execution_name" --query properties.status --output tsv 2>/dev/null || true)"
    case "$status" in
      Succeeded) echo "$label succeeded: $execution_name"; show_logs "$execution_name"; return 0 ;;
      Failed) echo "$label failed: $execution_name" >&2; show_logs "$execution_name"; return 1 ;;
      *) sleep 15 ;;
    esac
  done
  echo "$label did not finish within 20 minutes." >&2
  show_logs "$execution_name"
  return 1
}

restore_silent_recurring_mode() {
  az containerapp job update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --image "$TENDER_INTELLIGENCE_IMAGE" \
    --set-env-vars \
      HELMONIC_ODOO_SYNC_ENABLED=true \
      ODOO_BASE_URL="$expected_live_url" \
      ODOO_DATABASE="$expected_live_database" \
      HELMONIC_ODOO_EXPECTED_BASE_URL="$expected_live_url" \
      HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS="$max_ledger_age_hours" \
      ODOO_ASSIGN_NATIVE_OWNERS=true \
      HELMONIC_ODOO_ASSIGN_RFI_OWNERS=false \
      HELMONIC_RFI_EMAIL_ENABLED=false \
      HELMONIC_OUTREACH_SEND_ENABLED=false \
      ODOO_MIGRATE_MANAGED_RECORDS_TO_LEADS=false \
      ODOO_NORMALIZE_HISTORICAL_RECORDS=true \
      ODOO_ARCHIVE_UNMANAGED_TEST_FIXTURES=false \
      ODOO_REQUEST_INTERVAL_MS=250 \
      ODOO_CRM_UI_CONFIG_ENABLED=false \
      ODOO_CRM_UI_CONFIG_REQUIRED=false \
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
trap restore_silent_recurring_mode EXIT

# Hydrate and validate the fresh completed ledger without writing to Odoo.
az containerapp job update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --image "$TENDER_INTELLIGENCE_IMAGE" \
  --set-env-vars \
    HELMONIC_ODOO_SYNC_ENABLED=false \
    HELMONIC_ODOO_ASSIGN_RFI_OWNERS=false \
    ODOO_BASE_URL="$expected_live_url" \
    ODOO_DATABASE="$expected_live_database" \
    HELMONIC_ODOO_EXPECTED_BASE_URL="$expected_live_url" \
    HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS="$max_ledger_age_hours" \
    HELMONIC_RFI_EMAIL_ENABLED=false \
    HELMONIC_OUTREACH_SEND_ENABLED=false \
    HELMONIC_ODOO_COMPLETED_LEDGER_SYNC_ONLY=true \
    HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    NODE_OPTIONS=--experimental-strip-types \
  --command node \
  --args scripts/tender_intelligence/run-daily-automation.mjs \
  --only-show-errors >/dev/null
rehearsal_execution="$(az containerapp job start --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_JOB_NAME" --query name --output tsv)"
wait_for_execution "$rehearsal_execution" "RFI assignment no-write rehearsal"

# Write only crm.lead.user_id. The code rejects non-RFIs and uses Odoo's
# no-tracking/no-subscribe context so no assignment message is generated.
az containerapp job update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --image "$TENDER_INTELLIGENCE_IMAGE" \
  --set-env-vars \
    HELMONIC_ODOO_ASSIGN_RFI_OWNERS=true \
    ODOO_ASSIGN_NATIVE_OWNERS=true \
    HELMONIC_RFI_EMAIL_ENABLED=false \
    HELMONIC_OUTREACH_SEND_ENABLED=false \
    HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    NODE_OPTIONS=--experimental-strip-types \
  --command node \
  --args scripts/tender_intelligence/assign-odoo-rfi-owners.mjs \
  --only-show-errors >/dev/null
assignment_execution="$(az containerapp job start --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_JOB_NAME" --query name --output tsv)"
wait_for_execution "$assignment_execution" "silent live Odoo RFI salesperson assignment"

echo "Live RFI salesperson assignment completed; email, outreach, chatter and assignment notifications remained disabled."
