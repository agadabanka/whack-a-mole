/**
 * Whack-a-Mole — TypeScript IL game spec using @engine SDK.
 *
 * 3x3 grid of holes. Moles pop up randomly and stay briefly.
 * Player clicks/selects to whack them. Score per hit, 60-second timer.
 * Speed increases over time. AI whacks with high accuracy.
 */

import { defineGame } from '@engine/core';
import { consumeAction } from '@engine/input';
import {
  clearCanvas, drawRoundedRect, drawCircle,
  drawLabel, drawGameOver,
} from '@engine/render';
import { drawTouchOverlay } from '@engine/touch';

// ── Constants ───────────────────────────────────────────────────────

var CANVAS_W = 420;
var CANVAS_H = 500;

var GRID_ROWS = 3;
var GRID_COLS = 3;
var HOLE_W = 90;
var HOLE_H = 70;
var HOLE_GAP_X = 20;
var HOLE_GAP_Y = 25;
var GRID_START_X = (CANVAS_W - (GRID_COLS * HOLE_W + (GRID_COLS - 1) * HOLE_GAP_X)) / 2;
var GRID_START_Y = 120;

var GAME_DURATION = 60000; // 60 seconds
var MOLE_SHOW_MIN = 600;
var MOLE_SHOW_MAX = 1400;
var MOLE_INTERVAL_MIN = 400;
var MOLE_INTERVAL_MAX = 1200;
var POINTS_PER_WHACK = 10;
var MISS_PENALTY = -2;

var BG_COLOR = '#2E7D32';
var DIRT_COLOR = '#5D4037';
var HOLE_COLOR = '#3E2723';
var MOLE_COLOR = '#8D6E63';
var MOLE_NOSE_COLOR = '#D81B60';
var MOLE_EYE_COLOR = '#212121';
var WHACKED_COLOR = '#FDD835';
var CURSOR_COLOR = '#FFEB3B';

var AI_REACTION_MIN = 80;
var AI_REACTION_MAX = 250;

// ── Game Definition ─────────────────────────────────────────────────

var game = defineGame({
  display: {
    type: 'custom',
    width: 14,
    height: 16,
    cellSize: 30,
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    offsetX: 0,
    offsetY: 0,
    background: BG_COLOR,
  },
  input: {
    up:      { keys: ['ArrowUp', 'w'] },
    down:    { keys: ['ArrowDown', 's'] },
    left:    { keys: ['ArrowLeft', 'a'] },
    right:   { keys: ['ArrowRight', 'd'] },
    select:  { keys: [' ', 'Enter'] },
    restart: { keys: ['r', 'R'] },
  },
});

// ── Resources ───────────────────────────────────────────────────────

game.resource('state', {
  score: 0,
  gameOver: false,
  timeLeft: GAME_DURATION,
  hits: 0,
  misses: 0,
  message: 'Whack the moles!',
  started: false,
});

game.resource('board', {
  holes: [],        // [row][col] = { moleUp, showTimer, whacked, whackTimer }
  spawnTimer: 0,
  initialized: false,
});

game.resource('_cursor', { row: 1, col: 1 });

game.resource('_aiTimer', { elapsed: 0, reactionTarget: 150 });

// ── Init System ─────────────────────────────────────────────────────

game.system('init', function initSystem(world, _dt) {
  var board = world.getResource('board');
  if (board.initialized) return;
  board.initialized = true;

  board.holes = [];
  for (var r = 0; r < GRID_ROWS; r++) {
    var row = [];
    for (var c = 0; c < GRID_COLS; c++) {
      row.push({
        moleUp: false,
        showTimer: 0,
        showDuration: 0,
        whacked: false,
        whackTimer: 0,
      });
    }
    board.holes.push(row);
  }
  board.spawnTimer = 500;
});

// ── Restart System ──────────────────────────────────────────────────

