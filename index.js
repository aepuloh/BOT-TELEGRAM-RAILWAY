// index.js — Bot AdsRewards (ID + EN) Replit-ready + Admin Sub Panel (Refactor)
// -------------------------------------------------------------------
// DEPENDENCIES
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const app = express();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '1301848698'); // <- default ke 1301848698 sesuai permintaan
const REPL_URL = process.env.REPL_URL || '';
const USERS_FILE = 'users.json';

const POIN_PER_IKLAN = 1;
const BONUS_REFERRAL = 10;      // bonus sekali saat user baru join lewat ref
const BONUS_HARIAN = 5;
const MIN_WITHDRAW = 100;
const RATE_IDR_PER_100PTS = 5000; // 100 poin = Rp 5000 (note di menu withdraw)
const MIN_WATCH_SECONDS = 30;              // minimal detik nonton
const BAN_AFTER_VIOLATIONS = 3;            // auto-ban setelah N pelanggaran
const BAN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 jam
const DONE_BUTTON_EXPIRE_MS = 5 * 60 * 1000; // tombol “Selesai” kedaluwarsa

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
  catch (e) { console.error('⚠️ Gagal simpan users.json', e);
  }
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
      walletUSDT: null,     // alamat USDT (opsional)
      danaNumber: null,     // nomor DANA (opsional)
      bankName: null,       // nama bank (opsional)
      bankAccount: null,    // nomor rekening (opsional)
      lang: 'id',
      // referral
      refBy: null,          // siapa yang mereferensikan
      // watch session
      watching: false,
      watchStart: 0,
      watchUnlockAt: 0,
      btnMsgId: null,
      btnChatId: null,
      btnExpireAt: 0,
      // compliance
      violations: 0,
      bannedUntil: 0,       // ban sementara
      blocked: false,       // block permanen by admin
      // misc
      lastBonus: 0,
      waitingWallet: false,
      waitingFeedback: false,
      pendingWithdraw: null, // { amountPoints, method, details, createdAt }
      // input state machine
      state: null,           // e.g. 'set_wallet_usdt','set_wallet_dana','set_wallet_bank_name','set_wallet_bank_account','withdraw_choose_amount', 'admin_broadcast', 'admin_adjust_points_user', 'admin_adjust_points_amount', 'admin_block_user', 'admin_unblock_user'
      tmp: {}                // temp data for multi-step
    };
  }
  return db.users[id];
}

