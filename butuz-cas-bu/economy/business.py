from datetime import datetime
import random
from telebot import types
from config import BUSINESSES, BUSINESS_TASK_COOLDOWN, CURRENCY
from bot_instance import bot
from core.database import get_user, save_user
from core.utils import fmt


def _ensure_business_ids():
    """Ensure each business has explicit 'id' field (as requested)."""
    for bid, b in BUSINESSES.items():
        if isinstance(b, dict) and "id" not in b:
            b["id"] = bid


_ensure_business_ids()


def get_business_income_per_hour(biz_id: int) -> tuple:
    b = BUSINESSES.get(biz_id)
    if not b: return 0, 0
    return b["income_min"], b["income_max"]

def business_task_available(user: dict, biz_id: int, task_id: str) -> tuple:
    key = f"{biz_id}_{task_id}"
    last = user.get("businesses", {}).get(str(biz_id), {}).get(f"task_{task_id}_last")
    if not last: return True, 0
    elapsed = (datetime.now() - datetime.fromisoformat(last)).total_seconds()
    if elapsed >= BUSINESS_TASK_COOLDOWN: return True, 0
    remaining = int(BUSINESS_TASK_COOLDOWN - elapsed)
    return False, remaining

def user_owns_business(user: dict, biz_id: int) -> bool:
    b = user.get("businesses", {}).get(str(biz_id))
    return bool(b) and not b.get("sold_at")

def business_menu_text(user_id: int) -> str:
    user = get_user(user_id)
    owned = {bid: data for bid, data in user.get("businesses", {}).items() if not data.get("sold_at")}
    total_income_min = sum(BUSINESSES[int(bid)]["income_min"] for bid in owned if int(bid) in BUSINESSES)
    total_income_max = sum(BUSINESSES[int(bid)]["income_max"] for bid in owned if int(bid) in BUSINESSES)
    text = (
        f"🏢 <b>МОИ БИЗНЕСЫ</b>\n\n"
        f"💎 Баланс: <b>{fmt(user['balance'])} {CURRENCY}</b>\n"
        f"🏭 Куплено бизнесов: <b>{len(owned)}/{len(BUSINESSES)}</b>\n"
        f"💰 Доход/час: <b>{fmt(total_income_min)}–{fmt(total_income_max)} {CURRENCY}</b>\n\n"
        f"Выбери бизнес для управления (или используй команды: <code>бизнес купить 1</code> / <code>бизнес продать 3</code>):"
    )
    return text

def business_menu_kb(user_id: int) -> types.InlineKeyboardMarkup:
    user = get_user(user_id)
    owned_raw = user.get("businesses", {})
    kb = types.InlineKeyboardMarkup(row_width=2)
    buttons = []
    for biz_id, biz in BUSINESSES.items():
        data = owned_raw.get(str(biz_id), {})
        is_owned = bool(data) and not data.get("sold_at")
        mark = "✅ " if is_owned else "🔒 "
        buttons.append(types.InlineKeyboardButton(f"{mark}{biz_id}. {biz['emoji']} {biz['name']}", callback_data=f"biz_view_{biz_id}"))
    kb.add(*buttons)
    kb.add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))
    return kb

@bot.callback_query_handler(func=lambda c: c.data == "business_menu")
def business_menu_handler(c):
    user_id = c.from_user.id
    bot.edit_message_text(business_menu_text(user_id), c.message.chat.id, c.message.message_id, reply_markup=business_menu_kb(user_id))

