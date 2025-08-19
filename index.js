/**
 * index.js — AdsRewards Bot (Verbose, Railway Ready)
 * - Polling only (tanpa express/webhook)
 * - Menu user lengkap: Ads, Daily Bonus, Mining, Wallet, Referral, Rules, Feedback, Withdraw
 * - Admin Panel lengkap: Stats, Broadcast, Withdraws (approve), Users (block/unblock, set points),
 *   Ads Manager (list/add/remove)
 * - DB file: db.json (lokal)
 */

/////////////////////////////
// 0) DEPENDENCIES & CONFIG
/////////////////////////////

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// ---- ENV ----
const TOKEN = process.env.TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const ADMIN_IDS = [String(ADMIN_ID)]; // tambah admin lain bila perlu, mis: ["123","456"]

if (!TOKEN || !ADMIN_ID) {
  console.error('❌ ENV belum lengkap. Set TOKEN & ADMIN_ID di Railway Variables.');
  process.exit(1);
}

// ---- BOT ----
const bot = new TelegramBot(TOKEN, { polling: true });
let selfUsername = 'YourBot';
bot.getMe()
  .then(me => { selfUsername = me.username || selfUsername; console.log('🤖 Username bot:', selfUsername); })
  .catch(() => console.log('ℹ️ getMe gagal, pakai username default.'));

bot.on('polling_error', err => console.error('polling_error:', err && err.message || err));
bot.on('error', err => console.error('bot error:', err));

// ---- CONSTANTS FITUR ----
const DAILY_BONUS = 10;           // bonus harian
const MINING_REWARD = 5;          // per klik mining
const MIN_WITHDRAW = 200;         // minimal poin withdraw
const REFERRAL_BONUS = 100;       // bonus ke referrer saat user baru join
const WATCH_ONCE_PER_DAY = true;  // 1 iklan per hari per user

/////////////////////////////
// 1) DATABASE SEDERHANA
/////////////////////////////

const DB_FILE = 'db.json';
let db = {
  users: {},       // "uid": { id, name, points, wallet, lastDaily, watchedAds, banned }
  ads: [           // default contoh
    { id: 1, url: 'https://gigahub-two.vercel.app/', reward: 20 },
    { id: 2, url: 'https://example.com/ad2', reward: 25 }
  ],
  withdraws: []    // { id, userId, wallet, amount, status }
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE));
  } catch (e) {
    console.error('⚠️ Gagal baca DB, pakai default. Error:', e.message);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('⚠️ Gagal simpan DB:', e.message);
  }
}

/////////////////////////////
// 2) UTILITAS
/////////////////////////////

const uidOf = id => String(id);
function ensureUser(id, name = '') {
  const uid = uidOf(id);
  if (!db.users[uid]) {
    db.users[uid] = {
      id,
      name,
      points: 0,
      wallet: '',
      lastDaily: 0,
      watchedAds: {}, // { [adId]: 'Mon Aug 18 2025' }
      banned: false,
      _refHandled: false
    };
    saveDB();
  } else if (name && db.users[uid].name !== name) {
    db.users[uid].name = name;
    saveDB();
  }
  return db.users[uid];
}

function isAdmin(id) { return ADMIN_IDS.includes(uidOf(id)); }
function todayKey() { return new Date().toDateString(); }

/////////////////////////////
// 3) STATE INPUT (multi-step)
/////////////////////////////

// state[uid] = { action: 'set_wallet' | 'broadcast' | 'admin_user_find' | 'admin_set_points' | 'admin_block' | 'admin_unblock' | 'admin_ads_add' | 'admin_ads_remove' | 'withdraw_amount', extra?: any }
const state = {};

/////////////////////////////
// 4) MENU & KOMANDOS USER
/////////////////////////////

function mainKeyboard(isAdminUser) {
  const rows = [
    [{ text: '🎬 Nonton Iklan', callback_data: 'watch_ads' }, { text: '🎁 Bonus Harian', callback_data: 'daily_bonus' }],
    [{ text: '⛏ Mining', callback_data: 'mining' }, { text: '💼 Dompet', callback_data: 'wallet' }],
    [{ text: '👥 Referral', callback_data: 'referral' }, { text: '📜 Aturan', callback_data: 'rules' }],
    [{ text: '✉️ Feedback', callback_data: 'feedback' }, { text: '💸 Withdraw', callback_data: 'withdraw_start' }]
  ];
  if (isAdminUser) rows.push([{ text: '🛠 Admin Panel', callback_data: 'admin_panel' }]);
  return { inline_keyboard: rows };
}

