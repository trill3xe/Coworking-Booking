const demoUsers = [];

const demoSpaces = [
  {
    id: 'space_1',
    title: 'Skyline Studio',
    category: 'Частный офис',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 8000,
    capacity: 4,
    description: 'Просторный кабинет для команд с остеклением, кондиционером и тишиной для глубокого фокуса.',

    features: ['Wi‑Fi', 'Конференц-зал', 'Кофе', 'Курьерский стол'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_2',
    title: 'Lounge Cube',
    category: 'Общая рабочая зона',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 2000,
    capacity: 8,
    description: 'Открытая рабочая зона для фрилансеров и коворкинг-команд с естественным освещением.',

    features: ['Wi‑Fi', 'Зона отдыха', 'Тихий режим', 'Много света'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_3',
    title: 'Focus Pod',
    category: 'Переговорная',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 5000,
    capacity: 4,
    description: 'Комфортный переговорный кабинет для видеозвонков и личных встреч.',

    features: ['Телевизор', 'Видеозвонки', 'Маркерная доска', 'Пауза с кофе'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_4',
    title: 'Nomad Hub',
    category: 'Зал мероприятий',
    city: 'Астана',
    rating: 0,
    pricePerHour: 18000,
    capacity: 14,
    description: 'Большая зона для семинаров, презентаций и командных встреч.',

    features: ['Проектор', 'Микрофоны', 'Доступ 24/7'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_5',
    title: 'Quiet Nest',
    category: 'Тихая комната',
    city: 'Астана',
    rating: 0,
    pricePerHour: 2500,
    capacity: 1,
    description: 'Тихая кабинетная ячейка для глубокого фокуса и индивидуальной работы.',

    features: ['Тишина', 'Удобное кресло', 'Зарядка через USB', 'Световой режим'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1553028826-f4804a6dba3b?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
  },
  {
    id: 'space_6',
    title: 'Studio Board',
    category: 'Мастерская',
    city: 'Астана',
    rating: 0,
    pricePerHour: 6500,
    capacity: 6,
    description: 'Решение для мозговых штурмов, творческих сессий и командных ретроспектив.',

    features: ['Интерактивная доска', 'Кофе', 'Услуги администратора', 'Пауза'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_7',
    title: 'North Desk',
    category: 'Общая рабочая зона',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 3000,
    capacity: 10,
    description: 'Динамичная зона для удалённой работы и командной синхронизации.',
    features: ['Быстрый Wi‑Fi', 'Зона отдыха', 'Кофе', 'Хороший свет'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1431540015161-0bf868a2d407?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_8',
    title: 'Harbor Office',
    category: 'Частный офис',
    city: 'Астана',
    rating: 0,
    pricePerHour: 8500,
    capacity: 5,
    description: 'Личный офис с достойным интерьером и мощной рабочей инфраструктурой.',
    features: ['Шумопоглощение', 'Доступ 24/7', 'Кондиционер', 'Много места'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_9',
    title: 'White Room',
    category: 'Переговорная',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 4500,
    capacity: 4,
    description: 'Элегантный переговорный зал для важных встреч и созвонов.',
    features: ['Телевизор 4K', 'Панель записи', 'Микрофон', 'Маркерная доска'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1556761175-4b46a572b786?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
  },
  {
    id: 'space_10',
    title: 'Think Vault',
    category: 'Тихая комната',
    city: 'Астана',
    rating: 0,
    pricePerHour: 1500,
    capacity: 1,
    description: 'Комната для глубокого погружения и работы без отвлекающих факторов.',
    features: ['Тихая зона', 'Подстаканник', 'Доступ к сети', 'Лампа'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_11',
    title: 'Summit Hall',
    category: 'Зал мероприятий',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 20000,
    capacity: 18,
    description: 'Современное пространство для лекций, питчей и мероприятий.',
    features: ['Проектор', 'Свет', 'Микрофоны', 'Стулья'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1522204523234-8729aa6e3d5f?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_12',
    title: 'Canvas Point',
    category: 'Мастерская',
    city: 'Астана',
    rating: 0,
    pricePerHour: 6500,
    capacity: 7,
    description: 'Творческая зона для мозговых штурмов и продуктивных сессий.',
    features: ['Доска', 'Много стола', 'Кофе', 'Свет'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_13',
    title: 'Metro Nest',
    category: 'Общая рабочая зона',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 2500,
    capacity: 9,
    description: 'Просторная коворкинг зона для тех, кому важно быстро начать рабочий день.',
    features: ['Wi‑Fi', 'Фильтр звука', 'Кофе', 'Рабочие столы'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1423666639041-f56000c27a9a?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_14',
    title: 'Atlantic Desk',
    category: 'Частный офис',
    city: 'Астана',
    rating: 0,
    pricePerHour: 8500,
    capacity: 4,
    description: 'Уютный кабинет для небольших команд и личной работы в спокойной атмосфере.',
    features: ['Обеденная зона', 'Кофе', 'Кондиционер', 'Wi‑Fi'],
    status: 'available',
    image: 'https://plus.unsplash.com/premium_photo-1684249780786-11dfffd38fbb?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
  },
  {
    id: 'space_15',
    title: 'Echo Room',
    category: 'Переговорная',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 5000,
    capacity: 4,
    description: 'Небольшой, но максимально функциональный переговорный зал.',
    features: ['Видеозвонки', 'Микрофоны', 'Wi‑Fi', 'Пауза'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1606836591695-4d58a73eba1e?q=80&w=1171&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
  },
  {
    id: 'space_16',
    title: 'Velocity Lounge',
    category: 'Общая рабочая зона',
    city: 'Астана',
    rating: 0,
    pricePerHour: 2200,
    capacity: 11,
    description: 'Открытая рабочая зона для продуктивной работы и быстрых созвонов.',
    features: ['Зона отдыха', 'Удобные столы', 'Wi‑Fi', 'Комфорт'],
    status: 'available',
    image: 'https://plus.unsplash.com/premium_photo-1684769161054-2fa9a998dcb6?q=80&w=1204&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
  },
  {
    id: 'space_17',
    title: 'Cedar Office',
    category: 'Частный офис',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 8000,
    capacity: 5,
    description: 'Подходит для команд, которым важна дисциплина, тишина и рабочий ритм.',
    features: ['Конференц-пункт', 'Кофе', 'Тихий режим', 'Доступ 24/7'],
    status: 'available',
    image: 'https://plus.unsplash.com/premium_photo-1661962552438-696871a2c7cc?q=80&w=1139&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
  },
  {
    id: 'space_18',
    title: 'Focus Garden',
    category: 'Тихая комната',
    city: 'Астана',
    rating: 0,
    pricePerHour: 1600,
    capacity: 1,
    description: 'Небольшая тихая ячейка для погружения в задачи без внешних раздражителей.',
    features: ['Лампа', 'Тишина', 'Удобное кресло', 'Стабильный Wi‑Fi'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1600765728673-7b4aa76cc3ce?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
  },
  {
    id: 'space_19',
    title: 'Network Hall',
    category: 'Зал мероприятий',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 22000,
    capacity: 20,
    description: 'Большое пространство для встреч, презентаций и командных мероприятий.',
    features: ['Проектор', 'Свет', 'Танцпол', 'Микрофоны'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_20',
    title: 'Pulse Room',
    category: 'Мастерская',
    city: 'Астана',
    rating: 0,
    pricePerHour: 7000,
    capacity: 6,
    description: 'Сотрудничество, творчество и продуктивность в одном помещении.',
    features: ['Маркерная доска', 'Кофе', 'Прямой свет', 'Много столов'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_21',
    title: 'Blue Peak',
    category: 'Частный офис',
    city: 'Астана',
    rating: 0,
    pricePerHour: 9000,
    capacity: 5,
    description: 'Комфортный кабинет с современным интерьером и спокойной рабочей атмосферой.',
    features: ['Доступ 24/7', 'Wi‑Fi', 'Кофе', 'Мягкие кресла'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1516321165247-4aa89a48be28?auto=format&fit=crop&w=1200&q=80'
  }
];

const demoBookings = [];

const demoReviews = [];

const cityLocations = {
  Алматы: { lat: 43.2389, lng: 76.8897 },
  Астана: { lat: 51.1694, lng: 71.4491 }
};

const mockAddresses = {
  space_1: 'ул. Абая, 150',
  space_2: 'ул. Достык, 44',
  space_3: 'ул. Сатпаева, 72',
  space_4: 'пр. Мәңгілік Ел, 35',
  space_5: 'пр. Кабанбай батыра, 13',
  space_6: 'ул. Сыганак, 18',
  space_7: 'ул. Байтурсынова, 65',
  space_8: 'ул. Кунаева, 22',
  space_9: 'ул. Жандосова, 12',
  space_10: 'пр. Туран, 21',
  space_11: 'пр. Назарбаева, 42',
  space_12: 'ул. Туркестан, 58',
  space_13: 'ул. Розыбакиева, 20',
  space_14: 'ул. Кенесары, 87',
  space_15: 'пр. Райымбека, 5',
  space_16: 'ул. Абая, 202',
  space_17: 'ул. Желтоксан, 46',
  space_18: 'ул. Сарайшык, 131',
  space_19: 'пр. Аль-Фараби, 7',
  space_20: 'ул. Керей, Жанибек хандар, 121',
  space_21: 'пр. Кабанбай батыра, 17'
};

for (const space of demoSpaces) {
  space.address = mockAddresses[space.id];
  space.location = cityLocations[space.city];
  space.country = 'Казахстан';
  space.priceCurrency = 'KZT';
  space.searchText = [space.title, space.description, space.city, space.country, space.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

module.exports = {
  demoUsers,
  demoSpaces,
  demoBookings,
  demoReviews
};