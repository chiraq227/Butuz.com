from telebot import types
from config import MIN_BET, CURRENCY
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from core.utils import fmt, parse_amount, make_fake_callback

def bet_keyboard(game: str, current_bet: int) -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup(row_width=2)
    amounts = [1000, 5000, 25000, 100000, 500000, 2500000, 10000000, 50000000]
    buttons = [types.InlineKeyboardButton(f"+{fmt(a)}", callback_data=f"bet_add_{game}_{current_bet}_{a}") for a in amounts]
    kb.add(*buttons)
    kb.add(
        types.InlineKeyboardButton("🗑 Сбросить", callback_data=f"bet_clear_{game}"),
        types.InlineKeyboardButton("✏️ Своя ставка", callback_data=f"bet_custom_{game}_{current_bet}"),
    )
    # Кнопка ВАБАНК
    kb.add(types.InlineKeyboardButton("💰 ВАБАНК!! (весь баланс)", callback_data=f"bet_vabank_{game}"))
    kb.add(types.InlineKeyboardButton("✖️ Отмена", callback_data=f"{game}_cancel" if ("mines_" in game or "pvp" in game) else f"game_{game}"))
    if current_bet >= MIN_BET:
        kb.add(types.InlineKeyboardButton(f"🚀 ИГРАТЬ ({fmt(current_bet)} {CURRENCY})", callback_data=f"play_{game}_{current_bet}"))
    return kb

def show_bet_menu(c, game: str, current_bet: int = 0):
    user = get_user(c.from_user.id)
    game_names = {
        "slots": ("🎰 <b>СЛОТЫ</b>", "Три одинаковых символа = ДЖЕКПОТ!\nДва совпадения = x1.5\n💎=x8, 7️⃣=x15, ⭐=x25, 🔔=x50"),
        "mines": ("💣 <b>МИНЫ</b>", "Открывай клетки — за каждую множитель растёт.\nПопал на мину — всё потерял!"),
        "blackjack": ("🃏 <b>БЛЭКДЖЕК</b>", "Набери 21 или ближе к 21 чем дилер.\nТуз = 1 или 11. J/Q/K = 10.\nБлэкджек (Туз+10) = x2.5!"),

        "dice": ("🎲 <b>КОСТИ</b>", "Бросаем два кубика.\nБольше/меньше 7 = x1.9, точное число = x5-x36"),
        "roulette": ("🎡 <b>РУЛЕТКА</b>", "Крутим европейскую рулетку (0-36)."),
        "coin_heads": ("🪙 <b>МОНЕТКА — ОРЁЛ</b>", "Выберите ставку. При выпадении Орла — выигрыш x2."),
        "coin_tails": ("🪙 <b>МОНЕТКА — РЕШКА</b>", "Выберите ставку. При выпадении Решки — выигрыш x2."),
    }
    
    gkey = game.split("_")[0]
    name, desc = game_names.get(game, game_names.get(gkey, (f"🎮 <b>{game.upper()}</b>", "")))

    # Запоминаем предыдущую ставку пользователя
    if current_bet == 0:
        last_bet = user.get("last_bet", 0)
        if last_bet > 0 and last_bet <= user["balance"]:
            current_bet = last_bet
        elif last_bet > user["balance"] and user["balance"] >= MIN_BET:
            current_bet = user["balance"]  # если прошлая была больше текущего баланса — предлагаем вабанк

    text = (
        f"{name}\n"
        f"<i>{desc}</i>\n\n"
        f"💰 Ваш баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>\n"
        f"💵 Текущая ставка: <b>{fmt(current_bet)} {CURRENCY}</b>\n\n"
        f"Используйте кнопки снизу для изменения ставки:"
    )
    kb = bet_keyboard(game, current_bet)
    try:
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    except Exception:
        # Если оригинальное сообщение нельзя отредактировать (старое/удалено) — отправляем новое меню
        try:
            bot.send_message(c.message.chat.id, text, reply_markup=kb)
        except Exception:
            pass