// --- /start (dengan referral) ---
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const ref = match && match[1] ? match[1].trim() : null;
  const user = ensureUser(chatId, msg.from.first_name || msg.from.username || '');

  // Referral: hanya saat user baru / belum ditandai
  if (ref && !user._refHandled) {
    const refId = parseInt(ref, 10);
    if (!isNaN(refId) && refId !== chatId && db.users[uidOf(refId)]) {
      db.users[uidOf(refId)].points = (db.users[uidOf(refId)].points || 0) + REFERRAL_BONUS;
      user._refHandled = true;
      saveDB();
      bot.sendMessage(refId, `🎉 Referral baru! +${REFERRAL_BONUS} poin.\nTotal: ${db.users[uidOf(refId)].points}`);
    }
  }

  bot.sendMessage(
    chatId,
    `👋 Halo *${user.name || 'teman'}*!\nSelamat datang di *AdsRewards*.\nSilakan pilih menu di bawah.`,
    { parse_mode: 'Markdown', reply_markup: mainKeyboard(isAdmin(chatId)) }
  );
});

// --- /wallet cepat ---
bot.onText(/\/wallet/, (msg) => askWallet(msg.chat.id));

// --- /withdraw cepat ---
bot.onText(/\/withdraw/, (msg) => startWithdrawFlow(msg.chat.id));

// --- /admin cepat ---
bot.onText(/\/admin/, (msg) => {
  if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Kamu bukan admin.');
  openAdminPanel(msg.chat.id);
});

/////////////////////////////
// 5) CALLBACK QUERY (USER)
//    (GLOBAL handler - tempat semua inline tombol diproses)
/////////////////////////////

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const uid = uidOf(chatId);
  const data = q.data || '';
  ensureUser(chatId, q.from.first_name || q.from.username || '');

  // debug (opsional)
  // console.log('👉 Callback:', data, 'from', chatId);

  // Banned?
  if (db.users[uid].banned) {
    await bot.answerCallbackQuery(q.id, { text: '❌ Akun kamu diblokir.', show_alert: true });
    return;
  }

  // ===== USER MENUS =====
  if (data === 'watch_ads') {
    await showRandomAd(chatId);
    return bot.answerCallbackQuery(q.id);
  }

  if (data.startsWith('claim_ad_')) {
    const adId = parseInt(data.split('_')[2], 10);
    await claimAd(chatId, q.id, adId);
    return;
  }

  if (data === 'daily_bonus') {
    await handleDailyBonus(chatId, q.id);
    return;
  }

  if (data === 'mining') {
    await handleMining(chatId, q.id);
    return;
  }

  if (data === 'wallet') {
    await askWallet(chatId);
    return bot.answerCallbackQuery(q.id);
  }

  if (data === 'referral') {
    const link = `https://t.me/${selfUsername}?start=${chatId}`;
    await bot.sendMessage(chatId, `🔗 Link referral kamu:\n${link}`);
    return bot.answerCallbackQuery(q.id);
  }

  if (data === 'rules') {
    await bot.sendMessage(chatId, '📜 Peraturan:\n1) Jangan spam/curang\n2) Satu orang satu akun\n3) Withdraw sesuai syarat');
    return bot.answerCallbackQuery(q.id);
  }

  if (data === 'feedback') {
    await bot.sendMessage(chatId, '✉️ Kirim masukan/bug balas pesan ini. Admin akan membaca.');
    return bot.answerCallbackQuery(q.id);
  }

  // WITHDRAW FLOW: tombol untuk menampilkan opsi
  if (data === 'withdraw_start') {
    await startWithdrawFlow(chatId);
    return bot.answerCallbackQuery(q.id);
  }

  // ===== NEW: handle withdraw option buttons here (replaces bot.once)
  if (data === 'withdraw_all') {
    // tarik semua
    await createWithdraw(chatId, db.users[uid].points || 0);
    return bot.answerCallbackQuery(q.id);
  }

  if (data === 'withdraw_custom') {
    // minta jumlah lewat state
    state[uid] = { action: 'withdraw_amount' };
    await bot.sendMessage(chatId, '✍️ Masukkan jumlah poin yang ingin ditarik (angka).');
    return bot.answerCallbackQuery(q.id);
  }

  // ===== ADMIN MENUS =====
  if (data === 'admin_panel') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ Kamu bukan admin.');
      return bot.answerCallbackQuery(q.id);
    }
    await openAdminPanel(chatId);
    return bot.answerCallbackQuery(q.id);
  }

  // Admin-only routes
  if (isAdmin(chatId)) {
    if (data === 'admin_stats') {
      await adminShowStats(chatId);
      return bot.answerCallbackQuery(q.id);
    }
    if (data === 'admin_broadcast') {
      await adminStartBroadcast(chatId);
      return bot.answerCallbackQuery(q.id);
    }
    if (data === 'admin_withdraws') {
      await adminListWithdraws(chatId);
      return bot.answerCallbackQuery(q.id);
    }
    if (data.startsWith('approve_wd_')) {
      const wid = parseInt(data.split('_')[2], 10);
      await adminApproveWithdraw(chatId, wid, q.id);
      return;
    }
    if (data === 'admin_users') {
      await adminUsersMenu(chatId);
      return bot.answerCallbackQuery(q.id);
    }
    if (data === 'admin_user_find') {
      state[uid] = { action: 'admin_user_find' };
      await bot.sendMessage(chatId, '🔎 Masukkan ID user yang ingin dikelola:');
      return bot.answerCallbackQuery(q.id);
    }
    if (data.startsWith('admin_user_')) {
      const [, , targetId, action] = data.split('_'); // admin_user_<id>_<action>
      await adminUserAction(chatId, targetId, action);
      return bot.answerCallbackQuery(q.id);
    }
    if (data === 'admin_ads') {
      await adminAdsMenu(chatId);
      return bot.answerCallbackQuery(q.id);
    }
    if (data === 'admin_ads_add') {
      state[uid] = { action: 'admin_ads_add' };
      await bot.sendMessage(chatId, '➕ Kirim iklan format: URL|REWARD\nContoh: https://example.com|25');
      return bot.answerCallbackQuery(q.id);
    }
    if (data === 'admin_ads_remove') {
      state[uid] = { action: 'admin_ads_remove' };
      await bot.sendMessage(chatId, '🗑 Kirim ID iklan yang ingin dihapus (angka).');
      return bot.answerCallbackQuery(q.id);
    }
  }

  if (data === 'close') {
    await bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    return bot.answerCallbackQuery(q.id);
  }

  // Default
  await bot.answerCallbackQuery(q.id);
});

