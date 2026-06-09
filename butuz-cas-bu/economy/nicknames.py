"""
Система уникальных никнеймов
- Создание за 35% от общего баланса (наличные + банк)
- Максимум 2 никнейма на пользователя
- Уникальность (регистр не важен)
- Маркет: продажа своих ников, мгновенная покупка
- Отображение в профиле и играх: Ник1/Ник2
"""

from telebot import types
from bot_instance import bot
import bot_instance
from config import CURRENCY
from core.database import (
    get_user, save_user,
    get_nickname_registry, save_nickname_registry,
    get_nickname_market, save_nickname_market,
)
from core.utils import fmt, get_display_name, make_fake_callback
from datetime import datetime


# === Валидация никнейма ===
ALLOWED_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")

def is_valid_nickname(nick: str) -> tuple[bool, str]:
    """Возвращает (ok, error_message)"""
    if not nick:
        return False, "Никнейм не может быть пустым."
    nick = nick.strip()
    if len(nick) < 3:
        return False, "Никнейм должен быть минимум 3 символа."
    if len(nick) > 16:
        return False, "Никнейм не длиннее 16 символов."
    for ch in nick:
        if ch not in ALLOWED_CHARS:
            return False, "Разрешены только буквы, цифры, _, - и ."
    # Запрещаем только точки/дефисы в начале и конце + двойные
    if nick[0] in ".-_" or nick[-1] in ".-_":
        return False, "Никнейм не может начинаться или заканчиваться на . - или _"
    return True, ""


def normalize_nick(nick: str) -> str:
    """Для проверки уникальности"""
    return nick.strip().lower()


def get_user_total_balance(user: dict) -> int:
    return user.get("balance", 0) + user.get("bank_balance", 0)


def calculate_nickname_cost(user: dict) -> int:
    total = get_user_total_balance(user)
    cost = int(total * 0.35)
    return max(cost, 1)  # минимум 1 кристалл


def get_user_nicknames(user: dict, user_id: int = None) -> list[str]:
    """Возвращает до 2 никнеймов. При передаче user_id — с восстановлением из реестра (на случай прошлых проблем с сохранением)."""
    if user_id is not None:
        return get_authoritative_user_nicknames(int(user_id))
    return list(user.get("nicknames", []))[:2]


def get_authoritative_user_nicknames(user_id: int) -> list[str]:
    """Полный список ников пользователя + авто-восстановление потерянных записей из реестра."""
    user = get_user(user_id)
    nicks = list(user.get("nicknames", []))

    reg = get_nickname_registry()
    for key, entry in reg.items():
        owner = entry["owner"] if isinstance(entry, dict) else entry
        if int(owner) == int(user_id):
            pretty = entry["name"] if isinstance(entry, dict) else key
            if pretty not in nicks:
                nicks.append(pretty)

    nicks = nicks[:2]

    if nicks != list(user.get("nicknames", [])):
        user["nicknames"] = nicks
        save_user(user_id, user)
        for n in nicks:
            register_nickname(n, user_id)

    return nicks


def is_nickname_taken(nick: str) -> bool:
    reg = get_nickname_registry()
    return normalize_nick(nick) in reg


def register_nickname(nick: str, user_id: int):
    """Добавляет ник в реестр владения. Храним и оригинальное написание для отображения."""
    reg = get_nickname_registry()
    key = normalize_nick(nick)
    reg[key] = {
        "owner": int(user_id),
        "name": nick  # сохраняем красивый регистр
    }
    save_nickname_registry(reg)


def unregister_nickname(nick: str):
    reg = get_nickname_registry()
    key = normalize_nick(nick)
    if key in reg:
        del reg[key]
        save_nickname_registry(reg)


def add_nickname_to_user(user_id: int, nick: str) -> bool:
    """Добавляет ник пользователю (если < 2). Возвращает успех."""
    user = get_user(user_id)
    nicks = user.get("nicknames", [])
    if len(nicks) >= 2:
        return False
    if nick in nicks:
        return False
    nicks.append(nick)
    user["nicknames"] = nicks[:2]
    save_user(user_id, user)
    register_nickname(nick, user_id)
    return True


