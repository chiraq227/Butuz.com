from telebot import types
from config import CURRENCY
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from core.utils import fmt

def bank_menu_text(user_id: int) -> str:
    user = get_user(user_id)
    text = (
        f"🏦 <b>ЦЕНТРАЛЬНЫЙ БАНК</b>\n\n"
        f"Безопасное место для хранения ваших сбережений.\n"
        f"Здесь ваши деньги защищены от случайных проигрышей!\n\n"
        f"💎 На руках: <b>{fmt(user['balance'])} {CURRENCY}</b>\n"
        f"🏦 В банке: <b>{fmt(user.get('bank_balance', 0))} {CURRENCY}</b>"
    )
    return text

def bank_menu_kb() -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("📥 Депозит", callback_data="bank_deposit"),
        types.InlineKeyboardButton("📤 Снятие", callback_data="bank_withdraw"),
    )
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    return kb

@bot.callback_query_handler(func=lambda c: c.data == "bank_menu")
def bank_menu_handler(c):
    user_id = c.from_user.id
    text = bank_menu_text(user_id)
    kb = bank_menu_kb()
    try:
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    except Exception:
        try:
            bot.send_message(c.message.chat.id, text, reply_markup=kb)
        except Exception:
            pass

@bot.callback_query_handler(func=lambda c: c.data == "bank_deposit")
def bank_deposit_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    bot_instance.pending_bet_input[user_id] = {
        "game": "bank_dep",
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }
    kb = types.InlineKeyboardMarkup(row_width=2)
    if user["balance"] >= 100000:
        kb.add(types.InlineKeyboardButton(f"📥 {fmt(user['balance']//2)} (50%)", callback_data="bank_dep_50"))
    if user["balance"] > 0:
        kb.add(types.InlineKeyboardButton("📥 Всё (100%)", callback_data="bank_dep_100"))
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="bank_menu"))
    bot.edit_message_text(
        f"📥 <b>ДЕПОЗИТ В БАНК</b>\n\n"
        f"💎 На руках: <b>{fmt(user['balance'])} {CURRENCY}</b>\n\n"
        f"Введите сумму (поддерживаются сокращения: 1к=1000, 1кк=1M и т.д.):",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("bank_dep_"))
def bank_deposit_quick(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    mode = c.data.replace("bank_dep_", "")

    if user_id in bot_instance.pending_bet_input:
        del bot_instance.pending_bet_input[user_id]

    if mode == "50": amount = user["balance"] // 2
    else: amount = user["balance"]

    if amount <= 0:
        bot.answer_callback_query(c.id, "❌ У вас нет кристаллов!", show_alert=True)
        bank_menu_handler(c)
        return

    user["balance"] -= amount
    user["bank_balance"] = user.get("bank_balance", 0) + amount
    save_user(user_id, user)
    bot.answer_callback_query(c.id, f"📥 Положено: {fmt(amount)} {CURRENCY}")
    bank_menu_handler(c)

@bot.callback_query_handler(func=lambda c: c.data == "bank_withdraw")
def bank_withdraw_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    bb = user.get("bank_balance", 0)
    bot_instance.pending_bet_input[user_id] = {
        "game": "bank_wd",
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }
    kb = types.InlineKeyboardMarkup(row_width=2)
    if bb >= 100000:
        kb.add(types.InlineKeyboardButton(f"📤 {fmt(bb//2)} (50%)", callback_data="bank_wd_50"))
    if bb > 0:
        kb.add(types.InlineKeyboardButton("📤 Всё (100%)", callback_data="bank_wd_100"))
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="bank_menu"))
    bot.edit_message_text(
        f"📤 <b>СНЯТИЕ ИЗ БАНКА</b>\n\n"
        f"🏦 В банке: <b>{fmt(bb)} {CURRENCY}</b>\n\n"
        f"Введите сумму (поддерживаются 1к, 1кк и т.д.):",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("bank_wd_"))
def bank_withdraw_quick(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    mode = c.data.replace("bank_wd_", "")

    if user_id in bot_instance.pending_bet_input:
        del bot_instance.pending_bet_input[user_id]

    bb = user.get("bank_balance", 0)
    if mode == "50": amount = bb // 2
    else: amount = bb

    if amount <= 0:
        bot.answer_callback_query(c.id, "❌ У вас нет сбережений в банке!", show_alert=True)
        bank_menu_handler(c)
        return

    user["balance"] += amount
    user["bank_balance"] = bb - amount
    save_user(user_id, user)
    bot.answer_callback_query(c.id, f"📤 Снято: {fmt(amount)} {CURRENCY}")
    bank_menu_handler(c)

@bot.callback_query_handler(func=lambda c: c.data == "bank_cancel")
def bank_cancel_handler(c):
    bank_menu_handler(c)
