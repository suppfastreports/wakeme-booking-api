# ALTEGIO API - Онлайн запись

Этот проект содержит код для работы с API ALTEGIO для создания системы онлайн-записи.

## Установка

1. Установите зависимости:
```bash
npm install
```

2. Создайте файл `.env` и добавьте ваш API токен:
```bash
ALTEGIO_TOKEN=your_api_token_here
```

## Использование

Запустите тесты:
```bash
npm start
```

## Функции

- `getServices()` - получение списка услуг
- `getSlots(serviceId, date)` - получение свободных слотов
- `createBooking(bookingData)` - создание брони

## Конфигурация

В файле `altegio_test.js` настройте:
- `branchId` - ID филиала
- `staffId` - ID сотрудника
- `services` - маппинг длительности услуг на ID

## Пример использования

```javascript
// Получить услуги
const services = await getServices();

// Получить слоты на определенную дату
const slots = await getSlots(serviceId, "2025-10-22");

// Создать бронь
const booking = await createBooking({
  client: {
    name: "Иван Иванов",
    phone: "+971501234567",
    email: "ivan@example.com"
  },
  datetime: "2025-10-22T14:30:00+04:00",
  comment: "Комментарий к записи"
});
```
