"""Local QMT bridge. Forge writes a request JSON path and a result JSON path.

The same result shape is what an OpenAPI or client program should write:
ok, connected, error, cash, total, marketValue, positions, orderId.
"""

import json
import os
import random
import sys


def main():
    if len(sys.argv) != 3:
        return
    result_path = sys.argv[2]

    def write(payload):
        with open(result_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)

    def fail(message):
        write({"ok": False, "error": message})
        raise SystemExit(0)

    try:
        with open(sys.argv[1], encoding="utf-8") as handle:
            request = json.load(handle)
    except Exception:
        fail("无法读取券商请求")
        return

    root = os.path.dirname(os.path.abspath(sys.executable))
    os.environ["PATH"] = root + os.pathsep + os.environ.get("PATH", "")
    try:
        from xtquant import xtconstant
        from xtquant.xttrader import XtQuantTrader, XtQuantTraderCallback
        from xtquant.xttype import StockAccount
    except Exception:
        fail("这台电脑上的 Python 没有 xtquant。请填写 QMT 自带的 python.exe")
        return

    class Callback(XtQuantTraderCallback):
        def on_disconnected(self):
            return None

    trader = None
    try:
        path = str(request.get("path") or "").strip()
        account_id = str(request.get("account") or "").strip()
        if not path or not account_id:
            fail("请填写 QMT 的 userdata_mini 目录")
            return
        trader = XtQuantTrader(path, random.randint(1, 2_000_000_000))
        trader.register_callback(Callback())
        trader.start()
        if trader.connect() != 0:
            fail("QMT 没有连上。请先打开并登录 miniQMT")
            return
        account = StockAccount(account_id, "STOCK")
        if trader.subscribe(account) != 0:
            fail("QMT 没有订阅该资金账号")
            return
        command = str(request.get("cmd") or "")
        if command == "status":
            write({"ok": True, "connected": True})
            return
        if command == "account":
            asset = trader.query_stock_asset(account)
            if asset is None:
                fail("QMT 没有返回资金")
                return
            rows = []
            for pos in trader.query_stock_positions(account) or []:
                quantity = float(getattr(pos, "volume", 0) or 0)
                if quantity == 0:
                    continue
                rows.append(
                    {
                        "code": str(getattr(pos, "stock_code", "") or ""),
                        "name": str(getattr(pos, "instrument_name", "") or ""),
                        "quantity": quantity,
                        "available": float(getattr(pos, "can_use_volume", 0) or 0),
                        "cost": float(getattr(pos, "avg_price", 0) or getattr(pos, "open_price", 0) or 0),
                        "marketValue": float(getattr(pos, "market_value", 0) or 0),
                    }
                )
            write(
                {
                    "ok": True,
                    "connected": True,
                    "cash": float(getattr(asset, "cash", 0) or 0),
                    "total": float(getattr(asset, "total_asset", 0) or 0),
                    "marketValue": float(getattr(asset, "market_value", 0) or 0),
                    "positions": rows,
                }
            )
            return
        if command == "order":
            side = str(request.get("side") or "")
            order_type = xtconstant.STOCK_BUY if side == "buy" else xtconstant.STOCK_SELL
            order_id = trader.order_stock(
                account,
                str(request.get("code") or ""),
                order_type,
                int(round(float(request.get("quantity") or 0))),
                xtconstant.FIX_PRICE,
                float(request.get("price") or 0),
                "forge",
                "forge",
            )
            if order_id is None or int(order_id) <= 0:
                fail("QMT 拒绝了这笔委托")
                return
            write({"ok": True, "connected": True, "orderId": str(int(order_id))})
            return
        fail("不认识的券商指令")
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"QMT 调用失败: {exc}")
    finally:
        if trader is not None:
            try:
                trader.stop()
            except Exception:
                pass


if __name__ == "__main__":
    main()
