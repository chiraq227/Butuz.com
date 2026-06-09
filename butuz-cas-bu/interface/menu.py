from datetime import datetime
from telebot import types
from config import CURRENCY, DAILY_BONUS, CHANNEL_ID, REFERRAL_BONUS, RATING_PRICE, RATING_ICON, BOT_USERNAME
from bot_instance import bot
from core.database import get_user, save_user, load_db
from core.utils import fmt, send_section_from_text, get_display_name
from game_logic.levels import level_info, vip_badge

def main_menu_keyboard() -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🎰 СЛОТЫ", callback_data="game_slots"),
        types.InlineKeyboardButton("💣 МИНЫ", callback_data="game_mines"),
    )
    kb.add(
        types.InlineKeyboardButton("🃏 БЛЭКДЖЕК", callback_data="game_blackjack"),
        types.InlineKeyboardButton("🎲 КОСТИ", callback_data="game_dice"),
    )
    kb.add(
        types.InlineKeyboardButton("🎡 РУЛЕТКА", callback_data="game_roulette"),
    )
    kb.add(
        types.InlineKeyboardButton("🪙 МОНЕТКА", callback_data="game_coin"),
    )
    kb.add(
        types.InlineKeyboardButton("👤 ПРОФИЛЬ", callback_data="profile"),
        types.InlineKeyboardButton("🏆 ТОП ИГРОКОВ", callback_data="leaderboard"),
    )
    kb.add(
        types.InlineKeyboardButton("🎁 БОНУС", callback_data="bonus_menu"),
        types.InlineKeyboardButton("⛏️ ФЕРМА", callback_data="mine_farm"),
    )
    kb.add(
        types.InlineKeyboardButton("🏦 БАНК", callback_data="bank_menu"),
        types.InlineKeyboardButton("💸 ПЕРЕВОДЫ", callback_data="transfer_menu"),
    )
    kb.add(types.InlineKeyboardButton("🏢 БИЗНЕСЫ", callback_data="business_menu"))
    kb.add(
        types.InlineKeyboardButton("🛒 МАГАЗИН / VIP", callback_data="shop"),
        types.InlineKeyboardButton("ℹ️ ПОМОЩЬ", callback_data="help"),
    )
    kb.add(types.InlineKeyboardButton("🏷 НИКНЕЙМЫ", callback_data="nickname_menu"))
    # Новые кнопки разделов (для удобного доступа к каталогам команд)
    kb.add(
        types.InlineKeyboardButton("📋 КОМАНДЫ", callback_data="show_commands"),
        types.InlineKeyboardButton("🎰 ИГРЫ", callback_data="show_games"),
    )
    return kb

def main_menu_text() -> str:
    return (
        "╔═════════════════════════════╗\n"
        "      🎰 <b>BUTUZ GAME CASINO</b> 🎰\n"
        "╚═════════════════════════════╝\n\n"
        "Добро пожаловать в лучшее экономическое казино!\n"
        "Играйте, зарабатывайте XP, повышайте уровень, стройте бизнес и фермы!\n\n"
        "👇 <b>ВЫБЕРИТЕ РАЗДЕЛ ДЛЯ ИГРЫ:</b>"
    )


# === Хелперы для отправки меню по тексту (централизованно) ===
def send_main_menu(chat_id: int):
    bot.send_message(chat_id, main_menu_text(), reply_markup=main_menu_keyboard())


