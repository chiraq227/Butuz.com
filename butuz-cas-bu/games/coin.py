import random
from telebot import types
from config import CURRENCY, MIN_BET
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from users.user_management import update_balance
from core.utils import fmt, get_display_name
from users.admin import is_admin


@bot.callback_query_handler(func=lambda c: c.data == "game_coin")
def coin_menu(c):
    user_id = c.from_user.id
    if not is_admin(user_id):
        bot.answer_callback_query(c.id, "⚠️ Монетка (включая PvP) пока отключена для обычных игроков.\nДоступна только админам: НЕ ДОРАБОТАНО!", show_alert=True)
        return
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🪙 ОРЁЛ (x2)", callback_data="coin_choose_heads"),
        types.InlineKeyboardButton("🪙 РЕШКА (x2)", callback_data="coin_choose_tails"),
    )
    kb.add(types.InlineKeyboardButton("⚔️ МОНЕТКА PvP", callback_data="coin_pvp_menu"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    text = (
        "🪙 <b>МОНЕТКА</b>  ⚠️ НЕ ДОРАБОТАНО!\n\n"
        "Классическая игра на удачу!\n"
        "Выберите сторону — при совпадении выигрыш x2.\n\n"
        "Или вызовите друга на дуэль PvP."
    )
    try:
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    except Exception:
        # При вызове из текстовой команды (fake_c с message_id пользователя) или если сообщение нельзя отредактировать — отправляем новое
        bot.send_message(c.message.chat.id, text, reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data.startswith("coin_choose_"))
def coin_choose_side(c):
    side = c.data.split("_")[-1]  # heads or tails
    from interface.betting import show_bet_menu
    show_bet_menu(c, f"coin_{side}")


@bot.callback_query_handler(func=lambda c: c.data.startswith("play_coin_"))
def play_coin(c):
    user_id = c.from_user.id
    if not is_admin(user_id):
        bot.answer_callback_query(c.id, "⚠️ Монетка пока отключена для обычных игроков (НЕ ДОРАБОТАНО!).", show_alert=True)
        return
    user = get_user(user_id)
    parts = c.data.split("_")
    side = parts[2]  # heads / tails
    bet = int(parts[3])

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)

    result = random.choice(["heads", "tails"])
    side_name = "Орёл" if side == "heads" else "Решка"
    result_name = "Орёл" if result == "heads" else "Решка"

    if side == result:
        win = bet * 2
        new_balance = update_balance(user_id, win)
        outcome = f"✅ Вы угадали! Выпал <b>{result_name}</b>.\n💰 Выигрыш: <b>+{fmt(bet)} {CURRENCY}</b> (x2)"
    else:
        new_balance = get_user(user_id)["balance"]
        outcome = f"❌ Не угадали. Выпал <b>{result_name}</b>.\n💸 Проигрыш: <b>-{fmt(bet)} {CURRENCY}</b>"

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🔄 Сыграть снова", callback_data=f"play_coin_{side}_{bet}"),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    bot.edit_message_text(
        f"🪙 <b>МОНЕТКА</b>\n\n"
        f"Вы выбрали: <b>{side_name}</b>\n"
        f"Выпало: <b>{result_name}</b>\n\n"
        f"{outcome}\n\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


def start_coin_direct(chat_id: int, user_id: int, side: str, bet: int):
    """Прямой запуск монетки из текстовой команды, например 'монетка орёл 1кк'."""
    if not is_admin(user_id):
        bot.send_message(chat_id, "⚠️ Монетка пока отключена для обычных игроков (НЕ ДОРАБОТАНО!).")
        return
    user = get_user(user_id)
    if user["balance"] < bet:
        bot.send_message(chat_id, "❌ Недостаточно средств!")
        return
    if bet < MIN_BET:
        bot.send_message(chat_id, f"❌ Минимальная ставка {MIN_BET} кристаллов.")
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)

    result = random.choice(["heads", "tails"])
    side_name = "Орёл" if side == "heads" else "Решка"
    result_name = "Орёл" if result == "heads" else "Решка"

    if side == result:
        win = bet * 2
        new_balance = update_balance(user_id, win)
        outcome = f"✅ Вы угадали! Выпал <b>{result_name}</b>.\n💰 Выигрыш: <b>+{fmt(bet)} {CURRENCY}</b> (x2)"
    else:
        new_balance = get_user(user_id)["balance"]
        outcome = f"❌ Не угадали. Выпал <b>{result_name}</b>.\n💸 Проигрыш: <b>-{fmt(bet)} {CURRENCY}</b>"

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🔄 Сыграть снова", callback_data=f"play_coin_{side}_{bet}"),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    bot.send_message(
        chat_id,
        f"🪙 <b>МОНЕТКА</b>\n\n"
        f"Вы выбрали: <b>{side_name}</b>\n"
        f"Выпало: <b>{result_name}</b>\n\n"
        f"{outcome}\n\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        reply_markup=kb
    )


