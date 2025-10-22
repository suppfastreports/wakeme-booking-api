import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import Stripe from 'stripe';
import dotenv from 'dotenv';

// Load env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Проверяем, что порт доступен
console.log('🔧 Проверяем порт:', PORT);
console.log('🔧 Render PORT:', process.env.PORT);
console.log('🔧 Render NODE_ENV:', process.env.NODE_ENV);

// Middleware
// Stripe webhook needs raw body for signature verification. Register it BEFORE json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(cors({
    origin: [
        'https://wakeme.ae',
        'https://www.wakeme.ae',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(express.static('.')); // Для отдачи статических файлов

// Обработка preflight запросов - убираем проблемный эндпоинт
// CORS middleware уже обрабатывает OPTIONS запросы

// ALTEGIO API Configuration
const ALTEGIO_BASE_URL = 'https://api.alteg.io/api/v1';
const ALTEGIO_TOKEN = process.env.ALTEGIO_TOKEN || 'YOUR_ALTEGIO_TOKEN_HERE';
const ALTEGIO_PARTNER_ID = process.env.ALTEGIO_PARTNER_ID || 'YOUR_PARTNER_ID_HERE';

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID_HERE';

// Stripe Configuration
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

console.log('🚀 Универсальный прокси-сервер запущен');
console.log('📊 ALTEGIO API:', ALTEGIO_TOKEN !== 'YOUR_ALTEGIO_TOKEN_HERE' ? 'Настроен' : 'НЕ НАСТРОЕН');
console.log('📱 Telegram Bot:', TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE' ? 'Настроен' : 'НЕ НАСТРОЕН');
console.log('💳 Stripe:', STRIPE_SECRET_KEY ? 'Настроен' : 'НЕ НАСТРОЕН');
console.log(`🌐 Сервер: http://localhost:${PORT}`);
console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔧 Port: ${PORT}`);
console.log('🔧 Process ID:', process.pid);
console.log('🔧 Node Version:', process.version);
console.log('🔧 Platform:', process.platform);
console.log('🔧 Working Directory:', process.cwd());
console.log('🔧 Environment Variables:', Object.keys(process.env).length);

// ===== ALTEGIO API ENDPOINTS =====

// Proxy endpoint for getting availability dates
app.post('/api/availability', async (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { service_id, start_date, end_date } = req.body;

        console.log('📥 [ALTEGIO] Получен запрос доступности:', { service_id, start_date, end_date });

        // Получаем staff_id из service_id (нужно добавить маппинг)
        let staffId;
        if (service_id === 12200654 || service_id === 12199769 || service_id === 12952120 || service_id === 12200653 || service_id === 12203754) {
            staffId = 2742288; // DUBAI_HARBOUR_MARINA
        } else if (service_id === 12396432 || service_id === 12396457 || service_id === 12952179 || service_id === 12396453 || service_id === 12396454) {
            staffId = 2780637; // DUBAI_CREEK_HARBOUR
        } else {
            staffId = 2742288; // Default
        }

        // Генерируем даты между start_date и end_date
        const allDates = [];
        const start = new Date(start_date);
        const end = new Date(end_date);
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            allDates.push(d.toISOString().split('T')[0]);
        }

        console.log('📊 [ALTEGIO] Проверяем доступность для дат:', allDates);

        // Проверяем реальную доступность каждой даты
        const availableDates = [];
        
        for (const date of allDates) {
            try {
                const apiUrl = `${ALTEGIO_BASE_URL}/book_times/${ALTEGIO_COMPANY_ID}/${staffId}/${date}?service_ids[]=${service_id}`;
                
                const response = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                        'X-Partner-ID': ALTEGIO_PARTNER_ID,
                        'Accept': 'application/vnd.api.v2+json',
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    // Проверяем, есть ли реальные слоты
                    if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
                        availableDates.push(date);
                        console.log(`✅ [ALTEGIO] Дата ${date} доступна (${data.data.length} слотов)`);
                    } else {
                        console.log(`❌ [ALTEGIO] Дата ${date} недоступна (нет слотов)`);
                    }
                } else {
                    console.log(`❌ [ALTEGIO] Дата ${date} недоступна (ошибка API: ${response.status})`);
                }
            } catch (error) {
                console.log(`❌ [ALTEGIO] Ошибка проверки даты ${date}:`, error.message);
            }
        }

        console.log('📊 [ALTEGIO] Доступные даты:', availableDates);

        res.json({
            available_dates: availableDates,
            service_id: service_id,
            start_date: start_date,
            end_date: end_date
        });

    } catch (error) {
        console.error('❌ [ALTEGIO] Ошибка получения доступности:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint for getting slots on a specific date
app.get('/api/slots', async (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { companyId, staffId, serviceId, date } = req.query;

        console.log('📥 [ALTEGIO] Получен запрос слотов:', { companyId, staffId, serviceId, date });

        const apiUrl = `${ALTEGIO_BASE_URL}/book_times/${companyId}/${staffId}/${date}?service_ids[]=${serviceId}`;

        console.log('🔗 [ALTEGIO] URL API:', apiUrl);

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                'X-Partner-ID': ALTEGIO_PARTNER_ID,
                'Accept': 'application/vnd.api.v2+json',
                'Content-Type': 'application/json'
            }
        });

        console.log(`📥 [ALTEGIO] Ответ: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ [ALTEGIO] Ошибка API:', errorText);
            return res.status(response.status).json({ error: errorText });
        }

        const data = await response.json();
        console.log('📄 [ALTEGIO] Данные получены успешно');

        res.json(data);
    } catch (error) {
        console.error('❌ [ALTEGIO] Ошибка прокси:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint for getting slots (POST method)
app.post('/api/slots', async (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { date, service_id } = req.body;

        console.log('📥 [ALTEGIO] Получен запрос слотов (POST):', { date, service_id });

        // Генерируем тестовые слоты времени
        const slots = [
            { time: '10:00' },
            { time: '11:00' },
            { time: '12:00' },
            { time: '13:00' },
            { time: '14:00' },
            { time: '15:00' },
            { time: '16:00' },
            { time: '17:00' }
        ];

        console.log('📊 [ALTEGIO] Сгенерированы слоты:', slots);

        res.json(slots);

    } catch (error) {
        console.error('❌ [ALTEGIO] Ошибка получения слотов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint for getting nearest available slots
app.get('/api/nearest-slots', async (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { companyId, staffId, serviceId } = req.query;

        console.log('📥 [ALTEGIO] Получен запрос ближайших слотов:', { companyId, staffId, serviceId });

        const apiUrl = `${ALTEGIO_BASE_URL}/book_staff_seances/${companyId}/${staffId}/?service_ids[]=${serviceId}`;

        console.log('🔗 [ALTEGIO] URL для ближайших слотов:', apiUrl);

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                'X-Partner-ID': ALTEGIO_PARTNER_ID,
                'Accept': 'application/vnd.api.v2+json',
                'Content-Type': 'application/json'
            }
        });

        console.log(`📥 [ALTEGIO] Ответ: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ [ALTEGIO] Ошибка API для ближайших слотов:', errorText);
            return res.status(response.status).json({ error: errorText });
        }

        const data = await response.json();
        console.log('📄 [ALTEGIO] Ближайшие слоты получены успешно');

        res.json(data);
    } catch (error) {
        console.error('❌ [ALTEGIO] Ошибка прокси для ближайших слотов:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== HEALTH CHECK =====

// Health check endpoint
app.get('/api/health', (req, res) => {
    console.log('🏥 [HEALTH] Health check запрос получен');
    
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    const healthData = { 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        port: PORT,
        pid: process.pid
    };
    
    console.log('🏥 [HEALTH] Отправляем ответ:', healthData);
    res.status(200).json(healthData);
});

// ===== LOGGING ENDPOINTS =====

// Store logs from frontend
app.post('/api/logs', (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const logData = req.body;
        console.log(`📝 [LOG] ${logData.level}: ${logData.message}`, logData.data);
        
        // Можно добавить сохранение в файл или базу данных
        // fs.appendFileSync('logs.txt', JSON.stringify(logData) + '\n');
        
        res.json({ success: true, message: 'Log received' });
    } catch (error) {
        console.error('❌ [LOG] Ошибка обработки лога:', error);
        res.status(500).json({ error: 'Failed to process log' });
    }
});

// Get logs (для отладки)
app.get('/api/logs', (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    res.json({ message: 'Logs endpoint working' });
});

// ===== TELEGRAM API ENDPOINTS =====

// Proxy endpoint for sending Telegram messages
app.post('/api/send-telegram', async (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { message } = req.body;

        console.log('📤 [TELEGRAM] Отправляем сообщение в Telegram');

        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        console.log(`📥 [TELEGRAM] Ответ от Telegram: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ [TELEGRAM] Ошибка от Telegram API:', errorText);
            return res.status(response.status).json({ error: errorText });
        }

        const data = await response.json();
        console.log('✅ [TELEGRAM] Сообщение успешно отправлено');

        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [TELEGRAM] Ошибка прокси:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== STRIPE CHECKOUT =====

// Create checkout session
app.post('/api/create-checkout-session', async (req, res) => {
    // CORS заголовки
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');

    try {
        if (!stripe) {
            return res.status(500).json({ error: 'Stripe не настроен на сервере' });
        }

        const {
            name,
            phone,
            location,
            duration,
            trainer,
            time,
            date,
            amount_aed
        } = req.body || {};

        if (!amount_aed || !duration || !location) {
            return res.status(400).json({ error: 'Отсутствуют обязательные поля для оплаты' });
        }

        const productName = `WakeMe — ${duration} мин ${trainer === 'with' ? '+ тренер' : ''}`.trim();
        const unitAmount = Math.round(Number(amount_aed) * 100); // AED -> fils

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            currency: 'aed',
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'aed',
                        unit_amount: unitAmount,
                        product_data: {
                            name: productName
                        }
                    }
                }
            ],
            success_url: `${APP_URL}/booking-form.html?paid=1&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${APP_URL}/booking-form.html?canceled=1`,
            metadata: {
                name: name || '',
                phone: phone || '',
                location: location || '',
                duration: String(duration || ''),
                trainer: trainer || '',
                time: time || '',
                date: date || '',
                amount_aed: String(amount_aed)
            }
        });

        return res.json({ url: session.url });
    } catch (error) {
        console.error('❌ [STRIPE] Ошибка создания Checkout-сессии:', error);
        return res.status(500).json({ error: 'Не удалось создать сессию оплаты' });
    }
});

