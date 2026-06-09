import bot_instance
import bot_instance
from config import FARM_LEVELS, CURRENCY, MIN_BET, TRANSFER_MIN, RATING_PRICE
from core.database import get_user, save_user
from core.utils import fmt, parse_sell_amount, parse_amount, make_fake_callback, get_display_name
from telebot import types as _types

def sell_command_handler(message):
    user_id = message.from_user.id
    user = get_user(user_id)

    if user.get("banned"): return

    m = user.get("mining", {})
    level = m.get("farm_level", 0)
    extra_farms = m.get("extra_farms", 0)

    if level != 10 or extra_farms <= 0:
        bot_instance.bot.reply_to(message, "❌ У вас нет дополнительных ферм для продажи! (Продать можно только лишние Бутуз-центры)")
        return

    text_parts = message.text.split()
    if len(text_parts) < 3:
        bot_instance.bot.reply_to(message, "💡 Напишите: <code>продать фермы [количество]</code> или <code>продать фермы все</code>")
        return

    amount_to_sell = parse_sell_amount(text_parts[2], extra_farms)

    if amount_to_sell <= 0:
        bot_instance.bot.reply_to(message, "❌ Неверное количество для продажи!")
        return

    if amount_to_sell > extra_farms:
        bot_instance.bot.reply_to(message, f"❌ У вас нет столько доп. ферм! Доступно для продажи: {extra_farms} шт.")
        return

    farm = FARM_LEVELS[10]
    sell_price_per_farm = int(farm["price"] * 0.70)
    total_sell = sell_price_per_farm * amount_to_sell

    from game_logic.mining import mining_get_accumulated
    accumulated = mining_get_accumulated(user)
    user["mining"]["btc_accumulated"] = accumulated
    from datetime import datetime
    user["mining"]["last_collected"] = datetime.now().isoformat()

    user["mining"]["extra_farms"] = extra_farms - amount_to_sell
    user["balance"] += total_sell
    save_user(user_id, user)

    total_farms_after = 1 + user["mining"]["extra_farms"]

    from telebot import types
    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("⛏️ К ферме", callback_data="mine_farm"))

    bot_instance.bot.reply_to(
        message,
        f"🏭 <b>Фермы проданы!</b>\n\n"
        f"🏭 Продано: <b>{amount_to_sell}</b> ферм\n"
        f"💰 Цена за 1: <b>{fmt(sell_price_per_farm)} {CURRENCY}</b>\n"
        f"  (стандарт {fmt(farm['price'])}, -30%)\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 Получено: <b>+{fmt(total_sell)} {CURRENCY}</b>\n"
        f"🏭 Осталось ферм: <b>{total_farms_after}</b>\n"
        f"💰 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>",
        reply_markup=kb
    )

def _handle_bank_command(message, user, user_id):
    """Обработка прямых команд банка: банк положить XXX, положить XXX, снять XXX и т.д."""
    txt = (message.text or "").strip().lower()
    parts = txt.split()
    if not parts:
        return False
    cmd = parts[0]

    if cmd in ["банк", "bank"]:
        from economy.bank import bank_menu_text, bank_menu_kb, bank_menu_handler
        if len(parts) == 1:
            bot_instance.bot.send_message(message.chat.id, bank_menu_text(user_id), reply_markup=bank_menu_kb())
            return True

        action = parts[1]
        amt_str = parts[2] if len(parts) > 2 else None

        amount = None
        if amt_str:
            amount = parse_amount(amt_str)
        elif action in ["все", "всё", "all", "100", "полностью"]:
            amount = user["balance"]
        elif action in ["50", "половина"]:
            amount = user["balance"] // 2

        if action in ["положить", "депозит", "deposit", "внести", "деп"]:
            if amount is None and len(parts) > 2:
                amount = parse_amount(parts[2])
            if amount is None:
                # Открываем экран ввода
                fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                fake_c.data = "bank_deposit"
                from economy.bank import bank_deposit_handler
                bank_deposit_handler(fake_c)
                return True
            # Прямой депозит
            if amount <= 0 or user["balance"] < amount:
                bot_instance.bot.reply_to(message, "❌ Недостаточно средств или неверная сумма.")
                return True
            user["balance"] -= amount
            user["bank_balance"] = user.get("bank_balance", 0) + amount
            save_user(user_id, user)
            bot_instance.bot.reply_to(message, f"✅ Положено в банк: <b>{fmt(amount)} {CURRENCY}</b>\nБаланс: {fmt(user['balance'])} | В банке: {fmt(user.get('bank_balance',0))}")
            return True

        if action in ["снять", "вывести", "withdraw", "забрать"]:
            bb = user.get("bank_balance", 0)
            if amount is None and len(parts) > 2:
                amount = parse_amount(parts[2])
            if amount is None:
                fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                fake_c.data = "bank_withdraw"
                from economy.bank import bank_withdraw_handler
                bank_withdraw_handler(fake_c)
                return True
            if amount <= 0 or bb < amount:
                bot_instance.bot.reply_to(message, "❌ Недостаточно средств в банке или неверная сумма.")
                return True
            user["balance"] += amount
            user["bank_balance"] = bb - amount
            save_user(user_id, user)
            bot_instance.bot.reply_to(message, f"✅ Снято из банка: <b>{fmt(amount)} {CURRENCY}</b>\nБаланс: {fmt(user['balance'])} | В банке: {fmt(user.get('bank_balance',0))}")
            return True

        # Просто "банк 50" или "банк все" — считаем депозитом
        if action in ["50", "все", "всё", "100"]:
            amount = user["balance"] if action in ["все", "всё", "100"] else user["balance"] // 2
            if amount > 0:
                user["balance"] -= amount
                user["bank_balance"] = user.get("bank_balance", 0) + amount
                save_user(user_id, user)
                bot_instance.bot.reply_to(message, f"✅ Положено в банк: <b>{fmt(amount)} {CURRENCY}</b>")
            return True

        # fallback — меню
        bot_instance.bot.send_message(message.chat.id, bank_menu_text(user_id), reply_markup=bank_menu_kb())
        return True

    # Короткие команды для банка (без слова "банк")
    if cmd in ["положить", "депозит"]:
        amount = parse_amount(parts[1]) if len(parts) > 1 else None
        if amount is None:
            amount = user["balance"] if (len(parts) > 1 and parts[1] in ["все", "всё"]) else None
        if amount and amount > 0 and user["balance"] >= amount:
            user["balance"] -= amount
            user["bank_balance"] = user.get("bank_balance", 0) + amount
            save_user(user_id, user)
            bot_instance.bot.reply_to(message, f"✅ Положено в банк: <b>{fmt(amount)} {CURRENCY}</b>")
        else:
            bot_instance.bot.reply_to(message, "Использование: <code>положить 100к</code> или <code>положить все</code>")
        return True

    if cmd in ["снять"]:
        bb = user.get("bank_balance", 0)
        amount = parse_amount(parts[1]) if len(parts) > 1 else None
        if amount is None and len(parts) > 1 and parts[1] in ["все", "всё"]:
            amount = bb
        if amount and amount > 0 and bb >= amount:
            user["balance"] += amount
            user["bank_balance"] = bb - amount
            save_user(user_id, user)
            bot_instance.bot.reply_to(message, f"✅ Снято из банка: <b>{fmt(amount)} {CURRENCY}</b>")
        else:
            bot_instance.bot.reply_to(message, "Использование: <code>снять 50к</code> или <code>снять все</code>")
        return True

    return False


