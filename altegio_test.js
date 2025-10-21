// @ts-check
import fetch from "node-fetch";

// Конфигурация
const config = {
  token: process.env.ALTEGIO_TOKEN,
  baseUrl: "https://api.alteg.io/v1",
  branchId: 1252189,
  staffId: 2742288, // Dubai Harbour Marina
  services: {
    "30": 12199769,
    "60": 12200654,
    "90": 12200653,
    "120": 12203754
  }
};

// Проверка наличия токена
if (!config.token) {
  console.error("❌ Ошибка: ALTEGIO_TOKEN не найден в переменных окружения");
  process.exit(1);
}

// Получить список услуг по филиалу
async function getServices() {
  try {
    console.log("🔍 Получаем список услуг...");
    const res = await fetch(`${config.baseUrl}/branches/${config.branchId}/services`, {
      headers: { Authorization: `Bearer ${config.token}` }
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    console.log("✅ Услуги получены:", data);
    return data;
  } catch (error) {
    console.error("❌ Ошибка при получении услуг:", error.message);
    throw error;
  }
}

// Получить свободные слоты
async function getSlots(serviceId = config.services["90"], date = "2025-10-22") {
  try {
    console.log(`🔍 Получаем слоты для услуги ${serviceId} на ${date}...`);
    const res = await fetch(
      `${config.baseUrl}/branches/${config.branchId}/slots?service_id=${serviceId}&staff_id=${config.staffId}&date=${date}`,
      { headers: { Authorization: `Bearer ${config.token}` } }
    );
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    console.log("✅ Слоты получены:", data);
    return data;
  } catch (error) {
    console.error("❌ Ошибка при получении слотов:", error.message);
    throw error;
  }
}

// Создать бронь
async function createBooking(bookingData) {
  try {
    const body = {
      branch: config.branchId,
      service_id: bookingData.serviceId || config.services["90"],
      staff_id: bookingData.staffId || config.staffId,
      datetime: bookingData.datetime || "2025-10-22T14:30:00+04:00",
      duration: bookingData.duration || 90,
      client: {
        name: bookingData.client?.name || "Test User",
        phone: bookingData.client?.phone || "+971999999999",
        email: bookingData.client?.email || "test@example.com"
      },
      comment: bookingData.comment || "Test API booking"
    };

    console.log("🔍 Создаем бронь...", body);

    const res = await fetch(`${config.baseUrl}/branches/${config.branchId}/bookings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(`HTTP ${res.status}: ${res.statusText}. ${JSON.stringify(errorData)}`);
    }

    const data = await res.json();
    console.log("✅ Бронь создана:", data);
    return data;
  } catch (error) {
    console.error("❌ Ошибка при создании брони:", error.message);
    throw error;
  }
}

// Основная функция для тестирования
async function runTests() {
  try {
    console.log("🚀 Запускаем тесты API ALTEGIO...\n");
    
    // Тест 1: Получение услуг
    await getServices();
    console.log("");
    
    // Тест 2: Получение слотов
    await getSlots();
    console.log("");
    
    // Тест 3: Создание брони
    await createBooking({
      client: {
        name: "Иван Тестов",
        phone: "+971501234567",
        email: "ivan@example.com"
      },
      comment: "Тестовая запись через API"
    });
    
    console.log("\n🎉 Все тесты выполнены успешно!");
  } catch (error) {
    console.error("\n💥 Тесты завершились с ошибкой:", error.message);
    process.exit(1);
  }
}

// Запуск тестов
runTests();
