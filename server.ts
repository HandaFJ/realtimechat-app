const clients = new Set<WebSocket>();

// 許可するOrigin（カンマ区切り）。例: https://ユーザー名.github.io
// 未設定の場合はローカル開発用（Vite のデフォルトポート）のみ許可
const allowedOrigins = (
  Deno.env.get("ALLOWED_ORIGINS") ??
  "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const port = Number(Deno.env.get("PORT") ?? 8080);

// 無操作で自動切断するまでの時間（分）。クライアント側の IDLE_MINUTES と合わせること
const idleTimeoutMs =
  Number(Deno.env.get("IDLE_TIMEOUT_MINUTES") ?? 10) * 60 * 1000;
// 無操作切断を示すクローズコード（4000〜4999 はアプリ独自に使える）
const IDLE_CLOSE_CODE = 4000;

// 複数インスタンス（リージョン）で動く環境でも、全員に届くようにするためのチャンネル。
// 同じプロセス内では自分自身には届かないので、ローカルへの送信は別途行う。
const channel = new BroadcastChannel("chat");
channel.onmessage = (event) => sendToLocalClients(event.data);

Deno.serve({ port }, (req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("Not a websocket request", { status: 426 });
  }

  // ブラウザからの接続は Origin を確認する
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) {
    return new Response("Forbidden origin", { status: 403 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  // 接続ごとの無操作タイマー。操作があるたびにリセットし、
  // 一定時間操作がなければ切断する（接続が残り続けてサーバーが
  // 停止できなくなるのを防ぐ）
  let idleTimer: number | undefined;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      socket.close(IDLE_CLOSE_CODE, "idle timeout");
    }, idleTimeoutMs);
  };

  socket.onopen = () => {
    clients.add(socket);
    resetIdleTimer();
    broadcast({
      type: "SYSTEM",
      message: "ユーザーが参加しました",
      count: clients.size,
    });
  };

  socket.onmessage = (event) => {
    resetIdleTimer();
    try {
      const data = JSON.parse(event.data);

      // 画面操作を知らせるだけのメッセージ（配信しない）
      if (data.type === "ACTIVITY") return;

      const text =
        typeof data.text === "string" ? data.text.trim().slice(0, 500) : "";
      if (!text) return;

      const username =
        typeof data.username === "string" && data.username.trim()
          ? data.username.trim().slice(0, 20)
          : "名無しさん";

      broadcast({
        type: "MESSAGE",
        username,
        text,
        // サーバーの地域（UTC など）に依存しないよう日本時間で固定
        timestamp: new Date().toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Tokyo",
        }),
      });
    } catch (e) {
      console.error("Invalid message format", e);
    }
  };

  socket.onclose = () => {
    clearTimeout(idleTimer);
    clients.delete(socket);
    broadcast({
      type: "SYSTEM",
      message: "ユーザーが退出しました",
      count: clients.size,
    });
  };

  socket.onerror = (e) => console.error("WebSocket error", e);

  return response;
});

function sendToLocalClients(data: unknown) {
  const messageString = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageString);
    }
  }
}

function broadcast(data: unknown) {
  sendToLocalClients(data);
  channel.postMessage(data);
}

console.log(`WebSocket server running on port ${port}`);
