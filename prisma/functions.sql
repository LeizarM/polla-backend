-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Trigger 1: Calculate match result automatically when scores are updated
CREATE OR REPLACE FUNCTION calculate_match_result()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.score_a IS NOT NULL AND NEW.score_b IS NOT NULL THEN
    IF NEW.score_a > NEW.score_b THEN
      NEW.result := 'a';
    ELSIF NEW.score_a < NEW.score_b THEN
      NEW.result := 'b';
    ELSE
      NEW.result := 'draw';
    END IF;
    NEW.status := 'finished';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calculate_match_result ON match;
CREATE TRIGGER trg_calculate_match_result
BEFORE UPDATE ON match
FOR EACH ROW
WHEN (NEW.score_a IS DISTINCT FROM OLD.score_a OR NEW.score_b IS DISTINCT FROM OLD.score_b)
EXECUTE FUNCTION calculate_match_result();

-- Trigger 2: Process ticket insert (deduct balance, add to pool, create transaction)
CREATE OR REPLACE FUNCTION process_ticket_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_house_cut DECIMAL(12,2);
  v_tournament_id UUID;
  v_house_pct DECIMAL(5,2);
  v_user_balance DECIMAL(12,2);
BEGIN
  -- Get user balance
  SELECT balance INTO v_user_balance FROM "user" WHERE id = NEW.user_id;
  
  IF v_user_balance < NEW.amount_bet THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Get tournament house cut
  SELECT t.house_cut_pct, t.id INTO v_house_pct, v_tournament_id
  FROM tournament t
  JOIN matchday m ON m.tournament_id = t.id
  WHERE m.id = NEW.matchday_id;

  -- Calculate pool contribution (amount after house cut)
  v_house_cut := NEW.amount_bet * (v_house_pct / 100);
  NEW.pool_contribution := NEW.amount_bet - v_house_cut;

  -- Deduct from user balance
  UPDATE "user" SET balance = balance - NEW.amount_bet, updated_at = NOW()
  WHERE id = NEW.user_id;

  -- Add to matchday pool
  UPDATE matchday SET total_pool = total_pool + NEW.pool_contribution, updated_at = NOW()
  WHERE id = NEW.matchday_id;

  -- Create bet transaction
  INSERT INTO transaction (user_id, type, amount, status, notes)
  VALUES (NEW.user_id, 'bet', NEW.amount_bet, 'completed', 'Quiniela: ' || NEW.matchday_id);

  -- Create house transaction
  IF v_house_cut > 0 THEN
    INSERT INTO transaction (user_id, type, amount, status, notes)
    VALUES (NEW.user_id, 'house', v_house_cut, 'completed', 'House cut');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_process_ticket_insert ON ticket;
CREATE TRIGGER trg_process_ticket_insert
BEFORE INSERT ON ticket
FOR EACH ROW
EXECUTE FUNCTION process_ticket_insert();

-- Trigger 3: Process group bet insert
CREATE OR REPLACE FUNCTION process_group_bet_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_house_cut DECIMAL(12,2);
  v_house_pct DECIMAL(5,2);
  v_user_balance DECIMAL(12,2);
BEGIN
  -- Get user balance
  SELECT balance INTO v_user_balance FROM "user" WHERE id = NEW.user_id;
  
  IF v_user_balance < NEW.amount_bet THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  SELECT t.house_cut_pct INTO v_house_pct
  FROM tournament t
  JOIN tournament_group g ON g.tournament_id = t.id
  WHERE g.id = NEW.group_id;

  v_house_cut := NEW.amount_bet * (v_house_pct / 100);
  NEW.pool_contribution := NEW.amount_bet - v_house_cut;

  UPDATE "user" SET balance = balance - NEW.amount_bet, updated_at = NOW()
  WHERE id = NEW.user_id;

  UPDATE tournament_group SET total_pool = total_pool + NEW.pool_contribution, updated_at = NOW()
  WHERE id = NEW.group_id;

  INSERT INTO transaction (user_id, type, amount, status, notes)
  VALUES (NEW.user_id, 'bet', NEW.amount_bet, 'completed', 'Group bet: ' || NEW.group_id);

  IF v_house_cut > 0 THEN
    INSERT INTO transaction (user_id, type, amount, status, notes)
    VALUES (NEW.user_id, 'house', v_house_cut, 'completed', 'House cut');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_process_group_bet_insert ON group_bet;
CREATE TRIGGER trg_process_group_bet_insert
BEFORE INSERT ON group_bet
FOR EACH ROW
EXECUTE FUNCTION process_group_bet_insert();

-- Function 4: Resolve matchday
-- Only real bettors (amount_bet > 0) compete for the pool.
-- Ghost tickets (amount_bet = 0) are auto-lost and never win prizes.
CREATE OR REPLACE FUNCTION resolve_matchday(p_matchday_id UUID)
RETURNS TABLE(winners_count INTEGER, total_distributed DECIMAL) AS $$
DECLARE
  v_total_pool DECIMAL(12,2);
  v_max_correct INTEGER;
  v_winner_count INTEGER;
  v_prize_per_winner DECIMAL(12,2);
  r RECORD;
