import bot_instance
import os
import atexit
import signal
import sys

# 1. Сначала импортируем конфигурации и экземпляр
from bot_instance import bot

# Импорты для текстовых команд (чтобы конкретные обработчики работали)
from core.database import get_user
from config import CURRENCY

# === SINGLE INSTANCE GUARD ===
# Prevents accidental multiple bots with the same token from the same project dir.
PID_FILE = ".bot.pid"

def _is_process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)  # doesn't kill, just checks existence
        return True
    except OSError:
        return False

def _cleanup_pid_file():
    try:
        if os.path.exists(PID_FILE):
            os.unlink(PID_FILE)
    except Exception:
        pass

def _acquire_single_instance_lock():
    current_pid = os.getpid()

    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                old_pid = int(f.read().strip())
            if _is_process_alive(old_pid):
                print("=" * 70)
                print("ОШИБКА: Другой экземпляр бота уже запущен!")
                print(f"  Старый PID: {old_pid}")
                print(f"  Текущий PID: {current_pid}")
                print("  Убедись, что запущен ТОЛЬКО один процесс.")
                print("  Чтобы принудительно убить старый: kill -9", old_pid)
                print("=" * 70)
                sys.exit(1)
            else:
                # stale pid file
                print(f"[INFO] Найден устаревший PID-файл от мёртвого процесса {old_pid}, продолжаем...")
        except Exception:
            pass

    # write our pid
    try:
        with open(PID_FILE, "w") as f:
            f.write(str(current_pid))
    except Exception as e:
        print(f"[WARN] Не удалось записать PID-файл: {e}")

    atexit.register(_cleanup_pid_file)

    # also clean on common signals
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, lambda s, f: (_cleanup_pid_file(), sys.exit(0)))
        except Exception:
            pass

_acquire_single_instance_lock()

# 2. Импортируем модули с декораторами (порядок важен)
import users.admin
import game_logic.mining
import games.slots
import games.mines
import games.blackjack
import games.dice
import games.roulette
import games.coin
import economy.bank
import economy.transfers
import economy.business
import economy.nicknames
import social.marriage
import interface.menu
import interface.betting

# 3. Служебные текстовые обработчики
from commands.text_commands import sell_command_handler, text_command_handler

# Регистрация текстовых обработчиков "на лету" с правильными приоритетами
@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().lower().startswith("продать фермы"))
def dispatch_sell_farm(message):
    sell_command_handler(message)

# Дополнительные конкретные текстовые обработчики (регистрируются раньше catch-all,
# чтобы команды работали надёжно даже при смешанных версиях/перезапусках).
# Они вызывают ту же логику, что и централизованный роутер.

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().lower() in ["профиль", "я", "проф"])
def text_profile(message):
    if get_user(message.from_user.id).get("banned"): return
    from interface.menu import send_profile
    send_profile(message.chat.id, message.from_user.id)

