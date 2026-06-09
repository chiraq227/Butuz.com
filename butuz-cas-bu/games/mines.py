import random
from telebot import types
from config import CURRENCY
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from users.user_management import update_balance
from core.utils import fmt

def get_mines_mult(opened, mines_count):
    cells = 25 - mines_count
    if opened == 0: return 1.0
    mult = 1.0
    for i in range(opened):
        mult *= (25 - i) / (cells - i)
    return round(mult * 0.95, 2)

@bot.callback_query_handler(func=lambda c: c.data == "game_mines")
def mines_menu(c):
    kb = types.InlineKeyboardMarkup(row_width=3)
    kb.add(
        types.InlineKeyboardButton("💣 3 мины", callback_data="start_mines_3"),
        types.InlineKeyboardButton("💣 5 мин", callback_data="start_mines_5"),
        types.InlineKeyboardButton("💣 10 мин", callback_data="start_mines_10"),
    )
    kb.add(types.InlineKeyboardButton("💣 15 мин", callback_data="start_mines_15"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    bot.edit_message_text(
        "💣 <b>МИНЫ</b>\n\n"
        "Выберите количество мин на поле 5x5:",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("start_mines_"))
def start_mines(c):
    mines_count = int(c.data.split("_")[-1])
    from interface.betting import show_bet_menu
    show_bet_menu(c, f"mines_{mines_count}")

@bot.callback_query_handler(func=lambda c: c.data.startswith("play_mines_"))
def mines_grid_start(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    parts = c.data.split("_")
    mines_count = int(parts[2])
    bet = int(parts[3])

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)

    grid = [0] * 25
    mine_indices = random.sample(range(25), mines_count)
    for idx in mine_indices:
        grid[idx] = 1

    bot_instance.active_games[user_id] = {
        "game": "mines",
        "bet": bet,
        "mines_count": mines_count,
        "grid": grid,
        "opened": [],
        "mult": 1.0,
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }

    text = mines_render_text(user_id)
    kb = mines_render_kb(user_id)
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)


def start_mines_direct(chat_id: int, user_id: int, mines_count: int, bet: int):
    """Прямой запуск мин из текстовой команды (например 'мины 3 1кк')."""
    user = get_user(user_id)
    if user["balance"] < bet:
        bot.send_message(chat_id, "❌ Недостаточно средств!")
        return
    if bet < 10:
        bot.send_message(chat_id, "❌ Минимальная ставка 10 кристаллов.")
        return
    if mines_count not in (3, 5, 10, 15):
        bot.send_message(chat_id, "❌ Количество мин: 3, 5, 10 или 15.")
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)

    grid = [0] * 25
    mine_indices = random.sample(range(25), mines_count)
    for idx in mine_indices:
        grid[idx] = 1

    bot_instance.active_games[user_id] = {
        "game": "mines",
        "bet": bet,
        "mines_count": mines_count,
        "grid": grid,
        "opened": [],
        "mult": 1.0,
        "chat_id": chat_id,
        "message_id": None  # will be set after send
    }

    text = mines_render_text(user_id)
    kb = mines_render_kb(user_id)
    sent = bot.send_message(chat_id, text, reply_markup=kb)

    # Обновляем message_id для будущих ходов
    bot_instance.active_games[user_id]["message_id"] = sent.message_id


def mines_render_text(user_id):
    g = bot_instance.active_games[user_id]
    text = (
        f"💣 <b>МИНЫ: ИГРА НАЧАТА</b>\n\n"
        f"💰 Ставка: <b>{fmt(g['bet'])} {CURRENCY}</b>\n"
        f"💣 Мин на поле: <b>{g['mines_count']}</b>\n"
        f"🟩 Открыто клеток: <b>{len(g['opened'])}/{(25-g['mines_count'])}</b>\n"
        f"📈 Множитель: <b>x{g['mult']}</b>\n"
        f"💰 Потенциальный приз: <b>{fmt(int(g['bet'] * g['mult']))} {CURRENCY}</b>\n\n"
        f"Нажимай на кнопки чтобы открыть клетку!"
    )
    return text

