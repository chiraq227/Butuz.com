import random
from telebot import types
from config import CURRENCY
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from users.user_management import update_balance
from core.utils import fmt

def new_deck():
    suits = ["♠️", "♥️", "♦️", "♣️"]
    ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
    deck = [{"rank": r, "suit": s} for r in ranks for s in suits]
    random.shuffle(deck)
    return deck

def card_str(card):
    return f"{card['rank']}{card['suit']}"

def hand_value(hand):
    val = 0
    aces = 0
    for c in hand:
        r = c["rank"]
        if r.isdigit(): val += int(r)
        elif r in ["J", "Q", "K"]: val += 10
        else: aces += 1
    for _ in range(aces):
        if val + 11 <= 21: val += 11
        else: val += 1
    return val

def hand_str(hand):
    return " ".join(card_str(c) for c in hand)

@bot.callback_query_handler(func=lambda c: c.data == "game_blackjack")
def bj_menu(c):
    from interface.betting import show_bet_menu
    show_bet_menu(c, "blackjack")

@bot.callback_query_handler(func=lambda c: c.data.startswith("play_blackjack_"))
def play_blackjack(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    bet = int(c.data.split("_")[-1])

    if user["balance"] < bet:
        bot.answer_callback_query(c.id, "❌ Недостаточно средств!", show_alert=True)
        return

    # Запоминаем ставку
    user["last_bet"] = bet
    save_user(user_id, user)

    update_balance(user_id, -bet)

    deck = new_deck()
    p_hand = [deck.pop(), deck.pop()]
    d_hand = [deck.pop(), deck.pop()]

    bot_instance.active_games[user_id] = {
        "game": "blackjack",
        "bet": bet,                    # base bet per hand
        "deck": deck,
        "player_hands": [{"cards": p_hand, "bet": bet, "stood": False, "busted": False}],
        "current_hand": 0,
        "d_hand": d_hand,
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }

    p_val = hand_value(p_hand)
    if p_val == 21:
        bj_finish(c, user_id, natural=True)
        return

    bj_text(c, user_id)


def start_blackjack_direct(chat_id: int, user_id: int, bet: int):
    """Прямой запуск блэкджека из текстовой команды."""
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

    deck = new_deck()
    p_hand = [deck.pop(), deck.pop()]
    d_hand = [deck.pop(), deck.pop()]

    bot_instance.active_games[user_id] = {
        "game": "blackjack",
        "bet": bet,
        "deck": deck,
        "player_hands": [{"cards": p_hand, "bet": bet, "stood": False, "busted": False}],
        "current_hand": 0,
        "d_hand": d_hand,
        "chat_id": chat_id,
        "message_id": None
    }

    p_val = hand_value(p_hand)
    if p_val == 21:
        # Для натурального блэкджека нужно чуть адаптировать, используем упрощённый ответ
        win = int(bet * 2.5)
        new_balance = update_balance(user_id, win)
        kb = types.InlineKeyboardMarkup(row_width=2)
        kb.add(types.InlineKeyboardButton("🔄 Снова", callback_data=f"play_blackjack_{bet}"),
               types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))
        bot.send_message(
            chat_id,
            f"🃏 <b>БЛЭКДЖЕК — НАТУРАЛЬНЫЙ!</b>\n\n"
            f"У вас 21 с первых двух карт!\n"
            f"Выигрыш: <b>+{fmt(win - bet)} {CURRENCY}</b> (x2.5)\n"
            f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>",
            reply_markup=kb
        )
        del bot_instance.active_games[user_id]
        return

    # Обычная раздача — отправляем экран
    g = bot_instance.active_games[user_id]
    text = (
        f"🃏 <b>БЛЭКДЖЕК</b>\n\n"
        f"💰 Ставка: <b>{fmt(g['bet'])} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"Ваши карты: {hand_str(p_hand)} (сумма {p_val})\n"
        f"Карта дилера: {card_str(d_hand[0])} + ?\n\n"
        f"Выберите действие:"
    )
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("➕ Взять", callback_data=f"bj_hit_{user_id}"),
        types.InlineKeyboardButton("🛑 Хватит", callback_data=f"bj_stand_{user_id}"),
    )
    # Дабл и Сплит кнопки (если хватает баланса)
    if len(p_hand) == 2:
        kb = types.InlineKeyboardMarkup(row_width=2)
        kb.add(
            types.InlineKeyboardButton("➕ Взять", callback_data=f"bj_hit_{user_id}"),
            types.InlineKeyboardButton("🛑 Хватит", callback_data=f"bj_stand_{user_id}"),
        )
        if user["balance"] >= bet:
            kb.add(types.InlineKeyboardButton("✖️ Дабл", callback_data=f"bj_double_{user_id}"))
        if p_hand[0]["rank"] == p_hand[1]["rank"] and user["balance"] >= bet:
            kb.add(types.InlineKeyboardButton("🔀 Сплит", callback_data=f"bj_split_{user_id}"))
    sent = bot.send_message(chat_id, text, reply_markup=kb)
    bot_instance.active_games[user_id]["message_id"] = sent.message_id


