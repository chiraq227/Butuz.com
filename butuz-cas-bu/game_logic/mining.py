from datetime import datetime
from telebot import types
from config import FARM_LEVELS, MAX_EXTRA_FARMS, BTC_SELL_RATE, CURRENCY, CURRENCY_NAME
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from core.utils import fmt

def mining_accumulate(user: dict) -> float:
    m = user.get("mining", {})
    level = m.get("farm_level", 0)
    if level == 0:
        return 0.0

    farm = FARM_LEVELS[level]
    last = m.get("last_collected")

    if last is None:
        return 0.0

    last_dt = datetime.fromisoformat(last)
    now = datetime.now()
    hours_passed = (now - last_dt).total_seconds() / 3600.0
    hours_passed = min(hours_passed, 72.0)

    base_btc = farm["btc_per_hour"] * hours_passed

    extra_farms = m.get("extra_farms", 0)
    if level == 10 and extra_farms > 0:
        extra_btc = farm["btc_per_hour"] * extra_farms * hours_passed
        base_btc += extra_btc

    return round(base_btc, 6)

def mining_get_accumulated(user: dict) -> float:
    m = user.get("mining", {})
    saved = m.get("btc_accumulated", 0.0)
    new_btc = mining_accumulate(user)
    return round(saved + new_btc, 6)

def fmt_btc(n: float) -> str:
    return f"{n:.6f}"

def mining_menu_text(user_id: int) -> str:
    user = get_user(user_id)
    m = user.get("mining", {})
    level = m.get("farm_level", 0)
    extra_farms = m.get("extra_farms", 0)
    total_btc = mining_get_accumulated(user)

    if level == 0:
        farm_info = "У вас нет фермы. Купите первую в магазине ферм!"
        rate_info = "0 BTC/час"
    else:
        farm = FARM_LEVELS[level]
        farm_info = f"{farm['emoji']} <b>{farm['name']}</b> (уровень {level})"
        if level == 10 and extra_farms > 0:
            total_farms = 1 + extra_farms
            total_rate = round(farm["btc_per_hour"] * total_farms, 3)
            rate_info = f"{total_rate} BTC/час ({total_farms} ферм x{farm['btc_per_hour']})"
        else:
            rate_info = f"{farm['btc_per_hour']} BTC/час"

    btc_value = int(total_btc * BTC_SELL_RATE)

    extra_line = ""
    if level == 10:
        extra_line = f"🏭 Дополнительных ферм: <b>{extra_farms}/{MAX_EXTRA_FARMS}</b>\n"

    text = (
        f"⛏️ <b>МАЙНИНГ ФЕРМА</b>\n\n"
        f"🏭 Ферма: {farm_info}\n"
        f"{extra_line}"
        f"⚡ Скорость: <b>{rate_info}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"₿ Накоплено: <b>{fmt_btc(total_btc)} BTC</b>\n"
        f"💰 Стоимость: <b>≈ {fmt(btc_value)} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 Баланс: {fmt(user['balance'])} {CURRENCY}\n\n"
        f"💡 1 BTC = {BTC_SELL_RATE} {CURRENCY}"
    )
    return text