# ==================== PvP ====================

def generate_coin_room_id() -> str:
    bot_instance.coin_room_counter += 1
    return f"{bot_instance.coin_room_counter:04d}"


def create_coin_pvp_room(chat_id: int, user_id: int, bet: int, side: str, edit_message_id: int = None):
    """Хелпер для создания PvP комнаты (используется из кнопок и текстовых команд)."""
    user = get_user(user_id)

    if user["balance"] < bet:
        bot.send_message(chat_id, "❌ Недостаточно средств!")
        return

    for rid, r in bot_instance.coin_rooms.items():
        if r["p1_id"] == user_id:
            bot.send_message(chat_id, "❌ Вы уже создали комнату! Сначала отмените её.")
            return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)
    room_id = generate_coin_room_id()
    bot_instance.coin_rooms[room_id] = {
        "p1_id": user_id,
        "p2_id": None,
        "bet": bet,
        "p1_choice": side,
        "p2_choice": None,
        "status": "wait"
    }

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("❌ Удалить комнату", callback_data=f"coin_pvp_cancel_{room_id}"))
    kb.add(types.InlineKeyboardButton("◀️ Назад в меню", callback_data="coin_pvp_menu"))

    side_name = "Орёл" if side == "heads" else "Решка"
    room_text = (
        f"🎉 <b>Комната #{room_id} успешно создана!</b>\n\n"
        f"Ваша сторона: <b>{side_name}</b>\n\n" + coin_pvp_room_text(room_id)
    )

    if edit_message_id:
        try:
            bot.edit_message_text(room_text, chat_id, edit_message_id, reply_markup=kb)
            return
        except Exception:
            pass

    bot.send_message(chat_id, room_text, reply_markup=kb)


def coin_pvp_room_text(room_id: str) -> str:
    if room_id not in bot_instance.coin_rooms:
        return "Комната не найдена"
    r = bot_instance.coin_rooms[room_id]
    p1 = get_user(r["p1_id"])
    p1_name = get_display_name(p1)
    p1_line = f"👑 Создатель: <b>{p1_name}</b>"
    if r.get("p1_choice"):
        ch = "Орёл" if r["p1_choice"] == "heads" else "Решка"
        p1_line += f" (сторона: {ch})"

    if r.get("p2_id"):
        p2 = get_user(r["p2_id"])
        p2_name = get_display_name(p2)
        p2_line = f"👤 Соперник: <b>{p2_name}</b>"
        if r.get("p2_choice"):
            ch2 = "Орёл" if r["p2_choice"] == "heads" else "Решка"
            p2_line += f" (сторона: {ch2})"
    else:
        p2_line = "⏳ Ожидание соперника..."

    return (
        f"🪙 <b>PvP МОНЕТКА #{room_id}</b>\n\n"
        f"💰 Ставка: <b>{fmt(r['bet'])} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"{p1_line}\n"
        f"{p2_line}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        "Победитель забирает банк (минус 5% комиссии бота)."
    )


