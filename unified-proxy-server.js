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
const ALTEGIO_COMPANY_ID = process.env.ALTEGIO_COMPANY_ID || '1252189';
const ALTEGIO_USER_TOKEN = process.env.ALTEGIO_USER_TOKEN || '';

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID_HERE';

// Stripe Configuration
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const TIMEZONE_OFFSET_MINUTES = Number(process.env.TIMEZONE_OFFSET_MINUTES || '240'); // Dubai +04:00

// Location/Service mapping (server mirror of frontend config)
const LOCATION_CONFIG = {
    DUBAI_HARBOUR_MARINA: {
        staffId: 2742288,
        services: {
            30: 12199769,
            45: 12952120,
            60: 12200654,
            90: 12200653,
            120: 12203754
        }
    },
    DUBAI_CREEK_HARBOUR: {
        staffId: 2780637,
        services: {
            30: 12396457,
            45: 12952179,
            60: 12396432,
            90: 12396453,
            120: 12396454
        }
    }
};

// ===== Helpers =====
function buildAltegioHeaders(useUserToken) {
    const base = {
        Accept: 'application/vnd.api.v2+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${useUserToken && ALTEGIO_USER_TOKEN ? ALTEGIO_USER_TOKEN : ALTEGIO_TOKEN}`
    };
    // X-Partner-ID нужен только при работе по партнёрскому токену
    if (!useUserToken && ALTEGIO_PARTNER_ID) {
        base['X-Partner-ID'] = ALTEGIO_PARTNER_ID;
    }
    return base;
}