@bot.callback_query_handler(func=lambda c: c.data.startswith("biz_view_"))
def biz_view_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    biz_id = int(c.data.split("_")[-1])
    biz = BUSINESSES[biz_id]

    is_owned = user_owns_business(user, biz_id)
    kb = types.InlineKeyboardMarkup(row_width=1)

    if not is_owned:
        text = (
            f"{biz['emoji']} <b>{biz['name']}</b> (ID: {biz_id})\n\n"
            f"Вы ещё не владеете этим бизнесом.\n\n"
            f"💰 Цена покупки: <b>{fmt(biz['price'])} {CURRENCY}</b>\n"
            f"📈 Пассивный доход: <b>{fmt(biz['income_min'])}–{fmt(biz['income_max'])} {CURRENCY}/час</b>"
        )
        kb.add(types.InlineKeyboardButton(f"🛒 Купить бизнес за {fmt(biz['price'])} {CURRENCY}", callback_data=f"biz_buy_{biz_id}"))
    else:
        text = (
            f"{biz['emoji']} <b>УПРАВЛЕНИЕ: {biz['name']}</b> (ID: {biz_id})\n\n"
            f"📈 Ваш доход с этого бизнеса: <b>{fmt(biz['income_min'])}–{fmt(biz['income_max'])} {CURRENCY}/час</b>\n\n"
            f"📋 <b>Ежечасные задачи:</b>\n"
            f"Выполняйте поручения чтобы получить моментальный доход!"
        )
        for t in biz["tasks"]:
            avail, sec = business_task_available(user, biz_id, t["id"])
            btn_text = t["name"] if avail else f"⏳ {t['name']} ({sec//60}м)"
            kb.add(types.InlineKeyboardButton(btn_text, callback_data=f"biz_task_{biz_id}_{t['id']}"))

        # Sell button
        refund = int(biz["price"] * 0.7)
        kb.add(types.InlineKeyboardButton(f"💰 Продать за {fmt(refund)} {CURRENCY} (70%)", callback_data=f"biz_sell_{biz_id}"))

    kb.add(types.InlineKeyboardButton("◀️ Назад к списку", callback_data="business_menu"))
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data.startswith("biz_buy_"))
def biz_buy_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    biz_id = int(c.data.split("_")[-1])

    if biz_id not in BUSINESSES:
        bot.answer_callback_query(c.id, "❌ Такого бизнеса не существует!", show_alert=True)
        return
    biz = BUSINESSES[biz_id]

    if user_owns_business(user, biz_id): return

    if user["balance"] < biz["price"]:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    user["balance"] -= biz["price"]
    businesses = user.setdefault("businesses", {})
    existing = businesses.get(str(biz_id))
    if existing and existing.get("sold_at"):
        # rebuy after sell: keep cooldown history, just restore ownership
        existing["bought_at"] = datetime.now().isoformat()
        existing.pop("sold_at", None)
    else:
        businesses[str(biz_id)] = {"bought_at": datetime.now().isoformat()}
    save_user(user_id, user)

    try:
        bot.answer_callback_query(c.id, f"🎉 Вы купили бизнес {biz['name']}!")
    except:
        pass

    try:
        biz_view_handler(c)
    except Exception:
        bot.send_message(c.message.chat.id, f"🎉 Вы купили бизнес {biz['name']}!\n\nИспользуйте <code>бизнес</code> чтобы посмотреть.")
        return


@bot.callback_query_handler(func=lambda c: c.data.startswith("biz_sell_"))
def biz_sell_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    biz_id = int(c.data.split("_")[-1])

    if biz_id not in BUSINESSES:
        bot.answer_callback_query(c.id, "❌ Такого бизнеса не существует!", show_alert=True)
        return
    if not user_owns_business(user, biz_id):
        bot.answer_callback_query(c.id, "❌ Вы не владеете этим бизнесом!", show_alert=True)
        return

    biz = BUSINESSES[biz_id]
    refund = int(biz["price"] * 0.7)

    # Mark as sold but KEEP cooldown timestamps so rebuy doesn't reset КД
    businesses = user.setdefault("businesses", {})
    if str(biz_id) in businesses:
        businesses[str(biz_id)]["sold_at"] = datetime.now().isoformat()

    user["balance"] += refund
    save_user(user_id, user)

    try:
        bot.answer_callback_query(c.id, f"✅ Бизнес продан за {fmt(refund)} {CURRENCY}!")
    except:
        pass

    # Confirmation for text commands (fake c) + try edit for button flow
    confirmation = f"✅ Бизнес {biz['name']} продан за {fmt(refund)} {CURRENCY}!"
    try:
        business_menu_handler(c)
    except Exception:
        bot.send_message(c.message.chat.id, confirmation + "\n\nИспользуйте <code>бизнес</code> для списка.")
        return
    # For real callbacks, the menu edit already happened above; for text we sent via exception path.


@bot.callback_query_handler(func=lambda c: c.data == "biz_cant_buy")
def biz_cant_buy(c):
    bot.answer_callback_query(c.id, "❌ Недостаточно средств на балансе!", show_alert=True)

@bot.callback_query_handler(func=lambda c: c.data.startswith("biz_task_"))
def biz_task_handler(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    parts = c.data.split("_")
    biz_id = int(parts[2])
    task_id = parts[3]

    biz = BUSINESSES[biz_id]
    task = next(t for t in biz["tasks"] if t["id"] == task_id)

    avail, sec = business_task_available(user, biz_id, task_id)
    if not avail:
        bot.answer_callback_query(c.id, f"⏳ Задача недоступна! Подождите {sec//60} мин. {sec%60} сек.", show_alert=True)
        return

    reward = random.randint(biz["income_min"], biz["income_max"])
    user["balance"] += reward
    user["businesses"][str(biz_id)][f"task_{task_id}_last"] = datetime.now().isoformat()
    save_user(user_id, user)

    bot.answer_callback_query(c.id, f"✅ Выполнено! Получено +{fmt(reward)} {CURRENCY}")
    biz_view_handler(c)
