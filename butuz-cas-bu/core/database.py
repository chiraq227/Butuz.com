import os
import json
from datetime import datetime
from config import DB_FILE, ID_COUNTER_FILE, START_BALANCE

def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_db(db):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

def load_id_counter() -> int:
    if os.path.exists(ID_COUNTER_FILE):
        with open(ID_COUNTER_FILE, "r") as f:
            return json.load(f).get("counter", 0)
    return 0

def save_id_counter(counter: int):
    with open(ID_COUNTER_FILE, "w") as f:
        json.dump({"counter": counter}, f)

def get_next_user_id() -> int:
    counter = load_id_counter() + 1
    save_id_counter(counter)
    return counter

def get_user(user_id: int) -> dict:
    db = load_db()
    uid = str(user_id)
    if uid not in db:
        db[uid] = {
            "balance": START_BALANCE,
            "total_won": 0,
            "total_lost": 0,
            "games_played": 0,
            "level": 1,
            "xp": 0,
            "daily_last": None,
            "referral_by": None,
            "referrals": [],
            "achievements": [],
            "vip": False,
            "banned": False,
            "joined": datetime.now().isoformat(),
            "streak": 0,
            "last_game": None,
            "username": "",
            "game_id": get_next_user_id(),   # 🆔 уникальный ID
            "married_to": None,              # 💍 брак
            "married_at": None,
            "mining": {
                "farm_level": 0,
                "btc_accumulated": 0.0,
                "last_collected": None,
                "extra_farms": 0,
            },
            "last_bet": 0,  # запомненная предыдущая ставка
        }
        save_db(db)

    # Патч: game_id для старых юзеров
    if "game_id" not in db[uid]:
        db[uid]["game_id"] = get_next_user_id()
        save_db(db)

    # Патч: married_to для старых юзеров
    if "married_to" not in db[uid]:
        db[uid]["married_to"] = None
        db[uid]["married_at"] = None
        save_db(db)

    # Патч mining
    if "mining" not in db[uid]:
        db[uid]["mining"] = {
            "farm_level": 0,
            "btc_accumulated": 0.0,
            "last_collected": None,
            "extra_farms": 0,
        }
        save_db(db)

    if "extra_farms" not in db[uid]["mining"]:
        db[uid]["mining"]["extra_farms"] = 0
        save_db(db)

    # Патч: bank_balance для старых юзеров
    if "bank_balance" not in db[uid]:
        db[uid]["bank_balance"] = 0
        save_db(db)

    # Патч: transfers для старых юзеров
    if "transfers" not in db[uid]:
        db[uid]["transfers"] = {"count": 0, "date": ""}
        save_db(db)

    # Патч: rating для старых юзеров
    if "rating" not in db[uid]:
        db[uid]["rating"] = 0
        save_db(db)

    # Патч: пустой username
    if not db[uid].get("username"):
        db[uid]["username"] = "Аноним"
        save_db(db)

    # Патч: businesses для старых юзеров
    if "businesses" not in db[uid]:
        db[uid]["businesses"] = {}
        save_db(db)

    # Патч: last_bet для старых юзеров
    if "last_bet" not in db[uid]:
        db[uid]["last_bet"] = 0
        save_db(db)

    # Патч: nicknames (новая система никнеймов)
    if "nicknames" not in db[uid]:
        db[uid]["nicknames"] = []
        save_db(db)

    return db[uid]


def ensure_nickname_structures():
    """Гарантирует существование корневых ключей для реестра и маркета никнеймов."""
    db = load_db()
    changed = False
    if "nickname_registry" not in db:
        db["nickname_registry"] = {}
        changed = True
    if "nickname_market" not in db:
        db["nickname_market"] = {}
        changed = True
    if changed:
        save_db(db)

def save_user(user_id: int, data: dict):
    db = load_db()
    db[str(user_id)] = data
    save_db(db)


# ============================================================
# Новая система никнеймов — реестр владения и маркет
# ============================================================

def get_nickname_registry() -> dict:
    """Возвращает {nickname_lower: telegram_user_id}"""
    ensure_nickname_structures()
    db = load_db()
    return db.get("nickname_registry", {})


def save_nickname_registry(reg: dict):
    db = load_db()
    db["nickname_registry"] = reg
    save_db(db)


def get_nickname_market() -> dict:
    """Возвращает {nickname: {"seller_id": int, "price": int, "listed_at": str}}"""
    ensure_nickname_structures()
    db = load_db()
    return db.get("nickname_market", {})


def save_nickname_market(market: dict):
    db = load_db()
    db["nickname_market"] = market
    save_db(db)


def get_user_by_nickname(nick: str):
    """Ищет пользователя по никнейму (регистр не важен). Возвращает (tg_id, user_data) или (None, None)"""
    if not nick:
        return None, None
    reg = get_nickname_registry()
    key = nick.strip().lower()
    if key not in reg:
        return None, None
    entry = reg[key]
    tg_id = entry["owner"] if isinstance(entry, dict) else entry
    try:
        user = get_user(int(tg_id))
        return tg_id, user
    except:
        return None, None