@bot.message_handler(commands=["balance", "bal", "баланс"])
def balance_command(message):
    if get_user(message.from_user.id).get("banned"): return
    user = get_user(message.from_user.id)
    bank_bal = user.get("bank_balance", 0)
    main_bal = user["balance"]
    total = main_bal + bank_bal
    from telebot import types as _types
    from core.utils import fmt as _fmt
    kb = _types.InlineKeyboardMarkup(row_width=1)
    kb.add(_types.InlineKeyboardButton("🏦 Открыть банк", callback_data="bank_menu"))
    bot.send_message(
        message.chat.id,
        f"💎 <b>Ваш баланс</b>\n\n"
        f"На руках: <b>{_fmt(main_bal)} {CURRENCY}</b>\n"
        f"В банке: <b>{_fmt(bank_bal)} {CURRENCY}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>Всего:</b> {_fmt(total)} {CURRENCY}",
        reply_markup=kb
    )

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().lower() in ["слоты", "slots"])
def text_slots(message):
    if get_user(message.from_user.id).get("banned"): return
    from interface.betting import bet_keyboard
    from core.database import get_user as _get_user
    from core.utils import fmt as _fmt
    u = _get_user(message.from_user.id)
    t = "🎰 <b>СЛОТЫ</b>\n<i>Три одинаковых = ДЖЕКПОТ!</i>\n\n" \
        f"💰 Баланс: <b>{_fmt(u['balance'])}</b> {CURRENCY}"
    last = u.get("last_bet", 0)
    pre = min(last, u["balance"]) if last > 0 else 0
    bot.send_message(message.chat.id, t, reply_markup=bet_keyboard("slots", pre))

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().lower() in ["мины", "mines"])
def text_mines(message):
    if get_user(message.from_user.id).get("banned"): return
    from telebot import types as _types
    from core.database import get_user as _get_user
    from core.utils import fmt as _fmt
    u = _get_user(message.from_user.id)
    t = "💣 <b>МИНЫ</b>\n<i>Открывай клетки — множитель растёт!</i>\n\n" \
        f"💰 Баланс: <b>{_fmt(u['balance'])}</b> {CURRENCY}"
    kb = _types.InlineKeyboardMarkup(row_width=3)
    kb.add(
        _types.InlineKeyboardButton("💣 3 мины", callback_data="start_mines_3"),
        _types.InlineKeyboardButton("💣 5 мин", callback_data="start_mines_5"),
        _types.InlineKeyboardButton("💣 10 мин", callback_data="start_mines_10"),
    )
    kb.add(_types.InlineKeyboardButton("💣 15 мин", callback_data="start_mines_15"))
    kb.add(_types.InlineKeyboardButton("◀️ Назад", callback_data="main_menu"))
    bot.send_message(message.chat.id, t, reply_markup=kb)

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().lower() in ["бонус", "bonus"])
def text_bonus(message):
    if get_user(message.from_user.id).get("banned"): return
    user_id = message.from_user.id
    user = get_user(user_id)
    from core.utils import send_section_from_text
    send_section_from_text(bot, message.chat.id, "", "daily_bonus", user_id, user)

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().lower() in ["ферма", "farm"])
def text_farm(message):
    if get_user(message.from_user.id).get("banned"): return
    from game_logic.mining import mining_menu_text, mining_menu_kb
    bot.send_message(
        message.chat.id,
        mining_menu_text(message.from_user.id),
        reply_markup=mining_menu_kb(message.from_user.id)
    )

# Catch-all текстовый хендлер регистрируется самым последним
@bot.message_handler(func=lambda msg: True, content_types=["text"])
def dispatch_all_text(message):
    text_command_handler(message)


# === Безопасный fallback для callback-кнопок ===
# Регистрируется последним. Всегда отвечает на callback (чтобы кнопка не висела с "загрузкой").
# Печатает в консоль — очень полезно для отладки, когда кнопки "не реагируют".
@bot.callback_query_handler(func=lambda c: True)
def final_callback_fallback(c):
    data = getattr(c, "data", "???")
    uid = getattr(getattr(c, "from_user", None), "id", "?")
    print(f"[CALLBACK] data={data} user={uid}")
    try:
        bot.answer_callback_query(c.id)
    except Exception:
        pass


# 4. Запуск бота
if __name__ == "__main__":
    import os
    print("=" * 70)
    print(f"[BUTUZ Game] Бот запущен и готов к работе...")
    print(f"  PID процесса: {os.getpid()}")
    print(f"  PID-файл: {os.path.abspath(PID_FILE)}")
    print("  Если увидишь 409 Conflict — значит другой экземпляр (возможно из другой папки")
    print("  с копией проекта или из background) уже использует этот токен.")
    print("  Убедись, что запущен ТОЛЬКО ОДИН процесс.")
    print("=" * 70)

    try:
        bot.infinity_polling(timeout=20, long_polling_timeout=20)
    except Exception as e:
        print(f"\n[FATAL] Ошибка polling: {e}")
        if "409" in str(e) or "Conflict" in str(e):
            print(">>> КРИТИЧНО: Другой экземпляр бота уже подключён к Telegram (getUpdates).")
            print(">>> Решение:")
            print("    1. Найди и убей все python-процессы:   ps aux | grep python")
            print("    2. pkill -9 -f 'python'   (осторожно, убьёт все твои python-скрипты)")
            print("    3. Или найди процесс по токену и убей его по PID.")
            print("    4. Удали файл .bot.pid если он остался от мёртвого процесса.")
        else:
            print("Возможно проблема с сетью / токеном / правами.")
        _cleanup_pid_file()
        sys.exit(1)
