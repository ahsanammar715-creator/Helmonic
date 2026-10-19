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

const customFields = [
  { name: "x_pipeline_priority_rank", field_description: "Pipeline Priority Rank", ttype: "integer" },
  { name: "x_pipeline_priority_reason", field_description: "Pipeline Priority Reason", ttype: "char" },
  { name: "x_lead_panel", field_description: "Lead Review Panel", ttype: "char" },
  { name: "x_project_link", field_description: "Project Link", ttype: "char" },
  { name: "x_county", field_description: "County", ttype: "char" },
  { name: "x_source_ledger", field_description: "Source and Deduplication Ledger", ttype: "text" },
  { name: "x_rfi_published_at", field_description: "RFI Published Date", ttype: "datetime" },
  { name: "x_rfi_received_at", field_description: "RFI Received / Detected Date", ttype: "datetime" },
  { name: "x_rfi_response_due_at", field_description: "RFI Response Due Date", ttype: "datetime" },
  { name: "x_rfi_response_received_at", field_description: "Further Information Response Received", ttype: "datetime" },
  { name: "x_rfi_date_source", field_description: "RFI Date Source", ttype: "text" },
  { name: "x_rfi_date_confidence", field_description: "RFI Date Confidence", ttype: "char" },
  { name: "x_planning_received_at", field_description: "Planning Application Received", ttype: "datetime" },
  { name: "x_planning_validated_at", field_description: "Planning Application Validated", ttype: "datetime" },
  { name: "x_decision_due_at", field_description: "Planning Decision Due At", ttype: "datetime" },
  { name: "x_action_days_remaining", field_description: "Action Days Remaining", ttype: "integer" },
  { name: "x_deadline_urgency", field_description: "Deadline Urgency", ttype: "char" },
  { name: "x_rfi_trigger", field_description: "RFI / Acoustic Trigger", ttype: "char" },
  { name: "x_acoustic_appointment_status", field_description: "Acoustic Appointment Status", ttype: "char" },
  { name: "x_appointed_acoustician", field_description: "Appointed Acoustician", ttype: "char" },
  { name: "x_appointment_evidence", field_description: "Appointment Evidence", ttype: "text" },
  { name: "x_appointment_evidence_source_url", field_description: "Appointment Evidence Source", ttype: "text" },
  { name: "x_competitive_quote_opportunity", field_description: "Competitive Quote Opportunity", ttype: "boolean" },
  { name: "x_outreach_eligibility", field_description: "Outreach Eligibility", ttype: "char" },
  { name: "x_outreach_suppression_reason", field_description: "Outreach Safeguard Reason", ttype: "text" },
  { name: "x_outreach_key", field_description: "Outreach Deduplication Key", ttype: "char" },
  { name: "x_buildinginfo_search_profile", field_description: "BuildingInfo Search Profile", ttype: "char" },
];
const fieldNames = [...customFields.map((field) => field.name), "x_assigned_person"];
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

const assignedField = fieldByName.get("x_assigned_person");
if (!assignedField) throw new Error("Existing x_assigned_person field was not found.");
if (assignedField.field_description !== "Assigned Acoustic Consultant") {
  await call("ir.model.fields", "write", {
    ids: [assignedField.id],
    vals: { field_description: "Assigned Acoustic Consultant" },
  });
  fieldsUpdated.push({ id: assignedField.id, name: "x_assigned_person" });
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
  domain: [["module", "=", "crm"], ["name", "in", ["crm_case_kanban_view_leads", "crm_case_kanban_view_oppor"]]],
  fields: ["id", "name", "res_id"],
  limit: 10,
});
const kanbanCandidateIds = kanbanModelRows.map((row) => row.res_id).filter(Number.isInteger);
const kanbanViewRows = kanbanCandidateIds.length ? await call("ir.ui.view", "search_read", {
  domain: [["id", "in", kanbanCandidateIds], ["model", "=", "crm.lead"], ["type", "=", "kanban"]],
  fields: ["id", "name", "type", "active"],
  limit: 10,
}) : [];
if (kanbanViewRows.length !== 1) {
  throw new Error("Could not resolve the standard CRM opportunity kanban view exactly once.");
}

const leadListModelRows = await call("ir.model.data", "search_read", {
  domain: [["module", "=", "crm"], ["name", "=", "crm_case_tree_view_leads"]],
  fields: ["id", "name", "res_id"],
  limit: 2,
});
if (leadListModelRows.length !== 1 || !Number.isInteger(leadListModelRows[0].res_id)) {
  throw new Error("Could not resolve the standard CRM Leads list view exactly once.");
}

