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
required AZURE_BUILDINGINFO_JOB_NAME
required BUILDINGINFO_IMAGE
required BUILDINGINFO_CONSENT_REFERENCE

cron_expression="${BUILDINGINFO_CRON_EXPRESSION:-0 9,10 * * *}"
username_secret_name="${BUILDINGINFO_USERNAME_SECRET_NAME:-buildinginfo-username}"
password_secret_name="${BUILDINGINFO_PASSWORD_SECRET_NAME:-buildinginfo-password}"
run_smoke_test="${BUILDINGINFO_RUN_SMOKE_TEST:-false}"

work_dir="$(mktemp -d)"
schedule_guard_override_active="false"
cleanup() {
  if [[ "$schedule_guard_override_active" == "true" ]]; then
    az containerapp job update \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_BUILDINGINFO_JOB_NAME" \
      --set-env-vars HELMONIC_SCHEDULE_GUARD_ENABLED=true \
      --only-show-errors \
      --output none 2>/dev/null || true
  fi
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

source_job="$work_dir/source-job.json"
source_secrets="$work_dir/source-secrets.json"
target_secrets="$work_dir/target-secrets.json"
merged_secrets="$work_dir/merged-secrets.json"
target_body="$work_dir/target-job.json"

az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_SOURCE_JOB_NAME" \
  --output json >"$source_job"

# Secret values never leave the ephemeral GitHub runner. They are copied only
# so the dedicated dev/test job can retain the existing Odoo, storage, Search
# and registry secret references used by the established 07:00 worker.
az containerapp job secret list \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_SOURCE_JOB_NAME" \
  --show-values \
  --output json >"$source_secrets"

target_exists="false"
if az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_BUILDINGINFO_JOB_NAME" \
  --only-show-errors \
  --output none 2>/dev/null; then
  target_exists="true"
  az containerapp job secret list \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_BUILDINGINFO_JOB_NAME" \
    --show-values \
    --output json >"$target_secrets"
else
  printf '[]\n' >"$target_secrets"
fi

# Prefer target-specific secrets, which preserves BuildingInfo credentials on
# later idempotent updates, while filling all other secret names from the 07:00
# source job. No value is printed.
jq -s '
  .[0] as $source
  | .[1] as $target
  | reduce ($source[]?) as $secret ({}; .[$secret.name] = $secret)
  | reduce ($target[]?) as $secret (.; .[$secret.name] = $secret)
  | [.[]]
' "$source_secrets" "$target_secrets" >"$merged_secrets"

credentials_present="false"
if jq -e \
  --arg username "$username_secret_name" \
  --arg password "$password_secret_name" \
  '([.[].name] | index($username)) != null and ([.[].name] | index($password)) != null' \
  "$merged_secrets" >/dev/null; then
  credentials_present="true"
fi

jq \
  --arg name "$AZURE_BUILDINGINFO_JOB_NAME" \
  --arg image "$BUILDINGINFO_IMAGE" \
  --arg cron "$cron_expression" \
  --arg consent "$BUILDINGINFO_CONSENT_REFERENCE" \
  --arg usernameSecret "$username_secret_name" \
  --arg passwordSecret "$password_secret_name" \
  --argjson credentialsPresent "$credentials_present" \
  --slurpfile secrets "$merged_secrets" '
  def set_value_env($name; $value):
    .properties.template.containers[0].env = (
      ((.properties.template.containers[0].env // []) | map(select(.name != $name)))
      + [{name: $name, value: $value}]
    );
  def set_secret_env($name; $secret):
    .properties.template.containers[0].env = (
      ((.properties.template.containers[0].env // []) | map(select(.name != $name)))
      + [{name: $name, secretRef: $secret}]
    );
  {
    location: .location,
    tags: (.tags // {}),
    identity: (
      if .identity == null then null
      else {
        type: .identity.type,
        userAssignedIdentities: (
          (.identity.userAssignedIdentities // {})
          | with_entries(.value = {})
        )
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
  | .properties.configuration.triggerType = (if $credentialsPresent then "Schedule" else "Manual" end)
  | if $credentialsPresent then
      .properties.configuration.scheduleTriggerConfig = {
        cronExpression: $cron,
        parallelism: 1,
        replicaCompletionCount: 1
      }
      | del(.properties.configuration.manualTriggerConfig)
    else
      .properties.configuration.manualTriggerConfig = {
        parallelism: 1,
        replicaCompletionCount: 1
      }
      | del(.properties.configuration.scheduleTriggerConfig)
    end
  | del(.properties.configuration.eventTriggerConfig)
  | .properties.template.containers[0].image = $image
  | .properties.template.containers[0].command = ["node"]
  | .properties.template.containers[0].args = [
      "scripts/tender_intelligence/run-daily-automation.mjs",
      "--buildinginfo-run"
    ]
  | set_value_env("NODE_OPTIONS"; "--experimental-strip-types")
  | set_value_env("HELMONIC_SCHEDULE_GUARD_ENABLED"; "true")
  | set_value_env("HELMONIC_SCHEDULE_TIMEZONE"; "Europe/Dublin")
  | set_value_env("HELMONIC_BUILDINGINFO_BROWSER_SCHEDULE_LOCAL_HOUR"; "10")
  | set_value_env("HELMONIC_BUILDINGINFO_BROWSER_ENABLED"; (if $credentialsPresent then "true" else "false" end))
  | set_value_env("BUILDINGINFO_BROWSER_CONSENT_REFERENCE"; $consent)
  | set_value_env("BUILDINGINFO_BROWSER_BASE_URL"; "https://app.buildinginfo.com/")
  | set_value_env("BUILDINGINFO_BROWSER_SEARCH_URL"; "https://app.buildinginfo.com/page.u.newsearch")
  | set_value_env("BUILDINGINFO_BROWSER_KEYWORDS"; "noise,acoustic,vibration,sound insulation,noise impact assessment")
  | set_value_env("BUILDINGINFO_BROWSER_SECTORS"; "Residential,Commercial,Education,Healthcare,Hotel,Industrial,Data Centre,Mixed Use,Infrastructure,Public Building")
  | set_value_env("BUILDINGINFO_BROWSER_STAGES"; "Plans Applied,Plans Granted,Pre-commencement,Commencement")
  | set_value_env("BUILDINGINFO_BROWSER_MAX_PROJECTS"; "150")
  | set_value_env("BUILDINGINFO_BROWSER_MAX_RESULTS_PER_SEARCH"; "2000")
  | set_value_env("BUILDINGINFO_BROWSER_MAX_LOAD_MORE_CLICKS"; "4")
  | set_value_env("BUILDINGINFO_BROWSER_REQUEST_DELAY_MS"; "2200")
  | set_value_env("BUILDINGINFO_BROWSER_INCLUDE_POTENTIAL"; "true")
  | set_value_env("BUILDINGINFO_BROWSER_HEADLESS"; "true")
  | set_value_env("ODOO_MIGRATE_MANAGED_RECORDS_TO_LEADS"; "false")
  | set_value_env("ODOO_NORMALIZE_HISTORICAL_RECORDS"; "false")
  | set_value_env("ODOO_CRM_UI_CONFIG_ENABLED"; "false")
  | set_value_env("ODOO_CRM_UI_CONFIG_REQUIRED"; "false")
  | set_value_env("HELMONIC_ODOO_PREFLIGHT_ONLY"; "false")
  | if $credentialsPresent then
      set_secret_env("BUILDINGINFO_BROWSER_USERNAME"; $usernameSecret)
      | set_secret_env("BUILDINGINFO_BROWSER_PASSWORD"; $passwordSecret)
    else
      .properties.template.containers[0].env |= map(
        select(.name != "BUILDINGINFO_BROWSER_USERNAME" and .name != "BUILDINGINFO_BROWSER_PASSWORD")
      )
    end
' "$source_job" >"$target_body"

source_id="$(jq -r '.id' "$source_job")"
target_id="${source_id%/*}/$AZURE_BUILDINGINFO_JOB_NAME"

az rest \
  --method put \
  --uri "https://management.azure.com${target_id}?api-version=2025-07-01" \
  --body "@$target_body" \
  --only-show-errors \
  --output none

actual_trigger="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_BUILDINGINFO_JOB_NAME" \
  --query properties.configuration.triggerType \
  --output tsv)"
actual_image="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_BUILDINGINFO_JOB_NAME" \
  --query properties.template.containers[0].image \
  --output tsv)"
actual_args="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_BUILDINGINFO_JOB_NAME" \
  --query 'join(` `, properties.template.containers[0].args)' \
  --output tsv)"
actual_cron="$(az containerapp job show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_BUILDINGINFO_JOB_NAME" \
  --query properties.configuration.scheduleTriggerConfig.cronExpression \
  --output tsv 2>/dev/null || true)"

jq -n \
  --arg job "$AZURE_BUILDINGINFO_JOB_NAME" \
  --arg sourceJob "$AZURE_SOURCE_JOB_NAME" \
  --arg trigger "$actual_trigger" \
  --arg cron "$actual_cron" \
  --arg image "$actual_image" \
  --arg args "$actual_args" \
  --argjson credentialsPresent "$credentials_present" \
  --argjson targetPreviouslyExisted "$target_exists" \
  '{
    job: $job,
    sourceJob: $sourceJob,
    trigger: $trigger,
    cron: $cron,
    image: $image,
    args: $args,
    credentialsPresent: $credentialsPresent,
    targetPreviouslyExisted: $targetPreviouslyExisted
  }'

if [[ "$credentials_present" != "true" ]]; then
  echo "BuildingInfo job is staged safely in Manual mode." >&2
  echo "Add Azure job secrets '$username_secret_name' and '$password_secret_name', then rerun this provision step to activate the schedule." >&2
  exit 0
fi

if [[ "$actual_trigger" != "Schedule" || "$actual_cron" != "$cron_expression" ]]; then
  echo "BuildingInfo job schedule verification failed." >&2
  exit 1
fi

if [[ "$run_smoke_test" == "true" ]]; then
  az containerapp job update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_BUILDINGINFO_JOB_NAME" \
    --set-env-vars HELMONIC_SCHEDULE_GUARD_ENABLED=false \
    --only-show-errors \
    --output none
  schedule_guard_override_active="true"

  execution_name="$(az containerapp job start \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_BUILDINGINFO_JOB_NAME" \
    --query name \
    --output tsv)"

  az containerapp job update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_BUILDINGINFO_JOB_NAME" \
    --set-env-vars HELMONIC_SCHEDULE_GUARD_ENABLED=true \
    --only-show-errors \
    --output none
  schedule_guard_override_active="false"
  if [[ -z "$execution_name" ]]; then
    echo "Azure did not return an execution name for the BuildingInfo smoke test." >&2
    exit 1
  fi
  echo "Started controlled BuildingInfo dev/test execution: $execution_name"

  show_execution_logs() {
    local container_name
    container_name="$(az containerapp job show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_BUILDINGINFO_JOB_NAME" \
      --query 'properties.template.containers[0].name' \
      --output tsv 2>/dev/null || true)"
    if [[ -n "$container_name" ]]; then
      echo "--- BuildingInfo dev/test container output ---"
      az containerapp job logs show \
        --resource-group "$AZURE_RESOURCE_GROUP" \
        --name "$AZURE_BUILDINGINFO_JOB_NAME" \
        --execution "$execution_name" \
        --container "$container_name" \
        --format text \
        --tail 200 2>&1 || true
      echo "--- end BuildingInfo dev/test container output ---"
    fi
  }

  for attempt in {1..80}; do
    execution_status="$(az containerapp job execution show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_BUILDINGINFO_JOB_NAME" \
      --job-execution-name "$execution_name" \
      --query properties.status \
      --output tsv 2>/dev/null || true)"

    case "$execution_status" in
      Succeeded)
        echo "Controlled BuildingInfo dev/test execution succeeded: $execution_name"
        show_execution_logs
        exit 0
        ;;
      Failed)
        echo "Controlled BuildingInfo dev/test execution failed: $execution_name" >&2
        show_execution_logs >&2
        exit 1
        ;;
    esac

    echo "BuildingInfo dev/test execution status: ${execution_status:-Pending} (check $attempt/80)"
    sleep 30
  done

  echo "Timed out waiting for the controlled BuildingInfo dev/test execution: $execution_name" >&2
  exit 1
fi
