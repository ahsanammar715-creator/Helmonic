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
required AZURE_WATCHDOG_JOB_NAME
required TENDER_INTELLIGENCE_IMAGE
required TENDER_WATCHDOG_ALERT_EMAIL

cron_expression="${TENDER_WATCHDOG_CRON_EXPRESSION:-30 10 * * *}"
maximum_age_hours="${HELMONIC_TENDER_WATCHDOG_MAX_AGE_HOURS:-5}"
action_group_name="${TENDER_WATCHDOG_ACTION_GROUP_NAME:-ag-helmonic-ti-watchdog}"
alert_name="${TENDER_WATCHDOG_ALERT_NAME:-alert-helmonic-ti-watchdog-failed}"
start_validation="${TENDER_WATCHDOG_START_VALIDATION:-false}"

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

# Build a deliberately narrow job from the daily worker. It keeps only the
# managed identity, registry pull configuration and four non-secret storage
# settings required to read the durable health receipt. Odoo, source API,
# outreach and all unrelated credentials are excluded.
jq \
  --arg name "$AZURE_WATCHDOG_JOB_NAME" \
  --arg image "$TENDER_INTELLIGENCE_IMAGE" \
  --arg cron "$cron_expression" \
  --arg maximumAgeHours "$maximum_age_hours" \
  --slurpfile secrets "$source_secrets" '
  def selected_env:
    ["AZURE_TENDER_STORAGE_ACCOUNT", "AZURE_TENDER_STORAGE_CONTAINER", "AZURE_TENDER_STORAGE_CLIENT_ID", "HELMONIC_TENDER_BLOB_NAMESPACE"] as $names
    | [(.properties.template.containers[0].env // [])[] | select(.name as $name | $names | index($name))];
  (.properties.configuration.registries // []) as $registries
  | selected_env as $storageEnv
  | ([$registries[]?.passwordSecretRef, $storageEnv[]?.secretRef] | map(select(. != null and . != "")) | unique) as $requiredSecrets
  | {
      location: .location,
      tags: ((.tags // {}) + {purpose: "tender-intelligence-health-watchdog"}),
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
        configuration: {
          triggerType: "Schedule",
          replicaTimeout: 600,
          replicaRetryLimit: 0,
          scheduleTriggerConfig: {
            cronExpression: $cron,
            parallelism: 1,
            replicaCompletionCount: 1
          },
          registries: $registries,
          secrets: ($secrets[0] | map(select(.name as $name | $requiredSecrets | index($name))) | map(
            if .keyVaultUrl then
              {name: .name, keyVaultUrl: .keyVaultUrl, identity: .identity}
            else
              {name: .name, value: .value}
            end
          ))
        },
        template: {
          containers: [{
            name: "tender-intelligence-watchdog",
            image: $image,
            command: ["node"],
            args: ["scripts/tender_intelligence/verify-daily-automation-health.mjs"],
            env: ($storageEnv + [
              {name: "HELMONIC_TENDER_BLOB_ENABLED", value: "true"},
              {name: "HELMONIC_TENDER_WATCHDOG_MAX_AGE_HOURS", value: $maximumAgeHours},
              {name: "NODE_OPTIONS", value: "--experimental-strip-types"}
            ]),
            resources: {
              cpu: 0.25,
              memory: "0.5Gi"
            }
          }]
        }
      }
    }
' "$source_job" >"$target_body"

storage_env_count="$(jq '[.properties.template.containers[0].env[] | select(.name == "AZURE_TENDER_STORAGE_ACCOUNT" or .name == "AZURE_TENDER_STORAGE_CONTAINER" or .name == "AZURE_TENDER_STORAGE_CLIENT_ID" or .name == "HELMONIC_TENDER_BLOB_NAMESPACE")] | length' "$target_body")"
if [[ "$storage_env_count" != "4" ]]; then
  echo "Refusing to provision: the source worker does not expose all four required storage settings." >&2
  exit 1
fi

source_id="$(jq -r '.id' "$source_job")"
target_id="${source_id%/*}/$AZURE_WATCHDOG_JOB_NAME"

az rest \
  --method put \
  --uri "https://management.azure.com${target_id}?api-version=2025-07-01" \
  --body "@$target_body" \
  --only-show-errors \
  --output none

az monitor action-group create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$action_group_name" \
  --short-name "HelTiWatch" \
  --action email Ammar "$TENDER_WATCHDOG_ALERT_EMAIL" usecommonalertschema \
  --only-show-errors \
  --output none

action_group_id="$(az monitor action-group show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$action_group_name" \
  --query id \
  --output tsv)"

az monitor metrics alert create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$alert_name" \
  --scopes "$target_id" \
  --description "Tender Intelligence daily health receipt is missing, stale or unhealthy." \
  --condition "total Executions > 0 where state includes Failed" \
  --window-size 5m \
  --evaluation-frequency 5m \
  --severity 1 \
  --auto-mitigate false \
  --action "$action_group_id" \
  --only-show-errors \
  --output none

actual_trigger="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WATCHDOG_JOB_NAME" \
  --query properties.configuration.triggerType \
  --output tsv)"
actual_cron="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WATCHDOG_JOB_NAME" \
  --query properties.configuration.scheduleTriggerConfig.cronExpression \
  --output tsv)"
actual_args="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WATCHDOG_JOB_NAME" \
  --query 'join(` `, properties.template.containers[0].args)' \
  --output tsv)"
actual_alert_enabled="$(az monitor metrics alert show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$alert_name" \
  --query enabled \
  --output tsv)"

if [[ "$actual_trigger" != "Schedule" \
  || "$actual_cron" != "$cron_expression" \
  || "$actual_args" != "scripts/tender_intelligence/verify-daily-automation-health.mjs" \
  || "$actual_alert_enabled" != "true" ]]; then
  echo "Tender Intelligence watchdog provisioning verification failed." >&2
  exit 1
fi

validation_execution=""
validation_status="not-started"
if [[ "$start_validation" == "true" ]]; then
  validation_execution="$(az containerapp job start \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WATCHDOG_JOB_NAME" \
    --query name \
    --output tsv)"
  for attempt in {1..40}; do
    validation_status="$(az containerapp job execution show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WATCHDOG_JOB_NAME" \
      --job-execution-name "$validation_execution" \
      --query properties.status \
      --output tsv 2>/dev/null || true)"
    case "$validation_status" in
      Succeeded) break ;;
      Failed)
        echo "Watchdog validation failed: $validation_execution" >&2
        exit 1
        ;;
      *) sleep 15 ;;
    esac
  done
  if [[ "$validation_status" != "Succeeded" ]]; then
    echo "Watchdog validation did not succeed within 10 minutes: ${validation_status:-unknown}" >&2
    exit 1
  fi
fi

jq -n \
  --arg job "$AZURE_WATCHDOG_JOB_NAME" \
  --arg sourceJob "$AZURE_SOURCE_JOB_NAME" \
  --arg cron "$actual_cron" \
  --arg image "$TENDER_INTELLIGENCE_IMAGE" \
  --arg alert "$alert_name" \
  --arg recipient "$TENDER_WATCHDOG_ALERT_EMAIL" \
  --arg validationExecution "$validation_execution" \
  --arg validationStatus "$validation_status" \
  '{
    job: $job,
    sourceJob: $sourceJob,
    trigger: "Schedule",
    cronUtc: $cron,
    image: $image,
    alert: $alert,
    recipient: $recipient,
    validationExecution: $validationExecution,
    validationStatus: $validationStatus,
    odooEnabled: false,
    outreachEnabled: false,
    sourceCollectionEnabled: false
  }'
