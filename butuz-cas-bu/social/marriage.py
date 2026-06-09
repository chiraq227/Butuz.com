from datetime import datetime
from telebot import types
from bot_instance import bot
import bot_instance
from core.database import get_user, save_user
from core.utils import fmt, get_display_name

@bot.callback_query_handler(func=lambda c: c.data == "marriage_menu")
def marriage_menu(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    kb = types.InlineKeyboardMarkup(row_width=1)

    if user.get("married_to"):
        partner = get_user(user["married_to"])
        p_name = get_display_name(partner)
        m_date = datetime.fromisoformat(user["married_at"]).strftime("%d.%m.%Y")
        text = (
            f"💍 <b>ВАШ БРАК</b>\n\n"
            f"❤️ Вы состоите в официальном браке с <b>{p_name}</b>!\n"
            f"📅 Дата свадьбы: <b>{m_date}</b>\n\n"
            f"Цените и любите друг друга! 🎰"
        )
        kb.add(types.InlineKeyboardButton("💔 Подать на развод", callback_data="marriage_divorce_confirm"))
    else:
        text = (
            f"💍 <b>ЗАГС / СИСТЕМА БРАКОВ</b>\n\n"
            f"Вы одиноки. Вы можете предложить руку и сердце любому игроку!\n"
            f"Для этого вам нужен его <b>Игровой ID</b> или <b>@username</b>."
        )
        kb.add(types.InlineKeyboardButton("💍 Сделать предложение", callback_data="marriage_propose"))

    kb.add(types.InlineKeyboardButton("◀️ Назад в профиль", callback_data="profile"))
    bot.edit_message_text(text, c.message.chat.id, c.message.message_id, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data == "marriage_propose")
def marriage_propose_start(c):
    user_id = c.from_user.id
    bot_instance.pending_proposals[user_id] = {
        "chat_id": c.message.chat.id,
        "message_id": c.message.message_id
    }
    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("❌ Отмена", callback_data="marriage_menu"))
    bot.edit_message_text(
        "💍 <b>ПРЕДЛОЖЕНИЕ БРАКА</b>\n\n"
        "Отправьте Игровой ID или @username партнёра, которому хотите сделать предложение:",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

def handle_proposal_input(message):
    user_id = message.from_user.id
    target_str = message.text.strip()
    from users.admin import admin_resolve_user

    t_id, t_data = admin_resolve_user(target_str)

    state = bot_instance.pending_proposals.get(user_id)
    if not state: return

    kb_cancel = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("❌ Отмена", callback_data="marriage_menu"))

    if not t_id:
        bot.send_message(message.chat.id, "❌ Игрок не найден. Попробуйте ещё раз или отмените:", reply_markup=kb_cancel)
        return

    if t_id == user_id:
        bot.send_message(message.chat.id, "❌ Нельзя жениться на самом себе!", reply_markup=kb_cancel)
        return

    user = get_user(user_id)
    if user.get("married_to"):
        bot.send_message(message.chat.id, "❌ Вы уже в браке!", reply_markup=kb_cancel)
        del bot_instance.pending_proposals[user_id]
        return

    if t_data.get("married_to"):
        bot.send_message(message.chat.id, "❌ Этот игрок уже состоит в браке с кем-то другим!", reply_markup=kb_cancel)
        del bot_instance.pending_proposals[user_id]
        return

    del bot_instance.pending_proposals[user_id]
    marriage_send_proposal(message.chat.id, user_id, user, t_id, t_data)

def marriage_send_proposal(chat_id, from_id, from_user, to_id, to_user):
    from_name = get_display_name(from_user)
    to_name = get_display_name(to_user)

    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))
    bot.send_message(
        chat_id, f"💍 <b>Предложение отправлено!</b>\n\n"
        f"Вы сделали предложение игроку <b>{to_name}</b>.\n"
        f"Ожидайте его решения.", reply_markup=kb
    )

    kb_target = types.InlineKeyboardMarkup(row_width=2)
    kb_target.add(
        types.InlineKeyboardButton("❤️ Принять", callback_data=f"marriage_accept_{from_id}"),
        types.InlineKeyboardButton("💔 Отклонить", callback_data=f"marriage_decline_{from_id}"),
    )
    try:
        bot.send_message(
            to_id, f"💍 <b>ПРЕДЛОЖЕНИЕ РУКИ И СЕРДЦА!</b>\n\n"
            f"Игрок <b>{from_name}</b> делает вам предложение стать его/её брачным партнёром!\n\n"
            f"Вы согласны?", reply_markup=kb_target
        )
    except: pass

