import telebot
from config import BOT_TOKEN

bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML")

# Хранилище активных игр в памяти
active_games = {}

# Хранилище ожидания ввода ставки вручную
pending_bet_input = {}

# Хранилище ожидания ввода количества ферм
pending_farm_input = {}

# Хранилище ожидания ввода перевода
pending_transfer = {}

# Хранилище активных предложений брака
pending_proposals = {}

# Хранилище комнат совместной игры в кости {room_id: {данные комнаты}}
dice_rooms = {}

# Счётчик ID комнат
dice_room_counter = 0

# Хранилище комнат PvP Монетка
coin_rooms = {}

# Счётчик ID комнат для монетки
coin_room_counter = 0

# === Никнеймы ===
# Ожидание ввода нового никнейма
pending_nickname_create = {}

# Ожидание ввода цены при продаже ника на маркет
pending_nickname_sell = {}  # user_id -> {"nick": "Name"}

# === Рейтинг (покупка/продажа) ===
# Ожидание количества для покупки рейтинга
pending_rating_buy = {}

# Ожидание количества для продажи рейтинга
pending_rating_sell = {}