// ===== I18N =====
const I = {
  id: {
    buttons: [
      "🎯 Nonton Iklan","🎁 Bonus Harian","👥 Referral","💸 Withdraw",
      "💼 Wallet","📊 Dashboard","🌐 Ganti Bahasa","ℹ️ Tentang Kami",
      "📜 Peraturan","✉️ Feedback","🛠 Panel Admin"
    ],
    chooseLang: "Pilih Bahasa / Choose Language",
    start: "Selamat datang di *Bot AdsRewards*! Tukarkan poin kamu menjadi USDT atau Rupiah (DANA/Bank).",
    about: "Bot ini memberikan reward menonton iklan. Ikuti peraturan agar tidak diblok.",
    rules: "PERATURAN:\n1. Dilarang menggunakan bot/script otomatis.\n2. Satu orang hanya boleh satu akun.\n3. Dilarang spam/klik otomatis.\n4. Admin berhak memblokir pelanggar.\n5. Withdraw sesuai data wallet/DANA/Bank yang kamu set.",
    watchIntro: sec => `📺 *Silakan pilih iklan untuk ditonton:*\n⏳ Tonton minimal *${sec} detik*. Tombol klaim akan muncul otomatis setelah waktu habis.`,
    watchOk: p => `✅ +${p} poin!`,
    watchSkipWarn: n => `⚠️ Kamu melakukan skip. Peringatan (${n}/${BAN_AFTER_VIOLATIONS}). Jika mencapai ${BAN_AFTER_VIOLATIONS}, akun diblok sementara 24 jam.`,
    bannedMsg: until => `🚫 Kamu diblok sampai ${new Date(until).toLocaleString()}.`,
    blockedMsg: "🚫 Akunmu diblokir oleh admin.",
    balance: u => `📊 Saldo: *${u.points} poin*\n💼 USDT: ${u.walletUSDT || '-'}\n📱 DANA: ${u.danaNumber || '-'}\n🏦 Bank: ${u.bankName && u.bankAccount ? `${u.bankName} - ${u.bankAccount}` : '-' }\n👥 Referral: *${u.referrals}*`,
    askSetWallet: "Pilih jenis data pembayaran yang ingin diatur:",
    setWalletBtns: {
      usdt: "💼 Set Alamat USDT",
      dana: "📱 Set Nomor DANA",
      bank: "🏦 Set Rekening Bank",
      back: "↩️ Kembali ke Menu"
    },
    askUSDT: "Kirim alamat wallet USDT (TRC20/ERC20):",
    askDANA: "Kirim nomor DANA kamu:",
    askBankName: "Kirim *Nama Bank* (contoh: BCA/BRI/BNI/Mandiri/Jago/SeaBank/dll).",
    askBankAccount: "Kirim *Nomor Rekening Bank*:",
    savedUSDT: a => `✅ Alamat USDT disimpan:\n\`${a}\``,
    savedDANA: a => `✅ Nomor DANA disimpan: ${a}`,
    savedBank: (n,a) => `✅ Rekening disimpan: ${n} - ${a}`,
    withdrawNote: (min,rate)=> `💸 *Withdraw*\n• Minimal withdraw: *${min} poin*\n• Rate: *100 poin = Rp ${rate.toLocaleString('id-ID')}*\n\nPilih metode pencairan:`,
    withdrawBtns: { usdt: "💼 USDT", dana: "📱 DANA", bank: "🏦 Bank", cancel: "❎ Batal" },
    askWithdrawAmount: (bal)=> `Masukkan *jumlah poin* yang ingin ditarik (saldo: ${bal} poin).`,
    wdMin: min => `❌ Minimal withdraw ${min} poin.`,
    wdNoMethodSetup: m => `⚠️ Kamu belum mengisi data ${m}. Silakan set dulu di menu Wallet.`,
    wdSent: "✅ Permintaan withdraw dikirim ke admin. Tunggu konfirmasi.",
    wdConfirmed: "✅ Withdraw kamu telah dikonfirmasi admin.",
    feedbackAsk: "✍️ Tulis feedback kamu (ketik batal untuk membatalkan):",
    feedbackThanks: "✅ Feedback terkirim, terima kasih!",
    dailyBonusAgain: "⏳ Bonus harian sudah diambil, coba lagi besok.",
    dailyBonusOk: p => `🎁 Bonus harian +${p} poin!`,
    cancelled: "❎ Dibatalkan.",
    referralLink: (botUsername, id) => `🔗 Bagikan link referral kamu:\nhttps://t.me/${botUsername}?start=ref${id}`,
    doneKeyword: /^(selesai|done)$/i,
    // Admin strings
    adminTitle: "🛠 *Panel Admin*",
    adminMenu: {
      users: "👥 Total User",
      broadcast: "📢 Broadcast Pesan",
      points: "➕➖ Atur Poin User",
      block: "⛔ Block User",
      unblock: "✅ Unblock User",
      withdraws: "💸 Pending Withdraw",
      ads: "📺 Kelola Iklan",
      close: "↩️ Tutup"
    },
    adminAskBroadcast: "Kirim isi pesan broadcast (ketik batal untuk membatalkan).",
    adminBroadcastStarted: "🚀 Broadcast dimulai...",
    adminBroadcastDone: (ok,fail)=> `Broadcast selesai. Terkirim: ${ok}, Gagal: ${fail}.`,
    adminAskUserIdPoints: "Kirim *ID user* yang akan diubah poinnya:",
    adminAskDeltaPoints: "Kirim jumlah poin (misal: 50 atau -20):",
    adminPointsUpdated: (id,pts)=> `✅ Poin user ${id} sekarang: ${pts}`,
    adminAskBlockUser: "Kirim *ID user* yang akan di-*block permanently*:",
    adminAskUnblockUser: "Kirim *ID user* yang akan di-*unblock*:",
    adminBlocked: id => `✅ User ${id} *diblock*.`,
    adminUnblocked: id => `✅ User ${id} *diunblock*.`,
    noPendingWd: "Tidak ada withdraw pending.",
    adminWdItem: (uid, req) => `• User: ${uid}\n• Metode: ${req.method}\n• Detail: ${req.details}\n• Poin: ${req.amountPoints}\n• Waktu: ${new Date(req.createdAt).toLocaleString('id-ID')}`
  },
  en: {
    // keep minimal EN for core flows
    buttons: ["🎯 Watch Ads","🎁 Daily Bonus","👥 Referral","💸 Withdraw","💼 Wallet","📊 Dashboard","🌐 Change Language","ℹ️ About Us","📜 Rules","✉️ Feedback","🛠 Admin Panel"],
    chooseLang: "Pilih Bahasa / Choose Language",
    start: "Welcome to *AdsRewards Bot*!",
    about: "This bot rewards watching ads.",
    rules: "Follow the rules.",
    watchIntro: sec => `📺 Pick an ad. Watch at least *${sec}s*.`,
    watchOk: p => `✅ +${p} points!`,
    watchSkipWarn: n => `⚠️ You skipped. Warning (${n}/${BAN_AFTER_VIOLATIONS}).`,
    bannedMsg: until => `🚫 You are banned until ${new Date(until).toLocaleString()}.`,
    blockedMsg: "🚫 Your account is blocked by admin.",
    balance: u => `📊 Balance: *${u.points}*\nUSDT: ${u.walletUSDT || '-'}\nDANA: ${u.danaNumber || '-'}\nBank: ${u.bankName && u.bankAccount ? `${u.bankName} - ${u.bankAccount}` : '-' }\nReferrals: *${u.referrals}*`,
    askSetWallet: "Choose which payment info to set:",
    setWalletBtns: { usdt: "💼 Set USDT", dana: "📱 Set DANA", bank: "🏦 Set Bank", back: "↩️ Back" },
    askUSDT: "Send your USDT wallet address:",
    askDANA: "Send your DANA number:",
    askBankName: "Send *Bank Name*:",
    askBankAccount: "Send *Bank Account Number*:",
    savedUSDT: a => `✅ USDT saved:\n\`${a}\``,
    savedDANA: a => `✅ DANA saved: ${a}`,
    savedBank: (n,a) => `✅ Bank saved: ${n} - ${a}`,
    withdrawNote: (min,rate)=> `💸 *Withdraw*\n• Minimum: *${min} points*\n• Rate: *100 points = Rp ${rate.toLocaleString('id-ID')}*\n\nChoose method:`,
    withdrawBtns: { usdt: "💼 USDT", dana: "📱 DANA", bank: "🏦 Bank", cancel: "❎ Cancel" },
    askWithdrawAmount: (bal)=> `Send *points amount* to withdraw (balance: ${bal}).`,
    wdMin: min => `❌ Minimum withdraw ${min} points.`,
    wdNoMethodSetup: m => `⚠️ You haven't set ${m} info. Please set it first in Wallet.`,
    wdSent: "✅ Withdraw request sent to admin.",
    wdConfirmed: "✅ Withdraw confirmed.",
    feedbackAsk: "✍️ Send feedback (type cancel to abort):",
    feedbackThanks: "✅ Thanks!",
    dailyBonusAgain: "⏳ Already claimed, try tomorrow.",
    dailyBonusOk: p => `🎁 Daily bonus +${p} points!`,
    cancelled: "❎ Cancelled.",
    referralLink: (botUsername, id) => `🔗 Share your referral link:\nhttps://t.me/${botUsername}?start=ref${id}`,
    doneKeyword: /^(done|selesai)$/i,
    adminTitle: "🛠 *Admin Panel*",
    adminMenu: {
      users: "👥 Total Users",
      broadcast: "📢 Broadcast",
      points: "➕➖ Adjust Points",
      block: "⛔ Block User",
      unblock: "✅ Unblock User",
      withdraws: "💸 Pending Withdraws",
      ads: "📺 Manage Ads",
      close: "↩️ Close"
    },
    adminAskBroadcast: "Send broadcast text (type cancel to abort).",
    adminBroadcastStarted: "🚀 Broadcasting...",
    adminBroadcastDone: (ok,fail)=> `Done. Sent: ${ok}, Failed: ${fail}.`,
    adminAskUserIdPoints: "Send *user ID* whose points to change:",
    adminAskDeltaPoints: "Send delta points (e.g. 50 or -20):",
    adminPointsUpdated: (id,pts)=> `✅ User ${id} points: ${pts}`,
    adminAskBlockUser: "Send *user ID* to *block permanently*: ",
    adminAskUnblockUser: "Send *user ID* to *unblock*: ",
    adminBlocked: id => `✅ User ${id} blocked.`,
    adminUnblocked: id => `✅ User ${id} unblocked.`,
    noPendingWd: "No pending withdraws.",
    adminWdItem: (uid, req) => `• User: ${uid}\n• Method: ${req.method}\n• Detail: ${req.details}\n• Points: ${req.amountPoints}\n• Time: ${new Date(req.createdAt).toLocaleString()}`
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

// ===== ADMIN PANELS (inline) =====
const ADMIN_STATES = {}; // { [adminId]: { mode, step, tmp } }

function adminMainKeyboardInline(lang='id') {
  const m = I[lang].adminMenu;
  return {
    inline_keyboard: [
      [{ text: m.users, callback_data: 'adm_users_count' }],
      [{ text: m.broadcast, callback_data: 'adm_broadcast' }],
      [{ text: m.points, callback_data: 'adm_points' }],
      [{ text: m.block, callback_data: 'adm_block' }, { text: m.unblock, callback_data: 'adm_unblock' }],
      [{ text: m.withdraws, callback_data: 'adm_wd_list' }],
      [{ text: m.ads, callback_data: 'adm_ads_root' }],
      [{ text: m.close, callback_data: 'adm_close' }]
    ]
  };
}

function adminAdsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📋 Lihat Iklan', callback_data: 'adm_ads_list' }],
      [{ text: '✅ Aktif/Nonaktif', callback_data: 'adm_ads_toggle_menu' }],
      [{ text: '➕ Tambah Iklan', callback_data: 'adm_ads_add' }],
      [{ text: '🗑 Hapus Iklan', callback_data: 'adm_ads_delete_menu' }],
      [{ text: '↩️ Kembali', callback_data: 'adm_back_root' }]
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
    const lang = actor.lang || 'id';

    // set language
    if (data === 'set_lang_id' || data === 'set_lang_en') {
      actor.lang = data.endsWith('_id') ? 'id' : 'en';
      saveData();
      await bot.answerCallbackQuery(q.id, { text: '✅ OK' });
      return bot.sendMessage(actorId, T(actor).start, { parse_mode: 'Markdown', ...menuKeyboard(actor.lang, actorIsAdmin) });
    }

    // ===== ADMIN ROOT PANEL =====
    if (data === 'adm_close') {
      await bot.answerCallbackQuery(q.id, { text: 'OK' });
      return bot.deleteMessage(chatIdOfMsg, q.message.message_id).catch(()=>{});
    }
    if (data === 'adm_back_root') {
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText(I[lang].adminTitle, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: adminMainKeyboardInline(lang)
      }).catch(()=>{});
    }
    if (data === 'adm_users_count') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      const total = Object.keys(db.users).length;
      return bot.editMessageText(`👥 Total user: *${total}*`, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: adminMainKeyboardInline(lang)
      }).catch(()=>{});
    }
    if (data === 'adm_broadcast') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'broadcast' };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText(I[lang].adminAskBroadcast, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: adminMainKeyboardInline(lang)
      }).catch(()=>{});
    }
    if (data === 'adm_points') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'points', step: 'ask_user' };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText(I[lang].adminAskUserIdPoints, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: adminMainKeyboardInline(lang)
      }).catch(()=>{});
    }
    if (data === 'adm_block') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'block' };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText(I[lang].adminAskBlockUser, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: adminMainKeyboardInline(lang)
      }).catch(()=>{});
    }
    if (data === 'adm_unblock') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'unblock' };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText(I[lang].adminAskUnblockUser, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: adminMainKeyboardInline(lang)
      }).catch(()=>{});
    }
    if (data === 'adm_wd_list') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      // render pending withdraws
      const pending = Object.entries(db.users).filter(([uid,u]) => !!u.pendingWithdraw);
      if (!pending.length) {
        return bot.editMessageText(I[lang].noPendingWd, {
          chat_id: chatIdOfMsg, message_id: q.message.message_id,
          reply_markup: adminMainKeyboardInline(lang)
        }).catch(()=>{});
      }
      // show first page (simple)
      const chunks = pending.slice(0, 10);
      let txt = `💸 *Pending Withdraw (${pending.length})*\n\n`;
      const kb = [];
      for (const [uid,u] of chunks) {
        txt += I[lang].adminWdItem(uid, u.pendingWithdraw) + '\n\n';
        kb.push([
          { text: `✅ Terima (${uid})`, callback_data: `confirm_withdraw_${uid}` },
          { text: `❌ Tolak (${uid})`, callback_data: `reject_withdraw_${uid}` }
        ]);
      }
      kb.push([{ text: '↩️ Kembali', callback_data: 'adm_back_root' }]);
      return bot.editMessageText(txt, {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: kb }
      }).catch(()=>{});
    }
    if (data === 'adm_ads_root') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('📺 *Kelola Iklan*', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: adminAdsKeyboard()
      }).catch(()=>{});
    }

    // ===== withdraw admin actions (confirm/reject) =====
    if (data.startsWith('confirm_withdraw_') || data.startsWith('reject_withdraw_')) {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      const targetId = data.replace(/^confirm_withdraw_|^reject_withdraw_/, '');
      const target = getUser(targetId);
      if (!target.pendingWithdraw) {
        await bot.answerCallbackQuery(q.id, { text: 'Sudah tidak pending.' });
        return;
      }
      if (data.startsWith('confirm_withdraw_')) {
        target.points = Math.max(0, target.points - target.pendingWithdraw.amountPoints);
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

    // ===== admin ads manager (inline sub-panel) =====
    if (data === 'adm_close') {
      await bot.answerCallbackQuery(q.id, { text: 'OK' });
      return bot.deleteMessage(chatIdOfMsg, q.message.message_id).catch(()=>{});
    }
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
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_root' }]);
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
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_root' }]);
      return bot.editMessageReplyMarkup({ inline_keyboard: rows }, { chat_id: chatIdOfMsg, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data === 'adm_ads_delete_menu') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      await bot.answerCallbackQuery(q.id);
      if (!db.ads?.length) {
        return bot.editMessageText('Tidak ada iklan untuk dihapus.', { chat_id: chatIdOfMsg, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
      }
      const rows = db.ads.map((a, i) => [{ text: `🗑 Hapus — ${a.name}`, callback_data: `adm_delete_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_root' }]);
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
        return bot.editMessageText('Semua iklan terhapus.', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: adminAdsKeyboard() }).catch(()=>{});
      }
      const rows = db.ads.map((a, i) => [{ text: `🗑 Hapus — ${a.name}`, callback_data: `adm_delete_${i}` }]);
      rows.push([{ text: '↩️ Kembali', callback_data: 'adm_ads_root' }]);
      return bot.editMessageReplyMarkup({ inline_keyboard: rows }, { chat_id: q.message.chat.id, message_id: q.message.message_id }).catch(()=>{});
    }
    if (data === 'adm_ads_add') {
      if (!actorIsAdmin) return bot.answerCallbackQuery(q.id, { text: '❗ Admin only', show_alert: true });
      ADMIN_STATES[actorId] = { mode: 'add_ad', step: 'name', tmp: {} };
      await bot.answerCallbackQuery(q.id);
      return bot.editMessageText('➕ Kirim *Nama Iklan* (contoh: Iklan 3):', {
        chat_id: chatIdOfMsg, message_id: q.message.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '↩️ Kembali', callback_data: 'adm_ads_root' }]] }
      }).catch(()=>{});
    }

    // ===== tombol "Selesai" (done_watch_<chatIdPemilikSesi>) =====
    if (data.startsWith('done_watch_')) {
      const targetChatId = data.replace('done_watch_', '');
      if (actorId !== targetChatId) {
        return bot.answerCallbackQuery(q.id, { text: '❗ Tombol bukan untukmu', show_alert: true });
      }
      const u = getUser(targetChatId);

      if (!isAdmin(actorId)) {
        if (u.blocked) return bot.answerCallbackQuery(q.id, { text: T(u).blockedMsg, show_alert: true });
        if (u.bannedUntil && now() < u.bannedUntil) {
          return bot.answerCallbackQuery(q.id, { text: T(u).bannedMsg(u.bannedUntil), show_alert: true });
        }
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

// ===== /start & referral (BONUS HANYA 1x) =====
bot.onText(/^\/start(?:\s+(.+))?$/i, (msg, match) => {
  const chatId = String(msg.chat.id);
  const isNew = !db.users[chatId];     // cek sebelum getUser
  const ref = match?.[1]?.trim();
  const user = getUser(chatId);

  // referral: /start ref123 atau /start 123
  if (isNew && ref) {
    const refId = ref.startsWith('ref') ? ref.replace(/^ref/, '') : ref;
    if (refId !== chatId && db.users[refId]) {
      user.refBy = refId;
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
  const lang = getUser(chatId).lang || 'id';
  bot.sendMessage(chatId, I[lang].adminTitle, { parse_mode: 'Markdown', reply_markup: adminMainKeyboardInline(lang) });
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

    // ===== ADMIN STATE FLOWS (typed input) =====
    if (actorIsAdmin && ADMIN_STATES[chatId]?.mode) {
      const st = ADMIN_STATES[chatId];

      // cancel keywords
      if (/^(batal|cancel|/cancel)$/i.test(text)) {
        delete ADMIN_STATES[chatId];
        return bot.sendMessage(chatId, '❎ Dibatalkan.', { reply_markup: adminMainKeyboardInline(lang) });
      }

      if (st.mode === 'broadcast') {
        delete ADMIN_STATES[chatId];
        await bot.sendMessage(chatId, texts.adminBroadcastStarted);
        const ids = Object.keys(db.users);
        let ok=0, fail=0;
        for (const uid of ids) {
          try { await bot.sendMessage(uid, text); ok++; }
          catch { fail++; }
          await new Promise(r=>setTimeout(r, 30)); // throttle ringan
        }
        return bot.sendMessage(chatId, texts.adminBroadcastDone(ok,fail), { reply_markup: adminMainKeyboardInline(lang) });
      }

      if (st.mode === 'points') {
        if (st.step === 'ask_user') {
          st.target = safeString(text);
          if (!db.users[st.target]) return bot.sendMessage(chatId, '❌ User tidak ditemukan. Kirim ulang ID user.');
          st.step = 'ask_delta';
          return bot.sendMessage(chatId, texts.adminAskDeltaPoints);
        } else if (st.step === 'ask_delta') {
          const delta = Number(text);
          if (!Number.isFinite(delta)) return bot.sendMessage(chatId, '❌ Format tidak valid. Kirim angka (mis: 50 atau -20).');
          const target = getUser(st.target);
          target.points = Math.max(0, (target.points || 0) + delta);
          saveData();
          delete ADMIN_STATES[chatId];
          return bot.sendMessage(chatId, texts.adminPointsUpdated(st.target, target.points), { reply_markup: adminMainKeyboardInline(lang) });
        }
      }

      if (st.mode === 'block') {
        const targetId = safeString(text);
        if (!db.users[targetId]) return bot.sendMessage(chatId, '❌ User tidak ditemukan.');
        const u = getUser(targetId);
        u.blocked = true; saveData();
        delete ADMIN_STATES[chatId];
        return bot.sendMessage(chatId, texts.adminBlocked(targetId), { reply_markup: adminMainKeyboardInline(lang) });
      }

      if (st.mode === 'unblock') {
        const targetId = safeString(text);
        if (!db.users[targetId]) return bot.sendMessage(chatId, '❌ User tidak ditemukan.');
        const u = getUser(targetId);
        u.blocked = false; u.bannedUntil = 0; saveData();
        delete ADMIN_STATES[chatId];
        return bot.sendMessage(chatId, texts.adminUnblocked(targetId), { reply_markup: adminMainKeyboardInline(lang) });
      }

      // admin add AD flow (reusing earlier)
      if (st.mode === 'add_ad') {
        if (st.step === 'name') {
          st.tmp = st.tmp || {};
          st.tmp.name = text.slice(0, 64);
          st.step = 'url';
          return bot.sendMessage(chatId, '🔗 Kirim *URL Iklan* (harus http/https):', { parse_mode: 'Markdown' });
        }
        if (st.step === 'url') {
          if (!isValidHttpUrl(text)) return bot.sendMessage(chatId, '❌ URL tidak valid. Coba lagi (harus http/https).');
          st.tmp.url = text;
          st.step = 'active';
          return bot.sendMessage(chatId, 'Aktifkan sekarang? (ketik: ya / tidak)');
        }
        if (st.step === 'active') {
          const active = /^(ya|yes|y|true|aktif)$/i.test(text.toLowerCase());
          db.ads.push({ name: st.tmp.name, url: st.tmp.url, active });
          saveData();
          delete ADMIN_STATES[chatId];
          return bot.sendMessage(chatId, `✅ Iklan ditambahkan:\n• Nama: ${db.ads[db.ads.length-1].name}\n• URL: ${db.ads[db.ads.length-1].url}\n• Status: ${active ? 'AKTIF' : 'NONAKTIF'}`, { reply_markup: adminAdsKeyboard() });
        }
      }
      return;
    }

    // ===== BAN/BLOCK CHECK =====
    if (!actorIsAdmin) {
      if (user.blocked) return bot.sendMessage(chatId, texts.blockedMsg);
      if (user.bannedUntil && now() < user.bannedUntil) {
        return bot.sendMessage(chatId, texts.bannedMsg(user.bannedUntil));
      }
    }

    // ===== USER STATE FLOWS (typed input) =====
    if (user.state) {
      // cancel
      if (/^(batal|cancel)$/i.test(text)) {
        user.state = null; user.tmp = {}; saveData();
        return bot.sendMessage(chatId, texts.cancelled, menuKeyboard(lang, actorIsAdmin));
      }

      if (user.state === 'set_wallet_usdt') {
        user.walletUSDT = text;
        user.state = null; user.tmp = {}; saveData();
        return bot.sendMessage(chatId, texts.savedUSDT(user.walletUSDT), { parse_mode: 'Markdown', ...menuKeyboard(lang, actorIsAdmin) });
      }

      if (user.state === 'set_wallet_dana') {
        user.danaNumber = text;
        user.state = null; user.tmp = {}; saveData();
        return bot.sendMessage(chatId, texts.savedDANA(user.danaNumber), menuKeyboard(lang, actorIsAdmin));
      }

      if (user.state === 'set_wallet_bank_name') {
        user.tmp.bankName = text.slice(0, 40);
        user.state = 'set_wallet_bank_account'; saveData();
        return bot.sendMessage(chatId, texts.askBankAccount, { parse_mode: 'Markdown' });
      }
      if (user.state === 'set_wallet_bank_account') {
        user.bankName = user.tmp.bankName || user.bankName;
        user.bankAccount = text.slice(0, 40);
        user.state = null; user.tmp = {}; saveData();
        return bot.sendMessage(chatId, texts.savedBank(user.bankName, user.bankAccount), menuKeyboard(lang, actorIsAdmin));
      }

      if (user.state === 'withdraw_choose_amount') {
        const amount = Number(text);
        if (!Number.isFinite(amount) || amount <= 0) {
          return bot.sendMessage(chatId, '❌ Masukkan angka yang benar.');
        }
        if (amount < MIN_WITHDRAW) {
          user.state = null; user.tmp = {}; saveData();
          return bot.sendMessage(chatId, texts.wdMin(MIN_WITHDRAW), menuKeyboard(lang, actorIsAdmin));
        }
        if (amount > user.points) {
          return bot.sendMessage(chatId, `❌ Poin tidak cukup. Saldo: ${user.points}`);
        }
        // cek method readiness
        let method = user.tmp.withdrawMethod;
        let details = '';
        if (method === 'USDT') {
          if (!user.walletUSDT) {
            user.state = null; user.tmp = {}; saveData();
            return bot.sendMessage(chatId, texts.wdNoMethodSetup('USDT'), menuKeyboard(lang, actorIsAdmin));
          }
          details = user.walletUSDT;
        } else if (method === 'DANA') {
          if (!user.danaNumber) {
            user.state = null; user.tmp = {}; saveData();
            return bot.sendMessage(chatId, texts.wdNoMethodSetup('DANA'), menuKeyboard(lang, actorIsAdmin));
          }
          details = user.danaNumber;
        } else if (method === 'BANK') {
          if (!user.bankName || !user.bankAccount) {
            user.state = null; user.tmp = {}; saveData();
            return bot.sendMessage(chatId, texts.wdNoMethodSetup('Bank'), menuKeyboard(lang, actorIsAdmin));
          }
          details = `${user.bankName} - ${user.bankAccount}`;
        } else {
          user.state = null; user.tmp = {}; saveData();
          return bot.sendMessage(chatId, texts.cancelled, menuKeyboard(lang, actorIsAdmin));
        }

        user.pendingWithdraw = {
          amountPoints: amount,
          method,
          details,
          createdAt: now()
        };
        saveData();

        // kirim ke admin
        await bot.sendMessage(ADMIN_ID, `💸 Permintaan Withdraw\nUser: ${chatId}\nMetode: ${method}\nDetail: ${details}\nJumlah: ${amount} poin\n(100 poin = Rp ${RATE_IDR_PER_100PTS.toLocaleString('id-ID')})`, {
          reply_markup: { inline_keyboard: [[
            { text: '✅ Konfirmasi', callback_data: `confirm_withdraw_${chatId}` },
            { text: '❌ Tolak', callback_data: `reject_withdraw_${chatId}` }
          ]]}
        });

        user.state = null; user.tmp = {};
        saveData();
        return bot.sendMessage(chatId, texts.wdSent, menuKeyboard(lang, actorIsAdmin));
      }
      // end states
      return;
    }

    // ===== WALLET/FEEDBACK LEGACY FLAGS (compat) =====
    if (user.waitingFeedback && text && !text.startsWith('/')) {
      if (/^(batal|cancel)$/i.test(text)) {
        user.waitingFeedback = false; saveData();
        return bot.sendMessage(chatId, texts.cancelled, menuKeyboard(lang, actorIsAdmin));
      }
      user.waitingFeedback = false; saveData();
      bot.sendMessage(ADMIN_ID, `📩 Feedback dari ${chatId}:\n${text}`).catch(()=>{});
      return bot.sendMessage(chatId, texts.feedbackThanks, menuKeyboard(lang, actorIsAdmin));
    }

    // fallback keyword "selesai/done" (bypass admin)
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

    // === MENU ===
    if (text === b[0]) { // Nonton Iklan
      if (!actorIsAdmin) {
        if (user.blocked) return bot.sendMessage(chatId, texts.blockedMsg);
        if (user.bannedUntil && now() < user.bannedUntil) {
          return bot.sendMessage(chatId, texts.bannedMsg(user.bannedUntil));
        }
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
      // tampilkan note & pilih metode
      await bot.sendMessage(chatId, texts.withdrawNote(MIN_WITHDRAW, RATE_IDR_PER_100PTS), {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: texts.withdrawBtns.usdt, callback_data: 'wd_method_usdt' },
            { text: texts.withdrawBtns.dana, callback_data: 'wd_method_dana' },
            { text: texts.withdrawBtns.bank, callback_data: 'wd_method_bank' }
          ],[
            { text: texts.withdrawBtns.cancel, callback_data: 'wd_cancel' }
          ]]
        }
      });
      // simpan state agar callback bisa set method lalu minta jumlah
      user.tmp = user.tmp || {};
      user.tmp.openedWithdrawAt = now();
      saveData();
      return;
    }

    if (text === b[4]) { // Wallet
      // show submenu buttons
      return bot.sendMessage(chatId, texts.askSetWallet, {
        reply_markup: {
          inline_keyboard: [
            [{ text: texts.setWalletBtns.usdt, callback_data: 'set_wallet_usdt' }],
            [{ text: texts.setWalletBtns.dana, callback_data: 'set_wallet_dana' }],
            [{ text: texts.setWalletBtns.bank, callback_data: 'set_wallet_bank' }]
          ]
        }
      });
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

    if (actorIsAdmin && text === I[lang].buttons[10]) { // Panel Admin
      return bot.sendMessage(chatId, I[lang].adminTitle, { parse_mode: 'Markdown', reply_markup: adminMainKeyboardInline(lang) });
    }

    // ===== INLINE HANDLERS FOR WALLET & WITHDRAW SUBMENUS =====
    // handled in callback_query implicitly; but we also handle here using 'on' below

  } catch (err) {
    console.error('message handler error', err);
  }
});

// Extra inline handlers for wallet & withdraw selection
bot.on('callback_query', async q => {
  try {
    const data = q.data || '';
    const uid = String(q.from.id);
    const u = getUser(uid);
    const lang = u.lang || 'id';
    const texts = I[lang];

    // Wallet set
    if (data === 'set_wallet_usdt') {
      u.state = 'set_wallet_usdt'; u.tmp = {}; saveData();
      await bot.answerCallbackQuery(q.id);
      return bot.sendMessage(uid, texts.askUSDT, { parse_mode: 'Markdown' });
    }
    if (data === 'set_wallet_dana') {
      u.state = 'set_wallet_dana'; u.tmp = {}; saveData();
      await bot.answerCallbackQuery(q.id);
      return bot.sendMessage(uid, texts.askDANA);
    }
    if (data === 'set_wallet_bank') {
      u.state = 'set_wallet_bank_name'; u.tmp = {}; saveData();
      await bot.answerCallbackQuery(q.id);
      return bot.sendMessage(uid, texts.askBankName, { parse_mode: 'Markdown' });
    }

    // Withdraw method select
    if (data === 'wd_cancel') {
      await bot.answerCallbackQuery(q.id, { text: '❎' });
      return bot.sendMessage(uid, texts.cancelled);
    }
    if (data === 'wd_method_usdt' || data === 'wd_method_dana' || data === 'wd_method_bank') {
      u.tmp = u.tmp || {};
      u.tmp.withdrawMethod = data.endsWith('usdt') ? 'USDT' : data.endsWith('dana') ? 'DANA' : 'BANK';
      u.state = 'withdraw_choose_amount'; saveData();
      await bot.answerCallbackQuery(q.id);
      return bot.sendMessage(uid, texts.askWithdrawAmount(u.points), { parse_mode: 'Markdown' });
    }

  } catch (e) {
    // ignore
  }
});

// Save on exit
process.on('SIGINT', () => { saveData(); process.exit(); });
process.on('SIGTERM', () => { saveData(); process.exit(); });

console.log('Bot script loaded. Jalankan dan cek log Replit untuk pesan aktif.');