game.system('restart', function restartSystem(world, _dt) {
  var input = world.getResource('input');
  var state = world.getResource('state');

  if (consumeAction(input, 'restart') && state.gameOver) {
    state.score = 0;
    state.gameOver = false;
    state.timeLeft = GAME_DURATION;
    state.hits = 0;
    state.misses = 0;
    state.message = 'Whack the moles!';
    state.started = false;

    var board = world.getResource('board');
    board.initialized = false;

    var timer = world.getResource('_aiTimer');
    timer.elapsed = 0;
  }
});

// ── Mole Spawn System ───────────────────────────────────────────────

game.system('moleSpawn', function moleSpawnSystem(world, dt) {
  var state = world.getResource('state');
  if (state.gameOver) return;

  var board = world.getResource('board');
  if (!board.initialized) return;

  // Time progression factor (0 to 1 over game duration)
  var progress = 1 - (state.timeLeft / GAME_DURATION);
  var speedFactor = 1 + progress * 1.5;

  // Update active moles
  for (var r = 0; r < GRID_ROWS; r++) {
    for (var c = 0; c < GRID_COLS; c++) {
      var hole = board.holes[r][c];

      // Whack animation timer
      if (hole.whacked) {
        hole.whackTimer -= dt;
        if (hole.whackTimer <= 0) {
          hole.whacked = false;
          hole.moleUp = false;
        }
        continue;
      }

      // Mole showing timer
      if (hole.moleUp) {
        hole.showTimer -= dt;
        if (hole.showTimer <= 0) {
          hole.moleUp = false;
          // Missed mole
          state.misses++;
        }
      }
    }
  }

  // Spawn new moles
  board.spawnTimer -= dt;
  if (board.spawnTimer <= 0) {
    var interval = MOLE_INTERVAL_MAX - (MOLE_INTERVAL_MAX - MOLE_INTERVAL_MIN) * progress;
    board.spawnTimer = interval;

    // Find available holes
    var available = [];
    for (var r2 = 0; r2 < GRID_ROWS; r2++) {
      for (var c2 = 0; c2 < GRID_COLS; c2++) {
        if (!board.holes[r2][c2].moleUp && !board.holes[r2][c2].whacked) {
          available.push({ r: r2, c: c2 });
        }
      }
    }

    // Spawn 1-2 moles depending on progress
    var count = progress > 0.5 ? 2 : 1;
    for (var i = 0; i < count && available.length > 0; i++) {
      var idx = Math.floor(Math.random() * available.length);
      var pos = available.splice(idx, 1)[0];
      var hole2 = board.holes[pos.r][pos.c];
      hole2.moleUp = true;
      var showTime = MOLE_SHOW_MAX - (MOLE_SHOW_MAX - MOLE_SHOW_MIN) * progress;
      hole2.showDuration = showTime;
      hole2.showTimer = showTime;
      hole2.whacked = false;
    }
  }
});

// ── Timer System ────────────────────────────────────────────────────

game.system('timer', function timerSystem(world, dt) {
  var state = world.getResource('state');
  if (state.gameOver) return;

  state.started = true;
  state.timeLeft -= dt;

  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.gameOver = true;
    state.message = 'Time up! Score: ' + state.score;
  }
});

// ── Helper: whack a hole ────────────────────────────────────────────

function whackHole(board, state, r, c) {
  if (state.gameOver) return;

  var hole = board.holes[r][c];
  if (hole.moleUp && !hole.whacked) {
    hole.whacked = true;
    hole.whackTimer = 300;
    state.score += POINTS_PER_WHACK;
    state.hits++;
    state.message = 'Hit! +' + POINTS_PER_WHACK;
  } else if (!hole.moleUp) {
    state.score = Math.max(0, state.score + MISS_PENALTY);
    state.message = 'Miss!';
  }
}

// ── Player Input System ─────────────────────────────────────────────

game.system('playerInput', function playerInputSystem(world, _dt) {
  var gm = world.getResource('gameMode');
  if (!gm || gm.mode !== 'playerVsAi') return;

  var state = world.getResource('state');
  if (state.gameOver) return;

  var input = world.getResource('input');
  var cursor = world.getResource('_cursor');
  var board = world.getResource('board');

  if (consumeAction(input, 'up') && cursor.row > 0) cursor.row--;
  if (consumeAction(input, 'down') && cursor.row < GRID_ROWS - 1) cursor.row++;
  if (consumeAction(input, 'left') && cursor.col > 0) cursor.col--;
  if (consumeAction(input, 'right') && cursor.col < GRID_COLS - 1) cursor.col++;

  if (consumeAction(input, 'select')) {
    whackHole(board, state, cursor.row, cursor.col);
  }
});

