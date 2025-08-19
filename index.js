// index.js — Bot AdsRewards (ID + EN) Replit-ready + Admin Ads Manager + Admin Tools
// -------------------------------------------------------------------
// DEPENDENCIES
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const app = express();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const REPL_URL = process.env.REPL_URL || '';
const USERS_FILE = 'users.json';

const POIN_PER_IKLAN = 1;
const BONUS_REFERRAL = 10;
const BONUS_HARIAN = 5;
const MIN_WITHDRAW = 100;
const MIN_WATCH_SECONDS = 30;                 // minimal detik nonton
const BAN_AFTER_VIOLATIONS = 3;               // ban setelah N pelanggaran
const BAN_DURATION_MS = 24 * 60 * 60 * 1000;  // 24 jam (auto-ban karena skip)
const ADMIN_BLOCK_DURATION_MS = 100 * 365 * 24 * 60 * 60 * 1000; // 100 tahun (block manual admin)
const DONE_BUTTON_EXPIRE_MS = 5 * 60 * 1000;  // tombol “Selesai” kedaluwarsa (TAPI kini dinonaktifkan)

// ===== KEEP ALIVE (Replit) =====
app.get('/', (_, res) => res.send('Bot is alive!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Keep-alive server running on port ${PORT}`));
if (REPL_URL && /^https?:\/\//.test(REPL_URL)) {
  setInterval(() => axios.get(REPL_URL).catch(() => {}), 5 * 60 * 1000);
}

// ===== UTILS =====
const now = () => Date.now();
const safeString = v => (v ? String(v) : '');
const isAdmin = id => String(id) === String(ADMIN_ID);

// ===== LOAD / SAVE =====
let db = { users: {}, ads: [] };
try {
  if (fs.existsSync(USERS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE));
    if (raw && raw.users) db = raw;
    else if (raw && typeof raw === 'object' && !Array.isArray(raw)) db = { users: raw, ads: [] };
  }
} catch (e) {
  console.error('⚠️ Gagal baca users.json, mulai fresh.', e);
  db = { users: {}, ads: [] };
}
function saveData() {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('⚠️ Gagal simpan users.json', e); }
}
setInterval(saveData, 30 * 1000);

// Inisialisasi ads default jika kosong
if (!Array.isArray(db.ads) || db.ads.length === 0) {
  db.ads = [
    { name: "Iklan 1", url: REPL_URL || "https://example.com", active: false },
    { name: "Iklan 2", url: "https://gigahub-two.vercel.app", active: true },
  ];
  saveData();
}

