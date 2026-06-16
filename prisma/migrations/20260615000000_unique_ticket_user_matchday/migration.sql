-- Candado: un usuario tiene COMO MÁXIMO un boleto por jornada.
-- Causa raíz del bug: el chequeo "¿ya apostó?" en tickets.service corría fuera
-- de la transacción, así que dos POST casi simultáneos (doble-tap) se colaban
-- ambos y creaban boletos duplicados (mismo user_id + matchday_id).

-- 1) Deduplicar primero: conservar el boleto más antiguo de cada par
--    (user_id, matchday_id), borrar los demás. Tie-break por id si created_at
--    empata. ticket_pick cae por ON DELETE CASCADE. Así la creación del índice
--    no falla si ya existen duplicados.
DELETE FROM "ticket" a
USING "ticket" b
WHERE a.user_id = b.user_id
  AND a.matchday_id = b.matchday_id
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));

-- 2) Candado a nivel BD.
CREATE UNIQUE INDEX "uniq_ticket_user_matchday" ON "ticket"("user_id", "matchday_id");
