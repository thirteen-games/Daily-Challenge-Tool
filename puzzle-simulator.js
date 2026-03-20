// ============================================================
// NOVA ISLAND PUZZLE SIMULATOR
// Simulates a 1-round puzzle: player plays cards, then energizing
// Uses the full card ability JSON data to calculate exact outcomes
// ============================================================

const PuzzleSim = (() => {

  // ---- Constants ----
  const ROW = { P: 0, M: 1, L: 2, B: 3 };
  const ROW_NAME = ['Penthouse', 'Mezz', 'Lobby', 'Basement'];
  const ROW_CODE = ['P', 'M', 'L', 'B'];
  const ROW_SLOT_ID = [9, 8, 7, 6]; // P=9, M=8, L=7, B=6

  // Trigger IDs
  const T = {
    ROUND_START: 1, ON_PLAY: 2, ON_PLAY_OTHER_BEFORE: 3, ON_PLAY_OTHER_AFTER: 4,
    START_ENERGIZING: 5, THIS_ENERGIZED: 6, OTHER_ENERGIZED: 7,
    THIS_DESTROYED: 8, THIS_DAMAGED: 9, OTHER_DOES_DAMAGE: 10,
    FRIEND_ADDS_CARD: 11, BUSINESS_FROZEN: 12, BLOOM_ADDED: 13,
    BLOOM_TRIGGERED: 14, THIS_GAINS_HEALTH: 15, THIS_MOVED: 16,
    OTHER_DESTROYED: 17, ABSORB: 18
  };

  // Affect filter IDs — from server AbilityTargetFilters enum (cardAbilities.go)
  const AF = {
    SELECTED_SLOT: 0,     // TargetSelectedSlot
    SECONDARY_SLOT: 1,    // TargetSecondarySelectedSlot
    SELF: 2,              // TargetThisCard
    OTHER_CARD: 3,        // TargetOtherCard (the triggering card in reactions)
    FRIENDS: 4,           // TargetFriends (allied cards)
    ENEMIES: 5,           // TargetEnemies (enemy cards)
    ABOVE_GROUND: 6,      // TargetAboveGround (L+M+P, i.e. not Basement)
    BELOW_GROUND: 7,      // TargetBelowGround (Basement only)
    BASEMENT: 8,          // TargetBasement
    LOBBY: 9,             // TargetLobby
    MEZZ: 10,             // TargetMezzanine
    PENTHOUSE: 11,        // TargetPenthouse
    SAME_COL: 12,         // TargetColumn
    SAME_ROW: 13,         // TargetRow
    BOMBER: 14,           // TargetBomberPattern
    SURROUNDING: 15,      // TargetSurrounding (up to 8 cells)
    NEXT_TO: 16,          // TargetNeighbors (same row, col ±1)
    BELOW: 17,            // TargetBelow (below in same column)
    COL_TO_RIGHT: 18,     // TargetColToRight
    COL_TO_LEFT: 19,      // TargetColToLeft
    OWNER_PLAYER: 20,     // AffectsPlayer
    OPPONENT_PLAYER: 21,  // AffectsOpponent
    IGNORE_SELECTED: 22   // IgnoreSelectedSlot
  };

  // Row adjacency: which rows are neighbors (for surrounding)
  // P <-> M <-> L ... B is isolated
  const ROW_NEIGHBORS = {
    0: [1],       // P neighbors M
    1: [0, 2],    // M neighbors P, L
    2: [1],       // L neighbors M
    3: []         // B neighbors nothing
  };

  // ---- Board State ----
  // Each cell: null or { cardId, player, hp, maxHp, isGlitched, isFractured, bloom, instanceId }
  function createBoard() {
    return Array.from({ length: 4 }, () => Array(4).fill(null));
  }

  function cloneBoard(board) {
    return board.map(row => row.map(cell => cell ? { ...cell } : null));
  }

  // ---- Simulation State ----
  function createSimState(board, playerHand, botHand, playerCoins, playerScore, botScore, activationLevels) {
    return {
      board: cloneBoard(board),
      playerHand: [...playerHand],
      botHand: [...botHand],
      playerCoins,
      playerScore,
      botScore,
      activationLevels: [...activationLevels],
      log: [],
      nextInstanceId: 1000,
      oncePerRound: new Set(), // track "once a day" abilities that have fired
    };
  }

  // ---- Helpers ----
  function getCell(state, row, col) {
    if (row < 0 || row > 3 || col < 0 || col > 3) return null;
    return state.board[row][col];
  }

  function setCell(state, row, col, cell) {
    state.board[row][col] = cell;
  }

  function findCard(state, instanceId) {
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        if (state.board[r][c] && state.board[r][c].instanceId === instanceId)
          return { row: r, col: c, cell: state.board[r][c] };
    return null;
  }

  function allBoardCards(state) {
    const cards = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        if (state.board[r][c])
          cards.push({ row: r, col: c, cell: state.board[r][c] });
    return cards;
  }

  function getCardData(cardId) {
    return typeof CARD_DATA !== 'undefined' ? CARD_DATA[cardId] : null;
  }

  function getCardInfo(cardId) {
    return typeof ALL_CARDS !== 'undefined' ? ALL_CARDS[cardId] : null;
  }

  function getCardAbilities(cardId) {
    const ref = typeof window !== 'undefined' && window._cardAbilities;
    return ref ? ref[cardId] : null;
  }

  function getDisplayName(cardId) {
    const info = getCardInfo(cardId);
    return info ? info.displayName : `#${cardId}`;
  }

  // ---- Target Resolution ----
  // Given a source card position and affect filters, return matching board positions
  function resolveTargets(state, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context) {
    // Separate modifier filters from target filters
    const hasIgnoreSelected = filtersInc.includes(AF.IGNORE_SELECTED) || filtersExc.includes(AF.IGNORE_SELECTED);
    const realInc = filtersInc.filter(f => f !== AF.IGNORE_SELECTED);
    const realExc = filtersExc.filter(f => f !== AF.IGNORE_SELECTED);

    // Inclusive filters: UNION (combine all matching targets)
    let result = [];
    const seen = new Set();
    for (const f of realInc) {
      const targets = resolveOneFilter(state, sourceRow, sourceCol, sourcePlayer, f, context);
      for (const t of targets) {
        const key = `${t.row},${t.col}`;
        if (!seen.has(key)) { seen.add(key); result.push(t); }
      }
    }

    if (result.length === 0 && realInc.length > 0) return [];

    // Exclusive filters: INTERSECTION (must match ALL exclusive filters)
    for (const f of realExc) {
      const excSet = resolveOneFilter(state, sourceRow, sourceCol, sourcePlayer, f, context);
      const excKeys = new Set(excSet.map(p => `${p.row},${p.col}`));
      result = result.filter(p => excKeys.has(`${p.row},${p.col}`));
    }

    // IGNORE_SELECTED: remove the source card's position from results
    if (hasIgnoreSelected) {
      result = result.filter(p => !(p.row === sourceRow && p.col === sourceCol));
    }

    return result;
  }

  function resolveOneFilter(state, srcRow, srcCol, srcPlayer, filterId, context) {
    const results = [];
    const allCards = allBoardCards(state);

    switch (filterId) {
      case AF.SELECTED_SLOT: // 0
      case AF.SECONDARY_SLOT: // 1
        { const c = getCell(state, srcRow, srcCol); if (c) results.push({ row: srcRow, col: srcCol }); }
        break;

      case AF.SELF: // 2 - this card itself
        { const c = getCell(state, srcRow, srcCol); if (c) results.push({ row: srcRow, col: srcCol }); }
        break;

      case AF.OTHER_CARD: // 3 - the "other" card in trigger context
        if (context && context.otherRow !== undefined && context.otherCol !== undefined) {
          results.push({ row: context.otherRow, col: context.otherCol });
        } else {
          // Fallback: return all cards except self
          for (const { row, col } of allCards) {
            if (row !== srcRow || col !== srcCol) results.push({ row, col });
          }
        }
        break;

      case AF.FRIENDS: // 4 - allied cards
        for (const { row, col, cell } of allCards)
          if (cell.player === srcPlayer) results.push({ row, col });
        break;

      case AF.ENEMIES: // 5 - enemy cards
        for (const { row, col, cell } of allCards)
          if (cell.player !== srcPlayer) results.push({ row, col });
        break;

      case AF.ABOVE_GROUND: // 6 - L+M+P (not Basement)
        for (const { row, col } of allCards)
          if (row !== ROW.B) results.push({ row, col });
        break;

      case AF.BELOW_GROUND: // 7 - Basement only
        for (const { row, col } of allCards)
          if (row === ROW.B) results.push({ row, col });
        break;

      case AF.BASEMENT: // 8
        for (const { row, col } of allCards) if (row === ROW.B) results.push({ row, col });
        break;

      case AF.LOBBY: // 9
        for (const { row, col } of allCards) if (row === ROW.L) results.push({ row, col });
        break;

      case AF.MEZZ: // 10
        for (const { row, col } of allCards) if (row === ROW.M) results.push({ row, col });
        break;

      case AF.PENTHOUSE: // 11
        for (const { row, col } of allCards) if (row === ROW.P) results.push({ row, col });
        break;

      case AF.SAME_COL: // 12 - same column as source
        for (const { row, col } of allCards) if (col === srcCol) results.push({ row, col });
        break;

      case AF.SAME_ROW: // 13 - same row as source
        for (const { row, col } of allCards) if (row === srcRow) results.push({ row, col });
        break;

      case AF.BOMBER: // 14 - bomber pattern (cross shape)
        for (const { row, col } of allCards)
          if (row === srcRow || col === srcCol) results.push({ row, col });
        break;

      case AF.SURROUNDING: // 15 - up to 8 cells around source
        for (const { row, col } of allCards) {
          if (row === srcRow && col === srcCol) continue;
          const colDiff = Math.abs(col - srcCol);
          if (colDiff > 1) continue;
          if (row === srcRow) { results.push({ row, col }); continue; }
          if (ROW_NEIGHBORS[srcRow].includes(row)) {
            results.push({ row, col });
          }
        }
        break;

      case AF.NEXT_TO: // 16 - same row, col ±1
        for (const { row, col } of allCards) {
          if (row === srcRow && Math.abs(col - srcCol) === 1)
            results.push({ row, col });
        }
        break;

      case AF.BELOW: // 17 - below in same column
        for (const { row, col } of allCards) {
          if (col === srcCol && row > srcRow) results.push({ row, col });
        }
        break;

      case AF.COL_TO_RIGHT: // 18 - column to the right
        for (const { row, col } of allCards) {
          if (col === srcCol + 1) results.push({ row, col });
        }
        break;

      case AF.COL_TO_LEFT: // 19 - column to the left
        for (const { row, col } of allCards) {
          if (col === srcCol - 1) results.push({ row, col });
        }
        break;

      case AF.OWNER_PLAYER: // 20
      case AF.OPPONENT_PLAYER: // 21
        break;

      case AF.IGNORE_SELECTED: // 22
        for (const { row, col } of allCards) results.push({ row, col });
        break;

      default:
        for (const { row, col } of allCards) results.push({ row, col });
    }

    return results;
  }

  // ---- Ability Execution ----
  function executeAbility(state, ability, sourceRow, sourceCol, sourcePlayer, trigger, context) {
    const type = ability.type;

    // Check once-per-round
    if (ability.is_limited_to_once_a_day) {
      const key = `${sourceRow},${sourceCol},${type},${trigger}`;
      if (state.oncePerRound.has(key)) return;
      state.oncePerRound.add(key);
    }

    const filtersInc = ability.affect_filters_inclusive || [];
    const filtersExc = ability.affect_filters_exclusive || [];

    switch (type) {
      case 'AddHealthAbility':
        execAddHealth(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'ApplyDamageAbility':
        execApplyDamage(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'ApplyDamageOnRandomCardsAbility':
        execApplyDamageRandom(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'RemoveCardAbility':
        execRemoveCard(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'DestroyCardAbility':
        execDestroyCard(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'SpawnFriendAbility':
        execSpawnFriend(state, ability, sourceRow, sourceCol, sourcePlayer);
        break;
      case 'GlitchAbility':
        execGlitch(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'FractureAbility':
        execFracture(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'AddBloomAbility':
        execAddBloom(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'ChangeHeartsInBankAbility':
        execChangeHearts(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'SetHealthAbility':
        execSetHealth(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'HackAbility':
        execHack(state, ability, sourceRow, sourceCol, sourcePlayer, filtersInc, filtersExc, context);
        break;
      case 'MoveCardAbility':
        // Complex - skip for basic sim
        state.log.push(`  [SKIP] MoveCardAbility (complex, not simulated)`);
        break;
      case 'DrawCardAbility':
      case 'ReceiveCardAbility':
        // Drawing cards doesn't affect board state in puzzle context (1 round, no further plays after solution)
        state.log.push(`  [INFO] ${type} (card draw - no board effect in puzzle)`);
        break;
      case 'AdjustIncomeAbility':
      case 'AdjustCoinsAbility':
      case 'FreezeBusinessAbility':
      case 'SetBusinessMaxEnergizationAbility':
      case 'SetBusinessResultAbility':
      case 'EjectCardAbility':
      case 'CopyFriendAbility':
      case 'ResetCardAbility':
      case 'RemainPlayersTurnAbility':
      case 'AbsorbAbility':
      case 'PreventNovaCollectionAbility':
      case 'TriggerOnPlayAbility':
      case 'TransformCardAbility':
      case 'UnGlitchAbility':
      case 'ModifyHealthByPercentageAbility':
      case 'BloomAbility':
      case 'TriggerBloomAbility':
      case 'AddHealthBasedOnFriendCount':
        state.log.push(`  [SKIP] ${type} (not fully simulated)`);
        break;
      default:
        state.log.push(`  [SKIP] Unknown ability: ${type}`);
    }
  }

  function execAddHealth(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const amount = ability.health_to_add || 0;
    if (amount === 0) return;

    // Check conditional
    const srcCell = getCell(state, srcRow, srcCol);
    if (ability.add_health_if_health_over && srcCell && srcCell.hp <= ability.add_health_if_health_over) return;
    if (ability.DamageIfHealthOver && srcCell && srcCell.hp <= ability.DamageIfHealthOver) return;

    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      // Check health filters
      if (ability.max_health_filter && cell.hp > ability.max_health_filter) continue;
      if (ability.min_health_filter && cell.hp < ability.min_health_filter) continue;
      cell.hp += amount;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: +${amount}HP -> ${cell.hp}HP`);
    }
  }

  function execApplyDamage(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const dmg = ability.damage || 0;
    if (dmg === 0) return;

    // Check conditionals
    const srcCell = getCell(state, srcRow, srcCol);
    if (ability.DamageIfHealthOver && srcCell && srcCell.hp <= ability.DamageIfHealthOver) return;
    if (ability.ApplyOnSourceEvenHealth && srcCell && srcCell.hp % 2 !== 0) return;
    if (ability.ApplyOnSourceOddHealth && srcCell && srcCell.hp % 2 !== 1) return;

    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      if (ability.max_health_filter && cell.hp > ability.max_health_filter) continue;
      if (ability.min_health_filter && cell.hp < ability.min_health_filter) continue;
      cell.hp -= dmg;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: -${dmg}HP -> ${cell.hp}HP`);
      if (cell.hp <= 0) {
        destroyCard(state, row, col);
      }
    }
  }

  function execApplyDamageRandom(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const dmg = ability.damage || 1;
    const count = ability.count || 1;
    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (let i = 0; i < count; i++) {
      const alive = targets.filter(({ row, col }) => {
        const cell = getCell(state, row, col);
        return cell && cell.hp > 0;
      });
      if (alive.length === 0) break;
      const pick = alive[Math.floor(Math.random() * alive.length)];
      const cell = getCell(state, pick.row, pick.col);
      if (!cell) continue;
      cell.hp -= dmg;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[pick.row]}${pick.col}: -${dmg}HP (random) -> ${cell.hp}HP`);
      if (cell.hp <= 0) {
        destroyCard(state, pick.row, pick.col);
      }
    }
  }

  function execRemoveCard(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      if (ability.max_health_filter !== undefined && cell.hp > ability.max_health_filter) continue;
      if (ability.min_health_filter !== undefined && cell.hp < ability.min_health_filter) continue;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: DELETED (${cell.hp}HP)`);
      setCell(state, row, col, null); // Remove does NOT trigger OnDestroyed
    }
  }

  function execDestroyCard(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    let targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    // Health filters
    targets = targets.filter(({ row, col }) => {
      const cell = getCell(state, row, col);
      if (!cell) return false;
      if (ability.max_health_filter !== undefined && cell.hp > ability.max_health_filter) return false;
      if (ability.min_health_filter !== undefined && cell.hp < ability.min_health_filter) return false;
      return true;
    });
    if (ability.is_random && targets.length > 0) {
      targets = [targets[Math.floor(Math.random() * targets.length)]];
    }
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: DESTROYED`);
      destroyCard(state, row, col);
    }
  }

  function execSpawnFriend(state, ability, srcRow, srcCol, srcPlayer) {
    const cardToSpawn = ability.card_to_spawn || 0;
    const count = ability.count || 1;
    const isOpponent = ability.is_for_opponent || false;
    const owner = isOpponent ? (1 - srcPlayer) : srcPlayer;

    const spawnInc = ability.spawn_filters_inclusive || [1];
    const spawnExc = ability.spawn_filters_exclusive || [];

    for (let i = 0; i < count; i++) {
      // Find empty spots matching spawn filters
      const empties = findEmptySpots(state, spawnInc, spawnExc, srcRow, srcCol);
      if (empties.length === 0) break;

      // Pick highest % spot (or random)
      const spot = ability.is_highest_percent ? empties[0] : empties[Math.floor(Math.random() * empties.length)];

      let spawnId = cardToSpawn;
      if (spawnId === 0) {
        // Random spawn based on cost/class/type filters - use a default
        spawnId = 100; // DC as fallback
        state.log.push(`  [APPROX] Random spawn -> using DC as placeholder`);
      }

      const spawnData = getCardData(spawnId);
      const hp = spawnData ? spawnData.hp + (ability.starting_health_change || 0) : 1;

      const newCell = {
        cardId: spawnId,
        player: owner,
        hp: hp,
        maxHp: hp,
        isGlitched: false,
        isFractured: false,
        bloom: 0,
        instanceId: state.nextInstanceId++,
      };
      setCell(state, spot.row, spot.col, newCell);
      state.log.push(`  Spawned ${getDisplayName(spawnId)} at ${ROW_CODE[spot.row]}${spot.col} (${hp}HP, ${owner === 0 ? 'Player' : 'Bot'})`);
    }
  }

  function execGlitch(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      cell.isGlitched = true;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: GLITCHED`);
    }
  }

  function execFracture(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      cell.isFractured = true;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: FRACTURED`);
    }
  }

  function execAddBloom(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const bloom = ability.bloom_to_add || 0;
    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      cell.bloom = (cell.bloom || 0) + bloom;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: +${bloom} Bloom -> ${cell.bloom}`);
    }
  }

  function execChangeHearts(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    // Zap/add novas to player score
    const amount = -(ability.hearts_to_remove || 0);
    const isOpponent = inc.includes(AF.OPPONENT_PLAYER);
    if (isOpponent) {
      const oppPlayer = 1 - srcPlayer;
      if (oppPlayer === 0) { state.playerScore += amount; }
      else { state.botScore += amount; }
      state.log.push(`  Zapped ${-amount} Novas from ${oppPlayer === 0 ? 'Player' : 'Bot'} score`);
    } else {
      if (srcPlayer === 0) { state.playerScore += amount; }
      else { state.botScore += amount; }
    }
  }

  function execSetHealth(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    const newHp = ability.new_health || 1;
    const targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    for (const { row, col } of targets) {
      const cell = getCell(state, row, col);
      if (!cell) continue;
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: HP set to ${newHp} (was ${cell.hp})`);
      cell.hp = newHp;
    }
  }

  function execHack(state, ability, srcRow, srcCol, srcPlayer, inc, exc, context) {
    // Hack: take control of an enemy card
    let targets = resolveTargets(state, srcRow, srcCol, srcPlayer, inc, exc, context);
    targets = targets.filter(({ row, col }) => {
      const cell = getCell(state, row, col);
      if (!cell) return false;
      if (ability.max_health_filter !== undefined && cell.hp > ability.max_health_filter) return false;
      return true;
    });
    if (targets.length === 0) return;
    const pick = ability.is_random || ability.IsRandomHack
      ? targets[Math.floor(Math.random() * targets.length)]
      : targets[0];
    const cell = getCell(state, pick.row, pick.col);
    if (cell) {
      state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[pick.row]}${pick.col}: HACKED (now ${srcPlayer === 0 ? 'Player' : 'Bot'})`);
      cell.player = srcPlayer;
    }
  }

  // ---- Card Destruction (triggers OnDestroyed) ----
  function destroyCard(state, row, col) {
    const cell = getCell(state, row, col);
    if (!cell) return;

    state.log.push(`  ${getDisplayName(cell.cardId)} at ${ROW_CODE[row]}${col}: destroyed (0HP)`);
    const cardId = cell.cardId;
    const player = cell.player;
    const instanceId = cell.instanceId;

    setCell(state, row, col, null);

    // Trigger OnThisCardDestroyed abilities
    const abilities = getCardAbilities(cardId);
    if (abilities) {
      for (const ab of abilities) {
        if (triggersOn(ab, T.THIS_DESTROYED)) {
          state.log.push(`  -> ${getDisplayName(cardId)} OnDestroyed triggers`);
          executeAbility(state, ab, row, col, player, T.THIS_DESTROYED);
        }
      }
    }

    // Trigger OnOtherCardDestroyed for all other allies on board
    for (const bc of allBoardCards(state)) {
      if (bc.cell.player === player) {
        const otherAbilities = getCardAbilities(bc.cell.cardId);
        if (otherAbilities) {
          for (const ab of otherAbilities) {
            if (triggersOn(ab, T.OTHER_DESTROYED, { owner: 1, type: 1, cls: 0 })) {
              state.log.push(`  -> ${getDisplayName(bc.cell.cardId)} OnOtherDestroyed triggers`);
              executeAbility(state, ab, bc.row, bc.col, bc.cell.player, T.OTHER_DESTROYED);
            }
          }
        }
      }
    }
  }

  // ---- Find empty spots for spawning ----
  function findEmptySpots(state, filtersInc, filtersExc, srcRow, srcCol) {
    const empties = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (state.board[r][c]) continue; // occupied
        const slotId = ROW_SLOT_ID[r];
        // Check inclusive: must match at least one
        let incMatch = filtersInc.length === 0;
        for (const f of filtersInc) {
          if (f === 0 || f === 1) { incMatch = true; break; }
          if (f === slotId) { incMatch = true; break; }
          if (f === 6 && r === ROW.B) { incMatch = true; break; }
          if (f === 7 && r === ROW.L) { incMatch = true; break; }
          if (f === 8 && r === ROW.M) { incMatch = true; break; }
          if (f === 9 && r === ROW.P) { incMatch = true; break; }
          if (f === 12 && c === srcCol) { incMatch = true; break; }
          if (f === 15) { // surrounding empty spots
            const colDiff = Math.abs(c - srcCol);
            if (colDiff <= 1 && (r === srcRow || ROW_NEIGHBORS[srcRow].includes(r))) {
              incMatch = true; break;
            }
          }
          if (f === 16) { // next to
            if (r === srcRow && Math.abs(c - srcCol) === 1) { incMatch = true; break; }
          }
        }
        if (!incMatch) continue;
        // Check exclusive
        let excMatch = false;
        for (const f of filtersExc) {
          if (f === 1 && state.board[r][c]) { excMatch = true; break; } // occupied
          if (f === slotId) { excMatch = true; break; }
          if (f === 6 && r === ROW.B) { excMatch = true; break; }
          if (f === 7 && r === ROW.L) { excMatch = true; break; }
          if (f === 8 && r === ROW.M) { excMatch = true; break; }
          if (f === 9 && r === ROW.P) { excMatch = true; break; }
        }
        if (excMatch) continue;
        empties.push({ row: r, col: c });
      }
    }
    return empties;
  }

  // ---- Trigger Matching ----
  function triggersOn(ability, triggerType, context) {
    const triggers = ability.triggers || [];
    for (const t of triggers) {
      if (t.trigger === triggerType) {
        // Check owner filter: 0=any, 1=allied, 2=opponent
        if (context && t.card_owner_filter) {
          if (t.card_owner_filter === 1 && context.isOpponent) return false;
          if (t.card_owner_filter === 2 && !context.isOpponent) return false;
        }
        // Check card type filter (1=Friend, 2=Power)
        if (context && t.card_type_filter && t.card_type_filter.length > 0) {
          if (!t.card_type_filter.includes(context.cardType)) return false;
        }
        // Check card class filter
        if (context && t.card_class_filter && t.card_class_filter > 0) {
          if (context.cardClass !== t.card_class_filter) return false;
        }
        return true;
      }
    }
    return false;
  }

  // ---- Place a Friend Card ----
  function placeFriend(state, cardId, row, col, player) {
    const cardData = getCardData(cardId);
    if (!cardData) {
      state.log.push(`ERROR: Card ${cardId} not found in CARD_DATA`);
      return false;
    }

    // Check if spot is empty
    if (state.board[row][col]) {
      state.log.push(`ERROR: Cannot place ${getDisplayName(cardId)} at ${ROW_CODE[row]}${col} — spot is occupied by ${getDisplayName(state.board[row][col].cardId)}`);
      return false;
    }

    // Check slot restrictions
    const slotId = ROW_SLOT_ID[row];
    const si = cardData.si || [];
    if (si.length > 0 && !si.includes(1) && !si.includes(0) && !si.includes(slotId)) {
      state.log.push(`ERROR: ${getDisplayName(cardId)} cannot be placed in ${ROW_NAME[row]} (si=${JSON.stringify(si)})`);
      return false;
    }

    // Check cost
    const cost = cardData.cost || 0;
    if (player === 0 && state.playerCoins < cost) {
      state.log.push(`ERROR: Not enough coins for ${getDisplayName(cardId)} (need ${cost}, have ${state.playerCoins})`);
      return false;
    }

    // Place it
    if (player === 0) state.playerCoins -= cost;
    const cell = {
      cardId,
      player,
      hp: cardData.hp,
      maxHp: cardData.hp,
      isGlitched: false,
      isFractured: false,
      bloom: 0,
      instanceId: state.nextInstanceId++,
    };
    setCell(state, row, col, cell);
    state.log.push(`Placed ${getDisplayName(cardId)} at ${ROW_CODE[row]}${col} (${cardData.hp}HP, cost ${cost}, ${state.playerCoins} coins left)`);

    // Fire OnPlay abilities
    fireTriggersForCard(state, cardId, row, col, player, T.ON_PLAY);

    // Fire OnPlayedOtherCardAfterOnPlay for all other allies
    for (const bc of allBoardCards(state)) {
      if (bc.row === row && bc.col === col) continue; // skip self
      if (bc.cell.player === player) {
        const otherAbilities = getCardAbilities(bc.cell.cardId);
        if (otherAbilities) {
          for (const ab of otherAbilities) {
            if (triggersOn(ab, T.ON_PLAY_OTHER_AFTER)) {
              // Check class filter
              const trigger = ab.triggers.find(t => t.trigger === T.ON_PLAY_OTHER_AFTER);
              if (trigger) {
                if (trigger.card_owner_filter === 2) continue; // opponent only
                if (trigger.card_type_filter && trigger.card_type_filter.length > 0 && !trigger.card_type_filter.includes(1)) continue;
                if (trigger.card_class_filter && trigger.card_class_filter > 0 && trigger.card_class_filter !== cardData.cls) continue;
              }
              state.log.push(`  -> ${getDisplayName(bc.cell.cardId)} reacts to ally played`);
              executeAbility(state, ab, bc.row, bc.col, bc.cell.player, T.ON_PLAY_OTHER_AFTER, {otherRow: row, otherCol: col});
            }
          }
        }
      }
    }

    return true;
  }

  // ---- Play a Power Card ----
  function playPower(state, cardId, player, targetRow, targetCol) {
    const cardData = getCardData(cardId);
    if (!cardData) {
      state.log.push(`ERROR: Power ${cardId} not found in CARD_DATA`);
      return false;
    }

    const cost = cardData.cost || 0;
    if (player === 0 && state.playerCoins < cost) {
      state.log.push(`ERROR: Not enough coins for ${getDisplayName(cardId)} (need ${cost}, have ${state.playerCoins})`);
      return false;
    }

    if (player === 0) state.playerCoins -= cost;
    state.log.push(`Played Power ${getDisplayName(cardId)} (cost ${cost}, ${state.playerCoins} coins left)`);

    // For powers, we use targetRow/targetCol as the "source" position for filter resolution
    // This determines things like "same column" and "surrounding"
    const srcRow = targetRow !== undefined ? targetRow : 0;
    const srcCol = targetCol !== undefined ? targetCol : 0;

    // Fire abilities
    const abilities = getCardAbilities(cardId);
    if (abilities) {
      for (const ab of abilities) {
        if (triggersOn(ab, T.ON_PLAY)) {
          executeAbility(state, ab, srcRow, srcCol, player, T.ON_PLAY);
        }
      }
    }

    // Fire OnPlayedOtherCardBeforeOnPlay / AfterOnPlay for allies that react to powers
    for (const bc of allBoardCards(state)) {
      if (bc.cell.player === player) {
        const otherAbilities = getCardAbilities(bc.cell.cardId);
        if (otherAbilities) {
          for (const ab of otherAbilities) {
            // Check for "when you play any Power" triggers
            for (const trigger of (ab.triggers || [])) {
              if ((trigger.trigger === T.ON_PLAY_OTHER_BEFORE || trigger.trigger === T.ON_PLAY_OTHER_AFTER) &&
                  trigger.card_type_filter && trigger.card_type_filter.includes(2)) {
                if (trigger.card_owner_filter === 2) continue; // opponent powers only
                state.log.push(`  -> ${getDisplayName(bc.cell.cardId)} reacts to power played`);
                executeAbility(state, ab, bc.row, bc.col, bc.cell.player, trigger.trigger, {otherRow: srcRow, otherCol: srcCol});
              }
            }
          }
        }
      }
    }

    return true;
  }

  function fireTriggersForCard(state, cardId, row, col, player, triggerType) {
    const abilities = getCardAbilities(cardId);
    if (!abilities) return;
    for (const ab of abilities) {
      if (triggersOn(ab, triggerType)) {
        executeAbility(state, ab, row, col, player, triggerType);
      }
    }
  }

  // ---- Energizing Phase ----
  function runEnergizing(state) {
    state.log.push(`\n=== ENERGIZING PHASE ===`);

    // Fire StartOfEnergizing triggers
    for (const bc of allBoardCards(state)) {
      fireTriggersForCard(state, bc.cell.cardId, bc.row, bc.col, bc.cell.player, T.START_ENERGIZING);
    }

    // Process columns left to right, within each column bottom to top
    // Activation level 3 = Lobby + Mezz energize
    let playerNovasFromEnergizing = 0;
    let botNovasFromEnergizing = 0;

    for (let c = 0; c < 4; c++) {
      const level = state.activationLevels[c] || 0;
      // Activation levels: 0=none, 1=none, 2=Lobby, 3=Lobby+Mezz, 4=Lobby+Mezz+Penthouse
      // Basement NEVER energizes (it's isolated)
      const energizingRows = [];
      if (level >= 2) energizingRows.push(ROW.L);
      if (level >= 3) energizingRows.push(ROW.M);
      if (level >= 4) energizingRows.push(ROW.P);

      // Process bottom to top: Lobby first, then Mezz, then Penthouse
      const ordered = energizingRows.sort((a, b) => b - a); // higher row index = lower on board = first

      for (const row of ordered) {
        const cell = getCell(state, row, c);
        if (!cell) continue;

        // Fire OnThisCardActivated trigger
        fireTriggersForCard(state, cell.cardId, row, c, cell.player, T.THIS_ENERGIZED);

        // Check if card still exists (might have been destroyed by trigger)
        const cellAfter = getCell(state, row, c);
        if (!cellAfter) continue;

        if (cellAfter.isGlitched) {
          state.log.push(`${ROW_CODE[row]}${c}: ${getDisplayName(cellAfter.cardId)} is GLITCHED — 0 Novas`);
          continue;
        }

        const novas = cellAfter.hp;
        const collector = cellAfter.isFractured ? (1 - cellAfter.player) : cellAfter.player;

        if (collector === 0) playerNovasFromEnergizing += novas;
        else botNovasFromEnergizing += novas;

        const fracNote = cellAfter.isFractured ? ' (FRACTURED -> opponent)' : '';
        state.log.push(`${ROW_CODE[row]}${c}: ${getDisplayName(cellAfter.cardId)} energizes for ${novas} Novas -> ${collector === 0 ? 'Player' : 'Bot'}${fracNote}`);
      }
    }

    state.playerScore += playerNovasFromEnergizing;
    state.botScore += botNovasFromEnergizing;

    state.log.push(`\n=== FINAL SCORES ===`);
    state.log.push(`Player: ${state.playerScore} Novas (starting + ${playerNovasFromEnergizing} from energizing)`);
    state.log.push(`Bot: ${state.botScore} Novas (starting + ${botNovasFromEnergizing} from energizing)`);

    return { playerNovasFromEnergizing, botNovasFromEnergizing };
  }

  // ---- Main Simulation Entry Point ----
  // actions: array of {type: 'friend'|'power', cardId, row, col, targetRow, targetCol}
  function simulate(boardSetup, playerHand, botHand, playerCoins, playerScore, botScore, activationLevels, actions) {
    // Initialize board from setup
    const board = createBoard();
    let nextId = 1;
    for (const item of boardSetup) {
      const cardData = getCardData(item.cardId);
      board[item.row][item.col] = {
        cardId: item.cardId,
        player: item.player,
        hp: cardData ? cardData.hp : 1,
        maxHp: cardData ? cardData.hp : 1,
        isGlitched: false,
        isFractured: false,
        bloom: 0,
        instanceId: nextId++,
      };
    }

    const state = createSimState(board, playerHand, botHand, playerCoins, playerScore, botScore, activationLevels);
    state.nextInstanceId = nextId;
    state.log.push(`=== PUZZLE SIMULATION ===`);
    state.log.push(`Player coins: ${playerCoins}, Player start score: ${playerScore}, Bot start score: ${botScore}`);
    state.log.push(`Activation levels: [${activationLevels.join(',')}]`);
    state.log.push(``);

    // Execute player actions
    state.log.push(`=== PLAYER ACTIONS ===`);
    for (const action of actions) {
      if (action.type === 'friend') {
        placeFriend(state, action.cardId, action.row, action.col, 0);
      } else if (action.type === 'power') {
        playPower(state, action.cardId, 0, action.targetRow, action.targetCol);
      }
      state.log.push(``);
    }

    // Run energizing
    const energizeResult = runEnergizing(state);

    return {
      playerScore: state.playerScore,
      botScore: state.botScore,
      playerCoins: state.playerCoins,
      log: state.log,
      board: state.board,
      energizeResult,
    };
  }

  // ---- Quick Validate: just compute energizing from current board (no actions) ----
  function quickValidate(boardSetup, playerScore, botScore, activationLevels) {
    const board = createBoard();
    let nextId = 1;
    for (const item of boardSetup) {
      const cardData = getCardData(item.cardId);
      board[item.row][item.col] = {
        cardId: item.cardId,
        player: item.player,
        hp: cardData ? cardData.hp : 1,
        maxHp: cardData ? cardData.hp : 1,
        isGlitched: false,
        isFractured: false,
        bloom: 0,
        instanceId: nextId++,
      };
    }

    const state = createSimState(board, [], [], 0, playerScore, botScore, activationLevels);
    state.nextInstanceId = nextId;

    // Just run energizing on current board state
    state.log.push(`=== QUICK VALIDATE (board as-is, no actions) ===`);
    const result = runEnergizing(state);

    return {
      playerScore: state.playerScore,
      botScore: state.botScore,
      log: state.log,
    };
  }

  return { simulate, quickValidate, placeFriend, playPower, runEnergizing, createSimState, createBoard, getCardData, getDisplayName, ROW, ROW_CODE, ROW_NAME };
})();