function maskToken(token) {
    if (!token || typeof token !== 'string') return '';
    if (token.length <= 10) return token;
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
}
async function createAltegioBooking({ location, duration, date, time, name, phone, email, apiId, paymentSumAed }) {
    const loc = LOCATION_CONFIG[location];
    if (!loc) {
        throw new Error('Unknown location');
    }
    const staffId = loc.staffId;
    const serviceId = loc.services[duration];
    if (!serviceId) {
        throw new Error('Unknown service for duration');
    }

    // Формируем локальное время с фиксированным смещением (например, +04:00 для Дубая)
    function formatWithOffset(dateStr, timeStr, offsetMinutes) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const [hh, mm] = timeStr.split(':').map(Number);
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const abs = Math.abs(offsetMinutes);
        const offH = String(Math.floor(abs / 60)).padStart(2, '0');
        const offM = String(abs % 60).padStart(2, '0');
        // Не конвертируем в UTC, оставляем локальное время с оффсетом
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${sign}${offH}:${offM}`;
    }

    // Всегда используем таймзону компании (Дубай +04:00)
    const datetime = formatWithOffset(date, time, TIMEZONE_OFFSET_MINUTES);

    console.log('🧭 [ALTEGIO] Token mode (check -> record):', 'partner_token', '->', 'partner_token');
    // 1) Check params (с user_token не передаём X-Partner-ID)
    // На check идём партнёрским токеном с X-Partner-ID
    const checkHeaders = buildAltegioHeaders(false);
    console.log('🔐 [ALTEGIO] Headers for check:', {
        Authorization: `Bearer ${maskToken(ALTEGIO_TOKEN)}`,
        partnerId: ALTEGIO_PARTNER_ID || null,
        hasPartnerIdHeader: Boolean(checkHeaders['X-Partner-ID'] || false)
    });
    console.log('📦 [ALTEGIO] book_check payload:', {
        appointments: [ { id: 1, services: [serviceId], staff_id: staffId, datetime } ]
    });
    const checkResp = await fetch(`${ALTEGIO_BASE_URL}/book_check/${ALTEGIO_COMPANY_ID}`, {
        method: 'POST',
        headers: checkHeaders,
        body: JSON.stringify({
            appointments: [ { id: 1, services: [serviceId], staff_id: staffId, datetime } ]
        })
    });
    if (checkResp.status !== 201) {
        const text = await checkResp.text();
        throw new Error(`Altegio check failed: ${text}`);
    }

    // 2) Create record
    async function requestCreate(withServices) {
        const sanitizedPhone = String(phone || '').replace(/\D/g, '');
        const body = {
            phone: sanitizedPhone,
            fullname: name,
            email: email || '',
            type: 'website',
            notify_by_sms: 6,
            notify_by_email: 0,
            api_id: apiId || undefined,
            appointments: [ withServices ? { id: 1, services: [serviceId], staff_id: staffId, datetime } : { id: 1, staff_id: staffId, datetime } ]
        };
        // На создание записи идём с user_token (без X-Partner-ID)
        // Партнёрский токен c prepaid признаками, чтобы пройти «обязательную предоплату»
        const partnerHeaders = buildAltegioHeaders(false);
        const partnerBody = {
            ...body,
            payment_sum: typeof paymentSumAed === 'number' ? paymentSumAed : undefined,
            prepaid_confirmed: true
        };
        const resp = await fetch(`${ALTEGIO_BASE_URL}/book_record/${ALTEGIO_COMPANY_ID}`, {
            method: 'POST',
            headers: partnerHeaders,
            body: JSON.stringify(partnerBody)
        });
        const text = await resp.text();
        console.log('📨 [ALTEGIO] Partner record response:', resp.status, text);
        return { resp, text };
    }

    // Try with services first, then fallback without services if Altegio complains about online payment list
    let attempt = await requestCreate(true);
    if (attempt.resp.status !== 201 && /online payment/i.test(attempt.text)) {
        console.warn('⚠️ [ALTEGIO] Retry booking without services field due to online payment constraint');
        attempt = await requestCreate(false);
    }
    if (attempt.resp.status !== 201) {
        throw new Error(`Altegio booking failed: ${attempt.text}`);
    }
    let data;
    try { data = JSON.parse(attempt.text); } catch { data = { raw: attempt.text }; }
    return data;
}

// Add payment to visit in Altegio
async function addAltegioPayment({ recordId, amountAed, paymentTypeTitle = 'Card payment', comment = '' }) {
    // Найдём id типа оплаты по названию (если доступен эндпоинт). Если нет — отправим без type_id, многие аккаунты подставляют дефолтный тип для безнала
    const typeId = undefined;
    const payload = {
        amount: Number(amountAed),
        currency: 'AED',
        type: 1, // 1 — безналичный платёж (обычно соответствует эквайрингу)
        comment
    };
    const resp = await fetch(`${ALTEGIO_BASE_URL}/book_record/${ALTEGIO_COMPANY_ID}/${recordId}/payments`, {
        method: 'POST',
        headers: buildAltegioHeaders(Boolean(ALTEGIO_USER_TOKEN)),
        body: JSON.stringify(payload)
    });
    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`Add payment failed: ${text}`);
    }
    return text;
}

console.log('🚀 Универсальный прокси-сервер запущен');
console.log('📊 ALTEGIO API:', ALTEGIO_TOKEN !== 'YOUR_ALTEGIO_TOKEN_HERE' ? 'Настроен' : 'НЕ НАСТРОЕН');
console.log('📱 Telegram Bot:', TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE' ? 'Настроен' : 'НЕ НАСТРОЕН');
console.log('🏢 Altegio Company ID:', ALTEGIO_COMPANY_ID ? ALTEGIO_COMPANY_ID : 'НЕ ЗАДАН');
console.log('👤 Altegio User Token:', ALTEGIO_USER_TOKEN ? 'Настроен' : 'НЕ ЗАДАН');
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

        // Проверяем реальную доступность каждой даты с ограничением параллелизма
        const availableDates = [];
        const concurrency = 6; // мягкий лимит параллельных запросов

        async function checkDate(date) {
            const apiUrl = `${ALTEGIO_BASE_URL}/book_times/${ALTEGIO_COMPANY_ID}/${staffId}/${date}?service_ids[]=${service_id}`;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 7000);
                const response = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                        'X-Partner-ID': ALTEGIO_PARTNER_ID,
                        'Accept': 'application/vnd.api.v2+json',
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if (!response.ok) {
                    console.log(`❌ [ALTEGIO] Дата ${date} недоступна (ошибка API: ${response.status})`);
                    return;
                }
                const data = await response.json();
                if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
                    availableDates.push(date);
                    console.log(`✅ [ALTEGIO] Дата ${date} доступна (${data.data.length} слотов)`);
                } else {
                    console.log(`❌ [ALTEGIO] Дата ${date} недоступна (нет слотов)`);
                }
            } catch (error) {
                console.log(`❌ [ALTEGIO] Ошибка проверки даты ${date}:`, error.message);
            }
        }

        // Параллельная обработка батчами
        for (let i = 0; i < allDates.length; i += concurrency) {
            const batch = allDates.slice(i, i + concurrency);
            await Promise.allSettled(batch.map(checkDate));
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
        console.log('💳 [STRIPE] Запрос на создание Checkout-сессии:', req.body);
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
            amount_aed,
            return_url,
            timezone_offset_minutes
        } = req.body || {};

        if (!amount_aed || !duration || !location) {
            return res.status(400).json({ error: 'Отсутствуют обязательные поля для оплаты' });
        }

        const productName = `WakeMe — ${duration} min${trainer === 'with' ? ' + coach' : ''}`.trim();
        // amount_aed сейчас передаётся БЕЗ НДС, добавим 5% VAT для Дубая
        const baseAmount = Number(amount_aed);
        const amountWithVat = Math.round(baseAmount * 1.05 * 100); // AED->fils с VAT

        // Формируем адрес возврата: либо из тела, либо из заголовка Referer, либо APP_URL
        const referer = req.headers.referer || '';
        const baseReturnUrl = (typeof return_url === 'string' && return_url.startsWith('http'))
            ? return_url
            : (referer && referer.startsWith('http') ? referer : `${APP_URL}/booking-form.html`);
        const successUrl = `${baseReturnUrl}${baseReturnUrl.includes('?') ? '&' : '?'}paid=1&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${baseReturnUrl}${baseReturnUrl.includes('?') ? '&' : '?'}canceled=1`;

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            currency: 'aed',
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'aed',
                        unit_amount: amountWithVat,
                        product_data: {
                            name: productName
                        }
                    }
                }
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                customer_name: name || '',
                customer_phone: phone || '',
                location,
                duration_minutes: String(duration || ''),
                trainer: trainer === 'with' ? 'with_coach' : 'without_coach',
                time: time || '',
                date: date || '',
                amount_aed_no_vat: String(baseAmount),
                vat_percent: '5',
                amount_aed_with_vat: String(Math.round(baseAmount * 1.05)),
                timezone_offset_minutes: String(typeof timezone_offset_minutes === 'number' ? timezone_offset_minutes : TIMEZONE_OFFSET_MINUTES)
            }
        });

        console.log('✅ [STRIPE] Сессия создана:', session.id);
        return res.json({ url: session.url });
    } catch (error) {
        console.error('❌ [STRIPE] Ошибка создания Checkout-сессии:', error);
        return res.status(500).json({ error: 'Не удалось создать сессию оплаты' });
    }
});

// Create Altegio booking (after payment usually, but can be used pre-payment as draft)
app.post('/api/altegio/book', async (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');

    try {
        const { location, duration, date, time, name, phone, email } = req.body || {};
        if (!location || !duration || !date || !time || !name || !phone) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const loc = LOCATION_CONFIG[location];
        if (!loc) return res.status(400).json({ error: 'Unknown location' });
        const staffId = loc.staffId;
        const serviceId = loc.services[duration];
        if (!serviceId) return res.status(400).json({ error: 'Unknown service for duration' });

        const datetime = new Date(`${date}T${time}:00`).toISOString();

        // 1) Optional: check params
        const checkResp = await fetch(`${ALTEGIO_BASE_URL}/book_check/${ALTEGIO_COMPANY_ID}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                'X-Partner-ID': ALTEGIO_PARTNER_ID,
                'Accept': 'application/vnd.api.v2+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appointments: [
                    { id: 1, services: [serviceId], staff_id: staffId, datetime }
                ]
            })
        });
        if (checkResp.status !== 201) {
            const text = await checkResp.text();
            return res.status(422).json({ error: 'Altegio check failed', details: text });
        }

        // 2) Create record
        const recordResp = await fetch(`${ALTEGIO_BASE_URL}/book_record/${ALTEGIO_COMPANY_ID}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                'X-Partner-ID': ALTEGIO_PARTNER_ID,
                'Accept': 'application/vnd.api.v2+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: phone,
                fullname: name,
                email: email || '',
                type: 'website',
                notify_by_sms: 6,
                notify_by_email: 0,
                appointments: [
                    { id: 1, services: [serviceId], staff_id: staffId, datetime }
                ]
            })
        });

        const bodyText = await recordResp.text();
        if (recordResp.status !== 201) {
            return res.status(recordResp.status).json({ error: 'Altegio booking failed', details: bodyText });
        }
        let data;
        try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText }; }
        return res.status(201).json({ success: true, data });
    } catch (error) {
        console.error('❌ [ALTEGIO] Ошибка создания записи:', error);
        return res.status(500).json({ error: 'Failed to create Altegio booking' });
    }
});

// ===== TEST ENDPOINTS (no Stripe) =====
// Create booking directly in Altegio for testing (can also add a tiny payment)
app.post('/api/altegio/test', async (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');

    try {
        const { location, duration, date, time, name, phone, simulatePayment } = req.body || {};
        if (!location || !duration || !date || !time || !name || !phone) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Use hybrid flow inside createAltegioBooking. Pass small paymentSum for partner attempt
        const attempt = await createAltegioBooking({
            location,
            duration: Number(duration),
            date,
            time,
            name,
            phone,
            email: '',
            apiId: 'TEST',
            paymentSumAed: 1
        });

        const result = { record: { status: attempt.resp?.status, body: attempt.text } };

        // Try to parse record_id from response
        let parsed;
        try { parsed = JSON.parse(attempt.text); } catch {}
        const created = parsed && (Array.isArray(parsed.data) ? parsed.data[0] : parsed.data);
        const recordId = created?.record_id || created?.id;

        if (simulatePayment && recordId) {
            try {
                const payRes = await addAltegioPayment({ recordId, amountAed: 1, comment: 'TEST payment via API' });
                result.payment = { ok: true, body: payRes };
            } catch (e) {
                result.payment = { ok: false, error: String(e) };
            }
        }

        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('❌ [ALTEGIO TEST] Ошибка тестовой записи:', error);
        return res.status(500).json({ error: 'Failed test booking', details: error.message });
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
            const amountAed = md.amount_aed_with_vat || Math.round((session.amount_total || 0) / 100);

            const message = `*Оплаченная бронь WakeMe*\n\n*Клиент:* ${md.customer_name || '-'}\n*Телефон:* ${md.customer_phone || '-'}\n*Локация:* ${md.location || '-'}\n*Длительность:* ${md.duration_minutes || '-'} мин\n*Тренер:* ${md.trainer === 'with_coach' ? 'С тренером' : 'Без тренера'}\n*Время:* ${md.time || '-'}\n*Стоимость:* ${md.amount_aed_with_vat || amountAed} AED (с VAT)\n*Дата:* ${md.date || '-'}\n*Stripe:* ${session.id}`;

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

            // Create booking in Altegio after successful payment
            try {
                console.log('🗓️ [ALTEGIO] Создаём запись после оплаты...');
                const booking = await createAltegioBooking({
                    location: md.location,
                    duration: Number(md.duration_minutes),
                    date: md.date,
                    time: md.time,
                    name: md.customer_name,
                    phone: md.customer_phone,
                    email: md.customer_email || '',
                    apiId: session.id,
                    paymentSumAed: Number(md.amount_aed_with_vat || Math.round((session.amount_total || 0) / 100))
                });
                console.log('✅ [ALTEGIO] Запись создана:', booking);

                // Получим record_id из ответа и добавим оплату
                const created = Array.isArray(booking?.data) ? booking.data[0] : booking?.data || {};
                const recordId = created.record_id || created.id;
                if (recordId) {
                    try {
                        const paidAmount = Number(md.amount_aed_with_vat || Math.round((session.amount_total || 0) / 100));
                        const payRes = await addAltegioPayment({
                            recordId,
                            amountAed: paidAmount,
                            comment: `Paid via Stripe ${session.id}`
                        });
                        console.log('💸 [ALTEGIO] Оплата добавлена к визиту:', payRes);
                    } catch (payErr) {
                        console.error('❌ [ALTEGIO] Не удалось добавить оплату к визиту:', payErr);
                    }
                } else {
                    console.warn('⚠️ [ALTEGIO] Не найден record_id в ответе при создании записи');
                }
            } catch (bookErr) {
                console.error('❌ [ALTEGIO] Не удалось создать запись после оплаты:', bookErr);
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
