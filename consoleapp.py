from flask import Flask, render_template, jsonify, request
import sqlite3
import subprocess
import os
import json
import threading
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Tuple, Optional, Dict, Any

app = Flask(__name__, static_folder='static', template_folder='templates')

# --------------------------------------------------------------------------------------
# Paths & constants
# --------------------------------------------------------------------------------------
DB_PATH = '/home/devesh/CONSOLE/nfctest/flycamp_project/flycamp_framework.db'
TOKEN_FILE = '/home/devesh/rfid_token.txt'
GAME_META_FILE = '/home/devesh/game_meta.json'
GAME_DONE_FLAG = '/home/devesh/game_done.flag'
SOUND_DIR = '/home/devesh/CONSOLE/nfctest/flycamp_project/static/assets/sounds'

# Prepare scripts
PREPARE_NODES_PATH = '/home/devesh/CONSOLE/nfctest/flycamp_project/prepare_nodes.py'
PREPARE_CAR_PATH   = '/home/devesh/CONSOLE/nfctest/flycamp_project/prepare_car.py'


# Drone connection check candidates (use *only* drone_ready.py)
POSSIBLE_DRONE_CHECK_SCRIPTS = [
   
    "drone_ready.py"
  
]




# Game script paths
HOVER_AND_SEEK = '/home/devesh/gamescripts/hoverandseek.py'   # Game 1
HUES_THE_BOSS  = '/home/devesh/gamescripts/huestheboss.py'    # Game 2
COLOR_CHAOS    = '/home/devesh/gamescripts/colourchaos.py'    # Game 3

# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def play_sound(filename: str):
    """Play an MP3 sound file asynchronously using mpg123 (if present)."""
    full_path = os.path.join(SOUND_DIR, filename)
    if os.path.exists(full_path):
        threading.Thread(target=lambda: subprocess.run(["mpg123", "-q", full_path])).start()
    else:
        print(f"[play_sound] Missing file: {full_path}")