def text_command_handler(message):
    user_id = message.from_user.id
    user = get_user(user_id)

    if user.get("banned"): return

    txt = (message.text or "").strip().lower()
    parts = txt.split()
    cmd = parts[0] if parts else ""

    # Банк-команды имеют приоритет и работают даже если активен режим "Своя ставка"
    if cmd in ["банк", "bank", "положить", "депозит", "снять"]:
        if user_id in bot_instance.pending_bet_input:
            del bot_instance.pending_bet_input[user_id]
        if user_id in bot_instance.pending_rating_buy:
            del bot_instance.pending_rating_buy[user_id]
        if user_id in bot_instance.pending_rating_sell:
            del bot_instance.pending_rating_sell[user_id]
        if _handle_bank_command(message, user, user_id):
            return

    # Проверка глобальных стейтов
    if user_id in bot_instance.pending_bet_input:
        from interface.betting import handle_custom_bet_input
        handle_custom_bet_input(message)
        return

    if user_id in bot_instance.pending_proposals:
        from social.marriage import handle_proposal_input
        handle_proposal_input(message)
        return

    if user_id in bot_instance.pending_farm_input:
        amount = parse_amount(message.text)
        if amount is None or amount <= 0:
            bot_instance.bot.reply_to(message, "❌ Введите корректное положительное число (поддерживаются 10, 50, 1к и т.п.)!")
            return
        del bot_instance.pending_farm_input[user_id]
        # Надёжный фейк вместо прямого types.CallbackQuery (избегаем ошибки конструктора)
        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
        fake_c.data = f"mine_buy_extra_confirm_{amount}"
        from game_logic.mining import mine_buy_extra_confirm
        mine_buy_extra_confirm(fake_c)
        return

    # === Рейтинг: покупка (своя сумма) ===
    if user_id in bot_instance.pending_rating_buy:
        txt_lower = (message.text or "").strip().lower()
        if txt_lower in ["отмена", "cancel", "назад", "меню", "отменить"]:
            del bot_instance.pending_rating_buy[user_id]
            from interface.menu import shop_handler
            fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
            fake_c.data = "shop"
            shop_handler(fake_c)
            return
        amt = parse_amount(message.text)
        if amt is None or amt <= 0:
            bot_instance.bot.reply_to(message, "❌ Введите корректное положительное число рейтинга (или 'отмена')!")
            return
        del bot_instance.pending_rating_buy[user_id]
        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
        fake_c.data = f"rating_buy_{amt}"
        from interface.menu import rating_buy_handler
        rating_buy_handler(fake_c)
        return

    # === Рейтинг: продажа (своя сумма) ===
    if user_id in bot_instance.pending_rating_sell:
        txt_lower = (message.text or "").strip().lower()
        if txt_lower in ["отмена", "cancel", "назад", "меню", "отменить"]:
            del bot_instance.pending_rating_sell[user_id]
            from interface.menu import shop_handler
            fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
            fake_c.data = "shop"
            shop_handler(fake_c)
            return
        amt = parse_amount(message.text)
        if amt is None or amt <= 0:
            bot_instance.bot.reply_to(message, "❌ Введите корректное положительное число рейтинга для продажи (или 'отмена')!")
            return
        del bot_instance.pending_rating_sell[user_id]
        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
        fake_c.data = f"rating_sell_{amt}"
        from interface.menu import rating_sell_handler
        rating_sell_handler(fake_c)
        return

    # === Никнеймы: создание ===
    if user_id in bot_instance.pending_nickname_create:
        from economy.nicknames import handle_nickname_create_input
        if handle_nickname_create_input(message):
            return

    # === Никнеймы: ввод цены продажи ===
    if user_id in bot_instance.pending_nickname_sell:
        from economy.nicknames import handle_nickname_sell_price_input
        if handle_nickname_sell_price_input(message):
            return

    if user_id in bot_instance.pending_transfer:
        state = bot_instance.pending_transfer[user_id]
        if state["step"] == "target":
            target_str = message.text.strip()
            from users.admin import admin_resolve_user
            t_id, t_data = admin_resolve_user(target_str)
            kb_cancel = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("❌ Отмена", callback_data="transfer_menu"))
            if not t_id:
                bot_instance.bot.send_message(message.chat.id, "❌ Получатель не найден! Попробуйте снова или нажмите отмену:", reply_markup=kb_cancel)
                return
            if t_id == user_id:
                bot_instance.bot.send_message(message.chat.id, "❌ Нельзя переводить кристаллы самому себе!", reply_markup=kb_cancel)
                return
            state["step"] = "amount"
            state["target_id"] = t_id
            bot_instance.pending_transfer[user_id] = state
            display_target = get_display_name(t_data)
            bot_instance.bot.send_message(message.chat.id, f"👤 Получатель: <b>{display_target}</b>\n\nВведите сумму кристаллов для перевода (поддерживаются 1к, 1кк и т.д.):", reply_markup=kb_cancel)
        elif state["step"] == "amount":
            amount = parse_amount(message.text)
            from config import TRANSFER_MIN
            if amount is None or amount < TRANSFER_MIN:
                bot_instance.bot.reply_to(message, f"❌ Введите корректное число кристаллов (минимум {TRANSFER_MIN}).\nМожно: 100к, 1кк, 500к и т.д.!")
                return
            from economy.transfers import get_transfer_limits
            max_amount, _ = get_transfer_limits(user)
            if amount > max_amount:
                bot_instance.bot.reply_to(message, f"❌ Максимальная сумма одного перевода для вас: {fmt(max_amount)} {CURRENCY}!")
                return
            if user["balance"] < amount:
                bot_instance.bot.reply_to(message, f"❌ Недостаточно кристаллов на балансе! У вас есть: {fmt(user['balance'])} {CURRENCY}")
                return
            target_id = state["target_id"]
            del bot_instance.pending_transfer[user_id]
            # Удаляем сообщение с введённой суммой (как для ставок), чтобы не засорять чат
            try:
                bot_instance.bot.delete_message(message.chat.id, message.message_id)
            except Exception:
                pass
            from telebot import types
            kb = types.InlineKeyboardMarkup(row_width=2)
            kb.add(
                types.InlineKeyboardButton("✅ Подтверждаю", callback_data=f"transfer_confirm_{target_id}_{amount}"),
                types.InlineKeyboardButton("❌ Отмена", callback_data="transfer_menu")
            )
            target_data = get_user(target_id)
            display_target = get_display_name(target_data)
            bot_instance.bot.send_message(
                message.chat.id,
                f"❓ <b>ПОДТВЕРЖДЕНИЕ ПЕРЕВОДА</b>\n\n"
                f"Вы уверены, что хотите перевести:\n"
                f"👤 Кому: <b>{display_target}</b> (ID: {target_data.get('game_id')})\n"
                f"💎 Сумма: <b>{fmt(amount)} {CURRENCY}</b>\n\n"
                f"Нажмите кнопку для подтверждения:",
                reply_markup=kb
            )
        return

    # === ЕДИНСТВЕННЫЙ ЦЕНТРАЛЬНЫЙ РОУТЕР ТЕКСТОВЫХ КОМАНД ===
    # Здесь обрабатываем ВСЕ навигационные слова. Только если ничего не подошло — "не понял".
    # Это устраняет "раз через раз" (когда несколько обработчиков срабатывали одновременно).
    txt = (message.text or "").strip().lower()

    # Навигация
    if txt in ["меню", "menu", "назад", "back", "главное меню"]:
        from interface.menu import send_main_menu
        send_main_menu(message.chat.id)
        return

    if txt in ["профиль", "я", "проф", "profile", "me"]:
        from interface.menu import send_profile
        send_profile(message.chat.id, user_id)
        return

    if txt in ["баланс", "бал", "balance", "bal"]:
        bank_bal = user.get("bank_balance", 0)
        main_bal = user["balance"]
        total = main_bal + bank_bal
        from telebot import types as _types
        kb = _types.InlineKeyboardMarkup(row_width=1)
        kb.add(_types.InlineKeyboardButton("🏦 Открыть банк", callback_data="bank_menu"))
        bot_instance.bot.send_message(
            message.chat.id,
            f"💎 <b>Ваш баланс</b>\n\n"
            f"На руках: <b>{fmt(main_bal)} {CURRENCY}</b>\n"
            f"В банке: <b>{fmt(bank_bal)} {CURRENCY}</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"<b>Всего:</b> {fmt(total)} {CURRENCY}",
            reply_markup=kb
        )
        return

    if txt in ["ферма", "farm", "майнинг", "добыча", "фермы"]:
        from game_logic.mining import mining_menu_text, mining_menu_kb
        bot_instance.bot.send_message(
            message.chat.id,
            mining_menu_text(user_id),
            reply_markup=mining_menu_kb(user_id)
        )
        return

    if txt in ["топ", "лидеры", "leaderboard", "top", "рейтинг"]:
        from core.database import load_db
        from core.utils import fmt as _fmt
        db = load_db()
        # Filter out meta keys like "nickname_registry", "nickname_market" etc.
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
            display = get_display_name(d, uid_int)
            rating = d.get("rating", 0)
            balance = d.get("balance", 0)
            vip_str = "👑 " if d.get("vip") else ""
            rating_part = f"  👑 {_fmt(rating)}" if rating > 0 else ""
            lines.append(f"{medals[i]} {vip_str}<b>{display}</b>{rating_part}\n    💎 {_fmt(balance)} {CURRENCY}")
        text = "🏆 <b>Топ 10 игроков</b>\n<i>(сортировка по рейтингу 👑)</i>\n\n" + "\n\n".join(lines)
        from telebot import types as _types
        kb = _types.InlineKeyboardMarkup()
        kb.add(_types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))
        bot_instance.bot.send_message(message.chat.id, text, reply_markup=kb)
        return


    if txt in ["бонус", "bonus", "ежедневный", "daily"]:
        user = get_user(user_id)
        from core.utils import send_section_from_text
        send_section_from_text(bot_instance.bot, message.chat.id, "", "daily_bonus", user_id, user)
        return

    # === РАЗДЕЛ: КОМАНДЫ (полный каталог) ===
    if txt in ["помощь", "help", "инфо", "команды", "?", "commands"]:
        send_commands_overview(message.chat.id)
        return

    # === РАЗДЕЛ: ИГРЫ ===
    if txt in ["игры", "game", "games", "казино"]:
        send_games_section(message.chat.id)
        return

    # === РАЗДЕЛ: ЭКОНОМИКА ===
    if txt in ["экономика", "эко", "economy"]:
        send_economy_section(message.chat.id, user_id)
        return

    # === РАЗДЕЛ: СОЦИАЛ / БРАК ===
    if txt in ["социал", "брак", "загс", "social", "marriage"]:
        send_social_section(message.chat.id)
        return

    # === НИКНЕЙМЫ ===
    if (txt in ["ник", "никнейм", "никнеймы", "nicks", "ник маркет", "маркет ник"] or
            txt.startswith("ник ") or txt.startswith("создать ник ")):
        from economy.nicknames import handle_nickname_text_commands
        if handle_nickname_text_commands(message):
            return

    if txt in ["магазин", "донат", "vip", "shop", "рейтинг"]:
        # Показываем улучшенный магазин с поддержкой мульти-покупки и продажи
        from interface.menu import shop_handler
        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
        fake_c.data = "shop"
        shop_handler(fake_c)
        return

    # === ПРЯМЫЕ ТЕКСТОВЫЕ КОМАНДЫ (с аргументами + поддержка 1к, 1кк и т.д.) ===
    # Разбираем на части один раз
    parts = txt.split()
    cmd = parts[0] if parts else ""

    # --- Игры с прямым запуском по ставке ---
    if cmd in ["слоты", "slots"]:
        if len(parts) > 1:
            bet_str = parts[1]
            if bet_str in ["все", "всё", "all", "вабанк"]:
                bet = user["balance"]
            else:
                bet = parse_amount(bet_str)
            if bet and bet >= MIN_BET:
                bet = min(bet, user["balance"])  # не больше баланса
                from games.slots import start_slots_direct
                start_slots_direct(message.chat.id, user_id, bet)
                return
        # без суммы — открываем меню выбора ставки (с предзаполненной прошлой ставкой)
        from interface.betting import bet_keyboard
        u = get_user(user_id)
        t = (
            "🎰 <b>СЛОТЫ</b>\n"
            "<i>Три одинаковых = ДЖЕКПОТ! Два совпадения = x1.5\n💎=x8, 7️⃣=x15, ⭐=x25, 🔔=x50</i>\n\n"
            f"💰 Баланс: <b>{fmt(u['balance'])}</b> {CURRENCY}\n"
            f"Ставка:"
        )
        last = u.get("last_bet", 0)
        pre_bet = min(last, u["balance"]) if last > 0 else 0
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=bet_keyboard("slots", pre_bet))
        return

    if cmd in ["мины", "mines"]:
        if len(parts) >= 2:
            try:
                mcount = int(parts[1])
                if mcount in (3, 5, 10, 15):
                    bet_str = parts[2] if len(parts) > 2 else None
                    if bet_str and bet_str in ["все", "всё", "all", "вабанк"]:
                        bet = user["balance"]
                    else:
                        bet = parse_amount(bet_str) if bet_str else None
                    if bet and bet >= MIN_BET:
                        bet = min(bet, user["balance"])
                        from games.mines import start_mines_direct
                        start_mines_direct(message.chat.id, user_id, mcount, bet)
                        return
            except ValueError:
                pass
        # без корректных аргументов — меню выбора кол-ва мин (с предзаполненной ставкой)
        from telebot import types as _types
        u = get_user(user_id)
        t = (
            "💣 <b>МИНЫ</b>\n"
            "<i>Открывай клетки — множитель растёт. Попал на мину — проиграл!</i>\n\n"
            f"💰 Баланс: <b>{fmt(u['balance'])}</b> {CURRENCY}"
        )
        kb = _types.InlineKeyboardMarkup(row_width=3)
        kb.add(
            _types.InlineKeyboardButton("💣 3 мины", callback_data="start_mines_3"),
            _types.InlineKeyboardButton("💣 5 мин", callback_data="start_mines_5"),
            _types.InlineKeyboardButton("💣 10 мин", callback_data="start_mines_10"),
        )
        kb.add(_types.InlineKeyboardButton("💣 15 мин", callback_data="start_mines_15"))
        kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        last = u.get("last_bet", 0)
        pre_bet = min(last, u["balance"]) if last > 0 else 0
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=kb)
        return

    if cmd in ["блэкджек", "blackjack", "бж", "bj"]:
        if len(parts) > 1:
            bet_str = parts[1]
            if bet_str in ["все", "всё", "all", "вабанк"]:
                bet = user["balance"]
            else:
                bet = parse_amount(bet_str)
            if bet and bet >= MIN_BET:
                bet = min(bet, user["balance"])
                from games.blackjack import start_blackjack_direct
                start_blackjack_direct(message.chat.id, user_id, bet)
                return
        from interface.betting import bet_keyboard
        u = get_user(user_id)
        t = "🃏 <b>БЛЭКДЖЕК</b>\n<i>Ближе к 21 чем дилер. Натуральный блэкджек = x2.5!</i>\n\n" \
            f"💰 Баланс: <b>{fmt(u['balance'])}</b> {CURRENCY}"
        last = u.get("last_bet", 0)
        pre_bet = min(last, u["balance"]) if last > 0 else 0
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=bet_keyboard("blackjack", pre_bet))
        return

    if cmd in ["кости", "dice", "кубики"]:
        if len(parts) > 2:
            type_word = parts[1].lower()
            bet_str = parts[2]
            btype = None
            num = None
            if type_word in ["больше", "больше7", "high"]:
                btype = "high"
            elif type_word in ["меньше", "меньше7", "low"]:
                btype = "low"
            elif type_word in ["ровно", "seven", "7"]:
                btype = "seven"
            elif type_word in ["точное", "exact", "num"]:
                btype = "num"
                # next word may be the number
                if len(parts) > 3 and parts[2].isdigit():
                    num = int(parts[2])
                    bet_str = parts[3]
                elif parts[2].isdigit():
                    num = int(parts[2])
                    bet_str = None  # wait for bet? but for direct need bet
            if btype:
                if bet_str and bet_str in ["все", "всё", "all", "вабанк"]:
                    bet = user["balance"]
                else:
                    bet = parse_amount(bet_str) if bet_str else None
                if bet and bet >= MIN_BET:
                    bet = min(bet, user["balance"])
                    if btype == "num" and num is None and len(parts) > 2 and parts[2].isdigit():
                        num = int(parts[2])
                    from games.dice import start_dice_direct
                    btype_full = f"num{num}" if num else btype
                    start_dice_direct(message.chat.id, user_id, btype_full, num, bet)
                    return

            # PvP quick: "кости пвп 1кк"
            if any(p in ["пвп", "pvp", "дуэль"] for p in parts[1:]):
                bet_str = parts[-1] if len(parts) > 2 else None
                if bet_str and bet_str in ["все", "всё", "all", "вабанк"]:
                    bet = user["balance"]
                else:
                    bet = parse_amount(bet_str) if bet_str else None
                if bet and bet >= MIN_BET:
                    bet = min(bet, user["balance"])
                    fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                    fake_c.data = f"dice_pvp_create_{bet}"
                    from games.dice import dice_pvp_create
                    dice_pvp_create(fake_c)
                    return

        # bare or incomplete - open menu
        from telebot import types as _types
        u = get_user(user_id)
        t = "🎲 <b>КОСТИ</b>\nВыбери тип ставки:"
        kb = _types.InlineKeyboardMarkup(row_width=2)
        kb.add(
            _types.InlineKeyboardButton("⬆️ Больше 7", callback_data="dice_bet_high"),
            _types.InlineKeyboardButton("⬇️ Меньше 7", callback_data="dice_bet_low"),
        )
        kb.add(_types.InlineKeyboardButton("🎯 Ровно 7 (x5)", callback_data="dice_bet_seven"))
        kb.add(_types.InlineKeyboardButton("🔢 Точное число (x36)", callback_data="dice_bet_exact"))
        kb.add(_types.InlineKeyboardButton("⚔️ Дуэль PvP", callback_data="dice_pvp_menu"))
        kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=kb)
        return

    if cmd in ["рулетка", "roulette", "рул"]:
        if len(parts) > 1:
            # Парсим тип ставки и сумму, напр. "рулетка красное 3к", "рулетка 17 1кк", "рулетка зеро все"
            bet_str = None
            bet_type = None
            target = None
            # Ищем возможный тип в частях
            rest = " ".join(parts[1:]).lower()
            # Простой парсинг
            for word in parts[1:]:
                w = word.lower()
                if w in ["красное", "красн", "red", "к"]:
                    bet_type = "red"
                    bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    break
                elif w in ["чёрное", "черное", "чёрн", "черн", "black", "ч"]:
                    bet_type = "black"
                    bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    break
                elif w in ["зеро", "zero", "зелёное", "зеленое", "0"]:
                    bet_type = "zero"
                    bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    break
                elif w in ["чётное", "четное", "even", "ч"]:
                    bet_type = "even"
                    bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    break
                elif w in ["нечётное", "нечетное", "odd", "н"]:
                    bet_type = "odd"
                    bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    break
                elif w in ["низ", "low", "1-18", "нижние"]:
                    bet_type = "low"
                    bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    break
                elif w in ["верх", "high", "19-36", "верхние"]:
                    bet_type = "high"
                    bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    break
                elif w.isdigit() or (w.startswith("число") and len(parts) > parts.index(word)+1):
                    bet_type = "number"
                    if w.isdigit():
                        target = int(w)
                        bet_str = parts[parts.index(word)+1] if (parts.index(word)+1 < len(parts)) else None
                    else:
                        target = int(parts[parts.index(word)+1]) if (parts.index(word)+1 < len(parts) and parts[parts.index(word)+1].isdigit()) else None
                        bet_str = parts[parts.index(word)+2] if (parts.index(word)+2 < len(parts)) else None
                    break

            if bet_type:
                if bet_str and bet_str in ["все", "всё", "all", "вабанк"]:
                    bet = user["balance"]
                else:
                    bet = parse_amount(bet_str) if bet_str else None
                if bet and bet >= MIN_BET:
                    bet = min(bet, user["balance"])
                    from games.roulette import start_roulette_direct
                    start_roulette_direct(message.chat.id, user_id, bet_type, target, bet)
                    return
                else:
                    # Открываем меню ставок для этого типа с предзаполнением прошлой
                    u = get_user(user_id)
                    last = u.get("last_bet", 0)
                    pre_bet = min(last, u["balance"]) if last > 0 else 0
                    from interface.betting import bet_keyboard
                    t = f"🎡 <b>РУЛЕТКА — {bet_type.upper()}</b>\n\nВыберите сумму ставки:"
                    bot_instance.bot.send_message(message.chat.id, t, reply_markup=bet_keyboard(f"roulette_{bet_type}", pre_bet))
                    return

        # bare "рулетка" - открываем выбор секторов (как roulette_menu)
        from telebot import types as _types
        u = get_user(user_id)
        t = "🎡 <b>ЕВРОПЕЙСКАЯ РУЛЕТКА</b>\n\nВыберите сектор для ставки:"
        kb = _types.InlineKeyboardMarkup(row_width=2)
        kb.add(
            _types.InlineKeyboardButton("🔴 КРАСНОЕ (x2)", callback_data="roulette_bet_red"),
            _types.InlineKeyboardButton("⚫ ЧЁРНОЕ (x2)", callback_data="roulette_bet_black"),
        )
        kb.add(
            _types.InlineKeyboardButton("🟢 ЗЕРО (x35)", callback_data="roulette_bet_zero"),
            _types.InlineKeyboardButton("🔢 ЧИСЛО (x35)", callback_data="roulette_bet_number"),
        )
        kb.add(
            _types.InlineKeyboardButton("⬇️ 1–18 (x2)", callback_data="roulette_bet_low"),
            _types.InlineKeyboardButton("⬆️ 19–36 (x2)", callback_data="roulette_bet_high"),
        )
        kb.add(
            _types.InlineKeyboardButton("⚖️ ЧЁТНОЕ (x2)", callback_data="roulette_bet_even"),
            _types.InlineKeyboardButton("⚖️ НЕЧЁТНОЕ (x2)", callback_data="roulette_bet_odd"),
        )
        kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=kb)
        return

    # --- Новая игра: МОНЕТКА (с прямой поддержкой команд) ---
    if cmd in ["монетка", "coin", "монет"]:
        if len(parts) > 1:
            sub = parts[1].lower()
            # Прямой запуск с выбором стороны + ставка: монетка орёл 1кк
            if sub in ["орёл", "orel", "heads", "o", "орeл"]:
                if len(parts) > 2:
                    bet_str = parts[2]
                    if bet_str in ["все", "всё", "all", "вабанк"]:
                        bet = user["balance"]
                    else:
                        bet = parse_amount(bet_str)
                    if bet and bet >= MIN_BET:
                        bet = min(bet, user["balance"])
                        from games.coin import start_coin_direct
                        start_coin_direct(message.chat.id, user_id, "heads", bet)
                        return
                # Без ставки — открываем меню монетки (с предзаполненной прошлой)
                kb = _types.InlineKeyboardMarkup(row_width=2)
                kb.add(
                    _types.InlineKeyboardButton("🪙 ОРЁЛ (x2)", callback_data="coin_choose_heads"),
                    _types.InlineKeyboardButton("🪙 РЕШКА (x2)", callback_data="coin_choose_tails"),
                )
                kb.add(_types.InlineKeyboardButton("⚔️ МОНЕТКА PvP", callback_data="coin_pvp_menu"))
                kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
                bot_instance.bot.send_message(
                    message.chat.id,
                    "🪙 <b>МОНЕТКА</b>\n\n"
                    "Классическая игра на удачу!\n"
                    "Выберите сторону — при совпадении выигрыш x2.\n\n"
                    "Или вызовите друга на дуэль PvP.",
                    reply_markup=kb
                )
                return
            if sub in ["решка", "reshka", "tails", "r", "рещка"]:
                if len(parts) > 2:
                    bet_str = parts[2]
                    if bet_str in ["все", "всё", "all", "вабанк"]:
                        bet = user["balance"]
                    else:
                        bet = parse_amount(bet_str)
                    if bet and bet >= MIN_BET:
                        bet = min(bet, user["balance"])
                        from games.coin import start_coin_direct
                        start_coin_direct(message.chat.id, user_id, "tails", bet)
                        return
                kb = _types.InlineKeyboardMarkup(row_width=2)
                kb.add(
                    _types.InlineKeyboardButton("🪙 ОРЁЛ (x2)", callback_data="coin_choose_heads"),
                    _types.InlineKeyboardButton("🪙 РЕШКА (x2)", callback_data="coin_choose_tails"),
                )
                kb.add(_types.InlineKeyboardButton("⚔️ МОНЕТКА PvP", callback_data="coin_pvp_menu"))
                kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
                bot_instance.bot.send_message(
                    message.chat.id,
                    "🪙 <b>МОНЕТКА</b>\n\n"
                    "Классическая игра на удачу!\n"
                    "Выберите сторону — при совпадении выигрыш x2.\n\n"
                    "Или вызовите друга на дуэль PvP.",
                    reply_markup=kb
                )
                return
            # PvP
            if sub in ["pvp", "пвп", "дуэль", "пвп", "против"]:
                fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                fake_c.data = "coin_pvp_menu"
                from games.coin import coin_pvp_menu
                coin_pvp_menu(fake_c)
                return

            # Прямое создание PvP комнаты с выбором стороны: "монетка создать орёл 1кк"
            if sub in ["создать", "create"]:
                if len(parts) > 2:
                    side_sub = parts[2].lower()
                    side = None
                    if side_sub in ["орёл", "орел", "heads", "o", "орeл"]:
                        side = "heads"
                    elif side_sub in ["решка", "reshka", "tails", "r", "рещка"]:
                        side = "tails"

                    if side and len(parts) > 3:
                        bet_str = parts[3]
                        if bet_str in ["все", "всё", "all", "вабанк"]:
                            bet = user["balance"]
                        else:
                            bet = parse_amount(bet_str)
                        if bet and bet >= MIN_BET:
                            bet = min(bet, user["balance"])
                            from games.coin import create_coin_pvp_room
                            create_coin_pvp_room(message.chat.id, user_id, bet, side)
                            return
                        else:
                            bot_instance.bot.reply_to(message, f"❌ Укажите корректную ставку (минимум {MIN_BET}). Пример: монетка создать орёл 1кк")
                            return
                bot_instance.bot.reply_to(message, "Формат: <code>монетка создать орёл 1кк</code> или <code>монетка создать решка 50000</code>")
                return

        # Просто "монетка" — отправляем меню напрямую (как для других игр)
        kb = _types.InlineKeyboardMarkup(row_width=2)
        kb.add(
            _types.InlineKeyboardButton("🪙 ОРЁЛ (x2)", callback_data="coin_choose_heads"),
            _types.InlineKeyboardButton("🪙 РЕШКА (x2)", callback_data="coin_choose_tails"),
        )
        kb.add(_types.InlineKeyboardButton("⚔️ МОНЕТКА PvP", callback_data="coin_pvp_menu"))
        kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot_instance.bot.send_message(
            message.chat.id,
            "🪙 <b>МОНЕТКА</b>\n\n"
            "Классическая игра на удачу!\n"
            "Выберите сторону — при совпадении выигрыш x2.\n\n"
            "Или вызовите друга на дуэль PvP.",
            reply_markup=kb
        )
        return

    # --- Ферма (прямые действия) ---
    if cmd in ["ферма", "farm", "майнинг", "добыча", "фермы"]:
        if len(parts) > 1:
            sub = parts[1]
            # Собрать
            if sub in ["собрать", "collect", "урожай", "btc"]:
                fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                fake_c.data = "mine_collect"
                from game_logic.mining import mine_collect_handler
                mine_collect_handler(fake_c)
                return
            # Улучшить / купить следующую
            if sub in ["улучшить", "upgrade", "прокачать"]:
                # Вызываем логику улучшения на следующий уровень (как в обработчике)
                m = user.get("mining", {})
                level = m.get("farm_level", 0)
                if level < 10:
                    next_level = level + 1
                    fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                    fake_c.data = f"mine_upgrade_{next_level}"
                    from game_logic.mining import mine_upgrade_handler
                    mine_upgrade_handler(fake_c)
                else:
                    bot_instance.bot.send_message(message.chat.id, "У вас уже максимальный уровень фермы. Можно докупать доп. фермы командой <code>ферма купить 10</code>")
                return
            # Купить доп. фермы (только для 10 уровня)
            if sub in ["купить", "buy", "докупить"]:
                if len(parts) > 2:
                    amt = parse_amount(parts[2])
                    if amt and amt > 0:
                        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                        fake_c.data = f"mine_buy_extra_confirm_{amt}"
                        from game_logic.mining import mine_buy_extra_confirm
                        mine_buy_extra_confirm(fake_c)
                        return
                # без количества — открываем меню покупки
                fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                fake_c.data = "mine_buy_extra"
                from game_logic.mining import mine_buy_extra_handler
                mine_buy_extra_handler(fake_c)
                return
            # Продать доп. фермы
            if sub in ["продать", "sell"]:
                if len(parts) > 2:
                    # Переиспользуем существующий обработчик "продать фермы"
                    # Симулируем команду "продать фермы N"
                    sell_text = "продать фермы " + " ".join(parts[2:])
                    # Временно подменим текст
                    orig_text = message.text
                    message.text = sell_text
                    sell_command_handler(message)
                    message.text = orig_text
                    return
                bot_instance.bot.reply_to(message, "💡 Напишите: <code>ферма продать 5</code> или <code>ферма продать все</code>")
                return

        # По умолчанию — меню фермы
        from game_logic.mining import mining_menu_text, mining_menu_kb
        bot_instance.bot.send_message(
            message.chat.id,
            mining_menu_text(user_id),
            reply_markup=mining_menu_kb(user_id)
        )
        return

    # --- Прямой перевод одной командой ---
    if cmd in ["перевод", "перевести", "transfer", "send", "дать"]:
        if len(parts) >= 3:
            target_str = parts[1]
            amount = parse_amount(parts[2])
            if amount is None or amount < TRANSFER_MIN:
                bot_instance.bot.reply_to(message, f"❌ Укажите корректную сумму (минимум {TRANSFER_MIN}). Пример: <code>перевод 123456 100к</code>")
                return
            from users.admin import admin_resolve_user
            from economy.transfers import get_transfer_limits, add_transfer_count
            t_id, t_data = admin_resolve_user(target_str)
            if not t_id:
                bot_instance.bot.reply_to(message, "❌ Получатель не найден (укажите Игровой ID или @username).")
                return
            if t_id == user_id:
                bot_instance.bot.reply_to(message, "❌ Нельзя переводить самому себе.")
                return
            max_amount, _ = get_transfer_limits(user)
            used = 0  # упрощённо, полную проверку можно добавить
            if amount > max_amount:
                bot_instance.bot.reply_to(message, f"❌ Превышен лимит перевода ({fmt(max_amount)}).")
                return
            if user["balance"] < amount:
                bot_instance.bot.reply_to(message, "❌ Недостаточно средств.")
                return

            user["balance"] -= amount
            t_user = get_user(t_id)
            t_user["balance"] += amount
            save_user(user_id, user)
            save_user(t_id, t_user)
            add_transfer_count(user_id)

            display_target = get_display_name(t_data)
            display_from = get_display_name(user)
            bot_instance.bot.reply_to(message, f"✅ Переведено <b>{fmt(amount)} {CURRENCY}</b> игроку <b>{display_target}</b> (ID {t_data.get('game_id')})")
            try:
                bot_instance.bot.send_message(t_id, f"💸 Вам пришёл перевод <b>+{fmt(amount)} {CURRENCY}</b> от {display_from}.")
            except:
                pass
            return
        bot_instance.bot.reply_to(message, "Формат: <code>перевод 123456 50к</code> или <code>перевод @username 1кк</code>")
        return

    # --- Бизнесы ---
    if cmd in ["бизнес", "бизнесы", "business", "biz"]:
        from economy.business import business_menu_text, business_menu_kb
        if len(parts) > 1:
            sub = parts[1]
            if sub in ["купить", "buy"]:
                if len(parts) > 2:
                    try:
                        biz_id = int(parts[2])
                        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                        fake_c.data = f"biz_buy_{biz_id}"
                        from economy.business import biz_buy_handler
                        biz_buy_handler(fake_c)
                        return
                    except:
                        pass
                bot_instance.bot.reply_to(message, "Пример: <code>бизнес купить 1</code>")
                return
            if sub in ["продать", "sell"]:
                if len(parts) > 2:
                    try:
                        biz_id = int(parts[2])
                        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
                        fake_c.data = f"biz_sell_{biz_id}"
                        from economy.business import biz_sell_handler
                        biz_sell_handler(fake_c)
                        return
                    except:
                        pass
                bot_instance.bot.reply_to(message, "Пример: <code>бизнес продать 1</code>")
                return
            # Можно добавить выполнение задач: бизнес задача 1 ...
        bot_instance.bot.send_message(message.chat.id, business_menu_text(user_id), reply_markup=business_menu_kb(user_id))
        return

    # --- Рейтинг (покупка/продажа) ---
    if "рейтинг" in " ".join(parts):
        sub_idx = -1
        for i, p in enumerate(parts):
            if p in ["купить", "купить_рейтинг", "buy", "куплю"]:
                sub_idx = i
                action = "buy"
                break
            if p in ["продать", "продать_рейтинг", "sell", "продажа"]:
                sub_idx = i
                action = "sell"
                break
        if sub_idx != -1:
            # Найти число после ключевого слова
            amt_str = None
            for j in range(sub_idx + 1, len(parts)):
                if parts[j] not in ["рейтинг", "rating"]:
                    amt_str = parts[j]
                    break
            if amt_str and amt_str in ["все", "всё", "all", "вабанк", "максимум", "max"]:
                user = get_user(user_id)  # refresh
                if action == "buy":
                    max_amt = user["balance"] // RATING_PRICE if RATING_PRICE > 0 else 0
                    if max_amt > 0:
                        cost = max_amt * RATING_PRICE
                        user["balance"] -= cost
                        user["rating"] = user.get("rating", 0) + max_amt
                        save_user(user_id, user)
                        bot_instance.bot.reply_to(message, f"✅ Куплено {max_amt} рейтинга за весь доступный баланс ({fmt(cost)} {CURRENCY})!")
                    else:
                        bot_instance.bot.reply_to(message, "❌ Недостаточно средств для покупки даже 1 рейтинга.")
                else:  # sell
                    max_amt = user.get("rating", 0)
                    if max_amt > 0:
                        sell_p = int(RATING_PRICE * 0.6)
                        revenue = max_amt * sell_p
                        user["rating"] = 0
                        user["balance"] += revenue
                        save_user(user_id, user)
                        bot_instance.bot.reply_to(message, f"✅ Продано {max_amt} рейтинга за {fmt(revenue)} {CURRENCY} (60%)!")
                    else:
                        bot_instance.bot.reply_to(message, "❌ У вас нет рейтинга для продажи.")
                return
            elif amt_str:
                amt = parse_amount(amt_str)
                if amt and amt > 0:
                    user = get_user(user_id)
                    if action == "buy":
                        cost = amt * RATING_PRICE
                        if user["balance"] < cost:
                            bot_instance.bot.reply_to(message, f"❌ Недостаточно средств! Нужно {fmt(cost)} {CURRENCY}.")
                            return
                        user["balance"] -= cost
                        user["rating"] = user.get("rating", 0) + amt
                        save_user(user_id, user)
                        bot_instance.bot.reply_to(message, f"✅ Куплено {amt} рейтинга за {fmt(cost)} {CURRENCY}!")
                    else:  # sell
                        current_r = user.get("rating", 0)
                        if amt > current_r:
                            bot_instance.bot.reply_to(message, f"❌ У вас только {current_r} рейтинга.")
                            return
                        sell_p = int(RATING_PRICE * 0.6)
                        revenue = amt * sell_p
                        user["rating"] = current_r - amt
                        user["balance"] += revenue
                        save_user(user_id, user)
                        bot_instance.bot.reply_to(message, f"✅ Продано {amt} рейтинга за {fmt(revenue)} {CURRENCY} (60% от цены покупки)!")
                    return
            # Если не было числа — открыть меню
            from interface.menu import shop_handler
            fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
            fake_c.data = "shop"
            shop_handler(fake_c)
            return
        else:
            # Просто упоминание рейтинга без купить/продать — открыть магазин
            from interface.menu import shop_handler
            fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
            fake_c.data = "shop"
            shop_handler(fake_c)
            return

    # --- Брак / ЗАГС ---
    if cmd in ["загс", "брак", "marriage", "свадьба"]:
        if len(parts) > 1 and parts[1] in ["предложить", "offer", "жениться", "выдать"]:
            if len(parts) > 2:
                target_str = parts[2]
                # Используем существующий pending flow
                bot_instance.pending_proposals[user_id] = {
                    "chat_id": message.chat.id,
                    "message_id": message.message_id
                }
                # Подменим текст на цель
                orig = message.text
                message.text = target_str
                from social.marriage import handle_proposal_input
                handle_proposal_input(message)
                message.text = orig
                return
            bot_instance.bot.reply_to(message, "Пример: <code>загс предложить 123456</code> или <code>загс предложить @username</code>")
            return
        if len(parts) > 1 and parts[1] in ["развод", "divorce"]:
            fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
            fake_c.data = "marriage_divorce_confirm"
            from social.marriage import marriage_divorce_confirm
            marriage_divorce_confirm(fake_c)
            return
        # Открываем меню брака
        from social.marriage import marriage_menu
        fake_c = make_fake_callback(message.from_user, message.chat.id, message.message_id)
        fake_c.data = "marriage_menu"
        marriage_menu(fake_c)
        return

    # Прямые входы в игры (открывают экран выбора ставки) — старые точные совпадения (для обратной совместимости)
    if txt in ["слоты", "slots"]:
        from interface.betting import bet_keyboard
        u = get_user(user_id)
        t = (
            "🎰 <b>СЛОТЫ</b>\n"
            "<i>Три одинаковых = ДЖЕКПОТ! Два совпадения = x1.5\n💎=x8, 7️⃣=x15, ⭐=x25, 🔔=x50</i>\n\n"
            f"💰 Баланс: <b>{fmt(u['balance'])}</b> {CURRENCY}\n"
            f"Ставка:"
        )
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=bet_keyboard("slots", 0))
        return

    if txt in ["мины", "mines"]:
        from telebot import types as _types
        u = get_user(user_id)
        t = (
            "💣 <b>МИНЫ</b>\n"
            "<i>Открывай клетки — множитель растёт. Попал на мину — проиграл!</i>\n\n"
            f"💰 Баланс: <b>{fmt(u['balance'])}</b> {CURRENCY}"
        )
        kb = _types.InlineKeyboardMarkup(row_width=3)
        kb.add(
            _types.InlineKeyboardButton("💣 3 мины", callback_data="start_mines_3"),
            _types.InlineKeyboardButton("💣 5 мин", callback_data="start_mines_5"),
            _types.InlineKeyboardButton("💣 10 мин", callback_data="start_mines_10"),
        )
        kb.add(_types.InlineKeyboardButton("💣 15 мин", callback_data="start_mines_15"))
        kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=kb)
        return

    if txt in ["блэкджек", "blackjack", "бж", "bj"]:
        from interface.betting import bet_keyboard
        u = get_user(user_id)
        t = "🃏 <b>БЛЭКДЖЕК</b>\n<i>Ближе к 21 чем дилер. Натуральный блэкджек = x2.5!</i>\n\n" \
            f"💰 Баланс: <b>{fmt(u['balance'])}</b> {CURRENCY}"
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=bet_keyboard("blackjack", 0))
        return

    if txt in ["кости", "dice", "кубики"]:
        from telebot import types as _types
        u = get_user(user_id)
        t = "🎲 <b>КОСТИ</b>\nВыбери тип ставки:"
        kb = _types.InlineKeyboardMarkup(row_width=2)
        kb.add(
            _types.InlineKeyboardButton("⬆️ Больше 7", callback_data="dice_bet_high"),
            _types.InlineKeyboardButton("⬇️ Меньше 7", callback_data="dice_bet_low"),
        )
        kb.add(_types.InlineKeyboardButton("🎯 Ровно 7 (x5)", callback_data="dice_bet_seven"))
        kb.add(_types.InlineKeyboardButton("🔢 Точное число (x36)", callback_data="dice_bet_exact"))
        kb.add(_types.InlineKeyboardButton("⚔️ Дуэль PvP", callback_data="dice_pvp_menu"))
        kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=kb)
        return

    if txt in ["рулетка", "roulette", "рул"]:
        from telebot import types as _types
        u = get_user(user_id)
        t = "🎡 <b>ЕВРОПЕЙСКАЯ РУЛЕТКА</b>\n\nВыберите сектор для ставки:"
        kb = _types.InlineKeyboardMarkup(row_width=2)
        kb.add(
            _types.InlineKeyboardButton("🔴 КРАСНОЕ (x2)", callback_data="roulette_bet_red"),
            _types.InlineKeyboardButton("⚫ ЧЁРНОЕ (x2)", callback_data="roulette_bet_black"),
        )
        kb.add(
            _types.InlineKeyboardButton("🟢 ЗЕРО (x35)", callback_data="roulette_bet_zero"),
            _types.InlineKeyboardButton("🔢 ЧИСЛО (x35)", callback_data="roulette_bet_number"),
        )
        kb.add(
            _types.InlineKeyboardButton("⬇️ 1–18 (x2)", callback_data="roulette_bet_low"),
            _types.InlineKeyboardButton("⬆️ 19–36 (x2)", callback_data="roulette_bet_high"),
        )
        kb.add(
            _types.InlineKeyboardButton("⚖️ ЧЁТНОЕ (x2)", callback_data="roulette_bet_even"),
            _types.InlineKeyboardButton("⚖️ НЕЧЁТНОЕ (x2)", callback_data="roulette_bet_odd"),
        )
        kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
        bot_instance.bot.send_message(message.chat.id, t, reply_markup=kb)
        return

    # Если ничего не подошло — отправляем заглушку
    from telebot import types
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🎰 Играть", callback_data="game_slots"),
        types.InlineKeyboardButton("📋 Меню", callback_data="main_menu"),
    )
    kb.add(types.InlineKeyboardButton("ℹ️ Помощь", callback_data="help"))
    bot_instance.bot.send_message(
        message.chat.id,
        f"🤔 Не понял команду <b>«{message.text[:30]}»</b>\n\n"
        f"Попробуй написать:\n"
        f"• <code>меню</code> — главное меню\n"
        f"• <code>профиль</code> / <code>я</code> / <code>ферма</code>\n"
        f"• <code>топ</code> / <code>бонус</code> / <code>магазин</code>\n"
        f"• <code>слоты 1кк</code> / <code>слоты все</code> / <code>мины 3 50000</code> / <code>мины 3 все</code>\n"
        f"• <code>рулетка красное 3к</code> / <code>рулетка 17 1кк</code> / <code>рулетка зеро все</code>\n"
        f"• <code>кости больше 1кк</code> / <code>кости ровно 7 50к</code> / <code>кости точное 12 100к</code>\n"
        f"• <code>банк положить 100к</code> / <code>перевод 123 1кк</code>\n"
        f"• <code>монетка орёл 1кк</code> / <code>монетка все</code> / <code>монетка создать решка 50к</code>\n"
        f"• <code>команды</code> / <code>игры</code> / <code>экономика</code> / <code>социал</code> — разделы",
        reply_markup=kb
    )


