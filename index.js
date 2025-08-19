// index.js — Bot AdsRewards (ID + EN) Replit-ready + Admin Ads Manager + Admin Tools + Button Done After Watch (Fixed)
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
const DONE_BUTTON_EXPIRE_MS = 5 * 60 * 1000;  // tombol “Selesai” kedaluwarsa

if (!TOKEN) { console.error('❌ TOKEN belum diatur di Secrets.'); process.exit(1); }
if (!ADMIN_ID) { console.error('❌ ADMIN_ID belum diatur di Secrets.'); process.exit(1); }

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
function isValidHttpUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

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
    { name: "Iklan 2", url: "https://iklan-giga-hub.vercel.app", active: true },
  ];
  saveData();
}

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
      watchUnlockAt: 0,  // kapan tombol boleh muncul
      btnMsgId: null,    // message id tombol
      btnChatId: null,   // chat id tombol
      btnExpireAt: 0,    // kapan tombol kedaluwarsa
      // compliance
      violations: 0,
      bannedUntil: 0,    // juga dipakai untuk admin block (durasi panjang)
      // misc
      lastBonus: 0,
      waitingWallet: false,
      waitingFeedback: false,
      pendingWithdraw: null
    };
  }
  return db.users[id];
}

// ===== I18N =====
const I = {
  id: {
    buttons: [
      "🎯 Nonton Iklan","🎁 Bonus Harian","👥 Referral","💸 Withdraw","💼 Wallet",
      "📊 Dashboard","🌐 Ganti Bahasa","ℹ️ Tentang Kami","📜 Peraturan","✉️ Feedback","🛠 Panel Admin"
    ],
    chooseLang: "Pilih Bahasa / Choose Language",
    start: "Selamat datang di *Bot AdsRewards*! Tukarkan poin kamu menjadi USDT.",
    about: "Bot ini dibuat untuk memberikan reward nonton iklan. Ikuti peraturan agar tidak diblok.",
    rules: "PERATURAN:\n1. Dilarang menggunakan bot/script otomatis.\n2. Satu orang hanya boleh satu akun.\n3. Dilarang spam/klik otomatis.\n4. Admin berhak memblokir pelanggar.",
    watchIntro: sec => `📺 *Silakan pilih iklan untuk ditonton:*\n⏳ Tonton minimal *${sec} detik*. Tombol klaim akan muncul otomatis setelah waktu habis.`,
    watchWait: left => `⏳ Harus tonton ${left} detik lagi.`,
    watchOk: p => `✅ +${p} poin!`,
    watchSkipWarn: n => `⚠️ Kamu melakukan skip. Peringatan (${n}/${BAN_AFTER_VIOLATIONS}). Jika mencapai ${BAN_AFTER_VIOLATIONS}, akun diblok sementara 24 jam.`,
    bannedMsg: until => `🚫 Kamu diblok sampai ${new Date(until).toLocaleString()}.`,
    balance: u => `📊 Saldo: *${u.points} poin*\n💼 Wallet: ${u.wallet || '-'}\n👥 Referral: *${u.referrals}*`,
    askWallet: "Kirim alamat wallet USDT (TRC20/ERC20) kamu sekarang:",
    walletSaved: addr => `✅ Wallet disimpan: \`${addr}\``,
    needWalletFirst: "⚠️ Wallet belum diatur. Set wallet terlebih dahulu.",
    wdMin: min => `❌ Minimal withdraw ${min} poin.`,
    wdSent: "✅ Permintaan withdraw dikirim ke admin. Tunggu konfirmasi.",
    wdConfirmed: "✅ Withdraw kamu telah dikonfirmasi admin.",
    adminWd: (uid, pts, wal) => `💸 Permintaan Withdraw\nUser: ${uid}\nJumlah: ${pts} poin\nWallet: ${wal || '-'}`,
    feedbackAsk: "✍️ Tulis feedback kamu (ketik batal untuk membatalkan):",
    feedbackThanks: "✅ Feedback terkirim, terima kasih!",
    dailyBonusAgain: "⏳ Bonus harian sudah diambil, coba lagi besok.",
    dailyBonusOk: p => `🎁 Bonus harian +${p} poin!`,
    cancelled: "❎ Dibatalkan.",
    referralLink: (botUsername, id) => `🔗 Bagikan link referral kamu:\nhttps://t.me/${botUsername}?start=ref${id}`,
    doneKeyword: /^(selesai|done)$/i
  },
  en: {
    buttons: [
      "🎯 Watch Ads","🎁 Daily Bonus","👥 Referral","💸 Withdraw","💼 Wallet",
      "📊 Dashboard","🌐 Change Language","ℹ️ About Us","📜 Rules","✉️ Feedback","🛠 Admin Panel"
    ],
    chooseLang: "Pilih Bahasa / Choose Language",
    start: "Welcome to *Bot AdsRewards*! Exchange your points for USDT.",
    about: "This bot rewards users for watching ads. Please follow rules to avoid ban.",
    rules: "RULES:\n1. No automation/third-party scripts.\n2. One person, one account.\n3. No spam/click abuse.\n4. Admin may block violators.",
    watchIntro: sec => `📺 *Please pick an ad to watch:*\n⏳ Watch at least *${sec} seconds*. Claim button will appear automatically afterwards.`,
    watchWait: left => `⏳ Must watch ${left}s more.`,
    watchOk: p => `✅ +${p} points!`,
    watchSkipWarn: n => `⚠️ You skipped. Warning (${n}/${BAN_AFTER_VIOLATIONS}). Reaching ${BAN_AFTER_VIOLATIONS} will ban your account for 24h.`,
    bannedMsg: until => `🚫 You are banned until ${new Date(until).toLocaleString()}.`,
    balance: u => `📊 Balance: *${u.points} points*\n💼 Wallet: ${u.wallet || '-'}\n👥 Referrals: *${u.referrals}*`,
    askWallet: "Send your USDT wallet address (TRC20/ERC20):",
    walletSaved: addr => `✅ Wallet saved: \`${addr}\``,
    needWalletFirst: "⚠️ You haven't set a wallet. Set it first.",
    wdMin: min => `❌ Minimum withdraw is ${min} points.`,
    wdSent: "✅ Withdraw request sent to admin. Please wait for confirmation.",
    wdConfirmed: "✅ Your withdraw has been confirmed by admin.",
    adminWd: (uid, pts, wal) => `💸 Withdraw Request\nUser: ${uid}\nAmount: ${pts} points\nWallet: ${wal || '-'}`,
    feedbackAsk: "✍️ Send your feedback (type cancel to abort):",
    feedbackThanks: "✅ Feedback sent, thank you!",
    dailyBonusAgain: "⏳ Daily bonus already claimed, try tomorrow.",
    dailyBonusOk: p => `🎁 Daily bonus +${p} points!`,
    cancelled: "❎ Cancelled.",
    referralLink: (botUsername, id) => `🔗 Share your referral link:\nhttps://t.me/${botUsername}?start=ref${id}`,
    doneKeyword: /^(done|selesai)$/i
  }
};
const T = (u) => I[u.lang || 'id'];

