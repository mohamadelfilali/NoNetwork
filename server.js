const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const armorManager = require('mineflayer-armor-manager');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// -------------------------------------------------------------
// 1. تهيئة Firebase Admin للتحقق من هوية المستخدم
// -------------------------------------------------------------
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("[+] تم تفعيل التوثيق عبر Firebase بنجاح.");
    } catch (e) {
        console.error("[-] خطأ في قراءة مفتاح Firebase:", e.message);
    }
} else {
    console.warn("⚠️ تنبيه: لم يتم إضافة مفتاح FIREBASE_SERVICE_ACCOUNT في بيئة العمل.");
}

// قواعد البيانات في الذاكرة لتتبع الملكية والبوات
const userBotsDatabase = new Map(); // [botUsername] -> { userId, host, port, password, version }
const activeRunningBots = new Map(); // [socketId] -> { botInstance, username, afkInterval, trackingInterval }

// -------------------------------------------------------------
// 2. إدارة التفاعل والربط اللحظي عبر Socket.io
// -------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`[+] متصل جديد من المدوّنة: ${socket.id}`);

    // [أ] تشغيل البوت وحفظ بياناته
    socket.on('start_bot', async (data) => {
        const { idToken, host, port, username, password, version } = data;

        if (!host || !username) {
            socket.emit('bot_log', '[-] خطأ: اسم البوت وعنوان السيرفر مطلوبان.');
            return;
        }

        // التحقق من هوية المستخدم عبر Firebase Token
        let userId = "guest_user";
        if (admin.apps.length > 0 && idToken) {
            try {
                const decodedToken = await admin.auth().verifyIdToken(idToken);
                userId = decodedToken.uid;
            } catch (err) {
                socket.emit('bot_log', '[-] خطأ: فشل التثبت من جلسة Firebase الخاص بك.');
                return;
            }
        }

        // شرط عدم تكرار اسم البوت لمستخدم آخر
        const existingBot = userBotsDatabase.get(username);
        if (existingBot && existingBot.userId !== userId) {
            socket.emit('bot_log', `[-] خطأ: اسم البوت "${username}" مأخوذ بالفعل من قبل مستخدم آخر!`);
            return;
        }

        // حفظ / تحديث بيانات البوت تحت اسم المستخدم
        userBotsDatabase.set(username, {
            userId: userId,
            host: host,
            port: port || 25565,
            password: password || "",
            version: version || false
        });

        socket.emit('bot_log', '[*] جاري إنشاء الاتصال بسيرفر ماينكرافت...');

        try {
            const bot = mineflayer.createBot({
                host: host,
                port: port ? parseInt(port) : 25565,
                username: username,
                version: version || false
            });

            // تحميل ملحق إدارة الدروع
            bot.loadPlugin(armorManager);

            let trackingInterval;
            let afkInterval;

            bot.on('spawn', () => {
                socket.emit('bot_status', 'connected');
                socket.emit('bot_log', `[+] تم دخول البوت ${username} إلى السيرفر بنجاح!`);

                // التسجيل التلقائي فور الدخول (AuthMe)
                if (password) {
                    setTimeout(() => {
                        bot.chat(`/login ${password}`);
                        bot.chat(`/register ${password} ${password}`);
                        socket.emit('bot_log', '[*] تم تنفيذ أمر تسجيل الدخول التلقائي.');
                    }, 2000);
                }

                // ميزة حماية Anti-AFK بسيطة لمنع الطرد
                afkInterval = setInterval(() => {
                    if (bot && bot.entity) {
                        bot.setControlState('jump', true);
                        setTimeout(() => bot.setControlState('jump', false), 400);
                    }
                }, 40000);

                // إرسال الإحداثيات الصحة، والجوع، وأقرب لاعب كل ثانية
                trackingInterval = setInterval(() => {
                    if (bot.entity) {
                        // 1. الإحداثيات
                        const pos = {
                            x: bot.entity.position.x.toFixed(1),
                            y: bot.entity.position.y.toFixed(1),
                            z: bot.entity.position.z.toFixed(1)
                        };

                        // 2. البحث عن أقرب لاعب
                        let nearestPlayer = "لا يوجد لاعبين قريبين";
                        let minDistance = Infinity;

                        if (bot.players) {
                            Object.keys(bot.players).forEach((pName) => {
                                if (pName !== bot.username) {
                                    const playerEntity = bot.players[pName]?.entity;
                                    if (playerEntity) {
                                        const dist = bot.entity.position.distanceTo(playerEntity.position);
                                        if (dist < minDistance) {
                                            minDistance = dist;
                                            nearestPlayer = `${pName} (${dist.toFixed(1)} بلوك)`;
                                        }
                                    }
                                }
                            });
                        }

                        // 3. الصحة والجوع
                        const health = bot.health ? bot.health.toFixed(0) : 20;
                        const food = bot.food ? bot.food.toFixed(0) : 20;

                        socket.emit('bot_telemetry', {
                            position: pos,
                            nearestPlayer: nearestPlayer,
                            health: health,
                            food: food
                        });
                    }
                }, 1000);

                sendPlayerList(bot, socket);
            });

            // تحويل شات السيرفر للواجهة
            bot.on('message', (jsonMsg) => {
                socket.emit('game_chat', jsonMsg.toString());
            });

            // تحديث قائمة اللاعبين
            bot.on('playerJoined', () => sendPlayerList(bot, socket));
            bot.on('playerLeft', () => sendPlayerList(bot, socket));

            // الأخطاء وفصل الاتصال
            bot.on('error', (err) => {
                socket.emit('bot_log', `[-] خطأ: ${err.message}`);
            });

            bot.on('end', (reason) => {
                clearInterval(trackingInterval);
                clearInterval(afkInterval);
                socket.emit('bot_status', 'disconnected');
                socket.emit('bot_log', `[-] تم فصل البوت: ${reason}`);
                activeRunningBots.delete(socket.id);
            });

            activeRunningBots.set(socket.id, {
                botInstance: bot,
                username: username,
                trackingInterval,
                afkInterval
            });

        } catch (error) {
            socket.emit('bot_log', `[-] فشل إطلاق البوت: ${error.message}`);
        }
    });

    // [ب] إرسال رسالة عامة / أمر
    socket.on('send_chat', (msg) => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance) {
            session.botInstance.chat(msg);
            socket.emit('bot_log', `[أنت]: ${msg}`);
        }
    });

    // [ج] إرسال رسالة خاصة للاعب محدد
    socket.on('send_pm', ({ targetPlayer, message }) => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance) {
            session.botInstance.chat(`/msg ${targetPlayer} ${message}`);
            socket.emit('bot_log', `[خاص إلى ${targetPlayer}]: ${message}`);
        }
    });

    // [د] زر ارتداء أفضل الدروع
    socket.on('equip_best_armor', () => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance) {
            try {
                session.botInstance.armorManager.equipAll();
                socket.emit('bot_log', '[*] تم ارتداء أفضل دروع متوفرة.');
            } catch (err) {
                socket.emit('bot_log', `[-] تعذر ارتداء الدروع: ${err.message}`);
            }
        }
    });

    // [هـ] إيقاف البوت (Disconnect)
    socket.on('stop_bot', () => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance) {
            session.botInstance.quit();
            clearInterval(session.trackingInterval);
            clearInterval(session.afkInterval);
            activeRunningBots.delete(socket.id);
            socket.emit('bot_status', 'disconnected');
            socket.emit('bot_log', '[!] تم إيقاف البوت.');
        }
    });

    // [و] حذف البوت كلياً من السيرفر الخلفي
    socket.on('delete_bot', () => {
        const session = activeRunningBots.get(socket.id);
        if (session) {
            if (session.botInstance) {
                session.botInstance.quit();
                clearInterval(session.trackingInterval);
                clearInterval(session.afkInterval);
            }
            userBotsDatabase.delete(session.username);
            activeRunningBots.delete(socket.id);
            socket.emit('bot_status', 'disconnected');
            socket.emit('bot_log', '[🗑️] تم حذف البوت نهائياً من النظام.');
        }
    });

    socket.on('disconnect', () => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance) {
            session.botInstance.quit();
            clearInterval(session.trackingInterval);
            clearInterval(session.afkInterval);
            activeRunningBots.delete(socket.id);
        }
    });
});

function sendPlayerList(bot, socket) {
    if (!bot.players) return;
    const list = Object.keys(bot.players).filter(p => p !== bot.username);
    socket.emit('update_player_list', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`);
});
