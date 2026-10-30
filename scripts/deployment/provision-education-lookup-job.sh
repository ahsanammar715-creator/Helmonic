#!/usr/bin/env bash

set -euo pipefail

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

required AZURE_RESOURCE_GROUP
required AZURE_SOURCE_JOB_NAME
required AZURE_EDUCATION_JOB_NAME
required EDUCATION_LOOKUP_IMAGE

automated="${EDUCATION_LOOKUP_AUTOMATED:-false}"
cron_expression="${EDUCATION_LOOKUP_CRON_EXPRESSION:-0 7,8 * * *}"

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

source_job="$work_dir/source-job.json"
source_secrets="$work_dir/source-secrets.json"
target_body="$work_dir/target-job.json"

az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_SOURCE_JOB_NAME" \
  --output json >"$source_job"

az containerapp job secret list \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_SOURCE_JOB_NAME" \
  --show-values \
  --output json >"$source_secrets"

jq \
  --arg name "$AZURE_EDUCATION_JOB_NAME" \
  --arg image "$EDUCATION_LOOKUP_IMAGE" \
  --arg cron "$cron_expression" \
  --argjson automated "$automated" \
  --slurpfile secrets "$source_secrets" '
  def set_value_env($name; $value):
    .properties.template.containers[0].env = (
      ((.properties.template.containers[0].env // []) | map(select(.name != $name)))
      + [{name: $name, value: $value}]
    );
  {
    location: .location,
    tags: (.tags // {}),
    identity: (
      if .identity == null then null
      else {
        type: .identity.type,
        userAssignedIdentities: ((.identity.userAssignedIdentities // {}) | with_entries(.value = {}))
      }
      end
    ),
    properties: {
      environmentId: .properties.environmentId,
      workloadProfileName: .properties.workloadProfileName,
      configuration: .properties.configuration,
      template: .properties.template
    }
  }
  | .name = $name
  | .properties.configuration.secrets = ($secrets[0] | map(
      if .keyVaultUrl then
        {name: .name, keyVaultUrl: .keyVaultUrl, identity: .identity}
      else
        {name: .name, value: .value}
      end
    ))
  | .properties.configuration.triggerType = (if $automated then "Schedule" else "Manual" end)
  | if $automated then
      .properties.configuration.scheduleTriggerConfig = {
        cronExpression: $cron,
        parallelism: 1,
        replicaCompletionCount: 1
      }
      | del(.properties.configuration.manualTriggerConfig)
    else
      .properties.configuration.manualTriggerConfig = {parallelism: 1, replicaCompletionCount: 1}
      | del(.properties.configuration.scheduleTriggerConfig)
    end
  | del(.properties.configuration.eventTriggerConfig)
  | .properties.template.containers[0].image = $image
  | .properties.template.containers[0].command = ["node"]
  | .properties.template.containers[0].args = ["scripts/tender_intelligence/run-daily-automation.mjs"]
  | set_value_env("NODE_OPTIONS"; "--experimental-strip-types")
  | set_value_env("HELMONIC_LOOKUP_CAMPAIGN"; "education-bim")
  | set_value_env("HELMONIC_TENDER_ARTIFACT_ROOT"; "/app/local-artifacts/tender-intelligence-education")
  | set_value_env("HELMONIC_TENDER_BLOB_NAMESPACE"; "campaigns/education-bim")
  | set_value_env("HELMONIC_SCHEDULE_GUARD_ENABLED"; (if $automated then "true" else "false" end))
  | set_value_env("HELMONIC_SCHEDULE_TIMEZONE"; "Europe/Dublin")
  | set_value_env("HELMONIC_SCHEDULE_LOCAL_HOUR"; "8")
  | set_value_env("HELMONIC_BUILDINGINFO_ENABLED"; "false")
  | set_value_env("HELMONIC_BUILDINGINFO_CSV_ENABLED"; "false")
  | set_value_env("HELMONIC_BUILDINGINFO_BROWSER_ENABLED"; "false")
  | set_value_env("ODOO_MIGRATE_MANAGED_RECORDS_TO_LEADS"; "false")
  | set_value_env("ODOO_NORMALIZE_HISTORICAL_RECORDS"; "false")
  | set_value_env("ODOO_ARCHIVE_UNMANAGED_TEST_FIXTURES"; "false")
  | set_value_env("ODOO_CRM_UI_CONFIG_ENABLED"; "false")
  | set_value_env("ODOO_CRM_UI_CONFIG_REQUIRED"; "false")
  | set_value_env("HELMONIC_ODOO_PREFLIGHT_ONLY"; "false")
  | set_value_env("HELMONIC_OUTREACH_SEND_ENABLED"; "false")
' "$source_job" >"$target_body"

source_id="$(jq -r '.id' "$source_job")"
target_id="${source_id%/*}/$AZURE_EDUCATION_JOB_NAME"

az rest \
  --method put \
  --uri "https://management.azure.com${target_id}?api-version=2025-07-01" \
  --body "@$target_body" \
  --only-show-errors \
  --output none

actual_trigger="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_EDUCATION_JOB_NAME" \
  --query properties.configuration.triggerType \
  --output tsv)"
actual_cron="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_EDUCATION_JOB_NAME" \
  --query properties.configuration.scheduleTriggerConfig.cronExpression \
  --output tsv 2>/dev/null || true)"
actual_campaign="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_EDUCATION_JOB_NAME" \
  --query 'properties.template.containers[0].env[?name==`HELMONIC_LOOKUP_CAMPAIGN`].value | [0]' \
  --output tsv)"
actual_buildinginfo="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_EDUCATION_JOB_NAME" \
  --query 'properties.template.containers[0].env[?name==`HELMONIC_BUILDINGINFO_BROWSER_ENABLED`].value | [0]' \
  --output tsv)"

expected_trigger="Manual"
if [[ "$automated" == "true" ]]; then expected_trigger="Schedule"; fi
if [[ "$actual_trigger" != "$expected_trigger" \
  || "$actual_campaign" != "education-bim" \
  || "$actual_buildinginfo" != "false" ]]; then
  echo "Education lookup job safety verification failed." >&2
  exit 1
fi
if [[ "$automated" == "true" && "$actual_cron" != "$cron_expression" ]]; then
  echo "Education lookup job schedule verification failed." >&2
  exit 1
fi

jq -n \
  --arg job "$AZURE_EDUCATION_JOB_NAME" \
  --arg sourceJob "$AZURE_SOURCE_JOB_NAME" \
  --arg trigger "$actual_trigger" \
  --arg cron "$actual_cron" \
  --arg campaign "$actual_campaign" \
  --arg image "$EDUCATION_LOOKUP_IMAGE" \
  '{
    job: $job,
    sourceJob: $sourceJob,
    trigger: $trigger,
    cron: $cron,
    campaign: $campaign,
    image: $image,
    buildingInfoExcluded: true,
    outreachSendingEnabled: false
  }'