// ===== KEYBOARD =====
function menuKeyboard(lang, isAdm = false) {
  const b = I[lang].buttons;
  const rows = [
    [b[0], b[1]],
    [b[2], b[3]],
    [b[4], b[5]],
    [b[6], b[7]],
    [b[8], b[9]]
  ];
  if (isAdm) rows.push([b[10]]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true } };
}

// ===== BOT INIT =====
const bot = new TelegramBot(TOKEN, { polling: true });
let botUsername = 'BOT';
bot.on('polling_error', (err) => console.error('Polling error:', err?.response?.body || err));
bot.getMe().then(me => { botUsername = me.username || 'BOT'; console.log('Bot active as @' + botUsername); })
.catch(err => console.error('getMe failed', err));

// ===== ADMIN HELPERS =====
const ADMIN_STATES = {}; // { [adminId]: { mode, step, tmp } }

// Admin Main Menu (inline)
function adminMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Total User', callback_data: 'adm_stats' }],
      [{ text: '📨 Broadcast Pesan', callback_data: 'adm_broadcast' }],
      [{ text: '➕/➖ Poin User', callback_data: 'adm_points' }],
      [{ text: '🚫 Block / Unblock User', callback_data: 'adm_block' }],
      [{ text: '💳 Withdraw Pending', callback_data: 'adm_withdraws' }],
      [{ text: '📺 Ads Manager', callback_data: 'adm_ads_menu' }],
      [{ text: '↩️ Tutup', callback_data: 'adm_close' }]
    ]
  };
}

