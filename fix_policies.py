import os, re

def process_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find CREATE POLICY
    pattern = re.compile(r'(?<!drop policy if exists )(?<!drop policy if exists\n)create\s+policy\s+([\"a-zA-Z0-9_]+)\s+on\s+([a-zA-Z0-9_\.]+)', re.IGNORECASE)
    
    def replacer(match):
        policy_name = match.group(1)
        table_name = match.group(2)
        # Check if drop already exists right before
        # We can just inject it unconditionally if we are careful, or check the string.
        # A simpler way: just replace "CREATE POLICY" with "DROP POLICY IF EXISTS x ON y;\nCREATE POLICY"
        return f"DROP POLICY IF EXISTS {policy_name} ON {table_name};\n{match.group(0)}"
    
    # We will do a manual replace so we don't duplicate
    new_content = []
    lines = content.split('\n')
    for i, line in enumerate(lines):
        m = re.search(r'create\s+policy\s+([\"a-zA-Z0-9_]+)\s+on\s+([a-zA-Z0-9_\.]+)', line, re.IGNORECASE)
        if m:
            policy_name = m.group(1)
            table_name = m.group(2)
            # check if previous line has drop policy
            if i > 0 and 'drop policy if exists' in lines[i-1].lower():
                new_content.append(line)
            else:
                new_content.append(f"DROP POLICY IF EXISTS {policy_name} ON {table_name};")
                new_content.append(line)
        else:
            new_content.append(line)
    
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(new_content))
        print(f"Processed {path}")

for root, dirs, files in os.walk('supabase/migrations'):
    for file in files:
        if file.endswith('.sql'):
            process_file(os.path.join(root, file))
