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
      ODOO_MIGRATE_MANAGED_RECORDS_TO_LEADS=false \
      ODOO_NORMALIZE_HISTORICAL_RECORDS=true \
      ODOO_ARCHIVE_UNMANAGED_TEST_FIXTURES=false \
      ODOO_REQUEST_INTERVAL_MS=250 \
      ODOO_CRM_UI_CONFIG_ENABLED=false \
      ODOO_CRM_UI_CONFIG_REQUIRED=false \
      HELMONIC_ODOO_PREFLIGHT_ONLY=false \
      HELMONIC_ODOO_MIGRATION_ONLY=false \
      HELMONIC_BUILDINGINFO_BROWSER_ENABLED=false \
      HELMONIC_SCHEDULE_GUARD_ENABLED=true \
      HELMONIC_COUNCIL_EVIDENCE_CONCURRENCY=3 \
      HELMONIC_ACOUSTIC_GRANT_LOOKBACK_DAYS=2 \
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
    --output tsv 2>/dev/null || true)"
  if [[ -n "$container_name" ]]; then
    az containerapp job logs show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_JOB_NAME" \
      --execution "$execution_name" \
      --container "$container_name" \
      --format text \
      --tail 250 2>&1 || true
  fi
}

wait_for_execution() {
  local execution_name="$1"
  if [[ -z "$execution_name" ]]; then
    echo "Azure did not return a job execution name for the full Odoo test collection." >&2
    return 1
  fi

  echo "Started guarded full Odoo test collection: $execution_name"
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
        echo "Guarded full Odoo test collection succeeded."
        return 0
        ;;
      Failed)
        echo "Guarded full Odoo test collection failed: $execution_name" >&2
        show_execution_logs "$execution_name"
        return 1
        ;;
      *)
        echo "Full Odoo test collection status: ${status:-starting} (check $attempt/120)"
        sleep 30
        ;;
    esac
  done

  echo "Full Odoo test collection did not finish within 60 minutes." >&2
  show_execution_logs "$execution_name"
  echo "Stopping the bounded test execution so it cannot continue unattended." >&2
  az containerapp job stop \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_JOB_NAME" \
    --job-execution-name "$execution_name" \
    --only-show-errors \
    --output none 2>/dev/null || true
  return 1
}

trap restore_safe_recurring_mode EXIT

# The same complete source/document pipeline used by the 07:00 worker is run
# once without its time-window guard. Authenticated BuildingInfo browsing is
# explicitly disabled; only supported official/public source collectors and
# already-approved non-browser feeds are eligible.
az containerapp job update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --image "$TENDER_INTELLIGENCE_IMAGE" \
  --set-env-vars \
    ODOO_MIGRATE_MANAGED_RECORDS_TO_LEADS=false \
    ODOO_NORMALIZE_HISTORICAL_RECORDS=true \
    ODOO_ARCHIVE_UNMANAGED_TEST_FIXTURES=false \
    ODOO_REQUEST_INTERVAL_MS=250 \
    ODOO_CRM_UI_CONFIG_ENABLED=false \
    ODOO_CRM_UI_CONFIG_REQUIRED=false \
    HELMONIC_ODOO_PREFLIGHT_ONLY=false \
    HELMONIC_ODOO_MIGRATION_ONLY=false \
    HELMONIC_BUILDINGINFO_BROWSER_ENABLED=false \
    HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    HELMONIC_COUNCIL_EVIDENCE_CONCURRENCY=5 \
    HELMONIC_ACOUSTIC_GRANT_LOOKBACK_DAYS=30 \
    NODE_OPTIONS=--experimental-strip-types \
  --command node \
  --args scripts/tender_intelligence/run-daily-automation.mjs \
  --only-show-errors >/dev/null

execution_name="$(az containerapp job start \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --query name \
  --output tsv)"
wait_for_execution "$execution_name"

az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_JOB_NAME" \
  --query '{image:properties.template.containers[0].image,triggerType:properties.configuration.triggerType,schedule:properties.configuration.scheduleTriggerConfig.cronExpression}' \
  --output json
