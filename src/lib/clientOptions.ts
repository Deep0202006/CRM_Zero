export interface CanonicalClientOption {
  value: string;
  label: string;
  searchText?: string;
}

export interface ClientDirectoryEntry {
  username: string;
  name?: string;
}

export const MAPPING_BUSINESS_VALUE_MAX_LENGTH = 250;

export function buildCanonicalClientOptions(entries: ClientDirectoryEntry[]): CanonicalClientOption[] {
  return entries
    .map((entry) => ({
      value: `EXCEL::${entry.username}::${entry.name || entry.username}`,
      label: `${entry.name || entry.username} (@${entry.username})`,
      searchText: `${entry.username} ${entry.name || ""}`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function resolveClientOptionInput(
  input: string,
  options: CanonicalClientOption[],
): { displayValue: string; leadId: string | null } {
  const trimmed = input.trim();
  const selected = options.find((option) => option.value === trimmed);
  const displayValue = (selected?.label ?? trimmed).trim();
  if (!displayValue || displayValue.length > MAPPING_BUSINESS_VALUE_MAX_LENGTH) {
    throw new Error(`Business value must be between 1 and ${MAPPING_BUSINESS_VALUE_MAX_LENGTH} characters.`);
  }
  const selectedValue = selected?.value ?? "";
  const leadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedValue)
    ? selectedValue
    : null;
  return { displayValue, leadId };
}
