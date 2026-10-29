-- Gestor de Usuários: somente o Master pode criar e administrar gestores.
-- As funções de autorização são atualizadas no mesmo conjunto de alterações.
ALTER TABLE cerimonial_private.unidades DROP CONSTRAINT unidades_role_check;
ALTER TABLE cerimonial_private.unidades ADD CONSTRAINT unidades_role_check
 CHECK (role IN ('unit','manager','master'));
ALTER TABLE cerimonial_private.unidades DROP CONSTRAINT unidades_check;
ALTER TABLE cerimonial_private.unidades ADD CONSTRAINT unidades_check
 CHECK ((role IN ('master','manager') AND event_id IS NULL)
 OR (role='unit' AND event_id IS NOT NULL));
ALTER TABLE cerimonial_private.exclusoes_pendentes ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE cerimonial_private.exclusoes_pendentes ADD COLUMN role text NOT NULL DEFAULT 'unit'
 CONSTRAINT exclusoes_pendentes_role_check CHECK (role IN ('unit','manager'));