// ===== I18N =====
const I = {
  id: {
    title: "🎯 Bot AdsRewards",
    menu: ["📺 Nonton Iklan","🎁 Bonus Harian","👥 Referral","💼 Wallet","📊 Dashboard","🌐 Ganti Bahasa","ℹ️ Tentang","📜 Peraturan","💳 Withdraw","✉️ Feedback"],
    start: "Selamat datang di *Bot AdsRewards*!",
    chooseLang: "Pilih Bahasa",
    dailyBonusOk: p => `🎁 Bonus harian +${p} poin!`,
    dailyBonusAgain: "❗ Kamu sudah ambil bonus harian. Coba lagi besok.",
    referralLink: (usr, id) => `👥 Bagikan link referral:\nhttps://t.me/${usr}?start=${id}\n\n✅ Ajak teman, dapat ${BONUS_REFERRAL} poin ketika temanmu bergabung & nonton.`,
    walletAsk: "Kirim alamat wallet kamu (ketik *batal* untuk membatalkan):",
    walletSaved: addr => `✅ Wallet disimpan: \`${addr}\``,
    needWallet: "❗ Kamu belum menyimpan wallet.",
    about: "ℹ️ *Tentang*\nBot nonton iklan dengan poin & withdraw.",
    rules: "PERATURAN:\n1. Dilarang menggunakan bot/script otomatis.\n2. Satu orang hanya boleh satu akun.\n3. Dilarang spam/klik otomatis.\n4. Admin berhak memblokir pelanggar.",
    watchIntro: sec => `📺 *Silakan pilih iklan untuk ditonton:*\n⏳ Tonton minimal *${sec} detik*. Klaim poin sekarang *otomatis* setelah waktu habis.`,
    watchWait: left => `⏳ Harus tonton ${left} detik lagi.`,
    watchOk: p => `✅ +${p} poin!`,
    watchSkipWarn: n => `⚠️ Kamu melakukan skip. Peringatan (${n}/${BAN_AFTER_VIOLATIONS}). Jika mencapai ${BAN_AFTER_VIOLATIONS}, akun diblok sementara 24 jam.`,
    bannedMsg: until => `🚫 Kamu diblok sampai ${new Date(until).toLocaleString()}.`,
    balance: u => `📊 Saldo: *${u.points} poin*\n💼 Wallet: ${u.wallet || '-' }\n👥 Referral: ${u.referrals || 0}`,
    withdrawAsk: min => `💳 Masukkan jumlah withdraw (minimal ${min} poin). Ketik *batal* untuk membatalkan:`,
    wdMin: min => `❌ Minimum withdraw ${min} poin.`,
    wdOk: amt => `✅ Withdraw ${amt} poin diajukan. Admin akan memproses.`,
    cancelled: "❎ Dibatalkan.",
    feedbackAsk: "✍️ Ketik pesan feedback kamu (ketik *batal* untuk membatalkan):",
    feedbackThanks: "🙏 Terima kasih atas feedbacknya!",
    doneKeyword: /^(selesai|done)$/i,
    watchSpam: "⚠️ Jangan spam tombol nonton, tunggu beberapa detik.",
  },
  en: {
    title: "🎯 AdsRewards Bot",
    menu: ["📺 Watch Ads","🎁 Daily Bonus","👥 Referral","💼 Wallet","📊 Dashboard","🌐 Language","ℹ️ About","📜 Rules","💳 Withdraw","✉️ Feedback"],
    start: "Welcome to *AdsRewards Bot*!",
    chooseLang: "Choose Language",
    dailyBonusOk: p => `🎁 Daily bonus +${p} points!`,
    dailyBonusAgain: "❗ You already took daily bonus. Try again tomorrow.",
    referralLink: (usr, id) => `👥 Share referral link:\nhttps://t.me/${usr}?start=${id}\n\n✅ Invite friends, get ${BONUS_REFERRAL} points when they join & watch.`,
    walletAsk: "Send your wallet address (type *cancel* to cancel):",
    walletSaved: addr => `✅ Wallet saved: \`${addr}\``,
    needWallet: "❗ You haven't saved a wallet.",
    about: "ℹ️ *About*\nWatch ads for points & withdraw.",
    rules: "RULES:\n1. No bots/scripts.\n2. One account per person.\n3. No spam/auto clickers.\n4. Admin may block violators.",
    watchIntro: sec => `📺 *Please choose an ad to watch:*\n⏳ Watch at least *${sec} seconds*. Claim is now *automatic* when time ends.`,
    watchWait: left => `⏳ You must watch ${left} more seconds.`,
    watchOk: p => `✅ +${p} points!`,
    watchSkipWarn: n => `⚠️ You skipped. Warning (${n}/${BAN_AFTER_VIOLATIONS}). If you reach ${BAN_AFTER_VIOLATIONS}, you're blocked for 24 hours.`,
    bannedMsg: until => `🚫 You're blocked until ${new Date(until).toLocaleString()}.`,
    balance: u => `📊 Balance: *${u.points} points*\n💼 Wallet: ${u.wallet || '-' }\n👥 Referrals: ${u.referrals || 0}`,
    withdrawAsk: min => `💳 Enter withdraw amount (minimum ${min} points). Type *cancel* to cancel:`,
    wdMin: min => `❌ Minimum withdraw is ${min} points.`,
    wdOk: amt => `✅ Withdraw ${amt} points submitted. Admin will process.`,
    cancelled: "❎ Cancelled.",
    feedbackAsk: "✍️ Type your feedback (type *cancel* to cancel):",
    feedbackThanks: "🙏 Thanks for your feedback!",
    doneKeyword: /^(done|selesai)$/i,
    watchSpam: "⚠️ Do not spam the watch button; wait a few seconds.",
  }
};
const T = u => I[u?.lang === 'en' ? 'en' : 'id'];

