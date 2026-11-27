#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${AZURE_JOB_NAME:?AZURE_JOB_NAME is required}"
: "${TENDER_INTELLIGENCE_IMAGE:?TENDER_INTELLIGENCE_IMAGE is required}"

expected_live_url="${HELMONIC_ODOO_EXPECTED_BASE_URL:-}"
expected_live_database="${HELMONIC_ODOO_EXPECTED_DATABASE:-iacoustics}"
max_ledger_age_hours="${HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS:-36}"

if [[ "$expected_live_url" != "https://iacoustics.odoo.com" ]]; then
  echo "Live Odoo promotion refused: HELMONIC_ODOO_EXPECTED_BASE_URL must be exactly https://iacoustics.odoo.com." >&2
  exit 1
fi
if [[ "$expected_live_database" != "iacoustics" ]]; then
  echo "Live Odoo promotion refused: HELMONIC_ODOO_EXPECTED_DATABASE must be exactly iacoustics." >&2
  exit 1
fi
if ! [[ "$max_ledger_age_hours" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Live Odoo promotion refused: HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS must be numeric." >&2
  exit 1
fi

run_label=""
promotion_succeeded=false

show_execution_logs() {
  local execution_name="$1"
  local container_name
  container_name="$(az containerapp job show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --query 'properties.template.containers[0].name' \
    --output tsv 2>/dev/null || true)"
  if [[ -n "$container_name" ]]; then
    az containerapp job logs show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_JOB_NAME" \
      --execution "$execution_name" \
      --container "$container_name" \
      --format text \
      --tail 300 2>&1 || true
  fi
}

wait_for_execution() {
  local execution_name="$1"
  if [[ -z "$execution_name" ]]; then
    echo "Azure did not return an execution name for $run_label." >&2
    return 1
  fi

  echo "Started $run_label: $execution_name"
  for attempt in {1..120}; do
    local status
    status="$(az containerapp job execution show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_JOB_NAME" \
      --job-execution-name "$execution_name" \
      --query properties.status \
      --output tsv 2>/dev/null || true)"
    case "$status" in
      Succeeded)
        echo "$run_label succeeded."
        show_execution_logs "$execution_name"
        return 0
        ;;
      Failed)
        echo "$run_label failed: $execution_name" >&2
        show_execution_logs "$execution_name"
        return 1
        ;;
      *)
        echo "$run_label status: ${status:-starting} (check $attempt/120)"
        sleep 30
        ;;
    esac
  done

  echo "$run_label did not finish within 60 minutes." >&2
  show_execution_logs "$execution_name"
  az containerapp job stop \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --job-execution-name "$execution_name" \
    --only-show-errors \
    --output none 2>/dev/null || true
  return 1
}

start_job() {
  local label="$1"
  run_label="$label"
  local execution_name
  execution_name="$(az containerapp job start \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --query name \
    --output tsv)"
  wait_for_execution "$execution_name"
}

restore_safe_live_recurring_mode() {
  local sync_enabled="false"
  if [[ "$promotion_succeeded" == "true" ]]; then
    sync_enabled="true"
  fi
  az containerapp job update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --image "$TENDER_INTELLIGENCE_IMAGE" \
    --set-env-vars \
      HELMONIC_ODOO_SYNC_ENABLED="$sync_enabled" \
      ODOO_BASE_URL="$expected_live_url" \
      ODOO_DATABASE="$expected_live_database" \
      HELMONIC_ODOO_EXPECTED_BASE_URL="$expected_live_url" \
      HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS="$max_ledger_age_hours" \
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

trap restore_safe_live_recurring_mode EXIT

# Stage 1: hydrate the durable artifacts, prove that the completed ledger and
# matching audit agree, and reject stale data. Odoo writes remain disabled.
az containerapp job update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --image "$TENDER_INTELLIGENCE_IMAGE" \
  --set-env-vars \
    HELMONIC_ODOO_SYNC_ENABLED=false \
    ODOO_BASE_URL="$expected_live_url" \
    ODOO_DATABASE="$expected_live_database" \
    HELMONIC_ODOO_EXPECTED_BASE_URL="$expected_live_url" \
    HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS="$max_ledger_age_hours" \
    HELMONIC_RFI_EMAIL_ENABLED=false \
    HELMONIC_OUTREACH_SEND_ENABLED=false \
    ODOO_MIGRATE_MANAGED_RECORDS_TO_LEADS=false \
    ODOO_NORMALIZE_HISTORICAL_RECORDS=false \
    ODOO_ARCHIVE_UNMANAGED_TEST_FIXTURES=false \
    HELMONIC_ODOO_PREFLIGHT_ONLY=false \
    HELMONIC_ODOO_MIGRATION_ONLY=false \
    HELMONIC_ODOO_COMPLETED_LEDGER_SYNC_ONLY=true \
    HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    NODE_OPTIONS=--experimental-strip-types \
  --command node \
  --args scripts/tender_intelligence/run-daily-automation.mjs \
  --only-show-errors >/dev/null
start_job "fresh completed-ledger no-write rehearsal"

# Stage 2: verify the exact live hostname, Odoo version, field contract, sales
# team, lead stage and consultant users. The preflight makes zero writes.
az containerapp job update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --image "$TENDER_INTELLIGENCE_IMAGE" \
  --set-env-vars \
    HELMONIC_ODOO_SYNC_ENABLED=false \
    ODOO_BASE_URL="$expected_live_url" \
    ODOO_DATABASE="$expected_live_database" \
    HELMONIC_ODOO_EXPECTED_BASE_URL="$expected_live_url" \
    HELMONIC_RFI_EMAIL_ENABLED=false \
    HELMONIC_OUTREACH_SEND_ENABLED=false \
    HELMONIC_ODOO_PREFLIGHT_ONLY=true \
    HELMONIC_ODOO_MIGRATION_ONLY=false \
    HELMONIC_ODOO_COMPLETED_LEDGER_SYNC_ONLY=false \
    HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    NODE_OPTIONS=--experimental-strip-types \
  --command node \
  --args scripts/tender_intelligence/run-daily-automation.mjs \
  --only-show-errors >/dev/null
start_job "zero-write live Odoo preflight"

# Stage 3: upsert the fresh, deduplicated completed ledger. New inactive
# history is skipped, existing human CRM decisions are preserved, and all
# email/outreach paths remain disabled.
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
    HELMONIC_RFI_EMAIL_ENABLED=false \
    HELMONIC_OUTREACH_SEND_ENABLED=false \
    ODOO_MIGRATE_MANAGED_RECORDS_TO_LEADS=true \
    ODOO_NORMALIZE_HISTORICAL_RECORDS=true \
    ODOO_ARCHIVE_UNMANAGED_TEST_FIXTURES=false \
    ODOO_REQUEST_INTERVAL_MS=250 \
    ODOO_CRM_UI_CONFIG_ENABLED=false \
    ODOO_CRM_UI_CONFIG_REQUIRED=false \
    HELMONIC_ODOO_PREFLIGHT_ONLY=false \
    HELMONIC_ODOO_MIGRATION_ONLY=false \
    HELMONIC_ODOO_COMPLETED_LEDGER_SYNC_ONLY=true \
    HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    NODE_OPTIONS=--experimental-strip-types \
  --command node \
  --args scripts/tender_intelligence/run-daily-automation.mjs \
  --only-show-errors >/dev/null
start_job "controlled live Odoo RFI migration"

promotion_succeeded=true
echo "Live Odoo RFI migration completed with email and outreach disabled."