def mines_render_kb(user_id, reveal=False):
    g = bot_instance.active_games[user_id]
    kb = types.InlineKeyboardMarkup(row_width=5)
    buttons = []
    for i in range(25):
        if i in g["opened"]:
            if g["grid"][i] == 1:
                buttons.append(types.InlineKeyboardButton("💥", callback_data="mines_noop"))
            else:
                buttons.append(types.InlineKeyboardButton("💎", callback_data="mines_noop"))
        else:
            if reveal:
                if g["grid"][i] == 1:
                    buttons.append(types.InlineKeyboardButton("💣", callback_data="mines_noop"))
                else:
                    buttons.append(types.InlineKeyboardButton("🔹", callback_data="mines_noop"))
            else:
                buttons.append(types.InlineKeyboardButton("⬛", callback_data=f"mine_open_{user_id}_{i}"))
    kb.add(*buttons)
    if not reveal and len(g["opened"]) > 0:
        kb.add(types.InlineKeyboardButton(f"💰 Забрать {fmt(int(g['bet']*g['mult']))} {CURRENCY}", callback_data=f"mine_cashout_{user_id}"))
    return kb

@bot.callback_query_handler(func=lambda c: c.data.startswith("mine_open_"))
def mines_open_cell(c):
    parts = c.data.split("_")
    uid = int(parts[2])
    cell = int(parts[3])

    if c.from_user.id != uid:
        bot.answer_callback_query(c.id, "❌ Это не ваша игра!")
        return

    if uid not in bot_instance.active_games:
        bot.answer_callback_query(c.id, "Игра не найдена")
        return

    g = bot_instance.active_games[uid]
    if cell in g["opened"]: return

    g["opened"].append(cell)

    if g["grid"][cell] == 1:
        text = (
            f"💣 <b>МИНЫ: ПРОИГРЫШ!</b>\n\n"
            f"💥 Вы подорвались на мине!\n"
            f"❌ Потеряно: <b>-{fmt(g['bet'])} {CURRENCY}</b>\n"
            f"💰 Баланс: <b>{fmt(get_user(uid)['balance'])} {CURRENCY}</b>"
        )
        kb = mines_render_kb(uid, reveal=True)
        kb.add(
            types.InlineKeyboardButton("🔄 Играть снова", callback_data=f"start_mines_{g['mines_count']}"),
            types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu")
        )
        del bot_instance.active_games[uid]
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
        return

    g["mult"] = get_mines_mult(len(g["opened"]), g["mines_count"])

    if len(g["opened"]) == (25 - g["mines_count"]):
        win = int(g["bet"] * g["mult"])
        new_balance = update_balance(uid, win)
        text = (
            f"💣 <b>МИНЫ: ПОЛНАЯ ПОБЕДА!!</b>\n\n"
            f"🏆 Вы открыли все чистые клетки!\n"
            f"📈 Итоговый множитель: <b>x{g['mult']}</b>\n"
            f"💰 Выигрыш: <b>+{fmt(win)} {CURRENCY}</b>\n"
            f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>"
        )
        kb = mines_render_kb(uid, reveal=True)
        kb.add(
            types.InlineKeyboardButton("🔄 Снова", callback_data=f"start_mines_{g['mines_count']}"),
            types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu")
        )
        del bot_instance.active_games[uid]
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
        return

    bot_instance.active_games[uid] = g
    bot.edit_message_text(mines_render_text(uid), c.message.chat.id, c.message.message_id, reply_markup=mines_render_kb(uid))

@bot.callback_query_handler(func=lambda c: c.data.startswith("mine_cashout_"))
def mines_cashout(c):
    uid = int(c.data.split("_")[-1])
    if c.from_user.id != uid: return

    if uid not in bot_instance.active_games: return
    g = bot_instance.active_games[uid]

    win = int(g["bet"] * g["mult"])
    new_balance = update_balance(uid, win)

    text = (
        f"💣 <b>МИНЫ: ЗАБРАЛИ ПРИЗ</b>\n\n"
        f"📈 Вы забрали деньги на множителе <b>x{g['mult']}</b>\n"
        f"💰 Выигрыш: <b>+{fmt(win)} {CURRENCY}</b>\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>"
    )
    kb = mines_render_kb(uid, reveal=True)
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=f"start_mines_{g['mines_count']}"),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu")
    )
    del bot_instance.active_games[uid]
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "mine_cancel")
def mines_cancel_handler(c):
    mines_menu(c)

@bot.callback_query_handler(func=lambda c: c.data == "mines_noop")
def mines_noop(c):
    bot.answer_callback_query(c.id)
