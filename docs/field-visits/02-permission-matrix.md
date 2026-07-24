# Permission Matrix

## Roles
- `field_ret`: Field Retail
- `field_dist`: Field Distributor

## Matrix
| Action | field_ret | field_dist | admin |
|---|---|---|---|
| Read Visits | Own | Own | All |
| Create Visit | Retail Leads | Dist Leads | None |
| Update Visit | Own (Same Day) | Own (Same Day)| All |
| Delete Visit | None | None | None |
