import sys
path = 'supabase/migrations/002_addendum.sql'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("public.check_user_capability(auth.uid(), 'admin')", "public.has_capability('admin')")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