def mining_menu_kb(user_id: int) -> types.InlineKeyboardMarkup:
    user = get_user(user_id)
    m = user.get("mining", {})
    level = m.get("farm_level", 0)
    extra_farms = m.get("extra_farms", 0)
    total_btc = mining_get_accumulated(user)
    kb = types.InlineKeyboardMarkup(row_width=2)

    if total_btc >= 0.000001 and level > 0:
        btc_value = int(total_btc * BTC_SELL_RATE)
        kb.add(types.InlineKeyboardButton(
            f"💰 Собрать {fmt_btc(total_btc)} BTC ({fmt(btc_value)} {CURRENCY})",
            callback_data="mine_collect"
        ))

    if level < 10:
        next_level = level + 1
        next_farm = FARM_LEVELS[next_level]
        kb.add(types.InlineKeyboardButton(
            f"⬆️ {'Купить' if level == 0 else 'Улучшить'}: {next_farm['name']} ({fmt(next_farm['price'])} {CURRENCY})",
            callback_data=f"mine_upgrade_{next_level}"
        ))
    elif level == 10 and extra_farms < MAX_EXTRA_FARMS:
        farm = FARM_LEVELS[10]
        kb.add(types.InlineKeyboardButton(
            f"➕ Докупить ферму [{extra_farms+1}/{MAX_EXTRA_FARMS}] ({fmt(farm['price'])} {CURRENCY})",
            callback_data="mine_buy_extra"
        ))
    else:
        kb.add(types.InlineKeyboardButton(
            f"✅ Максимум ферм достигнут ({MAX_EXTRA_FARMS})",
            callback_data="mine_max_info"
        ))

    kb.add(types.InlineKeyboardButton("📋 Все уровни ферм", callback_data="mine_levels"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    return kb

@bot.callback_query_handler(func=lambda c: c.data == "mine_farm")
def mine_farm_handler(c):
    user_id = c.from_user.id
    text = mining_menu_text(user_id)
    kb = mining_menu_kb(user_id)
    try:
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    except:
        bot.send_message(user_id, text, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "mine_collect")
def mine_collect_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    m = user.get("mining", {})
    level = m.get("farm_level", 0)

    if level == 0:
        bot.answer_callback_query(c.id, "❌ У вас нет фермы!", show_alert=True)
        return

    total_btc = mining_get_accumulated(user)

    if total_btc < 0.000001:
        bot.answer_callback_query(c.id, "⏳ Ещё ничего не накоплено!", show_alert=True)
        return

    crystals = int(total_btc * BTC_SELL_RATE)
    now = datetime.now()
    user["mining"]["btc_accumulated"] = 0.0
    user["mining"]["last_collected"] = now.isoformat()
    user["balance"] += crystals
    save_user(user_id, user)

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("⛏️ Назад к ферме", callback_data="mine_farm"),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )
    bot.edit_message_text(
        f"⛏️ <b>СБОР УРОЖАЯ!</b>\n\n"
        f"₿ Собрано: <b>{fmt_btc(total_btc)} BTC</b>\n"
        f"💎 Получено: <b>+{fmt(crystals)} {CURRENCY}</b>\n\n"
        f"⏱ Ферма снова работает!\n"
        f"💰 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("mine_upgrade_"))
def mine_upgrade_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    target_level = int(c.data.split("_")[-1])

    if target_level < 1 or target_level > 10:
        bot.answer_callback_query(c.id, "❌ Неверный уровень", show_alert=True)
        return

    m = user.get("mining", {})
    current_level = m.get("farm_level", 0)

    if target_level != current_level + 1:
        bot.answer_callback_query(c.id, "❌ Можно улучшать только на 1 уровень!", show_alert=True)
        return

    farm = FARM_LEVELS[target_level]
    price = farm["price"]

    if user["balance"] < price:
        bot.answer_callback_query(
            c.id,
            f"❌ Недостаточно {CURRENCY_NAME}! Нужно {fmt(price)}, у вас {fmt(user['balance'])}",
            show_alert=True
        )
        return

    if current_level > 0:
        accumulated = mining_get_accumulated(user)
        user["mining"]["btc_accumulated"] = accumulated

    user["balance"] -= price
    now = datetime.now()
    user["mining"]["farm_level"] = target_level

    if current_level == 0:
        user["mining"]["last_collected"] = now.isoformat()
        user["mining"]["btc_accumulated"] = 0.0

    save_user(user_id, user)

    action = "куплена" if current_level == 0 else "улучшена"

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("⛏️ К ферме", callback_data="mine_farm"))
    kb.add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))

    bot.edit_message_text(
        f"🎉 <b>Ферма {action}!</b>\n\n"
        f"{farm['emoji']} <b>{farm['name']}</b>\n"
        f"⚡ Скорость: <b>{farm['btc_per_hour']} BTC/час</b>\n\n"
        f"Оплачено: <b>-{fmt(price)} {CURRENCY}</b>\n"
        f"💰 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>\n\n"
        f"⛏️ Ферма уже майнит! Возвращайтесь позже.",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "mine_buy_extra")