# ============================================================
# === НОВЫЕ ФУНКЦИИ РАЗДЕЛОВ (команды, игры, экономика, социал)
# ============================================================

def send_commands_overview(chat_id: int):
    """Полный каталог всех команд бота (по разделам)."""
    from telebot import types as _t
    text = (
        "📋 <b>ВСЕ КОМАНДЫ БОТА</b>\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "<b>НАВИГАЦИЯ</b>\n"
        "• <code>меню</code> / <code>назад</code> — главное меню\n"
        "• <code>профиль</code> / <code>я</code> / <code>проф</code> — твой профиль + ачивки + брак\n"
        "• <code>баланс</code> / <code>бал</code> — баланс (руки + банк)\n"
        "• <code>топ</code> / <code>лидеры</code> — топ-10 по рейтингу\n"
        "• <code>бонус</code> / <code>ежедневный</code> — ежедневный бонус + стрик\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "<b>ИГРЫ</b> (напиши <code>игры</code> для полного списка)\n"
        "• <code>слоты [ставка/все]</code>\n"
        "• <code>мины 3|5|10|15 [ставка/все]</code>\n"

        "• <code>бж</code> / <code>блэкджек [ставка/все]</code>\n"
        "• <code>кости больше|меньше|ровно|точное N [ставка]</code>\n"
        "• <code>рулетка красное|чёрное|зеро|17|чётное [ставка/все]</code>\n"
        "• <code>монетка орёл|решка [ставка]</code> + <code>монетка пвп</code> / <code>монетка создать ...</code>\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "<b>ЭКОНОМИКА</b> (напиши <code>экономика</code>)\n"
        "• <code>ферма</code> / <code>майнинг</code> — открыть ферму\n"
        "  <code>ферма собрать</code>, <code>ферма улучшить</code>, <code>ферма купить 10</code>, <code>ферма продать 5</code>\n"
        "  или <code>продать фермы 3</code> / <code>продать фермы все</code>\n"
        "• <code>бизнес</code> — список бизнесов\n"
        "  <code>бизнес купить 3</code> / <code>бизнес продать 1</code>\n"
        "• <code>банк</code> / <code>банк положить 100к</code> / <code>банк снять все</code>\n"
        "  <code>положить 50</code> / <code>снять все</code>\n"
        "• <code>перевод 123456 1кк</code> / <code>перевод @user 50000</code>\n"
        "• <code>магазин</code> / <code>рейтинг</code> / <code>донат</code> — магазин (покупка/продажа рейтинга, VIP)\n"
        "  <code>купить рейтинг 5</code>, <code>купить рейтинг все</code>, <code>продать рейтинг 3</code>\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "<b>СОЦИАЛ</b> (напиши <code>социал</code> или <code>брак</code>)\n"
        "• <code>загс</code> / <code>брак</code> — меню брака\n"
        "• <code>загс предложить 123456</code> — сделать предложение\n"
        "• <code>загс развод</code> — развод\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "<b>НИКНЕЙМЫ</b> (напиши <code>ник</code>)\n"
        "• Создание уникального ника — 35% от общего баланса (наличные + банк)\n"
        "• Максимум 2 ника на аккаунт\n"
        "• Можно продавать на маркете другим игрокам\n"
        "• Отображаются в профиле и играх как <b>Ник1/Ник2</b>\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "💡 Подсказка: почти везде можно писать <code>все</code> или <code>вабанк</code> вместо числа."
    )
    kb = _t.InlineKeyboardMarkup(row_width=2)
    kb.add(
        _t.InlineKeyboardButton("🎰 Игры", callback_data="show_games"),
        _t.InlineKeyboardButton("🏦 Экономика", callback_data="show_economy"),
    )
    kb.add(
        _t.InlineKeyboardButton("💍 Социал / Брак", callback_data="show_social"),
        _t.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )
    bot_instance.bot.send_message(chat_id, text, reply_markup=kb)


