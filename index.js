// =========================
// index.js — Bot AdsRewards (Full + Admin Panel Fix)
// =========================

// ===== DEPENDENCIES =====
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const app = express();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN; // Token dari @BotFather
const ADMIN_ID = String(process.env.ADMIN_ID || ''); // ID Admin
const REPL_URL = process.env.REPL_URL || ''; // Untuk keep-alive di Replit
const USERS_FILE = 'users.json';

const POIN_PER_IKLAN = 1;
const BONUS_REFERRAL = 10;
const BONUS_HARIAN = 5;
const MIN_WITHDRAW = 100;
const MIN_WATCH_SECONDS = 30;
const BAN_AFTER_VIOLATIONS = 3;
const BAN_DURATION_MS = 24 * 60 * 60 * 1000;
const ADMIN_BLOCK_DURATION_MS = 100 * 365 * 24 * 60 * 60 * 1000;
const DONE_BUTTON_EXPIRE_MS = 5 * 60 * 1000;

if (!TOKEN) { console.error('❌ TOKEN belum diatur di Secrets.'); process.exit(1); }
if (!ADMIN_ID) { console.error('❌ ADMIN_ID belum diatur di Secrets.'); process.exit(1); }

// ===== KEEP ALIVE =====
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

// ===== LOAD / SAVE DB =====
let db = { users: {}, ads: [], withdraws: [] };
try {
  if (fs.existsSync(USERS_FILE)) {
    const raw = fs.readFileSync(USERS_FILE);
    db = JSON.parse(raw);
  }
} catch (e) { console.error('Gagal load users.json', e); }

function saveDB() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2));
}

// ===== BOT SETUP =====
const bot = new TelegramBot(TOKEN, { polling: true });
// =========================
// PART 2 — /start, Multi-bahasa, Menu Utama
// =========================

// ======= MULTI BAHASA =======
const LANG = {
  id: {
    welcome: (name) => `Halo ${name || ''}! Selamat datang di AdsRewards Bot.\nKlik menu untuk mulai mendapatkan poin dengan menonton iklan.`,
    menu_title: 'Menu Utama',
    btn_watch: '🎬 Tonton Iklan',
    btn_daily: '🎁 Bonus Harian',
    btn_wallet: '💼 Wallet',
    btn_ref: '🔗 Ajak Teman',
    btn_about: 'ℹ️ Tentang',
    btn_rules: '📜 Peraturan',
    btn_feedback: '✉️ Feedback',
    btn_admin: '🛠 Admin Panel'
  },
  en: {
    welcome: (name) => `Hi ${name || ''}! Welcome to AdsRewards Bot.\nUse the menu to start earning points by watching ads.`,
    menu_title: 'Main Menu',
    btn_watch: '🎬 Watch Ads',
    btn_daily: '🎁 Daily Bonus',
    btn_wallet: '💼 Wallet',
    btn_ref: '🔗 Refer',
    btn_about: 'ℹ️ About',
    btn_rules: '📜 Rules',
    btn_feedback: '✉️ Feedback',
    btn_admin: '🛠 Admin Panel'
  }
};

// Helper getLang
function getLang(userId) {
  const u = db.users[userId];
  if (!u) return 'id';
  return u.lang || 'id';
}

// ======= MENU KEYBOARDS =======
function mainMenuKeyboard(userId) {
  const lang = getLang(userId);
  const L = LANG[lang];
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: L.btn_watch, callback_data: 'watch_ads' }, { text: L.btn_daily, callback_data: 'daily_bonus' }],
        [{ text: L.btn_wallet, callback_data: 'wallet' }, { text: L.btn_ref, callback_data: 'referral' }],
        [{ text: L.btn_about, callback_data: 'about' }, { text: L.btn_rules, callback_data: 'rules' }],
        [{ text: L.btn_feedback, callback_data: 'feedback' }]
      ]
    }
  };
  // show admin button only to admin
  if (isAdmin(userId)) {
    keyboard.reply_markup.inline_keyboard.push([{ text: LANG[lang].btn_admin, callback_data: 'admin_panel' }]);
  }
  return keyboard;
}