def send_profile(chat_id: int, user_id: int):
    user = get_user(user_id)

    db = load_db()
    # Filter meta keys (nickname_registry etc.)
    user_items = [(k, v) for k, v in db.items() 
                  if isinstance(v, dict) and ("balance" in v or "game_id" in v)]
    sorted_users = sorted(user_items, key=lambda x: x[1].get("rating", 0), reverse=True)
    rank = 9999
    for idx, (uid, _) in enumerate(sorted_users):
        try:
            if int(uid) == user_id:
                rank = idx + 1
                break
        except (ValueError, TypeError):
            continue

    marriage_line = ""
    if user.get("married_to"):
        partner = get_user(user["married_to"])
        marriage_line = f"💍 Брак: <b>{partner.get('username', 'Игрок')}</b>\n"

    from game_logic.mining import mining_get_accumulated, fmt_btc
    total_btc = mining_get_accumulated(user)

    display = get_display_name(user, user_id)
    text = (
        f"👤 <b>ЛИЧНЫЙ ПРОФИЛЬ</b>\n\n"
        f"🆔 Игровой ID: <code>{user.get('game_id')}</code>\n"
        f"🏷 Никнейм: <b>{display}</b>\n"
        f"🏆 Статус: <b>{vip_badge(user)}</b>\n"
        f"📊 Место в топе: <b>#{rank}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>\n"
        f"🏦 В банке: <b>{fmt(user.get('bank_balance', 0))} {CURRENCY}</b>\n"
        f"₿ В ферме: <b>{fmt_btc(total_btc)} BTC</b>\n"
        f"👑 Рейтинг: <b>{fmt(user.get('rating', 0))} {RATING_ICON}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"⭐ {level_info(user)}\n"
        f"🎮 Сыграно игр: <b>{user['games_played']}</b>\n"
        f"📈 Выиграно: <b>{fmt(user['total_won'])} {CURRENCY}</b>\n"
        f"📉 Проиграно: <b>{fmt(user['total_lost'])} {CURRENCY}</b>\n"
        f"{marriage_line}"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"📅 Регистрация: {datetime.fromisoformat(user['joined']).strftime('%d.%m.%Y')}"
    )

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🏆 Ачивки", callback_data="achievements"),
        types.InlineKeyboardButton("💍 ЗАГС / Брак", callback_data="marriage_menu"),
    )
    kb.add(
        types.InlineKeyboardButton("🏷 Мои никнеймы", callback_data="nickname_menu"),
        types.InlineKeyboardButton("◀️ Главное меню", callback_data="main_menu"),
    )
    bot.send_message(chat_id, text, reply_markup=kb)

@bot.message_handler(commands=["start"])
def start_handler(message):
    user_id = message.from_user.id
    user = get_user(user_id)

    if user.get("banned"):
        bot.reply_to(message, "❌ Вы забанены администрацией.")
        return

    # Обновление юзернейма
    if message.from_user.username:
        user["username"] = f"@{message.from_user.username}"
    else:
        user["username"] = message.from_user.first_name or "Игрок"
    save_user(user_id, user)

    # Реферальная система
    parts = message.text.split()
    if len(parts) > 1 and parts[1].startswith("ref"):
        try:
            inviter_id = int(parts[1].replace("ref", ""))
            if inviter_id != user_id and not user.get("referral_by"):
                inviter = get_user(inviter_id)
                user["referral_by"] = inviter_id
                user["balance"] += REFERRAL_BONUS // 2

                if user_id not in inviter.get("referrals", []):
                    if "referrals" not in inviter: inviter["referrals"] = []
                    inviter["referrals"].append(user_id)
                    inviter["balance"] += REFERRAL_BONUS
                    save_user(inviter_id, inviter)
                    try:
                        bot.send_message(
                            inviter_id, f"👥 <b>Новый реферал!</b>\n\n"
                            f"По вашей ссылке зарегистировался {user['username']}.\n"
                            f"Вам начислено: <b>+{fmt(REFERRAL_BONUS)} {CURRENCY}</b>"
                        )
                    except: pass

                save_user(user_id, user)
                bot.send_message(
                    user_id, f"🎉 <b>Вы зашли по реферальной ссылке!</b>\n"
                    f"Вам начислен приветственный бонус: <b>{fmt(REFERRAL_BONUS // 2)} {CURRENCY}</b>"
                )
        except Exception: pass

    bot.send_message(message.chat.id, main_menu_text(), reply_markup=main_menu_keyboard())

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().lower() in ["меню", "menu", "назад", "back"])
def menu_handler(message):
    if get_user(message.from_user.id).get("banned"): return
    bot.send_message(message.chat.id, main_menu_text(), reply_markup=main_menu_keyboard())

@bot.message_handler(commands=["balance", "bal", "баланс"])
def balance_command(message):
    user = get_user(message.from_user.id)
    if user.get("banned"): return
    bot.reply_to(message, f"💎 <b>Ваш баланс:</b> {fmt(user['balance'])} {CURRENCY}")


