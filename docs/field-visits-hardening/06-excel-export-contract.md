# Excel Export Contract

## Requirement
Generate a 4-sheet `.xlsx` file for admins reporting field visits.

## Technical Implementation
- **Route**: `GET /api/admin/visits/export`
- **Library**: `xlsx` (already installed)
- **Data Source**: Secure server-side query joining `field_visits`, `users`, and `leads`.

## Sheets Specification
1. **Summary**: High level metrics (Total Visits, Visits Today, Active Agents).
2. **Visit Register**: Full row-by-row data dump of `field_visits` with readable lead and user names.
3. **Representative Summary**: Aggregation per `user_id` (Total Visits, Unique Leads visited, Latest Visit Date).
4. **Data Dictionary**: Explanation of each column and outcome ENUM.