def remove_nickname_from_user(user_id: int, nick: str):
    user = get_user(user_id)
    nicks = user.get("nicknames", [])
    if nick in nicks:
        nicks.remove(nick)
    user["nicknames"] = nicks
    save_user(user_id, user)
    unregister_nickname(nick)


# === Маркет ===
def list_market() -> list[tuple[str, dict]]:
    market = get_nickname_market()
    # Возвращаем список (nick, data) отсортированный по цене
    items = [(nick, data) for nick, data in market.items()]
    items.sort(key=lambda x: x[1].get("price", 0))
    return items


def put_nickname_on_market(user_id: int, nick: str, price: int) -> bool:
    """Выставляет ник пользователя на маркет. Возвращает успех."""
    user = get_user(user_id)
    if nick not in user.get("nicknames", []):
        return False
    if price < 1:
        return False

    # Убираем из списка пользователя (но реестр оставляем до продажи)
    remove_nickname_from_user(user_id, nick)  # это также уберёт из реестра

    # Но мы хотим, чтобы до продажи он всё ещё "принадлежал" для отображения?
    # По ТЗ: пока на маркете — продавец может его использовать?
    # Решение: при выставлении на маркет ник УБИРАЕТСЯ из nicknames продавца,
    # но мы запомним продавца в market. Пока не куплен — никто не владеет для display.
    # (Пользователь сам решает, когда продавать.)

    market = get_nickname_market()
    market[nick] = {
        "seller_id": int(user_id),
        "price": int(price),
        "listed_at": datetime.now().isoformat()
    }
    save_nickname_market(market)

    # Важно: реестр уже почистили в remove_nickname_from_user.
    # Если хотим, чтобы продавец продолжал видеть ник в профиле пока он на продаже — можно не unregister.
    # Но по логике "выставил на маркет" — он больше не владеет.
    # Оставим как есть: при продаже на маркет ник уходит от продавца сразу.
    return True


def buy_nickname_from_market(buyer_id: int, nick: str) -> tuple[bool, str]:
    """
    Покупка ника с маркета.
    Возвращает (успех, сообщение)
    """
    market = get_nickname_market()
    if nick not in market:
        return False, "Этот никнейм уже продан или снят с продажи."

    listing = market[nick]
    seller_id = listing["seller_id"]
    price = listing["price"]

    if seller_id == buyer_id:
        return False, "Нельзя купить свой же никнейм."

    buyer = get_user(buyer_id)
    if len(get_user_nicknames(buyer, buyer_id)) >= 2:
        return False, "У тебя уже максимум 2 никнейма. Освободи место, прежде чем покупать новый."

    if buyer["balance"] < price:
        return False, f"Недостаточно кристаллов на руках. Нужно {fmt(price)} {CURRENCY}."

    # Списываем деньги
    buyer["balance"] -= price
    save_user(buyer_id, buyer)

    # Переводим продавцу
    if seller_id:
        try:
            seller = get_user(seller_id)
            seller["balance"] += price
            save_user(seller_id, seller)
        except:
            pass

    # Удаляем с маркета
    del market[nick]
    save_nickname_market(market)

    # Присваиваем покупателю
    success = add_nickname_to_user(buyer_id, nick)
    if not success:
        # На всякий случай вернём деньги (маловероятно)
        buyer = get_user(buyer_id)
        buyer["balance"] += price
        save_user(buyer_id, buyer)
        return False, "Не удалось присвоить никнейм (внутренняя ошибка). Деньги возвращены."

    return True, f"✅ Никнейм <b>{nick}</b> теперь твой!"


# === Меню ===
def nickname_menu_text(user_id: int) -> str:
    user = get_user(user_id)
    nicks = get_user_nicknames(user, user_id)
    total = get_user_total_balance(user)

    lines = [
        "🏷 <b>НИКНЕЙМЫ</b>\n",
        f"💰 Общий баланс: <b>{fmt(total)} {CURRENCY}</b>",
        f"Стоимость создания: <b>{fmt(calculate_nickname_cost(user))} {CURRENCY}</b> (35%)",
        f"Максимум никнеймов: <b>2</b>\n",
    ]

    if nicks:
        lines.append("<b>Твои никнеймы:</b>")
        for n in nicks:
            lines.append(f"  • <b>{n}</b>")
    else:
        lines.append("У тебя пока нет уникальных никнеймов.")

    lines.append("\nНикнеймы отображаются в профиле и во всех играх вместо обычного имени.")
    return "\n".join(lines)


