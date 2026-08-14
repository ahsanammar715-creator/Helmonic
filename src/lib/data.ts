export type WorkspaceKey = "consult" | "build" | "logistics" | "growth";

export const workspaces: { key: WorkspaceKey; label: string; badge?: string; href: string }[] = [
  { key: "consult", label: "Consult", badge: "iA", href: "/consult" },
  { key: "build", label: "Build", badge: "SS", href: "/build" },
  { key: "logistics", label: "Logistics", href: "/logistics" },
  { key: "growth", label: "Growth", href: "/growth/marketing" },
];

export const recentThreads = [
  "Level 2 boardroom – Rw check",
  "Plant deck NR limits",
];

export const founder = { name: "Jim Dunne", role: "Founder" };

export const sourcesCited = [
  {
    title: "AS/NZS 2107:2016",
    meta: "Table 1 · p. 11",
    body: "Recommended design sound levels and reverberation times for building interiors.",
  },
  {
    title: "Smart Studio SS-W12",
    meta: "Detail sheet · rev C",
    body: "Staggered-stud partition, slab-to-slab, 2 × 13 mm board each face.",
  },
];

export const consultQuestions = [
  "Check a criterion against AS/NZS 2107",
  "Draft a Section 4 report",
  "Compare wall systems by Rw and Ctr",
];

export const buildQuestions = [
  "Check the W12 detail against the spec",
  "Raise a build task from a drawing markup",
  "Estimate cost for W12 revision C",
];

export const siteTypes = [
  "Commercial fit-out",
  "Residential refurb",
  "Education",
  "Healthcare",
  "Industrial",
  "Other",
];

export const surveyTypes = [
  { label: "Airborne DnT,w", sub: "D" },
  { label: "Impact LnT,w", sub: "L" },
  { label: "Ambient NR", sub: "" },
  { label: "Reverberation T60", sub: "" },
];

export const parsedRows = [
  { pos: "P1 · source room", f63: "78.4", f125: "74.1", f500: "69.8", f2k: "64.2", dntw: "–" },
  { pos: "P2 · receiving, centre", f63: "52.1", f125: "44.6", f500: "31.2", f2k: "26.8", dntw: "46" },
  { pos: "P3 · receiving, corner", f63: "53.8", f125: "45.9", f500: "32.6", f2k: "27.4", dntw: "45" },
];

export const whatThisCreates = [
  {
    title: "A project container",
    body: "Thread, sources and reports for this job stay together and appear in the project register.",
  },
  {
    title: "A criteria set",
    body: "Standard or client criteria, cited clause by clause, editable later.",
  },
  {
    title: "A parsed data set",
    body: "Positions, one-third octave bands and calibration checks read from your exports.",
  },
  {
    title: "A report you can draft",
    body: "Section 4 compliance draft, built from the data and the brief, for you to edit.",
  },
];

export const roomUseOptions = ["Post-Production Rooms", "Music Studio", "Other"];
export const roomSubtypes = [
  "Dolby HE Spec Room (Meet Certification Requirements)",
  "Dolby ATMOS Theatre (Extra Large)",
  "VO/ADR Booth, 2 Person",
  "Foley Room",
  "Dubbing Studio Dolby Feature Film",
];
export const floorAreas = ["4.32 m²", "9.60 m²", "16.8 m²", "24.0 m²", "32.4 m²", "41.2 m²", "51.5 m²"];
export const extraRooms = ["One", "Two", "Three"];

export const bomLines = [
  { item: "Stud, 92 mm", qty: "148", unit: "lin m" },
  { item: "Plasterboard 16 mm", qty: "96", unit: "sheet" },
  { item: "Mineral wool 75 mm", qty: "62", unit: "m²" },
  { item: "Isolation hanger", qty: "36", unit: "ea" },
];

export const costBreakdown = [
  { label: "Materials", amountEur: 18400 },
  { label: "Labour, indicative", amountEur: 6500 },
  { label: "Isolation hardware", amountEur: 2000 },
];
export const indicativeCostEur = 26900;

export const logisticsPrompts = [
  "Estimate the travel and accommodation cost for four installers travelling from Dublin to Berlin for eight nights.",
  "Plan a two-day acoustic survey in London for two consultants.",
];

