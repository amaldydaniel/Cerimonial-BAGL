CREATE OR REPLACE FUNCTION public.cerimonial_multi_api(p_action text, p_actor uuid DEFAULT NULL::uuid, p_login text DEFAULT NULL::text, p_target_uid uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text, p_nome text DEFAULT NULL::text, p_active boolean DEFAULT NULL::boolean, p_authority text DEFAULT NULL::text, p_present boolean DEFAULT NULL::boolean, p_items jsonb DEFAULT NULL::jsonb, p_name text DEFAULT NULL::text, p_ip_digest text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cerimonial_private', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE a cerimonial_private.unidades%rowtype;
        t cerimonial_private.unidades%rowtype;
        e cerimonial_private.events%rowtype;
        v_count int;
        v_data jsonb;
        v_ip cerimonial_private.recuperacao_ip%rowtype;
        v_l cerimonial_private.recuperacao_limites%rowtype;
        v_login text := upper(trim(coalesce(p_login,'')));
BEGIN
 IF p_action='recovery_lookup' THEN
   IF p_ip_digest IS NULL OR length(p_ip_digest)<>64 THEN RAISE EXCEPTION 'Solicitação inválida'; END IF;
   INSERT INTO cerimonial_private.consultas_ip(ip_digest) VALUES(p_ip_digest) ON CONFLICT DO NOTHING;
   UPDATE cerimonial_private.consultas_ip SET requested=CASE WHEN now()-window_start>=interval '1 hour' THEN 1 ELSE requested+1 END,
     window_start=CASE WHEN now()-window_start>=interval '1 hour' THEN now() ELSE window_start END WHERE ip_digest=p_ip_digest RETURNING requested INTO v_count;
   IF v_count>20 THEN RETURN jsonb_build_object('found',false,'limited',true); END IF;
 END IF;
 IF p_action IN ('login_lookup','recovery_lookup') THEN
   SELECT * INTO t FROM cerimonial_private.unidades
     WHERE login=v_login AND active AND (p_action='login_lookup' OR role IN ('unit','manager'));
   IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
   RETURN jsonb_build_object('found',true,'email',t.email);
 END IF;
 IF p_action='recovery_guard' THEN
   IF p_ip_digest IS NULL OR length(p_ip_digest)<>64 THEN RAISE EXCEPTION 'Identificador de conexão inválido'; END IF;
   SELECT * INTO t FROM cerimonial_private.unidades WHERE login=v_login AND active AND role IN ('unit','manager');
   IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','unavailable'); END IF;
   INSERT INTO cerimonial_private.recuperacao_limites(unidade_id) VALUES(t.id) ON CONFLICT DO NOTHING;
   SELECT * INTO v_l FROM cerimonial_private.recuperacao_limites WHERE unidade_id=t.id FOR UPDATE;
   INSERT INTO cerimonial_private.recuperacao_ip(ip_digest) VALUES(p_ip_digest) ON CONFLICT DO NOTHING;
   SELECT * INTO v_ip FROM cerimonial_private.recuperacao_ip WHERE ip_digest=p_ip_digest FOR UPDATE;
   IF v_l.blocked_until IS NOT NULL AND now()<v_l.blocked_until THEN
     RETURN jsonb_build_object('allowed',false,'reason','limited');
   END IF;
   IF now()-v_l.window_start>=interval '1 hour' THEN
     UPDATE cerimonial_private.recuperacao_limites SET window_start=now(),sent_count=0,blocked_until=NULL WHERE unidade_id=t.id;
     v_l.window_start:=now();v_l.sent_count:=0;
   END IF;
   IF now()-v_ip.window_start>=interval '1 hour' THEN
     UPDATE cerimonial_private.recuperacao_ip SET window_start=now(),sent_count=0 WHERE ip_digest=p_ip_digest;
     v_ip.window_start:=now();v_ip.sent_count:=0;
   END IF;
   IF v_l.sent_count>=3 THEN
     UPDATE cerimonial_private.recuperacao_limites SET blocked_until=now()+interval '1 hour' WHERE unidade_id=t.id;
     RETURN jsonb_build_object('allowed',false,'reason','limited');
   END IF;
   IF v_ip.sent_count>=10 OR
      (v_l.last_sent IS NOT NULL AND now()-v_l.last_sent<interval '5 minutes') OR
      (v_ip.last_sent IS NOT NULL AND now()-v_ip.last_sent<interval '1 minute') THEN
     RETURN jsonb_build_object('allowed',false,'reason','cooldown');
   END IF;
   UPDATE cerimonial_private.recuperacao_limites SET sent_count=sent_count+1,last_sent=now() WHERE unidade_id=t.id;
   UPDATE cerimonial_private.recuperacao_ip SET sent_count=sent_count+1,last_sent=now() WHERE ip_digest=p_ip_digest;
   RETURN jsonb_build_object('allowed',true,'email',t.email);
 END IF;
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
 SELECT * INTO a FROM cerimonial_private.unidades WHERE auth_user_id=p_actor AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não autorizada'; END IF;
 IF p_action='whoami' THEN
   RETURN jsonb_build_object('login',a.login,'name',a.nome,'role',a.role,'email',a.email);
 END IF;
 IF p_action IN ('list_units','register_unit','register_manager','set_active','set_email','reset_recovery','master_target') THEN
   IF a.role NOT IN ('master','manager') THEN RAISE EXCEPTION 'Acesso administrativo necessário'; END IF;
   IF p_action='list_units' THEN
     SELECT coalesce(jsonb_agg(jsonb_build_object('login',login,'name',nome,'email',email,'active',active,'role',role) ORDER BY login),'[]'::jsonb)
       INTO v_data FROM cerimonial_private.unidades WHERE role='unit' OR (a.role='master' AND role='manager');
     RETURN jsonb_build_object('units',v_data);
   END IF;
   IF p_action IN ('register_unit','register_manager') THEN
     IF p_action='register_manager' AND a.role<>'master' THEN
       RAISE EXCEPTION 'Somente o Master pode criar gestores';
     END IF;
     IF p_target_uid IS NULL OR p_email IS NULL OR p_nome IS NULL
        OR length(trim(p_nome))<2 OR length(trim(p_nome))>120
        OR v_login !~ '^[A-Z0-9_-]{2,20}$' THEN
       RAISE EXCEPTION 'Dados de cadastro inválidos';
     END IF;
     IF p_action='register_manager' THEN
       INSERT INTO cerimonial_private.unidades(login,nome,email,auth_user_id,role,event_id)
       VALUES(v_login,left(trim(p_nome),120),lower(trim(p_email)),p_target_uid,'manager',NULL);
     ELSE
       INSERT INTO cerimonial_private.events(name,access_code_hash,admin_code_hash)
       VALUES ('CERIMONIAL '||v_login,crypt(encode(gen_random_bytes(24),'hex'),gen_salt('bf')),crypt(encode(gen_random_bytes(24),'hex'),gen_salt('bf'))) RETURNING * INTO e;
       INSERT INTO cerimonial_private.unidades(login,nome,email,auth_user_id,role,event_id)
       VALUES(v_login,left(trim(p_nome),120),lower(trim(p_email)),p_target_uid,'unit',e.id);
     END IF;
     RETURN jsonb_build_object('ok',true,'login',v_login);
   END IF;
   SELECT * INTO t FROM cerimonial_private.unidades WHERE login=v_login AND (role='unit' OR (a.role='master' AND role='manager'));
   IF NOT FOUND THEN RAISE EXCEPTION 'Unidade não encontrada'; END IF;
   IF p_action='master_target' THEN
     RETURN jsonb_build_object('user_id',t.auth_user_id,'email',t.email);
   END IF;
   IF p_action='set_active' THEN
     IF p_active IS NULL THEN RAISE EXCEPTION 'Status inválido'; END IF;
     UPDATE cerimonial_private.unidades SET active=p_active WHERE id=t.id;
     RETURN jsonb_build_object('ok',true);
   ELSIF p_action='set_email' THEN
     IF p_email IS NULL OR position('@' IN p_email)=0 THEN RAISE EXCEPTION 'E-mail inválido'; END IF;
     UPDATE cerimonial_private.unidades SET email=lower(trim(p_email)) WHERE id=t.id;
     RETURN jsonb_build_object('ok',true);
   ELSIF p_action='reset_recovery' THEN
     DELETE FROM cerimonial_private.recuperacao_limites WHERE unidade_id=t.id;
     RETURN jsonb_build_object('ok',true);
   END IF;
 END IF;
 IF a.role<>'unit' OR a.event_id IS NULL THEN RAISE EXCEPTION 'Operação restrita à unidade'; END IF;
 IF p_action IN ('version','read','presences') THEN
   SELECT * INTO e FROM cerimonial_private.events WHERE id=a.event_id AND active;
 ELSE
   SELECT * INTO e FROM cerimonial_private.events WHERE id=a.event_id AND active FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Carômetro indisponível'; END IF;
 IF p_action='version' THEN
   RETURN jsonb_build_object('version',e.version,'structure_version',e.structure_version,'name',e.name,'unit',a.login);
 ELSIF p_action='read' THEN
   SELECT coalesce(jsonb_agg(payload || jsonb_build_object('present',present)
       ORDER BY (payload->>'order')::numeric NULLS LAST),'[]'::jsonb) INTO v_data
   FROM cerimonial_private.authorities WHERE event_id=e.id;
   RETURN jsonb_build_object('name',e.name,'version',e.version,'structure_version',e.structure_version,'items',v_data,'admin',true,'unit',a.login);
 ELSIF p_action='presences' THEN
   SELECT coalesce(jsonb_agg(
     jsonb_build_object('id',id,
       'present',coalesce(present, false),
       'checkedTime',CASE WHEN present AND checked_at IS NOT NULL
         THEN to_char(checked_at AT TIME ZONE 'America/Sao_Paulo','HH24:MI')
         ELSE NULL END)
     ORDER BY id), '[]'::jsonb)
   INTO v_data
   FROM cerimonial_private.authorities WHERE event_id=e.id;
   RETURN jsonb_build_object('version',e.version,'structure_version',e.structure_version,'items',v_data);
 ELSIF p_action='toggle' THEN
   IF p_authority IS NULL OR p_present IS NULL THEN RAISE EXCEPTION 'Dados incompletos'; END IF;
   UPDATE cerimonial_private.authorities SET present=p_present,checked_at=CASE WHEN p_present THEN now() ELSE NULL END,
      payload=(payload-'checkedTime') || CASE WHEN p_present THEN jsonb_build_object('checkedTime',to_char(now() at time zone 'America/Sao_Paulo','HH24:MI')) ELSE '{}'::jsonb END,
      revision=revision+1,updated_at=now() WHERE event_id=e.id AND id=p_authority;
   IF NOT FOUND THEN RAISE EXCEPTION 'Autoridade não encontrada'; END IF;
   UPDATE cerimonial_private.events SET version=version+1,updated_at=now() WHERE id=e.id RETURNING version INTO e.version;
   RETURN jsonb_build_object('version',e.version);
 ELSIF p_action='upload' THEN
   IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR pg_column_size(p_items)>14000000 THEN RAISE EXCEPTION 'Arquivo inválido'; END IF;
   v_count=jsonb_array_length(p_items);
   IF v_count<1 OR v_count>2000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) AS x WHERE nullif(x->>'id','') IS NULL)
      OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_items) AS x)<>v_count THEN
     RAISE EXCEPTION 'IDs ou quantidade inválidos';
   END IF;
   DELETE FROM cerimonial_private.authorities WHERE event_id=e.id;
   INSERT INTO cerimonial_private.authorities(event_id,id,payload,present)
     SELECT e.id,x->>'id',x,false FROM jsonb_array_elements(p_items) x;
   UPDATE cerimonial_private.events SET name=coalesce(nullif(left(trim(coalesce(p_name,'')),150),''),e.name),version=version+1,structure_version=structure_version+1,updated_at=now() WHERE id=e.id RETURNING version, structure_version INTO e.version, e.structure_version;
   RETURN jsonb_build_object('count',v_count,'version',e.version);
 ELSIF p_action='clear' THEN
   DELETE FROM cerimonial_private.authorities WHERE event_id=e.id;
   UPDATE cerimonial_private.events SET name='CERIMONIAL '||a.login,version=version+1,structure_version=structure_version+1,updated_at=now() WHERE id=e.id RETURNING version, structure_version INTO e.version, e.structure_version;
   RETURN jsonb_build_object('count',0,'version',e.version);
 END IF;
 RAISE EXCEPTION 'Ação desconhecida';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cerimonial_multi_api(text,uuid,text,uuid,text,text,boolean,text,boolean,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cerimonial_multi_api(text,uuid,text,uuid,text,text,boolean,text,boolean,jsonb,text,text) TO service_role;
