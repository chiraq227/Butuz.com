from telebot import types
import bot_instance

def fmt(n: int) -> str:
    """Форматирует число с разделителями тысяч"""
    return f"{n:,}".replace(",", " ")

def generate_room_id() -> str:
    bot_instance.dice_room_counter += 1
    return f"{bot_instance.dice_room_counter:04d}"

def parse_amount(text: str) -> int | None:
    """Парсит денежную сумму/кол-во с поддержкой сокращений к/кк:
    1000, 1к, 1кк, 50к, 100ккк, 1.5к и т.д.
    1к=1000, 1кк=1000000, 1ккк=1000000000 и т.п.
    Поддерживает латинские k и кириллические к. Пробелы игнорируются.
    Возвращает int или None при ошибке.
    """
    if not text:
        return None
    t = str(text).strip().lower().replace(" ", "").replace("\xa0", "").replace("_", "")
    if not t:
        return None
    # Считаем суффикс к/кк (поддержка нескольких к подряд)
    k_count = 0
    while t and t[-1] in ("k", "к"):
        t = t[:-1]
        k_count += 1
    if not t:
        return None
    # Число: поддержка дробей 1.5к / 1,5к
    try:
        num_str = t.replace(",", ".")
        if "." in num_str:
            val = float(num_str)
        else:
            val = int(num_str)
        if val < 0:
            return None
        mult = 1000 ** max(k_count, 0)
        result = int(val * mult)
        return result if result > 0 else None
    except (ValueError, OverflowError, TypeError):
        return None


def parse_sell_amount(text: str, total_farms: int) -> int:
    """Парсит количество ферм для продажи (число, 'все', или с к: 5к и т.д.)"""
    text_clean = text.strip().lower()
    if text_clean in ["все", "всё", "all"]:
        return total_farms
    amt = parse_amount(text_clean)
    if amt is not None and amt > 0:
        return amt
    return 0

def send_section_from_text(bot, chat_id, text, section, user_id, user):
    """Служебный хелпер вывода блоков текста"""
    from datetime import datetime, timedelta
    from config import DAILY_BONUS, CURRENCY, REFERRAL_BONUS, BOT_USERNAME
    from core.database import save_user
    
    if section == "help":
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot.send_message(chat_id, text, reply_markup=kb)
    elif section == "daily_bonus":
        now = datetime.now()
        if user.get("daily_last"):
            last = datetime.fromisoformat(user["daily_last"])
            diff = now - last
            if diff.total_seconds() < 86400:
                remaining = timedelta(seconds=86400) - diff
                h, m_left = divmod(int(remaining.total_seconds()), 3600)
                m_left //= 60
                kb = types.InlineKeyboardMarkup()
                kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
                bot.send_message(
                    chat_id, f"⏳ <b>Бонус уже получен!</b>\n\nСледующий бонус через: <b>{h}ч {m_left}мин</b>", reply_markup=kb
                )
                return
        streak = user.get("streak", 0)
        if user.get("daily_last"):
            last = datetime.fromisoformat(user["daily_last"])
            if (now - last).total_seconds() < 172800:
                streak += 1
            else:
                streak = 1
        else:
            streak = 1
        bonus = DAILY_BONUS + (streak - 1) * 100
        if user.get("vip"):
            bonus = int(bonus * 1.5)
        user["balance"] += bonus
        user["daily_last"] = now.isoformat()
        user["streak"] = streak
        save_user(user_id, user)
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("◀️ В меню", callback_data="main_menu"))
        bot.send_message(
            chat_id, f"🎁 <b>Ежедневный бонус!</b>\n\n"
            f"🔥 Стрик: <b>{streak} {'день!' if streak < 2 else 'дней подряд!'}</b>\n"
            f"💎 Получено: <b>+{fmt(bonus)} {CURRENCY}</b>\n"
            f"{'🎯 VIP бонус x1.5 применён!' if user.get('vip') else ''}\n\n"
            f"💰 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>", reply_markup=kb
        )
    elif section == "referral":
        ref_count = len(user.get("referrals", []))
        ref_link = f"https://t.me/{BOT_USERNAME.replace('@', '')}?start=ref{user_id}"
        text_msg = (
            f"👥 <b>Реферальная программа</b>\n\n"
            f"За каждого приглашённого друга:\n"
            f"• Вы получаете: <b>{fmt(REFERRAL_BONUS)} {CURRENCY}</b>\n"
            f"• Друг получает: <b>{fmt(REFERRAL_BONUS // 2)} {CURRENCY}</b>\n\n"
            f"👤 Приглашено друзей: <b>{ref_count}</b>\n"
            f"💎 Ссылка:\n<code>{ref_link}</code>"
        )
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot.send_message(chat_id, text_msg, reply_markup=kb)

# NOTE: No catch-all callback handler here.
# All callbacks must be handled by their specific @bot.callback_query_handler.
# A global func=True handler would interfere with normal button logic.


def make_fake_callback(from_user, chat_id: int, message_id: int, data: str = ""):
    """
    Создаёт минимальный объект, имитирующий telebot.types.CallbackQuery.
    Используется для внутренних вызовов обработчиков после текстового ввода (custom bet, farm и т.д.).
    Избегает проблем с конструктором CallbackQuery (требует json_string и определённый порядок аргументов).
    """
    from types import SimpleNamespace
    chat = SimpleNamespace(id=chat_id)
    msg = SimpleNamespace(chat=chat, message_id=message_id, from_user=from_user)
    return SimpleNamespace(
        id="fake",
        from_user=from_user,
        message=msg,
        chat_instance="fake",
        data=data,
    )


def get_display_name(user: dict, user_id: int = None) -> str:
    """
    Возвращает отображаемое имя пользователя.
    Приоритет: никнеймы (максимум 2 через /) > username > "Аноним"
    Пример: "ButuzPro/КазиноКинг"
    Если передан user_id — пытается восстановить ники из реестра (лечение багов предыдущих версий).
    """
    if not user:
        return "Аноним"
    nicks = user.get("nicknames") or []
    if not nicks and user_id is not None:
        try:
            from economy.nicknames import get_authoritative_user_nicknames
            nicks = get_authoritative_user_nicknames(user_id)
        except Exception:
            pass
    if nicks:
        # Берём максимум 2
        return "/".join(nicks[:2])
    return user.get("username") or "Аноним"