// ======= /start handler =======
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const name = msg.from && (msg.from.first_name || msg.from.username) || 'User';
  // if not exists, create user object with defaults
  if (!db.users[chatId]) {
    db.users[chatId] = {
      id: chatId,
      name: name,
      points: 0,
      lang: 'id',          // default bahasa indonesia
      lastDaily: 0,
      watchedAds: {},
      banned: false
    };
    saveDB();
  } else {
    // update name if changed
    db.users[chatId].name = name;
    saveDB();
  }

  const lang = getLang(chatId);
  const L = LANG[lang];
  bot.sendMessage(chatId, L.welcome(name), mainMenuKeyboard(chatId));
});

// ======= Quick language switch commands (optional) =======
bot.onText(/\/lang (id|en)/i, (msg, match) => {
  const chatId = msg.chat.id;
  const newLang = (match && match[1]) ? match[1].toLowerCase() : 'id';
  if (!db.users[chatId]) {
    db.users[chatId] = { id: chatId, name: msg.from.first_name || '', points: 0, lang: newLang, lastDaily: 0, watchedAds: {}, banned: false };
  } else {
    db.users[chatId].lang = newLang;
  }
  saveDB();
  bot.sendMessage(chatId, `✅ Bahasa diubah ke ${newLang}`, mainMenuKeyboard(chatId));
});

// ======= Generic menu callback router (basic) =======
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const uid = chatId;

  // if user not registered create (safety)
  if (!db.users[uid]) {
    db.users[uid] = { id: uid, name: q.from.first_name || '', points: 0, lang: 'id', lastDaily: 0, watchedAds: {}, banned: false };
    saveDB();
  }

  // BAN check
  if (db.users[uid] && db.users[uid].banned) {
    await bot.answerCallbackQuery(q.id, { text: '❌ Akun diblokir.', show_alert: true });
    return;
  }

  // Simple routing for main menu items — detailed handlers will be in later parts
  if (data === 'watch_ads') {
    // will be implemented in Part 3
    await bot.answerCallbackQuery(q.id);
    await bot.sendMessage(chatId, '📺 Menu nonton iklan — sedang membuka... (fungsi implementasi di Part 3).');
    return;
  }

  if (data === 'daily_bonus') {
    await bot.answerCallbackQuery(q.id);
    await bot.sendMessage(chatId, '🎁 Bonus harian — sedang membuka... (fungsi implementasi di Part 3).');
    return;
  }

  if (data === 'wallet') {
    await bot.answerCallbackQuery(q.id);
    await bot.sendMessage(chatId, '💼 Wallet — sedang membuka... (fungsi implementasi di Part 4).');
    return;
  }

  if (data === 'referral') {
    await bot.answerCallbackQuery(q.id);
    const refLink = `https://t.me/${(bot.options && bot.options.username) || 'YourBot'}?start=${chatId}`;
    await bot.sendMessage(chatId, `🔗 Ajak teman dengan link ini:\n${refLink}`);
    return;
  }

  if (data === 'about') {
    await bot.answerCallbackQuery(q.id);
    await bot.sendMessage(chatId, 'ℹ️ Tentang: AdsRewards Bot — Dapatkan poin dengan menonton iklan.');
    return;
  }

  if (data === 'rules') {
    await bot.answerCallbackQuery(q.id);
    await bot.sendMessage(chatId, '📜 Peraturan: Hindari kecurangan. Pelanggaran akan diblokir.');
    return;
  }

  if (data === 'feedback') {
    await bot.answerCallbackQuery(q.id);
    await bot.sendMessage(chatId, '✉️ Kirim umpan balik dengan mengetik pesan ke bot (atau gunakan perintah /feedback).');
    return;
  }

  if (data === 'admin_panel') {
    // admin panel handling moved to Part 5 — safe redirect so button works now
    await bot.answerCallbackQuery(q.id);
    if (!isAdmin(q.from.id)) {
      await bot.sendMessage(chatId, '❌ Kamu bukan admin.');
      return;
    }
    // instruct admin to use /admin command for full panel
    await bot.sendMessage(chatId, '🛠 Ketik /admin untuk membuka panel admin lengkap.');
    return;
  }

  // if not handled by this routing, ignore here — other handlers (Part 3/4/5) will catch more callbacks
  await bot.answerCallbackQuery(q.id);
});
// =========================
// PART 3 — Bonus Harian, Nonton Iklan, Referral Rewards
// =========================