BEGIN
  -- Mark picks as correct/incorrect
  UPDATE ticket_pick tp
  SET is_correct = (tp.pick = m.result)
  FROM match m
  WHERE tp.match_id = m.id
  AND m.matchday_id = p_matchday_id
  AND m.result IS NOT NULL;

  -- Count correct picks per ticket (only real tickets)
  UPDATE ticket t
  SET total_correct = (
    SELECT COUNT(*) FROM ticket_pick tp
    WHERE tp.ticket_id = t.id AND tp.is_correct = true
  )
  WHERE t.matchday_id = p_matchday_id AND t.amount_bet > 0;

  -- Find max correct ONLY among real bettors (amount_bet > 0)
  SELECT MAX(total_correct) INTO v_max_correct
  FROM ticket WHERE matchday_id = p_matchday_id AND amount_bet > 0;

  -- Get pool
  SELECT total_pool INTO v_total_pool
  FROM matchday WHERE id = p_matchday_id;

  IF v_max_correct IS NOT NULL AND v_max_correct > 0 AND v_total_pool > 0 THEN
    -- Count winners (real bettors with max correct)
    SELECT COUNT(*) INTO v_winner_count
    FROM ticket
    WHERE matchday_id = p_matchday_id AND total_correct = v_max_correct AND amount_bet > 0;

    v_prize_per_winner := v_total_pool / v_winner_count;

    -- Update winners
    FOR r IN
      SELECT id, user_id FROM ticket
      WHERE matchday_id = p_matchday_id AND total_correct = v_max_correct AND amount_bet > 0
    LOOP
      UPDATE ticket SET status = 'won', prize_won = v_prize_per_winner WHERE id = r.id;
      UPDATE "user" SET balance = balance + v_prize_per_winner, updated_at = NOW() WHERE id = r.user_id;
      INSERT INTO transaction (user_id, type, amount, status, notes)
      VALUES (r.user_id, 'win', v_prize_per_winner, 'completed', 'Matchday win: ' || p_matchday_id);
    END LOOP;

    -- Mark real losers (amount_bet > 0 but not max correct)
    UPDATE ticket SET status = 'lost'
    WHERE matchday_id = p_matchday_id AND amount_bet > 0
    AND (total_correct < v_max_correct OR total_correct IS NULL);
  ELSE
    -- No winners, mark all real as lost
    UPDATE ticket SET status = 'lost' WHERE matchday_id = p_matchday_id AND amount_bet > 0;
    v_winner_count := 0;
    v_prize_per_winner := 0;
  END IF;

  -- Ghost tickets (amount_bet = 0) are already 'lost' from insert — ensure it
  UPDATE ticket SET status = 'lost', total_correct = 0, prize_won = 0
  WHERE matchday_id = p_matchday_id AND amount_bet = 0;

  -- Update matchday status
  UPDATE matchday SET status = 'resolved', updated_at = NOW() WHERE id = p_matchday_id;

  winners_count := COALESCE(v_winner_count, 0);
  total_distributed := COALESCE(v_prize_per_winner * v_winner_count, 0);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function 5: Resolve group bet
CREATE OR REPLACE FUNCTION resolve_group_bet(p_group_id UUID)
RETURNS TABLE(winners_count INTEGER, total_distributed DECIMAL) AS $$
DECLARE
  v_group RECORD;
  v_total_pool DECIMAL(12,2);
  v_max_points INTEGER;
  v_winner_count INTEGER;
  v_prize_per_winner DECIMAL(12,2);
  r RECORD;
BEGIN
  SELECT * INTO v_group FROM tournament_group WHERE id = p_group_id;

  -- Calculate points for each bet
  FOR r IN SELECT * FROM group_bet WHERE group_id = p_group_id LOOP
    DECLARE v_points INTEGER := 0;
    BEGIN
      IF r.pick_1st = v_group.result_1st THEN v_points := v_points + v_group.pts_1st; END IF;
      IF r.pick_2nd = v_group.result_2nd THEN v_points := v_points + v_group.pts_2nd; END IF;
      IF v_group.has_third_place AND r.pick_3rd = v_group.result_3rd THEN v_points := v_points + COALESCE(v_group.pts_3rd, 0); END IF;
      IF v_group.has_third_place AND r.pick_4th = v_group.result_4th THEN v_points := v_points + COALESCE(v_group.pts_4th, 0); END IF;
      UPDATE group_bet SET total_points = v_points WHERE id = r.id;
    END;
  END LOOP;

  SELECT MAX(total_points) INTO v_max_points FROM group_bet WHERE group_id = p_group_id;
  v_total_pool := v_group.total_pool;

  IF v_max_points IS NOT NULL AND v_max_points > 0 AND v_total_pool > 0 THEN
    SELECT COUNT(*) INTO v_winner_count FROM group_bet WHERE group_id = p_group_id AND total_points = v_max_points;
    v_prize_per_winner := v_total_pool / v_winner_count;

    FOR r IN SELECT id, user_id FROM group_bet WHERE group_id = p_group_id AND total_points = v_max_points LOOP
      UPDATE group_bet SET status = 'won', prize_won = v_prize_per_winner WHERE id = r.id;
      UPDATE "user" SET balance = balance + v_prize_per_winner, updated_at = NOW() WHERE id = r.user_id;
      INSERT INTO transaction (user_id, type, amount, status, notes)
      VALUES (r.user_id, 'win', v_prize_per_winner, 'completed', 'Group bet win: ' || p_group_id);
    END LOOP;

    UPDATE group_bet SET status = 'lost' WHERE group_id = p_group_id AND total_points < v_max_points;
  ELSE
    UPDATE group_bet SET status = 'lost' WHERE group_id = p_group_id;
    v_winner_count := 0;
    v_prize_per_winner := 0;
  END IF;

  UPDATE tournament_group SET status = 'resolved', updated_at = NOW() WHERE id = p_group_id;

  winners_count := COALESCE(v_winner_count, 0);
  total_distributed := COALESCE(v_prize_per_winner * v_winner_count, 0);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
