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
// حماية السيرفر من الانهيار المفاجئ عند حدوث أخطاء شبكة غير معالجة
// -------------------------------------------------------------
process.on('uncaughtException', (err) => {
    console.error('[!] استثناء غير معالج (uncaughtException):', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[!] وعد غير معالج (unhandledRejection):', reason);
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

// قواعد البيانات في الذاكرة لتتبع الملكية والبوتات النشطة
const userBotsDatabase = new Map(); // [botUsername] -> { userId, host, port, password, version }
const activeRunningBots = new Map(); // [socketId] -> { botInstance, username, afkInterval, trackingInterval }

/**
 * دالة مساعدة لتنظيف وفصل اسم الخادم والمنفذ (Host & Port)
 */
function parseHostAndPort(rawHost, rawPort) {
    if (!rawHost) return { host: '', port: 25565 };
    
    // إزالة البروتوكولات والمسافات الزائدة
    let cleanHost = rawHost.trim().replace(/^https?:\/\//i, '');
    let finalPort = rawPort ? parseInt(rawPort, 10) : 25565;

    // إذا كتب المستخدم البورت داخل خانة العنوان (مثال: myserver.aternos.me:12345)
    if (cleanHost.includes(':')) {
        const parts = cleanHost.split(':');
        cleanHost = parts[0];
        const parsedPort = parseInt(parts[1], 10);
        if (!isNaN(parsedPort)) {
            finalPort = parsedPort;
        }
    }

    return { 
        host: cleanHost, 
        port: isNaN(finalPort) ? 25565 : finalPort 
    };
}

/**
 * دالة لإغلاق وتنظيف جلسة البوت والمؤقتات الخاصة بـ Socket محدد
 */
function cleanupBotSession(socketId) {
    const session = activeRunningBots.get(socketId);
    if (session) {
        // إيقاف المؤقتات الزمنية
        if (session.afkInterval) clearInterval(session.afkInterval);
        if (session.trackingInterval) clearInterval(session.trackingInterval);
        
        // إغلاق كائن البوت وتجريده من المستمعات
        if (session.botInstance) {
            try {
                session.botInstance.removeAllListeners();
                session.botInstance.quit();
            } catch (e) {
                // تجاهل أخطاء الإغلاق إذا كان البوت منفصلاً بالفعل
            }
        }
        activeRunningBots.delete(socketId);
    }
}

// -------------------------------------------------------------
// 2. إدارة التفاعل والربط اللحظي عبر Socket.io
// -------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`[+] متصل جديد من المدوّنة: ${socket.id}`);

    // [أ] تشغيل البوت وحفظ بياناته
    socket.on('start_bot', async (data) => {
        const { idToken, host: rawHost, port: rawPort, username, password, version } = data || {};

        if (!rawHost || !username) {
            socket.emit('bot_log', '[-] خطأ: اسم البوت وعنوان السيرفر مطلوبان.');
            return;
        }

        // تنظيف ومعالجة مدخلات السيرفر والمنفذ
        const { host, port } = parseHostAndPort(rawHost, rawPort);

        if (!host || host.length < 3) {
            socket.emit('bot_log', '[-] خطأ: عنوان السيرفر المدخل غير صالح.');
            return;
        }

        // إغلاق أي جلسة بوت قديمة مرتبطة بنفس الـ Socket
        cleanupBotSession(socket.id);

        // التحقق من هوية المستخدم عبر Firebase Token
        let userId = "guest_user";
        if (admin.apps.length > 0 && idToken) {
            try {
                const decodedToken = await admin.auth().verifyIdToken(idToken);
                userId = decodedToken.uid;
            } catch (err) {
                socket.emit('bot_log', '[-] خطأ: فشل التثبت من جلسة Firebase الخاصة بك.');
                return;
            }
        }

        // شرط عدم تكرار اسم البوت لمستخدم آخر
        const cleanUsername = username.trim();
        const existingBot = userBotsDatabase.get(cleanUsername);
        if (existingBot && existingBot.userId !== userId) {
            socket.emit('bot_log', `[-] خطأ: اسم البوت "${cleanUsername}" مأخوذ بالفعل من قبل مستخدم آخر!`);
            return;
        }

        // حفظ / تحديث بيانات البوت تحت اسم المستخدم
        userBotsDatabase.set(cleanUsername, {
            userId: userId,
            host: host,
            port: port,
            password: password || "",
            version: version || null
        });

        socket.emit('bot_log', `[*] جاري إنشاء الاتصال بالسيرفر ${host}:${port}...`);

        try {
            // خيارات تشغيل البوت
            const botOptions = {
                host: host,
                port: port,
                username: cleanUsername
            };

            // إضافة الإصدار فقط عند تحديده صراحة من الواجهة
            if (version && typeof version === 'string' && version.trim() !== '') {
                botOptions.version = version.trim();
            }

            const bot = mineflayer.createBot(botOptions);

            // تحميل ملحق إدارة الدروع مع معالجة الأخطاء
            try {
                bot.loadPlugin(armorManager);
            } catch (pErr) {
                console.warn('تنبيه: تعذر تحميل ملحق الدروع:', pErr.message);
            }

            let trackingInterval = null;
            let afkInterval = null;

            // تسجيل الجلسة مبدئياً
            activeRunningBots.set(socket.id, {
                botInstance: bot,
                username: cleanUsername,
                trackingInterval: null,
                afkInterval: null
            });

            bot.on('spawn', () => {
                socket.emit('bot_status', 'connected');
                socket.emit('bot_log', `[+] تم دخول البوت ${cleanUsername} إلى السيرفر بنجاح!`);

                // التسجيل التلقائي فور الدخول (AuthMe)
                if (password) {
                    setTimeout(() => {
                        if (bot && bot.entity) {
                            bot.chat(`/login ${password}`);
                            bot.chat(`/register ${password} ${password}`);
                            socket.emit('bot_log', '[*] تم تنفيذ أمر تسجيل الدخول التلقائي.');
                        }
                    }, 2000);
                }

                // ميزة حماية Anti-AFK لمنع الطرد
                afkInterval = setInterval(() => {
                    if (bot && bot.entity) {
                        try {
                            bot.setControlState('jump', true);
                            setTimeout(() => {
                                if (bot && bot.entity) bot.setControlState('jump', false);
                            }, 400);
                        } catch (e) {}
                    }
                }, 40000);

                // إرسال الإحداثيات والصحة والجوع وأقرب لاعب كل ثانية
                trackingInterval = setInterval(() => {
                    if (bot && bot.entity) {
                        try {
                            const pos = {
                                x: bot.entity.position.x.toFixed(1),
                                y: bot.entity.position.y.toFixed(1),
                                z: bot.entity.position.z.toFixed(1)
                            };

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

                            const health = bot.health !== undefined ? bot.health.toFixed(0) : 20;
                            const food = bot.food !== undefined ? bot.food.toFixed(0) : 20;

                            socket.emit('bot_telemetry', {
                                position: pos,
                                nearestPlayer: nearestPlayer,
                                health: health,
                                food: food
                            });
                        } catch (err) {
                            // إخفاء الأخطاء العابرة أثناء تحديث الإحداثيات
                        }
                    }
                }, 1000);

                // تحديث مراجع المؤقتات للجلسة النشطة
                const session = activeRunningBots.get(socket.id);
                if (session) {
                    session.trackingInterval = trackingInterval;
                    session.afkInterval = afkInterval;
                }

                sendPlayerList(bot, socket);
            });

            // تحويل شات السيرفر للواجهة
            bot.on('message', (jsonMsg) => {
                if (jsonMsg) {
                    socket.emit('game_chat', jsonMsg.toString());
                }
            });

            // تحديث قائمة اللاعبين
            bot.on('playerJoined', () => sendPlayerList(bot, socket));
            bot.on('playerLeft', () => sendPlayerList(bot, socket));

            // الأخطاء وفصل الاتصال
            bot.on('error', (err) => {
                let errorMsg = err.message || 'خطأ غير معروف في الاتصال';
                if (err.code === 'ENOTFOUND') {
                    errorMsg = `تعذر الوصول للعنوان (${err.hostname}). تأكد من كتابة IP السيرفر بشكل صحيح.`;
                } else if (err.code === 'ECONNRESET') {
                    errorMsg = 'تم قطع الاتصال من قبل خادم ماينكرافت (ECONNRESET). قد يكون السيرفر مغلقاً أو البورت خاطئاً.';
                }
                socket.emit('bot_log', `[-] خطأ شبكة: ${errorMsg}`);
            });

            bot.on('kicked', (reason) => {
                let parsedReason = reason;
                try {
                    parsedReason = typeof reason === 'object' ? JSON.stringify(reason) : reason;
                } catch (e) {}
                socket.emit('bot_log', `[-] تم طرد البوت: ${parsedReason}`);
            });

            bot.on('end', (reason) => {
                socket.emit('bot_status', 'disconnected');
                socket.emit('bot_log', `[-] انقطع الاتصال بالسيرفر: ${reason || 'تم التوقف'}`);
                cleanupBotSession(socket.id);
            });

        } catch (error) {
            socket.emit('bot_log', `[-] فشل إطلاق البوت: ${error.message}`);
            cleanupBotSession(socket.id);
        }
    });

    // [ب] إرسال رسالة عامة / أمر
    socket.on('send_chat', (msg) => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance && msg) {
            try {
                session.botInstance.chat(msg);
                socket.emit('bot_log', `[أنت]: ${msg}`);
            } catch (err) {
                socket.emit('bot_log', `[-] فشل إرسال الرسالة: ${err.message}`);
            }
        }
    });

    // [ج] إرسال رسالة خاصة للاعب محدد
    socket.on('send_pm', ({ targetPlayer, message }) => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance && targetPlayer && message) {
            try {
                session.botInstance.chat(`/msg ${targetPlayer} ${message}`);
                socket.emit('bot_log', `[خاص إلى ${targetPlayer}]: ${message}`);
            } catch (err) {
                socket.emit('bot_log', `[-] فشل إرسال الرسالة الخاصة: ${err.message}`);
            }
        }
    });

    // [د] زر ارتداء أفضل الدروع
    socket.on('equip_best_armor', () => {
        const session = activeRunningBots.get(socket.id);
        if (session && session.botInstance) {
            try {
                if (session.botInstance.armorManager) {
                    session.botInstance.armorManager.equipAll();
                    socket.emit('bot_log', '[*] تم ارتداء أفضل دروع متوفرة.');
                }
            } catch (err) {
                socket.emit('bot_log', `[-] تعذر ارتداء الدروع: ${err.message}`);
            }
        }
    });

    // [هـ] إيقاف البوت (Disconnect)
    socket.on('stop_bot', () => {
        cleanupBotSession(socket.id);
        socket.emit('bot_status', 'disconnected');
        socket.emit('bot_log', '[!] تم إيقاف البوت.');
    });

    // [و] حذف البوت كلياً من السيرفر الخلفي
    socket.on('delete_bot', () => {
        const session = activeRunningBots.get(socket.id);
        if (session) {
            userBotsDatabase.delete(session.username);
            cleanupBotSession(socket.id);
            socket.emit('bot_status', 'disconnected');
            socket.emit('bot_log', '[🗑️] تم حذف البوت نهائياً من النظام.');
        }
    });

    socket.on('disconnect', () => {
        cleanupBotSession(socket.id);
    });
});

/**
 * دالة إرسال قائمة اللاعبين النشطين إلى الواجهة
 */
function sendPlayerList(bot, socket) {
    if (!bot || !bot.players) return;
    try {
        const list = Object.keys(bot.players).filter(p => p !== bot.username);
        socket.emit('update_player_list', list);
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`);
});