// ======= BONUS HARIAN =======
async function claimDaily(chatId) {
  const user = db.users[chatId];
  const lang = getLang(chatId);
  const L = LANG[lang];

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (now - (user.lastDaily || 0) < ONE_DAY) {
    const remaining = ONE_DAY - (now - user.lastDaily);
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    await bot.sendMessage(chatId, `⏳ Kamu sudah klaim bonus hari ini.\nCoba lagi dalam ${hours} jam ${mins} menit.`);
    return;
  }

  const bonus = 50; // jumlah bonus harian
  user.points += bonus;
  user.lastDaily = now;
  saveDB();

  await bot.sendMessage(chatId, `🎁 Kamu mendapat bonus harian: +${bonus} poin.\nTotal: ${user.points} poin.`);
}

bot.onText(/\/daily/, async (msg) => {
  await claimDaily(msg.chat.id);
});

// Tambahkan ke callback router
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  if (data === 'daily_bonus') {
    await claimDaily(chatId);
    return;
  }
});


// ======= NONTON IKLAN =======
const ADS = [
  { id: 1, url: 'https://gigahub-two.vercel.app/', reward: 20 },
  { id: 2, url: 'https://example.com/ad2', reward: 25 },
  { id: 3, url: 'https://example.com/ad3', reward: 30 }
];

async function watchAd(chatId) {
  const user = db.users[chatId];
  if (!user) return;

  // ambil iklan random
  const ad = ADS[Math.floor(Math.random() * ADS.length)];

  // pastikan user belum nonton iklan ini hari ini
  const today = new Date().toDateString();
  if (!user.watchedAds) user.watchedAds = {};
  if (user.watchedAds[ad.id] === today) {
    await bot.sendMessage(chatId, '⚠️ Kamu sudah menonton iklan ini hari ini, coba lagi nanti.');
    return;
  }

  // kirim iklan dengan tombol "Selesai"
  const keyboard = {
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Selesai (klaim reward)', callback_data: `claim_ad_${ad.id}` }]]
    }
  };

  await bot.sendMessage(chatId, `📺 Tonton iklan berikut, lalu klik selesai untuk klaim:\n${ad.url}`, keyboard);
}

bot.onText(/\/ads/, async (msg) => {
  await watchAd(msg.chat.id);
});

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;

  if (data === 'watch_ads') {
    await watchAd(chatId);
    return;
  }

  if (data.startsWith('claim_ad_')) {
    const adId = parseInt(data.split('_')[2]);
    const ad = ADS.find(a => a.id === adId);
    if (!ad) return;

    const user = db.users[chatId];
    const today = new Date().toDateString();
    if (user.watchedAds[adId] === today) {
      await bot.answerCallbackQuery(q.id, { text: '⚠️ Reward sudah diklaim.', show_alert: true });
      return;
    }

    // kasih reward
    user.points += ad.reward;
    user.watchedAds[adId] = today;
    saveDB();

    await bot.answerCallbackQuery(q.id, { text: `+${ad.reward} poin berhasil ditambahkan!`, show_alert: true });
    await bot.sendMessage(chatId, `✅ Kamu mendapat ${ad.reward} poin dari menonton iklan.\nTotal: ${user.points} poin.`);
    return;
  }
});


// ======= REFERRAL =======
function handleReferral(userId, refCode) {
  if (!refCode) return;
  const refId = parseInt(refCode);
  if (isNaN(refId)) return;
  if (refId === userId) return;

  const refUser = db.users[refId];
  if (!refUser) return;

  // kasih bonus ke referrer
  const reward = 100;
  refUser.points += reward;
  saveDB();

  bot.sendMessage(refId, `🎉 Temanmu bergabung lewat link referralmu!\nKamu mendapat +${reward} poin.\nTotal: ${refUser.points} poin.`);
}

