from config import MAX_LEVEL
from core.utils import fmt

def xp_for_level(lvl: int) -> int:
    return int(5000 * (lvl ** 1.8))

def calc_level_from_xp(xp: int) -> int:
    lvl = 1
    while lvl < MAX_LEVEL and xp >= xp_for_level(lvl):
        lvl += 1
    return lvl

def xp_for_next_level(lvl: int) -> int:
    if lvl >= MAX_LEVEL:
        return 0
    return xp_for_level(lvl)

def xp_progress(xp: int, lvl: int) -> int:
    if lvl <= 1:
        return xp
    spent = sum(xp_for_level(i) for i in range(1, lvl))
    return xp - spent

def level_info(user: dict) -> str:
    lvl = user.get("level", 1)
    xp = user.get("xp", 0)

    if lvl >= MAX_LEVEL:
        return f"⭐ Ур. {lvl} [██████████] МАКС"

    need = xp_for_next_level(lvl)
    current = xp_progress(xp, lvl)
    bar_filled = int(min(current / max(need, 1), 1.0) * 10)
    bar = "█" * bar_filled + "░" * (10 - bar_filled)
    return f"Ур. {lvl} [{bar}] {fmt(current)}/{fmt(need)} XP"

def vip_badge(user: dict) -> str:
    if user.get("vip"):
        return "👑 VIP "
    lvl = user.get("level", 1)
    if lvl >= 1000: return "🌟 ЛЕГЕНДА "
    if lvl >= 500:  return "💎 Мастер "
    if lvl >= 200:  return "🔥 Ветеран "
    if lvl >= 100:  return "⚔️ Опытный "
    if lvl >= 5:    return "🌱 Новичок "
    return ""