/////////////////////////////
// 6) MESSAGE HANDLER (STATE)
/////////////////////////////

bot.on('message', async (m) => {
  if (!m || !m.chat || m.text === undefined) return;
  const chatId = m.chat.id;
  const uid = uidOf(chatId);
  const s = state[uid];
  if (!s) return;

  // USER: set wallet
  if (s.action === 'set_wallet') {
    db.users[uid].wallet = (m.text || '').trim();
    saveDB();
    delete state[uid];
    await bot.sendMessage(chatId, `✅ Wallet tersimpan: ${db.users[uid].wallet}`);
    return;
  }

  // USER: withdraw amount
  if (s.action === 'withdraw_amount') {
    const amount = parseInt((m.text || '').trim(), 10);
    if (isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, '❌ Jumlah tidak valid. Ketik angka.');
      return;
    }
    await createWithdraw(chatId, amount);
    delete state[uid];
    return;
  }

  // ADMIN: broadcast
  if (s.action === 'broadcast' && isAdmin(chatId)) {
    const text = m.text;
    delete state[uid];
    const ids = Object.keys(db.users);
    let sent = 0;
    for (const id of ids) {
      await bot.sendMessage(id, `📢 Broadcast:\n\n${text}`).then(() => sent++).catch(() => {});
    }
    await bot.sendMessage(chatId, `✅ Broadcast terkirim ke ${ids.length} user (sukses: ~${sent}).`);
    return;
  }

  // ADMIN: find user
  if (s.action === 'admin_user_find' && isAdmin(chatId)) {
    const target = (m.text || '').trim();
    if (!db.users[target]) {
      await bot.sendMessage(chatId, '❌ User tidak ditemukan.');
      delete state[uid];
      return;
    }
    delete state[uid];
    await adminShowUserCard(chatId, target);
    return;
  }

  // ADMIN: set points
  if (s.action === 'admin_set_points' && isAdmin(chatId)) {
    const { targetId } = s;
    const value = parseInt((m.text || '').trim(), 10);
    if (isNaN(value)) {
      await bot.sendMessage(chatId, '❌ Nilai tidak valid.');
      return;
    }
    db.users[targetId].points = value;
    saveDB();
    delete state[uid];
    await bot.sendMessage(chatId, `✅ Poin user ${targetId} diatur ke ${value}.`);
    await adminShowUserCard(chatId, targetId);
    return;
  }

  // ADMIN: block / unblock (konfirmasi opsional via nilai apapun)
  if ((s.action === 'admin_block' || s.action === 'admin_unblock') && isAdmin(chatId)) {
    const { targetId } = s;
    db.users[targetId].banned = (s.action === 'admin_block');
    saveDB();
    delete state[uid];
    await bot.sendMessage(chatId, `✅ User ${targetId} ${db.users[targetId].banned ? 'diblokir' : 'dibuka blokirnya'}.`);
    await adminShowUserCard(chatId, targetId);
    return;
  }

  // ADMIN: ads add
  if (s.action === 'admin_ads_add' && isAdmin(chatId)) {
    const raw = (m.text || '').trim();
    const [url, rewardStr] = raw.split('|').map(x => (x || '').trim());
    const reward = parseInt(rewardStr, 10);
    if (!url || isNaN(reward)) {
      await bot.sendMessage(chatId, '❌ Format salah. Contoh: https://example.com|25');
      return;
    }
    const nextId = db.ads.length ? Math.max(...db.ads.map(a => a.id)) + 1 : 1;
    db.ads.push({ id: nextId, url, reward });
    saveDB();
    delete state[uid];
    await bot.sendMessage(chatId, `✅ Iklan ditambah.\nID: ${nextId}\nURL: ${url}\nReward: ${reward}`);
    await adminAdsMenu(chatId);
    return;
  }

  // ADMIN: ads remove
  if (s.action === 'admin_ads_remove' && isAdmin(chatId)) {
    const adId = parseInt((m.text || '').trim(), 10);
    if (isNaN(adId)) {
      await bot.sendMessage(chatId, '❌ Harus angka ID iklan.');
      return;
    }
    const before = db.ads.length;
    db.ads = db.ads.filter(a => a.id !== adId);
    saveDB();
    delete state[uid];
    await bot.sendMessage(chatId, before === db.ads.length ? 'ℹ️ ID tidak ditemukan.' : '✅ Iklan dihapus.');
    await adminAdsMenu(chatId);
    return;
  }
});