def nickname_menu_kb(user_id: int) -> types.InlineKeyboardMarkup:
    user = get_user(user_id)
    nicks = get_user_nicknames(user, user_id)
    kb = types.InlineKeyboardMarkup(row_width=1)

    if len(nicks) < 2:
        kb.add(types.InlineKeyboardButton("➕ Создать никнейм", callback_data="nick_create"))
    else:
        kb.add(types.InlineKeyboardButton("✅ У тебя уже 2 никнейма", callback_data="nick_max"))

    if nicks:
        kb.add(types.InlineKeyboardButton("📤 Выставить ник на маркет", callback_data="nick_sell_menu"))

    kb.add(types.InlineKeyboardButton("🛒 Открыть маркет никнеймов", callback_data="nick_market"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="profile"))
    return kb


@bot.callback_query_handler(func=lambda c: c.data == "nickname_menu")
def nickname_menu(c):
    user_id = c.from_user.id
    text = nickname_menu_text(user_id)
    kb = nickname_menu_kb(user_id)
    try:
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    except:
        bot.send_message(c.message.chat.id, text, reply_markup=kb)


# === Создание никнейма ===
@bot.callback_query_handler(func=lambda c: c.data == "nick_create")
def nick_create_start(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    current_nicks = get_user_nicknames(user, user_id)  # с восстановлением

    if len(current_nicks) >= 2:
        bot.answer_callback_query(c.id, "У тебя уже 2 никнейма!", show_alert=True)
        return

    cost = calculate_nickname_cost(user)
    total = get_user_total_balance(user)

    if total < cost:
        bot.answer_callback_query(c.id, f"Нужно минимум {fmt(cost)} {CURRENCY} (35% от общего баланса).", show_alert=True)
        return

    bot_instance.pending_nickname_create[user_id] = {
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id,
        "cost": cost
    }

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="nickname_menu"))

    bot.edit_message_text(
        f"🏷 <b>Создание никнейма</b>\n\n"
        f"Стоимость: <b>{fmt(cost)} {CURRENCY}</b> (35% от твоего общего баланса)\n"
        f"Текущий общий баланс: <b>{fmt(total)} {CURRENCY}</b>\n\n"
        f"Введи желаемый никнейм в ответ на это сообщение.\n"
        f"Правила:\n"
        f"• 3–16 символов\n"
        f"• Буквы, цифры, _, -, .\n"
        f"• Не начинать/заканчивать на спецсимволы\n"
        f"• Уникальный (никто другой не должен иметь такой же)",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


def handle_nickname_create_input(message):
    """Вызывается из text_command_handler когда пользователь в pending_nickname_create"""
    user_id = message.from_user.id
    state = bot_instance.pending_nickname_create.get(user_id)
    if not state:
        return False

    nick = message.text.strip()
    ok, err = is_valid_nickname(nick)
    if not ok:
        bot.reply_to(message, f"❌ {err}\nПопробуй ещё раз или нажми Отмена.")
        return True

    if is_nickname_taken(nick):
        bot.reply_to(message, "❌ Такой никнейм уже занят другим игроком. Выбери другой.")
        return True

    cost = state.get("cost", 0)
    user = get_user(user_id)
    total = get_user_total_balance(user)
    if total < cost:
        bot.reply_to(message, "❌ Недостаточно средств (баланс изменился).")
        if user_id in bot_instance.pending_nickname_create:
            del bot_instance.pending_nickname_create[user_id]
        return True

    # Списание (сначала с рук, потом из банка)
    remaining = cost
    if user["balance"] >= remaining:
        user["balance"] -= remaining
        remaining = 0
    else:
        remaining -= user["balance"]
        user["balance"] = 0
        user["bank_balance"] = max(0, user.get("bank_balance", 0) - remaining)

    # Сохраняем списание стоимости ДО добавления ника
    save_user(user_id, user)

    # Присваиваем ник (add сам загрузит свежие данные, добавит и сохранит)
    if not add_nickname_to_user(user_id, nick):
        # откат стоимости
        fresh = get_user(user_id)
        fresh["balance"] += cost
        save_user(user_id, fresh)
        bot.reply_to(message, "❌ Не удалось добавить никнейм (внутренняя ошибка). Деньги возвращены.")
        if user_id in bot_instance.pending_nickname_create:
            del bot_instance.pending_nickname_create[user_id]
        return True

    # Успех. Не делаем повторный save_user здесь — он бы перезаписал список никнеймов старой версией объекта.
    if user_id in bot_instance.pending_nickname_create:
        del bot_instance.pending_nickname_create[user_id]

    fresh_user = get_user(user_id)

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("🏷 К никнеймам", callback_data="nickname_menu"))
    kb.add(types.InlineKeyboardButton("👤 Профиль", callback_data="profile"))

    bot.reply_to(
        message,
        f"🎉 <b>Никнейм создан!</b>\n\n"
        f"<b>{nick}</b> теперь твой.\n"
        f"Списано: <b>{fmt(cost)} {CURRENCY}</b>\n\n"
        f"В профиле и играх ты будешь отображаться как <b>{get_display_name(fresh_user, user_id)}</b>.",
        reply_markup=kb
    )
    return True