const viewName = "Helmonic Tender Intelligence CRM lead form";
const viewArchitecture = `<data>
  <xpath expr="//field[@name='user_id']" position="attributes">
    <attribute name="string">Acoustic Consultant</attribute>
  </xpath>
  <xpath expr="//field[@name='expected_revenue']/ancestor::h2" position="attributes">
    <attribute name="invisible" add="x_helmonic_external_id" separator=" or "/>
  </xpath>
  <xpath expr="//field[@name='probability']" position="attributes">
    <attribute name="invisible" add="x_helmonic_external_id" separator=" or "/>
  </xpath>
  <xpath expr="//field[@name='date_deadline']" position="attributes">
    <attribute name="invisible" add="x_helmonic_external_id" separator=" or "/>
  </xpath>
  <xpath expr="//field[@name='date_deadline']" position="after">
    <field name="x_deadline" string="Action Deadline" invisible="not x_helmonic_external_id"/>
    <field name="x_rfi_published_at" string="RFI Published" invisible="not x_helmonic_external_id"/>
    <field name="x_rfi_received_at" string="RFI Received / Detected" invisible="not x_helmonic_external_id"/>
    <field name="x_rfi_response_due_at" string="RFI Response Due" invisible="not x_helmonic_external_id"/>
    <field name="x_rfi_response_received_at" string="FI Response Received" invisible="not x_helmonic_external_id"/>
    <field name="x_planning_received_at" string="Planning Received" invisible="not x_helmonic_external_id"/>
    <field name="x_planning_validated_at" string="Planning Validated" invisible="not x_helmonic_external_id"/>
    <field name="x_decision_due_at" string="Planning Decision Due" invisible="not x_helmonic_external_id"/>
    <field name="x_lead_quality" string="Lead Quality" invisible="not x_helmonic_external_id"/>
    <field name="x_warm_connection_verified" string="Verified Email Match" invisible="not x_helmonic_external_id"/>
    <field name="x_deadline_urgency" string="Deadline Urgency" invisible="not x_helmonic_external_id"/>
  </xpath>
  <xpath expr="//notebook" position="inside">
    <page string="Lead Intelligence" name="helmonic_tender_intelligence">
      <group>
        <group string="Source and qualification">
          <field name="x_helmonic_external_id"/>
          <field name="x_deduplication_status"/>
          <field name="x_source_record_ids"/>
          <field name="x_source_ledger"/>
          <field name="x_first_seen_at"/>
          <field name="x_last_seen_at"/>
          <field name="x_source_systems"/>
          <field name="x_project_link" widget="url"/>
          <field name="x_project_reference"/>
          <field name="x_county"/>
          <field name="x_project_stage"/>
          <field name="x_classification"/>
          <field name="x_rfi_trigger"/>
          <field name="x_rfi_published_at"/>
          <field name="x_rfi_received_at"/>
          <field name="x_rfi_response_due_at"/>
          <field name="x_rfi_response_received_at"/>
          <field name="x_rfi_date_source"/>
          <field name="x_rfi_date_confidence"/>
          <field name="x_planning_received_at"/>
          <field name="x_planning_validated_at"/>
          <field name="x_decision_due_at"/>
          <field name="x_action_days_remaining"/>
          <field name="x_deadline_urgency"/>
          <field name="x_lead_quality"/>
          <field name="x_pipeline_bucket"/>
          <field name="x_pipeline_priority_rank"/>
          <field name="x_pipeline_priority_reason"/>
          <field name="x_lead_panel"/>
        </group>
        <group string="Consultant and relationship">
          <field name="x_project_value"/>
          <field name="x_location"/>
          <field name="x_assigned_person"/>
          <field name="x_warm_connection_verified"/>
          <field name="x_routing_reason"/>
        </group>
      </group>
      <group string="Appointment and outreach safeguard">
        <group>
          <field name="x_acoustic_appointment_status"/>
          <field name="x_appointed_acoustician"/>
          <field name="x_competitive_quote_opportunity"/>
          <field name="x_outreach_eligibility"/>
          <field name="x_outreach_key"/>
          <field name="x_buildinginfo_search_profile"/>
        </group>
        <group>
          <field name="x_outreach_suppression_reason"/>
          <field name="x_appointment_evidence"/>
          <field name="x_appointment_evidence_source_url"/>
        </group>
      </group>
      <group string="Project parties and evidence">
        <field name="x_party_details"/>
        <field name="x_evidence_status"/>
        <field name="x_evidence_excerpt"/>
        <field name="x_source_urls"/>
        <field name="x_evidence_document_urls"/>
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
  inherit_id: kanbanViewRows[0].id,
  priority: 100,
  active: true,
  arch_db: `<data><xpath expr="//kanban" position="attributes"><attribute name="default_order">x_pipeline_priority_rank desc, x_rfi_response_due_at asc, x_rfi_received_at desc, x_rfi_published_at desc, x_project_value desc, x_source_updated_at desc, x_decision_due_at asc, date_deadline asc, priority desc, id desc</attribute></xpath></data>`,
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
  active: true,
  arch_db: `<data>
    <xpath expr="//list" position="attributes">
      <attribute name="default_order">x_pipeline_priority_rank desc, x_rfi_response_due_at asc, x_rfi_received_at desc, x_rfi_published_at desc, x_project_value desc, x_source_updated_at desc, x_decision_due_at asc, date_deadline asc, priority desc, id desc</attribute>
    </xpath>
    <xpath expr="//field[@name='user_id']" position="attributes">
      <attribute name="string">Acoustic Consultant</attribute>
    </xpath>
    <xpath expr="//field[@name='name']" position="after">
      <field name="x_source_systems" string="Source" optional="show"/>
      <field name="x_project_link" string="Project Link" widget="url" optional="show"/>
      <field name="x_project_stage" string="Project Stage" optional="show"/>
      <field name="x_lead_quality" string="Lead Quality" optional="show"/>
      <field name="x_lead_panel" string="Lead Review Panel" optional="show"/>
      <field name="x_project_value" string="Project Value" optional="show"/>
      <field name="x_rfi_published_at" string="RFI Published" optional="show"/>
      <field name="x_rfi_received_at" string="RFI Received / Detected" optional="show"/>
      <field name="x_rfi_response_due_at" string="RFI Response Due" optional="show"/>
      <field name="x_rfi_response_received_at" string="FI Response Received" optional="show"/>
      <field name="x_planning_received_at" string="Planning Received" optional="show"/>
      <field name="x_planning_validated_at" string="Planning Validated" optional="show"/>
      <field name="x_decision_due_at" string="Planning Decision Due" optional="show"/>
      <field name="x_warm_connection_verified" string="Verified Email Match" optional="show"/>
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
  verifiedFields: Object.fromEntries(fieldNames.map((name) => [name, verificationFields[name]])),
}, null, 2));