@bot.callback_query_handler(func=lambda c: c.data == "coin_pvp_menu")
def coin_pvp_menu(c):
    user_id = c.from_user.id
    if not is_admin(user_id):
        bot.answer_callback_query(c.id, "⚠️ Монетка PvP пока отключена для обычных игроков.\nДоступна только админам: НЕ ДОРАБОТАНО!", show_alert=True)
        return
    kb = types.InlineKeyboardMarkup(row_width=1)
    kb.add(
        types.InlineKeyboardButton("➕ Создать комнату", callback_data="coin_pvp_create_menu"),
        types.InlineKeyboardButton("📜 Список комнат", callback_data="coin_pvp_list"),
        types.InlineKeyboardButton("◀️ Назад к монетке", callback_data="game_coin"),
    )
    text = (
        "🪙 <b>МОНЕТКА PvP ДУЭЛИ</b>  ⚠️ НЕ ДОРАБОТАНО!\n\n"
        "Создайте комнату — сразу выберите свою сторону + ставку (команды: монетка создать орёл 1кк).\n"
        "Соперник присоединяется и выбирает свою сторону.\n"
        "Выпадает случайная сторона — кто угадал, тот забирает банк (минус 5% комиссии).\n"
        "Если оба угадали или оба не угадали — ничья, ставки возвращаются."
    )
    try:
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    except Exception:
        bot.send_message(c.message.chat.id, text, reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data == "coin_pvp_create_menu")
def coin_pvp_create_menu(c):
    kb = types.InlineKeyboardMarkup(row_width=2)
    amounts = [50000, 250000, 1000000, 5000000, 25000000]
    buttons = [types.InlineKeyboardButton(f"{fmt(a)} {CURRENCY}", callback_data=f"coin_pvp_create_{a}") for a in amounts]
    kb.add(*buttons)
    kb.add(types.InlineKeyboardButton("✏️ Своя ставка", callback_data="coin_pvp_custom_bet"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="coin_pvp_menu"))
    bot.edit_message_text("Выберите ставку для PvP комнаты Монетка:", c.message.chat.id, c.message.message_id, reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data == "coin_pvp_custom_bet")
def coin_pvp_custom_bet(c):
    user_id = c.from_user.id
    bot_instance.pending_bet_input[user_id] = {
        "game": "coin_pvp",
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }
    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="coin_pvp_create_menu"))
    bot.edit_message_text(
        "✏️ <b>Ввод своей ставки для Монетка PvP</b>\n\nВведите сумму ставки (поддерживаются 1к, 1кк и т.д.):",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


@bot.callback_query_handler(func=lambda c: c.data.startswith("coin_pvp_create_"))
def coin_pvp_create(c):
    """После выбора ставки в меню создания — просим создателя сразу выбрать сторону."""
    user_id = c.from_user.id
    user = get_user(user_id)
    bet = int(c.data.split("_")[-1])

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    for rid, r in bot_instance.coin_rooms.items():
        if r["p1_id"] == user_id:
            bot.answer_callback_query(c.id, "❌ Вы уже создали комнату! Сначала отмените её.", show_alert=True)
            return

    # Показываем выбор стороны создателю (не списываем пока, списываем при финальном создании)
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🪙 Орёл", callback_data=f"coin_pvp_create_side_{bet}_heads"),
        types.InlineKeyboardButton("🪙 Решка", callback_data=f"coin_pvp_create_side_{bet}_tails"),
    )
    bot.edit_message_text(
        f"🪙 Выберите свою сторону для PvP комнаты (ставка {fmt(bet)} {CURRENCY}):\n\n"
        "Создатель выбирает сторону сразу при создании.",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


@bot.callback_query_handler(func=lambda c: c.data.startswith("coin_pvp_create_side_"))
def coin_pvp_create_side(c):
    """Финальное создание комнаты после выбора стороны создателем (использует хелпер)."""
    user_id = c.from_user.id
    parts = c.data.split("_")
    bet = int(parts[3])
    side = parts[4]  # heads or tails

    # Используем хелпер с edit текущего сообщения (выбора стороны)
    create_coin_pvp_room(c.message.chat.id, user_id, bet, side, edit_message_id=c.message.message_id)


@bot.callback_query_handler(func=lambda c: c.data == "coin_pvp_list")
def coin_pvp_list(c):
    kb = types.InlineKeyboardMarkup(row_width=1)
    count = 0
    for rid, r in bot_instance.coin_rooms.items():
        if r["status"] == "wait":
            p1 = get_user(r["p1_id"])
            kb.add(types.InlineKeyboardButton(
                f"🪙 #{rid} | Ставка: {fmt(r['bet'])} | {get_display_name(p1)}",
                callback_data=f"coin_pvp_join_menu_{rid}"
            ))
            count += 1
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="coin_pvp_menu"))
    text = "📜 <b>СПИСОК КОМНАТ МОНЕТКА PvP</b>\n\n"
    if count == 0:
        text += "Сейчас нет активных комнат. Создайте свою!"
    else:
        text += f"Доступно комнат: {count}"
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data.startswith("coin_pvp_join_menu_"))
def coin_pvp_join_menu(c):
    room_id = c.data.split("_")[-1]
    if room_id not in bot_instance.coin_rooms:
        bot.answer_callback_query(c.id, "Комната не найдена")
        coin_pvp_list(c)
        return
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("⚔️ Вступить в бой", callback_data=f"coin_pvp_join_{room_id}"),
        types.InlineKeyboardButton("◀️ Назад", callback_data="coin_pvp_list")
    )
    bot.edit_message_text(coin_pvp_room_text(room_id), c.message.chat.id, c.message.message_id, reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data.startswith("coin_pvp_join_"))