/////////////////////////////
// 7) FITUR USER (FUNGSI)
/////////////////////////////

async function showRandomAd(chatId) {
  ensureUser(chatId);
  if (!db.ads.length) {
    await bot.sendMessage(chatId, 'ℹ️ Belum ada iklan aktif.');
    return;
  }
  const ad = db.ads[Math.floor(Math.random() * db.ads.length)];
  const kb = {
    reply_markup: { inline_keyboard: [[{ text: '✅ Selesai (klaim)', callback_data: `claim_ad_${ad.id}` }]] }
  };
  await bot.sendMessage(chatId, `📺 Tonton iklan ini, lalu klik "Selesai" untuk klaim:\n${ad.url}`, kb);
}

async function claimAd(chatId, callbackId, adId) {
  const user = ensureUser(chatId);
  const ad = db.ads.find(a => a.id === adId);
  if (!ad) {
    await bot.answerCallbackQuery(callbackId, { text: '❌ Iklan tidak ditemukan.', show_alert: true });
    return;
  }

  const key = todayKey();
  if (WATCH_ONCE_PER_DAY && user.watchedAds[adId] === key) {
    await bot.answerCallbackQuery(callbackId, { text: '⚠️ Kamu sudah klaim iklan ini hari ini.', show_alert: true });
    return;
  }

  user.points = (user.points || 0) + ad.reward;
  user.watchedAds[adId] = key;
  saveDB();

  await bot.answerCallbackQuery(callbackId, { text: `+${ad.reward} poin`, show_alert: true });
  await bot.sendMessage(chatId, `✅ Reward diklaim.\n+${ad.reward} poin.\nTotal: ${user.points}`);
}

async function handleDailyBonus(chatId, callbackId) {
  const user = ensureUser(chatId);
  const now = Date.now();
  if (now - (user.lastDaily || 0) < 24 * 60 * 60 * 1000) {
    const ms = 24 * 60 * 60 * 1000 - (now - (user.lastDaily || 0));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    await bot.answerCallbackQuery(callbackId, { text: `⏳ Coba lagi dalam ${h} jam ${m} menit.`, show_alert: true });
    return;
  }
  user.points = (user.points || 0) + DAILY_BONUS;
  user.lastDaily = now;
  saveDB();
  await bot.answerCallbackQuery(callbackId, { text: `+${DAILY_BONUS} poin`, show_alert: true });
  await bot.sendMessage(chatId, `🎁 Bonus harian berhasil!\nTotal: ${user.points}`);
}