def bj_text(c, user_id):
    g = bot_instance.active_games[user_id]
    hands = g.get("player_hands", [{"cards": g.get("p_hand", []), "bet": g["bet"]}])
    cur = g.get("current_hand", 0)
    cur_hand = hands[cur] if cur < len(hands) else hands[0]
    cur_cards = cur_hand.get("cards", [])
    cur_bet = cur_hand.get("bet", g["bet"])

    # Показываем все руки если сплит
    hands_text = ""
    if len(hands) > 1:
        for i, h in enumerate(hands):
            marker = "▶ " if i == cur else "   "
            hands_text += f"{marker}Рука {i+1}: {hand_str(h['cards'])} ({hand_value(h['cards'])} от.) — {fmt(h['bet'])}\n"
    else:
        hands_text = f"👤 Ваша рука: <b>{hand_str(cur_cards)}</b> ({hand_value(cur_cards)} от.)\n"

    text = (
        f"🃏 <b>БЛЭКДЖЕК</b>\n\n"
        f"💰 Базовая ставка: <b>{fmt(g['bet'])} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"{hands_text}"
        f"🤵 Рука дилера: <b>{card_str(g['d_hand'][0])} 🎴</b> (??)\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"Выберите действие:"
    )

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🃏 Ещё (Hit)", callback_data=f"bj_hit_{user_id}"),
        types.InlineKeyboardButton("🛑 Хватит (Stand)", callback_data=f"bj_stand_{user_id}"),
    )

    # Дабл и Сплит (только когда уместно)
    ch = hands[cur] if cur < len(hands) else hands[0]
    if len(ch.get("cards", [])) == 2 and not ch.get("stood"):
        if g.get("bet", 0) and get_user(user_id)["balance"] >= ch.get("bet", g["bet"]):
            kb.add(types.InlineKeyboardButton("✖️ Дабл", callback_data=f"bj_double_{user_id}"))
        if len(hands) == 1 and ranks_equal_for_bot(ch["cards"][0], ch["cards"][1]) and get_user(user_id)["balance"] >= g["bet"]:
            kb.add(types.InlineKeyboardButton("🔀 Сплит", callback_data=f"bj_split_{user_id}"))

    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)


def ranks_equal_for_bot(a, b):
    return a and b and a.get("rank") == b.get("rank")


def _advance_bot_hand(g):
    """Переключает current_hand на следующую не завершённую. Возвращает True если все руки закончены."""
    hands = g.get("player_hands", [])
    cur = g.get("current_hand", 0)
    for i in range(cur + 1, len(hands)):
        h = hands[i]
        if not h.get("stood") and not h.get("busted"):
            g["current_hand"] = i
            return False  # ещё есть руки
    g["current_hand"] = len(hands)
    return True  # все руки завершены

