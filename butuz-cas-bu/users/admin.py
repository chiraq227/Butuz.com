import telebot
from telebot import types
from config import ADMIN_IDS, CURRENCY
from bot_instance import bot
from core.database import get_user, save_user, load_db
from core.utils import fmt

def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS

def admin_resolve_user(target_str: str):
    """Ищет юзера по ID, username или никнейму"""
    from users.user_management import get_user_by_game_id, get_user_by_username
    from core.database import get_user_by_nickname
    if target_str.isdigit():
        return get_user_by_game_id(int(target_str))
    # Сначала пробуем по никнейму (новая система)
    tid, udata = get_user_by_nickname(target_str)
    if tid:
        return tid, udata
    return get_user_by_username(target_str)

@bot.message_handler(commands=["admin"])
def admin_panel(message):
    if not is_admin(message.from_user.id): return
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("💰 Give / Take", callback_data="adm_money"),
        types.InlineKeyboardButton("👑 Rating", callback_data="adm_rating"),
        types.InlineKeyboardButton("🛡️ VIP / Ban", callback_data="adm_status"),
        types.InlineKeyboardButton("🔍 Userinfo", callback_data="adm_userinfo"),
        types.InlineKeyboardButton("📢 Broadcast", callback_data="adm_bc"),
        types.InlineKeyboardButton("📊 Stats", callback_data="adm_stats"),
    )
    text = "👑 <b>АДМИН-ПАНЕЛЬ КАЗИНО</b>\nВыберите действие или используйте команды ниже."
    bot.reply_to(message, text, reply_markup=kb)

@bot.message_handler(commands=["give"])
def give_coins(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 3:
        bot.reply_to(message, "Использование: /give @username/ID сумма")
        return
    tid, udata = admin_resolve_user(parts[1])
    if not tid:
        bot.reply_to(message, "Пользователь не найден")
        return
    amount = int(parts[2])
    udata["balance"] += amount
    save_user(tid, udata)
    bot.reply_to(message, f"Успешно выдано {fmt(amount)} {CURRENCY} игроку {parts[1]}")

@bot.message_handler(commands=["take"])
def take_coins(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 3:
        bot.reply_to(message, "Использование: /take @username/ID сумма")
        return
    tid, udata = admin_resolve_user(parts[1])
    if not tid:
        bot.reply_to(message, "Пользователь не найден")
        return
    amount = int(parts[2])
    udata["balance"] = max(0, udata["balance"] - amount)
    save_user(tid, udata)
    bot.reply_to(message, f"Успешно забрано {fmt(amount)} {CURRENCY} у игрока {parts[1]}")

@bot.message_handler(commands=["ban"])
def ban_user(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 2: return
    tid, udata = admin_resolve_user(parts[1])
    if not tid: return
    udata["banned"] = True
    save_user(tid, udata)
    bot.reply_to(message, f"Игрок {parts[1]} забанен")

@bot.message_handler(commands=["unban"])
def unban_user(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 2: return
    tid, udata = admin_resolve_user(parts[1])
    if not tid: return
    udata["banned"] = False
    save_user(tid, udata)
    bot.reply_to(message, f"Игрок {parts[1]} разбанен")

@bot.message_handler(commands=["vip"])
def vip_user(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 2: return
    tid, udata = admin_resolve_user(parts[1])
    if not tid: return
    udata["vip"] = not udata.get("vip", False)
    save_user(tid, udata)
    bot.reply_to(message, f"Статус VIP для {parts[1]} изменён на: {udata['vip']}")

@bot.message_handler(commands=["userinfo"])
def userinfo(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 2: return
    tid, udata = admin_resolve_user(parts[1])
    if not tid: return
    text = (
        f"ℹ️ <b>ИНФО: {parts[1]}</b>\n"
        f"Telegram ID: {tid}\n"
        f"Игровой ID: {udata.get('game_id')}\n"
        f"Баланс: {fmt(udata['balance'])}\n"
        f"Уровень: {udata['level']} ({fmt(udata['xp'])} XP)\n"
        f"Игр сыграно: {udata['games_played']}\n"
        f"Рейтинг: {fmt(udata.get('rating',0))}\n"
        f"VIP: {udata.get('vip')}\n"
        f"Бан: {udata.get('banned')}"
    )
    bot.reply_to(message, text)

@bot.message_handler(commands=["broadcast"])
def broadcast(message):
    if not is_admin(message.from_user.id): return
    text = message.text.replace("/broadcast", "").strip()
    if not text: return
    db = load_db()
    count = 0
    for uid in db:
        if not str(uid).isdigit():
            continue  # skip meta keys like "nickname_registry", "nickname_market"
        try:
            bot.send_message(int(uid), f"📢 <b>ОБЪЯВЛЕНИЕ ОТ АДМИНИСТРАЦИИ</b>\n\n{text}")
            count += 1
        except: pass
    bot.reply_to(message, f"Рассылка завершена. Отправено {count} пользователям.")

@bot.message_handler(commands=["giverating"])
def give_rating(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 3: return
    tid, udata = admin_resolve_user(parts[1])
    if not tid: return
    amount = int(parts[2])
    udata["rating"] = udata.get("rating", 0) + amount
    save_user(tid, udata)
    bot.reply_to(message, f"Выдано {fmt(amount)} рейтинга игроку {parts[1]}")

@bot.message_handler(commands=["takerating"])
def take_rating(message):
    if not is_admin(message.from_user.id): return
    parts = message.text.split()
    if len(parts) < 3: return
    tid, udata = admin_resolve_user(parts[1])
    if not tid: return
    amount = int(parts[2])
    udata["rating"] = max(0, udata.get("rating", 0) - amount)
    save_user(tid, udata)
    bot.reply_to(message, f"Забрано {fmt(amount)} рейтинга у игрока {parts[1]}")


# ====================== INLINE ADMIN PANEL (удобные кнопки) ======================
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("adm_"))
def admin_inline(c):
    if not is_admin(c.from_user.id):
        bot.answer_callback_query(c.id, "Нет доступа")
        return
    action = c.data
    chat = c.message.chat.id
    if action == "adm_money":
        bot.send_message(chat, "💰 <b>Деньги</b>\n/give @user 100000\n/take @user 50000\n/setbalance @user 99999999")
    elif action == "adm_rating":
        bot.send_message(chat, "👑 <b>Рейтинг</b>\n/giverating @user 1000\n/takerating @user 500\n/setrating @user 50000")
    elif action == "adm_status":
        bot.send_message(chat, "🛡️ <b>Статусы</b>\n/vip @user\n/ban @user\n/unban @user\n/setlevel @user 50")
    elif action == "adm_userinfo":
        bot.send_message(chat, "🔍 <b>Инфо об игроке</b>\n/userinfo @username или ID")
    elif action == "adm_bc":
        bot.send_message(chat, "📢 <b>Рассылка</b>\n/broadcast Текст объявления для всех игроков")
    elif action == "adm_stats":
        db = load_db()
        total = sum(1 for k in db if str(k).isdigit())
        bot.send_message(chat, f"📊 <b>Статистика</b>\nПользователей в БД: {total}\nИспользуй /userinfo для деталей.")
    bot.answer_callback_query(c.id)