// ── AI System ───────────────────────────────────────────────────────

game.system('ai', function aiSystem(world, dt) {
  var gm = world.getResource('gameMode');
  if (gm && gm.mode === 'playerVsAi') return;

  var state = world.getResource('state');
  if (state.gameOver) return;

  var timer = world.getResource('_aiTimer');
  var board = world.getResource('board');

  timer.elapsed += dt;

  if (timer.elapsed < timer.reactionTarget) return;
  timer.elapsed = 0;

  // Set next reaction time (AI is fast but not instant)
  timer.reactionTarget = AI_REACTION_MIN + Math.random() * (AI_REACTION_MAX - AI_REACTION_MIN);

  // Find moles that are up and not whacked
  var targets = [];
  for (var r = 0; r < GRID_ROWS; r++) {
    for (var c = 0; c < GRID_COLS; c++) {
      var hole = board.holes[r][c];
      if (hole.moleUp && !hole.whacked) {
        targets.push({ r: r, c: c });
      }
    }
  }

  // AI has 90% accuracy
  if (targets.length > 0 && Math.random() < 0.9) {
    var target = targets[Math.floor(Math.random() * targets.length)];
    whackHole(board, state, target.r, target.c);
  }
});

// ── Render System ───────────────────────────────────────────────────

game.system('render', function renderSystem(world, _dt) {
  var renderer = world.getResource('renderer');
  if (!renderer) return;

  var ctx = renderer.ctx;
  var state = world.getResource('state');
  var board = world.getResource('board');
  var cursor = world.getResource('_cursor');
  var gm = world.getResource('gameMode');
  var isPlayer = gm && gm.mode === 'playerVsAi';

  clearCanvas(ctx, BG_COLOR);

  // ── Grass texture ──
  ctx.fillStyle = '#388E3C';
  for (var g = 0; g < 30; g++) {
    var gx = (g * 53 + 17) % CANVAS_W;
    var gy = (g * 79 + 23) % CANVAS_H;
    ctx.fillRect(gx, gy, 2, 6);
  }

  // ── Title ──
  drawLabel(ctx, 'WHACK-A-MOLE', CANVAS_W / 2, 28, {
    color: '#fff', fontSize: 22, align: 'center',
  });

  // ── HUD ──
  var seconds = Math.ceil(state.timeLeft / 1000);
  drawLabel(ctx, 'Time: ' + seconds + 's', 15, 55, {
    color: seconds <= 10 ? '#E53935' : '#C8E6C9', fontSize: 14,
  });
  drawLabel(ctx, 'Score: ' + state.score, CANVAS_W / 2, 55, {
    color: '#FDD835', fontSize: 14, align: 'center',
  });
  drawLabel(ctx, 'Hits: ' + state.hits, CANVAS_W - 15, 55, {
    color: '#C8E6C9', fontSize: 14, align: 'right',
  });

  // ── Progress bar (time) ──
  var barW = CANVAS_W - 40;
  var barH = 8;
  var barX = 20;
  var barY = 75;
  drawRoundedRect(ctx, barX, barY, barW, barH, 4, '#1B5E20');
  var fillW = Math.max(0, (state.timeLeft / GAME_DURATION) * barW);
  var barColor = seconds <= 10 ? '#E53935' : '#4CAF50';
  drawRoundedRect(ctx, barX, barY, fillW, barH, 4, barColor);

  // ── Draw holes and moles ──
  for (var r = 0; r < GRID_ROWS; r++) {
    for (var c = 0; c < GRID_COLS; c++) {
      var hx = GRID_START_X + c * (HOLE_W + HOLE_GAP_X);
      var hy = GRID_START_Y + r * (HOLE_H + HOLE_GAP_Y);
      var hole = board.holes[r] && board.holes[r][c];

      // Dirt mound
      drawRoundedRect(ctx, hx, hy + HOLE_H * 0.4, HOLE_W, HOLE_H * 0.6, 8, DIRT_COLOR);

      // Hole opening (dark)
      ctx.beginPath();
      ctx.ellipse(hx + HOLE_W / 2, hy + HOLE_H * 0.45, HOLE_W * 0.4, HOLE_H * 0.18, 0, 0, Math.PI * 2);
      ctx.fillStyle = HOLE_COLOR;
      ctx.fill();

      if (hole && hole.moleUp) {
        if (hole.whacked) {
          // Whacked mole (flattened, yellow stars)
          drawCircle(ctx, hx + HOLE_W / 2, hy + HOLE_H * 0.3, 18, WHACKED_COLOR);
          // Dizzy eyes
          drawLabel(ctx, 'X X', hx + HOLE_W / 2, hy + HOLE_H * 0.3, {
            color: '#333', fontSize: 10, align: 'center',
          });
          // Stars
          drawLabel(ctx, '*', hx + HOLE_W / 2 - 22, hy + HOLE_H * 0.1, {
            color: '#FDD835', fontSize: 12, align: 'center',
          });
          drawLabel(ctx, '*', hx + HOLE_W / 2 + 22, hy + HOLE_H * 0.15, {
            color: '#FDD835', fontSize: 10, align: 'center',
          });
        } else {
          // Mole popping up
          var popOffset = 0;
          if (hole.showTimer > hole.showDuration - 100) {
            // Popping up animation
            popOffset = ((hole.showDuration - hole.showTimer) / 100) * 10;
          } else if (hole.showTimer < 200) {
            // Going down animation
            popOffset = (hole.showTimer / 200) * 10;
          } else {
            popOffset = 10;
          }

          var moleY = hy + HOLE_H * 0.35 - popOffset;

          // Mole body
          drawCircle(ctx, hx + HOLE_W / 2, moleY, 20, MOLE_COLOR);

          // Eyes
          drawCircle(ctx, hx + HOLE_W / 2 - 7, moleY - 4, 4, '#fff');
          drawCircle(ctx, hx + HOLE_W / 2 + 7, moleY - 4, 4, '#fff');
          drawCircle(ctx, hx + HOLE_W / 2 - 7, moleY - 4, 2, MOLE_EYE_COLOR);
          drawCircle(ctx, hx + HOLE_W / 2 + 7, moleY - 4, 2, MOLE_EYE_COLOR);

          // Nose
          drawCircle(ctx, hx + HOLE_W / 2, moleY + 4, 4, MOLE_NOSE_COLOR);
        }
      }

      // Cursor highlight (player mode)
      if (isPlayer && !state.gameOver && r === cursor.row && c === cursor.col) {
        ctx.strokeStyle = CURSOR_COLOR;
        ctx.lineWidth = 3;
        ctx.strokeRect(hx - 4, hy - 4, HOLE_W + 8, HOLE_H + 8);
      }
    }
  }

  // ── Message ──
  drawLabel(ctx, state.message, CANVAS_W / 2, CANVAS_H - 55, {
    color: '#C8E6C9', fontSize: 14, align: 'center',
  });

  // ── Controls hint ──
  if (!state.gameOver) {
    drawLabel(ctx, '\u2190\u2192\u2191\u2193 move  ENTER whack  R restart', CANVAS_W / 2, CANVAS_H - 15, {
      color: '#1B5E20', fontSize: 11, align: 'center',
    });
  }

  // ── Game Over ──
  if (state.gameOver) {
    var accuracy = state.hits + state.misses > 0
      ? Math.round((state.hits / (state.hits + state.misses)) * 100)
      : 0;
    drawGameOver(ctx, 40, 120, CANVAS_W - 80, 250, {
      title: 'TIME UP!',
      titleColor: '#FDD835',
      subtitle: 'Score: ' + state.score + ' | ' + accuracy + '% accuracy | Press R',
    });
  }

  drawTouchOverlay(ctx, ctx.canvas.width, ctx.canvas.height);
});

export default game;