// Update handler /start untuk referral
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const refCode = match && match[1] ? match[1] : null;

  const name = msg.from && (msg.from.first_name || msg.from.username) || 'User';
  if (!db.users[chatId]) {
    db.users[chatId] = {
      id: chatId,
      name: name,
      points: 0,
      lang: 'id',
      lastDaily: 0,
      watchedAds: {},
      banned: false
    };
    saveDB();
    handleReferral(chatId, refCode);
  }

  const lang = getLang(chatId);
  const L = LANG[lang];
  bot.sendMessage(chatId, L.welcome(name), mainMenuKeyboard(chatId));
});
// =========================
// PART 4 — Wallet & Withdraw
// =========================

// ======= WALLET =======
function getWallet(user) {
  if (!user.wallet) return '❌ Belum diatur';
  return `💳 Wallet: ${user.wallet}`;
}

bot.onText(/\/wallet/, async (msg) => {
  const chatId = msg.chat.id;
  const user = db.users[chatId];
  const lang = getLang(chatId);
  const L = LANG[lang];

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Tambah / Ubah Wallet', callback_data: 'set_wallet' }],
        [{ text: '⬅️ Kembali', callback_data: 'back_main' }]
      ]
    }
  };

  await bot.sendMessage(chatId, `${L.wallet}\n${getWallet(user)}`, keyboard);
});

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const user = db.users[chatId];

  if (data === 'wallet') {
    const lang = getLang(chatId);
    const L = LANG[lang];
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Tambah / Ubah Wallet', callback_data: 'set_wallet' }],
          [{ text: '⬅️ Kembali', callback_data: 'back_main' }]
        ]
      }
    };
    await bot.editMessageText(`${L.wallet}\n${getWallet(user)}`, {
      chat_id: chatId,
      message_id: q.message.message_id,
      ...keyboard
    });
    return;
  }

  if (data === 'set_wallet') {
    bot.sendMessage(chatId, '✍️ Masukkan alamat wallet kamu:');
    bot.once('message', (msg) => {
      if (!db.users[chatId]) return;
      db.users[chatId].wallet = msg.text.trim();
      saveDB();
      bot.sendMessage(chatId, `✅ Wallet berhasil disimpan: ${msg.text}`);
    });
    return;
  }
});


// ======= WITHDRAW =======
const MIN_WITHDRAW = 200; // minimal poin untuk withdraw

async function requestWithdraw(chatId) {
  const user = db.users[chatId];
  if (!user) return;

  if (!user.wallet) {
    await bot.sendMessage(chatId, '⚠️ Kamu belum mengatur wallet. Atur dulu dengan perintah /wallet');
    return;
  }

  if (user.points < MIN_WITHDRAW) {
    await bot.sendMessage(chatId, `⚠️ Minimal withdraw adalah ${MIN_WITHDRAW} poin. Kamu baru punya ${user.points} poin.`);
    return;
  }

  // simpan request withdraw
  const req = {
    id: Date.now(),
    userId: chatId,
    wallet: user.wallet,
    amount: user.points
  };

  if (!db.withdraws) db.withdraws = [];
  db.withdraws.push(req);
  saveDB();

  // kurangi poin user
  const amount = user.points;
  user.points = 0;
  saveDB();

  await bot.sendMessage(chatId, `✅ Withdraw sebesar ${amount} poin sudah diajukan ke admin.\nWallet: ${user.wallet}`);

  // kirim notifikasi ke admin
  for (const adminId of ADMIN_IDS) {
    await bot.sendMessage(adminId, `💸 Request Withdraw\n\n👤 User: ${user.name}\n🆔 ID: ${chatId}\n💰 Amount: ${amount}\n💳 Wallet: ${user.wallet}\n\nGunakan /approve_${req.id} untuk menyetujui.`);
  }
}

bot.onText(/\/withdraw/, async (msg) => {
  await requestWithdraw(msg.chat.id);
});

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  if (data === 'withdraw') {
    await requestWithdraw(chatId);
    return;
  }
});