@bot.callback_query_handler(func=lambda c: c.data == "profile")
def profile_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)

    # Подсчёт места в топе
    db = load_db()
    # Filter meta keys (nickname_registry etc.)
    user_items = [(k, v) for k, v in db.items() 
                  if isinstance(v, dict) and ("balance" in v or "game_id" in v)]
    sorted_users = sorted(user_items, key=lambda x: x[1].get("rating", 0), reverse=True)
    rank = 9999
    for idx, (uid, _) in enumerate(sorted_users):
        try:
            if int(uid) == user_id:
                rank = idx + 1
                break
        except (ValueError, TypeError):
            continue

    marriage_line = ""
    if user.get("married_to"):
        partner = get_user(user["married_to"])
        marriage_line = f"💍 Брак: <b>{partner.get('username', 'Игрок')}</b>\n"

    from game_logic.mining import mining_get_accumulated, fmt_btc
    total_btc = mining_get_accumulated(user)

    display = get_display_name(user, user_id)
    text = (
        f"👤 <b>ЛИЧНЫЙ ПРОФИЛЬ</b>\n\n"
        f"🆔 Игровой ID: <code>{user.get('game_id')}</code>\n"
        f"🏷 Никнейм: <b>{display}</b>\n"
        f"🏆 Статус: <b>{vip_badge(user)}</b>\n"
        f"📊 Место в топе: <b>#{rank}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>\n"
        f"🏦 В банке: <b>{fmt(user.get('bank_balance', 0))} {CURRENCY}</b>\n"
        f"₿ В ферме: <b>{fmt_btc(total_btc)} BTC</b>\n"
        f"👑 Рейтинг: <b>{fmt(user.get('rating', 0))} {RATING_ICON}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"⭐ {level_info(user)}\n"
        f"🎮 Сыграно игр: <b>{user['games_played']}</b>\n"
        f"📈 Выиграно: <b>{fmt(user['total_won'])} {CURRENCY}</b>\n"
        f"📉 Проиграно: <b>{fmt(user['total_lost'])} {CURRENCY}</b>\n"
        f"{marriage_line}"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"📅 Регистрация: {datetime.fromisoformat(user['joined']).strftime('%d.%m.%Y')}"
    )

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🏆 Ачивки", callback_data="achievements"),
        types.InlineKeyboardButton("💍 ЗАГС / Брак", callback_data="marriage_menu"),
    )
    kb.add(
        types.InlineKeyboardButton("🏷 Мои никнеймы", callback_data="nickname_menu"),
        types.InlineKeyboardButton("◀️ Главное меню", callback_data="main_menu"),
    )
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "achievements")
def achievements_handler(c):
    user = get_user(c.from_user.id)
    ach = user.get("achievements", [])
    all_ach = {
        "first_win": "🏆 Первая победа! — Выиграть первую игру",
        "rich": "💰 Богач — Набрать баланс 10 000 кристаллов",
        "veteran": "⚔️ Ветеран — Сыграть более 100 игр",
        "whale": "🐋 Кит — Суммарный выигрыш более 100 000",
        "lucky": "🍀 Везунчик — Достигнуть 5 уровня",
    }
    text = "🏆 <b>ВАШИ ДОСТИЖЕНИЯ:</b>\n\n"
    for key, desc in all_ach.items():
        status = "✅" if key in ach else "❌"
        text += f"{status} {desc}\n\n"
    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("◀️ В профиль", callback_data="profile"))
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "bonus_menu")
def daily_bonus_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    send_section_from_text(bot, c.message.chat.id, "", "daily_bonus", user_id, user)

@bot.callback_query_handler(func=lambda c: c.data == "referral")
def referral_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    send_section_from_text(bot, c.message.chat.id, "", "referral", user_id, user)

@bot.callback_query_handler(func=lambda c: c.data == "leaderboard")
def leaderboard_handler(c):
    db = load_db()
    # Filter meta keys (nickname_registry etc.)
    user_items = [(k, v) for k, v in db.items() 
                  if isinstance(v, dict) and ("balance" in v or "game_id" in v)]
    top = sorted(user_items, key=lambda x: x[1].get("rating", 0), reverse=True)[:10]
    medals = ["🥇", "🥈", "🥉"] + ["4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "10️⃣"]
    lines = []
    for i, (uid, d) in enumerate(top):
        try:
            uid_int = int(uid)
        except (ValueError, TypeError):
            continue
        # Используем никнеймы если есть (с восстановлением)
        display = get_display_name(d, uid_int)
        rating = d.get("rating", 0)
        balance = d.get("balance", 0)
        vip_str = "👑 " if d.get("vip") else ""
        rating_part = f"  👑 {fmt(rating)}" if rating > 0 else ""
        lines.append(f"{medals[i]} {vip_str}<b>{display}</b>{rating_part}\n    💎 {fmt(balance)} {CURRENCY}")
    text = "🏆 <b>Топ 10 игроков</b>\n<i>(сортировка по рейтингу 👑)</i>\n\n" + "\n\n".join(lines)
    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "shop")