// ===== USER HELPERS =====
function getUser(id) {
  id = safeString(id);
  if (!db.users[id]) {
    db.users[id] = {
      points: 0,
      referrals: 0,
      wallet: null,
      lang: 'id',
      // referral flags (FIX referral bonus once)
      referredBy: null,
      referralBonusGiven: false,
      // watch session
      watching: false,
      watchStart: 0,
      watchUnlockAt: 0,  // kapan tombol boleh muncul (tetap dipakai sebagai pengaman waktu)
      // tombol legacy (dinonaktifkan, tapi biarkan field untuk kompatibilitas)
      btnMsgId: null,
      btnChatId: null,
      btnExpireAt: 0,
      // compliance
      violations: 0,
      bannedUntil: 0,    // juga dipakai untuk admin block (durasi panjang)
      // states
      waitingWallet: false,
      waitingFeedback: false,
      pendingWithdraw: null,
      // anti-spam
      lastAdAt: 0
    };
  }
  return db.users[id];
}

// ===== BOT =====
const bot = new TelegramBot(TOKEN, { polling: true });
bot.on('polling_error', (err) => console.error('Polling error:', err?.message || err));

// ===== MENUS =====
function menuKeyboard(lang = 'id', isAdm = false) {
  const b = I[lang].menu;
  const rows = [
    [{ text: b[0] }], // Nonton
    [{ text: b[1] }, { text: b[2] }],
    [{ text: b[3] }, { text: b[4] }],
    [{ text: b[5] }, { text: b[6] }],
    [{ text: b[7] }, { text: b[8] }],
    [{ text: b[9] }]
  ];
  if (isAdm) {
    rows.push([{ text: "🛠 Admin Panel" }]);
  }
  return { reply_markup: { keyboard: rows, resize_keyboard: true } };
}

function adminMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Stats', callback_data: 'adm_stats' }],
      [{ text: '👤 Points', callback_data: 'adm_points' }],
      [{ text: '📢 Ads Manager', callback_data: 'adm_ads_menu' }],
      [{ text: '🚫 Block/Unblock', callback_data: 'adm_block' }],
      [{ text: '💳 Withdraws', callback_data: 'adm_withdraws' }],
      [{ text: '📣 Broadcast', callback_data: 'adm_broadcast' }],
      [{ text: '✖️ Close', callback_data: 'adm_close' }]
    ]
  };
}
function buildAdsInlineKeyboardFromDB(lang = 'id', isAdm = false) {
  const rows = [];
  const activeAds = db.ads.filter(a => a.active);
  if (!activeAds.length) rows.push([{ text: "❌ Tidak ada iklan aktif", callback_data: 'adm_ads_list' }]);
  activeAds.forEach(a => rows.push([{ text: `▶️ ${a.name}`, url: a.url }]));
  if (isAdm) rows.push([{ text: '📺 Iklan (contoh)', url: 'https://example.com' }]);
  return { inline_keyboard: rows };
}
function adminAdsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📃 List Iklan', callback_data: 'adm_ads_list' }],
      [{ text: '🟢 Toggle ON/OFF', callback_data: 'adm_ads_toggle_menu' }],
      [{ text: '➕ Tambah Iklan', callback_data: 'adm_ads_add' }],
      [{ text: '🗑 Hapus Iklan', callback_data: 'adm_ads_delete_menu' }],
      [{ text: '↩️ Kembali', callback_data: 'adm_back_main' }]
    ]
  };
}