// Ads Manager sub-menu (lama, dipindah ke satu tombol)
function adminAdsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📋 Lihat Iklan', callback_data: 'adm_ads_list' }],
      [{ text: '✅ Aktifkan / 🚫 Nonaktifkan', callback_data: 'adm_ads_toggle_menu' }],
      [{ text: '➕ Tambah Iklan', callback_data: 'adm_ads_add' }],
      [{ text: '🗑 Hapus Iklan', callback_data: 'adm_ads_delete_menu' }],
      [{ text: '↩️ Kembali', callback_data: 'adm_back_main' }]
    ]
  };
}

function renderAdsList() {
  if (!db.ads?.length) return 'Belum ada iklan.';
  return db.ads.map((a, i) => {
    const valid = isValidHttpUrl(a.url);
    const status = a.active ? 'AKTIF ✅' : 'NONAKTIF ⛔';
    const val = valid ? '' : ' (URL tidak valid)';
    return `${i+1}. ${a.name} — ${status}${val}\n${a.url}`;
  }).join('\n\n');
}
function buildAdsInlineKeyboardFromDB() {
  const rows = [];
  for (const a of db.ads) {
    if (!a?.url || !a.active || !isValidHttpUrl(a.url)) continue;
    rows.push([{ text: `📺 ${a.name}`, url: a.url }]);
  }
  if (!rows.length) rows.push([{ text: "📺 Iklan (contoh)", url: "https://example.com" }]);
  return { inline_keyboard: rows };
}