// ======= ADMIN APPROVE WITHDRAW =======
bot.onText(/\/approve_(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '❌ Kamu bukan admin.');
  }

  const reqId = parseInt(match[1]);
  if (!db.withdraws) db.withdraws = [];
  const req = db.withdraws.find(r => r.id === reqId);
  if (!req) return bot.sendMessage(chatId, '❌ Withdraw request tidak ditemukan.');

  // anggap admin melakukan pembayaran manual
  req.status = 'approved';
  saveDB();

  await bot.sendMessage(chatId, `✅ Withdraw ID ${reqId} disetujui.`);
  await bot.sendMessage(req.userId, `🎉 Withdraw kamu sebesar ${req.amount} poin sudah disetujui oleh admin.\nAkan segera diproses ke wallet: ${req.wallet}`);
});
// =========================
// PART 5 — Tentang, Peraturan, Feedback, Admin Panel
// =========================

// ======= TENTANG =======
bot.onText(/\/about/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    `ℹ️ Tentang Bot\n\n` +
    `Bot ini adalah sistem rewards:\n` +
    `- Nonton iklan dapat poin\n` +
    `- Bonus harian\n` +
    `- Referral\n` +
    `- Withdraw ke wallet\n\n` +
    `Dikembangkan oleh Admin.`
  );
});

// ======= PERATURAN =======
bot.onText(/\/rules/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    `📜 Peraturan:\n\n` +
    `1. Tidak boleh pakai bot / cheat.\n` +
    `2. Satu orang hanya boleh 1 akun.\n` +
    `3. Withdraw hanya ke wallet yang valid.\n` +
    `4. Pelanggaran berulang bisa kena banned.\n\n` +
    `⚠️ Patuhi aturan untuk tetap bisa withdraw.`
  );
});

// ======= FEEDBACK =======
bot.onText(/\/feedback/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '✍️ Silakan kirim feedback / saran kamu:');
  bot.once('message', (m) => {
    bot.sendMessage(chatId, '✅ Terima kasih atas feedback kamu!');
    // kirim ke admin
    for (const adminId of ADMIN_IDS) {
      bot.sendMessage(adminId, `📩 Feedback dari ${chatId}:\n\n${m.text}`);
    }
  });
});

// =========================
// ADMIN PANEL
// =========================

// Daftar admin (boleh lebih dari 1)
const ADMIN_IDS = [ADMIN_ID]; 

bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  if (!ADMIN_IDS.includes(String(chatId))) {
    return bot.sendMessage(chatId, '❌ Kamu bukan admin.');
  }

  bot.sendMessage(chatId, '⚙️ Admin Panel', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Statistik', callback_data: 'admin_stats' }],
        [{ text: '📢 Kirim Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '💸 Daftar Withdraw', callback_data: 'admin_withdraws' }]
      ]
    }
  });
});

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  
  if (!ADMIN_IDS.includes(String(chatId))) return;

  if (data === 'admin_stats') {
    const totalUsers = Object.keys(db.users).length;
    const totalPoints = Object.values(db.users).reduce((a, u) => a + (u.points || 0), 0);
    await bot.sendMessage(chatId, 
      `📊 Statistik Bot\n\n` +
      `👥 Total Users: ${totalUsers}\n` +
      `💰 Total Poin (semua user): ${totalPoints}`
    );
  }

  if (data === 'admin_broadcast') {
    await bot.sendMessage(chatId, '✍️ Ketik pesan yang ingin di-broadcast:');
    bot.once('message', (m) => {
      const text = m.text;
      let sent = 0;
      for (const uid of Object.keys(db.users)) {
        bot.sendMessage(uid, `📢 Broadcast:\n\n${text}`).catch(() => {});
        sent++;
      }
      bot.sendMessage(chatId, `✅ Broadcast terkirim ke ${sent} user.`);
    });
  }

  if (data === 'admin_withdraws') {
    if (!db.withdraws || db.withdraws.length === 0) {
      return bot.sendMessage(chatId, '❌ Tidak ada request withdraw.');
    }
    let list = '💸 Daftar Withdraw:\n\n';
    for (const w of db.withdraws) {
      list += `ID: ${w.id}\nUser: ${w.userId}\nWallet: ${w.wallet}\nAmount: ${w.amount}\nStatus: ${w.status || 'pending'}\n\n`;
    }
    await bot.sendMessage(chatId, list);
  }
});
