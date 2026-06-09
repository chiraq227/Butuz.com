from datetime import datetime
from telebot import types
from config import TRANSFER_MAX_VIP, TRANSFER_DAILY_LIMIT_VIP, TRANSFER_MAX, TRANSFER_DAILY_LIMIT, TRANSFER_MIN, CURRENCY
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from core.utils import fmt

def get_transfer_limits(user: dict) -> tuple:
    if user.get("vip"):
        return TRANSFER_MAX_VIP, TRANSFER_DAILY_LIMIT_VIP
    return TRANSFER_MAX, TRANSFER_DAILY_LIMIT

def get_transfers_today(user: dict) -> int:
    t = user.get("transfers", {"count": 0, "date": ""})
    today = datetime.now().strftime("%Y-%m-%d")
    if t.get("date") != today:
        return 0
    return t.get("count", 0)

def add_transfer_count(user_id: int):
    user = get_user(user_id)
    today = datetime.now().strftime("%Y-%m-%d")
    t = user.get("transfers", {"count": 0, "date": ""})
    if t.get("date") != today:
        t = {"count": 0, "date": today}
    t["count"] += 1
    user["transfers"] = t
    save_user(user_id, user)

@bot.callback_query_handler(func=lambda c: c.data == "transfer_menu")
def transfer_menu(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    max_amount, max_count = get_transfer_limits(user)
    used = get_transfers_today(user)
    remaining = max_count - used
    vip_line = "👑 <b>VIP лимиты активны!</b>\n" if user.get("vip") else ""
    kb = types.InlineKeyboardMarkup(row_width=1)
    kb.add(
        types.InlineKeyboardButton("💸 Сделать перевод", callback_data="transfer_start"),
        types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"),
    )
    bot.edit_message_text(
        f"💸 <b>ПЕРЕВОДЫ</b>\n\n"
        f"{vip_line}"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 <b>Ваш баланс:</b> {fmt(user['balance'])} {CURRENCY}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"📊 <b>Лимиты переводов:</b>\n"
        f"• Минимум: <b>{fmt(TRANSFER_MIN)} {CURRENCY}</b>\n"
        f"• Максимум за перевод: <b>{fmt(max_amount)} {CURRENCY}</b>\n"
        f"• Переводов в день: <b>{used}/{max_count}</b>\n"
        f"• Осталось сегодня: <b>{remaining}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🔍 Поиск по <b>Игровому ID</b> или <b>@username</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "transfer_start")
def transfer_start(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    _, max_count = get_transfer_limits(user)
    used = get_transfers_today(user)
    if used >= max_count:
        bot.answer_callback_query(
            c.id, f"❌ Лимит переводов исчерпан!\n"
            f"Использовано {used}/{max_count} переводов сегодня.\n"
            f"{'Купите VIP для увеличения лимита!' if not user.get('vip') else 'Обновится завтра.'}", show_alert=True
        )
        return
    bot_instance.pending_transfer[user_id] = {
        "step": "target",
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }
    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("❌ Отмена", callback_data="transfer_menu"))
    bot.edit_message_text(
        "💸 <b>НОВЫЙ ПЕРЕВОД</b>\n\n"
        "Отправьте Игровой ID (число) или @username человека, которому хотите перевести деньги.\n"
        "Сумму потом можно будет ввести с сокращениями (1к, 1кк и т.д.).",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "transfer_cancel")
def transfer_cancel(c):
    user_id = c.from_user.id
    if user_id in bot_instance.pending_transfer:
        del bot_instance.pending_transfer[user_id]
    transfer_menu(c)

@bot.callback_query_handler(func=lambda c: c.data.startswith("transfer_confirm_"))
def transfer_confirm_handler(c):
    user_id = c.from_user.id
    parts = c.data.split("_")
    target_id = int(parts[2])
    amount = int(parts[3])

    user = get_user(user_id)
    target = get_user(target_id)

    if user["balance"] < amount:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств для завершения!", show_alert=True)
        transfer_menu(c)
        return

    user["balance"] -= amount
    target["balance"] += amount

    save_user(user_id, user)
    save_user(target_id, target)
    add_transfer_count(user_id)

    bot.answer_callback_query(c.id, "✅ Перевод успешно выполнен!")

    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("◀️ В меню", callback_data="main_menu"))
    bot.edit_message_text(
        f"💸 <b>ПЕРЕВОД ВЫПОЛНЕН!</b>\n\n"
        f"👤 Получатель: <b>{target.get('username', 'Игрок')}</b> (ID: {target.get('game_id')})\n"
        f"💎 Сумма: <b>{fmt(amount)} {CURRENCY}</b>\n\n"
        f"💰 Ваш баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )
    try:
        bot.send_message(
            target_id, f"💸 <b>ВАМ ПРИШЁЛ ПЕРЕВОД!</b>\n\n"
            f"👤 Отправитель: <b>{user.get('username', 'Игрок')}</b>\n"
            f"💎 Сумма: <b>+{fmt(amount)} {CURRENCY}</b>\n\n"
            f"💰 Ваш баланс: <b>{fmt(target['balance'])} {CURRENCY}</b>"
        )
    except: pass
