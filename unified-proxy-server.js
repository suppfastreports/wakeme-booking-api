import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Для отдачи статических файлов

// ALTEGIO API Configuration
const ALTEGIO_BASE_URL = 'https://api.alteg.io/api/v1';
const ALTEGIO_TOKEN = process.env.ALTEGIO_TOKEN || 'YOUR_ALTEGIO_TOKEN_HERE';
const ALTEGIO_PARTNER_ID = process.env.ALTEGIO_PARTNER_ID || 'YOUR_PARTNER_ID_HERE';

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID_HERE';

console.log('🚀 Универсальный прокси-сервер запущен');
console.log('📊 ALTEGIO API:', ALTEGIO_TOKEN !== 'YOUR_ALTEGIO_TOKEN_HERE' ? 'Настроен' : 'НЕ НАСТРОЕН');
console.log('📱 Telegram Bot:', TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE' ? 'Настроен' : 'НЕ НАСТРОЕН');
console.log(`🌐 Сервер: http://localhost:${PORT}`);
console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔧 Port: ${PORT}`);

// ===== ALTEGIO API ENDPOINTS =====

// Proxy endpoint for getting slots on a specific date
app.get('/api/slots', async (req, res) => {
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

// Proxy endpoint for getting nearest available slots
app.get('/api/nearest-slots', async (req, res) => {
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
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ===== LOGGING ENDPOINTS =====

// Store logs from frontend
app.post('/api/logs', (req, res) => {
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
    res.json({ message: 'Logs endpoint working' });
});

// ===== TELEGRAM API ENDPOINTS =====

// Proxy endpoint for sending Telegram messages
app.post('/api/send-telegram', async (req, res) => {
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

// ===== HEALTH CHECK =====

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        services: {
            altegio: 'Connected',
            telegram: 'Connected'
        },
        timestamp: new Date().toISOString()
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