def shop_handler(c):
    user = get_user(c.from_user.id)
    current_rating = user.get("rating", 0)
    sell_price = int(RATING_PRICE * 0.6)
    max_can_buy = user["balance"] // RATING_PRICE if RATING_PRICE > 0 else 0

    text = (
        f"🛒 <b>ДОНАТ МАГАЗИН</b>\n\n"
        f"👑 <b>Рейтинг</b>\n"
        f"У вас: <b>{current_rating}</b> {RATING_ICON}\n"
        f"Цена покупки 1: <b>{fmt(RATING_PRICE)} {CURRENCY}</b>\n"
        f"Цена продажи 1: <b>{fmt(sell_price)} {CURRENCY}</b> (60%)\n"
        f"Можно купить сейчас: до <b>{max_can_buy}</b> шт.\n\n"
        f"Повышает место в топе игроков!\n\n"
        f"🌟 <b>Купить статус VIP (Навсегда)</b>\n"
        f"Цена: <b>250 000 000 000 {CURRENCY}</b>\n"
        f"Преимущества VIP:\n"
        f"• Ежедневный бонус <b>x1.5</b>\n"
        f"• Увеличенные лимиты переводов\n"
        f"• Уникальный бейдж 👑 VIP в профиле\n\n"
        f"💰 Ваш баланс: {fmt(user['balance'])} {CURRENCY}"
    )
    kb = types.InlineKeyboardMarkup(row_width=1)
    kb.add(
        types.InlineKeyboardButton("👑 Купить Рейтинг (выбрать кол-во)", callback_data="rating_buy_menu"),
        types.InlineKeyboardButton("💰 Продать Рейтинг (выбрать кол-во)", callback_data="rating_sell_menu"),
        types.InlineKeyboardButton(f"🌟 Купить VIP (250 млрд {CURRENCY})", callback_data="buy_vip"),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "rating_buy_menu")
def rating_buy_menu(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    balance = user["balance"]
    max_buy = balance // RATING_PRICE if RATING_PRICE > 0 else 0
    current = user.get("rating", 0)

    text = (
        f"👑 <b>Покупка рейтинга</b>\n\n"
        f"Цена за 1: <b>{fmt(RATING_PRICE)} {CURRENCY}</b>\n"
        f"У вас сейчас: <b>{current}</b> {RATING_ICON}\n"
        f"Ваш баланс: <b>{fmt(balance)} {CURRENCY}</b>\n"
        f"Максимум можно купить: <b>{max_buy}</b>\n\n"
        f"Выберите количество или введите своё:"
    )
    kb = types.InlineKeyboardMarkup(row_width=3)
    quick = [1, 5, 10, 25, 50]
    for q in quick:
        if q <= max_buy:
            kb.add(types.InlineKeyboardButton(f"+{q}", callback_data=f"rating_buy_{q}"))
    kb.add(types.InlineKeyboardButton("✏️ Своя сумма", callback_data="rating_buy_custom"))
    if max_buy > 0:
        kb.add(types.InlineKeyboardButton(f"💰 Весь баланс (x{max_buy})", callback_data=f"rating_buy_{max_buy}"))
    kb.add(types.InlineKeyboardButton("◀️ Назад в магазин", callback_data="shop"))
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "rating_sell_menu")
def rating_sell_menu(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    current = user.get("rating", 0)
    sell_price = int(RATING_PRICE * 0.6)

    text = (
        f"💰 <b>Продажа рейтинга</b>\n\n"
        f"Цена продажи за 1: <b>{fmt(sell_price)} {CURRENCY}</b> (60% от покупки)\n"
        f"У вас сейчас: <b>{current}</b> {RATING_ICON}\n"
        f"При продаже рейтинг уменьшится.\n\n"
        f"Выберите количество для продажи:"
    )
    kb = types.InlineKeyboardMarkup(row_width=3)
    quick = [1, 5, 10]
    for q in quick:
        if q <= current:
            kb.add(types.InlineKeyboardButton(f"-{q}", callback_data=f"rating_sell_{q}"))
    if current > 0:
        kb.add(types.InlineKeyboardButton(f"Продать всё (x{current})", callback_data=f"rating_sell_{current}"))
    kb.add(types.InlineKeyboardButton("✏️ Своя сумма", callback_data="rating_sell_custom"))
    kb.add(types.InlineKeyboardButton("◀️ Назад в магазин", callback_data="shop"))
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data.startswith("rating_buy_"))
def rating_buy_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    data = c.data

    if data == "rating_buy_custom":
        bot_instance.pending_rating_buy[user_id] = {
            "chat_id": c.message.chat.id,
            "message_id": c.message.message_id
        }
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="rating_buy_menu"))
        bot.edit_message_text(
            f"✏️ Введите количество рейтинга для покупки (поддерживаются 1к, 5 и т.д.):\n"
            f"Максимум по балансу: {user['balance'] // RATING_PRICE}",
            c.message.chat.id, c.message.message_id, reply_markup=kb
        )
        return

    try:
        amount = int(data.split("_")[-1])
    except:
        bot.answer_callback_query(c.id, "Ошибка", show_alert=True)
        return

    if amount <= 0:
        bot.answer_callback_query(c.id, "Неверное количество", show_alert=True)
        return

    cost = amount * RATING_PRICE
    if user["balance"] < cost:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        rating_buy_menu(c)
        return

    user["balance"] -= cost
    user["rating"] = user.get("rating", 0) + amount
    save_user(user_id, user)
    bot.answer_callback_query(c.id, f"🎉 Куплено {amount} рейтинга!")
    shop_handler(c)

