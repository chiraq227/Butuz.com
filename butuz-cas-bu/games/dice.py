import random
from telebot import types
from config import CURRENCY
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from users.user_management import update_balance
from core.utils import fmt, generate_room_id, get_display_name

@bot.callback_query_handler(func=lambda c: c.data == "game_dice")
def dice_menu(c):
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("⬆️ Больше 7", callback_data="dice_bet_high"),
        types.InlineKeyboardButton("⬇️ Меньше 7", callback_data="dice_bet_low"),
    )
    kb.add(types.InlineKeyboardButton("🎯 Ровно 7 (x5)", callback_data="dice_bet_seven"))
    kb.add(types.InlineKeyboardButton("🔢 Точное число (x36)", callback_data="dice_bet_exact"))
    kb.add(types.InlineKeyboardButton("⚔️ Дуэль с игроком (PvP)", callback_data="dice_pvp_menu"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    bot.edit_message_text(
        "🎲 <b>КОСТИ (ДВА КУБИКА)</b>\n\n"
        "Сумма двух кубиков даёт число от 2 до 12.\n"
        "Выберите тип ставки:",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("dice_bet_"))
def dice_bet_type(c):
    btype = c.data.replace("dice_bet_", "")
    if btype == "exact":
        kb = types.InlineKeyboardMarkup(row_width=4)
        buttons = [types.InlineKeyboardButton(str(i), callback_data=f"dice_exactnum_{i}") for i in range(2, 13)]
        kb.add(*buttons)
        kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="game_dice"))
        bot.edit_message_text("Выберите число от 2 до 12:", c.message.chat.id, c.message.message_id, reply_markup=kb)
    else:
        from interface.betting import show_bet_menu
        show_bet_menu(c, f"dice_{btype}")

@bot.callback_query_handler(func=lambda c: c.data.startswith("dice_exactnum_"))
def dice_custom_input(c):
    num = c.data.split("_")[-1]
    from interface.betting import show_bet_menu
    show_bet_menu(c, f"dice_num{num}")

@bot.callback_query_handler(func=lambda c: c.data.startswith("play_dice_"))
def play_dice(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    parts = c.data.split("_")
    btype = parts[2]
    bet = int(parts[3])

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)

    d1, d2 = random.randint(1, 6), random.randint(1, 6)
    res = d1 + d2

    win = 0
    mult = 1.9
    if btype == "high" and res > 7: win = int(bet * mult)
    elif btype == "low" and res < 7: win = int(bet * mult)
    elif btype == "seven" and res == 7: win = int(bet * 5.0)
    elif btype.startswith("num") and res == int(btype.replace("num", "")): win = int(bet * 36.0)

    profit = win - bet
    new_balance = update_balance(user_id, win)

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=c.data),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    bot.edit_message_text(
        f"🎲 <b>КОСТИ</b>\n\n"
        f"Бросок... 🎲 <b>{d1}</b> и 🎲 <b>{d2}</b>\n"
        f"Сумма: <b>{res}</b>\n\n"
        f"{'✅ Выигрыш!' if win > 0 else '❌ Проигрыш'}\n\n"
        f"Ставка: {fmt(bet)} {CURRENCY}\n"
        f"{'✅ +' if profit >= 0 else '❌ '}{fmt(abs(profit))} {CURRENCY}\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

def dice_pvp_room_text(room_id: str) -> str:
    r = bot_instance.dice_rooms[room_id]
    p1 = get_user(r["p1_id"])
    p1_name = get_display_name(p1)
    p2_line = "⏳ Ожидание соперника..."
    if r["p2_id"]:
        p2 = get_user(r["p2_id"])
        p2_name = get_display_name(p2)
        p2_line = f"👤 Игрок 2: <b>{p2_name}</b>"
    return (
        f"⚔️ <b>PvP КОМНАТА #{room_id}</b>\n\n"
        f"💰 Ставка: <b>{fmt(r['bet'])} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"👑 Создатель: <b>{p1_name}</b>\n"
        f"{p2_line}\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )

@bot.callback_query_handler(func=lambda c: c.data == "dice_pvp_menu")
def dice_pvp_menu(c):
    kb = types.InlineKeyboardMarkup(row_width=1)
    kb.add(
        types.InlineKeyboardButton("➕ Создать комнату", callback_data="dice_pvp_create_menu"),
        types.InlineKeyboardButton("📜 Список комнат", callback_data="dice_pvp_list"),
        types.InlineKeyboardButton("◀️ Назад к костям", callback_data="game_dice")
    )
    bot.edit_message_text(
        "⚔️ <b>PvP ДУЭЛИ В КОСТИ</b>\n\n"
        "Играйте напрямую против других участников бота на реальные кристаллы!\n"
        "Победитель забирает всё (за вычетом комиссии 5%)",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "dice_pvp_create_menu")
def dice_pvp_create_menu(c):
    kb = types.InlineKeyboardMarkup(row_width=2)
    amounts = [50000, 250000, 1000000, 5000000, 25000000]
    buttons = [types.InlineKeyboardButton(f"{fmt(a)} {CURRENCY}", callback_data=f"dice_pvp_create_{a}") for a in amounts]
    kb.add(*buttons)
    kb.add(types.InlineKeyboardButton("✏️ Своя ставка", callback_data="dice_pvp_custom_bet"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="dice_pvp_menu"))
    bot.edit_message_text("Выберите ставку для PvP комнаты:", c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "dice_pvp_custom_bet")
def dice_pvp_custom_bet(c):
    user_id = c.from_user.id
    bot_instance.pending_bet_input[user_id] = {
        "game": "dice_pvp",
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }
    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="dice_pvp_create_menu"))
    bot.edit_message_text(
        "✏️ <b>Ввод своей ставки для PvP</b>\n\nВведите сумму ставки (1к=1000, 1кк=1 000 000 и т.д.):",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("dice_pvp_create_"))