async function handleMining(chatId, callbackId) {
  const user = ensureUser(chatId);
  user.points = (user.points || 0) + MINING_REWARD;
  saveDB();
  await bot.answerCallbackQuery(callbackId, { text: `+${MINING_REWARD} poin`, show_alert: false });
  await bot.sendMessage(chatId, `⛏ Mining sukses! +${MINING_REWARD}\nTotal: ${user.points}`);
}

async function askWallet(chatId) {
  const uid = uidOf(chatId);
  ensureUser(chatId);
  state[uid] = { action: 'set_wallet' };
  await bot.sendMessage(chatId, '💼 Kirim alamat wallet kamu sekarang (reply pesan ini).');
}

async function startWithdrawFlow(chatId) {
  const user = ensureUser(chatId);
  if (!user.wallet) {
    await bot.sendMessage(chatId, '⚠️ Kamu belum set wallet. Ketik /wallet dulu ya.');
    return;
  }
  if ((user.points || 0) < MIN_WITHDRAW) {
    await bot.sendMessage(chatId, `⚠️ Minimal withdraw adalah ${MIN_WITHDRAW} poin.\nPoin kamu: ${user.points}`);
    return;
  }

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: `Tarik semua (${user.points})`, callback_data: 'withdraw_all' }],
        [{ text: 'Masukkan jumlah manual', callback_data: 'withdraw_custom' }],
        [{ text: '⬅️ Batal', callback_data: 'close' }]
      ]
    }
  };
  await bot.sendMessage(chatId, '💸 Pilih opsi withdraw:', kb);

  // NOTE: previously used bot.once which caused callback capture issues.
  // Removed here — options handled by global callback_query handler above.
}

