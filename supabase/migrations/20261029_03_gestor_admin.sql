CREATE OR REPLACE FUNCTION public.cerimonial_admin_editar_nome(p_actor uuid, p_login text, p_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cerimonial_private', 'public', 'pg_temp'
AS $function$
DECLARE
  v_login text := upper(trim(coalesce(p_login,'')));
  v_nome text := trim(coalesce(p_nome,''));
BEGIN
  IF p_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM cerimonial_private.unidades
      WHERE auth_user_id=p_actor AND role IN ('master','manager') AND active
  ) THEN
    RAISE EXCEPTION 'Acesso administrativo necessário';
  END IF;
  IF v_login !~ '^[A-Z0-9_-]{2,20}$' OR length(v_nome)<2 OR length(v_nome)>120 THEN
    RAISE EXCEPTION 'Dados inválidos';
  END IF;
  UPDATE cerimonial_private.unidades
    SET nome=v_nome WHERE login=v_login AND (
      role='unit' OR (role='manager' AND EXISTS (
        SELECT 1 FROM cerimonial_private.unidades
        WHERE auth_user_id=p_actor AND role='master' AND active
      ))
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'Unidade não encontrada'; END IF;
  RETURN jsonb_build_object('ok',true,'login',v_login,'name',v_nome);
END
$function$


CREATE OR REPLACE FUNCTION public.cerimonial_admin_exclusoes_pendentes(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor_role text;
BEGIN
 SELECT role INTO v_actor_role FROM cerimonial_private.unidades
   WHERE auth_user_id=p_actor AND role IN ('master','manager') AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acesso administrativo necessário'; END IF;
 RETURN (
   SELECT coalesce(jsonb_agg(jsonb_build_object(
     'login',login,'name',nome,'email','','role','pending','targetRole',role,'active',false
   ) ORDER BY login),'[]'::jsonb)
   FROM cerimonial_private.exclusoes_pendentes
   WHERE role='unit' OR (v_actor_role='master' AND role='manager')
 );
END;
$function$


CREATE OR REPLACE FUNCTION public.cerimonial_admin_excluir_unidade(p_actor uuid, p_login text, p_fase text, p_uid uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_login text := upper(trim(coalesce(p_login,'')));
 v_unidade cerimonial_private.unidades%ROWTYPE;
 v_pendente cerimonial_private.exclusoes_pendentes%ROWTYPE;
 v_autoridades integer;
 v_actor_role text;
BEGIN
 SELECT role INTO v_actor_role FROM cerimonial_private.unidades
   WHERE auth_user_id=p_actor AND role IN ('master','manager') AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acesso administrativo necessário'; END IF;
 IF v_login !~ '^[A-Z0-9_-]{2,20}$' OR p_fase NOT IN ('preparar','finalizar') THEN
   RAISE EXCEPTION 'Solicitação inválida';
 END IF;
 SELECT * INTO v_pendente FROM cerimonial_private.exclusoes_pendentes
   WHERE login=v_login AND (role='unit' OR (v_actor_role='master' AND role='manager')) FOR UPDATE;
 IF p_fase='preparar' THEN
   IF FOUND THEN
     RETURN jsonb_build_object('prepared',true,'login',v_login,
       'user_id',v_pendente.auth_user_id,'already_pending',true);
   END IF;
   SELECT * INTO v_unidade FROM cerimonial_private.unidades
     WHERE login=v_login AND (role='unit' OR (v_actor_role='master' AND role='manager')) FOR UPDATE;
   IF NOT FOUND OR (v_unidade.role='unit' AND v_unidade.event_id IS NULL) THEN
     RAISE EXCEPTION 'Unidade não encontrada';
   END IF;
   IF v_unidade.auth_user_id=p_actor THEN
     RAISE EXCEPTION 'Não é permitido excluir a própria conta';
   END IF;
   SELECT count(*) INTO v_autoridades FROM cerimonial_private.authorities
     WHERE event_id=v_unidade.event_id;
   INSERT INTO cerimonial_private.exclusoes_pendentes
     (login,nome,auth_user_id,event_id,role)
   VALUES(v_unidade.login,v_unidade.nome,v_unidade.auth_user_id,v_unidade.event_id,v_unidade.role);
   DELETE FROM cerimonial_private.unidades WHERE id=v_unidade.id;
   IF v_unidade.event_id IS NOT NULL THEN
     DELETE FROM cerimonial_private.events WHERE id=v_unidade.event_id;
   END IF;
   RETURN jsonb_build_object('prepared',true,'login',v_login,
      'user_id',v_unidade.auth_user_id,'authorities_deleted',v_autoridades);
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nenhuma exclusão pendente'; END IF;
 IF p_uid IS NULL OR p_uid<>v_pendente.auth_user_id THEN
   RAISE EXCEPTION 'Conta de autenticação não corresponde ao cadastro excluído';
 END IF;
 IF EXISTS (SELECT 1 FROM auth.users WHERE id=v_pendente.auth_user_id) THEN
   RAISE EXCEPTION 'Conta de autenticação ainda não foi removida';
 END IF;
 DELETE FROM cerimonial_private.exclusoes_pendentes
   WHERE login=v_login AND auth_user_id=v_pendente.auth_user_id;
 RETURN jsonb_build_object('deleted',true,'login',v_login);
END;
$function$

REVOKE EXECUTE ON FUNCTION public.cerimonial_admin_editar_nome(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.cerimonial_admin_exclusoes_pendentes(uuid) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.cerimonial_admin_excluir_unidade(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cerimonial_admin_editar_nome(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerimonial_admin_exclusoes_pendentes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerimonial_admin_excluir_unidade(uuid,text,text,uuid) TO service_role;