export const logisticsMissingQuestions = [
  "What are the installation dates?",
  "Is the site address confirmed?",
  "Are individual rooms required?",
  "Will the team carry tools?",
];

export const logisticsScenarios = [
  {
    name: "Scenario A · Recommended",
    detail: "Flights + hotel + daily taxis",
    total: "€14 880",
    perTraveller: "€3 720",
    perDay: "€2 126",
    duration: "2.5 h door-to-door",
    cancellation: "Flexible",
  },
  {
    name: "Scenario B",
    detail: "Flights + serviced apartment + hired van",
    total: "€16 240",
    perTraveller: "€4 060",
    perDay: "€2 320",
    duration: "2.5 h door-to-door",
    cancellation: "Non-refundable fare",
  },
  {
    name: "Scenario C",
    detail: "Ferry + company vehicle + shared accommodation",
    total: "€12 960",
    perTraveller: "€3 240",
    perDay: "€1 851",
    duration: "9.5 h door-to-door",
    cancellation: "Fully flexible",
  },
];

export type EngagementStatus = "Scheduled" | "Awaiting dates" | "Planning";

export const iAcousticsEngagements: {
  name: string;
  client: string;
  city: string;
  dates: string;
  status: EngagementStatus;
}[] = [
  {
    name: "Manchester listening room survey",
    client: "Northbank Studios",
    city: "Manchester",
    dates: "02 to 05 Oct",
    status: "Scheduled",
  },
  {
    name: "Berlin boardroom acoustic sign-off",
    client: "Harrow Property Group",
    city: "Berlin",
    dates: "22 Sep",
    status: "Awaiting dates",
  },
  {
    name: "Cork mastering suite verification",
    client: "Independent",
    city: "Cork",
    dates: "30 Sep",
    status: "Planning",
  },
];

export type TravelPlanStatus = "Awaiting approval" | "Recheck required" | "Booked" | "Approved";

export const iAcousticsTravelPlans: {
  engagement: string;
  note: string;
  when: string;
  cost: string;
  status: TravelPlanStatus;
}[] = [
  {
    engagement: "Manchester listening room survey",
    note: "Consultant site visit · Scenario B",
    when: "20 min ago",
    cost: "€1 140",
    status: "Awaiting approval",
  },
  {
    engagement: "Cork mastering suite verification",
    note: "Measurement visit",
    when: "Yesterday",
    cost: "€480",
    status: "Recheck required",
  },
  {
    engagement: "Galway mix room training",
    note: "Handover visit",
    when: "1 week ago",
    cost: "€620",
    status: "Booked",
  },
  {
    engagement: "Dublin office measurement",
    note: "Local site visit",
    when: "2 weeks ago",
    cost: "€90",
    status: "Approved",
  },
];

export const marketingSuggestions = [
  "Make the opening less promotional.",
  "Keep the measured result.",
  "Shorten it for LinkedIn.",
  "Turn this into a case study.",
];

export const draftVersions = [
  { version: "v3 · current", note: "Shortened for LinkedIn, client name removed" },
  { version: "v2", note: "Added measured Rw result with citation" },
  { version: "v1", note: "First draft from the project record" },
];

export const leadFunnel = [
  { label: "Discovered", value: 146 },
  { label: "Industry relevant", value: 72 },
  { label: "Financially credible", value: 41 },
  { label: "Active signals", value: 26 },
  { label: "Qualified", value: 17 },
  { label: "Priority targets", value: 15 },
];

export const priorityLeads = [
  {
    rank: "01",
    name: "Example Post GmbH",
    city: "Berlin",
    sector: "Audio Post Production",
    fit: 92,
    intent: 88,
    capacity: "Very High",
    confidence: "High",
    revenue: "€84m",
    employees: "310 ↑",
    signals: ["Dolby Atmos facility", "Workforce expanding", "New Berlin office"],
    economicBuyer: "CFO",
    technicalBuyer: "Technical Director",
    analysis:
      "Strong near-term prospect for expansion or upgrade of immersive-audio production facilities.",
  },
  {
    rank: "02",
    name: "Nordklang Studios AG",
    city: "Berlin",
    sector: "Broadcast Production",
    fit: 84,
    intent: 91,
    capacity: "High",
    confidence: "Medium",
    revenue: "Not publicly verified",
    employees: "248 ↑",
    signals: ["27 open positions", "New production department"],
    economicBuyer: "Managing Director",
    technicalBuyer: "Head of Audio",
    analysis: "Strong current opportunity because the company is expanding and hiring.",
  },
  {
    rank: "03",
    name: "Reelframe Media",
    city: "Munich",
    sector: "Film Post-production",
    fit: 94,
    intent: 37,
    capacity: "Very High",
    confidence: "High",
    revenue: "€127m",
    employees: "420",
    signals: ["Three post-production facilities", "Profitable"],
    economicBuyer: "CFO",
    technicalBuyer: "Studio Manager",
    analysis: "Excellent long-term target, but limited evidence of an immediate facility investment.",
  },
];