def _run_python_script(script_path: str, args: Optional[List[str]] = None, timeout: int = 40) -> Tuple[bool, str]:
    """Run a python script and return (ok, combined_output)."""
    args = args or []
    if not os.path.exists(script_path):
        return False, f"Script not found: {script_path}"
    try:
        proc = subprocess.run(
            ['python3', script_path] + args,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        ok = (proc.returncode == 0)
        out = (proc.stdout or '') + (('\n' + proc.stderr) if proc.stderr else '')
        return ok, out.strip()
    except subprocess.TimeoutExpired:
        return False, f"Timeout after {timeout}s"
    except Exception as e:
        return False, f"Exception: {e}"

def _find_existing_script(candidates: List[str]) -> Optional[str]:
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

def _read_latest_selection_from_meta() -> Optional[int]:
    """Best effort: read last written game_number from GAME_META_FILE."""
    try:
        if os.path.exists(GAME_META_FILE):
            with open(GAME_META_FILE, 'r') as f:
                data = json.load(f)
                gn = int(data.get('game_number', 0))
                return gn if gn in (1, 2, 3) else None
    except Exception as e:
        print(f"[meta] Could not read {GAME_META_FILE}: {e}")
    return None

def run_initialisation_steps(game_number: Optional[int]) -> Dict[str, Any]:
    """
    3(+1) line init:
      - Joystick/Gesture: simulated OK (placeholder)
      - Nodes: prepare_nodes.py for ALL games
      - Car: prepare_car.py only for Game 2
      - Drone: connection_check.py (drone_ready.py here)
    """
    steps: List[Dict[str, Any]] = []

    # 1) Joystick/Gesture (simulate for now)
    steps.append({'name': 'Joystick/Gesture', 'ok': True, 'message': 'Simulated OK'})

    # 2) Nodes prepare (ALL games)
    ok_nodes, msg_nodes = _run_python_script(PREPARE_NODES_PATH)
    steps.append({'name': 'Nodes', 'ok': ok_nodes, 'message': msg_nodes or ''})

    # 3) Car prepare (Game 2 only)
    if game_number == 2:
        ok_car, msg_car = _run_python_script(PREPARE_CAR_PATH)
        steps.append({'name': 'Car', 'ok': ok_car, 'message': msg_car or ''})
    else:
        steps.append({'name': 'Car', 'ok': True, 'message': 'Skipped (not required for this game)'})

    # 4) Drone check (MUST run drone_ready.py; no simulated OK)
    check_script = _find_existing_script(POSSIBLE_DRONE_CHECK_SCRIPTS)
    if check_script is None:
        steps.append({'name': 'Drone', 'ok': False, 'message': 'drone_ready.py not found'})
    else:
        args = [
            '--uri', os.environ.get('CF_URI', 'radio://0/80/2M/E7E7E7E7E7'),
            '--name', 'drone',
            '--pos-timeout', '12',
            '--require-pos'
        ]
        ok_drone, msg_drone = _run_python_script(check_script, args=args)
        steps.append({
            'name': 'Drone',
            'ok': bool(ok_drone),
            'message': f"{os.path.basename(check_script)} rc={'0' if ok_drone else '1'}\n{msg_drone or ''}"
        })

    success = all(s.get('ok') for s in steps)
    return {'success': success, 'game_number': game_number, 'steps': steps}


def start_game_process(game_number: int, level_number: int) -> Tuple[bool, Optional[str]]:
    """
    Map selection to script and launch via Popen.
    - Clears stale game_done flag
    - Writes game_meta.json
    - Plays sounds
    """
    try:
        # Clear stale done flag
        try:
            if os.path.exists(GAME_DONE_FLAG):
                os.remove(GAME_DONE_FLAG)
        except Exception as e:
            print(f"[start_game_process] Could not remove old flag: {e}")

        # Persist selection for scripts to read
        try:
            with open(GAME_META_FILE, "w") as m:
                json.dump({"game_number": game_number, "level_number": level_number}, m)
        except Exception as e:
            print(f"[start_game_process] Could not write game_meta.json: {e}")

        # Map to script
        script = None
        if game_number == 1 and level_number in (1, 2):
            script = HOVER_AND_SEEK
        elif game_number == 2 and level_number == 1:
            script = HUES_THE_BOSS
        elif game_number == 3 and level_number in (1, 2):
            script = COLOR_CHAOS
        else:
            # Back-compat: legacy mapping where (2,2) launched Color Chaos
            if game_number == 2 and level_number == 2:
                script = COLOR_CHAOS
            else:
                return (False, f"Invalid game/level selection: G{game_number} L{level_number}")

        # Sounds
        play_sound("button selection.mp3")
        play_sound("initialising drone and nodes before game.mp3")

        subprocess.Popen(['python3', script])
        play_sound("game_start.mp3")
        return (True, None)
    except Exception as e:
        return (False, str(e))

def get_token_id_from_script():
    try:
        result = subprocess.run(['python3', 'get_id.py'], capture_output=True, text=True, timeout=10)
        output = result.stdout.strip()
        if "Token ID:" in output:
            token_id = int(output.split("Token ID:")[1].strip())
            return token_id
        print("Warning: get_id.py did not return a Token ID. Full output:", output)
        return None
    except Exception as e:
        print(f"Error reading token ID from get_id.py: {e}")
        return None

# --------------------------------------------------------------------------------------
# Routes: UI
# --------------------------------------------------------------------------------------
@app.route('/')
def index():
    # Render your single-page UI (cards etc.) at /templates/console.html
    return render_template('console.html')

# --------------------------------------------------------------------------------------
# Routes: RFID
# --------------------------------------------------------------------------------------
@app.route('/scan_rfid')
def scan_rfid():
    token_id = get_token_id_from_script()
    print("Scanned token_id:", token_id)

    if not token_id:
        play_sound("rfid_error.mp3")
        return jsonify({'success': False, 'error': 'No token ID found or script failed'})

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT player_name FROM PlayerRegistrations WHERE token_id = ?", (token_id,))
        row = cursor.fetchone()
    finally:
        conn.close()

    if row:
        play_sound("name and rfid pops up.mp3")
        play_sound("rfid_success.mp3")
        return jsonify({'success': True, 'name': row['player_name'], 'token_id': token_id})
    else:
        play_sound("rfid_error.mp3")
        return jsonify({'success': False, 'error': 'Token not registered to any player'})

@app.route('/write_rfid_token', methods=['POST'])
def write_rfid_token():
    data = request.get_json(silent=True) or {}
    token_id = data.get('token_id')
    if token_id is not None:
        try:
            with open(TOKEN_FILE, "w") as f:
                f.write(str(token_id))
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'success': False, 'error': f'Failed to write token file: {e}'})
    return jsonify({'success': False, 'error': 'No token_id provided'})

# --------------------------------------------------------------------------------------
# Routes: Init + Start
# --------------------------------------------------------------------------------------
@app.route('/api/connection_check', methods=['POST'])
def api_connection_check():
    payload = request.get_json(silent=True) or {}
    game_number = payload.get('game_number')

    try:
        game_number = int(game_number) if game_number is not None else None
        if game_number not in (1, 2, 3):
            game_number = None
    except Exception:
        game_number = None

    if game_number is None:
        game_number = _read_latest_selection_from_meta()

    result = run_initialisation_steps(game_number)

    # Optional: voice line on success
    if result.get('success'):
        play_sound("initialising drone and nodes before game.mp3")

    return jsonify(result)

@app.route('/api/start_game', methods=['POST'])
def api_start_game():
    data = request.get_json(force=True)
    game_number = int(data.get('game_number', 0))
    level_number = int(data.get('level_number', 0))

    success, err = start_game_process(game_number, level_number)
    if success:
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': err or 'Failed to start game'})

