# -*- coding: utf-8 -*-
"""
🧠 HumsyarCore — هسته واحد هامزیار (W8)

چرا هسته؟
  قبل از W8، هر لایه (Bot / MiniApp / WebAdmin) منطق خودش را برای
  «آیا کاربر حق دیدن دارد؟» ، «اشتراک فعال است؟»، «کدام ورودی؟» و
  «چه خطایی برگردانیم؟» داشت. نتیجه: ۳ پیاده‌سازی موازی که با هر
  تغییر، یکی عقب می‌ماند → IDOR، paywall ناسازگار، validate دوگانه.

هسته یک بسته thin-wrapper است که **همان** متدهای موجود DB را با
  قرارداد واحد و کد خطای ماشین‌خوان صادر می‌کند. Bot و API و MiniApp
  (از طریق API) از همین هسته می‌خوانند — هیچ منطق کسب‌وکاری در هسته
  تکرار نمی‌شود، فقط قرارداد.
"""
import importlib

__all__ = [
    "access", "rbac", "content_scope", "settings", "errors", "pagination", "audit",
    "request_context", "time_utils", "utils_crypto",
]


def __getattr__(name):
    if name in __all__:
        mod = importlib.import_module(f".{name}", __name__)
        globals()[name] = mod
        return mod
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted(set(list(globals().keys()) + __all__))
