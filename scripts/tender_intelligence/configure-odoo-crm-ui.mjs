import { ODOO_TENDER_FIELD_CONTRACT } from "../../src/lib/tender-intelligence/odoo-field-contract.ts";

const enabled = process.env.ODOO_CRM_UI_CONFIG_ENABLED === "true";
if (!enabled) {
  console.log(JSON.stringify({ status: "disabled", writesAttempted: 0 }, null, 2));
  process.exit(0);
}

const baseUrl = String(process.env.ODOO_BASE_URL || "").replace(/\/+$/, "");
const apiKey = process.env.ODOO_API_KEY;
const database = process.env.ODOO_DATABASE;
if (!baseUrl || !apiKey) throw new Error("Missing Odoo CRM UI configuration.");

async function call(model, method, body) {
  const headers = {
    Accept: "application/json",
    Authorization: `bearer ${apiKey}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "Helmonic-Tender-Intelligence/1.0",
  };
  if (database) headers["X-Odoo-Database"] = database;
  const response = await fetch(`${baseUrl}/json/2/${encodeURIComponent(model)}/${encodeURIComponent(method)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Odoo ${model}.${method} failed with ${response.status}: ${(await response.text()).slice(0, 1_000)}`);
  }
  return response.json();
}

function createdId(value) {
  if (Number.isInteger(value) && value > 0) return value;
  if (Array.isArray(value) && Number.isInteger(value[0]) && value[0] > 0) return value[0];
  throw new Error("Odoo create returned no usable record ID.");
}

const modelRows = await call("ir.model", "search_read", {
  domain: [["model", "=", "crm.lead"]],
  fields: ["id", "model", "name"],
  limit: 2,
});
if (modelRows.length !== 1) throw new Error("Could not resolve the crm.lead model exactly once.");
const leadModelId = modelRows[0].id;

// Build the live schema from the same authoritative contract used by the
// preflight and synchronizer. The former partial list worked only on the test
// database because it silently relied on fields that Studio had created there.
// Selection fields are expected to be owned by Odoo Studio so their business
// choices are never invented or overwritten by this deployment routine.
const studioOwnedFieldNames = new Set(["x_studio_project_sector"]);
const customFields = [
  ...ODOO_TENDER_FIELD_CONTRACT
    .filter((field) => !studioOwnedFieldNames.has(field.name))
    .map((field) => ({
      name: field.name,
      field_description: field.label,
      ttype: field.type,
    })),
  // This legacy Studio field is read only. Creating an empty compatible field
  // on databases that do not already have it keeps normalization safe without
  // generating or overwriting a human CRM reference.
  { name: "x_studio_reference", field_description: "Lead Reference", ttype: "char" },
];
const fieldNames = [
  ...customFields.map((field) => field.name),
  ...studioOwnedFieldNames,
];
const existingFields = await call("ir.model.fields", "search_read", {
  domain: [["model_id", "=", leadModelId], ["name", "in", fieldNames]],
  fields: ["id", "name", "field_description", "ttype", "state"],
  limit: 100,
});
const fieldByName = new Map(existingFields.map((field) => [field.name, field]));
const fieldsCreated = [];
const fieldsUpdated = [];

for (const field of customFields) {
  const existing = fieldByName.get(field.name);
  if (!existing) {
    const id = createdId(await call("ir.model.fields", "create", {
      vals_list: [{
        model_id: leadModelId,
        model: "crm.lead",
        name: field.name,
        field_description: field.field_description,
        ttype: field.ttype,
        state: "manual",
      }],
    }));
    fieldsCreated.push({ id, name: field.name });
    continue;
  }
  if (existing.ttype !== field.ttype) {
    throw new Error(`${field.name} exists with type ${existing.ttype}, expected ${field.ttype}.`);
  }
  if (existing.field_description !== field.field_description) {
    await call("ir.model.fields", "write", {
      ids: [existing.id],
      vals: { field_description: field.field_description },
    });
    fieldsUpdated.push({ id: existing.id, name: field.name });
  }
}

for (const studioOwnedFieldName of studioOwnedFieldNames) {
  const studioOwnedField = fieldByName.get(studioOwnedFieldName);
  if (!studioOwnedField) {
    throw new Error(`Required Odoo Studio field ${studioOwnedFieldName} was not found; no selection choices were invented.`);
  }
  const expected = ODOO_TENDER_FIELD_CONTRACT.find((field) => field.name === studioOwnedFieldName);
  if (!expected || studioOwnedField.ttype !== expected.type) {
    throw new Error(`${studioOwnedFieldName} exists with type ${studioOwnedField.ttype}, expected ${expected?.type ?? "unknown"}.`);
  }
}

const baseViewRows = await call("ir.model.data", "search_read", {
  domain: [["module", "=", "crm"], ["name", "=", "crm_lead_view_form"]],
  fields: ["id", "res_id"],
  limit: 2,
});
if (baseViewRows.length !== 1 || !Number.isInteger(baseViewRows[0].res_id)) {
  throw new Error("Could not resolve the standard CRM lead form view.");
}

const kanbanModelRows = await call("ir.model.data", "search_read", {
  domain: [["module", "=", "crm"], ["name", "=", "crm_case_kanban_view_leads"]],
  fields: ["id", "name", "res_id"],
  limit: 2,
});
if (kanbanModelRows.length !== 1 || !Number.isInteger(kanbanModelRows[0].res_id)) {
  throw new Error("Could not resolve the standard CRM pipeline kanban view.");
}

const leadListModelRows = await call("ir.model.data", "search_read", {
  domain: [["module", "=", "crm"], ["name", "=", "crm_case_tree_view_leads"]],
  fields: ["id", "name", "res_id"],
  limit: 2,
});
if (leadListModelRows.length !== 1 || !Number.isInteger(leadListModelRows[0].res_id)) {
  throw new Error("Could not resolve the standard CRM Leads list view exactly once.");
}

const leadSearchModelRows = await call("ir.model.data", "search_read", {
  domain: [["module", "=", "crm"], ["name", "=", "view_crm_case_leads_filter"]],
  fields: ["id", "name", "res_id"],
  limit: 2,
});
if (leadSearchModelRows.length !== 1 || !Number.isInteger(leadSearchModelRows[0].res_id)) {
  throw new Error("Could not resolve the standard CRM Leads search view exactly once.");
}

const viewName = "Helmonic Tender Intelligence CRM lead form";
const viewArchitecture = `<data>
  <xpath expr="//notebook" position="inside">
    <page string="RFI Intelligence" name="helmonic_tender_intelligence" invisible="not x_helmonic_external_id">
      <group>
        <group string="RFI review">
          <field name="x_lead_panel" string="RFI Type" readonly="1"/>
          <field name="x_rfi_received_at" string="RFI Received / Detected" readonly="1"/>
          <field name="x_rfi_response_due_at" string="RFI Response Due" readonly="1"/>
          <field name="x_deadline_urgency" readonly="1"/>
          <field name="x_lead_quality" readonly="1"/>
          <field name="x_project_link" widget="url" readonly="1"/>
        </group>
        <group string="Consultant and relationship">
          <field name="user_id" string="Assigned Consultant"/>
          <field name="x_assigned_person" string="Suggested Consultant" readonly="1"/>
          <field name="x_warm_connection_verified" string="Relationship Matched" readonly="1"/>
          <field name="x_routing_reason" readonly="1"/>
          <field name="x_relationship_summary" string="Relationship Summary" readonly="1"/>
          <field name="x_project_history_summary" string="Previous iAcoustics Projects" readonly="1"/>
        </group>
      </group>
      <group string="Source evidence">
        <field name="x_source_systems" string="Source" readonly="1"/>
        <field name="x_source_reference" readonly="1"/>
        <field name="x_evidence_excerpt" readonly="1"/>
        <field name="x_evidence_document_urls" readonly="1"/>
      </group>
    </page>
  </xpath>
</data>`;

const existingViews = await call("ir.ui.view", "search_read", {
  domain: [["name", "=", viewName], ["model", "=", "crm.lead"]],
  fields: ["id", "name", "inherit_id", "arch_db", "active"],
  limit: 2,
});
let viewAction;
let viewId;
const viewValues = {
  name: viewName,
  type: "form",
  model: "crm.lead",
  mode: "extension",
  inherit_id: baseViewRows[0].res_id,
  priority: 99,
  active: true,
  arch_db: viewArchitecture,
};
if (existingViews.length === 1) {
  viewId = existingViews[0].id;
  await call("ir.ui.view", "write", { ids: [viewId], vals: viewValues });
  viewAction = "updated";
} else if (existingViews.length === 0) {
  viewId = createdId(await call("ir.ui.view", "create", { vals_list: [viewValues] }));
  viewAction = "created";
} else {
  throw new Error("More than one Helmonic CRM view configuration exists.");
}

const kanbanOrderViewName = "Helmonic Tender Intelligence CRM pipeline ordering";
const existingKanbanOrderViews = await call("ir.ui.view", "search_read", {
  domain: [["name", "=", kanbanOrderViewName], ["model", "=", "crm.lead"]],
  fields: ["id", "name", "inherit_id", "arch_db", "active"],
  limit: 2,
});
const kanbanOrderValues = {
  name: kanbanOrderViewName,
  type: "kanban",
  model: "crm.lead",
  mode: "extension",
  inherit_id: kanbanModelRows[0].res_id,
  priority: 100,
  active: false,
  arch_db: `<data><xpath expr="//kanban" position="attributes"><attribute name="default_order">x_pipeline_priority_rank desc, x_rfi_response_due_at asc, x_rfi_received_at desc, x_rfi_published_at desc, x_project_value desc, x_source_updated_at desc, priority desc, id desc</attribute></xpath></data>`,
};
let kanbanOrderViewId;
let kanbanOrderAction;
if (existingKanbanOrderViews.length === 1) {
  kanbanOrderViewId = existingKanbanOrderViews[0].id;
  await call("ir.ui.view", "write", { ids: [kanbanOrderViewId], vals: kanbanOrderValues });
  kanbanOrderAction = "updated";
} else if (existingKanbanOrderViews.length === 0) {
  kanbanOrderViewId = createdId(await call("ir.ui.view", "create", { vals_list: [kanbanOrderValues] }));
  kanbanOrderAction = "created";
} else {
  throw new Error("More than one Helmonic CRM pipeline-ordering view exists.");
}

const leadListOrderViewName = "Helmonic Tender Intelligence CRM Leads ordering";
const existingLeadListOrderViews = await call("ir.ui.view", "search_read", {
  domain: [["name", "=", leadListOrderViewName], ["model", "=", "crm.lead"]],
  fields: ["id", "name", "inherit_id", "arch_db", "active"],
  limit: 2,
});
const leadListOrderValues = {
  name: leadListOrderViewName,
  type: "list",
  model: "crm.lead",
  mode: "extension",
  inherit_id: leadListModelRows[0].res_id,
  priority: 100,
  active: false,
  arch_db: `<data>
    <xpath expr="//list" position="attributes">
      <attribute name="default_order">x_pipeline_priority_rank desc, x_rfi_response_due_at asc, x_rfi_received_at desc, x_rfi_published_at desc, x_project_value desc, x_source_updated_at desc, priority desc, id desc</attribute>
    </xpath>
    <xpath expr="//field[@name='user_id']" position="attributes">
      <attribute name="string">Acoustic Consultant</attribute>
      <attribute name="optional">show</attribute>
    </xpath>
    <xpath expr="//field[@name='contact_name']" position="attributes">
      <attribute name="optional">hide</attribute>
    </xpath>
    <xpath expr="//field[@name='email_from']" position="attributes">
      <attribute name="optional">hide</attribute>
    </xpath>
    <xpath expr="//field[@name='team_id']" position="attributes">
      <attribute name="optional">hide</attribute>
    </xpath>
    <xpath expr="//field[@name='source_id']" position="attributes">
      <attribute name="optional">hide</attribute>
    </xpath>
    <xpath expr="//field[@name='email_from']" position="after">
      <field name="x_source_systems" string="Source" optional="hide"/>
      <field name="x_source_reference" string="Source Reference" optional="hide"/>
      <field name="x_lead_panel" string="RFI Type" optional="show"/>
      <field name="x_lead_quality" string="Lead Quality" optional="hide"/>
      <field name="x_project_stage" string="Project Stage" widget="badge" optional="hide"
        decoration-info="x_project_stage in ['Plans Applied', 'PLANS APPLIED', 'New Application', 'NEW APPLICATION', 'Validated', 'VALIDATED', 'Tender', 'TENDER', 'Quotation', 'QUOTATION']"
        decoration-success="x_project_stage in ['Plans Granted', 'PLANS GRANTED', 'Permission Granted', 'PERMISSION GRANTED', 'Grant Permission with Conditions', 'GRANT PERMISSION WITH CONDITIONS', 'Conditional', 'CONDITIONAL']"
        decoration-warning="x_project_stage in ['Commencement', 'COMMENCEMENT', 'Construction', 'CONSTRUCTION', 'On Site', 'ON SITE']"
        decoration-muted="x_project_stage in ['Refused', 'REFUSED', 'Withdrawn', 'WITHDRAWN', 'Invalidated', 'INVALIDATED', 'Completed', 'COMPLETED', 'Closed', 'CLOSED']"/>
      <field name="x_rfi_response_due_at" string="RFI Response Due" optional="show"/>
      <field name="x_rfi_received_at" string="RFI Received / Detected" optional="show"/>
      <field name="x_decision_due_at" string="Planning Decision Due" optional="hide"/>
      <field name="x_warm_connection_verified" string="Warm Relationship" optional="show"/>
      <field name="x_assigned_person" string="Suggested Consultant" optional="show"/>
      <field name="x_project_value" string="Project Value" optional="hide"/>
      <field name="x_project_link" string="Project Link" widget="url" optional="hide"/>
      <field name="x_rfi_published_at" string="RFI Published" optional="hide"/>
      <field name="x_rfi_response_received_at" string="FI Response Received" optional="hide"/>
      <field name="x_planning_received_at" string="Planning Received" optional="hide"/>
      <field name="x_planning_validated_at" string="Planning Validated" optional="hide"/>
      <field name="x_pipeline_priority_reason" string="Priority Reason" optional="hide"/>
    </xpath>
  </data>`,
};
let leadListOrderViewId;
let leadListOrderAction;
if (existingLeadListOrderViews.length === 1) {
  leadListOrderViewId = existingLeadListOrderViews[0].id;
  await call("ir.ui.view", "write", { ids: [leadListOrderViewId], vals: leadListOrderValues });
  leadListOrderAction = "updated";
} else if (existingLeadListOrderViews.length === 0) {
  leadListOrderViewId = createdId(await call("ir.ui.view", "create", { vals_list: [leadListOrderValues] }));
  leadListOrderAction = "created";
} else {
  throw new Error("More than one Helmonic CRM Leads-ordering view exists.");
}

const leadSearchViewName = "Helmonic Tender Intelligence CRM Leads target filters";
const existingLeadSearchViews = await call("ir.ui.view", "search_read", {
  domain: [["name", "=", leadSearchViewName], ["model", "=", "crm.lead"]],
  fields: ["id", "name", "inherit_id", "arch_db", "active"],
  limit: 2,
});
const leadSearchValues = {
  name: leadSearchViewName,
  type: "search",
  model: "crm.lead",
  mode: "extension",
  inherit_id: leadSearchModelRows[0].res_id,
  priority: 100,
  active: true,
  arch_db: `<data>
    <xpath expr="//search" position="inside">
      <separator/>
      <filter name="helmonic_primary_targets" string="Primary Acoustic Targets" domain="[('active', '=', True), ('x_project_link', '!=', False), ('x_lead_panel', 'in', ['Urgent Acoustic RFI', 'Granted with Acoustic Conditions'])]"/>
      <filter name="helmonic_live_rfis" string="Live RFI Work Queue" domain="[('active', '=', True), ('x_helmonic_external_id', '!=', False), ('x_classification', 'in', ['noise-related-rfi', 'further-information-request'])]"/>
      <filter name="helmonic_live_acoustic_rfis" string="Acoustic RFIs" domain="[('active', '=', True), ('x_helmonic_external_id', '!=', False), ('x_classification', '=', 'noise-related-rfi')]"/>
      <filter name="helmonic_warm_rfis" string="Relationship Matched" domain="[('active', '=', True), ('x_helmonic_external_id', '!=', False), ('x_classification', 'in', ['noise-related-rfi', 'further-information-request']), ('x_warm_connection_verified', '=', True)]"/>
      <filter name="helmonic_unassigned_rfis" string="Needs Assignment" domain="[('active', '=', True), ('x_helmonic_external_id', '!=', False), ('x_classification', 'in', ['noise-related-rfi', 'further-information-request']), ('user_id', '=', False)]"/>
      <filter name="helmonic_my_rfis" string="My RFI Assignments" domain="[('active', '=', True), ('x_helmonic_external_id', '!=', False), ('x_classification', 'in', ['noise-related-rfi', 'further-information-request']), ('user_id', '=', uid)]"/>
      <filter name="helmonic_granted_acoustic_conditions" string="Granted — Acoustic Conditions" domain="[('x_lead_panel', '=', 'Granted with Acoustic Conditions')]"/>
      <filter name="helmonic_education_bim" string="Education / BIM Opportunities" domain="[('tag_ids.name', '=', 'Education / BIM Opportunities')]"/>
      <filter name="helmonic_secondary_potential" string="Secondary / Potential" domain="[('x_lead_panel', 'in', ['Confirmed Acoustic Opportunity', 'Potential Acoustic Fit'])]"/>
      <filter name="helmonic_reengagement" string="Expired / Re-engagement" domain="[('x_lead_panel', '=', 'Competitive / Re-engagement')]"/>
      <group>
        <filter name="helmonic_group_by_review_panel" string="Lead Review Panel" context="{'group_by': 'x_lead_panel'}"/>
        <filter name="helmonic_group_by_classification" string="Classification" context="{'group_by': 'x_classification'}"/>
      </group>
    </xpath>
  </data>`,
};
let leadSearchViewId;
let leadSearchAction;
if (existingLeadSearchViews.length === 1) {
  leadSearchViewId = existingLeadSearchViews[0].id;
  await call("ir.ui.view", "write", { ids: [leadSearchViewId], vals: leadSearchValues });
  leadSearchAction = "updated";
} else if (existingLeadSearchViews.length === 0) {
  leadSearchViewId = createdId(await call("ir.ui.view", "create", { vals_list: [leadSearchValues] }));
  leadSearchAction = "created";
} else {
  throw new Error("More than one Helmonic CRM Leads target-filter view exists.");
}

const leadActions = await call("ir.actions.act_window", "search_read", {
  domain: [["res_model", "=", "crm.lead"], ["name", "=", "Leads"]],
  fields: ["id", "name", "domain", "context"],
  limit: 20,
});
const targetLeadActions = leadActions.filter((action) => String(action.domain ?? "").includes("'type', '=', 'lead'")
  || String(action.domain ?? "").includes('"type", "=", "lead"')
  || String(action.domain ?? "").includes("type") && String(action.domain ?? "").includes("lead"));
const defaultFilterActions = [];
for (const action of targetLeadActions) {
  const filterName = "Helmonic Live RFI Queue";
  const legacyFilterName = "Helmonic Active Lead Queue";
  const olderLegacyFilterName = "Helmonic Primary Acoustic Targets";
  const existingFilters = await call("ir.filters", "search_read", {
    domain: ["|", "|", ["name", "=", filterName], ["name", "=", legacyFilterName], ["name", "=", olderLegacyFilterName], ["model_id", "=", "crm.lead"], ["action_id", "=", action.id]],
    fields: ["id", "name", "domain", "context", "sort", "is_default", "action_id"],
    limit: 2,
  });
  const filterValues = {
    name: filterName,
    model_id: "crm.lead",
    domain: JSON.stringify([
      ["active", "=", true],
      ["x_helmonic_external_id", "!=", false],
      ["x_classification", "in", ["noise-related-rfi", "further-information-request"]],
    ]),
    context: JSON.stringify({}),
    sort: JSON.stringify(["x_pipeline_priority_rank desc", "x_rfi_response_due_at asc"]),
    is_default: false,
    action_id: action.id,
  };
  if (existingFilters.length === 1) {
    await call("ir.filters", "write", { ids: [existingFilters[0].id], vals: filterValues });
    defaultFilterActions.push({ actionId: action.id, filterId: existingFilters[0].id, action: "updated" });
  } else if (existingFilters.length === 0) {
    const filterId = createdId(await call("ir.filters", "create", { vals_list: [filterValues] }));
    defaultFilterActions.push({ actionId: action.id, filterId, action: "created" });
  } else {
    throw new Error(`More than one Helmonic primary-target filter exists for Leads action ${action.id}.`);
  }
}

const verificationFields = await call("crm.lead", "fields_get", {
  allfields: fieldNames,
  attributes: ["string", "type"],
});
const missingFields = fieldNames.filter((name) => !verificationFields[name]);
if (missingFields.length) throw new Error(`Configured CRM fields are still missing: ${missingFields.join(", ")}`);

console.log(JSON.stringify({
  status: "completed",
  modelId: leadModelId,
  fieldsCreated,
  fieldsUpdated,
  view: { id: viewId, action: viewAction, name: viewName },
  kanbanOrderView: { id: kanbanOrderViewId, action: kanbanOrderAction, name: kanbanOrderViewName },
  leadListOrderView: { id: leadListOrderViewId, action: leadListOrderAction, name: leadListOrderViewName },
  leadSearchView: { id: leadSearchViewId, action: leadSearchAction, name: leadSearchViewName },
  defaultFilterActions,
  verifiedFields: Object.fromEntries(fieldNames.map((name) => [name, verificationFields[name]])),
}, null, 2));