// ===== START / REFERRAL =====
let botUsername = null;
(async () => {
  try {
    const me = await bot.getMe();
    botUsername = me.username;
  } catch {}
})();

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const uid = String(msg.from.id);
  const chatId = String(msg.chat.id);
  const user = getUser(uid);
  const lang = user.lang;
  const isAdm = isAdmin(uid);

  // Referral
  const payload = (match && match[1]) ? String(match[1]).trim() : '';
  if (payload && !user.referralBonusGiven) {
    const refBy = payload.replace(/[^\d-]/g,'');
    if (refBy && refBy !== uid) {
      user.referredBy = refBy;
      // bonus referral diberikan sekali saat user pertama kali nonton (lihat handler nonton)
    }
  }

  await bot.sendMessage(chatId, `${I[lang].start}\n\n${I[lang].title}`, { parse_mode: 'Markdown', ...menuKeyboard(lang, isAdm) });
});

// ===== ADMIN PANEL (command) =====
bot.onText(/\/admin/, msg => {
  if (!isAdmin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, '🛠 *Admin Panel*', { parse_mode: 'Markdown', reply_markup: adminMainKeyboard() });
});

// ===== CALLBACK QUERY (Admin & Language & legacy) =====
bot.on('callback_query', async q => {
  try {
    const data = q.data || '';
    const actorId = String(q.from.id);
    const chatIdOfMsg = String(q.message?.chat?.id || actorId);
    const actorIsAdmin = isAdmin(actorId);
    const actor = getUser(actorId);

    // Klaim manual dinonaktifkan: semua klaim otomatis
    if ((q.data || '').startsWith('done_watch_')) {
      await bot.answerCallbackQuery(q.id, { text: '✅ Klaim otomatis: tidak perlu tombol.', show_alert: true });
      return;
    }

    // set language
    if (data === 'set_lang_id' || data === 'set_lang_en') {
      actor.lang = data.endsWith('_id') ? 'id' : 'en';
      saveData();
      await bot.answerCallbackQuery(q.id, { text: '✅ OK' });
      return bot.sendMessage(actorId, T(actor).start, { parse_mode: 'Markdown', ...menuKeyboard(actor.lang, actorIsAdmin) });
    }

    // ===== Admin main =====
    if (data === 'adm_close') {
      await bot.answerCallbackQuery(q.id);
      try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatIdOfMsg, message_id: q.message.message_id }); } catch {}
      return;
    }
    if (data === 'adm_back_main') {
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageReplyMarkup(adminMainKeyboard(), { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data === 'adm_stats') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      const totalUsers = Object.keys(db.users).length;
      const activeAds = db.ads.filter(a => a.active).length;
      const blocked = Object.values(db.users).filter(u => u.bannedUntil && now() < u.bannedUntil).length;
      const txt = `📊 Stats\nUsers: ${totalUsers}\nIklan aktif: ${activeAds}\nDiblok: ${blocked}`;
      return bot.editMessageText(txt, { chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: adminMainKeyboard() }).catch(()=>{});
    }
    if (data === 'adm_points') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      const top = Object.entries(db.users).sort((a,b)=> (b[1].points||0)-(a[1].points||0)).slice(0,10);
      const lines = top.map(([uid,u],i)=> `${i+1}. ${uid} — ${u.points||0} pts`);
      return bot.editMessageText(`👤 Points (Top 10)\n`+ (lines.join('\n') || 'kosong'), { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminMainKeyboard() }).catch(()=>{});
    }

    // ===== Admin ads menu =====
    if (data === 'adm_ads_menu') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageReplyMarkup(adminAdsKeyboard(), { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data === 'adm_ads_list') {
      await bot.answerCallbackQuery(q.id);
      const lines = db.ads.map((a,i)=> `${i+1}. ${a.name} [${a.active?'ON':'OFF'}] — ${a.url}`);
      return bot.editMessageText(lines.join('\n') || 'Tidak ada iklan.', { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
    }
    if (data === 'adm_ads_toggle_menu') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      if (!db.ads.length) {
        return bot.editMessageText('Tidak ada iklan.', { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
      }
      const rows = db.ads.map((a,i)=> [{ text: `${a.active?'🟢':'⚪️'} ${a.name}`, callback_data: `adm_toggle_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_menu' }]);
      return bot.editMessageReplyMarkup({ inline_keyboard: rows }, { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data.startsWith('adm_toggle_')) {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      const idx = Number(data.replace('adm_toggle_',''));
      if (!db.ads[idx]) return bot.answerCallbackQuery(q.id, { text: 'Index tidak valid', show_alert: true });
      db.ads[idx].active = !db.ads[idx].active; saveData();
      await bot.answerCallbackQuery(q.id, { text: `Toggled: ${db.ads[idx].name} → ${db.ads[idx].active?'ON':'OFF'}` });
      return bot.editMessageReplyMarkup(adminAdsKeyboard(), { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data === 'adm_ads_delete_menu') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      if (!db.ads.length) {
        return bot.editMessageText('Tidak ada iklan.', { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
      }
      const rows = db.ads.map((a, i) => [{ text: `🗑 Hapus — ${a.name}`, callback_data: `adm_delete_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_menu' }]);
      return bot.editMessageReplyMarkup({ inline_keyboard: rows }, { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data.startsWith('adm_delete_')) {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      const idx = Number(data.replace('adm_delete_',''));
      if (!db.ads[idx]) return bot.answerCallbackQuery(q.id, { text: 'Index tidak valid', show_alert: true });
      const removed = db.ads.splice(idx, 1)[0];
      saveData();
      await bot.answerCallbackQuery(q.id, { text: `Dihapus: ${removed.name}` });
      if (!db.ads.length) {
        return bot.editMessageText('Semua iklan terhapus.', { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
      }
      const rows = db.ads.map((a, i) => [{ text: `🗑 Hapus — ${a.name}`, callback_data: `adm_delete_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_menu' }]);
      return bot.editMessageReplyMarkup({ inline_keyboard: rows }, { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data === 'adm_ads_add') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('➕ Kirim *Nama Iklan* (contoh: Iklan 3):', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '↩️ Batal', callback_data: 'adm_ads_menu' }]] }
      }).catch(()=>{});
    }

    // ====== Admin: Withdraw pending list ======
    if (data === 'adm_withdraws') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      const entries = Object.entries(db.users).filter(([uid,u]) => u.pendingWithdraw);
      if (!entries.length) {
        return bot.editMessageText('💳 Tidak ada withdraw pending.', {
          chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminMainKeyboard()
        }).catch(()=>{});
      }
      const lines = entries.map(([uid, u], i) =>
        `${i+1}. User: ${uid}\n   Jumlah: ${u.pendingWithdraw.amount}\n   Wallet: ${u.pendingWithdraw.wallet || '-'}`
      );
      return bot.editMessageText(lines.join('\n'), { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminMainKeyboard() }).catch(()=>{});
    }

    if (data === 'adm_broadcast') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('Kirim pesan broadcast sekarang.', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminMainKeyboard()
      }).catch(()=>{});
    }

    if (data === 'adm_block') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('Kirim ID user yang ingin diblokir / dibuka blokirnya lewat pesan (freetext).', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminMainKeyboard()
      }).catch(()=>{});
    }

  } catch (e) {
    console.error('callback_query error', e);
    try { await bot.answerCallbackQuery(q.id).catch(()=>{}); } catch {}
  }
});

// ===== TEXT HANDLER (Menus + States + Ads flow) =====
const ADMIN_STATES = {};

bot.on('message', async msg => {
  try {
    if (!msg || !msg.chat) return;
    const chatId = String(msg.chat.id);
    const uid = String(msg.from.id);
    const text = (msg.text || '').trim();
    const user = getUser(uid);
    const lang = user.lang;
    const texts = I[lang];
    const actorIsAdmin = isAdmin(uid);

    // ignore non-text
    if (!text) return;

    // Admin conversational states: add ad name/url, block/unblock, broadcast, etc.
    const st = ADMIN_STATES[uid];
    if (actorIsAdmin && st) {
      // Tambah Iklan flow
      if (st.mode === 'add_ad') {
        if (st.step === 'name') {
          st.name = text.slice(0,80);
          st.step = 'url';
          return bot.sendMessage(chatId, 'Kirim *URL Iklan*:', { parse_mode: 'Markdown' });
        } else if (st.step === 'url') {
          const url = text.trim();
          db.ads.push({ name: st.name || `Iklan ${db.ads.length+1}`, url, active: true });
          saveData();
          delete ADMIN_STATES[uid];
          return bot.sendMessage(chatId, '✅ Iklan ditambahkan.', { reply_markup: adminAdsKeyboard() });
        }
      }
      // Block / Unblock
      if (st.mode === 'block') {
        if (st.step === 'ask_user') {
          st.uid = text.replace(/[^\d-]/g,'');
          if (!st.uid) return bot.sendMessage(chatId, '❌ User ID tidak valid. Coba lagi:');
          st.step = 'action';
          return bot.sendMessage(chatId, `Pilih aksi untuk user ${st.uid}:`, {
            reply_markup: { inline_keyboard: [
              [{ text: '🚫 Block', callback_data: `adm_blk_do_${st.uid}` }],
              [{ text: '✅ Unblock', callback_data: `adm_unblk_do_${st.uid}` }]
            ]}
          });
        }
      }
      // tunggu callback untuk block/unblock
    }

    // ===== fallback keyword "selesai/done" (sekarang tidak dipakai) =====
    if (I.id.doneKeyword.test(text) || I.en.doneKeyword.test(text)) {
      return bot.sendMessage(chatId, 'ℹ️ Sekarang klaim poin otomatis setelah waktu nonton terpenuhi. Tidak perlu mengetik *selesai*.', { parse_mode: 'Markdown' });
    }

    // ===== MENU =====
    const b = I[lang].menu;

    if (text === b[0]) { // Nonton Iklan
      if (!actorIsAdmin && user.bannedUntil && now() < user.bannedUntil) {
        return bot.sendMessage(chatId, texts.bannedMsg(user.bannedUntil));
      }
      // anti-spam: jeda minimal 10 detik
      if (now() - (user.lastAdAt || 0) < 10 * 1000) {
        return bot.sendMessage(chatId, texts.watchSpam);
      }
      user.lastAdAt = now();

      user.watching = true;
      user.watchStart = now();
      user.watchUnlockAt = user.watchStart + MIN_WATCH_SECONDS * 1000;
      user.btnMsgId = null; user.btnChatId = null; user.btnExpireAt = 0;
      saveData();

      await bot.sendMessage(chatId, texts.watchIntro(MIN_WATCH_SECONDS), {
        parse_mode: 'Markdown',
        reply_markup: buildAdsInlineKeyboardFromDB(lang, actorIsAdmin)
      });

      // Setelah MIN_WATCH_SECONDS, auto-berikan poin (tanpa tombol)
      setTimeout(async () => {
        const u = getUser(chatId);
        if (!u.watching) return;
        if (now() < u.watchUnlockAt) return; // safety
        // auto award
        u.watching = false; u.watchStart = 0; u.watchUnlockAt = 0;
        u.points = (u.points || 0) + POIN_PER_IKLAN;
        saveData();
        try { await bot.sendMessage(chatId, texts.watchOk(POIN_PER_IKLAN), menuKeyboard(lang, actorIsAdmin)); } catch (_) {}
      }, MIN_WATCH_SECONDS * 1000);

      return;
    }

    if (text === b[1]) { // Bonus Harian
      const t = now();
      if (t - (user.lastBonus || 0) >= 24 * 60 * 60 * 1000) {
        user.points += BONUS_HARIAN; user.lastBonus = t; saveData();
        return bot.sendMessage(chatId, texts.dailyBonusOk(BONUS_HARIAN), menuKeyboard(lang, actorIsAdmin));
      }
      return bot.sendMessage(chatId, texts.dailyBonusAgain, menuKeyboard(lang, actorIsAdmin));
    }

    if (text === b[2]) { // Referral
      return bot.sendMessage(chatId, T(user).referralLink(botUsername || 'BOT', chatId), { disable_web_page_preview: true });
    }

    if (text === b[3]) { // Wallet
      user.waitingWallet = true; saveData();
      return bot.sendMessage(chatId, texts.walletAsk, { parse_mode: 'Markdown' });
    }

    if (text === b[4]) { // Dashboard
      return bot.sendMessage(chatId, texts.balance(user), { parse_mode: 'Markdown' });
    }

    if (text === b[5]) { // Ganti Bahasa
      return bot.sendMessage(chatId, I.id.chooseLang + " / " + I.en.chooseLang, {
        reply_markup: { inline_keyboard: [[{ text: '🇮🇩 Indonesia', callback_data: 'set_lang_id' }, { text: '🇬🇧 English', callback_data: 'set_lang_en' }]] }
      });
    }

    if (text === b[6]) { // Tentang
      return bot.sendMessage(chatId, texts.about, { parse_mode: 'Markdown' });
    }

    if (text === b[7]) { // Peraturan
      return bot.sendMessage(chatId, texts.rules, { parse_mode: 'Markdown' });
    }

    if (text === b[8]) { // Withdraw
      user.waitingWithdraw = true; saveData();
      return bot.sendMessage(chatId, texts.withdrawAsk(MIN_WITHDRAW), { parse_mode: 'Markdown' });
    }

    if (text === b[9]) { // Feedback
      user.waitingFeedback = true; saveData();
      return bot.sendMessage(chatId, texts.feedbackAsk, { parse_mode: 'Markdown' });
    }

    if (text === '🛠 Admin Panel' && actorIsAdmin) {
      return bot.sendMessage(chatId, '🛠 *Admin Panel*', { parse_mode: 'Markdown', reply_markup: adminMainKeyboard() });
    }

    // ===== STATES =====

    // Wallet input
    if (user.waitingWallet && text) {
      if (/^(batal|cancel)$/i.test(text)) {
        user.waitingWallet = false; saveData();
        return bot.sendMessage(chatId, I[lang].cancelled, menuKeyboard(lang, actorIsAdmin));
      }
      user.wallet = text.trim();
      user.waitingWallet = false; saveData();
      return bot.sendMessage(chatId, I[lang].walletSaved(user.wallet), { parse_mode: 'Markdown', ...menuKeyboard(lang, actorIsAdmin) });
    }

    // Withdraw input
    if (user.waitingWithdraw && text) {
      if (/^(batal|cancel)$/i.test(text)) {
        user.waitingWithdraw = false; saveData();
        return bot.sendMessage(chatId, I[lang].cancelled, menuKeyboard(lang, actorIsAdmin));
      }
      const amt = Number(text.replace(/[^\d]/g,''));
      if (!amt || amt < MIN_WITHDRAW) {
        user.waitingWithdraw = false; saveData();
        return bot.sendMessage(chatId, I[lang].wdMin(MIN_WITHDRAW), menuKeyboard(lang, actorIsAdmin));
      }
      if (!user.wallet) {
        user.waitingWithdraw = false; saveData();
        return bot.sendMessage(chatId, I[lang].needWallet, menuKeyboard(lang, actorIsAdmin));
      }
      user.waitingWithdraw = false;
      user.pendingWithdraw = { amount: amt, wallet: user.wallet, at: now() };
      user.points = Math.max(0, (user.points || 0) - amt);
      saveData();
      return bot.sendMessage(chatId, I[lang].wdOk(amt), menuKeyboard(lang, actorIsAdmin));
    }

    // Feedback input
    if (user.waitingFeedback && text && !text.startsWith('/')) {
      if (/^(batal|cancel)$/i.test(text)) {
        user.waitingFeedback = false; saveData();
        return bot.sendMessage(chatId, I[lang].cancelled, menuKeyboard(lang, actorIsAdmin));
      }
      user.waitingFeedback = false; saveData();
      bot.sendMessage(ADMIN_ID, `📩 Feedback dari ${chatId}:\n${text}`).catch(()=>{});
      return bot.sendMessage(chatId, I[lang].feedbackThanks, menuKeyboard(lang, actorIsAdmin));
    }

    // ===== WATCH FLOW—Anti skip =====
    // Catatan: klaim sudah otomatis. Jika user tidak menunggu durasi penuh, poin TIDAK akan masuk (anti-skip by design).

  } catch (e) {
    console.error('message handler error', e);
  }
});

// ===== REFERRAL HOOK (beri bonus saat pertama kali benar2 nonton) =====
// (Contoh sederhana: ketika poin pertama kali bertambah dari nonton, cek referredBy)
function maybeGiveReferralBonus(userId) {
  const u = getUser(userId);
  if (u.referredBy && !u.referralBonusGiven) {
    const ref = getUser(u.referredBy);
    ref.points = (ref.points || 0) + BONUS_REFERRAL;
    ref.referrals = (ref.referrals || 0) + 1;
    u.referralBonusGiven = true;
    saveData();
  }
}

// ===== IKLAN: Pemanggilan manual via /watch juga tetap ada =====
bot.onText(/\/watch/, async msg => {
  const chatId = String(msg.chat.id);
  const uid = String(msg.from.id);
  const user = getUser(uid);
  const lang = user.lang;
  const isAdm = isAdmin(uid);
  const texts = I[lang];

  if (!isAdm && user.bannedUntil && now() < user.bannedUntil) {
    return bot.sendMessage(chatId, texts.bannedMsg(user.bannedUntil));
  }
  if (now() - (user.lastAdAt || 0) < 10 * 1000) {
    return bot.sendMessage(chatId, texts.watchSpam);
  }
  user.lastAdAt = now();

  user.watching = true;
  user.watchStart = now();
  user.watchUnlockAt = user.watchStart + MIN_WATCH_SECONDS * 1000;
  user.btnMsgId = null; user.btnChatId = null; user.btnExpireAt = 0;
  saveData();

  await bot.sendMessage(chatId, texts.watchIntro(MIN_WATCH_SECONDS), {
    parse_mode: 'Markdown',
    reply_markup: buildAdsInlineKeyboardFromDB(lang, isAdm)
  });

  setTimeout(async () => {
    const u = getUser(chatId);
    if (!u.watching) return;
    if (now() < u.watchUnlockAt) return;
    u.watching = false; u.watchStart = 0; u.watchUnlockAt = 0;
    u.points = (u.points || 0) + POIN_PER_IKLAN;
    saveData();
    try { await bot.sendMessage(chatId, texts.watchOk(POIN_PER_IKLAN), menuKeyboard(lang, isAdm)); } catch (_) {}
    maybeGiveReferralBonus(uid);
  }, MIN_WATCH_SECONDS * 1000);
});

// ===== BASIC GUARDS =====
if (!TOKEN) { console.error('❌ TOKEN belum diatur di Secrets.'); process.exit(1); }
if (!ADMIN_ID) { console.error('❌ ADMIN_ID belum diatur di Secrets.'); process.exit(1); }