def dice_pvp_create(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    bet = int(c.data.split("_")[-1])

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    for rid, r in bot_instance.dice_rooms.items():
        if r["p1_id"] == user_id:
            bot.answer_callback_query(c.id, "❌ Вы уже создали комнату! Сначала отмените её.", show_alert=True)
            return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)
    room_id = generate_room_id()
    bot_instance.dice_rooms[room_id] = {
        "p1_id": user_id,
        "p2_id": None,
        "bet": bet,
        "status": "wait"
    }

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("❌ Удалить комнату", callback_data=f"dice_pvp_cancel_{room_id}"))
    kb.add(types.InlineKeyboardButton("◀️ Назад в меню", callback_data="dice_pvp_menu"))

    bot.edit_message_text(
        f"🎉 <b>Комната #{room_id} успешно создана!</b>\n\n" + dice_pvp_room_text(room_id),
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "dice_pvp_list")
def dice_pvp_list(c):
    kb = types.InlineKeyboardMarkup(row_width=1)
    count = 0
    for rid, r in bot_instance.dice_rooms.items():
        if r["status"] == "wait":
            p1 = get_user(r["p1_id"])
            kb.add(types.InlineKeyboardButton(
                f"🎲 #{rid} | Ставка: {fmt(r['bet'])} | {get_display_name(p1)}",
                callback_data=f"dice_pvp_join_menu_{rid}"
            ))
            count += 1
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="dice_pvp_menu"))
    text = "📜 <b>СПИСОК PvP КОМНАТ</b>\n\n"
    if count == 0:
        text += "Сейчас нет активных комнат для подключения. Создайте свою!"
    else:
        text += f"Доступно комнат для игры: {count}"
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data.startswith("dice_pvp_join_menu_"))
def dice_pvp_join_menu(c):
    room_id = c.data.split("_")[-1]
    if room_id not in bot_instance.dice_rooms:
        bot.answer_callback_query(c.id, "Комната не найдена")
        dice_pvp_list(c)
        return
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("⚔️ Вступить в бой", callback_data=f"dice_pvp_join_{room_id}"),
        types.InlineKeyboardButton("◀️ Назад", callback_data="dice_pvp_list")
    )
    bot.edit_message_text(dice_pvp_room_text(room_id), c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data.startswith("dice_pvp_join_"))