// ===== CALLBACKS =====
bot.on('callback_query', async q => {
  try {
    const data = q.data || '';
    const actorId = String(q.from.id);
    const chatIdOfMsg = String(q.message?.chat?.id || actorId);
    const actorIsAdmin = isAdmin(actorId);
    const actor = getUser(actorId);

    // set language
    if (data === 'set_lang_id' || data === 'set_lang_en') {
      actor.lang = data.endsWith('_id') ? 'id' : 'en';
      saveData();
      await bot.answerCallbackQuery(q.id, { text: '✅ OK' });
      return bot.sendMessage(actorId, T(actor).start, { parse_mode: 'Markdown', ...menuKeyboard(actor.lang, actorIsAdmin) });
    }

    // ====== Admin Main Navigation ======
    if (data === 'adm_close') {
      await bot.answerCallbackQuery(q.id, { text: 'OK' });
      return bot.deleteMessage(chatIdOfMsg, q.message.message_id).catch(()=>{});
    }
    if (data === 'adm_back_main') {
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('🔧 *Admin Panel*', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: adminMainKeyboard()
      }).catch(()=>{});
    }
    if (data === 'adm_ads_menu') {
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('📺 *Ads Manager*', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: adminAdsKeyboard()
      }).catch(()=>{});
    }

    // ====== Admin: Stats ======
    if (data === 'adm_stats') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      const total = Object.keys(db.users).length;
      const blocked = Object.values(db.users).filter(u => u.bannedUntil && now() < u.bannedUntil).length;
      const pendingWd = Object.values(db.users).filter(u => u.pendingWithdraw).length;
      const text = `📊 *Statistik*\n• Total user: *${total}*\n• Terblokir: *${blocked}*\n• Withdraw pending: *${pendingWd}*`;
      return bot.editMessageText(text, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: adminMainKeyboard()
      }).catch(()=>{});
    }

    // ====== Admin: Broadcast ======
    if (data === 'adm_broadcast') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'broadcast', step: 'text' };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('📝 Kirim teks broadcast (ketik *batal* untuk membatalkan):', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown'
      }).catch(()=>{});
    }

    // ====== Admin: Points adjust ======
    if (data === 'adm_points') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'points', step: 'ask_user', tmp: {} };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('🔢 Masukkan *User ID* yang ingin diubah poinnya:', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown'
      }).catch(()=>{});
    }

    // ====== Admin: Block/Unblock ======
    if (data === 'adm_block') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'block', step: 'ask_user' };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('🚫 Masukkan *User ID* yang ingin di-*block/unblock*:', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown'
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
      ).join('\n\n');
      // tombol untuk tiap user
      const rows = entries.map(([uid]) => ([
        { text: `✅ Terima ${uid}`, callback_data: `adm_wd_conf_${uid}` },
        { text: `❌ Tolak ${uid}`, callback_data: `adm_wd_rej_${uid}` },
      ]));
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_back_main' }]);
      return bot.editMessageText(`💳 *Withdraw Pending*\n\n${lines}`, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows }
      }).catch(()=>{});
    }

    // ====== Withdraw action (menu admin) ======
    if (data.startsWith('adm_wd_conf_') || data.startsWith('adm_wd_rej_')) {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      const targetId = data.replace(/^adm_wd_conf_|^adm_wd_rej_/, '');
      const target = getUser(targetId);
      if (!target.pendingWithdraw) {
        await bot.answerCallbackQuery(q.id, { text: '❗ Tidak ada pending withdraw.' });
      } else if (data.startsWith('adm_wd_conf_')) {
        // Konfirmasi
        target.points = 0;
        target.pendingWithdraw = null;
        saveData();
        await bot.answerCallbackQuery(q.id, { text: '✅ Dikonfirmasi' });
        await bot.sendMessage(targetId, (I[target.lang]?.wdConfirmed) || '✅ Withdraw dikonfirmasi admin.', menuKeyboard(target.lang, isAdmin(targetId)));
      } else {
        // Tolak
        target.pendingWithdraw = null;
        saveData();
        await bot.answerCallbackQuery(q.id, { text: '❌ Ditolak' });
        await bot.sendMessage(targetId, '❌ Withdraw ditolak oleh admin.');
      }
      // Refresh list
      const entries = Object.entries(db.users).filter(([uid,u]) => u.pendingWithdraw);
      if (!entries.length) {
        return bot.editMessageText('💳 Tidak ada withdraw pending.', {
          chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminMainKeyboard()
        }).catch(()=>{});
      }
      const lines = entries.map(([uid, u], i) =>
        `${i+1}. User: ${uid}\n   Jumlah: ${u.pendingWithdraw.amount}\n   Wallet: ${u.pendingWithdraw.wallet || '-'}`
      ).join('\n\n');
      const rows = entries.map(([uid]) => ([
        { text: `✅ Terima ${uid}`, callback_data: `adm_wd_conf_${uid}` },
        { text: `❌ Tolak ${uid}`, callback_data: `adm_wd_rej_${uid}` },
      ]));
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_back_main' }]);
      return bot.editMessageText(`💳 *Withdraw Pending*\n\n${lines}`, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows }
      }).catch(()=>{});
    }

    // ====== (Tetap support notifikasi DM lama) withdraw admin actions ======
    if (data.startsWith('confirm_withdraw_') || data.startsWith('reject_withdraw_')) {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      const targetId = data.replace(/^confirm_withdraw_|^reject_withdraw_/, '');
      const target = getUser(targetId);
      if (data.startsWith('confirm_withdraw_')) {
        target.points = 0;
        target.pendingWithdraw = null;
        saveData();
        await bot.answerCallbackQuery(q.id, { text: '✅ Dikonfirmasi' });
        await bot.sendMessage(targetId, (I[target.lang]?.wdConfirmed) || '✅ Withdraw dikonfirmasi admin.', menuKeyboard(target.lang, isAdmin(targetId)));
        return bot.editMessageText('✅ Withdraw dikonfirmasi oleh admin.', { chat_id: q.message.chat.id, message_id: q.message.message_id }).catch(()=>{});
      } else {
        target.pendingWithdraw = null;
        saveData();
        await bot.answerCallbackQuery(q.id, { text: '❌ Ditolak' });
        await bot.sendMessage(targetId, '❌ Withdraw ditolak oleh admin.');
        return bot.editMessageText('❌ Withdraw ditolak oleh admin.', { chat_id: q.message.chat.id, message_id: q.message.message_id }).catch(()=>{});
      }
    }

    // ====== Ads Manager (lama) ======
    if (data === 'adm_ads_list') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText(`📋 *Daftar Iklan*\n\n${renderAdsList()}`, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: adminAdsKeyboard()
      }).catch(()=>{});
    }
    if (data === 'adm_ads_toggle_menu') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      if (!db.ads?.length) {
        return bot.editMessageText('Belum ada iklan.', { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
      }
      const rows = db.ads.map((a, i) => [{ text: `${a.active ? '🚫 Nonaktifkan' : '✅ Aktifkan'} — ${a.name}`, callback_data: `adm_toggle_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_menu' }]);
      return bot.editMessageText('Pilih iklan untuk toggle aktif/nonaktif:', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: { inline_keyboard: rows }
      }).catch(()=>{});
    }
    if (data.startsWith('adm_toggle_')) {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      const idx = Number(data.replace('adm_toggle_', ''));
      if (!db.ads[idx]) return bot.answerCallbackQuery(q.id, { text: 'Index tidak valid', show_alert: true });
      db.ads[idx].active = !db.ads[idx].active;
      saveData();
      await bot.answerCallbackQuery(q.id, { text: db.ads[idx].active ? 'Diaktifkan' : 'Dinonaktifkan' });
      const rows = db.ads.map((a, i) => [{ text: `${a.active ? '🚫 Nonaktifkan' : '✅ Aktifkan'} — ${a.name}`, callback_data: `adm_toggle_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_menu' }]);
      return bot.editMessageReplyMarkup({ inline_keyboard: rows }, { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data === 'adm_ads_delete_menu') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      if (!db.ads?.length) {
        return bot.editMessageText('Tidak ada iklan untuk dihapus.', { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
      }
      const rows = db.ads.map((a, i) => [{ text: `🗑 Hapus — ${a.name}`, callback_data: `adm_delete_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_menu' }]);
      return bot.editMessageText('Pilih iklan yang ingin dihapus:', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: { inline_keyboard: rows }
      }).catch(()=>{});
    }
    if (data.startsWith('adm_delete_')) {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      const idx = Number(data.replace('adm_delete_', ''));
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
      ADMIN_STATES[actorId] = { mode: 'add_ad', step: 'name', tmp: {} };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('➕ Kirim *Nama Iklan* (contoh: Iklan 3):', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '↩️ Batal', callback_data: 'adm_ads_menu' }]] }
      }).catch(()=>{});
    }

    // ===== tombol "Selesai" (done_watch_<chatIdPemilikSesi>) =====
    if (data.startsWith('done_watch_')) {
      const targetChatId = data.replace('done_watch_', '');
      if (actorId !== targetChatId) {
        return bot.answerCallbackQuery(q.id, { text: '❗ Tombol bukan untukmu', show_alert: true });
      }
      const u = getUser(targetChatId);

      if (!isAdmin(actorId) && u.bannedUntil && now() < u.bannedUntil) {
        return bot.answerCallbackQuery(q.id, { text: T(u).bannedMsg(u.bannedUntil), show_alert: true });
      }

      const elapsed = Math.floor((now() - (u.watchStart || 0)) / 1000);
      if (!isAdmin(actorId) && elapsed < MIN_WATCH_SECONDS) {
        u.violations = (u.violations || 0) + 1;
        if (u.violations >= BAN_AFTER_VIOLATIONS) {
          u.bannedUntil = now() + BAN_DURATION_MS;
          u.watching = false; u.watchStart = 0;
          u.btnMsgId = null; u.btnChatId = null; u.btnExpireAt = 0; u.watchUnlockAt = 0;
          saveData();
          await bot.answerCallbackQuery(q.id, { text: '🚫 Diblok sementara', show_alert: true });
          return bot.sendMessage(targetChatId, T(u).bannedMsg(u.bannedUntil), menuKeyboard(u.lang, isAdmin(targetChatId)));
        }
        saveData();
        return bot.answerCallbackQuery(q.id, { text: T(u).watchSkipWarn(u.violations), show_alert: true });
      }

      // sukses klaim
      u.watching = false;
      u.watchStart = 0;
      u.watchUnlockAt = 0;
      u.violations = 0;
      u.points += POIN_PER_IKLAN;

      // hapus tombol jika masih ada
      if (q.message?.message_id && q.message?.chat?.id) {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: q.message.chat.id, message_id: q.message.message_id }).catch(()=>{});
      }
      u.btnMsgId = null; u.btnChatId = null; u.btnExpireAt = 0;
      saveData();

      await bot.answerCallbackQuery(q.id, { text: T(u).watchOk(POIN_PER_IKLAN) });
      return bot.sendMessage(targetChatId, T(u).watchOk(POIN_PER_IKLAN), menuKeyboard(u.lang, isAdmin(targetChatId)));
    }

    await bot.answerCallbackQuery(q.id).catch(()=>{});
  } catch (err) {
    console.error('callback_query error', err);
    try { await bot.answerCallbackQuery(q.id, { text: 'Error', show_alert: true }); } catch(e) {}
  }
});

// ===== /start & referral (FIX give once) =====
bot.onText(/^\/start(?:\s+(.+))?$/i, (msg, match) => {
  const chatId = String(msg.chat.id);
  const user = getUser(chatId);

  // referral: /start ref123 atau /start 123 -> bonus hanya SEKALI
  const refRaw = match?.[1]?.trim();
  if (refRaw && !user.referralBonusGiven) {
    const refId = refRaw.startsWith('ref') ? refRaw.replace(/^ref/, '') : refRaw;
    if (refId !== chatId && db.users[refId]) {
      user.referredBy = refId;
      user.referralBonusGiven = true;
      db.users[refId].points += BONUS_REFERRAL;
      db.users[refId].referrals = (db.users[refId].referrals || 0) + 1;
      bot.sendMessage(refId, `🎉 Kamu mendapat bonus referral +${BONUS_REFERRAL} poin!`).catch(()=>{});
      saveData();
    }
  }

  bot.sendMessage(chatId, I['id'].chooseLang, {
    reply_markup: { inline_keyboard: [[
      { text: "🇮🇩 Indonesia", callback_data: "set_lang_id" },
      { text: "🇺🇸 English", callback_data: "set_lang_en" }
    ]]}
  }).then(() => {
    bot.sendMessage(chatId, T(user).start, { parse_mode: 'Markdown', ...menuKeyboard(user.lang, isAdmin(chatId)) }).catch(()=>{});
  }).catch(()=>{});

  saveData();
});

// ===== ADMIN COMMAND (shortcut) =====
bot.onText(/^\/admin$/i, (msg) => {
  const chatId = String(msg.chat.id);
  if (!isAdmin(chatId)) return;
  bot.sendMessage(chatId, '🔧 *Admin Panel*', { parse_mode: 'Markdown', reply_markup: adminMainKeyboard() });
});

// ===== MESSAGE HANDLER =====
bot.on('message', async msg => {
  try {
    if (!msg?.chat) return;
    const chatId = String(msg.chat.id);
    const user = getUser(chatId);
    const lang = user.lang || 'id';
    const texts = I[lang];
    const text = (msg.text || '').trim();
    const actorIsAdmin = isAdmin(chatId);
    const b = I[lang].buttons;

    // ===== Admin interactive flows =====
    if (actorIsAdmin && ADMIN_STATES[chatId]?.mode) {
      const st = ADMIN_STATES[chatId];

      // Cancel
      if (/^(batal|cancel|\/cancel)$/i.test(text)) {
        delete ADMIN_STATES[chatId];
        return bot.sendMessage(chatId, '❎ Dibatalkan.', { reply_markup: adminMainKeyboard() });
      }

      // Broadcast
      if (st.mode === 'broadcast' && st.step === 'text') {
        delete ADMIN_STATES[chatId];
        const users = Object.keys(db.users);
        let ok = 0, fail = 0;
        for (const uid of users) {
          try { await bot.sendMessage(uid, text); ok++; }
          catch { fail++; }
        }
        return bot.sendMessage(chatId, `✅ Broadcast selesai.\nBerhasil: ${ok}\nGagal: ${fail}`, { reply_markup: adminMainKeyboard() });
      }

      // Points adjust
      if (st.mode === 'points') {
        if (st.step === 'ask_user') {
          st.tmp = st.tmp || {};
          st.tmp.uid = text.replace(/[^\d-]/g,'');
          if (!st.tmp.uid) return bot.sendMessage(chatId, '❌ User ID tidak valid. Coba lagi:');
          st.step = 'ask_amount';
          return bot.sendMessage(chatId, 'Masukkan jumlah poin (boleh negatif, contoh: -5 atau 20):');
        }
        if (st.step === 'ask_amount') {
          const amt = parseInt(text, 10);
          if (isNaN(amt)) return bot.sendMessage(chatId, '❌ Angka tidak valid. Masukkan bilangan bulat:');
          const target = getUser(st.tmp.uid);
          target.points = Math.max(0, (target.points || 0) + amt);
          saveData();
          delete ADMIN_STATES[chatId];
          await bot.sendMessage(st.tmp.uid, `📢 Poin kamu diupdate admin: ${amt >= 0 ? '+' : ''}${amt}. Saldo: ${target.points} poin.`).catch(()=>{});
          return bot.sendMessage(chatId, `✅ Poin user ${st.tmp.uid} diubah ${amt >= 0 ? '+' : ''}${amt}. Saldo sekarang: ${target.points}`, { reply_markup: adminMainKeyboard() });
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

    // ===== banned check (admin bebas) =====
    if (!actorIsAdmin && user.bannedUntil && now() < user.bannedUntil) {
      return bot.sendMessage(chatId, texts.bannedMsg(user.bannedUntil));
    }

    // ===== wallet input =====
    if (user.waitingWallet && text && !text.startsWith('/')) {
      if (/^(batal|cancel)$/i.test(text)) {
        user.waitingWallet = false; saveData();
        return bot.sendMessage(chatId, texts.cancelled, menuKeyboard(lang, actorIsAdmin));
      }
      user.wallet = text;
      user.waitingWallet = false; saveData();
      return bot.sendMessage(chatId, texts.walletSaved(user.wallet), { parse_mode: 'Markdown', ...menuKeyboard(lang, actorIsAdmin) });
    }

    // ===== feedback input =====
    if (user.waitingFeedback && text && !text.startsWith('/')) {
      if (/^(batal|cancel)$/i.test(text)) {
        user.waitingFeedback = false; saveData();
        return bot.sendMessage(chatId, texts.cancelled, menuKeyboard(lang, actorIsAdmin));
      }
      user.waitingFeedback = false; saveData();
      bot.sendMessage(ADMIN_ID, `📩 Feedback dari ${chatId}:\n${text}`).catch(()=>{});
      return bot.sendMessage(chatId, texts.feedbackThanks, menuKeyboard(lang, actorIsAdmin));
    }

    // ===== fallback keyword "selesai/done" (bypass admin) =====
    if (user.watching && (I.id.doneKeyword.test(text) || I.en.doneKeyword.test(text))) {
      const elapsed = Math.floor((now() - user.watchStart) / 1000);
      if (!actorIsAdmin && elapsed < MIN_WATCH_SECONDS) {
        user.watching = false; user.watchStart = 0; user.watchUnlockAt = 0;
        user.violations = (user.violations || 0) + 1;
        if (user.violations >= BAN_AFTER_VIOLATIONS) {
          user.bannedUntil = now() + BAN_DURATION_MS; saveData();
          return bot.sendMessage(chatId, texts.bannedMsg(user.bannedUntil), menuKeyboard(lang, actorIsAdmin));
        }
        saveData();
        return bot.sendMessage(chatId, texts.watchSkipWarn(user.violations), menuKeyboard(lang, actorIsAdmin));
      }
      // OK
      user.watching = false; user.watchStart = 0; user.watchUnlockAt = 0;
      user.points += POIN_PER_IKLAN; saveData();
      return bot.sendMessage(chatId, texts.watchOk(POIN_PER_IKLAN), { parse_mode: 'Markdown', ...menuKeyboard(lang, actorIsAdmin) });
    }

    // ===== MENU =====
    if (text === b[0]) { // Nonton Iklan
      if (!actorIsAdmin && user.bannedUntil && now() < user.bannedUntil) {
        return bot.sendMessage(chatId, texts.bannedMsg(user.bannedUntil));
      }
      user.watching = true;
      user.watchStart = now();
      user.watchUnlockAt = user.watchStart + MIN_WATCH_SECONDS * 1000;
      user.btnMsgId = null; user.btnChatId = null; user.btnExpireAt = 0;
      saveData();

      await bot.sendMessage(chatId, texts.watchIntro(MIN_WATCH_SECONDS), {
        parse_mode: 'Markdown',
        reply_markup: buildAdsInlineKeyboardFromDB()
      });

      // Setelah MIN_WATCH_SECONDS, kirim tombol "Selesai"
      setTimeout(async () => {
        const u = getUser(chatId);
        if (!u.watching) return;
        if (now() < u.watchUnlockAt) return; // safety
        try {
          const sent = await bot.sendMessage(chatId, "⏳ Waktu habis! Klik tombol di bawah untuk klaim poin:", {
            reply_markup: { inline_keyboard: [[{ text: "✅ Selesai", callback_data: `done_watch_${chatId}` }]] }
          });
          u.btnMsgId = sent.message_id;
          u.btnChatId = String(sent.chat.id);
          u.btnExpireAt = now() + DONE_BUTTON_EXPIRE_MS;
          saveData();

          // auto clear tombol setelah expire
          setTimeout(async () => {
            const u2 = getUser(chatId);
            if (!u2.btnMsgId || !u2.btnChatId) return;
            if (!u2.watching) return; // kalau sudah klaim, watching=false
            if (now() < (u2.btnExpireAt || 0)) return;
            try {
              await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: u2.btnChatId, message_id: u2.btnMsgId });
            } catch (_) {}
            u2.btnMsgId = null; u2.btnChatId = null; u2.btnExpireAt = 0;
            saveData();
          }, DONE_BUTTON_EXPIRE_MS + 800);
        } catch (_) {}
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

    if (text === b[3]) { // Withdraw
      if (!user.wallet) {
        user.waitingWallet = true; saveData();
        return bot.sendMessage(chatId, texts.askWallet);
      }
      if (user.points < MIN_WITHDRAW) {
        return bot.sendMessage(chatId, texts.wdMin(MIN_WITHDRAW), menuKeyboard(lang, actorIsAdmin));
      }
      const req = { amount: user.points, wallet: user.wallet, createdAt: now() };
      user.pendingWithdraw = req; saveData();
      await bot.sendMessage(ADMIN_ID, texts.adminWd(chatId, req.amount, req.wallet), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
          { text: '✅ Konfirmasi', callback_data: `confirm_withdraw_${chatId}` },
          { text: '❌ Tolak', callback_data: `reject_withdraw_${chatId}` }
        ]]}
      });
      return bot.sendMessage(chatId, texts.wdSent, menuKeyboard(lang, actorIsAdmin));
    }

    if (text === b[4]) { // Wallet
      user.waitingWallet = true; saveData();
      return bot.sendMessage(chatId, texts.askWallet);
    }

    if (text === b[5]) { // Dashboard
      return bot.sendMessage(chatId, texts.balance(user), { parse_mode: 'Markdown', ...menuKeyboard(lang, actorIsAdmin) });
    }

    if (text === b[6]) { // Ganti Bahasa
      return bot.sendMessage(chatId, I['id'].chooseLang, {
        reply_markup: { inline_keyboard: [[
          { text: "🇮🇩 Indonesia", callback_data: "set_lang_id" },
          { text: "🇺🇸 English", callback_data: "set_lang_en" }
        ]]}
      });
    }

    if (text === b[7]) { // Tentang
      return bot.sendMessage(chatId, texts.about, { parse_mode: 'Markdown' });
    }

    if (text === b[8]) { // Peraturan
      return bot.sendMessage(chatId, texts.rules, { parse_mode: 'Markdown' });
    }

    if (text === b[9]) { // Feedback
      user.waitingFeedback = true; saveData();
      return bot.sendMessage(chatId, texts.feedbackAsk);
    }

    if (actorIsAdmin && text === I[lang].buttons[10]) { // Panel Admin (menu tombol)
      return bot.sendMessage(chatId, '🔧 *Admin Panel*', { parse_mode: 'Markdown', reply_markup: adminMainKeyboard() });
    }

    // fallback: diam
  } catch (err) {
    console.error('message handler error', err);
  }
});

// ===== Inline callback untuk Block/Unblock dari flow =====
bot.on('callback_query', async q => {
  try {
    const data = q.data || '';
    const actorId = String(q.from.id);
    if (!isAdmin(actorId)) return;

    if (data.startsWith('adm_blk_do_') || data.startsWith('adm_unblk_do_')) {
      const uid = data.replace(/^adm_blk_do_|^adm_unblk_do_/, '');
      const u = getUser(uid);
      if (data.startsWith('adm_blk_do_')) {
        u.bannedUntil = now() + ADMIN_BLOCK_DURATION_MS;
        u.violations = 0;
        saveData();
        await bot.answerCallbackQuery(q.id, { text: `🚫 User ${uid} diblock` });
        await bot.sendMessage(uid, '🚫 Akses kamu diblokir oleh admin.').catch(()=>{});
      } else {
        u.bannedUntil = 0;
        u.violations = 0;
        saveData();
        await bot.answerCallbackQuery(q.id, { text: `✅ User ${uid} di-unblock` });
        await bot.sendMessage(uid, '✅ Akses kamu telah diaktifkan kembali oleh admin.').catch(()=>{});
      }
    }
  } catch (e) {
    console.error('inline block/unblock error', e);
  }
});

// Save on exit
process.on('SIGINT', () => { saveData(); process.exit(); });
process.on('SIGTERM', () => { saveData(); process.exit(); });

console.log('Bot script loaded. Jalankan dan cek log Replit untuk pesan aktif.');