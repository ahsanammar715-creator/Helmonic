export type WorkspaceKey = "consult" | "build" | "logistics" | "socials";

export const workspaces: { key: WorkspaceKey; label: string; badge?: string; href: string }[] = [
  { key: "consult", label: "Consult", badge: "iA", href: "/consult" },
  { key: "build", label: "Build", badge: "SS", href: "/build" },
  { key: "logistics", label: "Logistics", href: "/logistics" },
  { key: "socials", label: "Socials", href: "/socials/marketing" },
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