export const tenderSuggestions = [
  "Scan Irish acoustic consultancy tenders",
  "Find noise and environmental tenders closing in the next 30 days",
  "Show public-sector tenders with strong iAcoustics fit",
  "Find opportunities involving planning, environmental noise or building acoustics",
];

export const tenderScanSteps = [
  "Searching approved tender sources",
  "Checking acoustic and environmental relevance",
  "Reading eligibility requirements",
  "Reviewing deadlines and scope",
  "Ranking opportunities",
];

export const tenderFunnel = [
  { label: "Notices scanned", value: 58 },
  { label: "Acoustic/environmental relevant", value: 19 },
  { label: "Eligible for iAcoustics", value: 11 },
  { label: "Strong fit", value: 6 },
];

export type TenderStatus = "New" | "Review" | "Shortlisted" | "Not pursuing";
export type TenderFitBand = "High" | "Medium" | "Low";
export type TenderSourceSystem = "eTenders" | "eTenders / TED" | "OPW" | "Local Authority" | "Direct";

export const tenders: {
  id: string;
  title: string;
  buyer: string;
  category: string;
  location: string;
  deadline: string;
  sourceSystem: TenderSourceSystem;
  fitScore: number;
  fitBand: TenderFitBand;
  status: TenderStatus;
  scope: string;
  whyItFits: string[];
  mandatoryRequirements: string[];
  keyDates: { label: string; date: string }[];
  risks: string[];
  source: { name: string; meta: string; note: string };
  analysis: string;
}[] = [
  {
    id: "T-2026-014",
    title: "Environmental Noise Impact Assessment – N7 Corridor Upgrade",
    buyer: "Transport Infrastructure Ireland",
    category: "Environmental noise",
    location: "Kildare",
    deadline: "18 Sep 2026",
    sourceSystem: "eTenders / TED",
    fitScore: 91,
    fitBand: "High",
    status: "New",
    scope:
      "Baseline and predictive noise modelling along a 14 km road corridor, construction-phase monitoring plan, and a mitigation report referencing TII noise guidelines.",
    whyItFits: [
      "Matches iAcoustics' road and infrastructure noise track record",
      "Multi-year monitoring plan suits an ongoing consultancy relationship",
      "Above-threshold contract value justifies the bid effort",
    ],
    mandatoryRequirements: [
      "Member of the Institute of Acoustics or equivalent",
      "Minimum 3 comparable road-scheme noise assessments in the last 5 years",
      "Professional indemnity insurance ≥ €2.5m",
    ],
    keyDates: [
      { label: "Clarifications close", date: "28 Aug 2026" },
      { label: "Submission deadline", date: "18 Sep 2026" },
      { label: "Contract award (indicative)", date: "Nov 2026" },
    ],
    risks: [
      "Construction-phase monitoring implies a multi-year commitment, not a single report.",
      "Corridor spans two local authority areas – confirm which noise policy applies.",
    ],
    source: {
      name: "eTenders notice 2026/TII/0447",
      meta: "Published 4 Aug 2026",
      note: "Open procedure, above EU threshold. Full tender pack available on eTenders.",
    },
    analysis:
      "Strong fit: directly matches iAcoustics' road and infrastructure noise track record. The multi-year monitoring scope should be resourced before pursuing, not assumed as a one-off report.",
  },
  {
    id: "T-2026-021",
    title: "Acoustic Design Consultancy – Cork City Library Refurbishment",
    buyer: "Cork City Council",
    category: "Building acoustics",
    location: "Cork",
    deadline: "5 Oct 2026",
    sourceSystem: "Local Authority",
    fitScore: 84,
    fitBand: "High",
    status: "Review",
    scope:
      "Room acoustics and sound insulation design for a public library refurbishment, including reading rooms, a public event space and mechanical plant noise control.",
    whyItFits: [
      "Direct room-acoustics and sound insulation design scope",
      "Public-building acoustic design experience already held",
      "High-visibility civic reference project",
    ],
    mandatoryRequirements: [
      "RIAI or equivalent design-team registration to tender as sub-consultant",
      "Evidence of at least 2 completed public-building acoustic designs",
    ],
    keyDates: [
      { label: "Site visit (optional)", date: "22 Aug 2026" },
      { label: "Submission deadline", date: "5 Oct 2026" },
    ],
    risks: [
      "Tender is issued to the lead architect, not directly to acoustic consultants – requires a design-team partnership.",
    ],
    source: {
      name: "eTenders notice 2026/CCC/1188",
      meta: "Published 29 Jul 2026",
      note: "Restricted procedure via the appointed lead architect's design team.",
    },
    analysis:
      "Good technical fit, but iAcoustics cannot submit directly – pursuing this requires first confirming a design-team partnership with the lead architect before a bid is possible.",
  },
  {
    id: "T-2026-009",
    title: "Environmental Noise Monitoring Framework 2026–2029",
    buyer: "Environmental Protection Agency",
    category: "Environmental noise",
    location: "National (Ireland)",
    deadline: "30 Aug 2026",
    sourceSystem: "eTenders / TED",
    fitScore: 76,
    fitBand: "Medium",
    status: "New",
    scope:
      "Multi-supplier framework for ambient and industrial noise monitoring call-off contracts across licensed facilities nationally, drawn down as individual work orders.",
    whyItFits: [
      "National monitoring accreditation already held",
      "Framework place gives durable, multi-year visibility",
      "Aligns with iAcoustics' existing UKAS/INAB methodology",
    ],
    mandatoryRequirements: [
      "UKAS/INAB-accredited measurement methodology",
      "Demonstrated national site coverage or a documented subcontracting plan",
    ],
    keyDates: [
      { label: "Submission deadline", date: "30 Aug 2026" },
      { label: "Framework term", date: "4 years, call-off basis" },
    ],
    risks: [
      "Framework place does not guarantee work volume – call-offs are competed separately.",
      "National coverage requirement may need a subcontracting arrangement outside Dublin/Cork.",
    ],
    source: {
      name: "eTenders notice 2026/EPA/0212",
      meta: "Published 12 Jul 2026",
      note: "Open procedure, multi-supplier framework, above EU threshold.",
    },
    analysis:
      "Fit is real but indirect: a framework place is a route to future work, not a contract in itself. Worth pursuing only if the call-off volume history from the outgoing framework can be checked first.",
  },
  {
    id: "T-2026-033",
    title: "Acoustic & Vibration Assessment – Data Centre Planning Application",
    buyer: "Private developer (via planning consultant)",
    category: "Planning support",
    location: "Dublin",
    deadline: "12 Sep 2026",
    sourceSystem: "Direct",
    fitScore: 68,
    fitBand: "Medium",
    status: "Review",
    scope:
      "Noise and vibration assessment supporting a data centre planning application, including plant noise modelling and a submission to satisfy An Bord Pleanála conditions.",
    whyItFits: [
      "Plant noise modelling matches a core iAcoustics capability",
      "Live private-sector lead, fast-moving",
      "Planning-condition experience is a differentiator versus generalist consultancies",
    ],
    mandatoryRequirements: [
      "Experience with An Bord Pleanála noise conditions for industrial/data centre planning",
    ],
    keyDates: [
      { label: "Proposal deadline", date: "12 Sep 2026" },
      { label: "Planning submission target", date: "Q1 2027" },
    ],
    risks: [
      "Private tender, not on eTenders – terms and payment schedule need direct negotiation.",
    ],
    source: {
      name: "Direct enquiry via planning consultant",
      meta: "Received 6 Aug 2026",
      note: "Private-sector approach, not a public procurement notice.",
    },
    analysis:
      "Reasonable fit and a live private-sector lead, but it arrived outside the normal tender scan – confirm scope and fee expectations directly before treating it as qualified.",
  },
  {
    id: "T-2026-041",
    title: "Sound Insulation Testing – Social Housing Programme, Phase 3",
    buyer: "Galway County Council",
    category: "Building acoustics",
    location: "Galway",
    deadline: "25 Sep 2026",
    sourceSystem: "Local Authority",
    fitScore: 58,
    fitBand: "Low",
    status: "New",
    scope:
      "Pre-completion sound insulation testing across 140 social housing units delivered in four phases, reporting against Part E / Technical Guidance Document E.",
    whyItFits: [
      "Routine ISO 16283 testing, well within existing capability",
      "Steady, predictable volume of work across four phases",
    ],
    mandatoryRequirements: [
      "UKAS-accredited testing to ISO 16283",
      "Availability across four delivery phases over 18 months",
    ],
    keyDates: [{ label: "Submission deadline", date: "25 Sep 2026" }],
    risks: [
      "Volume-testing framework at public-sector rates – margin is thin compared to consultancy work.",
    ],
    source: {
      name: "eTenders notice 2026/GCC/0356",
      meta: "Published 1 Aug 2026",
      note: "Open procedure, below EU threshold.",
    },
    analysis:
      "Within capability but a low strategic fit: routine compliance testing at competitive public rates, with little consultancy upside. Lower priority unless capacity is otherwise idle.",
  },
  {
    id: "T-2026-018",
    title: "Noise Impact Assessment – Windfarm Extension",
    buyer: "Private energy developer",
    category: "Environmental noise",
    location: "Donegal",
    deadline: "9 Sep 2026",
    sourceSystem: "Direct",
    fitScore: 72,
    fitBand: "Medium",
    status: "Not pursuing",
    scope:
      "Environmental noise impact assessment for a 12-turbine windfarm extension, supporting a planning application under the Wind Energy Development Guidelines.",
    whyItFits: [
      "IOA windfarm assessment methodology already in use",
      "Would diversify iAcoustics into renewable-energy noise work",
    ],
    mandatoryRequirements: [
      "Experience with IOA Good Practice Guide windfarm noise assessment",
    ],
    keyDates: [{ label: "Proposal deadline", date: "9 Sep 2026" }],
    risks: [
      "Outside iAcoustics' current geographic service area without a local site presence.",
    ],
    source: {
      name: "Direct enquiry via developer",
      meta: "Received 3 Aug 2026",
      note: "Private-sector approach, not a public procurement notice.",
    },
    analysis:
      "Technically feasible, but travel and site-visit costs from the nearest office make this uneconomic against the private windfarm sector's typical fee levels. Marked not pursuing on that basis.",
  },
  {
    id: "T-2026-027",
    title: "Acoustic Survey – Protected Structure Conservation Works",
    buyer: "Office of Public Works (OPW)",
    category: "Building acoustics",
    location: "Kilkenny",
    deadline: "3 Oct 2026",
    sourceSystem: "OPW",
    fitScore: 79,
    fitBand: "High",
    status: "Shortlisted",
    scope:
      "Pre- and post-works acoustic survey for conservation and adaptive reuse of a protected structure, including sensitivity to historic fabric during any remedial acoustic treatment.",
    whyItFits: [
      "Heritage-sensitive acoustic survey work is a differentiated niche",
      "OPW is a repeat public-sector buyer across multiple sites",
      "No competing design-team dependency – iAcoustics can tender directly",
    ],
    mandatoryRequirements: [
      "Experience surveying protected structures or heritage buildings",
      "Method statement for non-invasive measurement near historic fabric",
    ],
    keyDates: [
      { label: "Site visit (mandatory)", date: "15 Sep 2026" },
      { label: "Submission deadline", date: "3 Oct 2026" },
    ],
    risks: [
      "Mandatory site visit narrows the bidding window – confirm attendance before shortlisting further.",
    ],
    source: {
      name: "eTenders notice 2026/OPW/0761",
      meta: "Published 20 Aug 2026",
      note: "Open procedure, below EU threshold, published via the OPW procurement channel.",
    },
    analysis:
      "Strong, direct fit with a repeat public buyer. Worth prioritising over larger but indirect opportunities given there is no design-team gatekeeper here.",
  },
];

