import os
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")

with open(r'c:\Users\dcp69\Desktop\CRM_Zero\supabase\migrations\019_field_visits.sql', 'r') as f:
    sql = f.read()

conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = True
with conn.cursor() as cur:
    cur.execute(sql)
    
print("Migration 019 applied successfully!")
