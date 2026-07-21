CREATE INDEX IF NOT EXISTS idx_alloc_targets_compound ON public.allocated_targets (assigned_to_user_id, is_completed, city);

CREATE OR REPLACE FUNCTION public.allocate_city_task_batch(p_filename text, p_file_hash text, p_rows jsonb, p_city_assignments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE caller_id uuid := auth.uid(); batch uuid; inserted integer; result jsonb;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'missing caller' USING ERRCODE = '28000'; END IF;
  IF length(p_filename) NOT BETWEEN 1 AND 255 OR p_file_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid upload metadata' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 OR jsonb_typeof(p_city_assignments) <> 'object' THEN RAISE EXCEPTION 'invalid allocation payload' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE user_id=caller_id AND lower(coalesce(is_active::text,'false')) IN ('true','1')) OR NOT EXISTS (SELECT 1 FROM public.user_capabilities WHERE user_id=caller_id AND capability_code IN ('admin','task_assigner')) THEN RAISE EXCEPTION 'unauthorized caller' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) r(target_username text,target_name text,city text,target_mobile text) WHERE nullif(btrim(target_username),'') IS NULL OR nullif(btrim(target_name),'') IS NULL OR nullif(btrim(city),'') IS NULL OR nullif(btrim(target_mobile),'') IS NULL) THEN RAISE EXCEPTION 'invalid spreadsheet row' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each_text(p_city_assignments) m WHERE m.key <> lower(regexp_replace(btrim(m.key),'\s+',' ','g'))) THEN RAISE EXCEPTION 'duplicate or unnormalised city key' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each_text(p_city_assignments) m LEFT JOIN public.users u ON u.user_id=m.value::uuid WHERE u.user_id IS NULL OR lower(coalesce(u.is_active::text,'false')) NOT IN ('true','1')) THEN RAISE EXCEPTION 'inactive selected user' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) r(city text) WHERE NOT p_city_assignments ? lower(regexp_replace(btrim(r.city),'\s+',' ','g'))) OR EXISTS (SELECT 1 FROM jsonb_each_text(p_city_assignments) m WHERE NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) r(city text) WHERE lower(regexp_replace(btrim(r.city),'\s+',' ','g'))=m.key)) THEN RAISE EXCEPTION 'city mappings do not match spreadsheet' USING ERRCODE='22023'; END IF;
  INSERT INTO public.task_upload_batches(uploaded_by,filename,file_hash) VALUES(caller_id,p_filename,p_file_hash) RETURNING id INTO batch;
  INSERT INTO public.allocated_targets(batch_id,assigned_to_user_id,target_username,target_name,target_address,target_area,target_state,target_mobile,target_email,city,pspa_code,third_party_code,dlic1,dlic2,dlic3,dlic4,food_license,is_completed)
  SELECT batch,(p_city_assignments ->> lower(regexp_replace(btrim(r.city),'\s+',' ','g')))::uuid,btrim(r.target_username),btrim(r.target_name),btrim(r.target_address),btrim(r.target_area),btrim(r.target_state),btrim(r.target_mobile),btrim(r.target_email),btrim(regexp_replace(r.city,'\s+',' ','g')),btrim(r.pspa_code),btrim(r.third_party_code),btrim(r.dlic1),btrim(r.dlic2),btrim(r.dlic3),btrim(r.dlic4),btrim(r.food_license),false FROM jsonb_to_recordset(p_rows) r(target_username text,target_name text,target_address text,target_area text,city text,target_state text,target_mobile text,target_email text,pspa_code text,third_party_code text,dlic1 text,dlic2 text,dlic3 text,dlic4 text,food_license text);
  GET DIAGNOSTICS inserted = ROW_COUNT;
  SELECT jsonb_build_object('batchId',batch,'allocatedCount',inserted,'cityCount',(SELECT count(DISTINCT lower(regexp_replace(btrim(city),'\s+',' ','g'))) FROM jsonb_to_recordset(p_rows) r(city text)),'userSummary',coalesce((SELECT jsonb_agg(jsonb_build_object('userId',x.assigned_to_user_id,'userName',u.name,'cityCount',x.city_count,'taskCount',x.task_count)) FROM (SELECT assigned_to_user_id,count(DISTINCT city) city_count,count(*) task_count FROM public.allocated_targets WHERE batch_id=batch GROUP BY assigned_to_user_id) x JOIN public.users u ON u.user_id=x.assigned_to_user_id),'[]'::jsonb)) INTO result;
  RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'duplicate file' USING ERRCODE='23505'; END; $$;
REVOKE ALL ON FUNCTION public.allocate_city_task_batch(text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_city_task_batch(text,text,jsonb,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_city_task_batch(text,text,jsonb,jsonb) TO authenticated;
REVOKE UPDATE ON public.allocated_targets FROM authenticated;
GRANT UPDATE (is_completed, completed_at) ON public.allocated_targets TO authenticated;
DROP POLICY IF EXISTS "Agents can update their own allocated targets" ON public.allocated_targets;
CREATE POLICY "Agents can update their own allocated targets" ON public.allocated_targets FOR UPDATE USING (assigned_to_user_id=auth.uid()) WITH CHECK (assigned_to_user_id=auth.uid());
