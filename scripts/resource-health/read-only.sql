select pg_database_size(current_database()) as database_bytes;

select relname as table_name, pg_total_relation_size(c.oid) as bytes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by bytes desc limit 20;

select bucket_id, count(*) as object_count,
       coalesce(sum((metadata->>'size')::bigint) filter (where (metadata->>'size') ~ '^\d+$'), 0) as bytes
from storage.objects
group by bucket_id order by bytes desc;