async function createWithdraw(chatId, amount) {
  const user = ensureUser(chatId);
  if (amount > user.points) {
    await bot.sendMessage(chatId, '❌ Poin tidak cukup.');
    return;
  }
  if (amount < MIN_WITHDRAW) {
    await bot.sendMessage(chatId, `❌ Minimal withdraw ${MIN_WITHDRAW} poin.`);
    return;
  }

  const req = { id: Date.now(), userId: chatId, wallet: user.wallet || '-', amount, status: 'pending' };
  db.withdraws.push(req);
  user.points -= amount;
  saveDB();

  await bot.sendMessage(chatId, `✅ Withdraw diajukan: ${amount} poin\nWallet: ${req.wallet}\nStatus: pending`);

  for (const aid of ADMIN_IDS) {
    await bot.sendMessage(aid, `💸 Request Withdraw\nID: ${req.id}\nUser: ${req.userId}\nAmount: ${req.amount}\nWallet: ${req.wallet}`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_wd_${req.id}` }]] }
    }).catch(() => {});
  }
}

/////////////////////////////
// 8) ADMIN FEATURES
/////////////////////////////

async function openAdminPanel(chatId) {
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Statistik', callback_data: 'admin_stats' }, { text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '💸 Withdraws', callback_data: 'admin_withdraws' }, { text: '👤 Users', callback_data: 'admin_users' }],
        [{ text: '📺 Ads Manager', callback_data: 'admin_ads' }],
        [{ text: '✖ Tutup', callback_data: 'close' }]
      ]
    }
  };
  await bot.sendMessage(chatId, '🛠 *Admin Panel*', { parse_mode: 'Markdown', ...kb });
}

async function adminShowStats(chatId) {
  const totalUsers = Object.keys(db.users).length;
  const totalPoints = Object.values(db.users).reduce((a, u) => a + (u.points || 0), 0);
  const banned = Object.values(db.users).filter(u => u.banned).length;
  await bot.sendMessage(chatId, `📊 Statistik\n👥 Users: ${totalUsers}\n🚫 Banned: ${banned}\n💰 Total Poin: ${totalPoints}`);
}

async function adminStartBroadcast(chatId) {
  state[uidOf(chatId)] = { action: 'broadcast' };
  await bot.sendMessage(chatId, '✍️ Ketik pesan yang akan di-broadcast ke semua user.');
}

async function adminListWithdraws(chatId) {
  if (!db.withdraws.length) {
    await bot.sendMessage(chatId, 'ℹ️ Belum ada request withdraw.');
    return;
  }
  let list = '💸 *Daftar Withdraw*\n\n';
  db.withdraws
    .slice()
    .sort((a,b)=>b.id-a.id)
    .forEach(w => {
      list += `ID: ${w.id}\nUser: ${w.userId}\nWallet: ${w.wallet}\nAmount: ${w.amount}\nStatus: ${w.status}\n\n`;
    });
  await bot.sendMessage(chatId, list, { parse_mode: 'Markdown' });
}

async function adminApproveWithdraw(chatId, wid, callbackId) {
  const w = db.withdraws.find(x => x.id === wid);
  if (!w) {
    await bot.answerCallbackQuery(callbackId, { text: '❌ Withdraw tidak ditemukan.', show_alert: true });
    return;
  }
  w.status = 'approved';
  saveDB();
  await bot.answerCallbackQuery(callbackId, { text: '✅ Disetujui.', show_alert: false });
  await bot.sendMessage(chatId, `✅ Withdraw ${wid} disetujui.`);
  await bot.sendMessage(w.userId, `🎉 Withdraw kamu (${w.amount} poin) disetujui admin. Diproses ke wallet: ${w.wallet}`);
}

async function adminUsersMenu(chatId) {
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔎 Kelola User by ID', callback_data: 'admin_user_find' }]
      ]
    }
  };
  await bot.sendMessage(chatId, '👤 *User Management*\n- Cari user berdasarkan ID, lalu:\n  • Set Poin\n  • Block / Unblock', { parse_mode: 'Markdown', ...kb });
}

async function adminShowUserCard(chatId, targetId) {
  const user = db.users[targetId];
  if (!user) {
    await bot.sendMessage(chatId, '❌ User tidak ditemukan.');
    return;
  }
  const txt =
    `👤 *User*\n` +
    `ID: ${user.id}\n` +
    `Nama: ${user.name || '-'}\n` +
    `Poin: ${user.points}\n` +
    `Wallet: ${user.wallet || '-'}\n` +
    `Status: ${user.banned ? '🚫 Banned' : '✅ Aktif'}`;
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✏️ Set Poin', callback_data: `admin_user_${targetId}_setpoints` },
          { text: user.banned ? '✅ Unblock' : '🚫 Block', callback_data: `admin_user_${targetId}_${user.banned ? 'unblock' : 'block'}` }
        ]
      ]
    }
  };
  await bot.sendMessage(chatId, txt, { parse_mode: 'Markdown', ...kb });
}

async function adminUserAction(chatId, targetId, action) {
  const uid = uidOf(chatId);
  if (!db.users[targetId]) {
    await bot.sendMessage(chatId, '❌ User tidak ditemukan.');
    return;
  }
  if (action === 'setpoints') {
    state[uid] = { action: 'admin_set_points', targetId };
    await bot.sendMessage(chatId, `✍️ Masukkan nilai poin baru untuk user ${targetId}:`);
    return;
  }
  if (action === 'block') {
    state[uid] = { action: 'admin_block', targetId };
    await bot.sendMessage(chatId, `⚠️ Konfirmasi blokir user ${targetId} (balas dengan teks apapun).`);
    return;
  }
  if (action === 'unblock') {
    state[uid] = { action: 'admin_unblock', targetId };
    await bot.sendMessage(chatId, `⚠️ Konfirmasi buka blokir user ${targetId} (balas dengan teks apapun).`);
    return;
  }
}

async function adminAdsMenu(chatId) {
  let list = '📺 *Ads Manager*\n\n';
  if (!db.ads.length) list += '(Tidak ada iklan)\n';
  else {
    list += db.ads.map(a => `ID: ${a.id} | Reward: ${a.reward}\nURL: ${a.url}`).join('\n\n') + '\n';
  }
  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Tambah Iklan', callback_data: 'admin_ads_add' }, { text: '🗑 Hapus Iklan', callback_data: 'admin_ads_remove' }]
      ]
    }
  };
  await bot.sendMessage(chatId, list, { parse_mode: 'Markdown', ...kb });
}
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Bot AdsRewards lagi jalan!');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server aktif di port ${PORT}`);
});

/////////////////////////////
// 9) SIAP JALAN
/////////////////////////////

console.log('✅ Bot jalan dengan polling (Railway). Siap menerima update...');