# --------------------------------------------------------------------------------------
# Back-compat endpoints (still work; map to same scripts)
# --------------------------------------------------------------------------------------
@app.route('/start_hue_game')
def start_hue_game():
    try:
        if os.path.exists(GAME_DONE_FLAG):
            os.remove(GAME_DONE_FLAG)
        with open(GAME_META_FILE, "w") as m:
            json.dump({"game_number": 2, "level_number": 1}, m)

        _run_python_script(PREPARE_NODES_PATH)
        _run_python_script(PREPARE_CAR_PATH)

        play_sound("button selection.mp3")
        play_sound("initialising drone and nodes before game.mp3")

        subprocess.Popen(['python3', HUES_THE_BOSS])
        play_sound("game_start.mp3")
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/start_hover_game')
def start_hover_game():
    try:
        if os.path.exists(GAME_DONE_FLAG):
            os.remove(GAME_DONE_FLAG)
        with open(GAME_META_FILE, "w") as m:
            json.dump({"game_number": 1, "level_number": 1}, m)

        _run_python_script(PREPARE_NODES_PATH)

        play_sound("button selection.mp3")
        play_sound("initialising drone and nodes before game.mp3")

        subprocess.Popen(['python3', HOVER_AND_SEEK])
        play_sound("game_start.mp3")
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

# --------------------------------------------------------------------------------------
# Scores / Leaderboard
# --------------------------------------------------------------------------------------
@app.route('/submit_score', methods=['POST'])
def submit_score():
    """
    Expects: token_id (int), game_number (int), level_number (int), score (int)
    Inserts a row in GamePlays and updates PlayerBests (manual upsert).
    """
    data = request.get_json()
    token_id = data.get('token_id')
    game_number = data.get('game_number')
    level_number = data.get('level_number')
    score = data.get('score')

    if token_id is None or game_number is None or level_number is None or score is None:
        return jsonify({'success': False, 'error': 'Missing token_id, game_number, level_number, or score'})

    try:
        token_id = int(token_id)
        game_number = int(game_number)
        level_number = int(level_number)
        score = int(score)
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid numeric fields'})

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        now_ts = int(datetime.now(tz=ZoneInfo("Asia/Kolkata")).timestamp())

        # 1) Insert raw play
        cursor.execute("""
            INSERT INTO GamePlays (token_id, game_number, level_number, score, begin_timestamp, end_timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (token_id, game_number, level_number, score, now_ts, now_ts))

        # 2) Manual upsert for PlayerBests
        cursor.execute("""
            SELECT player_best_id, highest_score
            FROM PlayerBests
            WHERE token_id = ? AND game_number = ? AND level_number = ?
            ORDER BY player_best_id LIMIT 1
        """, (token_id, game_number, level_number))
        row = cursor.fetchone()

        if row is None:
            cursor.execute("""
                INSERT INTO PlayerBests (token_id, game_number, level_number, highest_score, timestamp_achieved)
                VALUES (?, ?, ?, ?, ?)
            """, (token_id, game_number, level_number, score, now_ts))
        else:
            player_best_id = row['player_best_id']
            prev = row['highest_score'] or 0
            if score > prev:
                cursor.execute("""
                    UPDATE PlayerBests
                    SET highest_score = ?, timestamp_achieved = ?
                    WHERE player_best_id = ?
                """, (score, now_ts, player_best_id))

        conn.commit()
        play_sound("final score display.mp3")
        play_sound("score_submit.mp3")
        return jsonify({'success': True, 'message': 'Score submitted and stats updated.'})

    except sqlite3.Error as e:
        conn.rollback()
        return jsonify({'success': False, 'error': f'Database error: {e}'})
    finally:
        conn.close()

@app.route('/get_leaderboard')
def get_leaderboard():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT
                pr.player_name,
                COALESCE(SUM(pb.highest_score), 0) AS total_score
            FROM PlayerBests AS pb
            JOIN PlayerRegistrations AS pr ON pb.token_id = pr.token_id
            GROUP BY pr.player_name
            ORDER BY total_score DESC
        """)
        rows = cursor.fetchall()
        leaderboard_data = [{'name': row['player_name'], 'score': row['total_score']} for row in rows]
        play_sound("final score display.mp3")
        play_sound("leaderboard.mp3")
        return jsonify({'success': True, 'leaderboard': leaderboard_data})
    except sqlite3.Error as e:
        print(f"Error fetching leaderboard data: {e}")
        return jsonify({'success': False, 'error': str(e)})
    finally:
        conn.close()

# --------------------------------------------------------------------------------------
# Game done flag
# --------------------------------------------------------------------------------------
@app.route('/game_done')
def game_done():
    if os.path.exists(GAME_DONE_FLAG):
        os.remove(GAME_DONE_FLAG)
        play_sound("drone back to home.mp3")
        return jsonify({'done': True})
    else:
        return jsonify({'done': False})

# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------
if __name__ == '__main__':
    # Note: keep port/host consistent with your kiosk/Electron wrapper
    app.run(host='0.0.0.0', port=5000)