@bot.callback_query_handler(func=lambda c: c.data.startswith("rating_sell_"))
def rating_sell_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    data = c.data
    sell_price = int(RATING_PRICE * 0.6)

    if data == "rating_sell_custom":
        bot_instance.pending_rating_sell[user_id] = {
            "chat_id": c.message.chat.id,
            "message_id": c.message.message_id
        }
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="rating_sell_menu"))
        bot.edit_message_text(
            f"✏️ Введите количество рейтинга для продажи:\n"
            f"У вас: {user.get('rating', 0)}",
            c.message.chat.id, c.message.message_id, reply_markup=kb
        )
        return

    try:
        amount = int(data.split("_")[-1])
    except:
        bot.answer_callback_query(c.id, "Ошибка", show_alert=True)
        return

    current = user.get("rating", 0)
    if amount <= 0 or amount > current:
        bot.answer_callback_query(c.id, "Неверное количество или не хватает рейтинга", show_alert=True)
        rating_sell_menu(c)
        return

    revenue = amount * sell_price
    user["rating"] = current - amount
    user["balance"] += revenue
    save_user(user_id, user)
    bot.answer_callback_query(c.id, f"✅ Продано {amount} рейтинга за {fmt(revenue)} {CURRENCY}")
    shop_handler(c)

@bot.callback_query_handler(func=lambda c: c.data == "buy_vip")
def buy_vip_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    price = 250_000_000_000
    if user.get("vip"):
        bot.answer_callback_query(c.id, "✨ У вас уже есть VIP статус!", show_alert=True)
        return
    if user["balance"] < price:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return
    user["balance"] -= price
    user["vip"] = True
    save_user(user_id, user)
    bot.answer_callback_query(c.id, "👑 Поздравляем! Вы приобрели статус VIP навсегда!")
    shop_handler(c)

@bot.callback_query_handler(func=lambda c: c.data == "help")
def help_handler(c):
    # Перенаправляем на мощный каталог команд
    from commands.text_commands import send_commands_overview
    send_commands_overview(c.message.chat.id)

@bot.callback_query_handler(func=lambda c: c.data == "main_menu")
def cb_main_menu(c):
    try: bot.edit_message_text(main_menu_text(), c.message.chat.id, c.message.message_id, reply_markup=main_menu_keyboard())
    except: pass


# === Новые колбэки для кнопок разделов из главного меню ===
@bot.callback_query_handler(func=lambda c: c.data == "show_commands")
def cb_show_commands_from_menu(c):
    from commands.text_commands import send_commands_overview
    send_commands_overview(c.message.chat.id)


@bot.callback_query_handler(func=lambda c: c.data == "show_games")
def cb_show_games_from_menu(c):
    from commands.text_commands import send_games_section
    send_games_section(c.message.chat.id)


@bot.callback_query_handler(func=lambda c: c.data == "show_economy")
def cb_show_economy_from_menu(c):
    from commands.text_commands import send_economy_section
    send_economy_section(c.message.chat.id, c.from_user.id)


@bot.callback_query_handler(func=lambda c: c.data == "show_social")
def cb_show_social_from_menu(c):
    from commands.text_commands import send_social_section
    send_social_section(c.message.chat.id)
