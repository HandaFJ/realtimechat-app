<script lang="ts">
  import { tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
 
  interface ChatMessage {
    id: string;
    type: 'MESSAGE' | 'SYSTEM';
    username?: string;
    text?: string;
    message?: string;
    timestamp?: string;
    count?: number;
  }
 
  const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';
 
  // 無操作で自動切断するまでの時間（分）。server.ts の IDLE_TIMEOUT_MINUTES と合わせること
  const IDLE_MINUTES = 10;
  const IDLE_CLOSE_CODE = 4000;
  const ACTIVITY_INTERVAL_MS = 30_000;
 
  let username = '';
  let isJoined = false;
  let connecting = false;
  let notice = '';
  let inputMessage = '';
  let messages: ChatMessage[] = [];
  let ws: WebSocket | null = null;
  let chatContainer: HTMLDivElement;
  let lastActivitySent = 0;
 
  function joinChat() {
    if (!username.trim() || connecting) return;
    connecting = true;
    notice = '';
 
    const socket = new WebSocket(WS_URL);
    ws = socket;
 
    socket.onopen = () => {
      connecting = false;
      isJoined = true;
      lastActivitySent = Date.now();
    };
 
    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const newMessage: ChatMessage = { id: crypto.randomUUID(), ...data };
 
      const nearBottom = isNearBottom();
      messages = [...messages, newMessage];
 
      await tick();
      if (nearBottom || newMessage.username === username) scrollToBottom();
    };
 
    socket.onclose = (event) => {
      // 自分で退出した場合（ws を null にしてから close している）は何もしない
      if (ws !== socket) return;
 
      ws = null;
      connecting = false;
      const wasJoined = isJoined;
      isJoined = false;
      messages = [];
 
      if (event.code === IDLE_CLOSE_CODE) {
        notice = `${IDLE_MINUTES}分間操作がなかったため、接続を終了しました。もう一度参加してください。`;
      } else if (wasJoined) {
        notice = '接続が切断されました。もう一度参加してください。';
      } else {
        notice = 'サーバーに接続できませんでした。時間をおいて、もう一度お試しください。';
      }
    };
  }
 
  function leaveChat() {
    const socket = ws;
    ws = null; // onclose 側で「自分で退出した」と判別するため先に null にする
    socket?.close();
    isJoined = false;
    connecting = false;
    notice = '';
    messages = [];
  }
 
  function sendMessage() {
    if (!inputMessage.trim() || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ username, text: inputMessage }));
    lastActivitySent = Date.now();
    inputMessage = '';
  }
 
  // 画面を操作している間は、一定間隔でサーバーに知らせて自動切断を延期する
  function notifyActivity() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastActivitySent < ACTIVITY_INTERVAL_MS) return;
    lastActivitySent = now;
    ws.send(JSON.stringify({ type: 'ACTIVITY' }));
  }
 
  function isNearBottom() {
    if (!chatContainer) return true;
    const { scrollTop, scrollHeight, clientHeight } = chatContainer;
    return scrollHeight - scrollTop - clientHeight < 120;
  }
 
  function scrollToBottom() {
    if (chatContainer) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    }
  }
</script>

<svelte:window on:pointerdown={notifyActivity} on:keydown={notifyActivity} />

<!--
  LINE風トーク画面デザイン
