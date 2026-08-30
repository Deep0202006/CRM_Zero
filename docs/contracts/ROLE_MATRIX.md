# Business Capability Role Matrix

This matrix records authorization shapes, not display labels. Server authorization and database policy remain authoritative; UI visibility is only a convenience.

| Capability | System Administrator | Assigned active operational employee | Other active operational employee | Inactive/unlinked user |
|---|---|---|---|---|
| Attendance `field_selfie` | Read all eligible staff; no personal write | Write/read own row when field capability applies | Write/read own row when field capability applies | None |
| Attendance `office_auto` | Read all eligible staff; no personal write | Write/read own row when office capability applies | Write/read own row when office capability applies | None |
| Admin Team Attendance / KPI | Read all eligible staff | No Admin reader | No Admin reader | None |
| Distributor Status list/detail | Read all rows | Read assigned rows | No unassigned rows | None |
| Distributor operational mutation | Create/import/update any row | Renewal date only on assigned row | None | None |
| Payment Collection Admin | Read/mutate all financial rows | None | None | None |
| Payment Follow-ups | Admin reporting only; never an assignee | Read and run employee commands on assigned rows | No unassigned rows | None |
| Distributor renewal reminders | Read all relevant rows | Read assigned rows | No unassigned rows | None |

Employee eligibility for Distributor Status and Payment Collection comes from the same canonical active non-Admin employee authority. Distributor identity is exact `distributor_id`; Attendance identity is `auth.users.id == public.users.user_id == attendance.user_id`; Receivables ownership is explicit `assigned_to`. Names, emails, and role labels are never record identity.

ERP Partner Viewer is a separate, exclusive external account type—not an operational employee. It may read only `/erp/distributors` and `/erp/renewals` through dedicated server-scoped projections for assigned canonical ERP systems. It has no attendance, employee assignment, internal synchronization, Distributor mutation, import, Receivable, Payment, Admin, employee-directory, or broad internal read access. Scope and capability changes use the Admin ERP Partner Access service path; the ordinary mixed capability matrix cannot grant this role.

The scoped ERP Distributor projection may additionally expose the operational ERP paid/not-paid status. It exposes no Receivable or Payment identifiers, amounts, references, or events.

CI must keep distinct fixtures for Admin, field Attendance, office Attendance, assigned employee, unassigned employee, and inactive/unlinked user. Every successful important mutation requires authoritative write-to-read closure in all readers listed above.
