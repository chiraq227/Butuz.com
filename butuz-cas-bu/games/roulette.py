import random
from telebot import types
from config import ROULETTE_REDS, CURRENCY
from bot_instance import bot
from core.database import get_user, save_user
from users.user_management import update_balance
from core.utils import fmt

def roulette_color(n: int) -> str:
    if n == 0: return "🟢"
    return "🔴" if n in ROULETTE_REDS else "⚫"

@bot.callback_query_handler(func=lambda c: c.data == "game_roulette")
def roulette_menu(c):
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🔴 КРАСНОЕ (x2)", callback_data="roulette_bet_red"),
        types.InlineKeyboardButton("⚫ ЧЁРНОЕ (x2)", callback_data="roulette_bet_black"),
    )
    kb.add(
        types.InlineKeyboardButton("🟢 ЗЕРО (x35)", callback_data="roulette_bet_zero"),
        types.InlineKeyboardButton("🔢 ЧИСЛО (x35)", callback_data="roulette_bet_number"),
    )
    kb.add(
        types.InlineKeyboardButton("⬇️ 1–18 (x2)", callback_data="roulette_bet_low"),
        types.InlineKeyboardButton("⬆️ 19–36 (x2)", callback_data="roulette_bet_high"),
    )
    kb.add(
        types.InlineKeyboardButton("⚖️ ЧЁТНОЕ (x2)", callback_data="roulette_bet_even"),
        types.InlineKeyboardButton("⚖️ НЕЧЁТНОЕ (x2)", callback_data="roulette_bet_odd"),
    )
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    bot.edit_message_text(
        "🎡 "
        "<b>ЕВРОПЕЙСКАЯ РУЛЕТКА</b>\n\n"
        "Выберите сектор для ставки:",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("roulette_bet_"))
def roulette_bet(c):
    btype = c.data.replace("roulette_bet_", "")
    if btype == "number":
        kb = types.InlineKeyboardMarkup(row_width=6)
        buttons = [types.InlineKeyboardButton(str(i), callback_data=f"rl_numinput_{i}") for i in range(37)]
        kb.add(*buttons)
        kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="game_roulette"))
        bot.edit_message_text("Выберите число от 0 до 36:", c.message.chat.id, c.message.message_id, reply_markup=kb)
    else:
        from interface.betting import show_bet_menu
        show_bet_menu(c, f"roulette_{btype}")

@bot.callback_query_handler(func=lambda c: c.data.startswith("rl_numinput_"))
def rl_custom_input(c):
    num = c.data.split("_")[-1]
    from interface.betting import show_bet_menu
    show_bet_menu(c, f"roulette_num{num}")

@bot.callback_query_handler(func=lambda c: c.data.startswith("play_roulette_"))
def play_roulette(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    parts = c.data.split("_")
    bet_type = parts[2]
    bet = int(parts[3])

    target = None
    if bet_type.startswith("num"):
        target = int(bet_type.replace("num", ""))
        bet_type = "number"

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)

    result = random.randint(0, 36)
    rc = roulette_color(result)

    win = 0
    if bet_type == "red" and result in ROULETTE_REDS: win = bet * 2; outcome = "✅ Красное!"
    elif bet_type == "black" and result not in ROULETTE_REDS and result != 0: win = bet * 2; outcome = "✅ Чёрное!"
    elif bet_type == "zero" and result == 0: win = bet * 35; outcome = "✅ ЗЕРО! x35"
    elif bet_type == "number" and result == target: win = bet * 35; outcome = f"✅ Число {result}! x35"
    elif bet_type == "low" and 1 <= result <= 18: win = bet * 2; outcome = "✅ 1-18!"
    elif bet_type == "high" and 19 <= result <= 36: win = bet * 2; outcome = "✅ 19-36!"
    elif bet_type == "even" and result != 0 and result % 2 == 0: win = bet * 2; outcome = "✅ Чётное!"
    elif bet_type == "odd" and result % 2 == 1: win = bet * 2; outcome = "✅ Нечётное!"
    else: outcome = "❌ Проигрыш"

    profit = win - bet
    new_balance = update_balance(user_id, win)

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=c.data),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    bot.edit_message_text(
        f"🎡 <b>РУЛЕТКА</b>\n\n"
        f"Выпало: {rc} <b>{result}</b>\n\n"
        f"<b>{outcome}</b>\n\n"
        f"Ставка: {fmt(bet)} {CURRENCY}\n"
        f"{'✅ +' if profit >= 0 else '❌ '}{fmt(abs(profit))} {CURRENCY}\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


def start_roulette_direct(chat_id: int, user_id: int, bet_type: str, target: int | None, bet: int):
    """Прямой запуск рулетки из текстовой команды, например 'рулетка красное 3к' или 'рулетка 17 1кк'."""
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

    result = random.randint(0, 36)
    rc = roulette_color(result)

    win = 0
    if bet_type == "red" and result in ROULETTE_REDS: win = bet * 2; outcome = "✅ Красное!"
    elif bet_type == "black" and result not in ROULETTE_REDS and result != 0: win = bet * 2; outcome = "✅ Чёрное!"
    elif bet_type == "zero" and result == 0: win = bet * 35; outcome = "✅ ЗЕРО! x35"
    elif bet_type == "number" and result == target: win = bet * 35; outcome = f"✅ Число {result}! x35"
    elif bet_type == "low" and 1 <= result <= 18: win = bet * 2; outcome = "✅ 1-18!"
    elif bet_type == "high" and 19 <= result <= 36: win = bet * 2; outcome = "✅ 19-36!"
    elif bet_type == "even" and result != 0 and result % 2 == 0: win = bet * 2; outcome = "✅ Чётное!"
    elif bet_type == "odd" and result % 2 == 1: win = bet * 2; outcome = "✅ Нечётное!"
    else: outcome = "❌ Проигрыш"

    profit = win - bet
    new_balance = update_balance(user_id, win)

    kb = types.InlineKeyboardMarkup(row_width=2)
    # Для повтора: если число, используем roulette_numX , иначе roulette_bet_type
    if bet_type == "number" and target is not None:
        repeat_data = f"play_roulette_num{target}_{bet}"
    else:
        repeat_data = f"play_roulette_{bet_type}_{bet}"
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=repeat_data),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    bet_type_display = {
        "red": "Красное", "black": "Чёрное", "zero": "Зеро",
        "number": f"Число {target}", "low": "1-18", "high": "19-36",
        "even": "Чётное", "odd": "Нечётное"
    }.get(bet_type, bet_type)

    bot.send_message(
        chat_id,
        f"🎡 <b>РУЛЕТКА</b>\n\n"
        f"Выпало: {rc} <b>{result}</b>\n\n"
        f"Ваша ставка: {bet_type_display}\n"
        f"<b>{outcome}</b>\n\n"
        f"Ставка: {fmt(bet)} {CURRENCY}\n"
        f"{'✅ +' if profit >= 0 else '❌ '}{fmt(abs(profit))} {CURRENCY}\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        reply_markup=kb
    )