-->
<div class="fixed inset-0 flex flex-col bg-[#7494c0] text-slate-800 font-sans overflow-hidden">
  {#if !isJoined}
    <!-- 入室画面 -->
    <div class="m-auto p-8 bg-white rounded-2xl shadow-xl flex flex-col items-center gap-4 w-[90%] max-w-sm border border-slate-100"
         in:fade={{ duration: 300 }}>
      <h1 class="text-2xl font-bold text-[#06c755]">
        リアルタイムチャット
      </h1>
      <p class="text-sm text-slate-500">参加する名前を入力してください</p>
      <input
        type="text"
        bind:value={username}
        placeholder="あなたの名前"
        class="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:border-[#06c755] transition-colors text-slate-800"
        on:keydown={(e) => e.key === 'Enter' && joinChat()}
      />
      <button
        on:click={joinChat}
        class="w-full py-2.5 bg-[#06c755] hover:bg-[#05b34c] text-white rounded-xl font-semibold transition-all transform active:scale-95 shadow-md shadow-[#06c755]/20">
        チャットに参加
      </button>
            <!-- 利用上の注意 -->
      <div class="w-full text-xs text-slate-400 leading-relaxed border-t border-slate-700 pt-4 space-y-1.5">
        <p>・{IDLE_MINUTES}分間操作がないと、接続は自動的に終了します。</p>
        <p>・誰も使っていないときはサーバーも停止します。停止中は、最初の接続に少し時間がかかることがあります。</p>
      </div>
    </div>
  {:else}
    <!-- LINE風ヘッダー -->
    <header class="h-16 bg-white border-b border-slate-200 flex justify-between items-center px-4 sm:px-6 shadow-sm z-10 shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <h2 class="font-bold text-lg text-slate-800 truncate">トークルーム</h2>
        <span class="text-xs bg-slate-100 px-3 py-1 rounded-full text-slate-600 border border-slate-200 hidden sm:inline-block">
          ログイン中: <strong class="text-slate-900">{username}</strong>
        </span>
      </div>
      <button
        on:click={leaveChat}
        class="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-all border border-slate-200 shrink-0">
        退出する
      </button>
    </header>

    <!-- メッセージ一覧（チャット背景） -->
    <div bind:this={chatContainer} class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4">
      {#each messages as msg (msg.id)}
        <div animate:flip={{ duration: 300 }} in:fly={{ y: 15, duration: 250 }}>
          {#if msg.type === 'SYSTEM'}
            <div class="flex justify-center my-2">
              <span class="text-xs bg-black/20 text-white px-3 py-1 rounded-full shadow-sm backdrop-blur-sm">
                {msg.message ?? msg.text}{msg.count ? ` (現在 ${msg.count}人)` : ''}
              </span>
            </div>
          {:else}
            <div class="flex flex-col {msg.username === username ? 'items-end' : 'items-start'}">
              <div class="flex items-baseline gap-2 mb-1 px-1 whitespace-nowrap">
                <span class="text-xs font-medium text-white/90 drop-shadow-sm">{msg.username}</span>
                <span class="text-[10px] text-white/70">{msg.timestamp}</span>
              </div>

              <!--
                吹き出しのカラー変更:
                - 自分のコメント: LINE風グリーン
                - 相手のコメント: 白吹き出し
              -->
              <div class="max-w-[75%] md:max-w-md px-4 py-2.5 rounded-2xl shadow-sm text-sm leading-relaxed break-words whitespace-pre-wrap {
                msg.username === username
                  ? 'bg-[#85e249] text-slate-900 rounded-br-none font-medium'
                  : 'bg-white text-slate-800 border border-slate-100 rounded-bl-none'
              }">
                {msg.text}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- フッター（入力欄） -->
    <footer class="shrink-0 bg-white border-t border-slate-200 flex items-center gap-3 px-4 sm:px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 shadow-lg">
      <input
        type="text"
        bind:value={inputMessage}
        placeholder="メッセージを入力..."
        class="flex-1 min-w-0 px-4 py-3 rounded-xl bg-slate-100 border border-slate-200 focus:outline-none focus:bg-white focus:border-[#06c755] transition-colors text-base sm:text-sm text-slate-800 placeholder:text-slate-400"
        on:keydown={(e) => e.key === 'Enter' && !e.isComposing && sendMessage()}
      />
      <button
        on:click={sendMessage}
        class="px-6 py-3 bg-[#06c755] hover:bg-[#05b34c] text-white rounded-xl font-semibold text-sm transition-all transform active:scale-95 shadow-md shadow-[#06c755]/20 shrink-0">
        送信
      </button>
    </footer>
  {/if}
</div>