# === Выставление на маркет ===
@bot.callback_query_handler(func=lambda c: c.data == "nick_sell_menu")
def nick_sell_menu(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    nicks = get_user_nicknames(user, user_id)

    if not nicks:
        bot.answer_callback_query(c.id, "У тебя нет никнеймов для продажи.", show_alert=True)
        return

    kb = types.InlineKeyboardMarkup(row_width=1)
    for n in nicks:
        kb.add(types.InlineKeyboardButton(f"📤 {n}", callback_data=f"nick_sell_choose_{n}"))
    kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="nickname_menu"))

    bot.edit_message_text(
        "📤 <b>Выбери никнейм для продажи на маркете</b>\n\n"
        "После продажи ник сразу перейдёт покупателю.\n"
        "Ты получишь указанную сумму на баланс.",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


@bot.callback_query_handler(func=lambda c: c.data.startswith("nick_sell_choose_"))
def nick_sell_choose(c):
    user_id = c.from_user.id
    nick = c.data.replace("nick_sell_choose_", "")

    user = get_user(user_id)
    if nick not in user.get("nicknames", []):
        bot.answer_callback_query(c.id, "Этот никнейм тебе больше не принадлежит.", show_alert=True)
        nickname_menu(c)
        return

    bot_instance.pending_nickname_sell[user_id] = {"nick": nick}

    kb = types.InlineKeyboardMarkup(row_width=2)
    quick = [1000000, 5000000, 25000000, 100000000, 500000000]
    for p in quick:
        kb.add(types.InlineKeyboardButton(fmt(p), callback_data=f"nick_sell_price_{p}"))
    kb.add(types.InlineKeyboardButton("✏️ Своя цена", callback_data="nick_sell_custom_price"))
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="nickname_menu"))

    bot.edit_message_text(
        f"📤 <b>Продажа никнейма</b>\n\n"
        f"Ник: <b>{nick}</b>\n\n"
        f"Укажи цену, за которую хочешь продать:",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


@bot.callback_query_handler(func=lambda c: c.data.startswith("nick_sell_price_"))
def nick_sell_price(c):
    user_id = c.from_user.id
    state = bot_instance.pending_nickname_sell.get(user_id)
    if not state:
        nickname_menu(c)
        return

    nick = state["nick"]
    try:
        price = int(c.data.split("_")[-1])
    except:
        price = 1000000

    success = put_nickname_on_market(user_id, nick, price)
    if user_id in bot_instance.pending_nickname_sell:
        del bot_instance.pending_nickname_sell[user_id]

    if success:
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("🛒 Посмотреть маркет", callback_data="nick_market"))
        kb.add(types.InlineKeyboardButton("🏷 К никнеймам", callback_data="nickname_menu"))
        bot.edit_message_text(
            f"✅ Никнейм <b>{nick}</b> выставлен на маркет за <b>{fmt(price)} {CURRENCY}</b>.\n\n"
            f"Как только кто-то купит — он сразу перейдёт к покупателю, а деньги придут тебе на баланс.",
            c.message.chat.id, c.message.message_id, reply_markup=kb
        )
    else:
        bot.edit_message_text("❌ Не удалось выставить никнейм.", c.message.chat.id, c.message.message_id)
        nickname_menu(c)