@bot.callback_query_handler(func=lambda c: c.data.startswith("bet_"))
def bet_selector(c):
    user_id = c.from_user.id
    parts = c.data.split("_")
    action = parts[1]

    if action == "add":
        game = parts[2]
        if len(parts) == 6: # Из-за mines_count или аналогичных суффиксов
            game = f"{parts[2]}_{parts[3]}"
            curr_bet = int(parts[4])
            add_val = int(parts[5])
        else:
            curr_bet = int(parts[3])
            add_val = int(parts[4])
        show_bet_menu(c, game, curr_bet + add_val)
    elif action == "clear":
        game = "_".join(parts[2:])
        show_bet_menu(c, game, 0)
    elif action == "custom":
        game = parts[2]
        if len(parts) == 5:
            game = f"{parts[2]}_{parts[3]}"
            curr_bet = int(parts[4])
        else:
            curr_bet = int(parts[3])

        bot_instance.pending_bet_input[user_id] = {
            "game": game,
            "chat_id": c.message.chat.id,
            "message_id": c.message.message_id
        }
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data=f"cancel_custom_bet_{game}_{curr_bet}"))
        bot.edit_message_text(
            f"✏️ <b>Ввод своей ставки вручную</b>\n\n"
            f"Введите сумму ставки в ответ на это сообщение.\n"
            f"Минимум: {MIN_BET} кристаллов.\n"
            f"Можно писать сокращения: <b>1к</b> = 1 000, <b>1кк</b> = 1 000 000, <b>100ккк</b> и т.д.",
            c.message.chat.id, c.message.message_id, reply_markup=kb
        )

@bot.callback_query_handler(func=lambda c: c.data.startswith("cancel_custom_bet_"))
def cancel_custom_bet(c):
    user_id = c.from_user.id
    parts = c.data.split("_")
    game = "_".join(parts[3:-1])
    current_bet = int(parts[-1])
    if user_id in bot_instance.pending_bet_input:
        del bot_instance.pending_bet_input[user_id]
    show_bet_menu(c, game, current_bet)


@bot.callback_query_handler(func=lambda c: c.data.startswith("bet_vabank_"))
def bet_vabank(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    game = c.data.replace("bet_vabank_", "")
    vabank_amount = user["balance"]
    if vabank_amount < MIN_BET:
        bot.answer_callback_query(c.id, f"❌ Недостаточно средств для вабанка (минимум {MIN_BET})!", show_alert=True)
        show_bet_menu(c, game, 0)
        return
    # Сохраняем как последнюю ставку сразу
    user["last_bet"] = vabank_amount
    save_user(user_id, user)
    show_bet_menu(c, game, vabank_amount)

def handle_custom_bet_input(message):
    user_id = message.from_user.id
    state = bot_instance.pending_bet_input.get(user_id)
    if not state: return

    game = state["game"]
    chat_id = state["chat_id"]
    msg_id = state["message_id"]

    text_lower = message.text.strip().lower()
    if text_lower in ["все", "всё", "all", "вабанк", "весь баланс"]:
        user = get_user(user_id)
        val = user["balance"]
    else:
        val = parse_amount(message.text)

    if val is None or val < MIN_BET:
        bot.reply_to(message, f"❌ Неверный формат ставки! Должно быть число ≥ {MIN_BET} (или напишите «все» / «вабанк»).\nПоддерживаются сокращения: 1к=1000, 1кк=1000000, 50к, 100ккк и т.д.")
        return

    del bot_instance.pending_bet_input[user_id]
    try: bot.delete_message(message.chat.id, message.message_id)
    except: pass

    # Запоминаем последнюю ставку (кроме банковских операций)
    if not game.startswith("bank_"):
        u = get_user(user_id)
        u["last_bet"] = val
        save_user(user_id, u)

    # Используем надёжный минимальный фейк вместо types.CallbackQuery
    # (старый код падал на CallbackQuery.__init__ из-за json_string и порядка параметров в текущей версии telebot)
    fake_c = make_fake_callback(message.from_user, chat_id, msg_id)

    if game == "bank_dep":
        user = get_user(user_id)
        if val > user["balance"]: val = user["balance"]
        if val <= 0: return
        user["balance"] -= val
        user["bank_balance"] = user.get("bank_balance", 0) + val
        save_user(user_id, user)
        from economy.bank import bank_menu_handler
        bank_menu_handler(fake_c)
    elif game == "bank_with" or game == "bank_wd":
        user = get_user(user_id)
        bb = user.get("bank_balance", 0)
        if val > bb: val = bb
        if val <= 0: return
        user["balance"] += val
        user["bank_balance"] = bb - val
        save_user(user_id, user)
        from economy.bank import bank_menu_handler
        bank_menu_handler(fake_c)
    elif game == "dice_pvp":
        fake_c.data = f"dice_pvp_create_{val}"
        from games.dice import dice_pvp_create
        dice_pvp_create(fake_c)
    elif game == "coin_pvp":
        fake_c.data = f"coin_pvp_create_{val}"
        from games.coin import coin_pvp_create
        coin_pvp_create(fake_c)
    else:
        show_bet_menu(fake_c, game, val)
