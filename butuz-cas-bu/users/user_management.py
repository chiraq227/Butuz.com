from config import MAX_LEVEL
from core.database import load_db, get_user, save_user

def get_user_by_game_id(game_id: int) -> tuple:
    """Возвращает (telegram_id, user_data) по игровому ID или (None, None)"""
    db = load_db()
    for uid, data in db.items():
        if not isinstance(data, dict) or "game_id" not in data:
            continue
        if data.get("game_id") == game_id:
            try:
                return int(uid), data
            except (ValueError, TypeError):
                continue
    return None, None

def get_user_by_username(username: str) -> tuple:
    """Возвращает (telegram_id, user_data) по username или (None, None)"""
    db = load_db()
    username_clean = username.lstrip("@").lower()
    for uid, data in db.items():
        if not isinstance(data, dict):
            continue
        stored = data.get("username", "")
        if stored and stored.lstrip("@").lower() == username_clean:
            try:
                return int(uid), data
            except (ValueError, TypeError):
                continue
    return None, None

def update_balance(user_id: int, amount: int) -> int:
    from game_logic.levels import calc_level_from_xp
    user = get_user(user_id)
    user["balance"] = max(0, user["balance"] + amount)
    if amount > 0:
        user["total_won"] += amount
    else:
        user["total_lost"] += abs(amount)
    user["games_played"] += 1

    xp_gain = max(1, abs(amount) // 10000)
    user["xp"] = user.get("xp", 0) + xp_gain
    user["level"] = min(MAX_LEVEL, calc_level_from_xp(user["xp"]))

    save_user(user_id, user)
    return user["balance"]

def check_achievements(user_id: int):
    """Проверяет и выдаёт достижения"""
    user = get_user(user_id)
    achievements = user.get("achievements", [])
    new_ach = []

    checks = [
        ("first_win", "🏆 Первая победа!", user["total_won"] >= 1),
        ("rich", "💰 Богач", user["balance"] >= 10000),
        ("veteran", "⚔️ Ветеран", user["games_played"] >= 100),
        ("whale", "🐋 Кит", user["total_won"] >= 10000),
        ("lucky", "🍀 Везунчик", user["level"] >= 5),
    ]
    for key, name, condition in checks:
        if condition and key not in achievements:
            achievements.append(key)
            new_ach.append(name)

    user["achievements"] = achievements
    save_user(user_id, user)
    return new_ach