@bot.callback_query_handler(func=lambda c: c.data.startswith("bj_action_") or c.data.startswith("bj_hit_") or c.data.startswith("bj_stand_") or c.data.startswith("bj_double_") or c.data.startswith("bj_split_"))
def bj_action(c):
    parts = c.data.split("_")
    action = parts[1]
    uid = int(parts[2])

    if c.from_user.id != uid: return
    if uid not in bot_instance.active_games: return

    g = bot_instance.active_games[uid]
    hands = g.get("player_hands", [])
    cur = g.get("current_hand", 0)
    if not hands:
        # legacy fallback
        hands = [{"cards": g.get("p_hand", []), "bet": g["bet"], "stood": False, "busted": False}]
        g["player_hands"] = hands
        g["current_hand"] = 0
        cur = 0

    hand = hands[cur] if cur < len(hands) else hands[0]

    if action == "hit":
        if hand.get("splitAces"):
            bot.answer_callback_query(c.id, "При сплите тузов нельзя добирать", show_alert=True)
            return
        hand["cards"].append(g["deck"].pop())
        if hand_value(hand["cards"]) > 21:
            hand["busted"] = True
            hand["stood"] = True
            # перейти к следующей руке или финиш
            if not _advance_bot_hand(g):
                bj_finish(c, uid)
                return
        bot_instance.active_games[uid] = g
        bj_text(c, uid)

    elif action == "stand":
        hand["stood"] = True
        if not _advance_bot_hand(g):
            bj_finish(c, uid)
            return
        bot_instance.active_games[uid] = g
        bj_text(c, uid)

    elif action == "double":
        user = get_user(uid)
        if len(hand.get("cards", [])) != 2 or hand.get("stood") or hand.get("splitAces"):
            bot.answer_callback_query(c.id, "Дабл сейчас недоступен", show_alert=True)
            return
        if user["balance"] < hand["bet"]:
            bot.answer_callback_query(c.id, "Недостаточно средств для дабла", show_alert=True)
            return
        update_balance(uid, -hand["bet"])
        hand["bet"] *= 2
        hand["cards"].append(g["deck"].pop())
        hand["stood"] = True
        if not _advance_bot_hand(g):
            bj_finish(c, uid)
            return
        bot_instance.active_games[uid] = g
        bj_text(c, uid)

    elif action == "split":
        user = get_user(uid)
        if len(hand.get("cards", [])) != 2 or not ranks_equal_for_bot(hand["cards"][0], hand["cards"][1]) or hand.get("stood"):
            bot.answer_callback_query(c.id, "Сплит недоступен", show_alert=True)
            return
        if user["balance"] < g["bet"]:
            bot.answer_callback_query(c.id, "Недостаточно на второй сплит", show_alert=True)
            return
        update_balance(uid, -g["bet"])

        c1 = hand["cards"][0]
        c2 = hand["cards"][1]
        c1["_from_split"] = True
        c2["_from_split"] = True

        new1 = g["deck"].pop()
        new2 = g["deck"].pop()
        new1["_from_split"] = True
        new2["_from_split"] = True

        is_aces = c1["rank"] == "A"

        new_hands = [
            {"cards": [c1, new1], "bet": g["bet"], "stood": False, "busted": False, "wasSplit": True, "splitAces": is_aces},
            {"cards": [c2, new2], "bet": g["bet"], "stood": False, "busted": False, "wasSplit": True, "splitAces": is_aces},
        ]
        if is_aces:
            new_hands[0]["stood"] = True
            new_hands[1]["stood"] = True

        g["player_hands"] = new_hands
        g["current_hand"] = 0

        if is_aces:
            bj_finish(c, uid)
            return

        bot_instance.active_games[uid] = g
        bj_text(c, uid)

def bj_finish(c, user_id, bust=False, natural=False):
    g = bot_instance.active_games[user_id]
    base_bet = g["bet"]
    d_hand = g["d_hand"][:]

    hands = g.get("player_hands", [{"cards": g.get("p_hand", []), "bet": base_bet}])

    # Дилер добирает только один раз
    while hand_value(d_hand) < 17:
        d_hand.append(g["deck"].pop())
    d_val = hand_value(d_hand)
    dealer_bust = d_val > 21

    total_win = 0
    lines = []

    for i, h in enumerate(hands):
        cards = h.get("cards", [])
        h_bet = h.get("bet", base_bet)
        pv = hand_value(cards)

        if h.get("busted") or pv > 21:
            h_win = 0
            h_status = "Перебор"
        elif natural and i == 0 and len(hands) == 1:
            h_win = int(h_bet * 2.5)
            h_status = "Натуральный блэкджек!"
        else:
            if dealer_bust:
                mult = 2.5 if (len(cards) == 2 and pv == 21 and not h.get("wasSplit")) else 2
                h_win = int(h_bet * mult)
                h_status = "Дилер перебрал"
            elif pv > d_val:
                h_win = h_bet * 2
                h_status = "Победа"
            elif pv < d_val:
                h_win = 0
                h_status = "Проигрыш"
            else:
                h_win = h_bet
                h_status = "Ничья"

        total_win += h_win
        profit_line = f"+{fmt(h_win - h_bet)}" if h_win >= h_bet else f"-{fmt(h_bet - h_win)}"
        lines.append(f"Рука {i+1}: {hand_str(cards)} ({pv}) — {h_status} ({profit_line})")

    new_balance = update_balance(user_id, total_win)
    profit = total_win - sum(h.get("bet", base_bet) for h in hands)

    text = (
        f"🃏 <b>БЛЭКДЖЕК — ИТОГ</b>\n\n"
        f"🤵 Дилер: <b>{hand_str(d_hand)}</b> ({d_val} от.)\n\n"
        + "\n".join(lines) + "\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"Итог: {'✅ +' if profit >= 0 else '❌ '}{fmt(abs(profit))} {CURRENCY}\n"
        f"💰 Баланс: <b>{fmt(new_balance)} {CURRENCY}</b>"
    )

    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🔄 Снова", callback_data=f"play_blackjack_{base_bet}"),
        types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"),
    )

    del bot_instance.active_games[user_id]
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)
