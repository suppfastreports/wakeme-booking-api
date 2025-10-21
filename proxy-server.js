import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ALTEGIO API credentials
const ALTEGIO_TOKEN = '4de4nx2z7nbush7jcad8';
const PARTNER_ID = '1296';
const COMPANY_ID = 1252189;

// Proxy endpoint for getting slots on specific date
app.get('/api/slots', async (req, res) => {
    try {
        const { companyId, staffId, serviceId, date } = req.query;
        
        console.log('📥 Получен запрос слотов:', { companyId, staffId, serviceId, date });
        
        const apiUrl = `https://api.alteg.io/api/v1/book_times/${companyId}/${staffId}/${date}?service_ids[]=${serviceId}`;
        
        console.log('🔗 URL API:', apiUrl);
        
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                'Accept': 'application/vnd.api.v2+json',
                'Content-Type': 'application/json',
                'X-Partner-ID': PARTNER_ID
            }
        });
        
        console.log('📤 Отправлен запрос к ALTEGIO API');
        console.log('📥 Получен ответ:', response.status, response.statusText);
        
        const data = await response.json();
        console.log('📄 Полные данные ответа:', JSON.stringify(data, null, 2));
        
        res.json(data);
    } catch (error) {
        console.error('❌ Ошибка прокси:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint for getting nearest available slots
app.get('/api/nearest-slots', async (req, res) => {
    try {
        const { companyId, staffId, serviceId } = req.query;
        
        console.log('📥 Получен запрос ближайших слотов:', { companyId, staffId, serviceId });
        
        const apiUrl = `https://api.alteg.io/api/v1/book_staff_seances/${companyId}/${staffId}/?service_ids[]=${serviceId}`;
        
        console.log('🔗 URL API для ближайших слотов:', apiUrl);
        
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${ALTEGIO_TOKEN}`,
                'Accept': 'application/vnd.api.v2+json',
                'Content-Type': 'application/json',
                'X-Partner-ID': PARTNER_ID
            }
        });
        
        console.log('📤 Отправлен запрос к ALTEGIO API для ближайших слотов');
        console.log('📥 Получен ответ:', response.status, response.statusText);
        
        const data = await response.json();
        console.log('📄 Полные данные ответа ближайших слотов:', JSON.stringify(data, null, 2));
        
        res.json(data);
    } catch (error) {
        console.error('❌ Ошибка прокси для ближайших слотов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint for sending Telegram messages
app.post('/api/send-telegram', async (req, res) => {
    try {
        const { message } = req.body;

        console.log('📤 [TELEGRAM] Отправляем сообщение в Telegram:', message);

        const telegramUrl = `https://api.telegram.org/bot${ALTEGIO_TOKEN}/sendMessage`;
        
        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: '-1002681477081', // Ваш Chat ID
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
        console.log('✅ [TELEGRAM] Сообщение успешно отправлено:', data);

        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [TELEGRAM] Ошибка прокси:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Прокси-сервер запущен на порту ${PORT}`);
    console.log(`📱 Форма доступна по адресу: http://localhost:${PORT}/booking-form.html`);
});
