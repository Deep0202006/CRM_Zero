# USER DIRECTORY DIAGNOSIS
Actual users table name: users
User primary key: id
Display-name field: full_name
Active/inactive field: is_active
Email field existence: Yes
Whether a `role` column exists: No (uses user_roles junction)
Capability storage table: user_capabilities
How role labels are currently derived: Left join roles table
How admin capability is represented: 'admin_access' capability
How manager capability is represented: 'manager_access' capability
How system/service accounts are identified: is_system_account boolean
Number of active human users visible to the current admin: UNKNOWN (DB dynamic)
Whether zero-work users are fetched independently: Handled inside RPC
Whether RLS permits the admin to read all active users: Yes via RPC