export const planningSuggestions = [
  "Scan Irish planning projects for acoustic RFIs",
  "Find granted projects with noise-related conditions",
  "Show high-value Irish projects with likely acoustic requirements",
  "Find opportunities where an architect has been identified",
];

export const planningScanSteps = [
  "Searching BuildingInfo project records",
  "Checking planning documents for acoustic terminology",
  "Reviewing RFI and condition wording",
  "Identifying applicants, agents and architects",
  "Ranking opportunities",
];

export const planningFunnel = [
  { label: "Projects scanned", value: 340 },
  { label: "Acoustic signal detected", value: 42 },
  { label: "Architect identified", value: 27 },
  { label: "Strong fit", value: 6 },
];

export type PlanningStage =
  | "Plans Applied"
  | "Request for Further Information"
  | "Plans Granted"
  | "Granted with Conditions"
  | "Commencement";
export type PlanningSignalType =
  | "Acoustic RFI"
  | "Noise Condition"
  | "Acoustic Report Required"
  | "Potential Acoustic Requirement";
export type PlanningStatus = "New" | "Review" | "Qualified" | "Not pursuing";
export type PlanningFitBand = "High" | "Medium" | "Low";

export const planningSignals: {
  id: string;
  project: string;
  county: string;
  sector: string;
  stage: PlanningStage;
  value: string;
  signalType: PlanningSignalType;
  fitScore: number;
  fitBand: PlanningFitBand;
  status: PlanningStatus;
  acousticTrigger: string;
  applicant: string;
  planningAgent: string | null;
  architect: string | null;
  mainContractor: string | null;
  otherParties: string[];
  keyDates: { label: string; date: string }[];
  source: { name: string; meta: string; note: string };
  analysis: string;
}[] = [
  {
    id: "P-2026-101",
    project: "Blackrock Health & Wellness Hub",
    county: "Cork",
    sector: "Healthcare",
    stage: "Request for Further Information",
    value: "€6.2m",
    signalType: "Acoustic RFI",
    fitScore: 88,
    fitBand: "High",
    status: "New",
    acousticTrigger:
      "Further information request cites the need for a noise impact assessment addressing plant and ventilation noise on the residential boundary.",
    applicant: "Blackrock Health Developments Ltd",
    planningAgent: "Coakley O'Neill Town Planning",
    architect: "Reddy Architecture + Urbanism",
    mainContractor: null,
    otherParties: ["M&E consultant: Homan O'Brien"],
    keyDates: [
      { label: "RFI issued", date: "14 Aug 2026" },
      { label: "Response due", date: "14 Nov 2026" },
    ],
    source: {
      name: "BuildingInfo project record PL2026/0442",
      meta: "RFI issued 14 Aug 2026",
      note: "Cork City Council further information request; plant/ventilation noise referenced under RFI item 6.",
    },
    analysis:
      "Strong opportunity: the RFI explicitly names a noise impact assessment and the architect is already known, giving a clear point of first contact.",
  },
  {
    id: "P-2026-114",
    project: "Adamstown Mixed-Use Block D",
    county: "Dublin",
    sector: "Residential",
    stage: "Granted with Conditions",
    value: "€18.5m",
    signalType: "Noise Condition",
    fitScore: 82,
    fitBand: "High",
    status: "Review",
    acousticTrigger:
      "Condition 11 requires a noise mitigation report and post-completion sound insulation testing prior to occupation.",
    applicant: "Adamstown SDZ Developments",
    planningAgent: "John Spain Associates",
    architect: "O'Mahony Pike Architects",
    mainContractor: "Sisk",
    otherParties: [],
    keyDates: [
      { label: "Decision granted", date: "2 Aug 2026" },
      { label: "Condition compliance due", date: "Before occupation" },
    ],
    source: {
      name: "BuildingInfo project record PL2026/0398",
      meta: "Grant of permission 2 Aug 2026",
      note: "South Dublin County Council grant; Condition 11 references noise mitigation and pre-completion sound testing.",
    },
    analysis:
      "High-value residential scheme with an explicit testing condition – a near-certain requirement rather than a possibility, and the main contractor is already appointed.",
  },
  {
    id: "P-2026-126",
    project: "Naas Logistics & Distribution Park",
    county: "Kildare",
    sector: "Industrial / Logistics",
    stage: "Request for Further Information",
    value: "€9.8m",
    signalType: "Acoustic RFI",
    fitScore: 64,
    fitBand: "Medium",
    status: "New",
    acousticTrigger:
      "Further information request asks the applicant to address noise from HGV movements and yard operations on nearby residential receptors.",
    applicant: "Naas Logistics Developments Ltd",
    planningAgent: "Tom Phillips + Associates",
    architect: null,
    mainContractor: null,
    otherParties: [],
    keyDates: [
      { label: "RFI issued", date: "22 Aug 2026" },
      { label: "Response due", date: "22 Nov 2026" },
    ],
    source: {
      name: "BuildingInfo project record PL2026/0511",
      meta: "RFI issued 22 Aug 2026",
      note: "Kildare County Council further information request; noise item under RFI section 4.",
    },
    analysis:
      "Real signal but no architect identified yet – first contact is less obvious, and industrial noise scope is more variable than the other RFI cases.",
  },
  {
    id: "P-2026-133",
    project: "Athenry Community School Extension",
    county: "Galway",
    sector: "Education",
    stage: "Plans Granted",
    value: "€4.1m",
    signalType: "Potential Acoustic Requirement",
    fitScore: 55,
    fitBand: "Medium",
    status: "New",
    acousticTrigger:
      "No explicit acoustic condition attached, but the grant covers a school extension – a building type that routinely requires room-acoustic and sound-insulation compliance.",
    applicant: "Galway & Roscommon ETB",
    planningAgent: null,
    architect: "de Blacam and Meagher Architects",
    mainContractor: null,
    otherParties: [],
    keyDates: [{ label: "Decision granted", date: "11 Aug 2026" }],
    source: {
      name: "BuildingInfo project record PL2026/0388",
      meta: "Grant of permission 11 Aug 2026",
      note: "Galway County Council grant. No noise-specific condition text found in the decision order.",
    },
    analysis:
      "Inferred rather than confirmed: school buildings usually need acoustic sign-off under Building Regulations even without a planning condition, but this should be treated as a lead to qualify, not an open requirement.",
  },
  {
    id: "P-2026-140",
    project: "Castletroy Build-to-Rent Phase 2",
    county: "Limerick",
    sector: "Residential",
    stage: "Commencement",
    value: "€22.0m",
    signalType: "Noise Condition",
    fitScore: 47,
    fitBand: "Low",
    status: "Not pursuing",
    acousticTrigger:
      "Condition 7 required a noise impact assessment prior to grant; compliance documentation was submitted and closed out ahead of commencement.",
    applicant: "Castletroy BTR Ltd",
    planningAgent: "MKO Planning",
    architect: "Reddy Architecture + Urbanism",
    mainContractor: "John Sisk & Son",
    otherParties: [],
    keyDates: [
      { label: "Condition closed out", date: "30 Jun 2026" },
      { label: "Commencement notice", date: "18 Aug 2026" },
    ],
    source: {
      name: "BuildingInfo project record PL2025/0902",
      meta: "Commencement notice 18 Aug 2026",
      note: "Limerick City & County Council record. Condition 7 compliance already discharged before commencement.",
    },
    analysis:
      "The acoustic requirement already appears to be satisfied by another consultant ahead of commencement – low likelihood of new work here. Marked not pursuing on that basis.",
  },
  {
    id: "P-2026-152",
    project: "Navan Retail & Residential Quarter",
    county: "Meath",
    sector: "Mixed-use",
    stage: "Request for Further Information",
    value: "€31.4m",
    signalType: "Acoustic RFI",
    fitScore: 73,
    fitBand: "Medium",
    status: "Qualified",
    acousticTrigger:
      "Further information request requires a detailed environmental noise report addressing servicing-yard noise and rooftop plant against nearby residential units.",
    applicant: "Navan Quarter Developments",
    planningAgent: "John Spain Associates",
    architect: "Henry J Lyons",
    mainContractor: null,
    otherParties: ["Traffic consultant: AECOM"],
    keyDates: [
      { label: "RFI issued", date: "9 Aug 2026" },
      { label: "Response due", date: "9 Feb 2027" },
    ],
    source: {
      name: "BuildingInfo project record PL2026/0455",
      meta: "RFI issued 9 Aug 2026",
      note: "Meath County Council further information request; environmental noise report required under RFI item 9.",
    },
    analysis:
      "Large mixed-use scheme with an explicit environmental noise report requirement and a known architect – already reviewed and qualified as worth pursuing.",
  },
];
