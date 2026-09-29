export const demoUsers = [];
export const demoBookings = [];
export const demoReviews = [];

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
  space_6: 'ул. Сыганак, 18'
};

export const demoSpaces = [
  {
    id: 'space_1',
    title: 'Skyline Studio',
    category: 'Частный офис',
    city: 'Алматы',
    rating: 0,
    pricePerHour: 8000,
    capacity: 4,
    description: 'Просторный кабинет для команд с остеклением, кондиционером и тишиной для глубокого фокуса.',
    features: ['Wi‑Fi', 'Конференц-зал', 'Кофе'],
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
    features: ['Wi‑Fi', 'Зона отдыха', 'Много света'],
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
    features: ['Экран', 'Видеосвязь', 'Кофе'],
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
    features: ['Тишина', 'Удобное кресло', 'Зарядка через USB'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1553028826-f4804a6dba3b?auto=format&fit=crop&w=1200&q=80'
  },
  {
    id: 'space_6',
    title: 'Studio Board',
    category: 'Мастерская',
    city: 'Астана',
    rating: 0,
    pricePerHour: 6500,
    capacity: 6,
    description: 'Пространство для мозговых штурмов, творческих сессий и командных ретроспектив.',
    features: ['Интерактивная доска', 'Кофе', 'Администратор'],
    status: 'available',
    image: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80'
  }
].map((space) => {
  const address = mockAddresses[space.id];
  return {
    ...space,
    address,
    location: cityLocations[space.city],
    country: 'Казахстан',
    priceCurrency: 'KZT'
  };
});
