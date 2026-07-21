export const REQUIRED_TASK_ALLOCATION_HEADERS = [
  "Username", "Name", "Address", "Area", "City", "State", "Mobile", "Email",
  "PSPACode", "Third-Party Code", "Dlic1", "Dlic2", "Dlic3", "Dlic4", "FoodLicense",
] as const;

export const MAX_TASK_ALLOCATION_ROWS = 5000;

export interface NormalizedAllocatedTargetRow {
  rowNumber: number;
  target_username: string;
  target_name: string;
  target_address: string;
  target_area: string;
  city: string;
  target_state: string;
  target_mobile: string;
  target_email: string;
  pspa_code: string;
  third_party_code: string;
  dlic1: string;
  dlic2: string;
  dlic3: string;
  dlic4: string;
  food_license: string;
}

export interface RejectedTaskAllocationRow { rowNumber: number; reason: string; }
export interface ParsedTaskAllocationFile {
  rows: NormalizedAllocatedTargetRow[];
  cities: string[];
  rejectedRows: RejectedTaskAllocationRow[];
}
export type CityAssignmentMap = Record<string, string>;

type CellValue = string | number | boolean | null | undefined;
type SpreadsheetTable = CellValue[][];

const headerAliases: Record<(typeof REQUIRED_TASK_ALLOCATION_HEADERS)[number], string[]> = {
  Username: ["username"], Name: ["name"], Address: ["address"], Area: ["area"], City: ["city"], State: ["state"], Mobile: ["mobile"], Email: ["email"],
  PSPACode: ["pspacode"], "Third-Party Code": ["third party code"], Dlic1: ["dlic1"], Dlic2: ["dlic2"], Dlic3: ["dlic3"], Dlic4: ["dlic4"], FoodLicense: ["foodlicense"],
};

export function normalizeHeader(value: CellValue): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function normalizeCityKey(city: string): string {
  return city.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function text(value: CellValue): string { return String(value ?? "").trim(); }

/** Parses worksheet values (including the header row) without depending on xlsx. */
export function parseTaskAllocationTable(table: SpreadsheetTable): ParsedTaskAllocationFile {
  if (!table.length) throw new Error("The spreadsheet is empty.");
  const headers = table[0].map(normalizeHeader);
  const positions = new Map<string, number>();
  const missing = REQUIRED_TASK_ALLOCATION_HEADERS.filter((required) => {
    const aliases = headerAliases[required];
    const index = headers.findIndex((header) => aliases.includes(header.replace(/ /g, "")) || aliases.includes(header));
    if (index >= 0) positions.set(required, index);
    return index < 0;
  });
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);
  if (table.length - 1 > MAX_TASK_ALLOCATION_ROWS) throw new Error(`Maximum ${MAX_TASK_ALLOCATION_ROWS} data rows allowed.`);

  const rows: NormalizedAllocatedTargetRow[] = [];
  const rejectedRows: RejectedTaskAllocationRow[] = [];
  const cityLabels = new Map<string, string>();
  const value = (row: CellValue[], header: (typeof REQUIRED_TASK_ALLOCATION_HEADERS)[number]) => text(row[positions.get(header)!]);
  table.slice(1).forEach((source, offset) => {
    const rowNumber = offset + 2;
    if (source.every((cell) => text(cell) === "")) return;
    const city = value(source, "City").replace(/\s+/g, " ");
    const row: NormalizedAllocatedTargetRow = {
      rowNumber, target_username: value(source, "Username"), target_name: value(source, "Name"), target_address: value(source, "Address"), target_area: value(source, "Area"), city,
      target_state: value(source, "State"), target_mobile: value(source, "Mobile"), target_email: value(source, "Email"), pspa_code: value(source, "PSPACode"),
      third_party_code: value(source, "Third-Party Code"), dlic1: value(source, "Dlic1"), dlic2: value(source, "Dlic2"), dlic3: value(source, "Dlic3"), dlic4: value(source, "Dlic4"), food_license: value(source, "FoodLicense"),
    };
    const absent = [["Username", row.target_username], ["Name", row.target_name], ["City", row.city], ["Mobile", row.target_mobile]].filter(([, item]) => !item).map(([label]) => label);
    if (absent.length) { rejectedRows.push({ rowNumber, reason: `Missing required value: ${absent.join(", ")}.` }); return; }
    const cityKey = normalizeCityKey(row.city);
    if (!cityLabels.has(cityKey)) cityLabels.set(cityKey, row.city);
    row.city = cityLabels.get(cityKey)!;
    rows.push(row);
  });
  return { rows, rejectedRows, cities: [...cityLabels.values()].sort((a, b) => a.localeCompare(b)) };
}

export function getCityTaskCounts(rows: NormalizedAllocatedTargetRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => { const key = normalizeCityKey(row.city); counts[key] = (counts[key] ?? 0) + 1; return counts; }, {});
}

export function validateCityAssignments(rows: NormalizedAllocatedTargetRow[], assignments: CityAssignmentMap): string | null {
  const known = new Set(rows.map((row) => normalizeCityKey(row.city)));
  const unknown = Object.keys(assignments).map(normalizeCityKey).filter((city) => !known.has(city));
  if (unknown.length) return `Unknown mapped cities: ${unknown.join(", ")}.`;
  const unmapped = [...known].filter((city) => !assignments[city]);
  return unmapped.length ? `Unmapped cities: ${unmapped.join(", ")}.` : null;
}