def dice_pvp_join(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    room_id = c.data.split("_")[-1]

    if room_id not in bot_instance.dice_rooms:
        bot.answer_callback_query(c.id, "❌ Комната уже закрыта.")
        return

    r = bot_instance.dice_rooms[room_id]
    if r["p1_id"] == user_id:
        bot.answer_callback_query(c.id, "❌ Вы не можете играть с самим собой!", show_alert=True)
        return

    if user["balance"] < r["bet"]:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    update_balance(user_id, -r["bet"])
    # Запоминаем для обоих (p1 уже запомнил при создании)
    p2_user = get_user(user_id)
    p2_user["last_bet"] = r["bet"]
    save_user(user_id, p2_user)
    r["p2_id"] = user_id
    r["status"] = "play"

    p1_id = r["p1_id"]
    bet = r["bet"]

    d1 = random.randint(1, 6) + random.randint(1, 6)
    d2 = random.randint(1, 6) + random.randint(1, 6)

    total_bank = int(bet * 2 * 0.95)

    if d1 > d2:
        update_balance(p1_id, bet * 2 - int(bet * 2 * 0.05))
        w_id, l_id = p1_id, user_id
        w_score, l_score = d1, d2
    elif d2 > d1:
        update_balance(user_id, bet * 2 - int(bet * 2 * 0.05))
        w_id, l_id = user_id, p1_id
        w_score, l_score = d2, d1
    else:
        update_balance(p1_id, bet)
        update_balance(user_id, bet)
        del bot_instance.dice_rooms[room_id]
        txt = f"🤝 <b>НИЧЬЯ в PvP Дуэли #{room_id}!</b>\n\nОба игрока выбросили по <b>{d1}</b>.\nСтавки возвращены!"
        bot.edit_message_text(txt, c.message.chat.id, c.message.message_id)
        try: bot.send_message(p1_id, txt)
        except: pass
        return

    del bot_instance.dice_rooms[room_id]

    w_user, l_user = get_user(w_id), get_user(l_id)
    w_name = get_display_name(w_user)
    l_name = get_display_name(l_user)

    res_text = (
        f"⚔️ <b>ИТОГ PvP ДУЭЛИ #{room_id}</b>\n\n"
        f"👑 Победитель: <b>{w_name}</b> (выбросил {w_score})\n"
        f"💀 Проигравший: <b>{l_name}</b> (выбросил {l_score})\n\n"
        f"💰 Чистый выигрыш: <b>{fmt(total_bank)} {CURRENCY}</b> (комиссия 5%)"
    )

    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))
    bot.edit_message_text(res_text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    try: bot.send_message(p1_id, res_text, reply_markup=kb)
    except: pass

@bot.callback_query_handler(func=lambda c: c.data.startswith("dice_pvp_cancel_"))
def dice_pvp_cancel(c):
    room_id = c.data.split("_")[-1]
    if room_id in bot_instance.dice_rooms:
        r = bot_instance.dice_rooms[room_id]
        update_balance(r["p1_id"], r["bet"])
        del bot_instance.dice_rooms[room_id]
        bot.answer_callback_query(c.id, "Комната успешно удалена, средства возвращены.")
    dice_pvp_menu(c)


def start_dice_direct(chat_id: int, user_id: int, btype: str, num: int | None, bet: int):
    """Прямой запуск костей из текстовой команды, например 'кости больше 1кк', 'кости ровно 7 50к', 'кости точное 12 100000'."""
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

    d1, d2 = random.randint(1, 6), random.randint(1, 6)
    res = d1 + d2

    win = 0
    mult = 1.9
    if btype == "high" and res > 7: win = int(bet * mult)
    elif btype == "low" and res < 7: win = int(bet * mult)
    elif btype == "seven" and res == 7: win = int(bet * 5.0)
    elif btype.startswith("num") and res == int(btype.replace("num", "")): win = int(bet * 36.0)

    profit = win - bet
    new_balance = update_balance(user_id, win)

    kb = types.InlineKeyboardMarkup(row_width=2)
    if num is not None:
        repeat_cb = f"play_dice_num{num}_{bet}"
    else:
        repeat_cb = f"play_dice_{btype}_{bet}"
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=repeat_cb),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    type_display = {
        "high": "Больше 7", "low": "Меньше 7", "seven": "Ровно 7",
        "num": f"Точное {num}"
    }.get(btype, btype)

    bot.send_message(
        chat_id,
        f"🎲 <b>КОСТИ</b>\n\n"
        f"Бросок... 🎲 <b>{d1}</b> и 🎲 <b>{d2}</b>\n"
        f"Сумма: <b>{res}</b>\n\n"
        f"Ваша ставка: {type_display}\n"
        f"{'✅ Выигрыш!' if win > 0 else '❌ Проигрыш'}\n\n"
        f"Ставка: {fmt(bet)} {CURRENCY}\n"
        f"{'✅ +' if profit >= 0 else '❌ '}{fmt(abs(profit))} {CURRENCY}\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
        reply_markup=kb
    )