def mine_buy_extra_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    m = user.get("mining", {})
    level = m.get("farm_level", 0)
    extra_farms = m.get("extra_farms", 0)

    if level != 10:
        bot.answer_callback_query(c.id, "❌ Сначала купите ферму 10-го уровня!", show_alert=True)
        return

    if extra_farms >= MAX_EXTRA_FARMS:
        bot.answer_callback_query(c.id, f"❌ Максимум {MAX_EXTRA_FARMS} ферм!", show_alert=True)
        return

    farm = FARM_LEVELS[10]
    price = farm["price"]
    available_slots = MAX_EXTRA_FARMS - extra_farms

    max_by_balance = user["balance"] // price
    max_can_buy = min(max_by_balance, available_slots)

    kb = types.InlineKeyboardMarkup(row_width=2)

    quick_amounts = [1, 5, 10, 25, 50, 100]
    buttons = []
    for amount in quick_amounts:
        if amount <= available_slots and amount * price <= user["balance"]:
            buttons.append(
                types.InlineKeyboardButton(
                    f"x{amount}",
                    callback_data=f"mine_buy_extra_confirm_{amount}"
                )
            )
    if buttons:
        kb.add(*buttons)

    if max_can_buy > 0:
        kb.add(
            types.InlineKeyboardButton(
                f"💰 Купить максимум (x{max_can_buy})",
                callback_data=f"mine_buy_extra_confirm_{max_can_buy}"
            )
        )

    kb.add(
        types.InlineKeyboardButton(
            "✏️ Ввести количество вручную",
            callback_data="mine_buy_extra_input"
        )
    )
    kb.add(types.InlineKeyboardButton("◀️ Назад к ферме", callback_data="mine_farm"))

    bot.edit_message_text(
        f"➕ <b>Покупка дополнительных ферм</b>\n\n"
        f"🏭 <b>{farm['emoji']} {farm['name']}</b>\n"
        f"💎 Цена за 1 ферму: <b>{fmt(price)} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🔢 Уже куплено: <b>{extra_farms}/{MAX_EXTRA_FARMS}</b>\n"
        f"📦 Можно ещё купить: <b>{available_slots}</b>\n"
        f"💰 Ваш баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>\n"
        f"🏆 Максимум по балансу: <b>x{max_can_buy}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"Выберите количество:",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data.startswith("mine_buy_extra_confirm_"))
def mine_buy_extra_confirm(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    m = user.get("mining", {})
    level = m.get("farm_level", 0)
    extra_farms = m.get("extra_farms", 0)

    if level != 10:
        bot.answer_callback_query(c.id, "❌ Сначала купите ферму 10-го уровня!", show_alert=True)
        return

    amount = int(c.data.split("_")[-1])
    farm = FARM_LEVELS[10]
    price = farm["price"]
    total_price = price * amount
    available_slots = MAX_EXTRA_FARMS - extra_farms

    if amount <= 0:
        bot.answer_callback_query(c.id, "❌ Неверное количество!", show_alert=True)
        return

    if amount > available_slots:
        bot.answer_callback_query(
            c.id,
            f"❌ Можно купить максимум {available_slots} ферм!",
            show_alert=True
        )
        return

    if user["balance"] < total_price:
        bot.answer_callback_query(
            c.id,
            f"❌ Недостаточно средств!\n"
            f"Нужно: {fmt(total_price)} {CURRENCY}\n"
            f"У вас: {fmt(user['balance'])} {CURRENCY}",
            show_alert=True
        )
        return

    accumulated = mining_get_accumulated(user)
    user["mining"]["btc_accumulated"] = accumulated
    user["mining"]["last_collected"] = datetime.now().isoformat()

    user["balance"] -= total_price
    user["mining"]["extra_farms"] = extra_farms + amount
    save_user(user_id, user)

    new_extra = user["mining"]["extra_farms"]
    total_farms = 1 + new_extra
    total_rate = round(farm["btc_per_hour"] * total_farms, 3)
    daily_btc = round(total_rate * 24, 3)
    daily_crystals = int(daily_btc * BTC_SELL_RATE)

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("⛏️ К ферме", callback_data="mine_farm"))
    kb.add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))

    bot.edit_message_text(
        f"🎉 <b>Успешная покупка!</b>\n\n"
        f"📦 Куплено ферм Бутуз-центр: <b>+{amount} шт.</b>\n"
        f"💎 Списано: <b>-{fmt(total_price)} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🏭 Всего доп. ферм: <b>{new_extra}/{MAX_EXTRA_FARMS}</b>\n"
        f"⚡ Общая скорость: <b>{total_rate} BTC/час</b>\n"
        f"📅 Доход в сутки: <b>~{fmt_btc(daily_btc)} BTC (~{fmt(daily_crystals)} {CURRENCY})</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💰 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "mine_buy_extra_input")
def mine_buy_extra_input_handler(c):
    user_id = c.from_user.id
    bot_instance.pending_farm_input[user_id] = {
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }
    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="mine_buy_extra"))
    bot.edit_message_text(
        "✏️ <b>Ввод количества ферм вручную</b>\n\n"
        "Введите количество (поддерживаются 10, 50, 1к и т.п.):\n"
        "<i>Например: 25 или 100</i>",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "mine_max_info")
def mine_max_info_handler(c):
    bot.answer_callback_query(c.id, f"🌟 Достигнут лимит в {MAX_EXTRA_FARMS} доп. ферм!", show_alert=True)

@bot.callback_query_handler(func=lambda c: c.data == "mine_levels")
def mine_levels_handler(c):
    text = "📋 <b>СПИСОК ВСЕХ ФЕРМ:</b>\n\n"
    for lvl, f in FARM_LEVELS.items():
        text += (
            f"<b>{lvl}. {f['emoji']} {f['name']}</b>\n"
            f"⚡ Скорость: {f['btc_per_hour']} BTC/ч\n"
            f"💰 Цена: {fmt(f['price'])} {CURRENCY}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
        )
    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("⛏️ К ферме", callback_data="mine_farm"))
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
