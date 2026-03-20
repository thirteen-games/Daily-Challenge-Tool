"""Add puzzle simulator and validate button to the HTML tool."""
import json

HTML_PATH = r'C:\Users\danpe\OneDrive\Documents\GitHub\daily-challenge-tool\daily-challenge-tool.html'
SIM_PATH = r'C:\Users\danpe\OneDrive\Documents\GitHub\daily-challenge-tool\puzzle-simulator.js'
ABILITIES_PATH = r'C:\Users\danpe\OneDrive\Documents\GitHub\daily-challenge-tool\card-abilities.json'

with open(HTML_PATH, 'r', encoding='utf-8') as f:
    html = f.read()

with open(SIM_PATH, 'r', encoding='utf-8') as f:
    sim_js = f.read()

with open(ABILITIES_PATH, 'r', encoding='utf-8') as f:
    abilities_json = f.read()

# ============================================================
# 1. Add CARD_ABILITIES data and make it accessible to simulator
# ============================================================
# Add after CARD_DATA declaration
card_abilities_js = f'\nconst CARD_ABILITIES = {abilities_json};\n'
card_abilities_js += '\n// Make abilities accessible to simulator\nwindow._cardAbilities = CARD_ABILITIES;\n'

html = html.replace(
    'const CARD_CLASS_NAMES = {',
    card_abilities_js + 'const CARD_CLASS_NAMES = {'
)
print("1. Added CARD_ABILITIES data")

# ============================================================
# 2. Add simulator code before puzzle mode section
# ============================================================
html = html.replace(
    '// ============================================================\n// PUZZLE MODE\n// ============================================================',
    sim_js + '\n\n// ============================================================\n// PUZZLE MODE\n// ============================================================'
)
print("2. Added puzzle simulator code")

# ============================================================
# 3. Add Validate button to puzzle sidebar
# ============================================================
html = html.replace(
    """    <div class="btn-row">
      <button class="btn btn-danger btn-block" onclick="clearPuzzle()">🗑️ Clear Board</button>
    </div>
  </div>""",
    """    <div class="btn-row">
      <button class="btn btn-primary btn-block" onclick="validatePuzzle()">✅ Validate Puzzle</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-danger btn-block" onclick="clearPuzzle()">🗑️ Clear Board</button>
    </div>

    <div id="validationResult" style="display:none;margin-top:12px;padding:10px;border-radius:8px;font-size:12px;line-height:1.6;max-height:300px;overflow-y:auto;white-space:pre-wrap;font-family:'Cascadia Code','Consolas',monospace;"></div>
  </div>"""
)
print("3. Added Validate button and result area")

# ============================================================
# 4. Add validatePuzzle() function
# ============================================================
validate_fn = '''
// ---- Puzzle Validation ----
function validatePuzzle() {
  const resultEl = document.getElementById('validationResult');
  resultEl.style.display = 'block';

  // Build board setup from puzzleState
  const boardSetup = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cell = puzzleState.board[r][c];
      if (cell) {
        boardSetup.push({ cardId: cell.cardId, row: r, col: c, player: cell.player });
      }
    }
  }

  const playerScore = parseInt(document.getElementById('puzzlePlayerScore').value) || 0;
  const botScore = parseInt(document.getElementById('puzzleBotScore').value) || 0;
  const novasToWin = parseInt(document.getElementById('puzzleNovasToWin').value) || 20;
  const actLevels = [
    parseInt(document.getElementById('actLevel0').value) || 0,
    parseInt(document.getElementById('actLevel1').value) || 0,
    parseInt(document.getElementById('actLevel2').value) || 0,
    parseInt(document.getElementById('actLevel3').value) || 0,
  ];

  // Quick validate: just compute energizing from current board state
  const result = PuzzleSim.quickValidate(boardSetup, playerScore, botScore, actLevels);

  // Also compute what player could get by placing hand cards
  let handInfo = '';
  if (puzzleState.playerHand.length > 0) {
    const playerCoins = parseInt(document.getElementById('puzzlePlayerCoins').value) || 0;
    let totalHandCost = 0;
    let totalHandHp = 0;
    handInfo += '\\nPlayer Hand Cards:\\n';
    for (const cardId of puzzleState.playerHand) {
      const d = CARD_DATA[cardId];
      const name = PuzzleSim.getDisplayName(cardId);
      if (d) {
        handInfo += `  ${name}: Cost=${d.cost}, HP=${d.hp}`;
        if (d.hp > 0) handInfo += ' (Friend)';
        else handInfo += ' (Power)';
        handInfo += '\\n';
        totalHandCost += d.cost;
        totalHandHp += d.hp;
      }
    }
    handInfo += `  Total hand cost: ${totalHandCost} (budget: ${playerCoins} coins)\\n`;
    if (totalHandCost > playerCoins) {
      handInfo += `  ⚠️ Cannot afford all cards! Over budget by ${totalHandCost - playerCoins}\\n`;
    }
    handInfo += `  Total Friend HP in hand: ${totalHandHp} (max additional Novas if all placed in L/M)\\n`;
    handInfo += `  Theoretical max player score: ${result.playerScore + totalHandHp}\\n`;
  }

  // Build output
  let output = result.log.join('\\n');
  output += handInfo;
  output += '\\n\\n=== PUZZLE CHECK ===\\n';
  output += `NovasToWin: ${novasToWin}\\n`;
  output += `Board-only Player Novas: ${result.playerScore}\\n`;
  output += `Board-only Bot Novas: ${result.botScore}\\n`;

  const pWins = result.playerScore >= novasToWin && result.playerScore === result.botScore + 1;
  if (pWins) {
    output += '✅ Player wins by exactly 1 Nova from board alone!\\n';
    resultEl.style.background = 'rgba(0,184,148,0.15)';
    resultEl.style.borderColor = 'var(--success)';
    resultEl.style.border = '1px solid var(--success)';
    resultEl.style.color = 'var(--success)';
  } else {
    output += `❌ Board-only result: Player ${result.playerScore} vs Bot ${result.botScore} (need Player = Bot + 1 and >= ${novasToWin})\\n`;
    if (puzzleState.playerHand.length > 0) {
      output += '(Player still has hand cards to play — place them on the board to see full result)\\n';
    }
    resultEl.style.background = 'rgba(225,112,85,0.15)';
    resultEl.style.border = '1px solid var(--danger)';
    resultEl.style.color = 'var(--danger)';
  }

  resultEl.textContent = output;
}
'''

html = html.replace(
    '// ---- Puzzle AI ----',
    validate_fn + '\n// ---- Puzzle AI ----'
)
print("4. Added validatePuzzle() function")

with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html)

print(f"\nAll done! File size: {len(html)}")