@bot.callback_query_handler(func=lambda c: c.data.startswith("marriage_accept_"))
def marriage_accept(c):
    to_id = c.from_user.id
    from_id = int(c.data.replace("marriage_accept_", ""))

    user_to = get_user(to_id)
    user_from = get_user(from_id)

    if user_to.get("married_to") or user_from.get("married_to"):
        bot.answer_callback_query(c.id, "❌ Кто-то из вас уже вступил в брак!", show_alert=True)
        return

    now_iso = datetime.now().isoformat()
    user_to["married_to"] = from_id
    user_to["married_at"] = now_iso
    user_from["married_to"] = to_id
    user_from["married_at"] = now_iso

    save_user(to_id, user_to)
    save_user(from_id, user_from)

    kb_profile = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("💍 В брак", callback_data="marriage_menu"))

    bot.edit_message_text(
        f"🎉 <b>ПОЗДРАВЛЯЕМ!</b>\n\nВы приняли предложение. Теперь вы в браке с <b>{get_display_name(user_from)}</b>!",
        c.message.chat.id, c.message.message_id, reply_markup=kb_profile
    )
    try:
        bot.send_message(
            from_id, f"🎉 <b>УРА! СВАДЬБА!</b>\n\n"
            f"Игрок <b>{get_display_name(user_to)}</b> принял(а) ваше предложение!\n\n"
            f"❤️ Желаем счастья!", reply_markup=kb_profile
        )
    except: pass
    bot.answer_callback_query(c.id, "💍 Поздравляем!")

@bot.callback_query_handler(func=lambda c: c.data.startswith("marriage_decline_"))
def marriage_decline(c):
    to_id = c.from_user.id
    from_id = int(c.data.replace("marriage_decline_", ""))
    to_user = get_user(to_id)
    to_name = get_display_name(to_user)
    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("◀️ Меню", callback_data="main_menu"))

    try: bot.edit_message_text("💔 Вы отклонили предложение.", c.message.chat.id, c.message.message_id, reply_markup=kb)
    except: pass

    try:
        bot.send_message(
            from_id, f"💔 <b>Предложение отклонено</b>\n\n"
            f"Игрок <b>{to_name}</b> отклонил(а) ваше предложение.\n\n"
            f"Не расстраивайтесь! 🎰", reply_markup=kb
        )
    except: pass
    bot.answer_callback_query(c.id)

@bot.callback_query_handler(func=lambda c: c.data == "marriage_divorce_confirm")
def marriage_divorce_confirm(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    if not user.get("married_to"):
        bot.answer_callback_query(c.id, "❌ Вы не состоите в браке!", show_alert=True)
        return
    partner = get_user(user["married_to"])
    partner_name = partner.get("username", "Игрок")
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("💔 Да, развестись", callback_data="marriage_divorce_do"),
        types.InlineKeyboardButton("❌ Нет, остаться", callback_data="marriage_menu"),
    )
    bot.edit_message_text(
        f"💔 <b>Подтверждение развода</b>\n\n"
        f"Вы уверены что хотите развестись с\n"
        f"<b>{partner_name}</b>?\n\n"
        f"Это действие необратимо.",
        c.message.chat.id, c.message.message_id, reply_markup=kb
    )

@bot.callback_query_handler(func=lambda c: c.data == "marriage_divorce_do")
def marriage_divorce_do(c):
    user_id = c.from_user.id
    user = get_user(user_id)
    if not user.get("married_to"):
        bot.answer_callback_query(c.id, "❌ Вы не состоите в браке!", show_alert=True)
        return
    partner_id = user["married_to"]
    partner = get_user(partner_id)
    partner_name = get_display_name(partner)
    user_name = get_display_name(user)

    user["married_to"] = None
    user["married_at"] = None
    save_user(user_id, user)
    partner["married_to"] = None
    partner["married_at"] = None
    save_user(partner_id, partner)

    kb = types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("◀️ В профиль", callback_data="profile"))
    try:
        bot.edit_message_text(
            f"💔 <b>Развод оформлен</b>\n\n"
            f"Вы больше не состоите в браке с <b>{partner_name}</b>.\n\n"
            f"🎰 Удачи в новой жизни!",
            c.message.chat.id, c.message.message_id, reply_markup=kb
        )
    except: pass

    try:
        bot.send_message(
            partner_id, f"💔 <b>Развод</b>\n\n"
            f"<b>{user_name}</b> подал(а) на развод.\n"
            f"Вы больше не состоите в браке.", reply_markup=types.InlineKeyboardMarkup().add(types.InlineKeyboardButton("◀️ Профиль", callback_data="profile"))
        )
    except: pass
    bot.answer_callback_query(c.id, "💔 Развод оформлен")