// Stripe webhook: отправляем в Telegram только оплаченные заказы
app.post('/api/stripe/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        if (!stripe) {
            throw new Error('Stripe не настроен');
        }

        if (!STRIPE_WEBHOOK_SECRET) {
            throw new Error('Не задан STRIPE_WEBHOOK_SECRET');
        }

        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('❌ [STRIPE] Ошибка проверки подписи вебхука:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const md = session.metadata || {};
            const amountAed = md.amount_aed || Math.round((session.amount_total || 0) / 100);

            const message = `*Оплаченная бронь WakeMe*\n\n*Клиент:* ${md.name || '-'}\n*Телефон:* ${md.phone || '-'}\n*Локация:* ${md.location || '-'}\n*Длительность:* ${md.duration || '-'} мин\n*Тренер:* ${md.trainer === 'with' ? 'С тренером' : 'Без тренера'}\n*Время:* ${md.time || '-'}\n*Стоимость:* ${amountAed} AED\n*Дата:* ${md.date || '-'}\n*Stripe:* ${session.id}`;

            try {
                const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
                await fetch(telegramUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TELEGRAM_CHAT_ID,
                        text: message,
                        parse_mode: 'Markdown'
                    })
                });
            } catch (tgErr) {
                console.error('❌ [TELEGRAM] Не удалось отправить сообщение об оплате:', tgErr);
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('❌ [STRIPE] Ошибка обработки вебхука:', error);
        res.status(500).json({ error: 'Webhook handler error' });
    }
});

// ===== ROOT ENDPOINT =====

// Root endpoint for basic connectivity test
app.get('/', (req, res) => {
    console.log('🏠 [ROOT] Root запрос получен');
    res.status(200).json({ 
        message: 'WakeMe Booking API is running',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// ===== SERVER START =====

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Универсальный прокси-сервер запущен на порту ${PORT}`);
    console.log(`📱 Форма доступна по адресу: http://localhost:${PORT}/booking-form.html`);
    console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
    console.log('');
    console.log('📊 Доступные эндпоинты:');
    console.log('  • GET  /api/slots - получение слотов ALTEGIO');
    console.log('  • GET  /api/nearest-slots - ближайшие слоты ALTEGIO');
    console.log('  • POST /api/send-telegram - отправка в Telegram');
    console.log('  • GET  /api/health - проверка состояния');
}).on('error', (err) => {
    console.error('❌ Ошибка запуска сервера:', err);
    process.exit(1);
});