@bot.callback_query_handler(func=lambda c: c.data == "nick_sell_custom_price")
def nick_sell_custom(c):
    user_id = c.from_user.id
    state = bot_instance.pending_nickname_sell.get(user_id)
    if not state:
        nickname_menu(c)
        return

    bot_instance.pending_nickname_sell[user_id]["awaiting_price"] = True

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="nickname_menu"))

    bot.edit_message_text(
        f"✏️ Введи цену продажи для никнейма <b>{state['nick']}</b> (в кристаллах).\n"
        f"Можно писать 1к, 5кк и т.д.",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


def handle_nickname_sell_price_input(message):
    """Обработка ручного ввода цены продажи"""
    user_id = message.from_user.id
    state = bot_instance.pending_nickname_sell.get(user_id)
    if not state or not state.get("awaiting_price"):
        return False

    nick = state.get("nick")
    price = parse_amount_from_text(message.text)  # локальная обёртка ниже
    if price is None or price < 1:
        bot.reply_to(message, "❌ Неверная цена. Введи число (например 5000000 или 5кк).")
        return True

    success = put_nickname_on_market(user_id, nick, price)
    if user_id in bot_instance.pending_nickname_sell:
        del bot_instance.pending_nickname_sell[user_id]

    if success:
        kb = types.InlineKeyboardMarkup()
        kb.add(types.InlineKeyboardButton("🛒 Открыть маркет", callback_data="nick_market"))
        kb.add(types.InlineKeyboardButton("🏷 К моим никнеймам", callback_data="nickname_menu"))
        bot.reply_to(
            message,
            f"✅ <b>{nick}</b> выставлен на маркет за <b>{fmt(price)} {CURRENCY}</b>.",
            reply_markup=kb
        )
    else:
        bot.reply_to(message, "❌ Не удалось выставить на продажу.")
    return True


def parse_amount_from_text(text: str):
    from core.utils import parse_amount
    return parse_amount(text)


# === Маркет покупок ===
@bot.callback_query_handler(func=lambda c: c.data == "nick_market")
def nick_market(c):
    items = list_market()

    kb = types.InlineKeyboardMarkup(row_width=1)
    if not items:
        text = "🛒 <b>Маркет никнеймов</b>\n\nПока нет никнеймов на продаже.\nБудь первым, кто выставит редкий ник!"
        kb.add(types.InlineKeyboardButton("🏷 К моим никнеймам", callback_data="nickname_menu"))
    else:
        text = "🛒 <b>Маркет никнеймов</b>\n\nВыбери никнейм для покупки:\n"
        for nick, data in items[:20]:  # ограничиваем
            price = data.get("price", 0)
            kb.add(types.InlineKeyboardButton(f"{nick} — {fmt(price)} {CURRENCY}", callback_data=f"nick_buy_{nick}"))
        kb.add(types.InlineKeyboardButton("◀️ Назад", callback_data="nickname_menu"))

    try:
        bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
    except:
        bot.send_message(c.message.chat.id, text, reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data.startswith("nick_buy_"))
def nick_buy_confirm(c):
    user_id = c.from_user.id
    nick = c.data.replace("nick_buy_", "")

    market = get_nickname_market()
    if nick not in market:
        bot.answer_callback_query(c.id, "Ник уже продан.", show_alert=True)
        nick_market(c)
        return

    listing = market[nick]
    price = listing["price"]

    buyer = get_user(user_id)
    if len(get_user_nicknames(buyer, user_id)) >= 2:
        bot.answer_callback_query(c.id, "У тебя уже 2 никнейма. Сначала освободи слот.", show_alert=True)
        return

    if buyer["balance"] < price:
        bot.answer_callback_query(c.id, f"Нужно {fmt(price)} {CURRENCY} на руках.", show_alert=True)
        return

    # Подтверждение
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("✅ Купить", callback_data=f"nick_buy_confirm_{nick}"),
        types.InlineKeyboardButton("❌ Отмена", callback_data="nick_market"),
    )

    bot.edit_message_text(
        f"🛒 <b>Покупка никнейма</b>\n\n"
        f"Ник: <b>{nick}</b>\n"
        f"Цена: <b>{fmt(price)} {CURRENCY}</b>\n\n"
        f"После покупки ник <b>сразу</b> станет твоим и будет отображаться в профиле и играх.\n"
        f"Продавец получит деньги.\n\n"
        f"Продолжить?",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )


@bot.callback_query_handler(func=lambda c: c.data.startswith("nick_buy_confirm_"))
def nick_buy_do(c):
    user_id = c.from_user.id
    nick = c.data.replace("nick_buy_confirm_", "")

    success, msg = buy_nickname_from_market(user_id, nick)

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("🏷 К моим никнеймам", callback_data="nickname_menu"))
    kb.add(types.InlineKeyboardButton("👤 Профиль", callback_data="profile"))

    if success:
        bot.edit_message_text(
            f"🎉 <b>Покупка успешна!</b>\n\n{msg}\n\n"
            f"Теперь в профиле ты отображаешься как <b>{get_display_name(get_user(user_id), user_id)}</b>.",
            c.message.chat.id, c.message.message_id, reply_markup=kb
        )
    else:
        bot.edit_message_text(f"❌ {msg}", c.message.chat.id, c.message.message_id, reply_markup=kb)


# === Служебная функция для текстовых команд ===
def handle_nickname_text_commands(message) -> bool:
    """
    Возвращает True, если сообщение было обработано как команда по никнеймам.
    Вызывается из text_command_handler.
    """
    txt = (message.text or "").strip().lower()
    user_id = message.from_user.id

    # Быстрые текстовые входы
    if txt in ["ник", "никнейм", "никнеймы", "nicks"]:
        fake = make_fake_callback(message.from_user, message.chat.id, message.message_id)
        fake.data = "nickname_menu"
        nickname_menu(fake)
        return True

    if txt in ["ник маркет", "маркет ник", "никмаркет", "market nicks"]:
        fake = make_fake_callback(message.from_user, message.chat.id, message.message_id)
        fake.data = "nick_market"
        nick_market(fake)
        return True

    # Создать ник "ник создать CoolName" или просто после pending
    if txt.startswith("ник создать ") or txt.startswith("создать ник "):
        # Простая поддержка прямого создания
        parts = message.text.split(maxsplit=2)
        if len(parts) >= 3:
            nick = parts[2].strip()
            user = get_user(user_id)
            current_nicks = get_user_nicknames(user, user_id)
            if len(current_nicks) >= 2:
                bot.reply_to(message, "У тебя уже 2 никнейма.")
                return True
            ok, err = is_valid_nickname(nick)
            if not ok:
                bot.reply_to(message, f"❌ {err}")
                return True
            if is_nickname_taken(nick):
                bot.reply_to(message, "❌ Ник уже занят.")
                return True
            cost = calculate_nickname_cost(user)
            total = get_user_total_balance(user)
            if total < cost:
                bot.reply_to(message, f"❌ Нужно {fmt(cost)} {CURRENCY} (35% от общего баланса).")
                return True
            # списание
            remaining = cost
            if user["balance"] >= remaining:
                user["balance"] -= remaining
            else:
                remaining -= user["balance"]
                user["balance"] = 0
                user["bank_balance"] = max(0, user.get("bank_balance", 0) - remaining)

            # Сохраняем списание
            save_user(user_id, user)

            # Добавляем ник (add сам сохранит)
            created = add_nickname_to_user(user_id, nick)
            if not created:
                # откат (маловероятно)
                fresh = get_user(user_id)
                fresh["balance"] += cost
                save_user(user_id, fresh)
                bot.reply_to(message, "❌ Не удалось создать никнейм (достигнут лимит или ошибка). Деньги возвращены.")
                return True

            bot.reply_to(message, f"✅ Никнейм <b>{nick}</b> создан за {fmt(cost)} {CURRENCY}.")
            return True
        else:
            bot.reply_to(message, "Формат: <code>ник создать CoolName</code>")
            return True

    return False