def send_games_section(chat_id: int):
    """Список всех игр с кратким описанием и примерами команд."""
    from telebot import types as _t
    text = (
        "🎰 <b>ВСЕ ИГРЫ БОТА</b>\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "🎰 <b>СЛОТЫ</b>\n"
        "Три одинаковых = джекпот! Два совпадения = x1.5\n"
        "Примеры: <code>слоты</code>, <code>слоты 1кк</code>, <code>слоты все</code>\n\n"
        "💣 <b>МИНЫ</b>\n"
        "Открывай клетки, множитель растёт. 3/5/10/15 мин.\n"
        "Примеры: <code>мины 3</code>, <code>мины 5 1кк</code>, <code>мины 10 все</code>\n\n"

        "🃏 <b>БЛЭКДЖЕК</b>\n"
        "Ближе к 21, чем дилер. Натуральный блэкджек = x2.5\n"
        "Примеры: <code>бж</code>, <code>блэкджек 500к</code>\n\n"
        "🎲 <b>КОСТИ</b>\n"
        "Больше/меньше 7 (x1.9), ровно 7 (x5), точное число (x36). Есть PvP-дуэли.\n"
        "Примеры: <code>кости больше 1кк</code>, <code>кости ровно 7 50к</code>, <code>кости пвп</code>\n\n"
        "🎡 <b>РУЛЕТКА</b> (европейская)\n"
        "Красное/чёрное/чётное (x2), зеро/число (x35). Много типов ставок.\n"
        "Примеры: <code>рулетка красное 3к</code>, <code>рулетка 17 1кк</code>, <code>рулетка зеро все</code>\n\n"
        "🪙 <b>МОНЕТКА</b>\n"
        "Классика 50/50 (x2). Есть PvP дуэли и создание комнат.\n"
        "Примеры: <code>монетка орёл 1кк</code>, <code>монетка решка все</code>, <code>монетка пвп</code>\n"
        "Создать комнату: <code>монетка создать орёл 500к</code>\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "💡 Во всех играх есть кнопка <b>💰 ВАБАНК!!</b> и запоминается последняя ставка."
    )
    kb = _t.InlineKeyboardMarkup(row_width=1)
    kb.add(_t.InlineKeyboardButton("🎰 Открыть Слоты", callback_data="game_slots"))
    kb.add(_t.InlineKeyboardButton("◀️ Назад в меню", callback_data="main_menu"))
    bot_instance.bot.send_message(chat_id, text, reply_markup=kb)