def coin_pvp_join(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    room_id = c.data.split("_")[-1]

    if room_id not in bot_instance.coin_rooms:
        bot.answer_callback_query(c.id, "❌ Комната уже закрыта.")
        return

    r = bot_instance.coin_rooms[room_id]
    if r["p1_id"] == user_id:
        bot.answer_callback_query(c.id, "❌ Вы не можете играть с самим собой!", show_alert=True)
        return

    if user["balance"] < r["bet"]:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    update_balance(user_id, -r["bet"])
    # Запоминаем для присоединившегося (создатель уже запомнил при создании)
    p2_user = get_user(user_id)
    p2_user["last_bet"] = r["bet"]
    save_user(user_id, p2_user)
    r["p2_id"] = user_id
    r["status"] = "choosing"

    p1_id = r["p1_id"]
    bet = r["bet"]

    # Уведомляем создателя (он уже выбрал сторону при создании)
    try:
        bot.send_message(
            p1_id,
            f"🪙 Соперник зашёл в вашу комнату #{room_id} (ставка {fmt(bet)}).\n\n"
            f"Вы уже выбрали сторону. Ожидаем выбор соперника..."
        )
    except Exception:
        pass

    # Просим выбрать сторону только присоединившегося
    kb2 = types.InlineKeyboardMarkup(row_width=2)
    kb2.add(
        types.InlineKeyboardButton("🪙 Орёл", callback_data=f"coin_pvp_choose_{room_id}_heads"),
        types.InlineKeyboardButton("🪙 Решка", callback_data=f"coin_pvp_choose_{room_id}_tails"),
    )
    bot.edit_message_text(
        f"🪙 Вы вошли в комнату #{room_id} (ставка {fmt(bet)}).\n\n"
        f"Выберите свою сторону (создатель уже выбрал свою):",
        c.message.chat.id, c.message.message_id, reply_markup=kb2
    )


@bot.callback_query_handler(func=lambda c: c.data.startswith("coin_pvp_choose_"))
def coin_pvp_choose(c):
    parts = c.data.split("_")
    room_id = parts[3]
    choice = parts[4]  # heads or tails

    if room_id not in bot_instance.coin_rooms:
        bot.answer_callback_query(c.id, "Комната закрыта.")
        return

    r = bot_instance.coin_rooms[room_id]
    uid = c.from_user.id

    if uid == r["p1_id"]:
        if r.get("p1_choice"):
            bot.answer_callback_query(c.id, "Вы уже выбрали сторону.")
            return
        r["p1_choice"] = choice
    elif uid == r["p2_id"]:
        if r.get("p2_choice"):
            bot.answer_callback_query(c.id, "Вы уже выбрали сторону.")
            return
        r["p2_choice"] = choice
    else:
        bot.answer_callback_query(c.id, "Вы не участник этой комнаты.")
        return

    bot.answer_callback_query(c.id, "Сторона зафиксирована.")

    if r.get("p1_choice") and r.get("p2_choice"):
        resolve_coin_pvp(room_id, c)


def resolve_coin_pvp(room_id: str, triggering_c):
    r = bot_instance.coin_rooms.get(room_id)
    if not r:
        return

    p1_id = r["p1_id"]
    p2_id = r["p2_id"]
    bet = r["bet"]

    flip = random.choice(["heads", "tails"])
    flip_name = "Орёл" if flip == "heads" else "Решка"

    p1_choice = r["p1_choice"]
    p2_choice = r["p2_choice"]
    p1_name_choice = "Орёл" if p1_choice == "heads" else "Решка"
    p2_name_choice = "Орёл" if p2_choice == "heads" else "Решка"

    total_pot = bet * 2
    commission = int(total_pot * 0.05)
    win_payout = total_pot - commission

    p1 = get_user(p1_id)
    p2 = get_user(p2_id)

    if p1_choice == flip and p2_choice != flip:
        update_balance(p1_id, win_payout)
        winner_id, loser_id = p1_id, p2_id
        winner_choice = p1_name_choice
        res_text = (
            f"🪙 <b>ИТОГ МОНЕТКА PvP #{room_id}</b>\n\n"
            f"Выпало: <b>{flip_name}</b>\n\n"
            f"👑 Победитель: <b>{get_display_name(p1)}</b> (выбрал {p1_name_choice})\n"
            f"💀 Проигравший: <b>{get_display_name(p2)}</b> (выбрал {p2_name_choice})\n\n"
            f"💰 Чистый выигрыш: <b>{fmt(win_payout)} {CURRENCY}</b> (комиссия 5%)"
        )
    elif p2_choice == flip and p1_choice != flip:
        update_balance(p2_id, win_payout)
        winner_id, loser_id = p2_id, p1_id
        winner_choice = p2_name_choice
        res_text = (
            f"🪙 <b>ИТОГ МОНЕТКА PvP #{room_id}</b>\n\n"
            f"Выпало: <b>{flip_name}</b>\n\n"
            f"👑 Победитель: <b>{get_display_name(p2)}</b> (выбрал {p2_name_choice})\n"
            f"💀 Проигравший: <b>{get_display_name(p1)}</b> (выбрал {p1_name_choice})\n\n"
            f"💰 Чистый выигрыш: <b>{fmt(win_payout)} {CURRENCY}</b> (комиссия 5%)"
        )
    else:
        # Ничья
        update_balance(p1_id, bet)
        update_balance(p2_id, bet)
        del bot_instance.coin_rooms[room_id]
        tie_text = (
            f"🤝 <b>НИЧЬЯ в Монетка PvP #{room_id}</b>\n\n"
            f"Выпало: <b>{flip_name}</b>\n"
            f"Оба выбрали: {p1_name_choice} и {p2_name_choice}\n"
            "Ставки возвращены!"
        )
        try:
            bot.edit_message_text(tie_text, triggering_c.message.chat.id, triggering_c.message.message_id)
        except:
            pass
        try:
            bot.send_message(p1_id, tie_text)
        except:
            pass
        try:
            bot.send_message(p2_id, tie_text)
        except:
            pass
        return

    del bot_instance.coin_rooms[room_id]

    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))

    try:
        bot.edit_message_text(res_text, triggering_c.message.chat.id, triggering_c.message.message_id, reply_markup=kb)
    except:
        pass

    try:
        bot.send_message(p1_id, res_text, reply_markup=kb)
    except:
        pass
    try:
        bot.send_message(p2_id, res_text, reply_markup=kb)
    except:
        pass


@bot.callback_query_handler(func=lambda c: c.data.startswith("coin_pvp_cancel_"))
def coin_pvp_cancel(c):
    room_id = c.data.split("_")[-1]
    if room_id in bot_instance.coin_rooms:
        r = bot_instance.coin_rooms[room_id]
        if r["p2_id"] is None:  # only refund if no one joined
            update_balance(r["p1_id"], r["bet"])
        del bot_instance.coin_rooms[room_id]
        bot.answer_callback_query(c.id, "Комната удалена, средства возвращены (если соперник ещё не зашёл).")
    coin_pvp_menu(c)
