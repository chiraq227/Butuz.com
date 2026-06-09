import random
from telebot import types
from config import SLOT_SYMBOLS, SLOT_WEIGHTS, SLOT_MULTIPLIERS, CURRENCY
from bot_instance import bot
from core.database import get_user, save_user
from users.user_management import update_balance
from core.utils import fmt

def spin_slots():
    return random.choices(SLOT_SYMBOLS, weights=SLOT_WEIGHTS, k=3)

def slots_result(reels):
    if reels[0] == reels[1] == reels[2]:
        sym = reels[0]
        mult = SLOT_MULTIPLIERS[sym]
        return mult, f"🎰 ДЖЕКПОТ! Три в ряд: {sym} (x{mult})"
    elif reels[0] == reels[1] or reels[1] == reels[2] or reels[0] == reels[2]:
        matched = reels[1] if (reels[1] == reels[0] or reels[1] == reels[2]) else reels[0]
        return 1.5, f"✨ Две совпали: {matched} (x1.5)"
    return 0, "❌ Проигрыш"

@bot.callback_query_handler(func=lambda c: c.data == "game_slots")
def slots_menu(c):
    from interface.betting import show_bet_menu
    show_bet_menu(c, "slots")

@bot.callback_query_handler(func=lambda c: c.data.startswith("play_slots_"))
def play_slots(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    bet = int(c.data.split("_")[-1])

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)
    reels = spin_slots()
    mult, status = slots_result(reels)
    win = int(bet * mult)
    profit = win - bet
    new_balance = update_balance(user_id, win)

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=c.data),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    bot.edit_message_text(
        f"🎰 <b>СЛОТЫ</b>\n\n"
        f" ┌──────────┐\n"
        f" │  {reels[0]} | {reels[1]} | {reels[2]}  │\n"
        f" └──────────┘\n\n"
        f"<b>{status}</b>\n\n"
        f"Ставка: {fmt(bet)} {CURRENCY}\n"
        f"{'✅ +' if profit >= 0 else '❌ '}{fmt(abs(profit))} {CURRENCY}\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


def start_slots_direct(chat_id: int, user_id: int, bet: int):
    """Прямой запуск слотов из текстовой команды."""
    user = get_user(user_id)
    if user["balance"] < bet:
        bot.send_message(chat_id, "❌ Недостаточно средств!")
        return
    if bet < 10:
        bot.send_message(chat_id, "❌ Минимальная ставка 10 кристаллов.")
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)
    reels = spin_slots()
    mult, status = slots_result(reels)
    win = int(bet * mult)
    profit = win - bet
    new_balance = update_balance(user_id, win)

    kb = types.InlineKeyboardMarkup(row_width=2)
    # Для повтора используем callback с той же ставкой (пользователь может нажать)
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=f"play_slots_{bet}"),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    bot.send_message(
        chat_id,
        f"🎰 <b>СЛОТЫ</b>\n\n"
        f" ┌──────────┐\n"
        f" │  {reels[0]} | {reels[1]} | {reels[2]}  │\n"
        f" └──────────┘\n\n"
        f"<b>{status}</b>\n\n"
        f"Ставка: {fmt(bet)} {CURRENCY}\n"
        f"{'✅ +' if profit >= 0 else '❌ '}{fmt(abs(profit))} {CURRENCY}\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        reply_markup=kb
    )