def send_economy_section(chat_id: int, user_id: int):
    """Обзор всей экономической системы бота."""
    from telebot import types as _t
    from core.database import get_user as _get_user
    from core.utils import fmt as _fmt
    u = _get_user(user_id)
    bal = _fmt(u["balance"])

    text = (
        f"🏦 <b>ЭКОНОМИКА И ПРОГРЕСС</b>\n\n"
        f"💰 Твой баланс: <b>{bal} {CURRENCY}</b>\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "⛏️ <b>ФЕРМА (МАЙНИНГ)</b>\n"
        "Покупай и улучшай фермы — они добывают BTC, который продаётся за кристаллы.\n"
        "10 уровней + возможность докупать «Бутуз-центры».\n"
        "Команды: <code>ферма</code>, <code>ферма собрать</code>, <code>ферма улучшить</code>, <code>ферма купить 25</code>\n"
        "Продажа: <code>продать фермы 5</code> / <code>ферма продать все</code> (по 70% цены)\n\n"
        "🏢 <b>БИЗНЕСЫ</b> (10 видов)\n"
        "От шаурмичной до «Мирового правительства». Пассивный доход + ежечасные задачи за мгновенный доход.\n"
        "Команды: <code>бизнес</code>, <code>бизнес купить 4</code>, <code>бизнес продать 2</code>\n\n"
        "🏦 <b>БАНК</b>\n"
        "Храни деньги безопасно (не сгорят в играх).\n"
        "Команды: <code>банк</code>, <code>банк положить 100к</code>, <code>снять все</code>, <code>положить 50</code>\n\n"
        "💸 <b>ПЕРЕВОДЫ</b>\n"
        "Переводи кристаллы другим игрокам (есть дневные лимиты, VIP даёт больше).\n"
        "Команды: <code>перевод 123456 1кк</code> или <code>перевод @username 50000</code>\n\n"
        "🛒 <b>МАГАЗИН / VIP</b>\n"
        "• Покупка/продажа рейтинга (влияет на место в топе)\n"
        "  <code>купить рейтинг 10</code> / <code>купить рейтинг все</code> / <code>продать рейтинг 5</code>\n"
        "• VIP навсегда (x1.5 к ежедневному бонусу + огромные лимиты переводов)\n"
        "Команда: <code>магазин</code> / <code>рейтинг</code> / <code>донат</code>\n\n"
        "🏷 <b>НИКНЕЙМЫ</b> (новая система)\n"
        "• Создавай уникальные ники за 35% от общего баланса (макс 2)\n"
        "• Выставляй на маркет и продавай другим игрокам\n"
        "• В профиле и играх показывается как Ник1/Ник2\n"
        "Команды: <code>ник</code>, <code>никнеймы</code>, <code>ник маркет</code>\n"
    )
    kb = _t.InlineKeyboardMarkup(row_width=2)
    kb.add(
        _t.InlineKeyboardButton("⛏️ Ферма", callback_data="mine_farm"),
        _t.InlineKeyboardButton("🏢 Бизнесы", callback_data="business_menu"),
    )
    kb.add(
        _t.InlineKeyboardButton("🏦 Банк", callback_data="bank_menu"),
        _t.InlineKeyboardButton("💸 Переводы", callback_data="transfer_menu"),
    )
    kb.add(_t.InlineKeyboardButton("🛒 Магазин / VIP", callback_data="shop"))
    kb.add(_t.InlineKeyboardButton("🏷 Никнеймы", callback_data="nickname_menu"))
    kb.add(_t.InlineKeyboardButton("◀️ Главное меню", callback_data="main_menu"))
    bot_instance.bot.send_message(chat_id, text, reply_markup=kb)


def send_social_section(chat_id: int):
    """Информация о социальной системе (браки)."""
    from telebot import types as _t
    text = (
        "💍 <b>СОЦИАЛ / БРАКИ (ЗАГС)</b>\n\n"
        "В боте есть официальная система браков между игроками.\n\n"
        "• Сделай предложение любому игроку по его <b>Игровому ID</b> или <b>@username</b>\n"
        "• Второй игрок получает уведомление и может принять или отклонить\n"
        "• В профиле отображается, с кем ты в браке и дата свадьбы\n"
        "• Можно развестись (действие необратимое)\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "<b>Команды:</b>\n"
        "• <code>загс</code> или <code>брак</code> — открыть меню брака\n"
        "• <code>загс предложить 123456</code>\n"
        "• <code>загс предложить @username</code>\n"
        "• <code>загс развод</code> — подать на развод\n\n"
        "💡 Брак — это чисто социальная фича, не даёт механических бонусов."
    )
    kb = _t.InlineKeyboardMarkup(row_width=1)
    kb.add(_t.InlineKeyboardButton("💍 Открыть ЗАГС", callback_data="marriage_menu"))
    kb.add(_t.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    bot_instance.bot.send_message(chat_id, text, reply_markup=kb)
