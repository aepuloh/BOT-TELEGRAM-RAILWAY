// index.js — AdsRewards Bot Full Menu + Admin Panel
// ===== DEPENDENCIES =====
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const app = express();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN; // isi di secrets
const ADMIN_ID = process.env.ADMIN_ID; // contoh: 123456789
const ADMIN_IDS = [String(ADMIN_ID)];

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== DATABASE =====
let db = { users: {}, ads: [], withdraws: [] };
const DB_FILE = 'db.json';

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ===== WEB SERVER (uptime) =====
app.get('/', (req, res) => res.send('Bot AdsRewards Running'));
app.listen(3000, () => console.log('Server aktif di port 3000'));

// ===== START COMMAND =====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const uid = String(chatId);

  if (!db.users[uid]) {
    db.users[uid] = {
      id: chatId,
      name: msg.from.first_name || '',
      points: 0,
      wallet: '',
      lastDaily: 0,
      banned: false,
    };
    saveDB();
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: '🎬 Nonton Iklan', callback_data: 'watch_ads' }],
      [{ text: '🎁 Daily Bonus', callback_data: 'daily_bonus' }],
      [{ text: '⛏ Mining', callback_data: 'mining' }],
      [{ text: '💼 Dompet', callback_data: 'wallet' }],
      [{ text: '👥 Referral', callback_data: 'referral' }],
      [{ text: '📜 Aturan', callback_data: 'rules' }],
      [{ text: '✉️ Feedback', callback_data: 'feedback' }],
      [{ text: '🛠 Admin Panel', callback_data: 'admin_panel' }]
    ]
  };

  bot.sendMessage(chatId, `👋 Selamat datang di *AdsRewards*!`, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

// ===== CALLBACK HANDLER =====
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const uid = String(chatId);

  // auto-create user
  if (!db.users[uid]) {
    db.users[uid] = { id: chatId, name: q.from.first_name || '', points: 0, wallet: '', lastDaily: 0, banned: false };
    saveDB();
  }

  // banned check
  if (db.users[uid].banned) {
    await bot.answerCallbackQuery(q.id, { text: '❌ Akun kamu diblokir.', show_alert: true });
    return;
  }

  // ==== MENU USER ====
  if (data === 'watch_ads') {
    return bot.sendMessage(chatId, '🎬 Fitur nonton iklan (coming soon).');
  }

  if (data === 'daily_bonus') {
    const now = Date.now();
    if (now - db.users[uid].lastDaily < 24 * 60 * 60 * 1000) {
      return bot.answerCallbackQuery(q.id, { text: '❌ Sudah klaim hari ini.', show_alert: true });
    }
    db.users[uid].points += 10;
    db.users[uid].lastDaily = now;
    saveDB();
    return bot.sendMessage(chatId, `✅ Bonus harian berhasil!\n💰 Poin sekarang: ${db.users[uid].points}`);
  }

  if (data === 'mining') {
    db.users[uid].points += 5;
    saveDB();
    return bot.sendMessage(chatId, `⛏ Mining sukses!\n+5 poin 💰\nTotal: ${db.users[uid].points}`);
  }

  if (data === 'wallet') {
    bot.sendMessage(chatId, '💼 Kirim alamat wallet kamu:');
    bot.once('message', (m) => {
      db.users[uid].wallet = m.text;
      saveDB();
      bot.sendMessage(chatId, `✅ Wallet tersimpan: ${m.text}`);
    });
    return;
  }

  if (data === 'referral') {
    const refLink = `https://t.me/${bot.options.username}?start=${chatId}`;
    return bot.sendMessage(chatId, `🔗 Ajak temanmu pakai link ini:\n${refLink}`);
  }

  if (data === 'rules') {
    return bot.sendMessage(chatId, '📜 Aturan:\n1. Jangan spam\n2. 1 akun per orang\n3. Withdraw sesuai syarat');
  }

  if (data === 'feedback') {
    return bot.sendMessage(chatId, '✉️ Kirim masukan atau bug ke admin.');
  }

  // ==== ADMIN PANEL ====
  if (data === 'admin_panel') {
    if (!ADMIN_IDS.includes(uid)) {
      return bot.sendMessage(chatId, '❌ Kamu bukan admin.');
    }
    return bot.sendMessage(chatId, '⚙️ Admin Panel', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Statistik', callback_data: 'admin_stats' }],
          [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
          [{ text: '💸 Withdraws', callback_data: 'admin_withdraws' }],
          [{ text: '✖ Tutup', callback_data: 'close' }]
        ]
      }
    });
  }

  if (ADMIN_IDS.includes(uid)) {
    if (data === 'admin_stats') {
      const totalUsers = Object.keys(db.users).length;
      const totalPoints = Object.values(db.users).reduce((a, u) => a + (u.points || 0), 0);
      return bot.sendMessage(chatId, `📊 Statistik\n👥 User: ${totalUsers}\n💰 Total Poin: ${totalPoints}`);
    }

    if (data === 'admin_broadcast') {
      await bot.sendMessage(chatId, '✍️ Kirim pesan untuk broadcast:');
      bot.once('message', (m) => {
        for (const uid of Object.keys(db.users)) {
          bot.sendMessage(uid, `📢 Broadcast:\n\n${m.text}`).catch(() => {});
        }
        bot.sendMessage(chatId, '✅ Broadcast selesai.');
      });
      return;
    }

    if (data === 'admin_withdraws') {
      if (!db.withdraws || db.withdraws.length === 0) return bot.sendMessage(chatId, '❌ Tidak ada withdraw.');
      let list = '💸 Daftar Withdraw:\n\n';
      for (const w of db.withdraws) {
        list += `ID: ${w.id}\nUser: ${w.userId}\nWallet: ${w.wallet}\nAmount: ${w.amount}\nStatus: ${w.status || 'pending'}\n\n`;
      }
      return bot.sendMessage(chatId, list);
    }
  }

  if (data === 'close') {
    await bot.deleteMessage(chatId, q.message.message_id);
    return;
  }

  await bot.answerCallbackQuery(q.id);
});
